import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.v1.endpoints.auth import get_current_active_user_from_token
from app.api.v1.endpoints.series import router as series_router
from app.core.security import TokenData
from app.models.base import Base, get_db


@pytest.fixture
async def series_app(tmp_path):
    app = FastAPI()
    app.include_router(series_router, prefix="/api/v1/series")

    db_file = tmp_path / "series.db"
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
    app.dependency_overrides[get_current_active_user_from_token] = override_user

    yield app
    await engine.dispose()


@pytest.mark.asyncio
async def test_track_measurement_returns_404_for_missing_series(series_app: FastAPI) -> None:
    transport = ASGITransport(app=series_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/series/1.2.3/track-measurement",
            json={
                "start_index": 0,
                "track_full_loop": True,
                "points": [{"x": 10.0, "y": 10.0}, {"x": 20.0, "y": 20.0}],
            },
        )

    assert response.status_code == 404
