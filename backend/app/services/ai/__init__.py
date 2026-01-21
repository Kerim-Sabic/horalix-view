"""AI services module for Horalix View."""

from app.services.ai.base import BaseAIModel, InferenceResult
from app.services.ai.model_registry import ModelRegistry

__all__ = ["ModelRegistry", "BaseAIModel", "InferenceResult"]
