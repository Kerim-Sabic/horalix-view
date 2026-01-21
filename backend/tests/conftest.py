"""Pytest configuration and shared fixtures for Horalix View backend tests.

This module provides common fixtures for testing the backend components
including database sessions, mock services, and test data factories.
"""

import asyncio
from collections.abc import Generator
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

# Use in-memory SQLite for tests
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    """Create event loop for async tests."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def tmp_models_dir(tmp_path: Path) -> Path:
    """Create a temporary models directory for AI tests."""
    models_dir = tmp_path / "models"
    models_dir.mkdir()
    return models_dir


@pytest.fixture
def tmp_storage_dir(tmp_path: Path) -> Path:
    """Create a temporary storage directory for DICOM tests."""
    storage_dir = tmp_path / "storage"
    storage_dir.mkdir()
    return storage_dir


@pytest.fixture
def mock_dicom_storage(tmp_storage_dir: Path) -> MagicMock:
    """Create a mock DICOM storage service."""
    storage = MagicMock()
    storage.storage_dir = tmp_storage_dir
    storage.is_ready = MagicMock(return_value=True)
    storage.get_study_path = AsyncMock(return_value=tmp_storage_dir)
    storage.initialize = AsyncMock()
    return storage


@pytest.fixture
def mock_model_registry(tmp_models_dir: Path) -> MagicMock:
    """Create a mock model registry."""
    registry = MagicMock()
    registry.models_dir = tmp_models_dir
    registry.is_ready = MagicMock(return_value=True)
    registry.initialize = AsyncMock()
    registry.shutdown = AsyncMock()
    registry.get_registered_models = MagicMock(return_value=[])
    registry.get_model_availability = MagicMock(return_value={})
    return registry


@pytest.fixture
def sample_dicom_metadata() -> dict[str, Any]:
    """Sample DICOM metadata for testing."""
    return {
        "study_instance_uid": "1.2.840.113619.2.1.1.1762870857.1476.1521210578.1",
        "series_instance_uid": "1.2.840.113619.2.1.1.1762870857.1476.1521210578.2",
        "sop_instance_uid": "1.2.840.113619.2.1.1.1762870857.1476.1521210578.3",
        "patient_id": "TEST001",
        "patient_name": "Test^Patient",
        "modality": "CT",
        "study_date": "20240101",
        "study_description": "CT CHEST",
        "rows": 512,
        "columns": 512,
        "bits_allocated": 16,
        "bits_stored": 12,
    }


@pytest.fixture
def sample_user_data() -> dict[str, str]:
    """Sample user data for authentication tests."""
    return {
        "username": "testuser",
        "email": "test@example.com",
        "password": "TestPassword123!",
        "full_name": "Test User",
    }


@pytest.fixture
def mock_settings(tmp_path: Path) -> MagicMock:
    """Create mock settings for testing."""
    from app.core.config import AIModelSettings, DICOMSettings

    settings = MagicMock()
    settings.app_name = "Horalix View"
    settings.app_version = "1.0.0"
    settings.environment = "development"
    settings.debug = True
    settings.secret_key = "test-secret-key-for-testing-only"
    settings.ai = AIModelSettings(
        models_dir=tmp_path / "models",
        cache_dir=tmp_path / "cache",
    )
    settings.dicom = DICOMSettings(
        storage_dir=tmp_path / "storage",
    )
    return settings
