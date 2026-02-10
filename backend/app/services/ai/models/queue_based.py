"""Queue-based model for Horalix AI workers.

Submits jobs to the file-based queue and polls for results.
"""

import asyncio
import json
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Coroutine, Optional, Union

from app.core.config import get_settings
from app.services.ai.base import BaseAIModel, InferenceResult, ModelMetadata

settings = get_settings()

# Type alias for progress callback: async (progress: float) -> None
AsyncProgressCallback = Callable[[float], Coroutine[Any, Any, None]]
SyncProgressCallback = Callable[[float], None]
ProgressCallback = Union[AsyncProgressCallback, SyncProgressCallback]


class QueueBasedModel(BaseAIModel):
    """Model that submits jobs to a file-based worker queue."""

    def __init__(
        self,
        metadata: ModelMetadata,
        queue_dir: Path,
        results_dir: Path,
        timeout_seconds: int = 300,
        max_retries: int = 0,
    ):
        """Initialize queue-based model.

        Args:
            metadata: Model metadata
            queue_dir: Path to job queue directory
            results_dir: Path to results directory
            timeout_seconds: Max time to wait for job completion
        """
        super().__init__()
        self._metadata = metadata
        self.queue_dir = Path(queue_dir)
        self.results_dir = Path(results_dir)
        self.timeout_seconds = timeout_seconds
        self.max_retries = max(0, int(max_retries))

        # Ensure queue directories exist
        self.pending_dir = self.queue_dir / "pending"
        self.processing_dir = self.queue_dir / "processing"
        self.completed_dir = self.queue_dir / "completed"
        self.failed_dir = self.queue_dir / "failed"

    @property
    def metadata(self) -> ModelMetadata:
        """Get model metadata."""
        return self._metadata

    def check_availability(self) -> tuple[bool, list[str]]:
        """Check if the queue-based model is available.

        For queue-based models, we check if the queue directories exist
        and are writable. The actual model weights are on the workers.

        Returns:
            Tuple of (available, errors)
        """
        errors: list[str] = []

        # For queue-based models, we just need the queue to be accessible
        # Workers handle the actual model loading
        try:
            # Ensure queue directories exist
            for dir_path in [self.pending_dir, self.processing_dir, self.completed_dir, self.failed_dir]:
                dir_path.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            errors.append(f"Cannot create queue directories: {e}")
            return False, errors

        return True, errors

    async def load(self, device: str = "cuda") -> None:
        """Load model (no-op for queue-based, workers handle loading)."""
        self._device = device
        self._loaded = True

    async def unload(self) -> None:
        """Unload model (no-op for queue-based)."""
        self._loaded = False

    def get_job_progress(self, job_id: str) -> float:
        """Read current progress from worker status file.

        Args:
            job_id: Job ID to check

        Returns:
            Progress percentage (0.0 to 100.0)
        """
        status_dir = self.queue_dir / "status"
        status_file = status_dir / f"{job_id}.json"

        if status_file.exists():
            try:
                status_data = json.loads(status_file.read_text())
                return float(status_data.get("progress", 0.0))
            except (json.JSONDecodeError, ValueError):
                return 0.0

        return 0.0

    async def predict(
        self,
        image: Any,
        progress_callback: Optional[ProgressCallback] = None,
        **kwargs: Any,
    ) -> InferenceResult:
        """Submit inference job to queue and wait for results.

        Args:
            image: Input data (DICOM path or study UID)
            progress_callback: Optional callback to report progress updates
            **kwargs: Additional parameters (series_uid, study_uid, etc.)

        Returns:
            Inference results

        Raises:
            TimeoutError: If job doesn't complete within timeout
            RuntimeError: If job fails
        """
        # Get study_uid - required field
        study_uid = kwargs.get("study_uid")
        if not study_uid:
            raise ValueError("study_uid is required for queue-based inference")

        async def _wait_for_completion(job_id: str) -> InferenceResult:
            # Track last reported progress to avoid duplicate callbacks
            last_progress = 0.0
            start_time = time.time()
            while True:
                elapsed = time.time() - start_time
                if elapsed > self.timeout_seconds:
                    # Mark job as cancelled so the worker can stop cleanly
                    try:
                        status_dir = self.queue_dir / "status"
                        status_file = status_dir / f"{job_id}.json"
                        status_dir.mkdir(parents=True, exist_ok=True)
                        if status_file.exists():
                            status_data = json.loads(status_file.read_text())
                        else:
                            status_data = {"job_id": job_id}
                        status_data["status"] = "CANCELLED"
                        status_data["error_message"] = f"Timed out after {self.timeout_seconds}s"
                        status_data["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                        status_file.write_text(json.dumps(status_data, indent=2))
                    except Exception:
                        pass
                    raise TimeoutError(
                        f"Job {job_id} timed out after {self.timeout_seconds}s"
                    )

                # Read and report progress
                current_progress = self.get_job_progress(job_id)
                if progress_callback and current_progress > last_progress:
                    try:
                        # Handle both sync and async callbacks
                        result = progress_callback(current_progress)
                        if asyncio.iscoroutine(result):
                            await result
                    except Exception:
                        pass  # Don't fail on callback errors
                    last_progress = current_progress

                # Check job status from status file
                status_dir = self.queue_dir / "status"
                status_file = status_dir / f"{job_id}.json"

                if status_file.exists():
                    try:
                        status_data = json.loads(status_file.read_text())
                        job_status = status_data.get("status", "PENDING")

                        if job_status == "COMPLETED":
                            # Read results from results directory
                            result_file = self.results_dir / f"{job_id}.json"
                            if result_file.exists():
                                result_data = json.loads(result_file.read_text())
                                # Report 100% on completion
                                if progress_callback:
                                    try:
                                        cb_result = progress_callback(100.0)
                                        if asyncio.iscoroutine(cb_result):
                                            await cb_result
                                    except Exception:
                                        pass

                                # Construct proper InferenceResult
                                return InferenceResult(
                                    model_name=result_data.get("model_name", self.metadata.name),
                                    model_version=result_data.get("model_version", self.metadata.version),
                                    inference_time_ms=result_data.get("inference_time_ms", elapsed * 1000),
                                    output=result_data,  # Full HoralixAIOutput data
                                    metadata={
                                        "job_id": job_id,
                                        "gpu_id": result_data.get("gpu_id"),
                                        "study_uid": result_data.get("study_uid"),
                                    },
                                )
                            else:
                                # Status is COMPLETED but result file not found yet
                                pass

                        elif job_status == "FAILED":
                            error_msg = status_data.get("error_message", "Unknown error")
                            raise RuntimeError(f"Job {job_id} failed: {error_msg}")
                        elif job_status == "CANCELLED":
                            error_msg = status_data.get("error_message", "Cancelled")
                            raise RuntimeError(f"Job {job_id} cancelled: {error_msg}")

                    except json.JSONDecodeError:
                        pass  # Status file not fully written yet

                # Wait before next poll
                await asyncio.sleep(1.0)

        # Retry loop for transient failures/timeouts
        for attempt in range(self.max_retries + 1):
            # Generate job ID
            job_id = str(uuid.uuid4())

            # Prepare job payload (matches Job schema in horalix_ai/schema.py)
            # NOTE: series_uid deliberately set to None for whole-study processing.
            # The worker processes all US series when series_uid is None.
            job = {
                "job_id": job_id,
                "study_uid": study_uid,
                "series_uid": None,
                "instance_uid": kwargs.get("instance_uid"),
                "enable_echonet": kwargs.get("enable_echonet", True),
                "enable_measurements": kwargs.get("enable_measurements", True),
                "priority": kwargs.get("priority", 5),
                "submitted_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            }

            # Write job file to pending queue
            self.pending_dir.mkdir(parents=True, exist_ok=True)
            job_file = self.pending_dir / f"{job_id}.json"
            job_file.write_text(json.dumps(job, indent=2))

            try:
                return await _wait_for_completion(job_id)
            except TimeoutError:
                if attempt >= self.max_retries:
                    raise
                # Retry on timeout
                continue

        # Should never reach here
        raise TimeoutError("Inference did not complete")

    async def interactive_predict(
        self,
        image: Any,
        point_coords: list[list[int]] | None = None,
        point_labels: list[int] | None = None,
        box: list[int] | None = None,
        **kwargs: Any,
    ) -> InferenceResult:
        """Interactive prediction not supported for queue-based models."""
        raise NotImplementedError(
            "Interactive prediction not supported for queue-based models"
        )
