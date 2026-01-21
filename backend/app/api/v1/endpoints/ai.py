"""AI inference endpoints for Horalix View.

IMPORTANT: This module performs REAL AI inference only.
NO simulated, placeholder, or fake outputs are permitted.
If a model is not available, endpoints return clear error messages.
"""

import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any
from uuid import uuid4

import numpy as np
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_active_user, require_roles
from app.core.config import get_settings
from app.core.logging import audit_logger, get_logger
from app.core.security import TokenData
from app.models.base import get_db
from app.models.job import AIJob, JobStatus, ModelType, TaskType
from app.models.series import Series
from app.models.study import Study

logger = get_logger(__name__)
router = APIRouter()
settings = get_settings()


# Request/Response Models
class InferenceRequest(BaseModel):
    """AI inference request."""

    study_uid: str = Field(..., description="Study to analyze")
    series_uid: str | None = Field(None, description="Specific series (optional)")
    model_type: str = Field(..., description="AI model to use (e.g., 'yolov8', 'medsam')")
    task_type: TaskType = Field(..., description="Type of analysis")
    parameters: dict[str, Any] = Field(default_factory=dict, description="Model parameters")
    priority: int = Field(5, ge=1, le=10, description="Job priority (1=highest)")


class InferenceJobResponse(BaseModel):
    """Inference job status and results."""

    job_id: str
    study_uid: str
    series_uid: str | None
    model_type: str
    task_type: str
    status: str
    progress: float = 0.0
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_message: str | None = None
    results: dict[str, Any] | None = None
    result_files: dict[str, str] | None = None

    class Config:
        from_attributes = True


class ModelInfo(BaseModel):
    """AI model information."""

    name: str
    version: str
    model_type: str
    description: str
    supported_modalities: list[str]
    performance_metrics: dict[str, float] = {}
    reference: str | None = None
    available: bool = False
    enabled: bool = False
    weights_path: str | None = None


class ModelAvailabilityResponse(BaseModel):
    """Model availability status."""

    models: list[ModelInfo]
    total_registered: int
    total_available: int
    message: str


class SAMPrompt(BaseModel):
    """Interactive prompt for SAM/MedSAM."""

    points: list[list[int]] = Field(
        default_factory=list, description="[[x,y], ...] point coordinates"
    )
    point_labels: list[int] = Field(default_factory=list, description="1=foreground, 0=background")
    box: list[int] | None = Field(None, description="[x1, y1, x2, y2] bounding box")


class InteractiveSegmentationResponse(BaseModel):
    """Response from interactive segmentation."""

    instance_uid: str
    mask_shape: list[int]
    mask_url: str
    confidence: float
    inference_time_ms: float
    model_name: str
    model_version: str


def _job_to_response(job: AIJob) -> InferenceJobResponse:
    """Convert AIJob model to response."""
    return InferenceJobResponse(
        job_id=job.job_id,
        study_uid=job.study_instance_uid,
        series_uid=job.series_instance_uid,
        model_type=(
            job.model_type.value if hasattr(job.model_type, "value") else str(job.model_type)
        ),
        task_type=job.task_type.value,
        status=job.status.value,
        progress=job.progress or 0.0,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        error_message=job.error_message,
        results=job.results,
        result_files=job.result_files,
    )


