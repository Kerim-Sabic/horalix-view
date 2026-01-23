"""Study management endpoints for Horalix View.

Provides CRUD operations for DICOM studies with support for
filtering, pagination, and metadata retrieval.
"""

from datetime import date, datetime
from datetime import time as dt_time
from enum import Enum
import hashlib
from typing import Annotated, Any
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
import aiofiles
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints.auth import get_current_active_user, require_roles
from app.core.config import get_settings
from app.core.logging import audit_logger
from app.core.security import TokenData
from app.models.annotation import Annotation
from app.models.base import get_db
from app.models.instance import Instance
from app.models.patient import Patient
from app.models.series import Series
from app.models.study import Study, StudyStatus

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


class StudyUpdate(BaseModel):
    """Editable study metadata fields."""

    study_id: str | None = Field(None, description="Study ID")
    study_date: date | None = Field(None, description="Study date")
    study_time: dt_time | None = Field(None, description="Study time")
    study_description: str | None = Field(None, description="Study description")
    accession_number: str | None = Field(None, description="Accession number")
    referring_physician_name: str | None = Field(None, description="Referring physician")
    institution_name: str | None = Field(None, description="Institution name")
    modalities_in_study: list[str] | None = Field(
        None, description="Modalities in study (e.g., ['CT', 'MR'])"
    )


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


