"""Export endpoints for Horalix View.

Handles data export in various formats including DICOM, images, reports, and anonymized data.
"""

from datetime import datetime
from enum import Enum
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.v1.endpoints.auth import get_current_active_user
from app.core.logging import audit_logger
from app.core.security import TokenData

router = APIRouter()


class ExportFormat(str, Enum):
    """Available export formats."""

    DICOM = "dicom"
    NIFTI = "nifti"
    PNG = "png"
    JPEG = "jpeg"
    TIFF = "tiff"
    PDF = "pdf"
    MP4 = "mp4"
    GIF = "gif"


class ExportType(str, Enum):
    """Types of exports."""

    STUDY = "study"
    SERIES = "series"
    INSTANCES = "instances"
    REPORT = "report"
    ANNOTATIONS = "annotations"
    AI_RESULTS = "ai_results"
    VOLUME = "volume"


class ExportStatus(str, Enum):
    """Export job status."""

    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class AnonymizationOptions(BaseModel):
    """Anonymization configuration."""

    remove_patient_name: bool = True
    remove_patient_id: bool = True
    remove_birth_date: bool = True
    retain_patient_characteristics: bool = True  # Keep age, sex
    remove_institution: bool = True
    remove_referring_physician: bool = True
    remove_dates: bool = False
    generate_new_uids: bool = True
    custom_patient_id: str | None = None


class ExportRequest(BaseModel):
    """Export request parameters."""

    export_type: ExportType
    format: ExportFormat
    study_uids: list[str] = Field(default_factory=list)
    series_uids: list[str] = Field(default_factory=list)
    instance_uids: list[str] = Field(default_factory=list)
    anonymize: bool = False
    anonymization_options: AnonymizationOptions | None = None
    include_annotations: bool = False
    include_ai_results: bool = False
    quality: int = Field(90, ge=1, le=100, description="Quality for lossy formats")
    window_center: float | None = None
    window_width: float | None = None


class ExportJob(BaseModel):
    """Export job information."""

    job_id: str
    export_type: ExportType
    format: ExportFormat
    status: ExportStatus
    progress: float = 0.0
    created_at: datetime
    completed_at: datetime | None = None
    download_url: str | None = None
    file_size_bytes: int | None = None
    error_message: str | None = None


class ExportListResponse(BaseModel):
    """Export job list response."""

    total: int
    jobs: list[ExportJob]


# Simulated export jobs database
EXPORT_JOBS_DB: dict[str, dict] = {}


@router.post("", response_model=ExportJob, status_code=status.HTTP_202_ACCEPTED)
async def create_export(
    request: ExportRequest,
    background_tasks: BackgroundTasks,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> ExportJob:
    """Create an export job.

    Starts an asynchronous export process for the specified data.
    Returns immediately with a job ID for status tracking.
    """
    # Validate input
    if not request.study_uids and not request.series_uids and not request.instance_uids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Must specify at least one study, series, or instance",
        )

    job_id = str(uuid4())
    job = ExportJob(
        job_id=job_id,
        export_type=request.export_type,
        format=request.format,
        status=ExportStatus.PENDING,
        created_at=datetime.now(),
    )

    EXPORT_JOBS_DB[job_id] = job.model_dump()

    # Log export request
    resource_ids = request.study_uids + request.series_uids + request.instance_uids
    audit_logger.log_data_export(
        user_id=current_user.user_id,
        export_type=request.export_type.value,
        resource_ids=resource_ids,
        format=request.format.value,
        anonymized=request.anonymize,
    )

    # Start background export
    background_tasks.add_task(process_export, job_id, request)

    return job


@router.get("", response_model=ExportListResponse)
async def list_exports(
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    status: ExportStatus | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
) -> ExportListResponse:
    """List export jobs."""
    jobs = list(EXPORT_JOBS_DB.values())

    if status:
        jobs = [j for j in jobs if j.get("status") == status.value]

    jobs.sort(key=lambda j: j.get("created_at", ""), reverse=True)

    return ExportListResponse(
        total=len(jobs),
        jobs=[ExportJob(**j) for j in jobs[:limit]],
    )


@router.get("/{job_id}", response_model=ExportJob)
async def get_export(
    job_id: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> ExportJob:
    """Get export job status."""
    if job_id not in EXPORT_JOBS_DB:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Export job not found: {job_id}",
        )

    return ExportJob(**EXPORT_JOBS_DB[job_id])


