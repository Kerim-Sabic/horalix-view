"""
Annotation database model.

Represents image annotations including measurements, ROIs, and text labels
for DICOM instances.
"""

from enum import Enum as PyEnum
from typing import TYPE_CHECKING, Optional
from uuid import uuid4

from sqlalchemy import String, Integer, Text, Boolean, ForeignKey, Index, Enum, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.study import Study
    from app.models.series import Series
    from app.models.instance import Instance
    from app.models.user import User


class AnnotationType(str, PyEnum):
    """Annotation types."""

    LENGTH = "length"
    ANGLE = "angle"
    AREA = "area"
    VOLUME = "volume"
    ELLIPSE = "ellipse"
    RECTANGLE = "rectangle"
    POLYGON = "polygon"
    FREEHAND = "freehand"
    ARROW = "arrow"
    TEXT = "text"
    PROBE = "probe"
    COBB_ANGLE = "cobb_angle"
    BIDIRECTIONAL = "bidirectional"


class Annotation(Base):
    """
    Annotation model representing image annotations.

    Stores geometric annotations, measurements, and labels associated with
    DICOM instances for image analysis and reporting.
    """

    __tablename__ = "annotations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # Unique annotation ID (UUID for external references)
    annotation_uid: Mapped[str] = mapped_column(
        String(36), unique=True, nullable=False, index=True, default=lambda: str(uuid4())
    )

    # DICOM references
    study_uid: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    series_uid: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    instance_uid: Mapped[str] = mapped_column(String(128), nullable=False, index=True)

    # Frame number (for multi-frame images)
    frame_number: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Annotation type
    annotation_type: Mapped[AnnotationType] = mapped_column(
        Enum(AnnotationType), nullable=False, index=True
    )

    # Geometric data (stored as JSON)
    # Contains: points, points_3d, handles, text_position
    geometry: Mapped[dict] = mapped_column(JSON, nullable=False)

    # Measurements (stored as JSON array)
    # Each measurement: {value: float, unit: str, label: str}
    measurements: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    # Labels and descriptions
    label: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Visual properties
    color: Mapped[str] = mapped_column(String(16), default="#FFFF00", nullable=False)

    # State flags
    visible: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    locked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Creator reference
    created_by: Mapped[str] = mapped_column(String(256), nullable=False, index=True)

    # Foreign key to user (optional, for future use)
    user_id_fk: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Composite indexes for common queries
    # Note: Single-column indexes are already created via index=True on columns
    __table_args__ = (
        Index("ix_annotations_study_series", "study_uid", "series_uid"),
        Index("ix_annotations_created_at_desc", "created_at"),
    )

    def __repr__(self) -> str:
        return (
            f"<Annotation(id={self.id}, uid='{self.annotation_uid}', "
            f"type='{self.annotation_type}', instance='{self.instance_uid}')>"
        )
