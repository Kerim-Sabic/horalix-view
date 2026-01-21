"""Series management endpoints for Horalix View.

Provides endpoints for retrieving and managing DICOM series.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
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


class InstanceSummary(BaseModel):
    """Instance summary within a series."""

    sop_instance_uid: str
    instance_number: int | None
    sop_class_uid: str
    rows: int | None
    columns: int | None
    bits_allocated: int | None

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


@router.get("", response_model=SeriesListResponse)
async def list_series(
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
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
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
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

    # Build instance list
    instances = [
        InstanceSummary(
            sop_instance_uid=inst.sop_instance_uid,
            instance_number=inst.instance_number,
            sop_class_uid=inst.sop_class_uid,
            rows=inst.rows,
            columns=inst.columns,
            bits_allocated=inst.bits_allocated,
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
