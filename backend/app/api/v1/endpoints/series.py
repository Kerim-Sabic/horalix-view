"""Series management endpoints for Horalix View.

Provides endpoints for retrieving and managing DICOM series.
"""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints.auth import (
    get_current_active_user,
    get_current_active_user_from_token,
    require_roles,
)
from app.core.logging import audit_logger
from app.core.security import TokenData
from app.models.base import get_db
from app.models.instance import Instance
from app.models.series import Series

router = APIRouter()


class InstanceSummary(BaseModel):
    """Instance summary within a series."""

    sop_instance_uid: str
    instance_number: int | None
    sop_class_uid: str
    rows: int | None
    columns: int | None
    bits_allocated: int | None
    number_of_frames: int | None = None

    class Config:
        from_attributes = True


class SeriesMetadata(BaseModel):
    """DICOM series metadata."""

    series_instance_uid: str = Field(..., description="Unique series identifier")
    study_instance_uid: str = Field(..., description="Parent study UID")
    series_number: int | None = Field(None, description="Series number")
    series_description: str | None = Field(None, description="Series description")
    modality: str = Field(..., description="Series modality")
    series_date: str | None = Field(None, description="Series date")
    series_time: str | None = Field(None, description="Series time")
    body_part_examined: str | None = Field(None, description="Body part")
    patient_position: str | None = Field(None, description="Patient position")
    protocol_name: str | None = Field(None, description="Protocol name")
    num_instances: int = Field(0, description="Number of instances")
    slice_thickness: float | None = Field(None, description="Slice thickness in mm")
    spacing_between_slices: float | None = Field(None, description="Spacing between slices")

    class Config:
        from_attributes = True


class SeriesUpdate(BaseModel):
    """Editable series metadata fields."""

    series_number: int | None = Field(None, description="Series number")
    series_description: str | None = Field(None, description="Series description")
    body_part_examined: str | None = Field(None, description="Body part")
    patient_position: str | None = Field(None, description="Patient position")
    protocol_name: str | None = Field(None, description="Protocol name")
    slice_thickness: float | None = Field(None, description="Slice thickness in mm")
    spacing_between_slices: float | None = Field(None, description="Spacing between slices")
    window_center: float | None = Field(None, description="Default window center")
    window_width: float | None = Field(None, description="Default window width")


class SeriesListResponse(BaseModel):
    """Series list response."""

    total: int
    series: list[SeriesMetadata]


class SeriesDetailResponse(BaseModel):
    """Detailed series response."""

    series: SeriesMetadata
    instances: list[InstanceSummary]
    window_center: float | None = None
    window_width: float | None = None
    has_3d_data: bool = False


class TrackPoint(BaseModel):
    x: float
    y: float


class TrackMeasurementRequest(BaseModel):
    start_index: int = Field(0, ge=0, description="Start frame index in series order")
    max_frames: int | None = Field(None, ge=1, description="Optional maximum frames to track")
    track_full_loop: bool = Field(
        True, description="Track backwards and forwards to cover the full cine loop"
    )
    points: list[TrackPoint] = Field(..., min_length=2, max_length=2)


class TrackMeasurementFrame(BaseModel):
    frame_index: int
    points: list[TrackPoint]
    length_mm: float | None = None
    valid: bool = True


class TrackMeasurementSummary(BaseModel):
    min_mm: float | None = None
    max_mm: float | None = None
    mean_mm: float | None = None


class TrackMeasurementResponse(BaseModel):
    series_uid: str
    total_frames: int
    frames: list[TrackMeasurementFrame]
    summary: TrackMeasurementSummary


def _series_to_metadata(series: Series) -> SeriesMetadata:
    """Convert Series model to SeriesMetadata response."""
    return SeriesMetadata(
        series_instance_uid=series.series_instance_uid,
        study_instance_uid=series.study_instance_uid_fk,
        series_number=series.series_number,
        series_description=series.series_description,
        modality=series.modality,
        series_date=series.series_date.isoformat() if series.series_date else None,
        series_time=series.series_time.strftime("%H:%M:%S") if series.series_time else None,
        body_part_examined=series.body_part_examined,
        patient_position=series.patient_position,
        protocol_name=series.protocol_name,
        num_instances=series.num_instances,
        slice_thickness=series.slice_thickness,
        spacing_between_slices=series.spacing_between_slices,
    )


