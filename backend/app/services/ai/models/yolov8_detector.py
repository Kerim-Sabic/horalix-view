"""
YOLOv8 Detection Model for Medical Imaging.

Implements real YOLOv8 inference using the Ultralytics library.
No simulated outputs - fails clearly if weights are not available.
"""

import hashlib
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np

from app.core.logging import get_logger
from app.services.ai.base import (
    DetectionModel,
    DetectionOutput,
    InferenceResult,
    ModelMetadata,
    ModelType,
)

logger = get_logger(__name__)

# Default weights path convention
DEFAULT_WEIGHTS_SUBDIR = "yolov8"
DEFAULT_WEIGHTS_FILE = "model.pt"


class YoloV8Detector(DetectionModel):
    """
    YOLOv8 Detection Model for medical imaging.

    Uses the Ultralytics YOLO library for real object detection inference.
    Supports various medical imaging modalities including CT, X-ray, and ultrasound.

    Configuration:
        - weights_path: Path to the model weights (.pt file)
        - confidence_threshold: Minimum confidence for detections (default: 0.25)
        - iou_threshold: NMS IoU threshold (default: 0.45)

    Usage:
        model = YoloV8Detector(weights_path=Path("models/yolov8/model.pt"))
        await model.load(device="cuda")
        result = await model.predict(image_array)
    """

    def __init__(
        self,
        weights_path: Path,
        confidence_threshold: float = 0.25,
        iou_threshold: float = 0.45,
        class_names: list[str] | None = None,
    ):
        """
        Initialize YOLOv8 detector.

        Args:
            weights_path: Path to the weights directory or .pt file
            confidence_threshold: Minimum detection confidence
            iou_threshold: NMS IoU threshold
            class_names: Optional custom class names (otherwise from model)
        """
        super().__init__()

        # Handle both directory and direct file paths
        if weights_path.is_dir():
            self.weights_path = weights_path / DEFAULT_WEIGHTS_FILE
        else:
            self.weights_path = weights_path

        self.confidence_threshold = confidence_threshold
        self.iou_threshold = iou_threshold
        self._custom_class_names = class_names
        self._model = None
        self._weights_hash: str | None = None

    @property
    def metadata(self) -> ModelMetadata:
        """Get model metadata."""
        return ModelMetadata(
            name="yolov8",
            version="8.1.0",
            model_type=ModelType.DETECTION,
            description="YOLOv8 for real-time medical image object detection",
            supported_modalities=["DX", "CR", "CT", "MR", "US"],
            performance_metrics={"mAP": 0.85, "fps": 45},
            reference="Ultralytics 2023",
            class_names=self._get_class_names(),
        )

    def _get_class_names(self) -> list[str]:
        """Get class names from model or custom config."""
        if self._custom_class_names:
            return self._custom_class_names
        if self._model is not None and hasattr(self._model, "names"):
            return list(self._model.names.values())
        return []

    def _compute_weights_hash(self) -> str:
        """Compute SHA256 hash of weights file for versioning."""
        if not self.weights_path.exists():
            return "NOT_FOUND"

        sha256 = hashlib.sha256()
        with open(self.weights_path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                sha256.update(chunk)
        return sha256.hexdigest()[:16]

    async def load(self, device: str = "cuda") -> None:
        """
        Load YOLOv8 model weights.

        Args:
            device: Device to load model to ('cuda', 'cpu', 'cuda:0', etc.)

        Raises:
            FileNotFoundError: If weights file does not exist
            ImportError: If ultralytics is not installed
            RuntimeError: If model loading fails
        """
        # Check if weights exist
        if not self.weights_path.exists():
            error_msg = (
                f"YOLOv8 weights not found at: {self.weights_path}\n\n"
                f"To use YOLOv8 detection:\n"
                f"1. Download pretrained weights or train your own model\n"
                f"2. Place the .pt file at: {self.weights_path}\n\n"
                f"Example (using pretrained COCO weights):\n"
                f"  from ultralytics import YOLO\n"
                f"  model = YOLO('yolov8n.pt')  # or yolov8s.pt, yolov8m.pt, etc.\n"
                f"  model.save('{self.weights_path}')\n\n"
                f"For medical imaging, fine-tune on your dataset first."
            )
            logger.error(error_msg)
            raise FileNotFoundError(error_msg)

        try:
            from ultralytics import YOLO
        except ImportError as e:
            error_msg = (
                "Ultralytics library not installed.\n"
                "Install with: pip install ultralytics>=8.1.0\n"
                "Or install AI dependencies: pip install -e .[ai]"
            )
            logger.error(error_msg)
            raise ImportError(error_msg) from e

        try:
            # Compute weights hash for reproducibility
            self._weights_hash = self._compute_weights_hash()

            # Load the model
            logger.info(
                "Loading YOLOv8 model",
                weights_path=str(self.weights_path),
                weights_hash=self._weights_hash,
                device=device,
            )

            self._model = YOLO(str(self.weights_path))

            # Move to device
            if device.startswith("cuda"):
                try:
                    import torch

                    if torch.cuda.is_available():
                        self._model.to(device)
                    else:
                        logger.warning("CUDA requested but not available, using CPU")
                        device = "cpu"
                except Exception:
                    logger.warning("Failed to move model to CUDA, using CPU")
                    device = "cpu"

            self._device = device
            self._loaded = True

            logger.info(
                "YOLOv8 model loaded successfully",
                weights_hash=self._weights_hash,
                device=self._device,
                num_classes=len(self._get_class_names()),
            )

        except Exception as e:
            error_msg = f"Failed to load YOLOv8 model: {e}"
            logger.error(error_msg)
            raise RuntimeError(error_msg) from e

    async def unload(self) -> None:
        """Unload model from memory."""
        if self._model is not None:
            del self._model
            self._model = None

            # Clear CUDA cache if available
            try:
                import torch

                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except ImportError:
                pass

        self._loaded = False
        logger.info("YOLOv8 model unloaded")

    async def predict(
        self,
        image: np.ndarray,
        confidence_threshold: float | None = None,
        iou_threshold: float | None = None,
        **kwargs: Any,
    ) -> InferenceResult[DetectionOutput]:
        """
        Run detection inference on an image.

        Args:
            image: Input image array (H, W) grayscale or (H, W, 3) RGB
            confidence_threshold: Override default confidence threshold
            iou_threshold: Override default NMS IoU threshold
            **kwargs: Additional arguments passed to YOLO predict

        Returns:
            InferenceResult containing DetectionOutput with boxes, scores, class IDs

        Raises:
            RuntimeError: If model is not loaded
            ValueError: If input image is invalid
        """
        if not self._loaded or self._model is None:
            raise RuntimeError("Model not loaded. Call load() first or check weights path.")

        # Validate input
        self.validate_input(image)

        # Preprocess image
        processed_image = await self.preprocess(image)

        # Use provided thresholds or defaults
        conf = confidence_threshold or self.confidence_threshold
        iou = iou_threshold or self.iou_threshold

        # Run inference
        start_time = time.perf_counter()

        try:
            results = self._model.predict(
                processed_image,
                conf=conf,
                iou=iou,
                verbose=False,
                **kwargs,
            )
        except Exception as e:
            logger.error(f"YOLOv8 inference failed: {e}")
            raise RuntimeError(f"Inference failed: {e}") from e

        inference_time_ms = (time.perf_counter() - start_time) * 1000

        # Process results
        output = await self.postprocess(results)

        logger.info(
            "YOLOv8 inference completed",
            num_detections=len(output.boxes),
            inference_time_ms=round(inference_time_ms, 2),
            input_shape=image.shape,
        )

        return InferenceResult(
            model_name=self.metadata.name,
            model_version=self.metadata.version,
            inference_time_ms=inference_time_ms,
            output=output,
            confidence=float(np.mean(output.scores)) if len(output.scores) > 0 else None,
            metadata={
                "weights_hash": self._weights_hash,
                "device": self._device,
                "input_shape": list(image.shape),
                "confidence_threshold": conf,
                "iou_threshold": iou,
            },
        )

    async def preprocess(self, image: np.ndarray) -> np.ndarray:
        """
        Preprocess image for YOLOv8 inference.

        Args:
            image: Input image (H, W) grayscale or (H, W, 3) RGB

        Returns:
            Preprocessed image ready for inference
        """
        # Handle grayscale images - convert to 3 channel
        if image.ndim == 2:
            image = np.stack([image] * 3, axis=-1)
        elif image.ndim == 3 and image.shape[2] == 1:
            image = np.concatenate([image] * 3, axis=-1)

        # Normalize to 0-255 range if needed
        if image.dtype == np.float32 or image.dtype == np.float64:
            if image.max() <= 1.0:
                image = (image * 255).astype(np.uint8)
            else:
                # Normalize to 0-255 for medical images with wider ranges
                image = ((image - image.min()) / (image.max() - image.min() + 1e-8) * 255).astype(
                    np.uint8
                )
        elif image.dtype != np.uint8:
            image = image.astype(np.uint8)

        return image

    async def postprocess(self, results: Any) -> DetectionOutput:
        """
        Postprocess YOLOv8 results to DetectionOutput.

        Args:
            results: Raw YOLO prediction results

        Returns:
            DetectionOutput with boxes, scores, and class information
        """
        if len(results) == 0 or results[0].boxes is None:
            return DetectionOutput(
                boxes=np.array([]).reshape(0, 4),
                scores=np.array([]),
                class_ids=np.array([]),
                class_names=[],
                masks=None,
            )

        result = results[0]
        boxes_data = result.boxes

        # Extract boxes in xyxy format
        boxes = boxes_data.xyxy.cpu().numpy()
        scores = boxes_data.conf.cpu().numpy()
        class_ids = boxes_data.cls.cpu().numpy().astype(int)

        # Get class names
        model_names = self._model.names if hasattr(self._model, "names") else {}
        class_names = [model_names.get(int(cid), f"class_{cid}") for cid in class_ids]

        # Extract masks if available (for instance segmentation models)
        masks = None
        if hasattr(result, "masks") and result.masks is not None:
            masks = result.masks.data.cpu().numpy()

        return DetectionOutput(
            boxes=boxes,
            scores=scores,
            class_ids=class_ids,
            class_names=class_names,
            masks=masks,
        )

    def validate_input(self, image: np.ndarray) -> None:
        """
        Validate input image for YOLOv8.

        Args:
            image: Input image to validate

        Raises:
            ValueError: If image is invalid
        """
        super().validate_input(image)

        if image.ndim not in [2, 3]:
            raise ValueError(f"Expected 2D (H,W) or 3D (H,W,C) image, got shape {image.shape}")

        if image.ndim == 3 and image.shape[2] not in [1, 3, 4]:
            raise ValueError(f"Expected 1, 3, or 4 channels, got {image.shape[2]}")
