"""Instance management endpoints for Horalix View.

Handles individual DICOM instances (images) including pixel data retrieval,
metadata access, and image manipulation.
"""

from io import BytesIO
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints.auth import get_current_active_user
from app.core.security import TokenData
from app.models.base import get_db
from app.models.instance import Instance
from app.models.series import Series

router = APIRouter()


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
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    format: str = Query("raw", enum=["raw", "png", "jpeg"], description="Output format"),
    quality: int = Query(90, ge=1, le=100, description="JPEG quality"),
    window_center: float | None = Query(None, description="Override window center"),
    window_width: float | None = Query(None, description="Override window width"),
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
    if instance.file_path and Path(instance.file_path).exists():
        import pydicom

        ds = pydicom.dcmread(instance.file_path)
        pixel_data = ds.pixel_array

        # Apply rescale
        if hasattr(ds, "RescaleSlope") and hasattr(ds, "RescaleIntercept"):
            pixel_data = pixel_data * ds.RescaleSlope + ds.RescaleIntercept
    else:
        # Generate synthetic data if file not available
        rows = instance.rows or 512
        cols = instance.columns or 512
        x = np.linspace(0, 1, cols)
        y = np.linspace(0, 1, rows)
        xx, yy = np.meshgrid(x, y)
        pixel_data = ((np.sin(xx * 10) * np.cos(yy * 10) + 1) * 2000 - 1024).astype(np.float32)

    # Get windowing parameters
    wc = window_center if window_center is not None else (instance.window_center or 40)
    ww = window_width if window_width is not None else (instance.window_width or 400)

    rows = pixel_data.shape[0]
    cols = pixel_data.shape[1]

    if format == "raw":
        # Return raw pixel data
        raw_data = pixel_data.astype(np.int16).tobytes()
        return Response(
            content=raw_data,
            media_type="application/octet-stream",
            headers={
                "X-Rows": str(rows),
                "X-Columns": str(cols),
                "X-Bits-Allocated": str(instance.bits_allocated or 16),
                "X-Window-Center": str(wc),
                "X-Window-Width": str(ww),
            },
        )
    # Apply window/level for display
    min_val = wc - ww / 2
    max_val = wc + ww / 2
    display_data = np.clip(pixel_data, min_val, max_val)
    display_data = ((display_data - min_val) / (max_val - min_val) * 255).astype(np.uint8)

    # Create PIL image
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
    return StreamingResponse(buffer, media_type=media_type)


@router.get("/{instance_uid}/thumbnail", response_class=Response)
async def get_thumbnail(
    instance_uid: str,
    request: Request,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
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
    if instance.file_path and Path(instance.file_path).exists():
        import pydicom

        ds = pydicom.dcmread(instance.file_path)
        pixel_data = ds.pixel_array.astype(np.float32)

        # Apply rescale
        if hasattr(ds, "RescaleSlope") and hasattr(ds, "RescaleIntercept"):
            pixel_data = pixel_data * ds.RescaleSlope + ds.RescaleIntercept

        # Apply default windowing
        wc = instance.window_center or 40
        ww = instance.window_width or 400
        min_val = wc - ww / 2
        max_val = wc + ww / 2
        display_data = np.clip(pixel_data, min_val, max_val)
        display_data = ((display_data - min_val) / (max_val - min_val) * 255).astype(np.uint8)
    else:
        # Generate synthetic thumbnail
        x = np.linspace(0, 1, size)
        y = np.linspace(0, 1, size)
        xx, yy = np.meshgrid(x, y)
        display_data = ((np.sin(xx * 10) * np.cos(yy * 10) + 1) * 127).astype(np.uint8)

    # Create and resize thumbnail
    img = Image.fromarray(display_data, mode="L")
    img.thumbnail((size, size), Image.Resampling.LANCZOS)

    buffer = BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)

    return StreamingResponse(buffer, media_type="image/png")


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
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
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
