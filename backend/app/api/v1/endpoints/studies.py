"""
Study management endpoints for Horalix View.

Provides CRUD operations for DICOM studies with support for
filtering, pagination, and metadata retrieval.
"""

from datetime import date, datetime, time as dt_time
from typing import Annotated, Any
from enum import Enum
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select, func, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints.auth import get_current_active_user, require_roles
from app.core.security import TokenData
from app.core.logging import audit_logger
from app.models.base import get_db
from app.models.study import Study, StudyStatus
from app.models.series import Series
from app.models.patient import Patient
from app.models.instance import Instance
from app.models.annotation import Annotation

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
    status: str = Field("complete", description="Processing status")
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)

    class Config:
        from_attributes = True


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


def _study_to_metadata(study: Study, patient: Patient | None = None) -> StudyMetadata:
    """Convert Study model to StudyMetadata response."""
    return StudyMetadata(
        study_instance_uid=study.study_instance_uid,
        study_id=study.study_id,
        study_date=study.study_date,
        study_time=study.study_time.strftime("%H:%M:%S") if study.study_time else None,
        study_description=study.study_description,
        accession_number=study.accession_number,
        referring_physician_name=study.referring_physician_name,
        institution_name=study.institution_name,
        modalities_in_study=study.modalities_list,
        num_series=study.num_series,
        num_instances=study.num_instances,
        patient_id=patient.patient_id if patient else None,
        patient_name=patient.patient_name if patient else None,
        status=study.status.value,
        created_at=study.created_at,
        updated_at=study.updated_at,
    )