@router.get("/models", response_model=ModelAvailabilityResponse)
async def list_models(
    http_request: Request,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    task_type: TaskType | None = Query(None, description="Filter by task type"),
    modality: str | None = Query(None, description="Filter by supported modality"),
) -> ModelAvailabilityResponse:
    """List available AI models with their availability status.

    Returns information about all registered AI models, including whether
    their weights are available for inference.
    """
    model_registry = http_request.app.state.model_registry

    # Get all registered models and their availability
    availability = model_registry.get_model_availability()
    registered_metadata = model_registry.get_registered_models()

    models = []
    for meta in registered_metadata:
        avail = availability.get(meta.name, {})

        # Filter by task type if specified
        if task_type and meta.model_type.value != task_type.value:
            continue

        # Filter by modality if specified
        if modality and modality not in meta.supported_modalities:
            continue

        models.append(
            ModelInfo(
                name=meta.name,
                version=meta.version,
                model_type=meta.model_type.value,
                description=meta.description,
                supported_modalities=meta.supported_modalities,
                performance_metrics=meta.performance_metrics or {},
                reference=meta.reference,
                available=avail.get("weights_available", False),
                enabled=avail.get("enabled", False),
                weights_path=avail.get("weights_path"),
            )
        )

    total_available = sum(1 for m in models if m.available)

    if total_available == 0:
        message = (
            "No AI models available. Place model weights in the models directory. "
            f"Models directory: {settings.ai.models_dir}"
        )
    else:
        message = f"{total_available} model(s) ready for inference"

    return ModelAvailabilityResponse(
        models=models,
        total_registered=len(models),
        total_available=total_available,
        message=message,
    )


@router.get("/models/{model_name}", response_model=ModelInfo)
async def get_model_info(
    model_name: str,
    http_request: Request,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> ModelInfo:
    """Get detailed information about a specific model."""
    model_registry = http_request.app.state.model_registry

    metadata = model_registry.get_model_metadata(model_name)
    if not metadata:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model not found: {model_name}",
        )

    availability = model_registry.get_model_availability().get(model_name, {})

    return ModelInfo(
        name=metadata.name,
        version=metadata.version,
        model_type=metadata.model_type.value,
        description=metadata.description,
        supported_modalities=metadata.supported_modalities,
        performance_metrics=metadata.performance_metrics or {},
        reference=metadata.reference,
        available=availability.get("weights_available", False),
        enabled=availability.get("enabled", False),
        weights_path=availability.get("weights_path"),
    )


@router.post("/infer", response_model=InferenceJobResponse, status_code=status.HTTP_202_ACCEPTED)
async def submit_inference(
    request: InferenceRequest,
    background_tasks: BackgroundTasks,
    http_request: Request,
    current_user: Annotated[
        TokenData, Depends(require_roles("admin", "radiologist", "researcher"))
    ],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> InferenceJobResponse:
    """Submit an AI inference job.

    Creates a new inference task that runs in the background.
    Returns immediately with a job ID for status tracking.

    IMPORTANT: This endpoint performs REAL inference only.
    If model weights are not available, the job will fail with
    a clear error message explaining how to set up the model.
    """
    model_registry = http_request.app.state.model_registry

    # Validate model exists
    metadata = model_registry.get_model_metadata(request.model_type)
    if not metadata:
        available = list(model_registry._model_metadata.keys())
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown model: {request.model_type}. Available models: {available}",
        )

    # Check if model is available (weights exist)
    if not model_registry.is_model_available(request.model_type):
        availability = model_registry.get_model_availability().get(request.model_type, {})
        weights_path = availability.get("weights_path", "unknown")
        raise HTTPException(
            status_code=status.HTTP_424_FAILED_DEPENDENCY,
            detail=(
                f"Model '{request.model_type}' weights not available.\n"
                f"Expected weights at: {weights_path}\n\n"
                f"To enable this model:\n"
                f"1. Download or train model weights\n"
                f"2. Place weights at the path above\n"
                f"3. Restart the service\n\n"
                f"See README AI Setup section for detailed instructions."
            ),
        )

    # Verify study exists
    study_query = select(Study).where(Study.study_instance_uid == request.study_uid)
    study_result = await db.execute(study_query)
    study = study_result.scalar_one_or_none()

    if not study:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Study not found: {request.study_uid}",
        )

    # Verify series if specified
    if request.series_uid:
        series_query = select(Series).where(Series.series_instance_uid == request.series_uid)
        series_result = await db.execute(series_query)
        if not series_result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Series not found: {request.series_uid}",
            )

    # Create job in database
    job_id = str(uuid4())

    # Map string model_type to enum if needed
    try:
        model_type_enum = ModelType(request.model_type)
    except ValueError:
        # If not in enum, store as custom string
        model_type_enum = ModelType.NNUNET  # Default, but we'll use the string

    job = AIJob(
        job_id=job_id,
        study_instance_uid=request.study_uid,
        series_instance_uid=request.series_uid,
        model_type=model_type_enum,
        task_type=request.task_type,
        status=JobStatus.QUEUED,
        priority=request.priority,
        parameters={
            **request.parameters,
            "_model_name": request.model_type,  # Store actual model name
        },
        submitted_by=current_user.user_id,
    )

    db.add(job)
    await db.commit()
    await db.refresh(job)

    # Log the inference request
    audit_logger.log_ai_inference(
        user_id=current_user.user_id,
        model_name=request.model_type,
        study_id=request.study_uid,
        inference_type=request.task_type.value,
        duration_ms=0,
        success=True,
    )

    # Add background task for actual inference
    background_tasks.add_task(
        run_real_inference,
        job_id,
        request.model_type,
        http_request.app.state,
    )

    logger.info(
        "Inference job submitted",
        job_id=job_id,
        model=request.model_type,
        study_uid=request.study_uid,
    )

    return _job_to_response(job)


