"""
Tests for AI model implementations.

These tests verify:
1. Model loading fails clearly when weights are missing
2. Model loading succeeds when weights are present
3. Inference produces valid outputs
4. Job state transitions work correctly
"""

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest

from app.core.config import AIModelSettings
from app.services.ai.model_registry import ModelRegistry, ModelNotAvailableError
from app.services.ai.base import ModelType


class TestYoloV8Detector:
    """Tests for YOLOv8 detection model."""

    @pytest.fixture
    def weights_path(self, tmp_path):
        """Create a temporary weights path."""
        return tmp_path / "yolov8"

    @pytest.mark.asyncio
    async def test_load_fails_without_weights(self, weights_path):
        """Test that loading fails clearly when weights are missing."""
        from app.services.ai.models.yolov8_detector import YoloV8Detector

        detector = YoloV8Detector(weights_path=weights_path)

        with pytest.raises(FileNotFoundError) as exc_info:
            await detector.load(device="cpu")

        error_msg = str(exc_info.value)
        assert "YOLOv8 weights not found" in error_msg
        assert str(weights_path) in error_msg
        assert "Download pretrained weights" in error_msg

    @pytest.mark.asyncio
    async def test_predict_fails_without_load(self, weights_path):
        """Test that prediction fails if model not loaded."""
        from app.services.ai.models.yolov8_detector import YoloV8Detector

        detector = YoloV8Detector(weights_path=weights_path)
        image = np.random.rand(512, 512).astype(np.float32)

        with pytest.raises(RuntimeError) as exc_info:
            await detector.predict(image)

        assert "Model not loaded" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_validate_input_2d_grayscale(self, weights_path):
        """Test input validation accepts 2D grayscale images."""
        from app.services.ai.models.yolov8_detector import YoloV8Detector

        detector = YoloV8Detector(weights_path=weights_path)
        image = np.random.rand(512, 512).astype(np.float32)

        # Should not raise
        detector.validate_input(image)

    @pytest.mark.asyncio
    async def test_validate_input_3d_rgb(self, weights_path):
        """Test input validation accepts 3D RGB images."""
        from app.services.ai.models.yolov8_detector import YoloV8Detector

        detector = YoloV8Detector(weights_path=weights_path)
        image = np.random.rand(512, 512, 3).astype(np.float32)

        # Should not raise
        detector.validate_input(image)

    @pytest.mark.asyncio
    async def test_validate_input_rejects_invalid(self, weights_path):
        """Test input validation rejects invalid shapes."""
        from app.services.ai.models.yolov8_detector import YoloV8Detector

        detector = YoloV8Detector(weights_path=weights_path)
        image = np.random.rand(10, 512, 512, 5).astype(np.float32)

        with pytest.raises(ValueError):
            detector.validate_input(image)

    @pytest.mark.asyncio
    async def test_preprocess_grayscale_to_rgb(self, weights_path):
        """Test preprocessing converts grayscale to RGB."""
        from app.services.ai.models.yolov8_detector import YoloV8Detector

        detector = YoloV8Detector(weights_path=weights_path)
        image = np.random.rand(512, 512).astype(np.float32)

        processed = await detector.preprocess(image)

        assert processed.ndim == 3
        assert processed.shape[2] == 3
        assert processed.dtype == np.uint8

    @pytest.mark.asyncio
    async def test_metadata_properties(self, weights_path):
        """Test that model metadata is correctly set."""
        from app.services.ai.models.yolov8_detector import YoloV8Detector

        detector = YoloV8Detector(weights_path=weights_path)
        meta = detector.metadata

        assert meta.name == "yolov8"
        assert meta.model_type == ModelType.DETECTION
        assert "DX" in meta.supported_modalities
        assert "CT" in meta.supported_modalities


class TestMonaiSegmentationModel:
    """Tests for MONAI segmentation model."""

    @pytest.fixture
    def model_path(self, tmp_path):
        """Create a temporary model path."""
        return tmp_path / "monai_segmentation"

    @pytest.mark.asyncio
    async def test_load_fails_without_weights(self, model_path):
        """Test that loading fails clearly when weights are missing."""
        from app.services.ai.models.monai_segmenter import MonaiSegmentationModel

        model = MonaiSegmentationModel(
            model_path=model_path,
            class_names=["background", "organ"],
        )

        with pytest.raises(FileNotFoundError) as exc_info:
            await model.load(device="cpu")

        error_msg = str(exc_info.value)
        assert "MONAI segmentation weights not found" in error_msg

    @pytest.mark.asyncio
    async def test_validate_input_2d(self, model_path):
        """Test input validation accepts 2D images."""
        from app.services.ai.models.monai_segmenter import MonaiSegmentationModel

        model = MonaiSegmentationModel(
            model_path=model_path,
            class_names=["background", "organ"],
        )
        image = np.random.rand(512, 512).astype(np.float32)

        # Should not raise
        model.validate_input(image)

    @pytest.mark.asyncio
    async def test_validate_input_3d(self, model_path):
        """Test input validation accepts 3D volumes."""
        from app.services.ai.models.monai_segmenter import MonaiSegmentationModel

        model = MonaiSegmentationModel(
            model_path=model_path,
            class_names=["background", "organ"],
        )
        volume = np.random.rand(64, 512, 512).astype(np.float32)

        # Should not raise
        model.validate_input(volume)


