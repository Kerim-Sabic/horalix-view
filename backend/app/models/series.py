"""
Series database model.

Represents a DICOM series within a study with metadata
and relationships to instances.
"""

from datetime import date, time
from typing import TYPE_CHECKING, Optional

from sqlalchemy import String, Date, Time, Integer, Float, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.study import Study
    from app.models.instance import Instance


class Series(Base):
    """
    Series model representing a DICOM series.

    A series belongs to a study and contains multiple instances (images).
    """

    __tablename__ = "series"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # DICOM Series Instance UID (0020,000E) - globally unique
    series_instance_uid: Mapped[str] = mapped_column(
        String(128), unique=True, nullable=False, index=True
    )

    # DICOM Series Number (0020,0011)
    series_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # DICOM Series Description (0008,103E)
    series_description: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)

    # DICOM Modality (0008,0060)
    modality: Mapped[str] = mapped_column(String(16), nullable=False, default="OT")

    # DICOM Series Date (0008,0021)
    series_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # DICOM Series Time (0008,0031)
    series_time: Mapped[Optional[time]] = mapped_column(Time, nullable=True)

    # DICOM Body Part Examined (0018,0015)
    body_part_examined: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    # DICOM Patient Position (0018,5100)
    patient_position: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    # DICOM Protocol Name (0018,1030)
    protocol_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)

    # DICOM Slice Thickness (0018,0050)
    slice_thickness: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # DICOM Spacing Between Slices (0018,0088)
    spacing_between_slices: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # DICOM Pixel Spacing (0028,0030) - stored as "row\column"
    pixel_spacing: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    # DICOM Rows (0028,0010)
    rows: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # DICOM Columns (0028,0011)
    columns: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # DICOM Window Center (0028,1050) - default value
    window_center: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # DICOM Window Width (0028,1051) - default value
    window_width: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Calculated fields
    num_instances: Mapped[int] = mapped_column(Integer, default=0)

    # Study relationship
    study_instance_uid_fk: Mapped[str] = mapped_column(
        String(128),
        ForeignKey("studies.study_instance_uid", ondelete="CASCADE"),
        nullable=False,
    )
    study: Mapped["Study"] = relationship("Study", back_populates="series_list")

    # Instance relationship
    instances: Mapped[list["Instance"]] = relationship(
        "Instance",
        back_populates="series",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="Instance.instance_number",
    )

    # Indexes for common queries
    __table_args__ = (
        Index("ix_series_study_uid", "study_instance_uid_fk"),
        Index("ix_series_modality", "modality"),
        Index("ix_series_number", "series_number"),
    )

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
        return (
            f"<Series(id={self.id}, uid='{self.series_instance_uid}', modality='{self.modality}')>"
        )
