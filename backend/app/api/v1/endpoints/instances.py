"""Instance management endpoints for Horalix View.

Handles individual DICOM instances (images) including pixel data retrieval,
metadata access, and image manipulation.
"""

from collections import OrderedDict
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
import threading
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints.auth import (
    get_current_active_user,
    get_current_active_user_from_token,
)
from app.core.config import get_settings
from app.core.security import TokenData
from app.models.base import get_db
from app.models.instance import Instance
from app.models.series import Series

router = APIRouter()

PIXEL_CACHE_MAX_BYTES = 512 * 1024 * 1024
PIXEL_CACHE_MAX_ENTRIES = 6


@dataclass
class CachedPixelData:
    pixel_array: "numpy.ndarray"
    samples_per_pixel: int
    photometric_interpretation: str | None
    rescale_slope: float | None
    rescale_intercept: float | None


_pixel_cache: "OrderedDict[str, CachedPixelData]" = OrderedDict()
_pixel_cache_bytes = 0
_pixel_cache_lock = threading.Lock()


def _get_cached_pixel_data(file_path: str) -> CachedPixelData | None:
    with _pixel_cache_lock:
        cached = _pixel_cache.get(file_path)
        if cached:
            _pixel_cache.move_to_end(file_path)
        return cached


def _set_cached_pixel_data(file_path: str, payload: CachedPixelData) -> None:
    global _pixel_cache_bytes

    data_bytes = int(payload.pixel_array.nbytes)
    if data_bytes > PIXEL_CACHE_MAX_BYTES:
        return

    with _pixel_cache_lock:
        existing = _pixel_cache.pop(file_path, None)
        if existing:
            _pixel_cache_bytes -= int(existing.pixel_array.nbytes)

        while _pixel_cache and (
            len(_pixel_cache) >= PIXEL_CACHE_MAX_ENTRIES
            or _pixel_cache_bytes + data_bytes > PIXEL_CACHE_MAX_BYTES
        ):
            _, evicted = _pixel_cache.popitem(last=False)
            _pixel_cache_bytes -= int(evicted.pixel_array.nbytes)

        _pixel_cache[file_path] = payload
        _pixel_cache_bytes += data_bytes


def _load_pixel_data(file_path: str) -> CachedPixelData:
    cached = _get_cached_pixel_data(file_path)
    if cached:
        return cached

    import pydicom

    ds = pydicom.dcmread(file_path)
    pixel_data = ds.pixel_array
    payload = CachedPixelData(
        pixel_array=pixel_data,
        samples_per_pixel=getattr(ds, "SamplesPerPixel", 1),
        photometric_interpretation=getattr(ds, "PhotometricInterpretation", None),
        rescale_slope=getattr(ds, "RescaleSlope", None),
        rescale_intercept=getattr(ds, "RescaleIntercept", None),
    )
    _set_cached_pixel_data(file_path, payload)
    return payload


def _normalize_color_layout(pixel_data, samples_per_pixel: int):
    """Ensure color data uses channel-last layout."""
    import numpy as np

    if samples_per_pixel <= 1:
        return pixel_data
    if pixel_data.ndim == 3:
        if pixel_data.shape[0] in (3, 4) and pixel_data.shape[-1] not in (3, 4):
            return np.moveaxis(pixel_data, 0, -1)
    if pixel_data.ndim == 4:
        if pixel_data.shape[1] in (3, 4) and pixel_data.shape[-1] not in (3, 4):
            return np.moveaxis(pixel_data, 1, -1)
    return pixel_data


