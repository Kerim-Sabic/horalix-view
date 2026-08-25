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

# Decoded pixel arrays, keyed by file path. The byte ceiling is the real
# constraint; the entry count only exists to bound bookkeeping. It used to be 16,
# which meant a reading session with more open cines than that evicted the
# earliest one -- and scrubbing back to it re-decoded the entire multi-frame
# array. Echo clips are small enough that the byte ceiling binds first.
PIXEL_CACHE_MAX_BYTES = 512 * 1024 * 1024
PIXEL_CACHE_MAX_ENTRIES = 256

# Encoded PNG/JPEG frames, keyed by instance, frame, format and window/level.
RENDER_CACHE_MAX_BYTES = 256 * 1024 * 1024
RENDER_CACHE_MAX_ENTRIES = 2048


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

_render_cache: "OrderedDict[str, bytes]" = OrderedDict()
_render_cache_bytes = 0
_render_cache_lock = threading.Lock()


# One lock per file being decoded, so parallel requests for the same clip wait
# on the first decode instead of repeating it.
_decode_locks: dict[str, threading.Lock] = {}
_decode_locks_guard = threading.Lock()


def _get_decode_lock(file_path: str) -> threading.Lock:
    with _decode_locks_guard:
        lock = _decode_locks.get(file_path)
        if lock is None:
            lock = threading.Lock()
            _decode_locks[file_path] = lock
            # Bound the map; these are cheap but should not grow without limit.
            if len(_decode_locks) > 512:
                for stale in [k for k in list(_decode_locks) if k != file_path][:256]:
                    _decode_locks.pop(stale, None)
        return lock


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


def _get_cached_render(cache_key: str) -> bytes | None:
    with _render_cache_lock:
        cached = _render_cache.get(cache_key)
        if cached:
            _render_cache.move_to_end(cache_key)
        return cached


def _set_cached_render(cache_key: str, payload: bytes) -> None:
    global _render_cache_bytes

    data_bytes = len(payload)
    if data_bytes > RENDER_CACHE_MAX_BYTES:
        return

    with _render_cache_lock:
        existing = _render_cache.pop(cache_key, None)
        if existing:
            _render_cache_bytes -= len(existing)

        while _render_cache and (
            len(_render_cache) >= RENDER_CACHE_MAX_ENTRIES
            or _render_cache_bytes + data_bytes > RENDER_CACHE_MAX_BYTES
        ):
            _, evicted = _render_cache.popitem(last=False)
            _render_cache_bytes -= len(evicted)

        _render_cache[cache_key] = payload
        _render_cache_bytes += data_bytes


def _load_pixel_data(file_path: str) -> CachedPixelData:
    cached = _get_cached_pixel_data(file_path)
    if cached:
        return cached

    # Single-flight: the viewer prefetches a cine with several requests in
    # parallel, and every one of them lands on the same file. Without this lock
    # each would decode the whole multi-frame array independently -- the same
    # expensive work, N times over, for one clip.
    lock = _get_decode_lock(file_path)
    with lock:
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
    pixel_spacing: tuple[float, float] | None = Field(
        None, description="Millimetres per pixel (row, col). None when uncalibrated."
    )
    pixel_spacing_source: str = Field(
        "none",
        description=(
            "How pixel_spacing was resolved: pixel_spacing, ultrasound_region, "
            "imager_pixel_spacing, or none. 'none' means the image is not "
            "spatially calibrated and must not be measured in millimetres."
        ),
    )
    ultrasound_region: tuple[int, int, int, int] | None = Field(
        None, description="Calibrated region bounds (minX, minY, maxX, maxY) in pixels"
    )
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
        pixel_spacing_source=instance.pixel_spacing_source or "none",
        ultrasound_region=instance.ultrasound_region_tuple,
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

    # Get pixel data from stored DICOM file (run in thread pool to avoid
    # blocking the async event loop during pydicom decode)
    import asyncio

    settings = get_settings()
    payload = None
    if instance.file_path and Path(instance.file_path).exists():
        try:
            loop = asyncio.get_running_loop()
            payload = await loop.run_in_executor(None, _load_pixel_data, instance.file_path)
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
    frame_index = frame if frame is not None else 0

    # pydicom 3.x returns RGB for YBR photometric interpretations by default.

    # Get windowing parameters
    wc = window_center if window_center is not None else (instance.window_center or 40)
    ww = window_width if window_width is not None else (instance.window_width or 400)

    rows = pixel_data.shape[0]
    cols = pixel_data.shape[1]

    render_cache_key = None
    if format in ("png", "jpeg"):
        # Key on instance, frame, windowing, and output format/quality
        wc_key = f"{float(wc):.2f}"
        ww_key = f"{float(ww):.2f}"
        quality_key = str(quality if format == "jpeg" else 0)
        render_cache_key = f"{instance_uid}:{frame_index}:{format}:{quality_key}:{wc_key}:{ww_key}"
        cached = _get_cached_render(render_cache_key)
        if cached:
            media_type = "image/png" if format == "png" else "image/jpeg"
            return Response(
                content=cached,
                media_type=media_type,
                headers={"Cache-Control": "private, max-age=3600"},
            )

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
    content = buffer.getvalue()
    if render_cache_key:
        _set_cached_render(render_cache_key, content)
    return Response(
        content=content,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=3600"},
    )