def _normalize_optional_str(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


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
    """List studies with filtering and pagination.

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
    study_list = [_study_to_metadata(study, study.patient) for study in studies]

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
    """Get detailed study information.

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
    ai_results_available = any(job.status.value == "COMPLETED" for job in study.ai_jobs)

    # Query annotations count for this study
    annotation_count_query = (
        select(func.count()).select_from(Annotation).where(Annotation.study_uid == study_uid)
    )
    annotation_count_result = await db.execute(annotation_count_query)
    annotations_count = annotation_count_result.scalar() or 0

    return StudyDetailResponse(
        study=_study_to_metadata(study, study.patient),
        series=series_list,
        ai_results_available=ai_results_available,
        annotations_count=annotations_count,
    )


@router.patch("/{study_uid}", response_model=StudyMetadata)
async def update_study(
    study_uid: str,
    payload: StudyUpdate,
    current_user: Annotated[TokenData, Depends(require_roles("admin", "technologist", "radiologist"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> StudyMetadata:
    """Update study metadata."""
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

    updated_fields: list[str] = []
    if payload.study_id is not None:
        study.study_id = _normalize_optional_str(payload.study_id)
        updated_fields.append("study_id")
    if payload.study_date is not None:
        study.study_date = payload.study_date
        updated_fields.append("study_date")
    if payload.study_time is not None:
        study.study_time = payload.study_time
        updated_fields.append("study_time")
    if payload.study_description is not None:
        study.study_description = _normalize_optional_str(payload.study_description)
        updated_fields.append("study_description")
    if payload.accession_number is not None:
        study.accession_number = _normalize_optional_str(payload.accession_number)
        updated_fields.append("accession_number")
    if payload.referring_physician_name is not None:
        study.referring_physician_name = _normalize_optional_str(payload.referring_physician_name)
        updated_fields.append("referring_physician_name")
    if payload.institution_name is not None:
        study.institution_name = _normalize_optional_str(payload.institution_name)
        updated_fields.append("institution_name")
    if payload.modalities_in_study is not None:
        filtered = [m.strip() for m in payload.modalities_in_study if m and m.strip()]
        study.modalities_list = filtered
        updated_fields.append("modalities_in_study")

    await db.commit()
    await db.refresh(study)

    audit_logger.log_access(
        user_id=current_user.user_id,
        resource_type="study",
        resource_id=study_uid,
        action="UPDATE_METADATA",
        details={"fields": updated_fields},
    )

    return _study_to_metadata(study, study.patient)


@router.post("", response_model=StudyMetadata, status_code=status.HTTP_201_CREATED)
@router.post("/upload", response_model=StudyMetadata, status_code=status.HTTP_201_CREATED)
async def upload_study(
    request: Request,
    current_user: Annotated[TokenData, Depends(require_roles("admin", "technologist"))],
    db: Annotated[AsyncSession, Depends(get_db)],
    files: list[UploadFile] = File(..., description="DICOM files to upload"),
) -> StudyMetadata:
    """Upload a new DICOM study.

    Accepts multiple DICOM files and creates a new study entry.
    Files are streamed to disk, validated, and then indexed.
    """
    import pydicom

    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No files provided",
        )

    settings = get_settings()
    max_upload_bytes = int(settings.dicom.max_upload_size_gb * 1024 * 1024 * 1024)
    chunk_size = 4 * 1024 * 1024  # 4MB

    dicom_storage = request.app.state.dicom_storage

    study_uid = None
    patient_data: dict[str, Any] = {}
    study_data: dict[str, Any] = {}
    series_map: dict[str, Any] = {}
    total_bytes = 0
    stored_files: list[str] = []

    async def _cleanup_temp(temp_path: Any) -> None:
        try:
            await aiofiles.os.remove(temp_path)
        except Exception:
            pass

    try:
        for file in files:
            file_name = file.filename or "upload.dcm"
            temp_path = dicom_storage.temp_dir / f"{uuid4().hex}.dcm"
            file_bytes = 0
            checksum = hashlib.sha256()

            try:
                async with aiofiles.open(temp_path, "wb") as out_file:
                    while True:
                        chunk = await file.read(chunk_size)
                        if not chunk:
                            break
                        file_bytes += len(chunk)
                        total_bytes += len(chunk)

                        if max_upload_bytes and (
                            file_bytes > max_upload_bytes or total_bytes > max_upload_bytes
                        ):
                            await _cleanup_temp(temp_path)
                            raise HTTPException(
                                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                                detail=(
                                    f"Upload exceeds max size of {settings.dicom.max_upload_size_gb}GB"
                                ),
                            )

                        checksum.update(chunk)
                        await out_file.write(chunk)
            finally:
                await file.close()

            if file_bytes == 0:
                await _cleanup_temp(temp_path)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"File {file_name} is empty",
                )

            # Parse DICOM to extract metadata
            try:
                ds = pydicom.dcmread(str(temp_path), stop_before_pixels=True)
            except Exception as e:
                await _cleanup_temp(temp_path)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid DICOM file {file_name}: {str(e)}",
                )

            # Extract required UIDs
            current_study_uid_value = getattr(ds, "StudyInstanceUID", None)
            series_uid_value = getattr(ds, "SeriesInstanceUID", None)
            instance_uid_value = getattr(ds, "SOPInstanceUID", None)
            sop_class_uid_value = getattr(ds, "SOPClassUID", None) or getattr(
                getattr(ds, "file_meta", None), "MediaStorageSOPClassUID", None
            )

            missing_fields = []
            if not current_study_uid_value:
                missing_fields.append("StudyInstanceUID")
            if not series_uid_value:
                missing_fields.append("SeriesInstanceUID")
            if not instance_uid_value:
                missing_fields.append("SOPInstanceUID")
            if not sop_class_uid_value:
                missing_fields.append("SOPClassUID")

            if missing_fields:
                await _cleanup_temp(temp_path)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Missing required DICOM fields: {', '.join(missing_fields)}",
                )

            current_study_uid = str(current_study_uid_value)
            series_uid = str(series_uid_value)
            instance_uid = str(instance_uid_value)
            sop_class_uid = str(sop_class_uid_value)

            # Ensure all files belong to the same study
            if study_uid is None:
                study_uid = current_study_uid
            elif study_uid != current_study_uid:
                await _cleanup_temp(temp_path)
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
                pixel_spacing_value = None
                if hasattr(ds, "PixelSpacing") and ds.PixelSpacing:
                    pixel_spacing_value = (
                        float(ds.PixelSpacing[0]),
                        float(ds.PixelSpacing[1]),
                    )
                elif hasattr(ds, "ImagerPixelSpacing") and ds.ImagerPixelSpacing:
                    pixel_spacing_value = (
                        float(ds.ImagerPixelSpacing[0]),
                        float(ds.ImagerPixelSpacing[1]),
                    )

                series_map[series_uid] = {
                    "series_instance_uid": series_uid,
                    "series_number": ds.get("SeriesNumber"),
                    "series_description": str(ds.get("SeriesDescription", "")),
                    "modality": str(ds.get("Modality", "OT")),
                    "series_date": _parse_dicom_date(ds.get("SeriesDate")),
                    "series_time": _parse_dicom_time(ds.get("SeriesTime")),
                    "body_part_examined": str(ds.get("BodyPartExamined", "")),
                    "patient_position": str(ds.get("PatientPosition", "")),
                    "protocol_name": str(ds.get("ProtocolName", "")),
                    "slice_thickness": (
                        float(ds.SliceThickness) if hasattr(ds, "SliceThickness") else None
                    ),
                    "spacing_between_slices": (
                        float(ds.SpacingBetweenSlices)
                        if hasattr(ds, "SpacingBetweenSlices")
                        else None
                    ),
                    "rows": ds.Rows if hasattr(ds, "Rows") else None,
                    "columns": ds.Columns if hasattr(ds, "Columns") else None,
                    "pixel_spacing": (
                        f"{pixel_spacing_value[0]}\\{pixel_spacing_value[1]}"
                        if pixel_spacing_value
                        else None
                    ),
                    "window_center": (
                        float(ds.WindowCenter[0])
                        if hasattr(ds, "WindowCenter") and ds.WindowCenter
                        else None
                    ),
                    "window_width": (
                        float(ds.WindowWidth[0])
                        if hasattr(ds, "WindowWidth") and ds.WindowWidth
                        else None
                    ),
                    "instances": [],
                }

            # Extract instance data
            instance_data = {
                "sop_instance_uid": instance_uid,
                "sop_class_uid": sop_class_uid,
                "instance_number": ds.get("InstanceNumber"),
                "rows": ds.Rows if hasattr(ds, "Rows") else None,
                "columns": ds.Columns if hasattr(ds, "Columns") else None,
                "bits_allocated": ds.BitsAllocated if hasattr(ds, "BitsAllocated") else None,
                "bits_stored": ds.BitsStored if hasattr(ds, "BitsStored") else None,
                "high_bit": ds.HighBit if hasattr(ds, "HighBit") else None,
                "pixel_representation": (
                    ds.PixelRepresentation if hasattr(ds, "PixelRepresentation") else None
                ),
                "samples_per_pixel": (
                    ds.SamplesPerPixel if hasattr(ds, "SamplesPerPixel") else None
                ),
                "photometric_interpretation": str(ds.get("PhotometricInterpretation", "")),
                "transfer_syntax_uid": (
                    str(ds.file_meta.TransferSyntaxUID)
                    if getattr(ds, "file_meta", None) and getattr(ds.file_meta, "TransferSyntaxUID", None)
                    else None
                ),
                "pixel_spacing": (
                    f"{float(ds.PixelSpacing[0])}\\{float(ds.PixelSpacing[1])}"
                    if hasattr(ds, "PixelSpacing") and ds.PixelSpacing
                    else None
                ),
                "image_position_patient": (
                    "\\".join(str(v) for v in ds.ImagePositionPatient)
                    if hasattr(ds, "ImagePositionPatient") and ds.ImagePositionPatient
                    else None
                ),
                "image_orientation_patient": (
                    "\\".join(str(v) for v in ds.ImageOrientationPatient)
                    if hasattr(ds, "ImageOrientationPatient") and ds.ImageOrientationPatient
                    else None
                ),
                "window_center": (
                    float(ds.WindowCenter[0])
                    if hasattr(ds, "WindowCenter") and ds.WindowCenter
                    else None
                ),
                "window_width": (
                    float(ds.WindowWidth[0])
                    if hasattr(ds, "WindowWidth") and ds.WindowWidth
                    else None
                ),
                "rescale_intercept": (
                    float(ds.RescaleIntercept) if hasattr(ds, "RescaleIntercept") else 0.0
                ),
                "rescale_slope": float(ds.RescaleSlope) if hasattr(ds, "RescaleSlope") else 1.0,
                "slice_location": float(ds.SliceLocation) if hasattr(ds, "SliceLocation") else None,
                "slice_thickness": (
                    float(ds.SliceThickness) if hasattr(ds, "SliceThickness") else None
                ),
                "number_of_frames": int(ds.NumberOfFrames)
                if hasattr(ds, "NumberOfFrames") and ds.NumberOfFrames
                else 1,
            }

            series_map[series_uid]["instances"].append(instance_data)

            # Store file from disk
            storage_result = await dicom_storage.store_instance_file(
                temp_path,
                ds,
                checksum.hexdigest(),
                file_bytes,
            )
            instance_data["file_path"] = storage_result["file_path"]
            instance_data["file_size"] = storage_result["file_size"]
            instance_data["file_checksum"] = storage_result["checksum"]
            stored_files.append(storage_result["file_path"])

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
        await db.rollback()
        for path in stored_files:
            try:
                await aiofiles.os.remove(path)
            except Exception:
                pass
        raise
    except Exception as e:
        await db.rollback()
        for path in stored_files:
            try:
                await aiofiles.os.remove(path)
            except Exception:
                pass
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
    """Delete a study (admin only).

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
    """Get study thumbnail image.

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
    """Refresh study metadata from stored DICOM files.

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
        if len(time_str) >= 4:
            return dt_time(int(time_str[:2]), int(time_str[2:4]))
    except (ValueError, TypeError):
        pass
    return None