@router.get("/{job_id}/download")
async def download_export(
    job_id: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> StreamingResponse:
    """Download exported file."""
    if job_id not in EXPORT_JOBS_DB:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Export job not found: {job_id}",
        )

    job = EXPORT_JOBS_DB[job_id]
    if job.get("status") != ExportStatus.COMPLETED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Export not yet completed",
        )

    # In production, stream the actual file
    from io import BytesIO

    content = b"Exported data placeholder"
    buffer = BytesIO(content)

    format_map = {
        ExportFormat.DICOM.value: "application/dicom",
        ExportFormat.NIFTI.value: "application/gzip",
        ExportFormat.PNG.value: "image/png",
        ExportFormat.JPEG.value: "image/jpeg",
        ExportFormat.TIFF.value: "image/tiff",
        ExportFormat.PDF.value: "application/pdf",
        ExportFormat.MP4.value: "video/mp4",
        ExportFormat.GIF.value: "image/gif",
    }

    media_type = format_map.get(job.get("format"), "application/octet-stream")

    return StreamingResponse(
        buffer,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename=export_{job_id}.zip"},
    )


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_export(
    job_id: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> None:
    """Cancel or delete an export job."""
    if job_id not in EXPORT_JOBS_DB:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Export job not found: {job_id}",
        )

    del EXPORT_JOBS_DB[job_id]


@router.post("/quick-export")
async def quick_export(
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    study_uid: str = Query(...),
    format: ExportFormat = Query(ExportFormat.PNG),
    instance_uid: str | None = Query(None),
) -> StreamingResponse:
    """Quick synchronous export of a single image.

    For small exports that can be completed immediately.
    """
    from io import BytesIO

    import numpy as np
    from PIL import Image

    # Generate placeholder image
    size = 512
    x = np.linspace(0, 1, size)
    y = np.linspace(0, 1, size)
    xx, yy = np.meshgrid(x, y)
    data = ((np.sin(xx * 10) * np.cos(yy * 10) + 1) * 127).astype(np.uint8)

    img = Image.fromarray(data, mode="L")
    buffer = BytesIO()

    if format == ExportFormat.PNG:
        img.save(buffer, format="PNG")
        media_type = "image/png"
        ext = "png"
    elif format == ExportFormat.JPEG:
        img.save(buffer, format="JPEG", quality=90)
        media_type = "image/jpeg"
        ext = "jpg"
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Quick export not supported for format: {format}",
        )

    buffer.seek(0)

    audit_logger.log_data_export(
        user_id=current_user.user_id,
        export_type="quick_export",
        resource_ids=[instance_uid or study_uid],
        format=format.value,
    )

    return StreamingResponse(
        buffer,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename=image.{ext}"},
    )


async def process_export(job_id: str, request: ExportRequest) -> None:
    """Process export job in background."""
    import asyncio

    if job_id not in EXPORT_JOBS_DB:
        return

    job = EXPORT_JOBS_DB[job_id]
    job["status"] = ExportStatus.PROCESSING.value

    try:
        # Simulate processing
        for i in range(10):
            await asyncio.sleep(0.3)
            job["progress"] = (i + 1) * 10

        job["status"] = ExportStatus.COMPLETED.value
        job["completed_at"] = datetime.now().isoformat()
        job["progress"] = 100
        job["download_url"] = f"/api/v1/export/{job_id}/download"
        job["file_size_bytes"] = 1024 * 1024  # 1MB placeholder

    except Exception as e:
        job["status"] = ExportStatus.FAILED.value
        job["error_message"] = str(e)


# ============================================================================
# DICOM Export with Measurements (Real DICOM Files)
# ============================================================================


class DicomMeasurementExportRequest(BaseModel):
    """Request for DICOM export with measurements."""

    study_uid: str
    series_uid: str
    patient_id: str | None = None
    patient_name: str | None = None
    patient_birth_date: str | None = None
    patient_sex: str | None = None
    issuer_of_patient_id: str | None = None
    other_patient_ids: str | None = None
    ethnic_group: str | None = None
    patient_comments: str | None = None
    study_id: str | None = None
    study_date: str | None = None
    study_time: str | None = None
    study_description: str | None = None
    accession_number: str | None = None
    referring_physician_name: str | None = None
    series_description: str | None = None
    series_number: int | None = None
    body_part_examined: str | None = None
    patient_position: str | None = None
    protocol_name: str | None = None
    slice_thickness: float | None = None
    spacing_between_slices: float | None = None
    window_center: float | None = None
    window_width: float | None = None
    modality: str = "US"
    measurements: list[dict] = Field(default_factory=list)
    tracking_data: list[dict] = Field(default_factory=list)
    segmentations: list[dict] = Field(default_factory=list)
    include_sr: bool = True
    include_seg: bool = True
    include_original: bool = True
    author_name: str | None = None
    institution_name: str | None = None


