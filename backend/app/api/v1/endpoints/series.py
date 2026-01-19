"""
Series management endpoints for Horalix View.
"""

from typing import Annotated, Any
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.api.v1.endpoints.auth import get_current_active_user
from app.core.security import TokenData

router = APIRouter()


class InstanceSummary(BaseModel):
    """Instance summary within a series."""

    sop_instance_uid: str
    instance_number: int | None
    sop_class_uid: str
    rows: int | None
    columns: int | None
    bits_allocated: int | None


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


# Simulated series database
SERIES_DB: dict[str, dict[str, Any]] = {
    "1.2.840.113619.2.55.3.123456789.1.1": {
        "series_instance_uid": "1.2.840.113619.2.55.3.123456789.1.1",
        "study_instance_uid": "1.2.840.113619.2.55.3.123456789.1",
        "series_number": 1,
        "series_description": "Axial Soft Tissue",
        "modality": "CT",
        "body_part_examined": "CHEST",
        "patient_position": "HFS",
        "protocol_name": "Chest CT with Contrast",
        "num_instances": 150,
        "slice_thickness": 2.5,
        "spacing_between_slices": 2.5,
    },
    "1.2.840.113619.2.55.3.123456789.1.2": {
        "series_instance_uid": "1.2.840.113619.2.55.3.123456789.1.2",
        "study_instance_uid": "1.2.840.113619.2.55.3.123456789.1",
        "series_number": 2,
        "series_description": "Axial Lung Window",
        "modality": "CT",
        "body_part_examined": "CHEST",
        "patient_position": "HFS",
        "protocol_name": "Chest CT with Contrast",
        "num_instances": 150,
        "slice_thickness": 2.5,
        "spacing_between_slices": 2.5,
    },
    "1.2.840.113619.2.55.3.123456789.1.3": {
        "series_instance_uid": "1.2.840.113619.2.55.3.123456789.1.3",
        "study_instance_uid": "1.2.840.113619.2.55.3.123456789.1",
        "series_number": 3,
        "series_description": "Coronal Reformats",
        "modality": "CT",
        "body_part_examined": "CHEST",
        "patient_position": "HFS",
        "protocol_name": "Chest CT with Contrast",
        "num_instances": 150,
        "slice_thickness": 2.5,
        "spacing_between_slices": 2.5,
    },
}


@router.get("", response_model=SeriesListResponse)
async def list_series(
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    study_uid: str | None = Query(None, description="Filter by study UID"),
    modality: str | None = Query(None, description="Filter by modality"),
) -> SeriesListResponse:
    """
    List series with optional filtering.

    Returns all series matching the specified criteria.
    """
    filtered_series = []
    for series_data in SERIES_DB.values():
        if study_uid and series_data.get("study_instance_uid") != study_uid:
            continue
        if modality and series_data.get("modality") != modality:
            continue
        filtered_series.append(SeriesMetadata(**series_data))

    # Sort by series number
    filtered_series.sort(key=lambda s: s.series_number or 0)

    return SeriesListResponse(
        total=len(filtered_series),
        series=filtered_series,
    )


@router.get("/{series_uid}", response_model=SeriesDetailResponse)
async def get_series(
    series_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> SeriesDetailResponse:
    """
    Get detailed series information.

    Returns series metadata and instance list.
    """
    series_data = SERIES_DB.get(series_uid)
    if not series_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Series not found: {series_uid}",
        )

    # Generate instance list
    num_instances = series_data.get("num_instances", 0)
    instances = [
        InstanceSummary(
            sop_instance_uid=f"{series_uid}.{i + 1}",
            instance_number=i + 1,
            sop_class_uid="1.2.840.10008.5.1.4.1.1.2",  # CT Image Storage
            rows=512,
            columns=512,
            bits_allocated=16,
        )
        for i in range(min(num_instances, 10))  # Limit for demo
    ]

    return SeriesDetailResponse(
        series=SeriesMetadata(**series_data),
        instances=instances,
        window_center=40.0,
        window_width=400.0,
        has_3d_data=series_data.get("modality") in ["CT", "MR", "PT"],
    )


@router.get("/{series_uid}/frames")
async def get_series_frames(
    series_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    start: int = Query(0, ge=0, description="Start frame index"),
    count: int = Query(10, ge=1, le=100, description="Number of frames"),
) -> dict:
    """
    Get frame information for a series.

    Returns frame positions and metadata for efficient scrolling.
    """
    series_data = SERIES_DB.get(series_uid)
    if not series_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Series not found: {series_uid}",
        )

    num_instances = series_data.get("num_instances", 0)
    slice_thickness = series_data.get("slice_thickness", 1.0)

    frames = []
    for i in range(start, min(start + count, num_instances)):
        frames.append({
            "index": i,
            "instance_uid": f"{series_uid}.{i + 1}",
            "position": i * (slice_thickness or 1.0),
            "slice_location": -100.0 + i * (slice_thickness or 1.0),
        })

    return {
        "series_uid": series_uid,
        "total_frames": num_instances,
        "start": start,
        "count": len(frames),
        "frames": frames,
    }


@router.get("/{series_uid}/volume-info")
async def get_volume_info(
    series_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> dict:
    """
    Get 3D volume information for a series.

    Returns spatial information needed for MPR and volume rendering.
    """
    series_data = SERIES_DB.get(series_uid)
    if not series_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Series not found: {series_uid}",
        )

    if series_data.get("modality") not in ["CT", "MR", "PT"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Series does not support 3D visualization",
        )

    num_instances = series_data.get("num_instances", 0)
    slice_thickness = series_data.get("slice_thickness", 1.0)

    return {
        "series_uid": series_uid,
        "dimensions": {
            "x": 512,
            "y": 512,
            "z": num_instances,
        },
        "spacing": {
            "x": 0.5,
            "y": 0.5,
            "z": slice_thickness,
        },
        "origin": {
            "x": -128.0,
            "y": -128.0,
            "z": -100.0,
        },
        "orientation": [1, 0, 0, 0, 1, 0],
        "modality": series_data.get("modality"),
        "supports_mpr": True,
        "supports_vr": True,
    }
