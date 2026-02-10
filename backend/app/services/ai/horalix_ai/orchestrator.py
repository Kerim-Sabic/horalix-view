"""
Horalix AI Orchestrator.

Manages the worker pool and handles job submission/status tracking.

Architecture:
- Spawns 2 worker processes (one per GPU)
- Filesystem-based job queue for communication
- Job status tracking
- Worker health monitoring
"""

import os
import json
import asyncio
import logging
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Optional, List
import uuid

from app.core.config import get_settings
from app.services.ai.horalix_ai.schema import Job, JobStatus, HoralixAIOutput

logger = logging.getLogger(__name__)


class HoralixAIOrchestrator:
    """
    Orchestrates inference workers and manages job queue.

    Responsibilities:
    - Start/stop worker processes
    - Submit jobs to queue
    - Track job status
    - Monitor worker health
    """

    def __init__(self):
        """Initialize orchestrator."""
        self.settings = get_settings()
        self.workers = []  # List of subprocess.Popen objects
        self.job_queue_dir = self.settings.ai.horalix_ai_job_queue_dir
        self.job_queue_dir.mkdir(parents=True, exist_ok=True)

        # Create queue subdirectories
        (self.job_queue_dir / "pending").mkdir(exist_ok=True)
        (self.job_queue_dir / "processing").mkdir(exist_ok=True)
        (self.job_queue_dir / "status").mkdir(exist_ok=True)

        logger.info("Horalix AI Orchestrator initialized")

    async def start_workers(self):
        """Start worker processes (one per GPU)."""
        num_workers = self.settings.ai.horalix_ai_num_workers

        logger.info(f"Starting {num_workers} workers...")

        for gpu_id in range(num_workers):
            try:
                # Start worker process
                worker_cmd = [
                    "python",
                    "-m",
                    "app.services.ai.horalix_ai.worker",
                    "--gpu-id",
                    str(gpu_id),
                ]

                worker_process = subprocess.Popen(
                    worker_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    cwd=str(Path(__file__).parent.parent.parent.parent.parent),  # backend/
                )

                self.workers.append({
                    "gpu_id": gpu_id,
                    "process": worker_process,
                    "pid": worker_process.pid,
                })

                logger.info(f"Worker {gpu_id} started (PID: {worker_process.pid})")

            except Exception as e:
                logger.error(f"Failed to start worker {gpu_id}: {e}", exc_info=True)

        # Wait a bit for workers to initialize
        await asyncio.sleep(2)

        logger.info(f"{len(self.workers)} workers started successfully")

    async def stop_workers(self):
        """Stop all worker processes."""
        logger.info("Stopping workers...")

        for worker in self.workers:
            try:
                worker["process"].terminate()
                worker["process"].wait(timeout=10)
                logger.info(f"Worker {worker['gpu_id']} stopped")

            except Exception as e:
                logger.error(f"Failed to stop worker {worker['gpu_id']}: {e}")

                # Force kill
                try:
                    worker["process"].kill()
                except:
                    pass

        self.workers.clear()

        logger.info("All workers stopped")

    async def submit_job(
        self,
        study_uid: str,
        series_uid: Optional[str] = None,
        instance_uid: Optional[str] = None,
        enable_echonet: bool = True,
        enable_measurements: bool = True,
        priority: int = 5,
        patient_context: Optional[dict] = None,
    ) -> str:
        """
        Submit job to queue.

        Args:
            study_uid: Study UID
            series_uid: Optional series UID
            instance_uid: Optional instance UID
            enable_echonet: Enable EchoNet-Dynamic
            enable_measurements: Enable measurements
            priority: Job priority (1=highest, 10=lowest)

        Returns:
            Job ID
        """
        job_id = str(uuid.uuid4())

        job = Job(
            job_id=job_id,
            study_uid=study_uid,
            series_uid=series_uid,
            instance_uid=instance_uid,
            enable_echonet=enable_echonet,
            enable_measurements=enable_measurements,
            priority=priority,
            submitted_at=datetime.now(),
            patient_context=patient_context or {},
        )

        # Write job to pending queue
        job_file = self.job_queue_dir / "pending" / f"{job_id}.json"

        with open(job_file, "w") as f:
            json.dump(job.model_dump(), f, indent=2, default=str)

        # Initialize status
        status = JobStatus(
            job_id=job_id,
            status="PENDING",
        )

        status_file = self.job_queue_dir / "status" / f"{job_id}.json"

        with open(status_file, "w") as f:
            json.dump(status.model_dump(), f, indent=2, default=str)

        logger.info(f"Job {job_id} submitted for study {study_uid}")

        return job_id

    async def get_job_status(self, job_id: str) -> Optional[JobStatus]:
        """
        Get job status.

        Args:
            job_id: Job ID

        Returns:
            JobStatus if found, None otherwise
        """
        status_file = self.job_queue_dir / "status" / f"{job_id}.json"

        if not status_file.exists():
            return None

        with open(status_file, "r") as f:
            status_data = json.load(f)

        return JobStatus(**status_data)

    async def wait_for_job(
        self,
        job_id: str,
        timeout: int = 1800,
        poll_interval: float = 1.0,
    ) -> HoralixAIOutput:
        """
        Wait for job to complete and return results.

        Args:
            job_id: Job ID
            timeout: Timeout in seconds
            poll_interval: Poll interval in seconds

        Returns:
            HoralixAIOutput

        Raises:
            TimeoutError: If job doesn't complete within timeout
            RuntimeError: If job fails
        """
        elapsed = 0.0

        while elapsed < timeout:
            status = await self.get_job_status(job_id)

            if status is None:
                raise RuntimeError(f"Job {job_id} not found")

            if status.status == "COMPLETED":
                # Load results
                if status.result_path:
                    result_file = Path(status.result_path)

                    with open(result_file, "r") as f:
                        result_data = json.load(f)

                    return HoralixAIOutput(**result_data)

                else:
                    raise RuntimeError(f"Job {job_id} completed but no result path")

            elif status.status == "FAILED":
                raise RuntimeError(f"Job {job_id} failed: {status.error_message}")

            elif status.status == "CANCELLED":
                raise RuntimeError(f"Job {job_id} was cancelled")

            # Wait and poll again
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

        raise TimeoutError(f"Job {job_id} did not complete within {timeout} seconds")

    async def cancel_job(self, job_id: str):
        """
        Cancel a pending or running job.

        Args:
            job_id: Job ID
        """
        status = await self.get_job_status(job_id)

        if status and status.status in ["PENDING", "RUNNING"]:
            status.status = "CANCELLED"
            status.completed_at = datetime.now()

            status_file = self.job_queue_dir / "status" / f"{job_id}.json"

            with open(status_file, "w") as f:
                json.dump(status.model_dump(), f, indent=2, default=str)

            # Remove from pending queue if present
            pending_file = self.job_queue_dir / "pending" / f"{job_id}.json"

            if pending_file.exists():
                pending_file.unlink()

            logger.info(f"Job {job_id} cancelled")

    async def list_jobs(
        self,
        status_filter: Optional[str] = None,
        limit: int = 100,
    ) -> List[JobStatus]:
        """
        List jobs with optional status filter.

        Args:
            status_filter: Optional status filter ("PENDING", "RUNNING", etc.)
            limit: Max number of jobs to return

        Returns:
            List of JobStatus objects
        """
        status_dir = self.job_queue_dir / "status"
        status_files = sorted(status_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)

        jobs = []

        for status_file in status_files[:limit]:
            try:
                with open(status_file, "r") as f:
                    status_data = json.load(f)

                job_status = JobStatus(**status_data)

                if status_filter is None or job_status.status == status_filter:
                    jobs.append(job_status)

            except Exception as e:
                logger.warning(f"Failed to load job status {status_file}: {e}")

        return jobs

    def get_worker_stats(self) -> List[dict]:
        """
        Get worker statistics.

        Returns:
            List of worker stats dicts
        """
        stats = []

        for worker in self.workers:
            is_alive = worker["process"].poll() is None

            stats.append({
                "gpu_id": worker["gpu_id"],
                "pid": worker["pid"],
                "alive": is_alive,
            })

        return stats
