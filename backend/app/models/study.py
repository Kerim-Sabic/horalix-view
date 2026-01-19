"""
Study database model.

Represents a DICOM study with metadata and relationships
to patient, series, and AI jobs.
"""

from datetime import date, time
from enum import Enum as PyEnum
from typing import TYPE_CHECKING, Optional

from sqlalchemy import String, Date, Time, Integer, ForeignKey, Index, Enum, Text, ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.patient import Patient
    from app.models.series import Series
    from app.models.job import AIJob


class StudyStatus(str, PyEnum):
    """Study processing status."""

    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETE = "complete"
    ERROR = "error"


class Study(Base):
    """
    Study model representing a DICOM study.

    A study contains one or more series and is associated with a patient.
    """

    __tablename__ = "studies"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # DICOM Study Instance UID (0020,000D) - globally unique
    study_instance_uid: Mapped[str] = mapped_column(
        String(128), unique=True, nullable=False, index=True
    )

    # DICOM Study ID (0020,0010)
    study_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    # DICOM Study Date (0008,0020)
    study_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)

    # DICOM Study Time (0008,0030)
    study_time: Mapped[Optional[time]] = mapped_column(Time, nullable=True)

    # DICOM Accession Number (0008,0050)
    accession_number: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True, index=True
    )

    # DICOM Study Description (0008,1030)
    study_description: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)

    # DICOM Referring Physician's Name (0008,0090)
    referring_physician_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)

    # DICOM Institution Name (0008,0080)
    institution_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)

    # DICOM Station Name (0008,1010)
    station_name: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    # DICOM Modalities in Study (0008,0061) - stored as comma-separated
    modalities_in_study: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)

    # Calculated fields
    num_series: Mapped[int] = mapped_column(Integer, default=0)
    num_instances: Mapped[int] = mapped_column(Integer, default=0)

    # Processing status
    status: Mapped[StudyStatus] = mapped_column(
        Enum(StudyStatus), default=StudyStatus.PENDING, nullable=False
    )

    # Error message if status is ERROR
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Patient relationship
    patient_id_fk: Mapped[Optional[int]] = mapped_column(
        ForeignKey("patients.id", ondelete="SET NULL"), nullable=True
    )
    patient: Mapped[Optional["Patient"]] = relationship(
        "Patient", back_populates="studies"
    )

    # Relationships
    series_list: Mapped[list["Series"]] = relationship(
        "Series",
        back_populates="study",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    ai_jobs: Mapped[list["AIJob"]] = relationship(
        "AIJob",
        back_populates="study",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    # Indexes for common queries
    __table_args__ = (
        Index("ix_studies_study_date_desc", study_date.desc()),
        Index("ix_studies_patient_id_fk", "patient_id_fk"),
        Index("ix_studies_status", "status"),
    )

    @property
    def modalities_list(self) -> list[str]:
        """Get modalities as a list."""
        if self.modalities_in_study:
            return [m.strip() for m in self.modalities_in_study.split(",")]
        return []

    @modalities_list.setter
    def modalities_list(self, value: list[str]) -> None:
        """Set modalities from a list."""
        self.modalities_in_study = ",".join(value) if value else None

    def __repr__(self) -> str:
        return f"<Study(id={self.id}, uid='{self.study_instance_uid}', description='{self.study_description}')>"