class InstanceMetadata(BaseModel):
    """DICOM instance metadata."""

    sop_instance_uid: str = Field(..., description="Unique instance identifier")
    sop_class_uid: str = Field(..., description="SOP class UID")
    series_instance_uid: str = Field(..., description="Parent series UID")
    study_instance_uid: str = Field(..., description="Parent study UID")
    instance_number: int | None = Field(None, description="Instance number")
    rows: int | None = Field(None, description="Image rows")
    columns: int | None = Field(None, description="Image columns")
    bits_allocated: int | None = Field(16, description="Bits allocated per pixel")
    bits_stored: int | None = Field(12, description="Bits stored per pixel")
    photometric_interpretation: str | None = Field(
        "MONOCHROME2", description="Photometric interpretation"
    )
    pixel_spacing: tuple[float, float] | None = Field(None, description="Pixel spacing (row, col)")
    slice_thickness: float | None = Field(None, description="Slice thickness in mm")
    slice_location: float | None = Field(None, description="Slice location")
    image_position_patient: tuple[float, float, float] | None = Field(
        None, description="Image position"
    )
    window_center: float | None = Field(None, description="Window center")
    window_width: float | None = Field(None, description="Window width")
    rescale_intercept: float = Field(0.0, description="Rescale intercept")
    rescale_slope: float = Field(1.0, description="Rescale slope")
    number_of_frames: int = Field(1, description="Number of frames for multi-frame instances")
    image_orientation_patient: tuple[float, float, float, float, float, float] | None = Field(
        None, description="Image orientation patient (row/col direction cosines)"
    )

    class Config:
        from_attributes = True


class PixelDataInfo(BaseModel):
    """Pixel data information."""

    sop_instance_uid: str
    rows: int
    columns: int
    bits_allocated: int
    pixel_representation: int
    samples_per_pixel: int
    transfer_syntax_uid: str
    is_compressed: bool
    frame_count: int


def _instance_to_metadata(instance: Instance, series: Series) -> InstanceMetadata:
    """Convert Instance model to InstanceMetadata response."""
    return InstanceMetadata(
        sop_instance_uid=instance.sop_instance_uid,
        sop_class_uid=instance.sop_class_uid,
        series_instance_uid=instance.series_instance_uid_fk,
        study_instance_uid=series.study_instance_uid_fk,
        instance_number=instance.instance_number,
        rows=instance.rows,
        columns=instance.columns,
        bits_allocated=instance.bits_allocated,
        bits_stored=instance.bits_stored,
        photometric_interpretation=instance.photometric_interpretation,
        pixel_spacing=instance.pixel_spacing_tuple,
        slice_thickness=instance.slice_thickness,
        slice_location=instance.slice_location,
        image_position_patient=instance.image_position_tuple,
        window_center=instance.window_center,
        window_width=instance.window_width,
        rescale_intercept=instance.rescale_intercept or 0.0,
        rescale_slope=instance.rescale_slope or 1.0,
        number_of_frames=instance.number_of_frames or 1,
        image_orientation_patient=instance.image_orientation_tuple,
    )


@router.get("/{instance_uid}", response_model=InstanceMetadata)
async def get_instance(
    instance_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> InstanceMetadata:
    """Get instance metadata.

    Returns DICOM header information for the specified instance.
    """
    query = (
        select(Instance)
        .options(selectinload(Instance.series))
        .where(Instance.sop_instance_uid == instance_uid)
    )
    result = await db.execute(query)
    instance = result.scalar_one_or_none()

    if not instance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance not found: {instance_uid}",
        )

    return _instance_to_metadata(instance, instance.series)