# A tiled clip sheet is one decoded image in the browser, so it must stay inside
# the maximum image area browsers will allocate. 64 megapixels leaves generous
# headroom below the ~268 MP desktop ceiling and the much lower mobile one,
# while still holding a typical echo cine at full resolution.
CLIP_MAX_SHEET_PIXELS = 64 * 1024 * 1024
CLIP_MAX_FRAMES = 240


def _window_to_uint8(frame, wc: float, ww: float):
    """Apply window/level to one grayscale frame."""
    import numpy as np

    low = wc - ww / 2
    high = wc + ww / 2
    span = high - low
    if span <= 0:
        span = 1.0
    windowed = np.clip(frame, low, high)
    return ((windowed - low) / span * 255).astype(np.uint8)


def _color_to_uint8(frame):
    """Normalise one colour frame to 8-bit RGB."""
    import numpy as np

    data = frame
    if data.ndim == 3 and data.shape[-1] > 3:
        data = data[:, :, :3]
    if data.dtype != np.uint8:
        min_val = float(data.min())
        max_val = float(data.max())
        scale = max_val - min_val or 1.0
        data = ((data - min_val) / scale * 255).astype(np.uint8)
    return data


@router.get("/{instance_uid}/clip", response_class=Response)
async def get_clip_sheet(
    instance_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user_from_token)],
    db: Annotated[AsyncSession, Depends(get_db)],
    format: str = Query("jpeg", enum=["png", "jpeg"], description="Output format"),
    quality: int = Query(85, ge=1, le=100, description="JPEG quality"),
    window_center: float | None = Query(None, description="Override window center"),
    window_width: float | None = Query(None, description="Override window width"),
    max_frames: int | None = Query(None, ge=1, le=CLIP_MAX_FRAMES),
) -> Response:
    """Return an entire multi-frame instance as one tiled image.

    The per-frame pixel-data route costs one HTTP round trip per displayed
    frame, and each request decodes the whole multi-frame array to slice out a
    single frame -- a sixty-frame cine is sixty requests against one file. This
    route answers with every frame laid out in a grid, so the viewer fetches and
    decodes once and then scrubs entirely in the client.

    Frames are tiled left to right, top to bottom. The grid geometry travels in
    headers rather than a JSON envelope so the body stays a plain image the
    browser decodes natively:

      X-Frame-Count    frames in the sheet
      X-Grid-Columns   tiles per row
      X-Frame-Width    tile width in pixels
      X-Frame-Height   tile height in pixels
      X-Frame-Scale    tile size relative to the source frame (1.0 = full)
      X-Source-Frames  frames in the instance, before any cap
    """
    import asyncio
    import math

    import numpy as np
    from PIL import Image

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
            detail="DICOM file not available on server",
        )

    loop = asyncio.get_running_loop()
    try:
        payload = await loop.run_in_executor(None, _load_pixel_data, instance.file_path)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Unsupported transfer syntax or pixel data decoding failed",
        ) from exc

    pixel_data = payload.pixel_array
    samples_per_pixel = instance.samples_per_pixel or payload.samples_per_pixel or 1
    is_color = samples_per_pixel > 1 or (
        pixel_data.ndim in (3, 4) and pixel_data.shape[-1] in (3, 4)
    )
    if is_color and pixel_data.ndim == 2:
        is_color = False
    if is_color:
        pixel_data = _normalize_color_layout(pixel_data, samples_per_pixel)

    # Establish the frame axis.
    if is_color:
        frames = pixel_data if pixel_data.ndim == 4 else pixel_data[np.newaxis, ...]
    else:
        frames = pixel_data if pixel_data.ndim == 3 else pixel_data[np.newaxis, ...]

    source_frame_count = int(frames.shape[0])
    if source_frame_count < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Instance is not multi-frame; use the pixel-data route",
        )

    frame_count = min(source_frame_count, max_frames or CLIP_MAX_FRAMES)
    frames = frames[:frame_count]

    if (
        not is_color
        and payload.rescale_slope is not None
        and payload.rescale_intercept is not None
    ):
        frames = frames * payload.rescale_slope + payload.rescale_intercept

    frame_height = int(frames.shape[1])
    frame_width = int(frames.shape[2])

    # A near-square grid, so neither side approaches the browser's per-side
    # limit before the total-area limit binds.
    columns = max(1, int(math.ceil(math.sqrt(frame_count))))
    rows = int(math.ceil(frame_count / columns))

    # Downscale uniformly if the sheet would exceed the pixel budget.
    scale = 1.0
    sheet_pixels = columns * frame_width * rows * frame_height
    if sheet_pixels > CLIP_MAX_SHEET_PIXELS:
        scale = math.sqrt(CLIP_MAX_SHEET_PIXELS / sheet_pixels)
        frame_width = max(1, int(frame_width * scale))
        frame_height = max(1, int(frame_height * scale))

    wc = window_center if window_center is not None else (instance.window_center or 40)
    ww = window_width if window_width is not None else (instance.window_width or 400)

    cache_key = (
        f"clip:{instance_uid}:{frame_count}:{format}:{quality if format == 'jpeg' else 0}:"
        f"{float(wc):.2f}:{float(ww):.2f}:{frame_width}x{frame_height}"
    )
    cached = _get_cached_render(cache_key)
    if cached is None:
        mode = "RGB" if is_color else "L"
        sheet = Image.new(mode, (columns * frame_width, rows * frame_height))

        for index in range(frame_count):
            frame = frames[index]
            data = _color_to_uint8(frame) if is_color else _window_to_uint8(frame, wc, ww)
            tile = Image.fromarray(data, mode=mode)
            if scale != 1.0:
                tile = tile.resize((frame_width, frame_height), Image.BILINEAR)
            sheet.paste(
                tile,
                ((index % columns) * frame_width, (index // columns) * frame_height),
            )

        buffer = BytesIO()
        if format == "png":
            sheet.save(buffer, format="PNG")
        else:
            # No chroma subsampling: the tile grid has hard edges between
            # frames, and 4:2:0 would bleed one frame into its neighbour.
            sheet.save(buffer, format="JPEG", quality=quality, subsampling=0)
        cached = buffer.getvalue()
        _set_cached_render(cache_key, cached)

    return Response(
        content=cached,
        media_type="image/png" if format == "png" else "image/jpeg",
        headers={
            "Cache-Control": "private, max-age=3600",
            "X-Frame-Count": str(frame_count),
            "X-Grid-Columns": str(columns),
            "X-Frame-Width": str(frame_width),
            "X-Frame-Height": str(frame_height),
            "X-Frame-Scale": f"{scale:.6f}",
            "X-Source-Frames": str(source_frame_count),
        },
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

    # Get pixel data and create thumbnail (thread pool for pydicom decode)
    import asyncio

    settings = get_settings()
    if instance.file_path and Path(instance.file_path).exists():
        try:
            loop = asyncio.get_running_loop()
            payload = await loop.run_in_executor(None, _load_pixel_data, instance.file_path)
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
