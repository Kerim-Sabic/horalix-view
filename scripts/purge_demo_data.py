#!/usr/bin/env python
"""Purge demo data from the database (safe by default)."""

import argparse
import asyncio

from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.config import get_settings
from app.models.patient import Patient

DEMO_PATIENT_IDS = {"PAT001", "PAT002", "PAT003"}
DEMO_PATIENT_NAMES = {"John Doe", "Jane Smith", "Robert Johnson"}


async def purge_demo_data(dry_run: bool) -> int:
    settings = get_settings()
    engine = create_async_engine(settings.database.url, echo=False)

    deleted = 0
    async with AsyncSession(engine, expire_on_commit=False) as session:
        result = await session.execute(
            select(Patient)
            .options(selectinload(Patient.studies))
            .where(
                Patient.patient_id.in_(DEMO_PATIENT_IDS),
                Patient.patient_name.in_(DEMO_PATIENT_NAMES),
            )
        )
        patients = result.scalars().all()

        if dry_run:
            print(f"[dry-run] Demo patients matched: {len(patients)}")
            return 0

        for patient in patients:
            for study in patient.studies:
                await session.delete(study)
            await session.delete(patient)
            deleted += 1

        await session.commit()

    await engine.dispose()
    return deleted


def main() -> None:
    parser = argparse.ArgumentParser(description="Purge demo patients safely.")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply deletions (default is dry-run).",
    )
    args = parser.parse_args()

    deleted = asyncio.run(purge_demo_data(dry_run=not args.apply))
    if args.apply:
        print(f"Deleted {deleted} demo patient record(s).")


if __name__ == "__main__":
    main()
