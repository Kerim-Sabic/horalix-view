"""
Model loaders for horalix_ai composite model components.

Each loader module handles weight loading and model initialization for one of the
four main model types: PanEcho, EchoPrime, Measurements, and EchoNet-Dynamic.
"""

from .panecho_loader import load_panecho_model, get_panecho_task_metadata
from .echoprime_loader import (
    load_echoprime_models,
    get_echoprime_view_classes,
    get_echoprime_anatomical_sections,
    load_echoprime_candidate_embeddings,
)
from .measurements_loader import (
    load_measurement_model,
    load_all_measurement_models,
    get_measurement_model_info,
    MEASUREMENT_MODEL_NAMES,
)
from .echonet_loader import (
    load_echonet_model,
    get_echonet_metadata,
    validate_echonet_output,
)

__all__ = [
    # PanEcho
    "load_panecho_model",
    "get_panecho_task_metadata",
    # EchoPrime
    "load_echoprime_models",
    "get_echoprime_view_classes",
    "get_echoprime_anatomical_sections",
    "load_echoprime_candidate_embeddings",
    # Measurements
    "load_measurement_model",
    "load_all_measurement_models",
    "get_measurement_model_info",
    "MEASUREMENT_MODEL_NAMES",
    # EchoNet
    "load_echonet_model",
    "get_echonet_metadata",
    "validate_echonet_output",
]
