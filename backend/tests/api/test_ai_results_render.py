"""API tests for AI results render endpoint."""

from unittest.mock import MagicMock

import numpy as np
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.v1.endpoints import ai as ai_endpoints
from app.api.v1.endpoints.ai import router as ai_router
from app.api.v1.endpoints.auth import get_current_active_user
from app.core.security import TokenData


@pytest.fixture
def test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(ai_router, prefix="/api/v1/ai")

    async def override_user() -> TokenData:
        return TokenData(user_id="test-user", username="tester", roles=["admin"], permissions=["ai:*"])

    app.dependency_overrides[get_current_active_user] = override_user
    app.state.model_registry = MagicMock()
    return app


@pytest.mark.asyncio
async def test_render_mask_overlay_returns_png(test_app: FastAPI, tmp_path) -> None:
    study_uid = "study-render"
    results_dir = tmp_path / "results" / study_uid
    results_dir.mkdir(parents=True)

    mask = np.zeros((3, 16, 16), dtype=np.uint8)
    mask[1, 2:4, 3:5] = 1
    np.savez_compressed(results_dir / "mask.npz", mask=mask)

    ai_endpoints.settings.ai.models_dir = tmp_path / "models"
    ai_endpoints.settings.ai.results_dir = tmp_path / "results"

    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(f"/api/v1/ai/results/{study_uid}/masks/mask.npz/render?slice=1")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/png")
