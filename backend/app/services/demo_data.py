"""Optional demo data seeding (development only)."""

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.patient import Patient

logger = get_logger(__name__)


DEMO_PATIENTS = [
    {
        "patient_id": "PAT001",
        "patient_name": "John Doe",
        "birth_date": date(1965, 3, 15),
        "sex": "M",
    },
    {
        "patient_id": "PAT002",
        "patient_name": "Jane Smith",
        "birth_date": date(1978, 7, 22),
        "sex": "F",
    },
    {
        "patient_id": "PAT003",
        "patient_name": "Robert Johnson",
        "birth_date": date(1955, 11, 8),
        "sex": "M",
    },
]


async def seed_demo_patients(db: AsyncSession) -> int:
    """Insert demo patients if they do not already exist."""
    inserted = 0
    for demo in DEMO_PATIENTS:
        exists_result = await db.execute(
            select(Patient).where(Patient.patient_id == demo["patient_id"])
        )
        if exists_result.scalar_one_or_none():
            continue
        db.add(Patient(**demo))
        inserted += 1

    if inserted:
        await db.commit()
        logger.warning("Demo patients seeded", count=inserted)
    return inserted