class TestMedSAMModel:
    """Tests for MedSAM interactive segmentation model."""

    @pytest.fixture
    def checkpoint_path(self, tmp_path):
        """Create a temporary checkpoint path."""
        return tmp_path / "medsam"

    @pytest.mark.asyncio
    async def test_load_fails_without_checkpoint(self, checkpoint_path):
        """Test that loading fails clearly when checkpoint is missing."""
        from app.services.ai.models.medsam_segmenter import MedSAMModel

        model = MedSAMModel(checkpoint_path=checkpoint_path)

        with pytest.raises(FileNotFoundError) as exc_info:
            await model.load(device="cpu")

        error_msg = str(exc_info.value)
        assert "MedSAM checkpoint not found" in error_msg
        assert "https://github.com/bowang-lab/MedSAM" in error_msg

    @pytest.mark.asyncio
    async def test_predict_requires_prompts(self, checkpoint_path):
        """Test that prediction requires at least one prompt type."""
        from app.services.ai.models.medsam_segmenter import MedSAMModel

        model = MedSAMModel(checkpoint_path=checkpoint_path)
        model._loaded = True  # Bypass load check for this test
        model._model = MagicMock()

        image = np.random.rand(512, 512).astype(np.float32)

        with pytest.raises(ValueError) as exc_info:
            await model.predict_with_prompts(image)

        assert "At least one prompt type required" in str(exc_info.value)


class TestModelRegistry:
    """Tests for model registry."""

    @pytest.fixture
    def settings(self, tmp_path):
        """Create AI model settings with temp directory."""
        return AIModelSettings(
            models_dir=tmp_path / "models",
            cache_dir=tmp_path / "cache",
        )

    @pytest.mark.asyncio
    async def test_initialize_creates_directories(self, settings):
        """Test that initialization creates model directories."""
        registry = ModelRegistry(settings)
        await registry.initialize()

        assert settings.models_dir.exists()
        assert settings.cache_dir.exists()
        assert registry.is_ready()

    @pytest.mark.asyncio
    async def test_get_registered_models(self, settings):
        """Test that registered models can be retrieved."""
        registry = ModelRegistry(settings)
        await registry.initialize()

        models = registry.get_registered_models()
        assert len(models) > 0

        # Check that YOLOv8 is registered
        model_names = [m.name for m in models]
        assert "yolov8" in model_names

    @pytest.mark.asyncio
    async def test_get_model_availability(self, settings):
        """Test model availability checking."""
        registry = ModelRegistry(settings)
        await registry.initialize()

        availability = registry.get_model_availability()
        assert "yolov8" in availability

        # Without weights, should not be available
        assert availability["yolov8"]["registered"] is True
        assert availability["yolov8"]["weights_available"] is False

    @pytest.mark.asyncio
    async def test_is_model_available_without_weights(self, settings):
        """Test is_model_available returns False without weights."""
        registry = ModelRegistry(settings)
        await registry.initialize()

        assert registry.is_model_available("yolov8") is False

    @pytest.mark.asyncio
    async def test_load_model_fails_without_weights(self, settings):
        """Test loading model fails clearly without weights."""
        registry = ModelRegistry(settings)
        await registry.initialize()

        with pytest.raises(FileNotFoundError):
            await registry.load_model("yolov8")

    @pytest.mark.asyncio
    async def test_get_models_by_type(self, settings):
        """Test filtering models by type."""
        registry = ModelRegistry(settings)
        await registry.initialize()

        detection_models = registry.get_models_by_type(ModelType.DETECTION)
        assert len(detection_models) >= 1
        assert all(m.model_type == ModelType.DETECTION for m in detection_models)

        segmentation_models = registry.get_models_by_type(ModelType.SEGMENTATION)
        assert len(segmentation_models) >= 1
        assert all(m.model_type == ModelType.SEGMENTATION for m in segmentation_models)

    @pytest.mark.asyncio
    async def test_get_models_for_modality(self, settings):
        """Test filtering models by supported modality."""
        registry = ModelRegistry(settings)
        await registry.initialize()

        ct_models = registry.get_models_for_modality("CT")
        assert len(ct_models) >= 1
        assert all("CT" in m.supported_modalities for m in ct_models)

    @pytest.mark.asyncio
    async def test_shutdown(self, settings):
        """Test registry shutdown."""
        registry = ModelRegistry(settings)
        await registry.initialize()

        assert registry.is_ready()
        await registry.shutdown()
        assert not registry.is_ready()