def _normalize_optional_str(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


@router.get("", response_model=SeriesListResponse)
async def list_series(
    current_user: Annotated[TokenData, Depends(get_current_active_user_from_token)],
    db: Annotated[AsyncSession, Depends(get_db)],
    study_uid: str | None = Query(None, description="Filter by study UID"),
    modality: str | None = Query(None, description="Filter by modality"),
) -> SeriesListResponse:
    """List series with optional filtering.

    Returns all series matching the specified criteria.
    """
    query = select(Series).order_by(Series.series_number)

    if study_uid:
        query = query.where(Series.study_instance_uid_fk == study_uid)

    if modality:
        query = query.where(Series.modality == modality)

    result = await db.execute(query)
    series_list = result.scalars().all()

    return SeriesListResponse(
        total=len(series_list),
        series=[_series_to_metadata(s) for s in series_list],
    )


@router.get("/{series_uid}", response_model=SeriesDetailResponse)
async def get_series(
    series_uid: str,
    current_user: Annotated[
        TokenData, Depends(require_roles("admin", "technologist", "radiologist"))
    ],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SeriesDetailResponse:
    """Get detailed series information.

    Returns series metadata and instance list.
    """
    query = (
        select(Series)
        .options(selectinload(Series.instances))
        .where(Series.series_instance_uid == series_uid)
    )
    result = await db.execute(query)
    series = result.scalar_one_or_none()

    if not series:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Series not found: {series_uid}",
        )

    audit_logger.log_access(
        user_id=current_user.user_id,
        resource_type="series",
        resource_id=series_uid,
        action="VIEW",
    )

    # Build instance list
    instances = [
        InstanceSummary(
            sop_instance_uid=inst.sop_instance_uid,
            instance_number=inst.instance_number,
            sop_class_uid=inst.sop_class_uid,
            rows=inst.rows,
            columns=inst.columns,
            bits_allocated=inst.bits_allocated,
            number_of_frames=inst.number_of_frames,
        )
        for inst in sorted(series.instances, key=lambda i: i.instance_number or 0)
    ]

    return SeriesDetailResponse(
        series=_series_to_metadata(series),
        instances=instances,
        window_center=series.window_center,
        window_width=series.window_width,
        has_3d_data=series.modality in ["CT", "MR", "PT"],
    )


@router.patch("/{series_uid}", response_model=SeriesDetailResponse)
async def update_series(
    series_uid: str,
    payload: SeriesUpdate,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SeriesDetailResponse:
    """Update series metadata."""
    query = (
        select(Series)
        .options(selectinload(Series.instances))
        .where(Series.series_instance_uid == series_uid)
    )
    result = await db.execute(query)
    series = result.scalar_one_or_none()

    if not series:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Series not found: {series_uid}",
        )

    updated_fields: list[str] = []
    if payload.series_number is not None:
        series.series_number = payload.series_number
        updated_fields.append("series_number")
    if payload.series_description is not None:
        series.series_description = _normalize_optional_str(payload.series_description)
        updated_fields.append("series_description")
    if payload.body_part_examined is not None:
        series.body_part_examined = _normalize_optional_str(payload.body_part_examined)
        updated_fields.append("body_part_examined")
    if payload.patient_position is not None:
        series.patient_position = _normalize_optional_str(payload.patient_position)
        updated_fields.append("patient_position")
    if payload.protocol_name is not None:
        series.protocol_name = _normalize_optional_str(payload.protocol_name)
        updated_fields.append("protocol_name")
    if payload.slice_thickness is not None:
        series.slice_thickness = payload.slice_thickness
        updated_fields.append("slice_thickness")
    if payload.spacing_between_slices is not None:
        series.spacing_between_slices = payload.spacing_between_slices
        updated_fields.append("spacing_between_slices")
    if payload.window_center is not None:
        series.window_center = payload.window_center
        updated_fields.append("window_center")
    if payload.window_width is not None:
        series.window_width = payload.window_width
        updated_fields.append("window_width")

    await db.commit()
    await db.refresh(series)

    audit_logger.log_access(
        user_id=current_user.user_id,
        resource_type="series",
        resource_id=series_uid,
        action="UPDATE_METADATA",
        details={"fields": updated_fields},
    )

    instances = [
        InstanceSummary(
            sop_instance_uid=inst.sop_instance_uid,
            instance_number=inst.instance_number,
            sop_class_uid=inst.sop_class_uid,
            rows=inst.rows,
            columns=inst.columns,
            bits_allocated=inst.bits_allocated,
            number_of_frames=inst.number_of_frames,
        )
        for inst in sorted(series.instances, key=lambda i: i.instance_number or 0)
    ]

    return SeriesDetailResponse(
        series=_series_to_metadata(series),
        instances=instances,
        window_center=series.window_center,
        window_width=series.window_width,
        has_3d_data=series.modality in ["CT", "MR", "PT"],
    )


@router.get("/{series_uid}/frames")
async def get_series_frames(
    series_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    start: int = Query(0, ge=0, description="Start frame index"),
    count: int = Query(10, ge=1, le=100, description="Number of frames"),
) -> dict:
    """Get frame information for a series.

    Returns frame positions and metadata for efficient scrolling.
    """
    # Get series
    series_query = select(Series).where(Series.series_instance_uid == series_uid)
    series_result = await db.execute(series_query)
    series = series_result.scalar_one_or_none()

    if not series:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Series not found: {series_uid}",
        )

    # Get instances with pagination
    instances_query = (
        select(Instance)
        .where(Instance.series_instance_uid_fk == series_uid)
        .order_by(Instance.instance_number)
        .offset(start)
        .limit(count)
    )
    instances_result = await db.execute(instances_query)
    instances = instances_result.scalars().all()

    frames = []
    for i, inst in enumerate(instances):
        frames.append(
            {
                "index": start + i,
                "instance_uid": inst.sop_instance_uid,
                "position": inst.slice_location or (start + i) * (series.slice_thickness or 1.0),
                "slice_location": inst.slice_location,
            }
        )

    return {
        "series_uid": series_uid,
        "total_frames": series.num_instances,
        "start": start,
        "count": len(frames),
        "frames": frames,
    }


