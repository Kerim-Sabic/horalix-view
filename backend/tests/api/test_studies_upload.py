"""API tests for streaming DICOM uploads."""

from datetime import datetime
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydicom.dataset import Dataset, FileDataset
from pydicom.uid import ExplicitVRLittleEndian
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.v1.endpoints.auth import get_current_active_user
from app.api.v1.endpoints.studies import router as studies_router
from app.core.security import TokenData
from app.models.base import Base, get_db
from app.models.instance import Instance
from app.models.series import Series
from app.models.study import Study
from app.services.dicom.storage import DicomStorageService


def _create_test_dicom(path: Path) -> None:
    file_meta = Dataset()
    file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.2"
    file_meta.MediaStorageSOPInstanceUID = "1.2.3.4.5.6.7.8.9.1"
    file_meta.ImplementationClassUID = "1.2.3.4.5.6.7.8.9.2"

    ds = FileDataset(str(path), {}, file_meta=file_meta, preamble=b"\0" * 128)
    ds.is_little_endian = True
    ds.is_implicit_VR = False
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian

    ds.PatientID = "TEST001"
    ds.PatientName = "Test^Patient"
    ds.StudyInstanceUID = "1.2.3"
    ds.SeriesInstanceUID = "1.2.3.4"
    ds.SOPInstanceUID = "1.2.3.4.5"
    ds.Modality = "CT"
    ds.StudyDate = datetime.now().strftime("%Y%m%d")
    ds.SeriesNumber = 1
    ds.InstanceNumber = 1
    ds.Rows = 1
    ds.Columns = 1
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 0
    ds.PixelData = b"\x00\x00"

    ds.save_as(str(path), write_like_original=False)


@pytest.fixture
async def upload_app(tmp_path: Path):
    app = FastAPI()
    app.include_router(studies_router, prefix="/api/v1/studies")

    db_file = tmp_path / "test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_file}", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_maker = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with session_maker() as session:
            yield session

    async def override_user() -> TokenData:
        return TokenData(user_id="test-user", username="tester", roles=["admin"], permissions=[])

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_active_user] = override_user

    storage = DicomStorageService(tmp_path / "storage")
    await storage.initialize()
    app.state.dicom_storage = storage

    yield app, session_maker, storage

    await engine.dispose()


@pytest.mark.asyncio
async def test_upload_stores_dicom_file(upload_app, tmp_path: Path) -> None:
    app, session_maker, storage = upload_app
    dicom_path = tmp_path / "test.dcm"
    _create_test_dicom(dicom_path)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with dicom_path.open("rb") as f:
            response = await client.post(
                "/api/v1/studies/upload",
                files={"files": ("test.dcm", f, "application/dicom")},
            )

    assert response.status_code == 201
    payload = response.json()
    assert payload["study_instance_uid"] == "1.2.3"

    stored_path = storage.storage_dir / "TEST001" / "1.2.3" / "1.2.3.4" / "1.2.3.4.5.dcm"
    assert stored_path.exists()

    async with session_maker() as session:
        study_result = await session.execute(
            select(Study).where(Study.study_instance_uid == payload["study_instance_uid"])
        )
        study = study_result.scalar_one_or_none()
        assert study is not None

        series = (await session.execute(select(Series))).scalars().all()
        instances = (await session.execute(select(Instance))).scalars().all()
        assert len(series) == 1
        assert len(instances) == 1