class TestDicomLoader:
    """Tests for DICOM loading pipeline."""

    @pytest.fixture
    def mock_storage(self, tmp_path):
        """Create a mock storage service."""
        storage = MagicMock()
        storage.get_study_path = AsyncMock(return_value=tmp_path)
        return storage

    @pytest.mark.asyncio
    async def test_load_series_not_found(self, mock_storage, tmp_path):
        """Test loading series that doesn't exist."""
        from app.services.ai.dicom_loader import DicomLoader

        mock_storage.get_study_path = AsyncMock(return_value=None)
        loader = DicomLoader(mock_storage)

        with pytest.raises(FileNotFoundError) as exc_info:
            await loader.load_series("1.2.3", "4.5.6")

        assert "Study not found" in str(exc_info.value)

    def test_prepare_for_inference_2d(self, mock_storage):
        """Test preprocessing 2D image for inference."""
        from app.services.ai.dicom_loader import DicomLoader, LoadedVolume, VolumeMetadata

        loader = DicomLoader(mock_storage)

        # Create a test volume
        pixel_data = np.random.rand(512, 512).astype(np.float32) * 4096 - 1024
        metadata = VolumeMetadata(
            study_uid="1.2.3",
            series_uid="4.5.6",
            modality="CT",
        )
        volume = LoadedVolume(pixel_data=pixel_data, metadata=metadata, is_3d=False)

        processed = loader.prepare_for_inference(volume, normalize=True)

        assert processed.dtype == np.float32
        assert processed.min() >= 0.0
        assert processed.max() <= 1.0

    def test_prepare_for_inference_3d(self, mock_storage):
        """Test preprocessing 3D volume for inference."""
        from app.services.ai.dicom_loader import DicomLoader, LoadedVolume, VolumeMetadata

        loader = DicomLoader(mock_storage)

        # Create a test volume
        pixel_data = np.random.rand(64, 512, 512).astype(np.float32) * 4096 - 1024
        metadata = VolumeMetadata(
            study_uid="1.2.3",
            series_uid="4.5.6",
            modality="CT",
        )
        volume = LoadedVolume(pixel_data=pixel_data, metadata=metadata, is_3d=True)

        processed = loader.prepare_for_inference(volume, normalize=True)

        assert processed.ndim == 3
        assert processed.shape[0] == 64
        assert processed.dtype == np.float32

    def test_prepare_for_inference_to_rgb(self, mock_storage):
        """Test preprocessing converts grayscale to RGB."""
        from app.services.ai.dicom_loader import DicomLoader, LoadedVolume, VolumeMetadata

        loader = DicomLoader(mock_storage)

        pixel_data = np.random.rand(512, 512).astype(np.float32)
        metadata = VolumeMetadata(
            study_uid="1.2.3",
            series_uid="4.5.6",
            modality="CR",
        )
        volume = LoadedVolume(pixel_data=pixel_data, metadata=metadata, is_3d=False)

        processed = loader.prepare_for_inference(
            volume, normalize=True, convert_to_rgb=True
        )

        assert processed.ndim == 3
        assert processed.shape[2] == 3


class TestJobStateTransitions:
    """Tests for AI job state transitions."""

    def test_job_status_values(self):
        """Test that all expected job statuses exist."""
        from app.models.job import JobStatus

        assert hasattr(JobStatus, "PENDING")
        assert hasattr(JobStatus, "QUEUED")
        assert hasattr(JobStatus, "RUNNING")
        assert hasattr(JobStatus, "COMPLETED")
        assert hasattr(JobStatus, "FAILED")
        assert hasattr(JobStatus, "CANCELLED")

    def test_task_type_values(self):
        """Test that all expected task types exist."""
        from app.models.job import TaskType

        assert hasattr(TaskType, "SEGMENTATION")
        assert hasattr(TaskType, "DETECTION")
        assert hasattr(TaskType, "CLASSIFICATION")


# Skip tests that require actual weights
class TestWithWeights:
    """Tests that require actual model weights - skipped by default."""

    @pytest.fixture
    def yolov8_weights_path(self):
        """Path to actual YOLOv8 weights."""
        path = Path("models/yolov8/model.pt")
        if not path.exists():
            pytest.skip("YOLOv8 weights not available")
        return path

    @pytest.mark.asyncio
    @pytest.mark.skip(reason="Requires actual model weights")
    async def test_yolov8_real_inference(self, yolov8_weights_path):
        """Test real YOLOv8 inference with actual weights."""
        from app.services.ai.models.yolov8_detector import YoloV8Detector

        detector = YoloV8Detector(weights_path=yolov8_weights_path)
        await detector.load(device="cpu")

        image = np.random.rand(640, 640, 3).astype(np.float32)
        result = await detector.predict(image)

        assert result.model_name == "yolov8"
        assert result.inference_time_ms > 0
        assert hasattr(result.output, "boxes")
        assert hasattr(result.output, "scores")
