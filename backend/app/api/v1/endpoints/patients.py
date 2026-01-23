"""Patient management endpoints for Horalix View."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_active_user, require_roles
from app.core.logging import audit_logger
from app.core.security import TokenData
from app.models.base import get_db
from app.models.patient import Patient
from app.models.study import Study

router = APIRouter()


class PatientMetadata(BaseModel):
    """Patient demographic information."""

    patient_id: str = Field(..., description="Patient ID")
    patient_name: str | None = Field(None, description="Patient name")
    birth_date: date | None = Field(None, description="Date of birth")
    sex: str | None = Field(None, description="Patient sex (M/F/O)")
    age: str | None = Field(None, description="Patient age")
    weight: float | None = Field(None, description="Patient weight in kg")
    ethnic_group: str | None = Field(None, description="Ethnic group")
    comments: str | None = Field(None, description="Patient comments")
    study_count: int = Field(0, description="Number of studies")
    last_study_date: date | None = Field(None, description="Most recent study date")


class PatientListResponse(BaseModel):
    """Paginated patient list response."""

    total: int
    page: int
    page_size: int
    patients: list[PatientMetadata]


class PatientStudySummary(BaseModel):
    """Summary of studies for a patient."""

    study_instance_uid: str
    study_date: date | None
    study_description: str | None
    modalities: list[str]
    num_series: int
    num_instances: int




@router.get("", response_model=PatientListResponse)
async def list_patients(
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    patient_id: str | None = Query(None, description="Filter by patient ID"),
    patient_name: str | None = Query(None, description="Filter by name (partial)"),
    birth_date_from: date | None = Query(None, description="Birth date from"),
    birth_date_to: date | None = Query(None, description="Birth date to"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> PatientListResponse:
    """List patients with filtering and pagination."""
    filters = []
    if patient_id:
        filters.append(Patient.patient_id == patient_id)
    if patient_name:
        filters.append(Patient.patient_name.ilike(f"%{patient_name}%"))
    if birth_date_from:
        filters.append(Patient.birth_date >= birth_date_from)
    if birth_date_to:
        filters.append(Patient.birth_date <= birth_date_to)

    base_query = select(Patient)
    if filters:
        base_query = base_query.where(and_(*filters))

    total_result = await db.execute(select(func.count()).select_from(base_query.subquery()))
    total = total_result.scalar() or 0

    offset = (page - 1) * page_size
    query = (
        select(
            Patient,
            func.count(Study.id).label("study_count"),
            func.max(Study.study_date).label("last_study_date"),
        )
        .outerjoin(Study, Study.patient_id_fk == Patient.id)
        .group_by(Patient.id)
        .order_by(Patient.patient_name.asc().nullslast())
        .offset(offset)
        .limit(page_size)
    )

    if filters:
        query = query.where(and_(*filters))

    result = await db.execute(query)
    patients = []
    for patient, study_count, last_study_date in result.all():
        patients.append(
            PatientMetadata(
                patient_id=patient.patient_id,
                patient_name=patient.patient_name,
                birth_date=patient.birth_date,
                sex=patient.sex,
                age=None,
                weight=None,
                ethnic_group=patient.ethnic_group,
                comments=patient.comments,
                study_count=study_count or 0,
                last_study_date=last_study_date,
            )
        )

    return PatientListResponse(
        total=total,
        page=page,
        page_size=page_size,
        patients=patients,
    )


@router.get("/{patient_id}", response_model=PatientMetadata)
async def get_patient(
    patient_id: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PatientMetadata:
    """Get patient information."""
    patient_result = await db.execute(
        select(Patient).where(Patient.patient_id == patient_id)
    )
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Patient not found: {patient_id}",
        )

    study_stats_result = await db.execute(
        select(func.count(Study.id), func.max(Study.study_date)).where(
            Study.patient_id_fk == patient.id
        )
    )
    study_count, last_study_date = study_stats_result.one()

    audit_logger.log_access(
        user_id=current_user.user_id,
        resource_type="patient",
        resource_id=patient_id,
        action="VIEW",
    )

    return PatientMetadata(
        patient_id=patient.patient_id,
        patient_name=patient.patient_name,
        birth_date=patient.birth_date,
        sex=patient.sex,
        age=None,
        weight=None,
        ethnic_group=patient.ethnic_group,
        comments=patient.comments,
        study_count=study_count or 0,
        last_study_date=last_study_date,
    )


@router.get("/{patient_id}/studies", response_model=list[PatientStudySummary])
async def get_patient_studies(
    patient_id: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[PatientStudySummary]:
    """Get all studies for a patient."""
    patient_result = await db.execute(
        select(Patient).where(Patient.patient_id == patient_id)
    )
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Patient not found: {patient_id}",
        )

    study_result = await db.execute(
        select(Study)
        .where(Study.patient_id_fk == patient.id)
        .order_by(Study.study_date.desc().nullslast(), Study.created_at.desc())
    )
    studies = study_result.scalars().all()

    return [
        PatientStudySummary(
            study_instance_uid=study.study_instance_uid,
            study_date=study.study_date,
            study_description=study.study_description,
            modalities=study.modalities_list,
            num_series=study.num_series,
            num_instances=study.num_instances,
        )
        for study in studies
    ]


@router.delete("/{patient_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_patient(
    patient_id: str,
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    """Delete a patient and all associated studies (admin only).

    This action permanently removes all patient data and is logged for audit.
    """
    patient_result = await db.execute(
        select(Patient).where(Patient.patient_id == patient_id)
    )
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Patient not found: {patient_id}",
        )

    await db.delete(patient)
    await db.commit()

    audit_logger.log_access(
        user_id=current_user.user_id,
        resource_type="patient",
        resource_id=patient_id,
        action="DELETE",
    )


@router.post("/{patient_id}/merge")
async def merge_patients(
    patient_id: str,
    source_patient_id: str,
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Merge two patient records (admin only).

    Moves all studies from source patient to target patient.
    """
    target_result = await db.execute(
        select(Patient).where(Patient.patient_id == patient_id)
    )
    target_patient = target_result.scalar_one_or_none()
    if not target_patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Target patient not found: {patient_id}",
        )

    source_result = await db.execute(
        select(Patient).where(Patient.patient_id == source_patient_id)
    )
    source_patient = source_result.scalar_one_or_none()
    if not source_patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Source patient not found: {source_patient_id}",
        )

    study_result = await db.execute(
        select(Study).where(Study.patient_id_fk == source_patient.id)
    )
    source_studies = study_result.scalars().all()
    for study in source_studies:
        study.patient_id_fk = target_patient.id

    await db.delete(source_patient)
    await db.commit()

    audit_logger.log_access(
        user_id=current_user.user_id,
        resource_type="patient",
        resource_id=patient_id,
        action="MERGE",
        details={"source_patient_id": source_patient_id},
    )

    return {
        "message": f"Merged patient {source_patient_id} into {patient_id}",
        "studies_moved": len(source_studies),
    }
