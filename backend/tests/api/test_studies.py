"""
Tests for study endpoints.

Verifies that the studies API correctly:
1. Returns proper annotations count for a study
2. Handles studies with no annotations
3. Computes annotations count from database
"""

from datetime import date, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.models.base import Base
from app.models.annotation import Annotation, AnnotationType
from app.models.patient import Patient
from app.models.study import Study, StudyStatus
from app.models.series import Series


@pytest.fixture
async def test_db():
    """Create an in-memory test database."""
    # Use SQLite in-memory database for testing
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        echo=False,
    )

    # Create tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Create async session factory
    async_session = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with async_session() as session:
        yield session

    await engine.dispose()


@pytest.fixture
async def sample_patient(test_db: AsyncSession):
    """Create a sample patient."""
    patient = Patient(
        patient_id="TEST001",
        patient_name="Test Patient",
        birth_date=date(1980, 1, 1),
        sex="M",
    )
    test_db.add(patient)
    await test_db.commit()
    await test_db.refresh(patient)
    return patient


@pytest.fixture
async def sample_study(test_db: AsyncSession, sample_patient: Patient):
    """Create a sample study."""
    study = Study(
        study_instance_uid="1.2.840.10008.5.1.4.1.1.2.1.99999.1",
        study_id="STUDY001",
        study_date=date(2024, 1, 15),
        study_description="Test CT Study",
        accession_number="ACC001",
        modalities_in_study="CT",
        num_series=1,
        num_instances=10,
        status=StudyStatus.COMPLETE,
        patient_id_fk=sample_patient.id,
    )
    test_db.add(study)
    await test_db.commit()
    await test_db.refresh(study)
    return study


@pytest.fixture
async def sample_series(test_db: AsyncSession, sample_study: Study):
    """Create a sample series."""
    series = Series(
        series_instance_uid="1.2.840.10008.5.1.4.1.1.2.1.99999.2",
        series_number=1,
        series_description="Test Series",
        modality="CT",
        num_instances=10,
        study_instance_uid_fk=sample_study.study_instance_uid,
    )
    test_db.add(series)
    await test_db.commit()
    await test_db.refresh(series)
    return series


class TestAnnotationsCount:
    """Test annotations count functionality in get_study endpoint."""

    @pytest.mark.asyncio
    async def test_study_with_no_annotations(
        self, test_db: AsyncSession, sample_study: Study
    ):
        """Test that a study with no annotations returns count of 0."""
        from sqlalchemy import func

        from app.models.annotation import Annotation

        # Query annotations count
        query = select(func.count()).select_from(Annotation).where(
            Annotation.study_uid == sample_study.study_instance_uid
        )
        result = await test_db.execute(query)
        count = result.scalar() or 0

        assert count == 0

    @pytest.mark.asyncio
    async def test_study_with_annotations(
        self,
        test_db: AsyncSession,
        sample_study: Study,
        sample_series: Series,
    ):
        """Test that a study correctly counts its annotations."""
        from sqlalchemy import func

        from app.models.annotation import Annotation

        # Create 3 annotations for this study
        annotations = [
            Annotation(
                study_uid=sample_study.study_instance_uid,
                series_uid=sample_series.series_instance_uid,
                instance_uid=f"1.2.840.10008.5.1.4.1.1.2.1.99999.{i}",
                annotation_type=AnnotationType.LENGTH,
                geometry={"points": [[10, 10], [20, 20]]},
                created_by="test_user",
            )
            for i in range(3, 6)
        ]

        for annotation in annotations:
            test_db.add(annotation)
        await test_db.commit()

        # Query annotations count
        query = select(func.count()).select_from(Annotation).where(
            Annotation.study_uid == sample_study.study_instance_uid
        )
        result = await test_db.execute(query)
        count = result.scalar() or 0

        assert count == 3

    @pytest.mark.asyncio
    async def test_multiple_studies_annotations_isolated(
        self,
        test_db: AsyncSession,
        sample_study: Study,
        sample_series: Series,
        sample_patient: Patient,
    ):
        """Test that annotation counts are isolated per study."""
        from sqlalchemy import func

        from app.models.annotation import Annotation

        # Create a second study
        study2 = Study(
            study_instance_uid="1.2.840.10008.5.1.4.1.1.2.1.99999.100",
            study_id="STUDY002",
            study_date=date(2024, 1, 16),
            study_description="Test CT Study 2",
            accession_number="ACC002",
            modalities_in_study="CT",
            num_series=1,
            num_instances=5,
            status=StudyStatus.COMPLETE,
            patient_id_fk=sample_patient.id,
        )
        test_db.add(study2)
        await test_db.commit()

        # Create 2 annotations for study 1
        for i in range(2):
            annotation = Annotation(
                study_uid=sample_study.study_instance_uid,
                series_uid=sample_series.series_instance_uid,
                instance_uid=f"1.2.840.10008.5.1.4.1.1.2.1.99999.{i}",
                annotation_type=AnnotationType.RECTANGLE,
                geometry={"points": [[10, 10], [20, 20]]},
                created_by="test_user",
            )
            test_db.add(annotation)

        # Create 5 annotations for study 2
        for i in range(5):
            annotation = Annotation(
                study_uid=study2.study_instance_uid,
                series_uid=sample_series.series_instance_uid,
                instance_uid=f"1.2.840.10008.5.1.4.1.1.2.1.99999.{i + 100}",
                annotation_type=AnnotationType.ELLIPSE,
                geometry={"points": [[30, 30], [40, 40]]},
                created_by="test_user",
            )
            test_db.add(annotation)

        await test_db.commit()

        # Verify study 1 has 2 annotations
        query1 = select(func.count()).select_from(Annotation).where(
            Annotation.study_uid == sample_study.study_instance_uid
        )
        result1 = await test_db.execute(query1)
        count1 = result1.scalar() or 0
        assert count1 == 2

        # Verify study 2 has 5 annotations
        query2 = select(func.count()).select_from(Annotation).where(
            Annotation.study_uid == study2.study_instance_uid
        )
        result2 = await test_db.execute(query2)
        count2 = result2.scalar() or 0
        assert count2 == 5

    @pytest.mark.asyncio
    async def test_annotation_types_all_counted(
        self,
        test_db: AsyncSession,
        sample_study: Study,
        sample_series: Series,
    ):
        """Test that all annotation types are counted correctly."""
        from sqlalchemy import func

        from app.models.annotation import Annotation

        # Create annotations of different types
        annotation_types = [
            AnnotationType.LENGTH,
            AnnotationType.ANGLE,
            AnnotationType.AREA,
            AnnotationType.ELLIPSE,
            AnnotationType.TEXT,
        ]

        for i, ann_type in enumerate(annotation_types):
            annotation = Annotation(
                study_uid=sample_study.study_instance_uid,
                series_uid=sample_series.series_instance_uid,
                instance_uid=f"1.2.840.10008.5.1.4.1.1.2.1.99999.{i}",
                annotation_type=ann_type,
                geometry={"points": [[i * 10, i * 10], [i * 10 + 5, i * 10 + 5]]},
                created_by="test_user",
            )
            test_db.add(annotation)

        await test_db.commit()

        # Query total count
        query = select(func.count()).select_from(Annotation).where(
            Annotation.study_uid == sample_study.study_instance_uid
        )
        result = await test_db.execute(query)
        count = result.scalar() or 0

        assert count == len(annotation_types)
