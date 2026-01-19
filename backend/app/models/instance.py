"""
Instance database model.

Represents a DICOM instance (single image/frame) within a series
with metadata and file storage information.
"""

from typing import TYPE_CHECKING, Optional

from sqlalchemy import String, Integer, Float, ForeignKey, Index, BigInteger
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.series import Series


class Instance(Base):
    """
    Instance model representing a DICOM instance.

    An instance is a single DICOM object (usually an image) within a series.
    """

    __tablename__ = "instances"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # DICOM SOP Instance UID (0008,0018) - globally unique
    sop_instance_uid: Mapped[str] = mapped_column(
        String(128), unique=True, nullable=False, index=True
    )

    # DICOM SOP Class UID (0008,0016)
    sop_class_uid: Mapped[str] = mapped_column(String(128), nullable=False)

    # DICOM Instance Number (0020,0013)
    instance_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Image dimensions
    rows: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    columns: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Pixel data information
    bits_allocated: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    bits_stored: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    high_bit: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    pixel_representation: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    samples_per_pixel: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    photometric_interpretation: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    # Transfer Syntax UID (0002,0010)
    transfer_syntax_uid: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    # Window/Level values
    window_center: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    window_width: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rescale_intercept: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rescale_slope: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Spatial information
    slice_location: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    slice_thickness: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Image Position Patient (0020,0032) - stored as "x\y\z"
    image_position_patient: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    # Image Orientation Patient (0020,0037) - stored as "r1\r2\r3\c1\c2\c3"
    image_orientation_patient: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)

    # Pixel Spacing (0028,0030) - stored as "row\col"
    pixel_spacing: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    # Number of frames (for multiframe instances)
    number_of_frames: Mapped[int] = mapped_column(Integer, default=1)

    # File storage information
    file_path: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    file_size: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    file_checksum: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    # Series relationship
    series_instance_uid_fk: Mapped[str] = mapped_column(
        String(128),
        ForeignKey("series.series_instance_uid", ondelete="CASCADE"),
        nullable=False,
    )
    series: Mapped["Series"] = relationship("Series", back_populates="instances")

    # Indexes for common queries
    __table_args__ = (
        Index("ix_instances_series_uid", "series_instance_uid_fk"),
        Index("ix_instances_number", "instance_number"),
        Index("ix_instances_slice_location", "slice_location"),
    )

    @property
    def image_position_tuple(self) -> tuple[float, float, float] | None:
        """Get image position as a tuple (x, y, z)."""
        if self.image_position_patient:
            parts = self.image_position_patient.split("\\")
            if len(parts) == 3:
                return (float(parts[0]), float(parts[1]), float(parts[2]))
        return None

    @image_position_tuple.setter
    def image_position_tuple(self, value: tuple[float, float, float] | None) -> None:
        """Set image position from a tuple."""
        if value:
            self.image_position_patient = f"{value[0]}\\{value[1]}\\{value[2]}"
        else:
            self.image_position_patient = None

    @property
    def pixel_spacing_tuple(self) -> tuple[float, float] | None:
        """Get pixel spacing as a tuple (row, col)."""
        if self.pixel_spacing:
            parts = self.pixel_spacing.split("\\")
            if len(parts) == 2:
                return (float(parts[0]), float(parts[1]))
        return None

    @pixel_spacing_tuple.setter
    def pixel_spacing_tuple(self, value: tuple[float, float] | None) -> None:
        """Set pixel spacing from a tuple."""
        if value:
            self.pixel_spacing = f"{value[0]}\\{value[1]}"
        else:
            self.pixel_spacing = None

    def __repr__(self) -> str:
        return f"<Instance(id={self.id}, uid='{self.sop_instance_uid}', number={self.instance_number})>"
