"""Base AI Model Interface for Horalix View.

Defines the plugin interface for AI models, allowing easy extension
and integration of new models.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Generic, TypeVar

import numpy as np

from app.core.logging import get_logger

logger = get_logger(__name__)

T = TypeVar("T")


class ModelType(str, Enum):
    """Types of AI models."""

    SEGMENTATION = "segmentation"
    DETECTION = "detection"
    CLASSIFICATION = "classification"
    ENHANCEMENT = "enhancement"
    PATHOLOGY = "pathology"
    CARDIAC = "cardiac"


@dataclass
class ModelMetadata:
    """Metadata for an AI model."""

    name: str
    version: str
    model_type: ModelType
    description: str
    supported_modalities: list[str]
    input_size: tuple[int, ...] | None = None
    output_channels: int | None = None
    class_names: list[str] = field(default_factory=list)
    performance_metrics: dict[str, float] = field(default_factory=dict)
    reference: str | None = None
    license: str = "Apache-2.0"


@dataclass
class InferenceResult(Generic[T]):
    """Result of model inference."""

    model_name: str
    model_version: str
    inference_time_ms: float
    output: T
    metadata: dict[str, Any] = field(default_factory=dict)
    confidence: float | None = None
    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "model_name": self.model_name,
            "model_version": self.model_version,
            "inference_time_ms": self.inference_time_ms,
            "confidence": self.confidence,
            "metadata": self.metadata,
            "timestamp": self.timestamp.isoformat(),
        }


@dataclass
class SegmentationOutput:
    """Output of segmentation model."""

    mask: np.ndarray  # Shape: (H, W) or (D, H, W) or (C, D, H, W)
    class_indices: list[int]
    class_names: list[str]
    probabilities: np.ndarray | None = None
    dice_scores: dict[str, float] = field(default_factory=dict)
    volumes_mm3: dict[str, float] = field(default_factory=dict)


@dataclass
class DetectionOutput:
    """Output of detection model."""

    boxes: np.ndarray  # Shape: (N, 4) - [x1, y1, x2, y2]
    scores: np.ndarray  # Shape: (N,)
    class_ids: np.ndarray  # Shape: (N,)
    class_names: list[str]
    masks: np.ndarray | None = None  # Optional instance masks


@dataclass
class ClassificationOutput:
    """Output of classification model."""

    predicted_class: str
    predicted_class_id: int
    confidence: float
    probabilities: dict[str, float]
    features: np.ndarray | None = None  # Optional feature embeddings


@dataclass
class EnhancementOutput:
    """Output of enhancement model."""

    enhanced_image: np.ndarray
    enhancement_type: str
    metrics: dict[str, float] = field(default_factory=dict)  # PSNR, SSIM, etc.


class BaseAIModel(ABC):
    """Abstract base class for AI models.

    All AI models in Horalix View should inherit from this class
    to ensure consistent interface and behavior.

    Example usage:
        class MySegmentationModel(BaseAIModel):
            def __init__(self, weights_path: Path):
                super().__init__()
                self.model = load_model(weights_path)

            @property
            def metadata(self) -> ModelMetadata:
                return ModelMetadata(
                    name="my_model",
                    version="1.0.0",
                    model_type=ModelType.SEGMENTATION,
                    description="My segmentation model",
                    supported_modalities=["CT", "MR"],
                )

            async def predict(self, image: np.ndarray) -> InferenceResult:
                # Run inference
                output = self.model(image)
                return InferenceResult(...)

            async def load(self) -> None:
                self._loaded = True

            async def unload(self) -> None:
                self._loaded = False
    """

    def __init__(self):
        """Initialize base model."""
        self._loaded = False
        self._device = "cpu"

    @property
    @abstractmethod
    def metadata(self) -> ModelMetadata:
        """Get model metadata."""
        pass

    @property
    def is_loaded(self) -> bool:
        """Check if model is loaded."""
        return self._loaded

    @property
    def device(self) -> str:
        """Get current device."""
        return self._device

    @abstractmethod
    async def load(self, device: str = "cuda") -> None:
        """Load model weights into memory.

        Args:
            device: Device to load model to ('cuda', 'cpu')

        """
        pass

    @abstractmethod
    async def unload(self) -> None:
        """Unload model from memory."""
        pass

    @abstractmethod
    async def predict(
        self,
        image: np.ndarray,
        **kwargs: Any,
    ) -> InferenceResult:
        """Run inference on input image.

        Args:
            image: Input image array
            **kwargs: Additional model-specific parameters

        Returns:
            InferenceResult with model output

        """
        pass

    async def preprocess(self, image: np.ndarray) -> np.ndarray:
        """Preprocess image before inference.

        Override this method for custom preprocessing.

        Args:
            image: Raw input image

        Returns:
            Preprocessed image

        """
        return image

    async def postprocess(self, output: Any) -> Any:
        """Postprocess model output.

        Override this method for custom postprocessing.

        Args:
            output: Raw model output

        Returns:
            Postprocessed output

        """
        return output

    def validate_input(self, image: np.ndarray) -> None:
        """Validate input image.

        Args:
            image: Input image to validate

        Raises:
            ValueError: If image is invalid

        """
        if image is None:
            raise ValueError("Input image cannot be None")

        if not isinstance(image, np.ndarray):
            raise ValueError(f"Expected numpy array, got {type(image)}")

        if image.size == 0:
            raise ValueError("Input image is empty")


class SegmentationModel(BaseAIModel):
    """Base class for segmentation models."""

    @abstractmethod
    async def predict(
        self,
        image: np.ndarray,
        **kwargs: Any,
    ) -> InferenceResult[SegmentationOutput]:
        """Run segmentation inference."""
        pass

    async def compute_metrics(
        self,
        prediction: np.ndarray,
        ground_truth: np.ndarray,
    ) -> dict[str, float]:
        """Compute segmentation metrics.

        Args:
            prediction: Predicted segmentation mask
            ground_truth: Ground truth mask

        Returns:
            Dictionary of metrics (Dice, HD95, etc.)

        """
        # Dice coefficient
        intersection = np.logical_and(prediction, ground_truth).sum()
        union = prediction.sum() + ground_truth.sum()
        dice = 2 * intersection / (union + 1e-8)

        return {"dice": float(dice)}


class DetectionModel(BaseAIModel):
    """Base class for detection models."""

    @abstractmethod
    async def predict(
        self,
        image: np.ndarray,
        confidence_threshold: float = 0.5,
        nms_threshold: float = 0.45,
        **kwargs: Any,
    ) -> InferenceResult[DetectionOutput]:
        """Run detection inference."""
        pass


class ClassificationModel(BaseAIModel):
    """Base class for classification models."""

    @abstractmethod
    async def predict(
        self,
        image: np.ndarray,
        return_features: bool = False,
        **kwargs: Any,
    ) -> InferenceResult[ClassificationOutput]:
        """Run classification inference."""
        pass


class EnhancementModel(BaseAIModel):
    """Base class for image enhancement models."""

    @abstractmethod
    async def predict(
        self,
        image: np.ndarray,
        enhancement_factor: float = 1.0,
        **kwargs: Any,
    ) -> InferenceResult[EnhancementOutput]:
        """Run enhancement inference."""
        pass


class InteractiveSegmentationModel(SegmentationModel):
    """Base class for interactive segmentation models (SAM, MedSAM)."""

    @abstractmethod
    async def predict_with_prompts(
        self,
        image: np.ndarray,
        points: list[tuple[float, float]] | None = None,
        point_labels: list[int] | None = None,
        box: tuple[float, float, float, float] | None = None,
        mask_input: np.ndarray | None = None,
        **kwargs: Any,
    ) -> InferenceResult[SegmentationOutput]:
        """Run segmentation with interactive prompts.

        Args:
            image: Input image
            points: List of (x, y) point coordinates
            point_labels: Labels for points (1=foreground, 0=background)
            box: Bounding box [x1, y1, x2, y2]
            mask_input: Optional mask input from previous iteration

        Returns:
            Segmentation result

        """
        pass

    @abstractmethod
    async def encode_image(self, image: np.ndarray) -> Any:
        """Encode image for efficient multi-prompt inference.

        Args:
            image: Input image

        Returns:
            Image embedding

        """
        pass