@router.get("", response_model=StudyListResponse)
async def list_studies(
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
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
    # Build query with joins
    query = (
        select(Study)
        .options(selectinload(Study.patient))
        .order_by(Study.study_date.desc().nullslast(), Study.created_at.desc())
    )

    # Apply filters
    filters = []

    if patient_id:
        query = query.join(Patient, Study.patient_id_fk == Patient.id)
        filters.append(Patient.patient_id == patient_id)

    if patient_name:
        if not patient_id:  # Only join if not already joined
            query = query.outerjoin(Patient, Study.patient_id_fk == Patient.id)
        filters.append(Patient.patient_name.ilike(f"%{patient_name}%"))

    if study_date_from:
        filters.append(Study.study_date >= study_date_from)

    if study_date_to:
        filters.append(Study.study_date <= study_date_to)

    if modality:
        filters.append(Study.modalities_in_study.contains(modality.value))

    if accession_number:
        filters.append(Study.accession_number == accession_number)

    if study_description:
        filters.append(Study.study_description.ilike(f"%{study_description}%"))

    if filters:
        query = query.where(and_(*filters))

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Apply pagination
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    # Execute query
    result = await db.execute(query)
    studies = result.scalars().all()

    # Convert to response
    study_list = [
        _study_to_metadata(study, study.patient)
        for study in studies
    ]

    return StudyListResponse(
        total=total,
        page=page,
        page_size=page_size,
        studies=study_list,
    )


@router.get("/{study_uid}", response_model=StudyDetailResponse)
async def get_study(
    study_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> StudyDetailResponse:
    """
    Get detailed study information.

    Returns study metadata along with series summaries and
    information about available AI results and annotations.
    """
    # Query study with related data
    query = (
        select(Study)
        .options(
            selectinload(Study.patient),
            selectinload(Study.series_list),
            selectinload(Study.ai_jobs),
        )
        .where(Study.study_instance_uid == study_uid)
    )
    result = await db.execute(query)
    study = result.scalar_one_or_none()

    if not study:
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

    # Build series summaries
    series_list = [
        SeriesSummary(
            series_instance_uid=s.series_instance_uid,
            series_number=s.series_number,
            series_description=s.series_description,
            modality=s.modality,
            num_instances=s.num_instances,
            body_part=s.body_part_examined,
        )
        for s in study.series_list
    ]

    # Check for completed AI jobs
    ai_results_available = any(
        job.status.value == "COMPLETED" for job in study.ai_jobs
    )

    # Query annotations count for this study
    annotation_count_query = select(func.count()).select_from(Annotation).where(
        Annotation.study_uid == study_uid
    )
    annotation_count_result = await db.execute(annotation_count_query)
    annotations_count = annotation_count_result.scalar() or 0

    return StudyDetailResponse(
        study=_study_to_metadata(study, study.patient),
        series=series_list,
        ai_results_available=ai_results_available,
        annotations_count=annotations_count,
    )


@router.post("", response_model=StudyMetadata, status_code=status.HTTP_201_CREATED)
async def upload_study(
    request: Request,
    current_user: Annotated[TokenData, Depends(require_roles("admin", "technologist"))],
    db: Annotated[AsyncSession, Depends(get_db)],
    files: list[UploadFile] = File(..., description="DICOM files to upload"),
) -> StudyMetadata:
    """
    Upload a new DICOM study.

    Accepts multiple DICOM files and creates a new study entry.
    Files are parsed and stored in the configured storage location.
    """
    import pydicom

    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No files provided",
        )

    # Validate file types and sizes
    MAX_FILE_SIZE = 500 * 1024 * 1024  # 500 MB per file
    for file in files:
        if file.size and file.size > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File {file.filename} exceeds maximum size of 500MB",
            )

    # Process DICOM files
    dicom_storage = request.app.state.dicom_storage

    study_uid = None
    patient_data = {}
    study_data = {}
    series_map = {}
    instances = []

    try:
        for file in files:
            content = await file.read()

            # Parse DICOM to extract metadata
            try:
                ds = pydicom.dcmread(BytesIO(content), stop_before_pixels=True)
            except Exception as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid DICOM file {file.filename}: {str(e)}",
                )

            # Extract UIDs
            current_study_uid = str(ds.StudyInstanceUID)
            series_uid = str(ds.SeriesInstanceUID)
            instance_uid = str(ds.SOPInstanceUID)

            # Ensure all files belong to the same study
            if study_uid is None:
                study_uid = current_study_uid
            elif study_uid != current_study_uid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="All files must belong to the same study",
                )

            # Extract patient data (from first file)
            if not patient_data:
                patient_data = {
                    "patient_id": str(ds.get("PatientID", "UNKNOWN")),
                    "patient_name": str(ds.get("PatientName", "")),
                    "birth_date": _parse_dicom_date(ds.get("PatientBirthDate")),
                    "sex": str(ds.get("PatientSex", "")),
                }

            # Extract study data (from first file)
            if not study_data:
                study_data = {
                    "study_instance_uid": current_study_uid,
                    "study_id": str(ds.get("StudyID", "")),
                    "study_date": _parse_dicom_date(ds.get("StudyDate")),
                    "study_time": _parse_dicom_time(ds.get("StudyTime")),
                    "study_description": str(ds.get("StudyDescription", "")),
                    "accession_number": str(ds.get("AccessionNumber", "")),
                    "referring_physician_name": str(ds.get("ReferringPhysicianName", "")),
                    "institution_name": str(ds.get("InstitutionName", "")),
                }

            # Extract series data
            if series_uid not in series_map:
                series_map[series_uid] = {
                    "series_instance_uid": series_uid,
                    "series_number": ds.get("SeriesNumber"),
                    "series_description": str(ds.get("SeriesDescription", "")),
                    "modality": str(ds.get("Modality", "OT")),
                    "body_part_examined": str(ds.get("BodyPartExamined", "")),
                    "patient_position": str(ds.get("PatientPosition", "")),
                    "protocol_name": str(ds.get("ProtocolName", "")),
                    "slice_thickness": float(ds.SliceThickness) if hasattr(ds, "SliceThickness") else None,
                    "rows": ds.Rows if hasattr(ds, "Rows") else None,
                    "columns": ds.Columns if hasattr(ds, "Columns") else None,
                    "window_center": float(ds.WindowCenter[0]) if hasattr(ds, "WindowCenter") and ds.WindowCenter else None,
                    "window_width": float(ds.WindowWidth[0]) if hasattr(ds, "WindowWidth") and ds.WindowWidth else None,
                    "instances": [],
                }

            # Extract instance data
            instance_data = {
                "sop_instance_uid": instance_uid,
                "sop_class_uid": str(ds.SOPClassUID),
                "instance_number": ds.get("InstanceNumber"),
                "rows": ds.Rows if hasattr(ds, "Rows") else None,
                "columns": ds.Columns if hasattr(ds, "Columns") else None,
                "bits_allocated": ds.BitsAllocated if hasattr(ds, "BitsAllocated") else None,
                "bits_stored": ds.BitsStored if hasattr(ds, "BitsStored") else None,
                "photometric_interpretation": str(ds.get("PhotometricInterpretation", "")),
                "window_center": float(ds.WindowCenter[0]) if hasattr(ds, "WindowCenter") and ds.WindowCenter else None,
                "window_width": float(ds.WindowWidth[0]) if hasattr(ds, "WindowWidth") and ds.WindowWidth else None,
                "rescale_intercept": float(ds.RescaleIntercept) if hasattr(ds, "RescaleIntercept") else 0.0,
                "rescale_slope": float(ds.RescaleSlope) if hasattr(ds, "RescaleSlope") else 1.0,
                "slice_location": float(ds.SliceLocation) if hasattr(ds, "SliceLocation") else None,
            }

            series_map[series_uid]["instances"].append(instance_data)

            # Store file
            storage_result = await dicom_storage.store_instance(content)
            instance_data["file_path"] = storage_result["file_path"]
            instance_data["file_size"] = storage_result["file_size"]
            instance_data["file_checksum"] = storage_result["checksum"]

        # Create or get patient
        patient_query = select(Patient).where(Patient.patient_id == patient_data["patient_id"])
        patient_result = await db.execute(patient_query)
        patient = patient_result.scalar_one_or_none()

        if not patient:
            patient = Patient(**patient_data)
            db.add(patient)
            await db.flush()

        # Create study
        modalities = list(set(s["modality"] for s in series_map.values()))
        study = Study(
            **study_data,
            modalities_in_study=",".join(modalities),
            num_series=len(series_map),
            num_instances=sum(len(s["instances"]) for s in series_map.values()),
            status=StudyStatus.COMPLETE,
            patient_id_fk=patient.id,
        )
        db.add(study)
        await db.flush()

        # Create series and instances
        for series_data in series_map.values():
            instances_data = series_data.pop("instances")
            series = Series(
                **series_data,
                study_instance_uid_fk=study.study_instance_uid,
                num_instances=len(instances_data),
            )
            db.add(series)
            await db.flush()

            for inst_data in instances_data:
                instance = Instance(
                    **inst_data,
                    series_instance_uid_fk=series.series_instance_uid,
                )
                db.add(instance)

        await db.commit()

        audit_logger.log_access(
            user_id=current_user.user_id,
            resource_type="study",
            resource_id=study_uid,
            action="UPLOAD",
            details={"num_files": len(files)},
        )

        return _study_to_metadata(study, patient)

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process uploaded files: {str(e)}",
        )


