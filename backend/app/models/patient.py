"""
Patient database model.

Represents a patient in the DICOM database with demographics
and relationships to studies.
"""

from datetime import date
from typing import TYPE_CHECKING, Optional

from sqlalchemy import String, Date, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.study import Study


class Patient(Base):
    """
    Patient model representing a healthcare patient.

    Stores demographic information and links to associated DICOM studies.
    PHI fields should be encrypted at rest in production.
    """

    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # DICOM Patient ID (0010,0020) - unique identifier in the system
    patient_id: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True
    )

    # DICOM Patient's Name (0010,0010)
    patient_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)

    # DICOM Patient's Birth Date (0010,0030)
    birth_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # DICOM Patient's Sex (0010,0040)
    sex: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)

    # DICOM Ethnic Group (0010,2160)
    ethnic_group: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    # DICOM Patient Comments (0010,4000)
    comments: Mapped[Optional[str]] = mapped_column(String(10240), nullable=True)

    # Issuer of Patient ID (0010,0021)
    issuer_of_patient_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    # Other Patient IDs (0010,1000)
    other_patient_ids: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)

    # Relationships
    studies: Mapped[list["Study"]] = relationship(
        "Study",
        back_populates="patient",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    # Indexes for common queries
    __table_args__ = (
        Index("ix_patients_name_lower", "patient_name"),
        Index("ix_patients_birth_date", "birth_date"),
    )

    def __repr__(self) -> str:
        return f"<Patient(id={self.id}, patient_id='{self.patient_id}', name='{self.patient_name}')>"