@router.get("/{instance_uid}/pixel-data", response_class=Response)
async def get_pixel_data(
    instance_uid: str,
    request: Request,
    current_user: Annotated[TokenData, Depends(get_current_active_user_from_token)],
    db: Annotated[AsyncSession, Depends(get_db)],
    format: str = Query("raw", enum=["raw", "png", "jpeg"], description="Output format"),
    quality: int = Query(90, ge=1, le=100, description="JPEG quality"),
    window_center: float | None = Query(None, description="Override window center"),
    window_width: float | None = Query(None, description="Override window width"),
    frame: int | None = Query(None, ge=0, description="Frame index for multi-frame instances"),
) -> Response:
    """Get instance pixel data.

    Returns the image data in the requested format.
    Supports windowing parameters for display optimization.
    """
    import numpy as np
    from PIL import Image

    # Get instance from database
    query = select(Instance).where(Instance.sop_instance_uid == instance_uid)
    result = await db.execute(query)
    instance = result.scalar_one_or_none()

    if not instance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance not found: {instance_uid}",
        )

    # Get pixel data from stored DICOM file
    settings = get_settings()
    payload = None
    if instance.file_path and Path(instance.file_path).exists():
        try:
            payload = _load_pixel_data(instance.file_path)
            pixel_data = payload.pixel_array
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Unsupported transfer syntax or pixel data decoding failed",
            ) from exc
    else:
        if not settings.enable_demo_data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="DICOM file not available on server",
            )
        # Generate synthetic data if demo mode is explicitly enabled
        rows = instance.rows or 512
        cols = instance.columns or 512
        x = np.linspace(0, 1, cols)
        y = np.linspace(0, 1, rows)
        xx, yy = np.meshgrid(x, y)
        pixel_data = ((np.sin(xx * 10) * np.cos(yy * 10) + 1) * 2000 - 1024).astype(
            np.float32
        )

    samples_per_pixel = instance.samples_per_pixel or (payload.samples_per_pixel if payload else 1)
    is_color = samples_per_pixel > 1 or (
        pixel_data.ndim in (3, 4) and pixel_data.shape[-1] in (3, 4)
    )
    if is_color and pixel_data.ndim == 2:
        is_color = False
    if is_color:
        pixel_data = _normalize_color_layout(pixel_data, samples_per_pixel)

    if (
        not is_color
        and payload
        and payload.rescale_slope is not None
        and payload.rescale_intercept is not None
    ):
        pixel_data = pixel_data * payload.rescale_slope + payload.rescale_intercept

    # Handle multi-frame instances
    if pixel_data.ndim == 4 and is_color:
        frame_count = pixel_data.shape[0]
        frame_index = frame if frame is not None else 0
        if frame_index < 0 or frame_index >= frame_count:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Frame index out of range (0-{frame_count - 1})",
            )
        pixel_data = pixel_data[frame_index]
    elif pixel_data.ndim > 2 and not is_color:
        frame_count = pixel_data.shape[0]
        frame_index = frame if frame is not None else 0
        if frame_index < 0 or frame_index >= frame_count:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Frame index out of range (0-{frame_count - 1})",
            )
        pixel_data = pixel_data[frame_index]
    elif frame not in (None, 0):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Frame index provided for single-frame instance",
        )

    # pydicom 3.x returns RGB for YBR photometric interpretations by default.

    # Get windowing parameters
    wc = window_center if window_center is not None else (instance.window_center or 40)
    ww = window_width if window_width is not None else (instance.window_width or 400)

    rows = pixel_data.shape[0]
    cols = pixel_data.shape[1]

    if format == "raw":
        # Return raw pixel data
        if is_color:
            raw_array = pixel_data
            if raw_array.ndim == 3 and raw_array.shape[-1] > 3:
                raw_array = raw_array[:, :, :3]
            if raw_array.dtype != np.uint8:
                min_val = float(raw_array.min())
                max_val = float(raw_array.max())
                scale = max_val - min_val or 1.0
                raw_array = ((raw_array - min_val) / scale * 255).astype(np.uint8)
            raw_data = raw_array.tobytes()
        else:
            raw_data = pixel_data.astype(np.int16).tobytes()
        return Response(
            content=raw_data,
            media_type="application/octet-stream",
            headers={
                "Cache-Control": "private, max-age=3600",
                "X-Rows": str(rows),
                "X-Columns": str(cols),
                "X-Bits-Allocated": str(instance.bits_allocated or 16),
                "X-Window-Center": str(wc),
                "X-Window-Width": str(ww),
                "X-Frame-Count": str(instance.number_of_frames or 1),
                "X-Frame-Index": str(frame or 0),
            },
        )

    if is_color:
        display_data = pixel_data
        if display_data.ndim == 3 and display_data.shape[-1] > 3:
            display_data = display_data[:, :, :3]
        if display_data.dtype != np.uint8:
            min_val = float(display_data.min())
            max_val = float(display_data.max())
            scale = max_val - min_val or 1.0
            display_data = ((display_data - min_val) / scale * 255).astype(np.uint8)
        img = Image.fromarray(display_data, mode="RGB")
    else:
        # Apply window/level for display
        min_val = wc - ww / 2
        max_val = wc + ww / 2
        display_data = np.clip(pixel_data, min_val, max_val)
        display_data = ((display_data - min_val) / (max_val - min_val) * 255).astype(np.uint8)
        img = Image.fromarray(display_data, mode="L")

    # Save to buffer
    buffer = BytesIO()
    if format == "png":
        img.save(buffer, format="PNG")
        media_type = "image/png"
    else:
        img.save(buffer, format="JPEG", quality=quality)
        media_type = "image/jpeg"

    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.get("/{instance_uid}/thumbnail", response_class=Response)