@router.get("/{series_uid}/volume-info")
async def get_volume_info(
    series_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Get 3D volume information for a series.

    Returns spatial information needed for MPR and volume rendering.
    """
    # Get series with first instance for spatial info
    series_query = (
        select(Series)
        .options(selectinload(Series.instances))
        .where(Series.series_instance_uid == series_uid)
    )
    series_result = await db.execute(series_query)
    series = series_result.scalar_one_or_none()

    if not series:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Series not found: {series_uid}",
        )

    if series.modality not in ["CT", "MR", "PT"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Series does not support 3D visualization",
        )

    # Get first instance for spatial information
    first_instance = next(
        (i for i in sorted(series.instances, key=lambda x: x.instance_number or 0)), None
    )

    # Parse pixel spacing
    pixel_spacing = series.pixel_spacing_tuple or (1.0, 1.0)

    # Parse image position from first instance
    origin = (0.0, 0.0, 0.0)
    if first_instance and first_instance.image_position_tuple:
        origin = first_instance.image_position_tuple

    return {
        "series_uid": series_uid,
        "dimensions": {
            "x": series.columns or 512,
            "y": series.rows or 512,
            "z": series.num_instances,
        },
        "spacing": {
            "x": pixel_spacing[1],
            "y": pixel_spacing[0],
            "z": series.slice_thickness or 1.0,
        },
        "origin": {
            "x": origin[0],
            "y": origin[1],
            "z": origin[2],
        },
        "orientation": [1, 0, 0, 0, 1, 0],  # Default axial orientation
        "modality": series.modality,
        "supports_mpr": True,
        "supports_vr": True,
    }


@router.get("/{series_uid}/mpr")
async def get_mpr_slice(
    series_uid: str,
    request: Request,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    plane: str = Query("axial", description="MPR plane: axial, coronal, sagittal"),
    index: int = Query(0, ge=0, description="Slice index for the requested plane"),
    format: str = Query("png", enum=["png", "jpeg"], description="Output format"),
    quality: int = Query(90, ge=1, le=100, description="JPEG quality"),
    window_center: float | None = Query(None, description="Override window center"),
    window_width: float | None = Query(None, description="Override window width"),
) -> StreamingResponse:
    """Render an MPR slice for a 3D series."""
    import numpy as np
    from io import BytesIO
    from PIL import Image

    from app.services.ai.dicom_loader import DicomLoader

    query = (
        select(Series)
        .options(selectinload(Series.instances))
        .where(Series.series_instance_uid == series_uid)
    )
    result = await db.execute(query)
    series = result.scalar_one_or_none()

    if not series:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Series not found: {series_uid}",
        )

    if not series.study_instance_uid_fk:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Series is missing study reference",
        )

    if (series.num_instances or 0) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Series does not contain enough slices for MPR",
        )

    loader = DicomLoader(request.app.state.dicom_storage)
    try:
        volume = await loader.load_series(series.study_instance_uid_fk, series_uid, apply_rescale=False)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load series volume",
        ) from exc

    data = volume.pixel_data
    if data.ndim == 2:
        slice_data = data
    elif data.ndim == 3:
        depth, rows, cols = data.shape
        plane_lower = plane.lower()
        if plane_lower == "axial":
            if index >= depth:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Index out of range (0-{depth - 1}) for axial plane",
                )
            slice_data = data[index, :, :]
        elif plane_lower == "coronal":
            if index >= rows:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Index out of range (0-{rows - 1}) for coronal plane",
                )
            slice_data = data[:, index, :]
        elif plane_lower == "sagittal":
            if index >= cols:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Index out of range (0-{cols - 1}) for sagittal plane",
                )
            slice_data = data[:, :, index]
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Plane must be axial, coronal, or sagittal",
            )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported volume dimensions for MPR rendering",
        )

    wc = window_center if window_center is not None else (volume.metadata.window_center or 40)
    ww = window_width if window_width is not None else (volume.metadata.window_width or 400)
    slice_u8 = loader._apply_windowing(
        slice_data,
        window_center=wc,
        window_width=ww,
        rescale_slope=volume.metadata.rescale_slope,
        rescale_intercept=volume.metadata.rescale_intercept,
    )

    if slice_u8.ndim != 2:
        slice_u8 = np.squeeze(slice_u8)

    img = Image.fromarray(slice_u8, mode="L")
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


@router.post("/{series_uid}/track-measurement", response_model=TrackMeasurementResponse)
async def track_measurement(
    series_uid: str,
    payload: TrackMeasurementRequest,
    request: Request,
    current_user: Annotated[TokenData, Depends(get_current_active_user_from_token)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TrackMeasurementResponse:
    """Track a 2-point measurement across cine frames using optical flow."""
    try:
        import cv2
        import numpy as np
        import pydicom
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Tracking dependencies unavailable: {exc}",
        ) from exc

    query = (
        select(Series)
        .options(selectinload(Series.instances))
        .where(Series.series_instance_uid == series_uid)
    )
    result = await db.execute(query)
    series = result.scalar_one_or_none()

    if not series:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Series not found: {series_uid}",
        )

    instances = sorted(series.instances, key=lambda inst: inst.instance_number or 0)
    if not instances:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Series has no instances to track",
        )

    frame_refs: list[tuple[Instance, int]] = []
    for inst in instances:
        frame_count = max(1, inst.number_of_frames or 1)
        for frame_idx in range(frame_count):
            frame_refs.append((inst, frame_idx))

    total_frames = len(frame_refs)
    if total_frames == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Series has no frames to track",
        )

    start_index = min(payload.start_index, total_frames - 1)
    end_index = total_frames
    if payload.max_frames:
        end_index = min(end_index, start_index + payload.max_frames)

    points = np.array([[p.x, p.y] for p in payload.points], dtype=np.float32).reshape(-1, 1, 2)

    spacing_row = 1.0
    spacing_col = 1.0
    spacing_tuple = instances[0].pixel_spacing_tuple
    if spacing_tuple:
        spacing_row, spacing_col = spacing_tuple
    elif instances[0].pixel_spacing:
        try:
            parts = str(instances[0].pixel_spacing).split("\\")
            if len(parts) >= 2:
                spacing_row = float(parts[0])
                spacing_col = float(parts[1])
        except (ValueError, TypeError):
            spacing_row = 1.0
            spacing_col = 1.0

    def _load_frame_pixel(instance: Instance, frame_idx: int, cached: dict) -> np.ndarray:
        if cached.get("instance_uid") != instance.sop_instance_uid:
            if not instance.file_path or not Path(instance.file_path).exists():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="DICOM file not available on server",
                )
            try:
                ds = pydicom.dcmread(instance.file_path)
            except Exception as exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Failed to read DICOM pixel data for tracking",
                ) from exc
            cached["instance_uid"] = instance.sop_instance_uid
            try:
                cached["pixel_array"] = ds.pixel_array
                cached["samples_per_pixel"] = int(getattr(ds, "SamplesPerPixel", 1))
            except Exception as exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Failed to decode pixel data for tracking",
                ) from exc
        pixel_array = cached["pixel_array"]
        samples_per_pixel = cached["samples_per_pixel"]

        frame = pixel_array
        if pixel_array.ndim == 4:
            frame = pixel_array[frame_idx]
        elif pixel_array.ndim == 3 and samples_per_pixel == 1:
            frame = pixel_array[frame_idx]
        return np.ascontiguousarray(frame)

    def _to_gray(frame: np.ndarray) -> np.ndarray:
        if frame.ndim == 3 and frame.shape[-1] in (3, 4):
            frame = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
        frame_u8 = cv2.normalize(frame, None, 0, 255, cv2.NORM_MINMAX)
        return frame_u8.astype(np.uint8)

    cached = {}

    lk_params = dict(
        winSize=(21, 21),
        maxLevel=3,
        criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01),
    )

    def _track_indices(indices: list[int]) -> dict[int, TrackMeasurementFrame]:
        local_prev_gray = None
        local_prev_points = points.copy()
        results: dict[int, TrackMeasurementFrame] = {}

        for idx in indices:
            inst, frame_idx = frame_refs[idx]
            frame = _load_frame_pixel(inst, frame_idx, cached)
            gray = _to_gray(frame)

            if local_prev_gray is None:
                tracked = local_prev_points.copy()
                status_ok = True
            else:
                next_points, status, _ = cv2.calcOpticalFlowPyrLK(
                    local_prev_gray, gray, local_prev_points, None, **lk_params
                )
                status_ok = bool(status is not None and status.all())
                if next_points is None or not status_ok:
                    next_points = local_prev_points.copy()
                tracked = next_points

            local_prev_gray = gray
            local_prev_points = tracked

            tracked = np.clip(tracked, [0, 0], [gray.shape[1] - 1, gray.shape[0] - 1])
            p0 = tracked[0][0]
            p1 = tracked[1][0]
            dx_mm = (p1[0] - p0[0]) * spacing_col
            dy_mm = (p1[1] - p0[1]) * spacing_row
            length_mm = float(np.sqrt(dx_mm * dx_mm + dy_mm * dy_mm))

            results[idx] = TrackMeasurementFrame(
                frame_index=idx,
                points=[
                    TrackPoint(x=float(p0[0]), y=float(p0[1])),
                    TrackPoint(x=float(p1[0]), y=float(p1[1])),
                ],
                length_mm=length_mm,
                valid=status_ok,
            )

        return results

    forward_indices = list(range(start_index, end_index))
    tracked_map = _track_indices(forward_indices)

    if payload.track_full_loop and start_index > 0:
        backward_indices = list(range(start_index, -1, -1))
        tracked_map.update(_track_indices(backward_indices))

    tracked_frames = [tracked_map[idx] for idx in sorted(tracked_map.keys())]
    lengths = [frame.length_mm for frame in tracked_frames if frame.valid and frame.length_mm is not None]
    summary = TrackMeasurementSummary()
    if lengths:
        summary = TrackMeasurementSummary(
            min_mm=float(min(lengths)),
            max_mm=float(max(lengths)),
            mean_mm=float(sum(lengths) / len(lengths)),
        )

    return TrackMeasurementResponse(
        series_uid=series_uid,
        total_frames=total_frames,
        frames=tracked_frames,
        summary=summary,
    )