@router.get("/jobs/{job_id}", response_model=InferenceJobResponse)
async def get_job_status(
    job_id: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> InferenceJobResponse:
    """Get inference job status.

    Returns current status and results (if completed) for an inference job.
    """
    query = select(AIJob).where(AIJob.job_id == job_id)
    result = await db.execute(query)
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job not found: {job_id}",
        )

    return _job_to_response(job)


@router.get("/jobs/{job_id}/result")
async def get_job_result(
    job_id: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """Get detailed results for a completed job.

    Returns the full inference results including paths to result files.
    """
    query = select(AIJob).where(AIJob.job_id == job_id)
    result = await db.execute(query)
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job not found: {job_id}",
        )

    if job.status != JobStatus.COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Job not completed. Current status: {job.status.value}",
        )

    return {
        "job_id": job.job_id,
        "model_type": job.model_type.value,
        "task_type": job.task_type.value,
        "results": job.results,
        "result_files": job.result_files,
        "inference_time_ms": job.inference_time_ms,
        "quality_metrics": job.quality_metrics,
    }


@router.get("/jobs", response_model=list[InferenceJobResponse])
async def list_jobs(
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    study_uid: str | None = Query(None),
    status_filter: JobStatus | None = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=100),
) -> list[InferenceJobResponse]:
    """List inference jobs with filtering."""
    query = select(AIJob).order_by(AIJob.created_at.desc())

    if study_uid:
        query = query.where(AIJob.study_instance_uid == study_uid)

    if status_filter:
        query = query.where(AIJob.status == status_filter)

    query = query.limit(limit)

    result = await db.execute(query)
    jobs = result.scalars().all()

    return [_job_to_response(job) for job in jobs]


@router.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_job(
    job_id: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    """Cancel a pending or running inference job."""
    query = select(AIJob).where(AIJob.job_id == job_id)
    result = await db.execute(query)
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job not found: {job_id}",
        )

    if job.status in [JobStatus.COMPLETED, JobStatus.FAILED]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot cancel completed or failed job",
        )

    job.status = JobStatus.CANCELLED
    await db.commit()


