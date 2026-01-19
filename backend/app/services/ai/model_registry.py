"""
AI Model Registry for Horalix View.

Manages registration, loading, and lifecycle of AI models.
Provides a centralized interface for model discovery and inference.
"""

import asyncio
from pathlib import Path
from typing import Any, Type

from app.core.config import AIModelSettings
from app.core.logging import get_logger
from app.services.ai.base import BaseAIModel, ModelMetadata, ModelType

logger = get_logger(__name__)


class ModelRegistry:
    """
    Central registry for AI models.

    Manages model lifecycle including:
    - Registration of model classes
    - Loading/unloading models on demand
    - Memory management
    - Model discovery and querying
    """

    def __init__(self, settings: AIModelSettings):
        """
        Initialize model registry.

        Args:
            settings: AI model configuration settings
        """
        self.settings = settings
        self.models_dir = Path(settings.models_dir)
        self.cache_dir = Path(settings.cache_dir)

        self._registered_models: dict[str, Type[BaseAIModel]] = {}
        self._loaded_models: dict[str, BaseAIModel] = {}
        self._model_metadata: dict[str, ModelMetadata] = {}
        self._ready = False

    async def initialize(self) -> None:
        """Initialize the model registry."""
        # Create directories
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        # Register built-in models
        await self._register_builtin_models()

        self._ready = True
        logger.info(
            "Model registry initialized",
            models_dir=str(self.models_dir),
            registered_models=len(self._registered_models),
        )

    def is_ready(self) -> bool:
        """Check if registry is ready."""
        return self._ready

    async def shutdown(self) -> None:
        """Shutdown registry and unload all models."""
        # Unload all loaded models
        for model_name in list(self._loaded_models.keys()):
            await self.unload_model(model_name)

        self._ready = False
        logger.info("Model registry shutdown complete")

    def register_model(
        self,
        model_name: str,
        model_class: Type[BaseAIModel],
        metadata: ModelMetadata,
    ) -> None:
        """
        Register a model class.

        Args:
            model_name: Unique identifier for the model
            model_class: Model class (must inherit from BaseAIModel)
            metadata: Model metadata
        """
        if model_name in self._registered_models:
            logger.warning(f"Overwriting registered model: {model_name}")

        self._registered_models[model_name] = model_class
        self._model_metadata[model_name] = metadata

        logger.info(
            "Registered model",
            model_name=model_name,
            model_type=metadata.model_type.value,
        )

    def unregister_model(self, model_name: str) -> bool:
        """
        Unregister a model.

        Args:
            model_name: Model identifier

        Returns:
            True if unregistered, False if not found
        """
        if model_name in self._registered_models:
            # Unload if loaded
            if model_name in self._loaded_models:
                asyncio.create_task(self.unload_model(model_name))

            del self._registered_models[model_name]
            del self._model_metadata[model_name]
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
        return [
            meta for meta in self._model_metadata.values()
            if meta.model_type == model_type
        ]

    def get_models_for_modality(self, modality: str) -> list[ModelMetadata]:
        """Get all models supporting a specific modality."""
        return [
            meta for meta in self._model_metadata.values()
            if modality in meta.supported_modalities
        ]

    async def load_model(
        self,
        model_name: str,
        device: str | None = None,
    ) -> BaseAIModel:
        """
        Load a model into memory.

        Args:
            model_name: Model identifier
            device: Device to load to (defaults to settings.device)

        Returns:
            Loaded model instance

        Raises:
            KeyError: If model not registered
        """
        if model_name in self._loaded_models:
            return self._loaded_models[model_name]

        if model_name not in self._registered_models:
            raise KeyError(f"Model not registered: {model_name}")

        model_class = self._registered_models[model_name]
        device = device or self.settings.device

        try:
            # Instantiate model
            weights_path = self.models_dir / model_name
            model = model_class(weights_path=weights_path)

            # Load weights
            await model.load(device=device)

            self._loaded_models[model_name] = model

            logger.info(
                "Loaded model",
                model_name=model_name,
                device=device,
            )

            return model

        except Exception as e:
            logger.error(f"Failed to load model {model_name}", error=str(e))
            raise

    async def unload_model(self, model_name: str) -> bool:
        """
        Unload a model from memory.

        Args:
            model_name: Model identifier

        Returns:
            True if unloaded, False if not loaded
        """
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
        """
        Run inference with a model.

        Args:
            model_name: Model identifier
            image: Input image
            auto_load: Automatically load model if not loaded
            **kwargs: Additional model parameters

        Returns:
            Inference result
        """
        model = self._loaded_models.get(model_name)

        if model is None:
            if auto_load:
                model = await self.load_model(model_name)
            else:
                raise RuntimeError(f"Model not loaded: {model_name}")

        return await model.predict(image, **kwargs)

    async def _register_builtin_models(self) -> None:
        """Register built-in model stubs."""
        # These are placeholder registrations - actual implementations
        # would be loaded from the models directory

        builtin_models = [
            ModelMetadata(
                name="nnunet",
                version="2.3.0",
                model_type=ModelType.SEGMENTATION,
                description="nnU-Net: Self-configuring deep learning for medical image segmentation",
                supported_modalities=["CT", "MR", "PT"],
                performance_metrics={"dice": 0.92, "hd95": 3.2},
                reference="Isensee et al., Nature Methods 2021",
            ),
            ModelMetadata(
                name="medunet",
                version="1.0.0",
                model_type=ModelType.SEGMENTATION,
                description="MedUNeXt: Next-generation U-Net with ConvNeXt blocks",
                supported_modalities=["CT", "MR"],
                performance_metrics={"dice": 0.93, "hd95": 2.8},
                reference="Roy et al., 2023",
            ),
            ModelMetadata(
                name="medsam",
                version="1.0.0",
                model_type=ModelType.SEGMENTATION,
                description="MedSAM: Universal medical image segmentation foundation model",
                supported_modalities=["CT", "MR", "US", "XA", "DX", "MG", "PT", "NM", "SM"],
                performance_metrics={"dice": 0.89},
                reference="Ma et al., Nature Communications 2024",
            ),
            ModelMetadata(
                name="swinunet",
                version="1.0.0",
                model_type=ModelType.SEGMENTATION,
                description="SwinUNet: Transformer-based U-Net with Swin Transformer blocks",
                supported_modalities=["CT", "MR"],
                performance_metrics={"dice": 0.91},
                reference="Cao et al., ECCV 2022",
            ),
            ModelMetadata(
                name="yolov8",
                version="8.1.0",
                model_type=ModelType.DETECTION,
                description="YOLOv8: Real-time object detection for medical imaging",
                supported_modalities=["DX", "CR", "CT", "MR", "US"],
                performance_metrics={"mAP": 0.85, "fps": 45},
                reference="Ultralytics 2023",
            ),
            ModelMetadata(
                name="vit_classifier",
                version="1.0.0",
                model_type=ModelType.CLASSIFICATION,
                description="Vision Transformer for medical image classification",
                supported_modalities=["DX", "CR", "CT", "MR", "SM"],
                performance_metrics={"auroc": 0.94, "accuracy": 0.91},
                reference="Dosovitskiy et al., ICLR 2021",
            ),
            ModelMetadata(
                name="unimie",
                version="1.0.0",
                model_type=ModelType.ENHANCEMENT,
                description="UniMIE: Training-free diffusion model for universal medical image enhancement",
                supported_modalities=["CT", "MR", "DX", "CR", "US", "XA", "MG", "PT", "NM"],
                performance_metrics={"psnr": 32.5, "ssim": 0.95},
                reference="UniMIE 2024",
            ),
            ModelMetadata(
                name="gigapath",
                version="1.0.0",
                model_type=ModelType.PATHOLOGY,
                description="Prov-GigaPath: Whole-slide foundation model for pathology",
                supported_modalities=["SM"],
                performance_metrics={"slide_classification_auroc": 0.94},
                reference="Microsoft Research 2024",
            ),
            ModelMetadata(
                name="cardiac_3d",
                version="1.0.0",
                model_type=ModelType.CARDIAC,
                description="3D cardiac segmentation network for chamber quantification",
                supported_modalities=["CT", "MR", "US"],
                performance_metrics={"lv_dice": 0.93, "rv_dice": 0.89},
                reference="Cardiac Networks 2024",
            ),
        ]

        # Create placeholder model class
        class PlaceholderModel(BaseAIModel):
            def __init__(self, weights_path: Path, meta: ModelMetadata):
                super().__init__()
                self._metadata = meta
                self.weights_path = weights_path

            @property
            def metadata(self) -> ModelMetadata:
                return self._metadata

            async def load(self, device: str = "cuda") -> None:
                self._device = device
                self._loaded = True
                logger.info(f"Placeholder load for {self._metadata.name}")

            async def unload(self) -> None:
                self._loaded = False

            async def predict(self, image: Any, **kwargs: Any) -> Any:
                raise NotImplementedError(
                    f"Model {self._metadata.name} requires actual implementation"
                )

        # Register all models
        for meta in builtin_models:
            # Create a factory that captures the metadata
            def make_model_class(m: ModelMetadata) -> Type[BaseAIModel]:
                class SpecificPlaceholder(PlaceholderModel):
                    def __init__(self, weights_path: Path):
                        super().__init__(weights_path, m)
                return SpecificPlaceholder

            self.register_model(
                model_name=meta.name,
                model_class=make_model_class(meta),
                metadata=meta,
            )
