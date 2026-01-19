"""
Study management endpoints for Horalix View.

Provides CRUD operations for DICOM studies with support for
filtering, pagination, and metadata retrieval.
"""

from datetime import date, datetime
from typing import Annotated, Any
from enum import Enum

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Request, status
from pydantic import BaseModel, Field

from app.api.v1.endpoints.auth import get_current_active_user, require_roles
from app.core.security import TokenData
from app.core.logging import audit_logger

router = APIRouter()


class Modality(str, Enum):
    """Supported DICOM modalities."""

    CR = "CR"  # Computed Radiography
    DX = "DX"  # Digital Radiography
    MG = "MG"  # Mammography
    CT = "CT"  # Computed Tomography
    MR = "MR"  # Magnetic Resonance
    PT = "PT"  # PET
    US = "US"  # Ultrasound
    XA = "XA"  # X-Ray Angiography
    NM = "NM"  # Nuclear Medicine
    SR = "SR"  # Structured Report
    SM = "SM"  # Slide Microscopy (Digital Pathology)
    OT = "OT"  # Other


class StudyStatus(str, Enum):
    """Study processing status."""

    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETE = "complete"
    ERROR = "error"


class SeriesSummary(BaseModel):
    """Series summary within a study."""

    series_instance_uid: str
    series_number: int | None
    series_description: str | None
    modality: str
    num_instances: int
    body_part: str | None


class StudyMetadata(BaseModel):
    """DICOM study metadata."""

    study_instance_uid: str = Field(..., description="Unique study identifier")
    study_id: str | None = Field(None, description="Study ID")
    study_date: date | None = Field(None, description="Study date")
    study_time: str | None = Field(None, description="Study time")
    study_description: str | None = Field(None, description="Study description")
    accession_number: str | None = Field(None, description="Accession number")
    referring_physician_name: str | None = Field(None, description="Referring physician")
    institution_name: str | None = Field(None, description="Institution name")
    modalities_in_study: list[str] = Field(default_factory=list, description="Modalities present")
    num_series: int = Field(0, description="Number of series")
    num_instances: int = Field(0, description="Total number of instances")
    patient_id: str | None = Field(None, description="Patient ID")
    patient_name: str | None = Field(None, description="Patient name")
    status: StudyStatus = Field(StudyStatus.COMPLETE, description="Processing status")
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)


class StudyListResponse(BaseModel):
    """Paginated study list response."""

    total: int
    page: int
    page_size: int
    studies: list[StudyMetadata]


class StudyDetailResponse(BaseModel):
    """Detailed study response with series information."""

    study: StudyMetadata
    series: list[SeriesSummary]
    ai_results_available: bool = False
    annotations_count: int = 0


# Simulated study database
STUDIES_DB: dict[str, dict[str, Any]] = {
    "1.2.840.113619.2.55.3.123456789.1": {
        "study_instance_uid": "1.2.840.113619.2.55.3.123456789.1",
        "study_id": "STUDY001",
        "study_date": date(2024, 1, 15),
        "study_time": "10:30:00",
        "study_description": "CT CHEST WITH CONTRAST",
        "accession_number": "ACC001",
        "referring_physician_name": "Dr. Smith",
        "institution_name": "City Hospital",
        "modalities_in_study": ["CT"],
        "num_series": 3,
        "num_instances": 450,
        "patient_id": "PAT001",
        "patient_name": "John Doe",
        "status": StudyStatus.COMPLETE,
    },
    "1.2.840.113619.2.55.3.123456789.2": {
        "study_instance_uid": "1.2.840.113619.2.55.3.123456789.2",
        "study_id": "STUDY002",
        "study_date": date(2024, 1, 16),
        "study_time": "14:15:00",
        "study_description": "MRI BRAIN WITHOUT CONTRAST",
        "accession_number": "ACC002",
        "referring_physician_name": "Dr. Johnson",
        "institution_name": "City Hospital",
        "modalities_in_study": ["MR"],
        "num_series": 5,
        "num_instances": 280,
        "patient_id": "PAT002",
        "patient_name": "Jane Smith",
        "status": StudyStatus.COMPLETE,
    },
}


