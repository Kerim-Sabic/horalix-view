"""API tests for patients endpoints (no demo data)."""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.v1.endpoints.auth import get_current_active_user
from app.api.v1.endpoints.patients import router as patients_router
from app.core.security import TokenData
from app.models.base import Base, get_db


@pytest.fixture
async def patients_app(tmp_path):
    app = FastAPI()
    app.include_router(patients_router, prefix="/api/v1/patients")

    db_file = tmp_path / "patients.db"
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

    yield app
    await engine.dispose()


@pytest.mark.asyncio
async def test_patients_list_is_empty_without_seed(patients_app: FastAPI) -> None:
    transport = ASGITransport(app=patients_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/patients")

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 0
    assert payload["patients"] == []
