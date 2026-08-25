"""API tests for the multi-frame clip sheet.

The clip route exists so a cine costs one request and one decode instead of one
per displayed frame. These tests check the geometry contract the viewer relies
on to slice frames back out of the sheet, and that the tiles carry the frames
they claim to.
"""

from io import BytesIO
from pathlib import Path

import numpy as np
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from PIL import Image
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

FRAME_COUNT = 7
FRAME_SIZE = 8


def _multiframe_dicom(
    path: Path, frames: int = FRAME_COUNT, color: bool = False, uid_suffix: str = "1"
) -> None:
    """A multi-frame instance whose frame *n* is filled with a distinct value.

    ``uid_suffix`` keeps SOP Instance UIDs distinct between fixtures. Real
    instances are globally unique, and the render cache relies on that: two
    different images sharing a UID would serve each other's pixels.
    """
    file_meta = Dataset()
    file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.3.1"
    file_meta.MediaStorageSOPInstanceUID = "1.2.3.4.5.6.7.8.9.20"
    file_meta.ImplementationClassUID = "1.2.3.4.5.6.7.8.9.21"

    ds = FileDataset(str(path), {}, file_meta=file_meta, preamble=b"\0" * 128)
    ds.is_little_endian = True
    ds.is_implicit_VR = False
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian

    ds.PatientID = "CLIP001"
    ds.PatientName = "Clip^Patient"
    ds.StudyInstanceUID = "1.2.840.10008.9.1"
    ds.SeriesInstanceUID = "1.2.840.10008.9.1.1"
    ds.SOPInstanceUID = f"1.2.840.10008.9.1.1.{uid_suffix}"
    ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.3.1"
    ds.Modality = "US"
    ds.StudyDate = "20250101"
    ds.SeriesNumber = 1
    ds.InstanceNumber = 1

    ds.Rows = FRAME_SIZE
    ds.Columns = FRAME_SIZE
    ds.NumberOfFrames = frames
    ds.BitsAllocated = 8
    ds.BitsStored = 8
    ds.HighBit = 7
    ds.PixelRepresentation = 0

    # Frame n is uniformly (n+1)*20, so a tile identifies its own frame index.
    values = np.arange(1, frames + 1, dtype=np.uint8) * 20

    if color:
        ds.SamplesPerPixel = 3
        ds.PhotometricInterpretation = "RGB"
        ds.PlanarConfiguration = 0
        volume = np.zeros((frames, FRAME_SIZE, FRAME_SIZE, 3), dtype=np.uint8)
        for i, value in enumerate(values):
            volume[i, :, :, :] = value
    else:
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        volume = np.zeros((frames, FRAME_SIZE, FRAME_SIZE), dtype=np.uint8)
        for i, value in enumerate(values):
            volume[i, :, :] = value

    ds.PixelData = volume.tobytes()
    # Wide window so the 8-bit values pass through roughly unchanged.
    ds.WindowCenter = 128
    ds.WindowWidth = 256
    ds.save_as(str(path), write_like_original=False)


def _singleframe_dicom(path: Path) -> None:
    _multiframe_dicom(path, frames=1, uid_suffix="still")


@pytest.fixture
async def clip_app(tmp_path: Path):
    app = FastAPI()
    app.include_router(studies_router, prefix="/api/v1/studies")
    app.include_router(instances_router, prefix="/api/v1/instances")

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'clip.db'}", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_maker = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with session_maker() as session:
            yield session

    async def override_user() -> TokenData:
        return TokenData(user_id="t", username="t", roles=["admin"], permissions=[])

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_active_user] = override_user
    app.dependency_overrides[get_current_active_user_from_token] = override_user

    storage = DicomStorageService(tmp_path / "storage")
    await storage.initialize()
    app.state.dicom_storage = storage

    yield app, session_maker
    await engine.dispose()


async def _upload(client: AsyncClient, session_maker, path: Path) -> str:
    with path.open("rb") as handle:
        response = await client.post(
            "/api/v1/studies/upload",
            files={"files": (path.name, handle, "application/dicom")},
        )
    assert response.status_code == 201, response.text

    async with session_maker() as session:
        result = await session.execute(select(Instance))
        instance = result.scalars().first()
        assert instance is not None
        return instance.sop_instance_uid


