"""
Postprocessing modules for horalix_ai composite model.

These modules convert model outputs to overlay-friendly formats:
- Keypoint extraction from segmentation logits (measurements models)
- Coordinate transformation (model space → DICOM space)
- Measurement conversion (pixel → cm using DICOM metadata)
- Contour extraction from binary masks (EchoNet)
"""

from .keypoint_extractor import extract_keypoints_from_logits
from .coordinate_transformer import CoordinateTransformer
from .measurement_converter import compute_length_cm, compute_area_cm2, compute_distance_statistics
from .contour_extractor import extract_contours_from_mask, smooth_contour, postprocess_segmentation_mask
from .simpson import (
    SIMPSON_DISK_COUNT,
    LongAxis,
    SimpsonResult,
    ejection_fraction,
    estimate_long_axis,
    simpson_biplane,
    simpson_single_plane,
)

__all__ = [
    "extract_keypoints_from_logits",
    "CoordinateTransformer",
    "compute_length_cm",
    "compute_area_cm2",
    "compute_distance_statistics",
    "extract_contours_from_mask",
    "smooth_contour",
    "postprocess_segmentation_mask",
    "SIMPSON_DISK_COUNT",
    "LongAxis",
    "SimpsonResult",
    "ejection_fraction",
    "estimate_long_axis",
    "simpson_biplane",
    "simpson_single_plane",
]
