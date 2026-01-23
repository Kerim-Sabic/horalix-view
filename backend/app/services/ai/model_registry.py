"""AI Model Registry for Horalix View.

Manages registration, loading, and lifecycle of AI models.
Provides real inference - NO PLACEHOLDERS OR SIMULATED OUTPUTS.
"""

import asyncio
from collections.abc import Callable
from pathlib import Path
from typing import Any

from app.core.config import AIModelSettings
from app.core.logging import get_logger
from app.services.ai.base import BaseAIModel, ModelMetadata, ModelType

logger = get_logger(__name__)


class ModelNotAvailableError(Exception):
    """Raised when a model's weights are not available."""

    def __init__(self, model_name: str, weights_path: Path, instructions: str):
        self.model_name = model_name
        self.weights_path = weights_path
        self.instructions = instructions
        super().__init__(
            f"Model '{model_name}' not available. Weights not found at: {weights_path}\n\n"
            f"{instructions}"
        )


class ModelRegistry:
    """Central registry for AI models.

    Manages model lifecycle including:
    - Registration of model classes
    - Loading/unloading models on demand
    - Memory management
    - Model discovery and querying

    IMPORTANT: This registry only supports REAL model implementations.
    No placeholder or simulated outputs are allowed.
    """

    def __init__(self, settings: AIModelSettings):
        """Initialize model registry.

        Args:
            settings: AI model configuration settings

        """
        self.settings = settings
        self.models_dir = Path(settings.models_dir)
        self.cache_dir = Path(settings.cache_dir)

        # Model factory functions: name -> callable that creates model instance
        self._model_factories: dict[str, Callable[[], BaseAIModel]] = {}
        self._loaded_models: dict[str, BaseAIModel] = {}
        self._model_metadata: dict[str, ModelMetadata] = {}
        self._model_enabled: dict[str, bool] = {}
        self._ready = False

    async def initialize(self) -> None:
        """Initialize the model registry."""
        # Create directories
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        # Register real model implementations
        await self._register_real_models()

        self._ready = True
        logger.info(
            "Model registry initialized",
            models_dir=str(self.models_dir),
            registered_models=len(self._model_factories),
            available_models=self._get_available_model_names(),
        )

    def _get_available_model_names(self) -> list[str]:
        """Get names of models that have weights available."""
        available = []
        for name in self._model_factories.keys():
            weights_path = self._get_weights_path(name)
            if self._weights_exist(weights_path):
                available.append(name)
        return available

    def _get_weights_path(self, model_name: str) -> Path:
        """Get the expected weights path for a model."""
        return self.models_dir / model_name

    def _weights_exist(self, weights_path: Path) -> bool:
        """Check if weights exist at path (file or directory with weights)."""
        if weights_path.is_file():
            return True
        if weights_path.is_dir():
            # Check for common weight files
            for pattern in [
                "*.pt",
                "*.pth",
                "*.ckpt",
                "*.bin",
                "*.onnx",
                "*.h5",
                "*.tar",
                "*.tar.gz",
                "*.zip",
                "model.*",
            ]:
                if list(weights_path.rglob(pattern)):
                    return True
        return False

    def is_ready(self) -> bool:
        """Check if registry is ready."""
        return self._ready

    async def shutdown(self) -> None:
        """Shutdown registry and unload all models."""
        for model_name in list(self._loaded_models.keys()):
            await self.unload_model(model_name)

        self._ready = False
        logger.info("Model registry shutdown complete")

    def register_model(
        self,
        model_name: str,
        factory: Callable[[], BaseAIModel],
        metadata: ModelMetadata,
        enabled: bool = True,
    ) -> None:
        """Register a model factory.

        Args:
            model_name: Unique identifier for the model
            factory: Factory function that creates model instance
            metadata: Model metadata
            enabled: Whether this model is enabled

        """
        if model_name in self._model_factories:
            logger.warning(f"Overwriting registered model: {model_name}")

        self._model_factories[model_name] = factory
        self._model_metadata[model_name] = metadata
        self._model_enabled[model_name] = enabled

        logger.debug(
            "Registered model",
            model_name=model_name,
            model_type=metadata.model_type.value,
            enabled=enabled,
        )

    def unregister_model(self, model_name: str) -> bool:
        """Unregister a model."""
        if model_name in self._model_factories:
            if model_name in self._loaded_models:
                asyncio.create_task(self.unload_model(model_name))

            del self._model_factories[model_name]
            del self._model_metadata[model_name]
            del self._model_enabled[model_name]
            return True
        return False

    def get_registered_models(self) -> list[ModelMetadata]:
        """Get metadata for all registered models."""
        return list(self._model_metadata.values())

    def get_model_metadata(self, model_name: str) -> ModelMetadata | None:
        """Get metadata for a specific model."""
        return self._model_metadata.get(model_name)

    def get_models_by_type(self, model_type: ModelType) -> list[ModelMetadata]:
        """Get all models of a specific type."""
        return [meta for meta in self._model_metadata.values() if meta.model_type == model_type]

    def get_models_for_modality(self, modality: str) -> list[ModelMetadata]:
        """Get all models supporting a specific modality."""
        return [
            meta for meta in self._model_metadata.values() if modality in meta.supported_modalities
        ]

    def is_model_available(self, model_name: str) -> bool:
        """Check if a model has weights available for inference."""
        if model_name not in self._model_factories:
            return False
        availability = self.get_model_availability().get(model_name, {})
        if not availability.get("enabled", False):
            return False
        return bool(availability.get("weights_available", False))

    def get_model_availability(self) -> dict[str, dict[str, Any]]:
        """Get availability status for all registered models."""
        result = {}
        for name, metadata in self._model_metadata.items():
            weights_path = self._get_weights_path(name)
            weights_available = self._weights_exist(weights_path)
            availability_errors: list[str] = []

            factory = self._model_factories.get(name)
            if factory is not None:
                try:
                    model = factory()
                    if hasattr(model, "check_availability"):
                        weights_available, availability_errors = model.check_availability()
                except Exception as exc:
                    weights_available = False
                    availability_errors = [f"Availability check failed: {exc}"]

            result[name] = {
                "registered": True,
                "enabled": self._model_enabled.get(name, False),
                "weights_available": weights_available,
                "weights_path": str(weights_path),
                "loaded": name in self._loaded_models,
                "model_type": metadata.model_type.value,
                "availability_errors": availability_errors,
            }
        return result

    async def load_model(
        self,
        model_name: str,
        device: str | None = None,
    ) -> BaseAIModel:
        """Load a model into memory.

        Args:
            model_name: Model identifier
            device: Device to load to (defaults to settings.device)

        Returns:
            Loaded model instance

        Raises:
            KeyError: If model not registered
            ModelNotAvailableError: If weights not found
            RuntimeError: If loading fails

        """
        if model_name in self._loaded_models:
            return self._loaded_models[model_name]

        if model_name not in self._model_factories:
            raise KeyError(f"Model not registered: {model_name}")

        if not self._model_enabled.get(model_name, False):
            raise RuntimeError(f"Model '{model_name}' is disabled. Enable it in settings.")

        weights_path = self._get_weights_path(model_name)
        device = device or self.settings.device

        # Create model instance using factory
        factory = self._model_factories[model_name]

        try:
            model = factory()
        except Exception as e:
            logger.error(f"Failed to create model instance: {model_name}", error=str(e))
            raise RuntimeError(f"Failed to create model: {e}") from e

        try:
            # Load weights - this will raise FileNotFoundError if weights missing
            await model.load(device=device)

            self._loaded_models[model_name] = model

            logger.info(
                "Loaded model successfully",
                model_name=model_name,
                device=device,
            )

            return model

        except FileNotFoundError:
            # Re-raise with helpful instructions
            logger.error(
                f"Model weights not found: {model_name}",
                weights_path=str(weights_path),
            )
            raise
        except ImportError as e:
            logger.error(
                f"Missing dependency for model: {model_name}",
                error=str(e),
            )
            raise
        except Exception as e:
            logger.error(f"Failed to load model: {model_name}", error=str(e))
            raise RuntimeError(f"Failed to load model: {e}") from e

    async def unload_model(self, model_name: str) -> bool:
        """Unload a model from memory."""
        if model_name not in self._loaded_models:
            return False

        model = self._loaded_models[model_name]

        try:
            await model.unload()
            del self._loaded_models[model_name]
            logger.info("Unloaded model", model_name=model_name)
            return True
        except Exception as e:
            logger.error(f"Error unloading model {model_name}", error=str(e))
            return False

    def get_loaded_model(self, model_name: str) -> BaseAIModel | None:
        """Get a loaded model instance."""
        return self._loaded_models.get(model_name)

    def is_model_loaded(self, model_name: str) -> bool:
        """Check if a model is loaded."""
        return model_name in self._loaded_models

    def get_loaded_models(self) -> list[str]:
        """Get names of all loaded models."""
        return list(self._loaded_models.keys())

    async def run_inference(
        self,
        model_name: str,
        image: Any,
        auto_load: bool = True,
        **kwargs: Any,
    ) -> Any:
        """Run inference with a model.

        Args:
            model_name: Model identifier
            image: Input image
            auto_load: Automatically load model if not loaded
            **kwargs: Additional model parameters

        Returns:
            Inference result (real inference, never simulated)

        Raises:
            RuntimeError: If model not available
            FileNotFoundError: If weights not found

        """
        model = self._loaded_models.get(model_name)

        if model is None:
            if auto_load:
                model = await self.load_model(model_name)
            else:
                raise RuntimeError(f"Model not loaded: {model_name}")

        return await model.predict(image, **kwargs)

    async def run_interactive_segmentation(
        self,
        model_name: str,
        image: Any,
        point_coords: list[list[int]] | None = None,
        point_labels: list[int] | None = None,
        box: list[int] | None = None,
        mask_input: Any = None,
        auto_load: bool = True,
        **kwargs: Any,
    ) -> Any:
        """Run interactive segmentation with prompts.

        Args:
            model_name: Model identifier (must be interactive segmentation model)
            image: Input image
            point_coords: Point prompts [[x, y], ...]
            point_labels: Point labels (1=foreground, 0=background)
            box: Box prompt [x1, y1, x2, y2]
            mask_input: Previous mask for refinement
            auto_load: Automatically load model if not loaded

        Returns:
            Segmentation result with mask

        """
        from app.services.ai.base import InteractiveSegmentationModel

        model = self._loaded_models.get(model_name)

        if model is None:
            if auto_load:
                model = await self.load_model(model_name)
            else:
                raise RuntimeError(f"Model not loaded: {model_name}")

        if not isinstance(model, InteractiveSegmentationModel):
            raise TypeError(
                f"Model '{model_name}' does not support interactive segmentation. "
                f"Use a model like 'medsam' instead."
            )

        return await model.predict_with_prompts(
            image,
            point_coords=point_coords,
            point_labels=point_labels,
            box=box,
            mask_input=mask_input,
            **kwargs,
        )

    async def _register_real_models(self) -> None:
        """Register real model implementations."""
        from app.services.ai.models import (
            ExternalCommandModel,
            MedSAMModel,
            MonaiSegmentationModel,
            YoloV8Detector,
        )

        # YOLOv8 Detection
        self.register_model(
            model_name="yolov8",
            factory=lambda: YoloV8Detector(
                weights_path=self.models_dir / "yolov8",
                confidence_threshold=0.25,
                iou_threshold=0.45,
            ),
            metadata=ModelMetadata(
                name="yolov8",
                version="8.1.0",
                model_type=ModelType.DETECTION,
                description="YOLOv8: Real-time object detection for medical imaging",
                supported_modalities=["DX", "CR", "CT", "MR", "US"],
                performance_metrics={"mAP": 0.85, "fps": 45},
                reference="Ultralytics 2023",
            ),
            enabled=self.settings.yolov8_enabled,
        )

        # MONAI Segmentation (general purpose)
        self.register_model(
            model_name="monai_segmentation",
            factory=lambda: MonaiSegmentationModel(
                model_path=self.models_dir / "monai_segmentation",
                class_names=["background", "organ"],  # Override based on actual model
                spatial_size=(96, 96, 96),
            ),
            metadata=ModelMetadata(
                name="monai_segmentation",
                version="1.3.0",
                model_type=ModelType.SEGMENTATION,
                description="MONAI-based volumetric medical image segmentation",
                supported_modalities=["CT", "MR", "PT"],
                performance_metrics={"dice": 0.85},
                reference="MONAI Consortium 2024",
            ),
            enabled=self.settings.nnunet_enabled,  # Use nnunet flag for now
        )

        # MedSAM Interactive Segmentation
        self.register_model(
            model_name="medsam",
            factory=lambda: MedSAMModel(
                checkpoint_path=self.models_dir / "medsam",
                model_type="vit_b",
            ),
            metadata=ModelMetadata(
                name="medsam",
                version="1.0.0",
                model_type=ModelType.SEGMENTATION,
                description="MedSAM: Interactive medical image segmentation with SAM",
                supported_modalities=["CT", "MR", "US", "XA", "DX", "MG", "PT", "NM", "SM"],
                performance_metrics={"dice": 0.89},
                reference="Ma et al., Nature Communications 2024",
            ),
            enabled=self.settings.medsam_enabled,
        )

        # Register additional model stubs that clearly fail when not available
        # These use the same real model classes but with different configs

        # Liver segmentation (MONAI-based)
        self.register_model(
            model_name="liver_segmentation",
            factory=lambda: MonaiSegmentationModel(
                model_path=self.models_dir / "liver_segmentation",
                class_names=["background", "liver", "tumor"],
                spatial_size=(128, 128, 128),
            ),
            metadata=ModelMetadata(
                name="liver_segmentation",
                version="1.0.0",
                model_type=ModelType.SEGMENTATION,
                description="MONAI liver and tumor segmentation",
                supported_modalities=["CT"],
                performance_metrics={"dice": 0.92},
                reference="MONAI Model Zoo",
                class_names=["background", "liver", "tumor"],
            ),
            enabled=self.settings.nnunet_enabled,
        )

        # Spleen segmentation (MONAI bundle)
        self.register_model(
            model_name="spleen_segmentation",
            factory=lambda: MonaiSegmentationModel(
                model_path=self.models_dir / "spleen_segmentation",
                class_names=["background", "spleen"],
                spatial_size=(96, 96, 96),
            ),
            metadata=ModelMetadata(
                name="spleen_segmentation",
                version="1.0.0",
                model_type=ModelType.SEGMENTATION,
                description="MONAI spleen CT segmentation bundle",
                supported_modalities=["CT"],
                performance_metrics={"dice": 0.96},
                reference="MONAI Model Zoo - spleen_ct_segmentation",
                class_names=["background", "spleen"],
            ),
            enabled=self.settings.nnunet_enabled,
        )

        echonet_metadata = ModelMetadata(
            name="echonet_measurements",
            version="1.0.0",
            model_type=ModelType.CARDIAC,
            description="EchoNet measurements for echocardiography cine analysis",
            supported_modalities=["US"],
            reference="https://github.com/echonet/measurements",
            license="Unknown",
        )
        self.register_model(
            model_name="echonet_measurements",
            factory=lambda: ExternalCommandModel(
                metadata=echonet_metadata,
                command_template=self.settings.echonet_measurements_command,
                weights_path=self.models_dir / "echonet_measurements",
                results_dir=Path(self.settings.results_dir),
                work_dir=self.settings.external_workdir
                or (self.models_dir / "echonet_measurements"),
                timeout_seconds=self.settings.external_timeout_seconds,
                input_kind="cine",
                export_frames=True,
            ),
            metadata=echonet_metadata,
            enabled=self.settings.echonet_measurements_enabled,
        )

        gigapath_metadata = ModelMetadata(
            name="prov_gigapath",
            version="1.0.0",
            model_type=ModelType.PATHOLOGY,
            description="Prov-GigaPath foundation model for digital pathology",
            supported_modalities=["SM"],
            reference="https://github.com/prov-gigapath/prov-gigapath",
            license="Apache-2.0",
        )
        self.register_model(
            model_name="prov_gigapath",
            factory=lambda: ExternalCommandModel(
                metadata=gigapath_metadata,
                command_template=self.settings.gigapath_command,
                weights_path=self.models_dir / "prov_gigapath",
                results_dir=Path(self.settings.results_dir),
                work_dir=self.settings.external_workdir or (self.models_dir / "prov_gigapath"),
                timeout_seconds=self.settings.external_timeout_seconds,
                input_kind="image",
                export_frames=False,
            ),
            metadata=gigapath_metadata,
            enabled=self.settings.gigapath_enabled,
        )

        hovernet_metadata = ModelMetadata(
            name="hovernet",
            version="0.2.0",
            model_type=ModelType.PATHOLOGY,
            description="HoVer-Net nuclei segmentation for pathology tiles",
            supported_modalities=["SM"],
            reference="https://github.com/vqdang/hover_net",
            license="MIT",
        )
        self.register_model(
            model_name="hovernet",
            factory=lambda: ExternalCommandModel(
                metadata=hovernet_metadata,
                command_template=self.settings.hovernet_command,
                weights_path=self.models_dir / "hovernet",
                results_dir=Path(self.settings.results_dir),
                work_dir=self.settings.external_workdir or (self.models_dir / "hovernet"),
                timeout_seconds=self.settings.external_timeout_seconds,
                input_kind="image",
                export_frames=False,
            ),
            metadata=hovernet_metadata,
            enabled=self.settings.hovernet_enabled,
        )

        logger.info(
            "Registered real model implementations",
            total_models=len(self._model_factories),
            detection_models=len(self.get_models_by_type(ModelType.DETECTION)),
            segmentation_models=len(self.get_models_by_type(ModelType.SEGMENTATION)),
        )