@router.post("/dicom-measurements")
async def export_dicom_with_measurements(
    request: DicomMeasurementExportRequest,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> StreamingResponse:
    """Export measurements as real DICOM Structured Report.

    Creates a ZIP package containing:
    - DICOM SR (Structured Report) with all measurements
    - DICOM SEG (Segmentation) for AI results (if provided)
    - Original DICOM images (optional)

    This produces REAL DICOM files that can be imported into any PACS system.
    """
    from pathlib import Path

    from app.core.config import get_settings
    from app.services.dicom.export import (
        DicomExportService,
        ExportRequest as DicomExportRequest,
        MeasurementExport,
        Point2D,
        SegmentationExport,
        TrackingExport,
        TrackingFrameExport,
    )

    settings = get_settings()
    storage_dir = Path(settings.dicom_storage_path)

    # Initialize export service
    export_service = DicomExportService(storage_dir)
    await export_service.initialize()

    # Convert measurements to export format
    measurements = []
    for m in request.measurements:
        points = [Point2D(x=p["x"], y=p["y"]) for p in m.get("points", [])]
        measurements.append(
            MeasurementExport(
                id=m.get("id", ""),
                type=m.get("type", "line"),
                label=m.get("label"),
                points=points,
                length_mm=m.get("length_mm") or m.get("lengthMm"),
                area_mm2=m.get("area_mm2") or m.get("areaMm2"),
                perimeter_mm=m.get("perimeter_mm") or m.get("perimeterMm"),
                frame_index=m.get("frame_index") or m.get("frameIndex"),
                series_uid=m.get("series_uid") or m.get("seriesUid") or request.series_uid,
                instance_uid=m.get("instance_uid") or m.get("instanceUid"),
            )
        )

    # Convert tracking data
    tracking_data = []
    for t in request.tracking_data:
        frames = []
        for f in t.get("frames", []):
            frames.append(
                TrackingFrameExport(
                    frame_index=f.get("frame_index") or f.get("frameIndex", 0),
                    value=f.get("value") or f.get("lengthMm") or f.get("areaMm2") or 0,
                    unit=t.get("unit", "mm"),
                )
            )
        tracking_data.append(
            TrackingExport(
                measurement_id=t.get("measurement_id") or t.get("measurementId", ""),
                label=t.get("label"),
                frames=frames,
                min_value=t.get("min_value") or t.get("minMm"),
                max_value=t.get("max_value") or t.get("maxMm"),
                mean_value=t.get("mean_value") or t.get("meanMm"),
                unit=t.get("unit", "mm"),
            )
        )

    # Convert segmentations
    segmentations = []
    for s in request.segmentations:
        segmentations.append(
            SegmentationExport(
                id=s.get("id", ""),
                label=s.get("label", "Segmentation"),
                color=tuple(s.get("color", [255, 0, 0])),
                mask_data=s.get("mask_data") or s.get("maskData", []),
                frame_index=s.get("frame_index") or s.get("frameIndex"),
                instance_uid=s.get("instance_uid") or s.get("instanceUid"),
            )
        )

    # Create export request
    export_request = DicomExportRequest(
        study_uid=request.study_uid,
        series_uid=request.series_uid,
        patient_id=request.patient_id,
        patient_name=request.patient_name,
        patient_birth_date=request.patient_birth_date,
        patient_sex=request.patient_sex,
        issuer_of_patient_id=request.issuer_of_patient_id,
        other_patient_ids=request.other_patient_ids,
        ethnic_group=request.ethnic_group,
        patient_comments=request.patient_comments,
        study_id=request.study_id,
        study_date=request.study_date,
        study_time=request.study_time,
        study_description=request.study_description,
        accession_number=request.accession_number,
        referring_physician_name=request.referring_physician_name,
        series_description=request.series_description,
        series_number=request.series_number,
        body_part_examined=request.body_part_examined,
        patient_position=request.patient_position,
        protocol_name=request.protocol_name,
        slice_thickness=request.slice_thickness,
        spacing_between_slices=request.spacing_between_slices,
        window_center=request.window_center,
        window_width=request.window_width,
        modality=request.modality,
        measurements=measurements,
        tracking_data=tracking_data,
        segmentations=segmentations,
        include_sr=request.include_sr,
        include_seg=request.include_seg and len(segmentations) > 0,
        include_original=request.include_original,
        author_name=request.author_name,
        institution_name=request.institution_name,
    )

    # Create export package
    zip_bytes, filename = await export_service.create_export_package(export_request)

    # Log export
    audit_logger.log_data_export(
        user_id=current_user.user_id,
        export_type="dicom_measurements",
        resource_ids=[request.study_uid, request.series_uid],
        format="dicom",
        anonymized=False,
    )

    # Return as streaming response
    from io import BytesIO

    buffer = BytesIO(zip_bytes)

    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
