"""
Annotation endpoints for Horalix View.

Provides CRUD operations for image annotations including measurements,
ROIs, and text labels.
"""

from datetime import datetime
from enum import Enum
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.api.v1.endpoints.auth import get_current_active_user
from app.core.security import TokenData
from app.core.logging import audit_logger

router = APIRouter()


class AnnotationType(str, Enum):
    """Annotation types."""

    LENGTH = "length"
    ANGLE = "angle"
    AREA = "area"
    VOLUME = "volume"
    ELLIPSE = "ellipse"
    RECTANGLE = "rectangle"
    POLYGON = "polygon"
    FREEHAND = "freehand"
    ARROW = "arrow"
    TEXT = "text"
    PROBE = "probe"
    COBB_ANGLE = "cobb_angle"
    BIDIRECTIONAL = "bidirectional"


class Point2D(BaseModel):
    """2D point."""

    x: float
    y: float


class Point3D(BaseModel):
    """3D point in patient coordinates."""

    x: float
    y: float
    z: float


class AnnotationData(BaseModel):
    """Annotation geometric data."""

    points: list[Point2D] = Field(default_factory=list)
    points_3d: list[Point3D] | None = None
    handles: list[Point2D] = Field(default_factory=list)
    text_position: Point2D | None = None


class Measurement(BaseModel):
    """Measurement value from annotation."""

    value: float
    unit: str
    label: str