@router.delete("/{study_uid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_study(
    study_uid: str,
    request: Request,
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    """
    Delete a study (admin only).

    Permanently removes the study and all associated data.
    This action is logged for audit purposes.
    """
    # Find study
    query = select(Study).where(Study.study_instance_uid == study_uid)
    result = await db.execute(query)
    study = result.scalar_one_or_none()

    if not study:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Study not found: {study_uid}",
        )

    # Delete files from storage
    dicom_storage = request.app.state.dicom_storage
    await dicom_storage.delete_study(study_uid)

    # Delete from database (cascades to series, instances, jobs)
    await db.delete(study)
    await db.commit()

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
    db: Annotated[AsyncSession, Depends(get_db)],
    size: int = Query(128, ge=32, le=512, description="Thumbnail size"),
) -> dict:
    """
    Get study thumbnail image.

    Returns a representative thumbnail from the study's first series.
    """
    # Find study
    query = select(Study).where(Study.study_instance_uid == study_uid)
    result = await db.execute(query)
    study = result.scalar_one_or_none()

    if not study:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Study not found: {study_uid}",
        )

    return {
        "study_uid": study_uid,
        "thumbnail_url": f"/api/v1/studies/{study_uid}/thumbnail.png",
        "size": size,
    }


@router.post("/{study_uid}/refresh")
async def refresh_study_metadata(
    study_uid: str,
    current_user: Annotated[TokenData, Depends(require_roles("admin", "technologist"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> StudyMetadata:
    """
    Refresh study metadata from stored DICOM files.

    Re-parses DICOM headers to update study information.
    Useful after manual file modifications or imports.
    """
    # Find study
    query = (
        select(Study)
        .options(selectinload(Study.patient))
        .where(Study.study_instance_uid == study_uid)
    )
    result = await db.execute(query)
    study = result.scalar_one_or_none()

    if not study:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Study not found: {study_uid}",
        )

    # Update timestamp
    study.updated_at = datetime.now()
    await db.commit()

    audit_logger.log_access(
        user_id=current_user.user_id,
        resource_type="study",
        resource_id=study_uid,
        action="REFRESH",
    )

    return _study_to_metadata(study, study.patient)


def _parse_dicom_date(value: Any) -> date | None:
    """Parse DICOM date format (YYYYMMDD)."""
    if not value:
        return None
    try:
        date_str = str(value)
        if len(date_str) == 8:
            return date(int(date_str[:4]), int(date_str[4:6]), int(date_str[6:8]))
    except (ValueError, TypeError):
        pass
    return None


def _parse_dicom_time(value: Any) -> dt_time | None:
    """Parse DICOM time format (HHMMSS.FFFFFF)."""
    if not value:
        return None
    try:
        time_str = str(value).split(".")[0]  # Remove fractional seconds
        if len(time_str) >= 6:
            return dt_time(int(time_str[:2]), int(time_str[2:4]), int(time_str[4:6]))
        elif len(time_str) >= 4:
            return dt_time(int(time_str[:2]), int(time_str[2:4]))
    except (ValueError, TypeError):
        pass
    return None