def _tile(sheet: Image.Image, headers, index: int) -> Image.Image:
    """Slice frame `index` back out of the sheet, the way the viewer does."""
    columns = int(headers["X-Grid-Columns"])
    width = int(headers["X-Frame-Width"])
    height = int(headers["X-Frame-Height"])
    left = (index % columns) * width
    top = (index // columns) * height
    return sheet.crop((left, top, left + width, top + height))


@pytest.mark.asyncio
async def test_clip_returns_one_image_for_the_whole_cine(clip_app, tmp_path: Path) -> None:
    app, session_maker = clip_app
    path = tmp_path / "cine.dcm"
    _multiframe_dicom(path)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        uid = await _upload(client, session_maker, path)

        response = await client.get(
            f"/api/v1/instances/{uid}/clip", params={"format": "png"}
        )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/")
    assert int(response.headers["X-Frame-Count"]) == FRAME_COUNT
    assert int(response.headers["X-Source-Frames"]) == FRAME_COUNT
    assert float(response.headers["X-Frame-Scale"]) == pytest.approx(1.0)


@pytest.mark.asyncio
async def test_grid_geometry_covers_every_frame(clip_app, tmp_path: Path) -> None:
    app, session_maker = clip_app
    path = tmp_path / "cine.dcm"
    _multiframe_dicom(path)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        uid = await _upload(client, session_maker, path)
        response = await client.get(
            f"/api/v1/instances/{uid}/clip", params={"format": "png"}
        )

    headers = response.headers
    columns = int(headers["X-Grid-Columns"])
    width = int(headers["X-Frame-Width"])
    height = int(headers["X-Frame-Height"])
    rows = -(-FRAME_COUNT // columns)

    sheet = Image.open(BytesIO(response.content))
    assert sheet.size == (columns * width, rows * height)
    assert (width, height) == (FRAME_SIZE, FRAME_SIZE)


@pytest.mark.asyncio
async def test_tiles_carry_the_frames_they_claim(clip_app, tmp_path: Path) -> None:
    """The contract the viewer depends on: tile n is frame n."""
    app, session_maker = clip_app
    path = tmp_path / "cine.dcm"
    _multiframe_dicom(path)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        uid = await _upload(client, session_maker, path)
        response = await client.get(
            f"/api/v1/instances/{uid}/clip", params={"format": "png"}
        )

    sheet = Image.open(BytesIO(response.content)).convert("L")
    observed = [
        np.asarray(_tile(sheet, response.headers, i)).mean() for i in range(FRAME_COUNT)
    ]

    # Frame values increase monotonically by construction, so the tiles must too.
    assert observed == sorted(observed)
    assert observed[0] < observed[-1]


@pytest.mark.asyncio
async def test_colour_cine_is_tiled_in_rgb(clip_app, tmp_path: Path) -> None:
    app, session_maker = clip_app
    path = tmp_path / "colour.dcm"
    _multiframe_dicom(path, color=True, uid_suffix="colour")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        uid = await _upload(client, session_maker, path)
        response = await client.get(
            f"/api/v1/instances/{uid}/clip", params={"format": "png"}
        )

    assert response.status_code == 200
    assert Image.open(BytesIO(response.content)).mode == "RGB"
    assert int(response.headers["X-Frame-Count"]) == FRAME_COUNT


@pytest.mark.asyncio
async def test_max_frames_caps_the_sheet(clip_app, tmp_path: Path) -> None:
    app, session_maker = clip_app
    path = tmp_path / "cine.dcm"
    _multiframe_dicom(path)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        uid = await _upload(client, session_maker, path)
        response = await client.get(
            f"/api/v1/instances/{uid}/clip", params={"format": "png", "max_frames": 3}
        )

    assert int(response.headers["X-Frame-Count"]) == 3
    # The viewer needs to know frames were dropped.
    assert int(response.headers["X-Source-Frames"]) == FRAME_COUNT


@pytest.mark.asyncio
async def test_single_frame_instance_is_rejected(clip_app, tmp_path: Path) -> None:
    """Single-frame images have nothing to tile; the per-frame route serves them."""
    app, session_maker = clip_app
    path = tmp_path / "still.dcm"
    _singleframe_dicom(path)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        uid = await _upload(client, session_maker, path)
        response = await client.get(f"/api/v1/instances/{uid}/clip")

    assert response.status_code == 400
    assert "multi-frame" in response.json()["detail"]


@pytest.mark.asyncio
async def test_unknown_instance_is_404(clip_app) -> None:
    app, _ = clip_app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/instances/does.not.exist/clip")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_repeat_request_is_served_from_cache(clip_app, tmp_path: Path) -> None:
    app, session_maker = clip_app
    path = tmp_path / "cine.dcm"
    _multiframe_dicom(path)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        uid = await _upload(client, session_maker, path)
        first = await client.get(f"/api/v1/instances/{uid}/clip", params={"format": "png"})
        second = await client.get(f"/api/v1/instances/{uid}/clip", params={"format": "png"})

    assert first.content == second.content
    assert first.headers["X-Grid-Columns"] == second.headers["X-Grid-Columns"]
