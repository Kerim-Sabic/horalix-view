"""
Utility modules for horalix_ai composite model.

Helper functions for:
- DICOM metadata extraction
- View-based measurement gating (with confidence thresholds)
- Measurement validation (clinical normal ranges)
- Structured logging
"""

from .dicom_metadata import extract_dicom_metadata, get_pixel_spacing
from .view_gating import (
    get_compatible_measurements,
    is_measurement_compatible,
    normalize_view_label,
    VIEW_CONFIDENCE_THRESHOLD,
    ECHOPRIME_VIEW_CLASSES,
)
from .measurement_validation import (
    validate_measurement,
    validate_measurement_batch,
)
from .logging_utils import get_logger, log_inference_metrics, Timer

__all__ = [
    "extract_dicom_metadata",
    "get_pixel_spacing",
    "get_compatible_measurements",
    "is_measurement_compatible",
    "normalize_view_label",
    "VIEW_CONFIDENCE_THRESHOLD",
    "ECHOPRIME_VIEW_CLASSES",
    "validate_measurement",
    "validate_measurement_batch",
    "get_logger",
    "log_inference_metrics",
    "Timer",
]
