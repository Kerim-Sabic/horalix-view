"""
AI Job database model.

Represents an AI inference job with status tracking, results storage,
and audit trail for hospital-grade reliability.
"""

from datetime import datetime
from enum import Enum as PyEnum
from typing import TYPE_CHECKING, Optional

from sqlalchemy import String, Integer, Float, ForeignKey, Index, Enum, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.study import Study


class ModelType(str, PyEnum):
    """Available AI model types."""

    # Segmentation
    NNUNET = "nnunet"
    MEDUNET = "medunet"
    MEDSAM = "medsam"
    SWINUNET = "swinunet"
    TRANSUNET = "transunet"

    # Detection
    YOLOV8 = "yolov8"
    FASTER_RCNN = "faster_rcnn"

    # Classification
    VIT = "vit"
    MEDVIT = "medvit"
    SWIN_TRANSFORMER = "swin_transformer"
    ECHOCLR = "echoclr"

    # Enhancement
    UNIMIE = "unimie"
    GAN_DENOISING = "gan_denoising"
    GAN_SUPER_RES = "gan_super_resolution"

    # Pathology
    GIGAPATH = "gigapath"
    HIPT = "hipt"
    CTRANSPATH = "ctranspath"
    CHIEF = "chief"

    # Cardiac
    CARDIAC_3D = "cardiac_3d"
    CARDIAC_EF = "cardiac_ef"
    CARDIAC_STRAIN = "cardiac_strain"


class TaskType(str, PyEnum):
    """AI task types."""

    SEGMENTATION = "segmentation"
    DETECTION = "detection"
    CLASSIFICATION = "classification"
    ENHANCEMENT = "enhancement"
    PATHOLOGY = "pathology"
    CARDIAC = "cardiac"


class JobStatus(str, PyEnum):
    """Inference job status."""

    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class AIJob(Base):
    """
    AIJob model representing an AI inference job.

    Tracks the lifecycle of an AI analysis from submission to completion,
    storing results and metrics for audit and review.
    """

    __tablename__ = "ai_jobs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # Unique job identifier
    job_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)

    # Model and task configuration
    model_type: Mapped[ModelType] = mapped_column(Enum(ModelType), nullable=False)
    task_type: Mapped[TaskType] = mapped_column(Enum(TaskType), nullable=False)

    # Job status
    status: Mapped[JobStatus] = mapped_column(
        Enum(JobStatus), default=JobStatus.PENDING, nullable=False, index=True
    )
    progress: Mapped[float] = mapped_column(Float, default=0.0)

    # Priority (1=highest, 10=lowest)
    priority: Mapped[int] = mapped_column(Integer, default=5)

    # Timestamps
    queued_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    # Study/Series references
    study_instance_uid: Mapped[str] = mapped_column(
        String(128),
        ForeignKey("studies.study_instance_uid", ondelete="CASCADE"),
        nullable=False,
    )
    series_instance_uid: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    # User who submitted the job
    submitted_by: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    # Model parameters (JSON)
    parameters: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    # Results (JSON structure depends on task type)
    results: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    # Result file paths (for masks, enhanced images, etc.)
    result_files: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    # Error information
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error_traceback: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Performance metrics
    inference_time_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    gpu_memory_mb: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Quality metrics (depends on task type)
    quality_metrics: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    # Relationships
    study: Mapped["Study"] = relationship("Study", back_populates="ai_jobs")

    # Indexes
    __table_args__ = (
        Index("ix_ai_jobs_status_priority", "status", "priority"),
        Index("ix_ai_jobs_study_uid", "study_instance_uid"),
        Index("ix_ai_jobs_model_type", "model_type"),
        Index("ix_ai_jobs_submitted_by", "submitted_by"),
        Index("ix_ai_jobs_created_at", "created_at"),
    )

    @property
    def duration_ms(self) -> int | None:
        """Calculate job duration in milliseconds."""
        if self.started_at and self.completed_at:
            delta = self.completed_at - self.started_at
            return int(delta.total_seconds() * 1000)
        return None

    def __repr__(self) -> str:
        return f"<AIJob(id={self.id}, job_id='{self.job_id}', model='{self.model_type}', status='{self.status}')>"
