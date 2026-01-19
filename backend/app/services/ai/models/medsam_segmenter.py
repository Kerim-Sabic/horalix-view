"""
MedSAM Interactive Segmentation Model.

Implements SAM-style interactive segmentation for medical imaging.
Supports point prompts, box prompts, and mask prompts.
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
    InferenceResult,
    InteractiveSegmentationModel,
    ModelMetadata,
    ModelType,
    SegmentationOutput,
)

logger = get_logger(__name__)

# Default paths
DEFAULT_CHECKPOINT = "medsam_vit_b.pth"


class MedSAMModel(InteractiveSegmentationModel):
    """
    MedSAM Interactive Segmentation Model.

    Implements the Segment Anything Model (SAM) adapted for medical imaging.
    Supports interactive prompts including points, boxes, and mask hints.

    The model requires pretrained weights from the MedSAM project:
    https://github.com/bowang-lab/MedSAM

    Configuration:
        - checkpoint_path: Path to MedSAM checkpoint file
        - model_type: SAM model variant ("vit_b", "vit_l", "vit_h")

    Usage:
        model = MedSAMModel(checkpoint_path=Path("models/medsam/medsam_vit_b.pth"))
        await model.load(device="cuda")

        # With point prompts
        result = await model.predict_with_prompts(
            image,
            point_coords=[[100, 200]],
            point_labels=[1],  # 1=foreground, 0=background
        )

        # With box prompt
        result = await model.predict_with_prompts(
            image,
            box=[x1, y1, x2, y2],
        )
    """

    def __init__(
        self,
        checkpoint_path: Path,
        model_type: str = "vit_b",
        target_size: int = 1024,
    ):
        """
        Initialize MedSAM model.

        Args:
            checkpoint_path: Path to MedSAM checkpoint
            model_type: SAM variant ("vit_b", "vit_l", "vit_h")
            target_size: Target image size for SAM encoder
        """
        super().__init__()

        if checkpoint_path.is_dir():
            self.checkpoint_path = checkpoint_path / DEFAULT_CHECKPOINT
        else:
            self.checkpoint_path = checkpoint_path

        self.model_type = model_type
        self.target_size = target_size

        self._model = None
        self._weights_hash: str | None = None
        self._image_embedding = None
        self._original_size = None
        self._input_size = None

    @property
    def metadata(self) -> ModelMetadata:
        """Get model metadata."""
        return ModelMetadata(
            name="medsam",
            version="1.0.0",
            model_type=ModelType.SEGMENTATION,
            description="MedSAM - Medical image segmentation with SAM architecture",
            supported_modalities=["CT", "MR", "DX", "CR", "US", "PT"],
            performance_metrics={"dice": 0.88},
            reference="Ma et al. 2024 - Segment Anything in Medical Images",
            class_names=["background", "foreground"],
        )

    def _compute_weights_hash(self) -> str:
        """Compute SHA256 hash of checkpoint file."""
        if not self.checkpoint_path.exists():
            return "NOT_FOUND"

        sha256 = hashlib.sha256()
        with open(self.checkpoint_path, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                sha256.update(chunk)
        return sha256.hexdigest()[:16]

    async def load(self, device: str = "cuda") -> None:
        """
        Load MedSAM model.

        Args:
            device: Device to load model to

        Raises:
            FileNotFoundError: If checkpoint not found
            ImportError: If segment-anything not installed
        """
        if not self.checkpoint_path.exists():
            error_msg = (
                f"MedSAM checkpoint not found at: {self.checkpoint_path}\n\n"
                f"To use MedSAM interactive segmentation:\n"
                f"1. Download the MedSAM weights from:\n"
                f"   https://github.com/bowang-lab/MedSAM\n"
                f"2. Place the checkpoint at: {self.checkpoint_path}\n\n"
                f"Direct download (if available):\n"
                f"  wget https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth\n"
                f"  # Or download MedSAM fine-tuned weights from the official repo\n\n"
                f"Note: MedSAM weights are ~375MB for vit_b variant.\n"
            )
            logger.error(error_msg)
            raise FileNotFoundError(error_msg)

        try:
            import torch
            from segment_anything import sam_model_registry, SamPredictor
        except ImportError as e:
            error_msg = (
                "segment-anything library not installed.\n"
                "Install with: pip install segment-anything>=1.0\n"
                "Also requires: pip install torch>=2.2.0\n"
                "Or install AI dependencies: pip install -e .[ai]"
            )
            logger.error(error_msg)
            raise ImportError(error_msg) from e

        try:
            self._weights_hash = self._compute_weights_hash()

            logger.info(
                "Loading MedSAM model",
                checkpoint_path=str(self.checkpoint_path),
                weights_hash=self._weights_hash,
                model_type=self.model_type,
                device=device,
            )

            # Check CUDA availability
            if device.startswith("cuda") and not torch.cuda.is_available():
                logger.warning("CUDA requested but not available, using CPU")
                device = "cpu"

            self._device = device

            # Load SAM model
            sam = sam_model_registry[self.model_type](checkpoint=str(self.checkpoint_path))
            sam.to(device)
            sam.eval()

            # Create predictor
            self._model = SamPredictor(sam)
            self._loaded = True

            logger.info(
                "MedSAM model loaded successfully",
                weights_hash=self._weights_hash,
                device=self._device,
                model_type=self.model_type,
            )

        except Exception as e:
            error_msg = f"Failed to load MedSAM model: {e}"
            logger.error(error_msg)
            raise RuntimeError(error_msg) from e

    async def unload(self) -> None:
        """Unload model from memory."""
        if self._model is not None:
            del self._model
            self._model = None

        self._image_embedding = None
        self._original_size = None
        self._input_size = None

        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass

        self._loaded = False
        logger.info("MedSAM model unloaded")

    async def encode_image(self, image: np.ndarray) -> dict[str, Any]:
        """
        Encode image to get embeddings for interactive segmentation.

        This allows multiple prompts to be tried without re-encoding.

        Args:
            image: Input image (H, W) grayscale or (H, W, 3) RGB

        Returns:
            Dictionary with embedding info for use with predict_with_prompts
        """
        if not self._loaded or self._model is None:
            raise RuntimeError(
                "Model not loaded. Call load() first or check checkpoint path."
            )

        # Preprocess image
        processed_image = await self._prepare_image(image)

        start_time = time.perf_counter()

        # Set image in predictor (computes embedding)
        self._model.set_image(processed_image)

        encoding_time_ms = (time.perf_counter() - start_time) * 1000

        self._original_size = image.shape[:2]
        self._input_size = processed_image.shape[:2]

        logger.info(
            "Image encoded for MedSAM",
            original_size=self._original_size,
            input_size=self._input_size,
            encoding_time_ms=round(encoding_time_ms, 2),
        )

        return {
            "original_size": self._original_size,
            "input_size": self._input_size,
            "encoding_time_ms": encoding_time_ms,
            "is_encoded": True,
        }

    async def predict_with_prompts(
        self,
        image: np.ndarray,
        point_coords: list[list[int]] | None = None,
        point_labels: list[int] | None = None,
        box: list[int] | None = None,
        mask_input: np.ndarray | None = None,
        multimask_output: bool = True,
        return_logits: bool = False,
        **kwargs: Any,
    ) -> InferenceResult[SegmentationOutput]:
        """
        Run interactive segmentation with prompts.

        Args:
            image: Input image (H, W) or (H, W, 3)
            point_coords: List of [x, y] point coordinates
            point_labels: Labels for points (1=foreground, 0=background)
            box: Bounding box [x1, y1, x2, y2]
            mask_input: Previous mask for iterative refinement
            multimask_output: Return multiple mask options
            return_logits: Return raw logits instead of binary masks

        Returns:
            InferenceResult with segmentation mask(s)

        Raises:
            RuntimeError: If model not loaded
            ValueError: If no prompts provided
        """
        if not self._loaded or self._model is None:
            raise RuntimeError(
                "Model not loaded. Call load() first or check checkpoint path."
            )

        if point_coords is None and box is None and mask_input is None:
            raise ValueError(
                "At least one prompt type required: point_coords, box, or mask_input"
            )

        import torch

        # Prepare image if not already encoded
        processed_image = await self._prepare_image(image)
        self._model.set_image(processed_image)
        self._original_size = image.shape[:2]

        # Prepare prompts
        np_point_coords = None
        np_point_labels = None
        np_box = None

        if point_coords is not None:
            np_point_coords = np.array(point_coords)
            np_point_labels = np.array(point_labels if point_labels else [1] * len(point_coords))

        if box is not None:
            np_box = np.array(box)

        start_time = time.perf_counter()

        try:
            masks, scores, logits = self._model.predict(
                point_coords=np_point_coords,
                point_labels=np_point_labels,
                box=np_box,
                mask_input=mask_input,
                multimask_output=multimask_output,
                return_logits=return_logits,
            )
        except Exception as e:
            logger.error(f"MedSAM prediction failed: {e}")
            raise RuntimeError(f"Interactive segmentation failed: {e}") from e

        inference_time_ms = (time.perf_counter() - start_time) * 1000

        # Select best mask (highest score)
        best_idx = np.argmax(scores)
        best_mask = masks[best_idx].astype(np.uint8)
        best_score = float(scores[best_idx])

        # Create output
        output = SegmentationOutput(
            mask=best_mask,
            class_names=["background", "foreground"],
            dice_scores={"foreground": best_score},
            volumes={"foreground": float(np.sum(best_mask))},
            probabilities=logits[best_idx] if return_logits else None,
        )

        logger.info(
            "MedSAM interactive segmentation completed",
            best_score=round(best_score, 3),
            num_masks=len(masks),
            inference_time_ms=round(inference_time_ms, 2),
            mask_pixels=int(np.sum(best_mask)),
        )

        return InferenceResult(
            model_name=self.metadata.name,
            model_version=self.metadata.version,
            inference_time_ms=inference_time_ms,
            output=output,
            confidence=best_score,
            metadata={
                "weights_hash": self._weights_hash,
                "device": self._device,
                "original_size": list(self._original_size),
                "all_scores": scores.tolist(),
                "prompts": {
                    "point_coords": point_coords,
                    "point_labels": point_labels,
                    "box": box,
                    "has_mask_input": mask_input is not None,
                },
            },
        )

    async def predict(
        self,
        image: np.ndarray,
        **kwargs: Any,
    ) -> InferenceResult[SegmentationOutput]:
        """
        Run automatic segmentation (full image).

        For interactive use, prefer predict_with_prompts().
        This method uses center point as automatic prompt.

        Args:
            image: Input image

        Returns:
            InferenceResult with segmentation
        """
        h, w = image.shape[:2]
        center_point = [[w // 2, h // 2]]

        return await self.predict_with_prompts(
            image,
            point_coords=center_point,
            point_labels=[1],
            **kwargs,
        )

    async def _prepare_image(self, image: np.ndarray) -> np.ndarray:
        """
        Prepare image for SAM model.

        Args:
            image: Input image (H, W) or (H, W, 3)

        Returns:
            Preprocessed RGB image
        """
        # Convert grayscale to RGB
        if image.ndim == 2:
            image = np.stack([image] * 3, axis=-1)
        elif image.ndim == 3 and image.shape[2] == 1:
            image = np.concatenate([image] * 3, axis=-1)

        # Normalize to 0-255 uint8
        if image.dtype == np.float32 or image.dtype == np.float64:
            if image.max() <= 1.0:
                image = (image * 255).astype(np.uint8)
            else:
                # Percentile normalization for medical images
                p_low, p_high = np.percentile(image, [0.5, 99.5])
                image = np.clip(image, p_low, p_high)
                image = ((image - p_low) / (p_high - p_low + 1e-8) * 255).astype(np.uint8)
        elif image.dtype != np.uint8:
            image = image.astype(np.uint8)

        return image

    async def preprocess(self, image: np.ndarray) -> np.ndarray:
        """Preprocess for base class compatibility."""
        return await self._prepare_image(image)

    async def postprocess(self, result: Any) -> SegmentationOutput:
        """Postprocess for base class compatibility."""
        # Not used directly - postprocessing done in predict_with_prompts
        pass

    def validate_input(self, image: np.ndarray) -> None:
        """Validate input image."""
        super().validate_input(image)

        if image.ndim not in [2, 3]:
            raise ValueError(
                f"Expected 2D (H,W) or 3D (H,W,C) image, got shape {image.shape}"
            )
