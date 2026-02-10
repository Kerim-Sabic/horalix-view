"""
Structured logging utilities for horalix_ai.

Provides consistent logging format with context and metrics.
"""

import logging
import time
from typing import Dict, Any


def get_logger(name: str) -> logging.Logger:
    """
    Get logger with consistent formatting.

    Args:
        name: Logger name (typically __name__)

    Returns:
        Configured logger
    """
    logger = logging.getLogger(name)

    # Only configure if not already configured
    if not logger.handlers:
        handler = logging.StreamHandler()
        formatter = logging.Formatter(
            "[%(asctime)s] %(levelname)s [%(name)s:%(lineno)d] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)

    return logger


def log_inference_metrics(
    logger: logging.Logger,
    job_id: str,
    study_uid: str,
    model_name: str,
    inference_time_ms: float,
    gpu_id: int,
    num_instances: int = 0,
    num_frames: int = 0,
    additional_metrics: Dict[str, Any] = None,
) -> None:
    """
    Log inference metrics in structured format.

    Args:
        logger: Logger instance
        job_id: Job ID
        study_uid: Study UID
        model_name: Model name
        inference_time_ms: Total inference time in ms
        gpu_id: GPU ID used
        num_instances: Number of instances processed
        num_frames: Total number of frames processed
        additional_metrics: Optional additional metrics dict
    """
    metrics = {
        "job_id": job_id,
        "study_uid": study_uid,
        "model": model_name,
        "inference_time_ms": f"{inference_time_ms:.1f}",
        "gpu_id": gpu_id,
        "num_instances": num_instances,
        "num_frames": num_frames,
    }

    if additional_metrics:
        metrics.update(additional_metrics)

    # Format as key=value pairs
    metrics_str = " | ".join(f"{k}={v}" for k, v in metrics.items())

    logger.info(f"INFERENCE_METRICS | {metrics_str}")


class Timer:
    """
    Context manager for timing operations.

    Example:
        >>> with Timer() as timer:
        ...     # do something
        >>> print(f"Took {timer.elapsed_ms} ms")
    """

    def __init__(self):
        self.start_time = None
        self.end_time = None

    def __enter__(self):
        self.start_time = time.time()
        return self

    def __exit__(self, *args):
        self.end_time = time.time()

    @property
    def elapsed_ms(self) -> float:
        """Get elapsed time in milliseconds."""
        if self.start_time and self.end_time:
            return (self.end_time - self.start_time) * 1000
        return 0.0

    @property
    def elapsed_s(self) -> float:
        """Get elapsed time in seconds."""
        if self.start_time and self.end_time:
            return self.end_time - self.start_time
        return 0.0