async def get_thumbnail(
    instance_uid: str,
    request: Request,
    current_user: Annotated[TokenData, Depends(get_current_active_user_from_token)],
    db: Annotated[AsyncSession, Depends(get_db)],
    size: int = Query(128, ge=32, le=512, description="Thumbnail size"),
) -> Response:
    """Get instance thumbnail.

    Returns a small preview image for quick display in study browsers.
    """
    import numpy as np
    from PIL import Image

    # Get instance from database
    query = select(Instance).where(Instance.sop_instance_uid == instance_uid)
    result = await db.execute(query)
    instance = result.scalar_one_or_none()

    if not instance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance not found: {instance_uid}",
        )

    # Get pixel data and create thumbnail
    settings = get_settings()
    if instance.file_path and Path(instance.file_path).exists():
        try:
            payload = _load_pixel_data(instance.file_path)
            pixel_data = payload.pixel_array
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Unsupported transfer syntax or pixel data decoding failed",
            ) from exc

        samples_per_pixel = instance.samples_per_pixel or (payload.samples_per_pixel if payload else 1)
        is_color = samples_per_pixel > 1 or (
            pixel_data.ndim in (3, 4) and pixel_data.shape[-1] in (3, 4)
        )
        if is_color and pixel_data.ndim == 2:
            is_color = False
        if is_color:
            pixel_data = _normalize_color_layout(pixel_data, samples_per_pixel)

        if pixel_data.ndim == 4 and is_color:
            pixel_data = pixel_data[0]
        elif pixel_data.ndim > 2 and not is_color:
            pixel_data = pixel_data[0]

        # pydicom 3.x returns RGB for YBR photometric interpretations by default.

        if (
            not is_color
            and payload
            and payload.rescale_slope is not None
            and payload.rescale_intercept is not None
        ):
            pixel_data = pixel_data * payload.rescale_slope + payload.rescale_intercept

        if is_color:
            display_data = pixel_data
            if display_data.ndim == 3 and display_data.shape[-1] > 3:
                display_data = display_data[:, :, :3]
            if display_data.dtype != np.uint8:
                min_val = float(display_data.min())
                max_val = float(display_data.max())
                scale = max_val - min_val or 1.0
                display_data = ((display_data - min_val) / scale * 255).astype(np.uint8)
            img = Image.fromarray(display_data, mode="RGB")
        else:
            wc = instance.window_center or 40
            ww = instance.window_width or 400
            min_val = wc - ww / 2
            max_val = wc + ww / 2
            scale = max_val - min_val or 1.0
            display_data = np.clip(pixel_data, min_val, max_val)
            display_data = ((display_data - min_val) / scale * 255).astype(np.uint8)
            img = Image.fromarray(display_data, mode="L")
    else:
        if not settings.enable_demo_data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="DICOM file not available on server",
            )
        # Generate synthetic thumbnail if demo mode is explicitly enabled
        x = np.linspace(0, 1, size)
        y = np.linspace(0, 1, size)
        xx, yy = np.meshgrid(x, y)
        display_data = ((np.sin(xx * 10) * np.cos(yy * 10) + 1) * 127).astype(np.uint8)
        img = Image.fromarray(display_data, mode="L")

    # Create and resize thumbnail
    img.thumbnail((size, size), Image.Resampling.LANCZOS)

    buffer = BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.get("/{instance_uid}/pixel-info", response_model=PixelDataInfo)
async def get_pixel_info(
    instance_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PixelDataInfo:
    """Get pixel data information.

    Returns technical details about the pixel data format.
    """
    query = select(Instance).where(Instance.sop_instance_uid == instance_uid)
    result = await db.execute(query)
    instance = result.scalar_one_or_none()

    if not instance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance not found: {instance_uid}",
        )

    # Determine if compressed
    is_compressed = False
    if instance.transfer_syntax_uid:
        # Common uncompressed transfer syntaxes
        uncompressed = [
            "1.2.840.10008.1.2",  # Implicit VR Little Endian
            "1.2.840.10008.1.2.1",  # Explicit VR Little Endian
            "1.2.840.10008.1.2.2",  # Explicit VR Big Endian
        ]
        is_compressed = instance.transfer_syntax_uid not in uncompressed

    return PixelDataInfo(
        sop_instance_uid=instance_uid,
        rows=instance.rows or 512,
        columns=instance.columns or 512,
        bits_allocated=instance.bits_allocated or 16,
        pixel_representation=instance.pixel_representation or 1,
        samples_per_pixel=instance.samples_per_pixel or 1,
        transfer_syntax_uid=instance.transfer_syntax_uid or "1.2.840.10008.1.2.1",
        is_compressed=is_compressed,
        frame_count=instance.number_of_frames or 1,
    )


