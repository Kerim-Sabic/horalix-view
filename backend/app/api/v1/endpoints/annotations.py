"""Annotation endpoints for Horalix View.

Provides CRUD operations for image annotations including measurements,
ROIs, and text labels with full database persistence.
"""

from datetime import datetime
from enum import Enum
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_active_user
from app.core.logging import audit_logger
from app.core.security import TokenData
from app.models import Annotation as AnnotationModel
from app.models import AnnotationType as AnnotationTypeModel
from app.models.base import get_db

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

    id: str
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
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


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


def db_annotation_to_pydantic(db_ann: AnnotationModel) -> Annotation:
    """Convert database annotation model to Pydantic model."""
    return Annotation(
        id=db_ann.annotation_uid,
        study_uid=db_ann.study_uid,
        series_uid=db_ann.series_uid,
        instance_uid=db_ann.instance_uid,
        frame_number=db_ann.frame_number,
        annotation_type=AnnotationType(db_ann.annotation_type.value),
        data=AnnotationData(**db_ann.geometry),
        measurements=[Measurement(**m) for m in (db_ann.measurements or [])],
        label=db_ann.label,
        description=db_ann.description,
        color=db_ann.color,
        visible=db_ann.visible,
        locked=db_ann.locked,
        created_by=db_ann.created_by,
        created_at=db_ann.created_at,
        updated_at=db_ann.updated_at,
    )


@router.get("", response_model=AnnotationListResponse)
async def list_annotations(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    study_uid: str | None = Query(None),
    series_uid: str | None = Query(None),
    instance_uid: str | None = Query(None),
    annotation_type: AnnotationType | None = Query(None),
) -> AnnotationListResponse:
    """List annotations with filtering."""
    query = select(AnnotationModel)

    if study_uid:
        query = query.where(AnnotationModel.study_uid == study_uid)
    if series_uid:
        query = query.where(AnnotationModel.series_uid == series_uid)
    if instance_uid:
        query = query.where(AnnotationModel.instance_uid == instance_uid)
    if annotation_type:
        query = query.where(
            AnnotationModel.annotation_type == AnnotationTypeModel[annotation_type.value.upper()]
        )

    result = await db.execute(query)
    db_annotations = result.scalars().all()

    annotations = [db_annotation_to_pydantic(ann) for ann in db_annotations]

    return AnnotationListResponse(
        total=len(annotations),
        annotations=annotations,
    )


@router.get("/{annotation_id}", response_model=Annotation)
async def get_annotation(
    annotation_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> Annotation:
    """Get annotation by ID."""
    query = select(AnnotationModel).where(AnnotationModel.annotation_uid == annotation_id)
    result = await db.execute(query)
    db_annotation = result.scalar_one_or_none()

    if not db_annotation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Annotation not found: {annotation_id}",
        )

    return db_annotation_to_pydantic(db_annotation)


