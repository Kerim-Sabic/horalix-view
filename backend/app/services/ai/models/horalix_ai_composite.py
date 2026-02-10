"""
Horalix AI Composite Model.

Integrates PanEcho + EchoPrime + Measurements + EchoNet-Dynamic into a single
model that follows the BaseAIModel interface.

Uses the orchestrator to manage workers and handle inference requests.
"""

import logging
from typing import Optional

from app.services.ai.base import BaseAIModel, ModelMetadata, ModelType, InferenceResult
from app.services.ai.horalix_ai.schema import HoralixAIOutput
from app.services.ai.horalix_ai.orchestrator import HoralixAIOrchestrator

logger = logging.getLogger(__name__)


class HoralixAICompositeModel(BaseAIModel):
    """
    Composite AI model for comprehensive echocardiography analysis.

    Orchestrates four models:
    - PanEcho: 39-task multi-task model
    - EchoPrime: Multi-view vision-language model
    - Measurements: 9 anatomical 2D measurement models
    - EchoNet-Dynamic: LV segmentation + EF curves

    Architecture:
    - Delegates inference to worker pool via orchestrator
    - Workers preload models at startup
    - 2-GPU concurrency with filesystem-based job queue
    """

    def __init__(self):
        """Initialize composite model."""
        self.orchestrator = HoralixAIOrchestrator()
        self._loaded = False

        logger.info("HoralixAICompositeModel initialized")

    @property
    def metadata(self) -> ModelMetadata:
        """Get model metadata."""
        return ModelMetadata(
            name="horalix_ai",
            version="1.0.0",
            model_type=ModelType.CARDIAC,
            modalities=["US"],  # Ultrasound
            description="Composite cardiac AI: PanEcho + EchoPrime + Measurements + EchoNet-Dynamic",
            requires_gpu=True,
            framework="pytorch",
        )

    async def load(self, device: str = "cuda") -> None:
        """
        Load model (start worker pool).

        Args:
            device: Ignored (workers manage their own GPU assignments)
        """
        if self._loaded:
            logger.warning("HoralixAI already loaded")
            return

        logger.info("Starting HoralixAI worker pool...")

        await self.orchestrator.start_workers()

        self._loaded = True

        logger.info("HoralixAI worker pool started successfully")

    async def unload(self) -> None:
        """Unload model (stop worker pool)."""
        if not self._loaded:
            return

        logger.info("Stopping HoralixAI worker pool...")

        await self.orchestrator.stop_workers()

        self._loaded = False

        logger.info("HoralixAI worker pool stopped")

    async def predict(
        self,
        study_uid: str,
        series_uid: Optional[str] = None,
        instance_uid: Optional[str] = None,
        enable_echonet: bool = True,
        enable_measurements: bool = True,
        priority: int = 5,
        timeout: int = 1800,
        patient_context: Optional[dict] = None,
        **kwargs,
    ) -> InferenceResult[HoralixAIOutput]:
        """
        Run inference on a study.

        Args:
            study_uid: Study UID
            series_uid: Optional series UID (defaults to first series)
            instance_uid: Optional instance UID (for single-instance inference)
            enable_echonet: Enable EchoNet-Dynamic segmentation
            enable_measurements: Enable 2D measurements
            priority: Job priority (1=highest, 10=lowest)
            timeout: Job timeout in seconds
            **kwargs: Additional parameters (ignored)

        Returns:
            InferenceResult with HoralixAIOutput

        Raises:
            RuntimeError: If worker pool not started
            TimeoutError: If inference exceeds timeout
            RuntimeError: If inference fails
        """
        if not self._loaded:
            raise RuntimeError("HoralixAI not loaded. Call load() first.")

        logger.info(f"Submitting inference job for study {study_uid}")

        # Submit job to orchestrator
        job_id = await self.orchestrator.submit_job(
            study_uid=study_uid,
            series_uid=series_uid,
            instance_uid=instance_uid,
            enable_echonet=enable_echonet,
            enable_measurements=enable_measurements,
            priority=priority,
            patient_context=patient_context,
        )

        logger.info(f"Job {job_id} submitted, waiting for completion...")

        # Wait for results
        output = await self.orchestrator.wait_for_job(
            job_id=job_id,
            timeout=timeout,
        )

        logger.info(
            f"Job {job_id} completed in {output.inference_time_ms:.1f} ms "
            f"(GPU {output.gpu_id})"
        )

        # Wrap in InferenceResult
        result = InferenceResult(
            model_name=self.metadata.name,
            model_version=self.metadata.version,
            inference_time_ms=output.inference_time_ms,
            output=output,
            metadata={
                "job_id": job_id,
                "gpu_id": output.gpu_id,
                "num_overlays": len(output.overlays),
                "num_measurements": len(output.measurements),
                "num_curves": len(output.curves),
            },
        )

        return result

    async def get_job_status(self, job_id: str):
        """
        Get status of a job.

        Args:
            job_id: Job ID

        Returns:
            JobStatus object
        """
        return await self.orchestrator.get_job_status(job_id)

    async def cancel_job(self, job_id: str):
        """
        Cancel a running job.

        Args:
            job_id: Job ID
        """
        await self.orchestrator.cancel_job(job_id)

    async def list_jobs(self, status_filter: Optional[str] = None, limit: int = 100):
        """
        List recent jobs.

        Args:
            status_filter: Optional status filter
            limit: Max number of jobs

        Returns:
            List of JobStatus objects
        """
        return await self.orchestrator.list_jobs(status_filter=status_filter, limit=limit)

    def get_worker_stats(self):
        """
        Get worker statistics.

        Returns:
            List of worker stats dicts
        """
        return self.orchestrator.get_worker_stats()
