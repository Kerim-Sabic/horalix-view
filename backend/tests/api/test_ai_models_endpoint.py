"""API tests for AI models and client error reporting endpoints."""

from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.v1.endpoints.ai import router as ai_router
from app.api.v1.endpoints.auth import get_current_active_user
from app.api.v1.endpoints.health import router as health_router
from app.core.security import TokenData
from app.services.ai.base import ModelMetadata, ModelType


@pytest.fixture
def test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(ai_router, prefix="/api/v1/ai")
    app.include_router(health_router, prefix="/api/v1")

    async def override_user() -> TokenData:
        return TokenData(user_id="test-user", username="tester", roles=["admin"], permissions=["ai:*"])

    app.dependency_overrides[get_current_active_user] = override_user
    return app


@pytest.mark.asyncio
async def test_ai_models_schema_with_empty_registry(test_app: FastAPI) -> None:
    registry = MagicMock()
    registry.get_registered_models.return_value = []
    registry.get_model_availability.return_value = {}
    test_app.state.model_registry = registry

    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/ai/models")

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload.get("models"), list)
    assert payload.get("total_registered") == 0
    assert payload.get("total_available") == 0


@pytest.mark.asyncio
async def test_ai_models_schema_with_missing_weights(test_app: FastAPI, tmp_path) -> None:
    metadata = ModelMetadata(
        name="test_model",
        version="1.0.0",
        model_type=ModelType.SEGMENTATION,
        description="Test model",
        supported_modalities=["CT"],
    )
    registry = MagicMock()
    registry.get_registered_models.return_value = [metadata]
    registry.get_model_availability.return_value = {
        "test_model": {
            "enabled": True,
            "weights_available": False,
            "weights_path": str(tmp_path / "models" / "test_model"),
            "loaded": False,
        }
    }
    test_app.state.model_registry = registry

    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/ai/models")

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload.get("models"), list)
    assert len(payload["models"]) == 1
    model = payload["models"][0]
    assert model["name"] == "test_model"
    assert model["available"] is False
    assert model["status"] in ["missing_weights", "disabled", "available", "loaded"]
    assert isinstance(model["details"], dict)
    assert isinstance(model["requirements"], dict)
    assert isinstance(model["weights"], dict)
    assert isinstance(model["errors"], list)
    assert model["details"]["model_type"] == "segmentation"


@pytest.mark.asyncio
async def test_client_error_endpoint_returns_204(test_app: FastAPI) -> None:
    payload = {
        "message": "TypeError: Cannot read properties of undefined",
        "stack": "stacktrace",
        "url": "http://localhost:3000/ai-models",
        "route": "/ai-models",
        "userAgent": "test-agent",
        "timestamp": "2026-01-21T18:30:00Z",
        "correlationId": "test-correlation",
    }

    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/v1/health/client-error", json=payload)

    assert response.status_code == 204