@router.get("", response_model=StudyListResponse)
async def list_studies(
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    patient_id: str | None = Query(None, description="Filter by patient ID"),
    patient_name: str | None = Query(None, description="Filter by patient name (partial match)"),
    study_date_from: date | None = Query(None, description="Study date from"),
    study_date_to: date | None = Query(None, description="Study date to"),
    modality: Modality | None = Query(None, description="Filter by modality"),
    accession_number: str | None = Query(None, description="Filter by accession number"),
    study_description: str | None = Query(None, description="Filter by description"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
) -> StudyListResponse:
    """
    List studies with filtering and pagination.

    Supports filtering by patient, date range, modality, and other criteria.
    Results are paginated for efficient browsing.
    """
    # Filter studies
    filtered_studies = []
    for study_data in STUDIES_DB.values():
        # Apply filters
        if patient_id and study_data.get("patient_id") != patient_id:
            continue
        if patient_name and patient_name.lower() not in study_data.get("patient_name", "").lower():
            continue
        if study_date_from and study_data.get("study_date") and study_data["study_date"] < study_date_from:
            continue
        if study_date_to and study_data.get("study_date") and study_data["study_date"] > study_date_to:
            continue
        if modality and modality.value not in study_data.get("modalities_in_study", []):
            continue
        if accession_number and study_data.get("accession_number") != accession_number:
            continue
        if study_description and study_description.lower() not in study_data.get("study_description", "").lower():
            continue

        filtered_studies.append(StudyMetadata(**study_data))

    # Sort by date (newest first)
    filtered_studies.sort(key=lambda s: s.study_date or date.min, reverse=True)

    # Paginate
    total = len(filtered_studies)
    start = (page - 1) * page_size
    end = start + page_size
    paginated = filtered_studies[start:end]

    return StudyListResponse(
        total=total,
        page=page,
        page_size=page_size,
        studies=paginated,
    )


@router.get("/{study_uid}", response_model=StudyDetailResponse)
async def get_study(
    study_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> StudyDetailResponse:
    """
    Get detailed study information.

    Returns study metadata along with series summaries and
    information about available AI results and annotations.
    """
    study_data = STUDIES_DB.get(study_uid)
    if not study_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Study not found: {study_uid}",
        )

    # Log access for audit
    audit_logger.log_access(
        user_id=current_user.user_id,
        resource_type="study",
        resource_id=study_uid,
        action="VIEW",
    )

    # Simulate series data
    series_list = [
        SeriesSummary(
            series_instance_uid=f"{study_uid}.1",
            series_number=1,
            series_description="Axial Images",
            modality=study_data["modalities_in_study"][0] if study_data["modalities_in_study"] else "OT",
            num_instances=study_data["num_instances"] // study_data["num_series"],
            body_part="CHEST",
        )
    ]

    return StudyDetailResponse(
        study=StudyMetadata(**study_data),
        series=series_list,
        ai_results_available=False,
        annotations_count=0,
    )


@router.post("", response_model=StudyMetadata, status_code=status.HTTP_201_CREATED)
async def upload_study(
    request: Request,
    files: list[UploadFile] = File(..., description="DICOM files to upload"),
    current_user: Annotated[TokenData, Depends(require_roles("admin", "technologist"))],
) -> StudyMetadata:
    """
    Upload a new DICOM study.

    Accepts multiple DICOM files and creates a new study entry.
    Files are parsed and stored in the configured storage location.
    """
    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No files provided",
        )

    # Process DICOM files
    dicom_storage = request.app.state.dicom_storage

    try:
        # Parse and store files
        study_uid = None
        for file in files:
            content = await file.read()
            result = await dicom_storage.store_instance(content)
            if study_uid is None:
                study_uid = result.get("study_instance_uid")

        if study_uid is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not extract study UID from uploaded files",
            )

        # Create study entry
        study_data = {
            "study_instance_uid": study_uid,
            "study_id": f"STUDY{len(STUDIES_DB) + 1:03d}",
            "study_date": date.today(),
            "study_time": datetime.now().strftime("%H:%M:%S"),
            "study_description": "Uploaded Study",
            "modalities_in_study": ["OT"],
            "num_series": 1,
            "num_instances": len(files),
            "status": StudyStatus.PROCESSING,
        }
        STUDIES_DB[study_uid] = study_data

        audit_logger.log_access(
            user_id=current_user.user_id,
            resource_type="study",
            resource_id=study_uid,
            action="UPLOAD",
            details={"num_files": len(files)},
        )

        return StudyMetadata(**study_data)

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process uploaded files: {str(e)}",
        )


@router.delete("/{study_uid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_study(
    study_uid: str,
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
) -> None:
    """
    Delete a study (admin only).

    Permanently removes the study and all associated data.
    This action is logged for audit purposes.
    """
    if study_uid not in STUDIES_DB:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Study not found: {study_uid}",
        )

    del STUDIES_DB[study_uid]

    audit_logger.log_access(
        user_id=current_user.user_id,
        resource_type="study",
        resource_id=study_uid,
        action="DELETE",
    )


@router.get("/{study_uid}/thumbnail")
async def get_study_thumbnail(
    study_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    size: int = Query(128, ge=32, le=512, description="Thumbnail size"),
) -> dict:
    """
    Get study thumbnail image.

    Returns a representative thumbnail from the study's first series.
    """
    if study_uid not in STUDIES_DB:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Study not found: {study_uid}",
        )

    # In production, generate and return actual thumbnail
    return {
        "study_uid": study_uid,
        "thumbnail_url": f"/api/v1/studies/{study_uid}/thumbnail.png",
        "size": size,
    }


@router.post("/{study_uid}/refresh")
async def refresh_study_metadata(
    study_uid: str,
    current_user: Annotated[TokenData, Depends(require_roles("admin", "technologist"))],
) -> StudyMetadata:
    """
    Refresh study metadata from stored DICOM files.

    Re-parses DICOM headers to update study information.
    Useful after manual file modifications or imports.
    """
    if study_uid not in STUDIES_DB:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Study not found: {study_uid}",
        )

    study_data = STUDIES_DB[study_uid]
    study_data["updated_at"] = datetime.now()

    audit_logger.log_access(
        user_id=current_user.user_id,
        resource_type="study",
        resource_id=study_uid,
        action="REFRESH",
    )

    return StudyMetadata(**study_data)