@router.post("", response_model=Annotation, status_code=status.HTTP_201_CREATED)
async def create_annotation(
    annotation: AnnotationCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> Annotation:
    """Create a new annotation."""
    ann_uid = str(uuid4())

    # Convert AnnotationData to dict for JSON storage
    geometry_dict = annotation.data.model_dump()

    # Convert measurements to dict list
    measurements_list = (
        [m.model_dump() for m in annotation.measurements] if annotation.measurements else None
    )

    db_annotation = AnnotationModel(
        annotation_uid=ann_uid,
        study_uid=annotation.study_uid,
        series_uid=annotation.series_uid,
        instance_uid=annotation.instance_uid,
        frame_number=annotation.frame_number,
        annotation_type=AnnotationTypeModel[annotation.annotation_type.value.upper()],
        geometry=geometry_dict,
        measurements=measurements_list,
        label=annotation.label,
        description=annotation.description,
        color=annotation.color,
        created_by=current_user.user_id,
    )

    db.add(db_annotation)
    await db.commit()
    await db.refresh(db_annotation)

    audit_logger.log_access(
        user_id=current_user.user_id,
        resource_type="annotation",
        resource_id=ann_uid,
        action="CREATE",
    )

    return db_annotation_to_pydantic(db_annotation)


@router.put("/{annotation_id}", response_model=Annotation)
async def update_annotation(
    annotation_id: str,
    update: AnnotationUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> Annotation:
    """Update an existing annotation."""
    query = select(AnnotationModel).where(AnnotationModel.annotation_uid == annotation_id)
    result = await db.execute(query)
    db_annotation = result.scalar_one_or_none()

    if not db_annotation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Annotation not found: {annotation_id}",
        )

    # Check if locked
    if db_annotation.locked and current_user.user_id != db_annotation.created_by:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Annotation is locked",
        )

    # Update fields
    if update.data is not None:
        db_annotation.geometry = update.data.model_dump()
    if update.measurements is not None:
        db_annotation.measurements = [m.model_dump() for m in update.measurements]
    if update.label is not None:
        db_annotation.label = update.label
    if update.description is not None:
        db_annotation.description = update.description
    if update.color is not None:
        db_annotation.color = update.color
    if update.visible is not None:
        db_annotation.visible = update.visible
    if update.locked is not None:
        db_annotation.locked = update.locked

    await db.commit()
    await db.refresh(db_annotation)

    audit_logger.log_access(
        user_id=current_user.user_id,
        resource_type="annotation",
        resource_id=annotation_id,
        action="UPDATE",
    )

    return db_annotation_to_pydantic(db_annotation)


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_annotation(
    annotation_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> None:
    """Delete an annotation."""
    query = select(AnnotationModel).where(AnnotationModel.annotation_uid == annotation_id)
    result = await db.execute(query)
    db_annotation = result.scalar_one_or_none()

    if not db_annotation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Annotation not found: {annotation_id}",
        )

    # Check if locked
    if db_annotation.locked and current_user.user_id != db_annotation.created_by:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Annotation is locked",
        )

    await db.delete(db_annotation)
    await db.commit()

    audit_logger.log_access(
        user_id=current_user.user_id,
        resource_type="annotation",
        resource_id=annotation_id,
        action="DELETE",
    )


@router.post("/batch", response_model=list[Annotation], status_code=status.HTTP_201_CREATED)
async def create_annotations_batch(
    annotations: list[AnnotationCreate],
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> list[Annotation]:
    """Create multiple annotations in a batch."""
    created = []
    for annotation in annotations:
        ann_uid = str(uuid4())

        geometry_dict = annotation.data.model_dump()
        measurements_list = (
            [m.model_dump() for m in annotation.measurements] if annotation.measurements else None
        )

        db_annotation = AnnotationModel(
            annotation_uid=ann_uid,
            study_uid=annotation.study_uid,
            series_uid=annotation.series_uid,
            instance_uid=annotation.instance_uid,
            frame_number=annotation.frame_number,
            annotation_type=AnnotationTypeModel[annotation.annotation_type.value.upper()],
            geometry=geometry_dict,
            measurements=measurements_list,
            label=annotation.label,
            description=annotation.description,
            color=annotation.color,
            created_by=current_user.user_id,
        )

        db.add(db_annotation)
        created.append(db_annotation)

    await db.commit()

    # Refresh all created annotations
    for db_ann in created:
        await db.refresh(db_ann)

    return [db_annotation_to_pydantic(ann) for ann in created]


@router.get("/study/{study_uid}/export")
async def export_study_annotations(
    study_uid: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    format: str = Query("json", enum=["json", "dicom-sr"]),
) -> dict:
    """Export all annotations for a study.

    Supports JSON and DICOM-SR formats.
    """
    query = select(AnnotationModel).where(AnnotationModel.study_uid == study_uid)
    result = await db.execute(query)
    db_annotations = result.scalars().all()

    annotations = [db_annotation_to_pydantic(ann) for ann in db_annotations]

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