@router.get("/{instance_uid}/tags")
async def get_dicom_tags(
    instance_uid: str,
    request: Request,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    include_private: bool = Query(False, description="Include private tags"),
) -> dict:
    """Get all DICOM tags for an instance.

    Returns the complete DICOM header as a dictionary.
    """
    query = (
        select(Instance)
        .options(selectinload(Instance.series))
        .where(Instance.sop_instance_uid == instance_uid)
    )
    result = await db.execute(query)
    instance = result.scalar_one_or_none()

    if not instance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance not found: {instance_uid}",
        )

    # If file exists, read actual tags
    if instance.file_path and Path(instance.file_path).exists():
        import pydicom

        ds = pydicom.dcmread(instance.file_path, stop_before_pixels=True)

        tags = {}
        for elem in ds:
            if elem.tag.is_private and not include_private:
                continue
            tag_str = f"({elem.tag.group:04X},{elem.tag.element:04X})"
            tags[tag_str] = {
                "vr": elem.VR,
                "name": elem.keyword,
                "value": str(elem.value) if elem.value is not None else None,
            }

        return {"instance_uid": instance_uid, "tags": tags}

    # Return basic tags from database
    tags = {
        "(0008,0016)": {"vr": "UI", "name": "SOPClassUID", "value": instance.sop_class_uid},
        "(0008,0018)": {"vr": "UI", "name": "SOPInstanceUID", "value": instance_uid},
        "(0020,000D)": {
            "vr": "UI",
            "name": "StudyInstanceUID",
            "value": instance.series.study_instance_uid_fk if instance.series else None,
        },
        "(0020,000E)": {
            "vr": "UI",
            "name": "SeriesInstanceUID",
            "value": instance.series_instance_uid_fk,
        },
        "(0020,0013)": {
            "vr": "IS",
            "name": "InstanceNumber",
            "value": str(instance.instance_number) if instance.instance_number else None,
        },
        "(0028,0010)": {"vr": "US", "name": "Rows", "value": instance.rows},
        "(0028,0011)": {"vr": "US", "name": "Columns", "value": instance.columns},
        "(0028,0100)": {"vr": "US", "name": "BitsAllocated", "value": instance.bits_allocated},
        "(0028,0101)": {"vr": "US", "name": "BitsStored", "value": instance.bits_stored},
        "(0028,0004)": {
            "vr": "CS",
            "name": "PhotometricInterpretation",
            "value": instance.photometric_interpretation,
        },
        "(0028,1050)": {"vr": "DS", "name": "WindowCenter", "value": instance.window_center},
        "(0028,1051)": {"vr": "DS", "name": "WindowWidth", "value": instance.window_width},
        "(0028,1052)": {
            "vr": "DS",
            "name": "RescaleIntercept",
            "value": instance.rescale_intercept or 0,
        },
        "(0028,1053)": {"vr": "DS", "name": "RescaleSlope", "value": instance.rescale_slope or 1},
    }

    return {"instance_uid": instance_uid, "tags": tags}


@router.get("/{instance_uid}/dicom")
async def get_dicom_file(
    instance_uid: str,
    request: Request,
    current_user: Annotated[TokenData, Depends(get_current_active_user_from_token)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    """Download the original DICOM file.

    Returns the complete DICOM file for the specified instance.
    """
    query = select(Instance).where(Instance.sop_instance_uid == instance_uid)
    result = await db.execute(query)
    instance = result.scalar_one_or_none()

    if not instance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance not found: {instance_uid}",
        )

    if not instance.file_path or not Path(instance.file_path).exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="DICOM file not found on storage",
        )

    # Read and return file
    with open(instance.file_path, "rb") as f:
        content = f.read()

    return Response(
        content=content,
        media_type="application/dicom",
        headers={
            "Content-Disposition": f"attachment; filename={instance_uid}.dcm",
        },
    )