@router.post("/interactive/medsam", response_model=InteractiveSegmentationResponse)
async def interactive_medsam(
    study_uid: str,
    series_uid: str,
    instance_uid: str,
    prompt: SAMPrompt,
    http_request: Request,
    current_user: Annotated[TokenData, Depends(require_roles("admin", "radiologist"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> InteractiveSegmentationResponse:
    """Interactive MedSAM segmentation with prompts.

    Performs REAL inference using the MedSAM model.
    If the model is not available, returns HTTP 424 with setup instructions.

    Args:
        study_uid: Study Instance UID
        series_uid: Series Instance UID
        instance_uid: Instance to segment
        prompt: Interactive prompts (points or box)

    """
    model_registry = http_request.app.state.model_registry
    dicom_storage = http_request.app.state.dicom_storage

    # Check if MedSAM is available
    if not model_registry.is_model_available("medsam"):
        availability = model_registry.get_model_availability().get("medsam", {})
        weights_path = availability.get("weights_path", "models/medsam")
        raise HTTPException(
            status_code=status.HTTP_424_FAILED_DEPENDENCY,
            detail=(
                f"MedSAM model not available.\n\n"
                f"Expected weights at: {weights_path}\n\n"
                f"To set up MedSAM:\n"
                f"1. Download MedSAM weights from: https://github.com/bowang-lab/MedSAM\n"
                f"2. Place checkpoint (medsam_vit_b.pth) in: {weights_path}/\n"
                f"3. Restart the service\n\n"
                f"Note: MedSAM requires ~375MB for vit_b variant."
            ),
        )

    # Verify study exists
    study_query = select(Study).where(Study.study_instance_uid == study_uid)
    study_result = await db.execute(study_query)
    if not study_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Study not found: {study_uid}",
        )

    # Load the DICOM instance
    from app.services.ai.dicom_loader import DicomLoader

    loader = DicomLoader(dicom_storage)

    try:
        volume = await loader.load_instance(
            study_uid=study_uid,
            series_uid=series_uid,
            instance_uid=instance_uid,
        )
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )

    # Prepare image for inference
    image = loader.prepare_for_inference(
        volume,
        normalize=True,
        convert_to_rgb=True,
    )

    # Run interactive segmentation
    try:
        result = await model_registry.run_interactive_segmentation(
            model_name="medsam",
            image=image,
            point_coords=prompt.points if prompt.points else None,
            point_labels=prompt.point_labels if prompt.point_labels else None,
            box=prompt.box,
        )
    except Exception as e:
        logger.error(f"MedSAM inference failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Inference failed: {e}",
        )

    # Save mask result
    mask = result.output.mask
    results_dir = Path(settings.ai.models_dir).parent / "results" / study_uid
    results_dir.mkdir(parents=True, exist_ok=True)

    mask_filename = f"medsam_interactive_{instance_uid}_{uuid4().hex[:8]}.npz"
    mask_path = results_dir / mask_filename
    np.savez_compressed(mask_path, mask=mask)

    return InteractiveSegmentationResponse(
        instance_uid=instance_uid,
        mask_shape=list(mask.shape),
        mask_url=f"/api/v1/ai/results/{study_uid}/masks/{mask_filename}",
        confidence=result.confidence or 0.0,
        inference_time_ms=result.inference_time_ms,
        model_name=result.model_name,
        model_version=result.model_version,
    )


@router.get("/results/{study_uid}")
async def get_study_results(
    study_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    task_type: TaskType | None = Query(None),
) -> dict:
    """Get all AI results for a study."""
    query = (
        select(AIJob)
        .where(AIJob.study_instance_uid == study_uid)
        .where(AIJob.status == JobStatus.COMPLETED)
    )

    if task_type:
        query = query.where(AIJob.task_type == task_type)

    result = await db.execute(query)
    jobs = result.scalars().all()

    results = {
        "study_uid": study_uid,
        "total_jobs": len(jobs),
        "segmentations": [],
        "detections": [],
        "classifications": [],
        "jobs": [],
    }

    for job in jobs:
        job_info = {
            "job_id": job.job_id,
            "model_type": job.model_type.value,
            "task_type": job.task_type.value,
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
            "inference_time_ms": job.inference_time_ms,
            "results": job.results,
            "result_files": job.result_files,
        }
        results["jobs"].append(job_info)

        if job.results:
            if job.task_type == TaskType.SEGMENTATION:
                results["segmentations"].append(job.results)
            elif job.task_type == TaskType.DETECTION:
                results["detections"].append(job.results)
            elif job.task_type == TaskType.CLASSIFICATION:
                results["classifications"].append(job.results)

    return results


@router.get("/results/{study_uid}/masks/{filename}")
async def get_mask_file(
    study_uid: str,
    filename: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> Response:
    """Download a mask result file."""
    results_dir = Path(settings.ai.models_dir).parent / "results" / study_uid
    file_path = results_dir / filename

    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Result file not found: {filename}",
        )

    # Determine content type
    if filename.endswith(".npz"):
        media_type = "application/x-npz"
    elif filename.endswith(".nii.gz"):
        media_type = "application/gzip"
    elif filename.endswith(".nii"):
        media_type = "application/octet-stream"
    else:
        media_type = "application/octet-stream"

    return FileResponse(
        path=file_path,
        filename=filename,
        media_type=media_type,
    )


async def run_real_inference(job_id: str, model_name: str, app_state: Any) -> None:
    """Run REAL model inference in background.

    This function performs actual inference using loaded models.
    NO simulated or placeholder outputs are generated.
    """
    from app.models.base import async_session_maker
    from app.services.ai.dicom_loader import DicomLoader

    async with async_session_maker() as db:
        # Get job from database
        query = select(AIJob).where(AIJob.job_id == job_id)
        result = await db.execute(query)
        job = result.scalar_one_or_none()

        if not job:
            logger.error(f"Job not found: {job_id}")
            return

        model_registry = app_state.model_registry
        dicom_storage = app_state.dicom_storage

        try:
            # Update status to running
            job.status = JobStatus.RUNNING
            job.started_at = datetime.now(timezone.utc)
            await db.commit()

            # Load DICOM data
            loader = DicomLoader(dicom_storage)

            series_uid = job.series_instance_uid
            if not series_uid:
                # Get first series from study
                series_query = (
                    select(Series)
                    .where(Series.study_instance_uid == job.study_instance_uid)
                    .limit(1)
                )
                series_result = await db.execute(series_query)
                series = series_result.scalar_one_or_none()
                if series:
                    series_uid = series.series_instance_uid
                else:
                    raise ValueError("No series found for study")

            job.progress = 10
            await db.commit()

            # Load the series
            try:
                volume = await loader.load_series(
                    study_uid=job.study_instance_uid,
                    series_uid=series_uid,
                    apply_rescale=True,
                )
            except FileNotFoundError as e:
                raise ValueError(f"DICOM data not found: {e}")

            job.progress = 30
            await db.commit()

            # Get actual model name from parameters
            actual_model_name = job.parameters.get("_model_name", model_name)

            # Run inference based on task type
            start_time = time.perf_counter()

            if job.task_type == TaskType.DETECTION:
                results, result_files = await _run_detection(
                    job, actual_model_name, volume, loader, model_registry
                )
            elif job.task_type == TaskType.SEGMENTATION:
                results, result_files = await _run_segmentation(
                    job, actual_model_name, volume, loader, model_registry
                )
            else:
                raise ValueError(f"Task type not yet implemented: {job.task_type}")

            inference_time_ms = (time.perf_counter() - start_time) * 1000

            # Update job with results
            job.status = JobStatus.COMPLETED
            job.completed_at = datetime.now(timezone.utc)
            job.progress = 100
            job.results = results
            job.result_files = result_files
            job.inference_time_ms = int(inference_time_ms)

            logger.info(
                "Inference completed successfully",
                job_id=job_id,
                model=actual_model_name,
                inference_time_ms=round(inference_time_ms, 2),
            )

            await db.commit()

        except FileNotFoundError as e:
            # Model weights not found - provide helpful error
            job.status = JobStatus.FAILED
            job.completed_at = datetime.now(timezone.utc)
            job.error_message = str(e)
            job.error_traceback = traceback.format_exc()
            logger.error(f"Model weights not found: {e}")
            await db.commit()

        except ImportError as e:
            # Missing dependency
            job.status = JobStatus.FAILED
            job.completed_at = datetime.now(timezone.utc)
            job.error_message = f"Missing dependency: {e}"
            job.error_traceback = traceback.format_exc()
            logger.error(f"Missing dependency: {e}")
            await db.commit()

        except Exception as e:
            # General failure
            job.status = JobStatus.FAILED
            job.completed_at = datetime.now(timezone.utc)
            job.error_message = str(e)
            job.error_traceback = traceback.format_exc()
            logger.error(f"Inference failed: {e}", exc_info=True)
            await db.commit()


async def _run_detection(
    job: AIJob,
    model_name: str,
    volume: Any,
    loader: Any,
    model_registry: Any,
) -> tuple[dict, dict]:
    """Run detection inference."""
    # Prepare image for detection (2D)
    if volume.is_3d:
        # For 3D volumes, run detection on middle slice or all slices
        middle_idx = volume.pixel_data.shape[0] // 2
        image = volume.pixel_data[middle_idx]
    else:
        image = volume.pixel_data

    # Normalize and prepare
    image_prepared = loader.prepare_for_inference(
        type("obj", (object,), {"pixel_data": image, "is_3d": False})(),
        normalize=True,
        convert_to_rgb=True,
    )

    # Run inference
    result = await model_registry.run_inference(model_name, image_prepared)

    # Format results
    detections = []
    for i in range(len(result.output.boxes)):
        box = result.output.boxes[i]
        detections.append(
            {
                "class_name": (
                    result.output.class_names[i]
                    if i < len(result.output.class_names)
                    else f"class_{result.output.class_ids[i]}"
                ),
                "class_id": int(result.output.class_ids[i]),
                "confidence": float(result.output.scores[i]),
                "x": float(box[0]),
                "y": float(box[1]),
                "width": float(box[2] - box[0]),
                "height": float(box[3] - box[1]),
                "series_uid": job.series_instance_uid,
            }
        )

    results = {
        "detections": detections,
        "num_detections": len(detections),
        "model_used": model_name,
        "model_version": result.model_version,
        "inference_time_ms": result.inference_time_ms,
        "input_shape": list(image.shape),
    }

    return results, {}


async def _run_segmentation(
    job: AIJob,
    model_name: str,
    volume: Any,
    loader: Any,
    model_registry: Any,
) -> tuple[dict, dict]:
    """Run segmentation inference."""
    # Prepare volume
    image_prepared = loader.prepare_for_inference(
        volume,
        normalize=True,
        convert_to_rgb=False,
    )

    # Get spacing for volume calculations
    spacing = volume.metadata.spacing

    # Run inference
    result = await model_registry.run_inference(
        model_name,
        image_prepared,
        spacing=spacing,
    )

    # Save mask to file
    results_dir = Path(settings.ai.models_dir).parent / "results" / job.study_instance_uid
    results_dir.mkdir(parents=True, exist_ok=True)

    mask_filename = f"segmentation_{model_name}_{job.job_id[:8]}.npz"
    mask_path = results_dir / mask_filename

    np.savez_compressed(
        mask_path,
        mask=result.output.mask,
        class_names=result.output.class_names,
    )

    # Format results
    masks_info = []
    for i, class_name in enumerate(result.output.class_names):
        if i == 0:  # Skip background
            continue

        class_mask = result.output.mask == i
        voxel_count = int(np.sum(class_mask))

        volume_ml = None
        if spacing and voxel_count > 0:
            voxel_volume_mm3 = spacing[0] * spacing[1] * spacing[2]
            volume_ml = float(voxel_count * voxel_volume_mm3 / 1000.0)

        masks_info.append(
            {
                "class_name": class_name,
                "class_id": i,
                "voxel_count": voxel_count,
                "volume_ml": volume_ml,
                "dice_score": (
                    result.output.dice_scores.get(class_name) if result.output.dice_scores else None
                ),
            }
        )

    results = {
        "masks": masks_info,
        "mask_shape": list(result.output.mask.shape),
        "num_classes": len(result.output.class_names),
        "model_used": model_name,
        "model_version": result.model_version,
        "inference_time_ms": result.inference_time_ms,
        "input_shape": list(image_prepared.shape),
    }

    result_files = {
        "mask": f"/api/v1/ai/results/{job.study_instance_uid}/masks/{mask_filename}",
    }

    return results, result_files