class Annotation(BaseModel):
    """Complete annotation object."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    study_uid: str
    series_uid: str
    instance_uid: str
    frame_number: int = 0
    annotation_type: AnnotationType
    data: AnnotationData
    measurements: list[Measurement] = Field(default_factory=list)
    label: str | None = None
    description: str | None = None
    color: str = "#FFFF00"
    visible: bool = True
    locked: bool = False
    created_by: str
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)


class AnnotationCreate(BaseModel):
    """Create annotation request."""

    study_uid: str
    series_uid: str
    instance_uid: str
    frame_number: int = 0
    annotation_type: AnnotationType
    data: AnnotationData
    measurements: list[Measurement] = Field(default_factory=list)
    label: str | None = None
    description: str | None = None
    color: str = "#FFFF00"


class AnnotationUpdate(BaseModel):
    """Update annotation request."""

    data: AnnotationData | None = None
    measurements: list[Measurement] | None = None
    label: str | None = None
    description: str | None = None
    color: str | None = None
    visible: bool | None = None
    locked: bool | None = None


class AnnotationListResponse(BaseModel):
    """Annotation list response."""

    total: int
    annotations: list[Annotation]


# Simulated annotations database
ANNOTATIONS_DB: dict[str, dict] = {}


@router.get("", response_model=AnnotationListResponse)
async def list_annotations(
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    study_uid: str | None = Query(None),
    series_uid: str | None = Query(None),
    instance_uid: str | None = Query(None),
    annotation_type: AnnotationType | None = Query(None),
) -> AnnotationListResponse:
    """
    List annotations with filtering.
    """
    filtered = []
    for ann_data in ANNOTATIONS_DB.values():
        if study_uid and ann_data.get("study_uid") != study_uid:
            continue
        if series_uid and ann_data.get("series_uid") != series_uid:
            continue
        if instance_uid and ann_data.get("instance_uid") != instance_uid:
            continue
        if annotation_type and ann_data.get("annotation_type") != annotation_type.value:
            continue
        filtered.append(Annotation(**ann_data))

    return AnnotationListResponse(
        total=len(filtered),
        annotations=filtered,
    )


@router.get("/{annotation_id}", response_model=Annotation)
async def get_annotation(
    annotation_id: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> Annotation:
    """
    Get annotation by ID.
    """
    if annotation_id not in ANNOTATIONS_DB:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Annotation not found: {annotation_id}",
        )

    return Annotation(**ANNOTATIONS_DB[annotation_id])


@router.post("", response_model=Annotation, status_code=status.HTTP_201_CREATED)
async def create_annotation(
    annotation: AnnotationCreate,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> Annotation:
    """
    Create a new annotation.
    """
    ann_id = str(uuid4())
    new_annotation = Annotation(
        id=ann_id,
        study_uid=annotation.study_uid,
        series_uid=annotation.series_uid,
        instance_uid=annotation.instance_uid,
        frame_number=annotation.frame_number,
        annotation_type=annotation.annotation_type,
        data=annotation.data,
        measurements=annotation.measurements,
        label=annotation.label,
        description=annotation.description,
        color=annotation.color,
        created_by=current_user.user_id,
    )

    ANNOTATIONS_DB[ann_id] = new_annotation.model_dump()

    audit_logger.log_access(
        user_id=current_user.user_id,
        resource_type="annotation",
        resource_id=ann_id,
        action="CREATE",
    )

    return new_annotation


@router.put("/{annotation_id}", response_model=Annotation)
async def update_annotation(
    annotation_id: str,
    update: AnnotationUpdate,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> Annotation:
    """
    Update an existing annotation.
    """
    if annotation_id not in ANNOTATIONS_DB:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Annotation not found: {annotation_id}",
        )

    ann_data = ANNOTATIONS_DB[annotation_id]

    # Check if locked
    if ann_data.get("locked") and current_user.user_id != ann_data.get("created_by"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Annotation is locked",
        )

    # Update fields
    if update.data is not None:
        ann_data["data"] = update.data.model_dump()
    if update.measurements is not None:
        ann_data["measurements"] = [m.model_dump() for m in update.measurements]
    if update.label is not None:
        ann_data["label"] = update.label
    if update.description is not None:
        ann_data["description"] = update.description
    if update.color is not None:
        ann_data["color"] = update.color
    if update.visible is not None:
        ann_data["visible"] = update.visible
    if update.locked is not None:
        ann_data["locked"] = update.locked

    ann_data["updated_at"] = datetime.now().isoformat()

    audit_logger.log_access(
        user_id=current_user.user_id,
        resource_type="annotation",
        resource_id=annotation_id,
        action="UPDATE",
    )

    return Annotation(**ann_data)


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_annotation(
    annotation_id: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> None:
    """
    Delete an annotation.
    """
    if annotation_id not in ANNOTATIONS_DB:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Annotation not found: {annotation_id}",
        )

    ann_data = ANNOTATIONS_DB[annotation_id]

    # Check if locked
    if ann_data.get("locked") and current_user.user_id != ann_data.get("created_by"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Annotation is locked",
        )

    del ANNOTATIONS_DB[annotation_id]

    audit_logger.log_access(
        user_id=current_user.user_id,
        resource_type="annotation",
        resource_id=annotation_id,
        action="DELETE",
    )


@router.post("/batch", response_model=list[Annotation], status_code=status.HTTP_201_CREATED)
async def create_annotations_batch(
    annotations: list[AnnotationCreate],
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> list[Annotation]:
    """
    Create multiple annotations in a batch.
    """
    created = []
    for annotation in annotations:
        ann_id = str(uuid4())
        new_annotation = Annotation(
            id=ann_id,
            study_uid=annotation.study_uid,
            series_uid=annotation.series_uid,
            instance_uid=annotation.instance_uid,
            frame_number=annotation.frame_number,
            annotation_type=annotation.annotation_type,
            data=annotation.data,
            measurements=annotation.measurements,
            label=annotation.label,
            description=annotation.description,
            color=annotation.color,
            created_by=current_user.user_id,
        )
        ANNOTATIONS_DB[ann_id] = new_annotation.model_dump()
        created.append(new_annotation)

    return created


@router.get("/study/{study_uid}/export")
async def export_study_annotations(
    study_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    format: str = Query("json", enum=["json", "dicom-sr"]),
) -> dict:
    """
    Export all annotations for a study.

    Supports JSON and DICOM-SR formats.
    """
    annotations = [
        Annotation(**ann) for ann in ANNOTATIONS_DB.values()
        if ann.get("study_uid") == study_uid
    ]

    audit_logger.log_data_export(
        user_id=current_user.user_id,
        export_type="annotations",
        resource_ids=[study_uid],
        format=format,
    )

    if format == "dicom-sr":
        return {
            "message": "DICOM-SR export would be generated here",
            "study_uid": study_uid,
            "annotation_count": len(annotations),
        }

    return {
        "study_uid": study_uid,
        "annotations": [ann.model_dump() for ann in annotations],
        "export_date": datetime.now().isoformat(),
    }
