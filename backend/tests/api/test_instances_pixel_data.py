"""API tests for instance pixel data rendering."""

from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydicom.dataset import Dataset, FileDataset
from pydicom.uid import ExplicitVRLittleEndian
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.v1.endpoints.auth import (
    get_current_active_user,
    get_current_active_user_from_token,
)
from app.api.v1.endpoints.instances import router as instances_router
from app.api.v1.endpoints.studies import router as studies_router
from app.core.security import TokenData
from app.models.base import Base, get_db
from app.models.instance import Instance
from app.services.dicom.storage import DicomStorageService


def _base_dataset(path: Path) -> FileDataset:
    file_meta = Dataset()
    file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.7"
    file_meta.MediaStorageSOPInstanceUID = "1.2.3.4.5.6.7.8.9.10"
    file_meta.ImplementationClassUID = "1.2.3.4.5.6.7.8.9.11"

    ds = FileDataset(str(path), {}, file_meta=file_meta, preamble=b"\0" * 128)
    ds.is_little_endian = True
    ds.is_implicit_VR = False
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian

    ds.PatientID = "TEST001"
    ds.PatientName = "Test^Patient"
    ds.StudyInstanceUID = "1.2.840.10008.1.2.3.4"
    ds.SeriesInstanceUID = "1.2.840.10008.1.2.3.4.5"
    ds.SOPInstanceUID = "1.2.840.10008.1.2.3.4.5.6"
    ds.Modality = "US"
    ds.StudyDate = "20250101"
    ds.SeriesNumber = 1
    ds.InstanceNumber = 1
    return ds


def _create_grayscale_dicom(path: Path) -> None:
    ds = _base_dataset(path)
    ds.Rows = 2
    ds.Columns = 2
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 0
    ds.PixelData = b"\x00\x00\x01\x00\x02\x00\x03\x00"
    ds.save_as(str(path), write_like_original=False)


def _create_rgb_dicom(path: Path) -> None:
    ds = _base_dataset(path)
    ds.Rows = 2
    ds.Columns = 2
    ds.SamplesPerPixel = 3
    ds.PhotometricInterpretation = "RGB"
    ds.PlanarConfiguration = 0
    ds.BitsAllocated = 8
    ds.BitsStored = 8
    ds.HighBit = 7
    ds.PixelRepresentation = 0
    ds.PixelData = bytes(
        [
            255,
            0,
            0,
            0,
            255,
            0,
            0,
            0,
            255,
            255,
            255,
            0,
        ]
    )
    ds.save_as(str(path), write_like_original=False)


def _create_rgb_planar_dicom(path: Path) -> None:
    ds = _base_dataset(path)
    ds.Rows = 2
    ds.Columns = 2
    ds.SamplesPerPixel = 3
    ds.PhotometricInterpretation = "RGB"
    ds.PlanarConfiguration = 1
    ds.BitsAllocated = 8
    ds.BitsStored = 8
    ds.HighBit = 7
    ds.PixelRepresentation = 0
    ds.PixelData = bytes(
        [
            255,
            0,
            0,
            255,
            0,
            255,
            0,
            255,
            0,
            0,
            255,
            0,
        ]
    )
    ds.save_as(str(path), write_like_original=False)


@pytest.fixture
async def instances_app(tmp_path: Path):
    app = FastAPI()
    app.include_router(studies_router, prefix="/api/v1/studies")
    app.include_router(instances_router, prefix="/api/v1/instances")

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
    app.dependency_overrides[get_current_active_user_from_token] = override_user

    storage = DicomStorageService(tmp_path / "storage")
    await storage.initialize()
    app.state.dicom_storage = storage

    yield app, session_maker

    await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("creator", [_create_grayscale_dicom, _create_rgb_dicom, _create_rgb_planar_dicom])
async def test_pixel_data_and_thumbnail_render(instances_app, tmp_path: Path, creator) -> None:
    app, session_maker = instances_app
    dicom_path = tmp_path / f"{creator.__name__}.dcm"
    creator(dicom_path)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with dicom_path.open("rb") as file_obj:
            response = await client.post(
                "/api/v1/studies/upload",
                files={"files": (dicom_path.name, file_obj, "application/dicom")},
            )
        assert response.status_code == 201

        async with session_maker() as session:
            result = await session.execute(select(Instance))
            instance = result.scalars().first()
            assert instance is not None
            instance_uid = instance.sop_instance_uid

        pixel_response = await client.get(
            f"/api/v1/instances/{instance_uid}/pixel-data",
            params={"format": "png"},
        )
        assert pixel_response.status_code == 200
        assert pixel_response.headers.get("content-type", "").startswith("image/")

        thumb_response = await client.get(
            f"/api/v1/instances/{instance_uid}/thumbnail",
            params={"size": 96},
        )
        assert thumb_response.status_code == 200
        assert thumb_response.headers.get("content-type", "").startswith("image/")
