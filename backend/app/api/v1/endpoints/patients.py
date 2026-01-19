"""
Patient management endpoints for Horalix View.
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.api.v1.endpoints.auth import get_current_active_user, require_roles
from app.core.security import TokenData
from app.core.logging import audit_logger

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


# Simulated patient database
PATIENTS_DB = {
    "PAT001": {
        "patient_id": "PAT001",
        "patient_name": "John Doe",
        "birth_date": date(1965, 3, 15),
        "sex": "M",
        "age": "059Y",
        "weight": 82.5,
        "study_count": 3,
        "last_study_date": date(2024, 1, 15),
    },
    "PAT002": {
        "patient_id": "PAT002",
        "patient_name": "Jane Smith",
        "birth_date": date(1978, 7, 22),
        "sex": "F",
        "age": "046Y",
        "weight": 65.0,
        "study_count": 2,
        "last_study_date": date(2024, 1, 16),
    },
    "PAT003": {
        "patient_id": "PAT003",
        "patient_name": "Robert Johnson",
        "birth_date": date(1955, 11, 8),
        "sex": "M",
        "age": "069Y",
        "weight": 78.0,
        "study_count": 5,
        "last_study_date": date(2024, 1, 10),
    },
}


@router.get("", response_model=PatientListResponse)
async def list_patients(
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    patient_id: str | None = Query(None, description="Filter by patient ID"),
    patient_name: str | None = Query(None, description="Filter by name (partial)"),
    birth_date_from: date | None = Query(None, description="Birth date from"),
    birth_date_to: date | None = Query(None, description="Birth date to"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> PatientListResponse:
    """
    List patients with filtering and pagination.
    """
    filtered = []
    for patient_data in PATIENTS_DB.values():
        if patient_id and patient_data["patient_id"] != patient_id:
            continue
        if patient_name and patient_name.lower() not in patient_data.get("patient_name", "").lower():
            continue
        if birth_date_from and patient_data.get("birth_date") and patient_data["birth_date"] < birth_date_from:
            continue
        if birth_date_to and patient_data.get("birth_date") and patient_data["birth_date"] > birth_date_to:
            continue
        filtered.append(PatientMetadata(**patient_data))

    # Sort by name
    filtered.sort(key=lambda p: p.patient_name or "")

    # Paginate
    total = len(filtered)
    start = (page - 1) * page_size
    end = start + page_size

    return PatientListResponse(
        total=total,
        page=page,
        page_size=page_size,
        patients=filtered[start:end],
    )


@router.get("/{patient_id}", response_model=PatientMetadata)
async def get_patient(
    patient_id: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> PatientMetadata:
    """
    Get patient information.
    """
    patient_data = PATIENTS_DB.get(patient_id)
    if not patient_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Patient not found: {patient_id}",
        )

    audit_logger.log_access(
        user_id=current_user.user_id,
        resource_type="patient",
        resource_id=patient_id,
        action="VIEW",
    )

    return PatientMetadata(**patient_data)


@router.get("/{patient_id}/studies", response_model=list[PatientStudySummary])
async def get_patient_studies(
    patient_id: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> list[PatientStudySummary]:
    """
    Get all studies for a patient.
    """
    if patient_id not in PATIENTS_DB:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Patient not found: {patient_id}",
        )

    # Return simulated study summaries
    studies = []
    if patient_id == "PAT001":
        studies.append(
            PatientStudySummary(
                study_instance_uid="1.2.840.113619.2.55.3.123456789.1",
                study_date=date(2024, 1, 15),
                study_description="CT CHEST WITH CONTRAST",
                modalities=["CT"],
                num_series=3,
                num_instances=450,
            )
        )

    return studies


@router.delete("/{patient_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_patient(
    patient_id: str,
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
) -> None:
    """
    Delete a patient and all associated studies (admin only).

    This action permanently removes all patient data and is logged for audit.
    """
    if patient_id not in PATIENTS_DB:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Patient not found: {patient_id}",
        )

    del PATIENTS_DB[patient_id]

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
) -> dict:
    """
    Merge two patient records (admin only).

    Moves all studies from source patient to target patient.
    """
    if patient_id not in PATIENTS_DB:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Target patient not found: {patient_id}",
        )
    if source_patient_id not in PATIENTS_DB:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Source patient not found: {source_patient_id}",
        )

    audit_logger.log_access(
        user_id=current_user.user_id,
        resource_type="patient",
        resource_id=patient_id,
        action="MERGE",
        details={"source_patient_id": source_patient_id},
    )

    return {
        "message": f"Merged patient {source_patient_id} into {patient_id}",
        "studies_moved": 0,
    }
