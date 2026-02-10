"""
Coordinate space transformation.

Bidirectional transforms between model space and DICOM space.

Example:
- Measurements model outputs keypoints at 640x480 resolution
- Original DICOM is 800x600
- Transform: keypoints x (800/640, 600/480) -> DICOM space
"""

import numpy as np
from ..schema import TransformMetadata


class CoordinateTransformer:
    """
    Bidirectional coordinate transformer between model and DICOM space.

    Handles scaling of points, contours, and masks between different resolutions.
    """

    def __init__(self, transform_meta: TransformMetadata):
        """
        Initialize transformer with metadata.

        Args:
            transform_meta: Transform metadata with resolution ratios
        """
        self.transform_meta = transform_meta

    def model_to_dicom(self, points: np.ndarray) -> np.ndarray:
        """
        Transform points from model space to DICOM space.

        Args:
            points: Points in model space
                    Shape: (N, 2) or (N, M, 2) where last dim is (x, y)

        Returns:
            Points in DICOM space (same shape)

        Example:
            >>> transformer = CoordinateTransformer(transform_meta)
            >>> model_points = np.array([[320, 240], [480, 360]])  # 640x480 space
            >>> dicom_points = transformer.model_to_dicom(model_points)
            >>> dicom_points
            array([[400, 300], [600, 450]])  # 800x600 space
        """
        points_dicom = points.copy().astype(np.float32)

        # Scale X coordinates
        points_dicom[..., 0] *= self.transform_meta.ratio_w

        # Scale Y coordinates
        points_dicom[..., 1] *= self.transform_meta.ratio_h

        return points_dicom

    def dicom_to_model(self, points: np.ndarray) -> np.ndarray:
        """
        Transform points from DICOM space to model space.

        Args:
            points: Points in DICOM space
                    Shape: (N, 2) or (N, M, 2)

        Returns:
            Points in model space (same shape)
        """
        points_model = points.copy().astype(np.float32)

        # Scale X coordinates
        points_model[..., 0] /= self.transform_meta.ratio_w

        # Scale Y coordinates
        points_model[..., 1] /= self.transform_meta.ratio_h

        return points_model

    def scale_mask_to_dicom(self, mask: np.ndarray) -> np.ndarray:
        """
        Upscale mask from model resolution to DICOM resolution.

        Args:
            mask: Binary mask in model space (H_model, W_model)

        Returns:
            Upscaled mask in DICOM space (H_orig, W_orig)
        """
        import cv2

        target_size = (self.transform_meta.orig_w, self.transform_meta.orig_h)

        # Use NEAREST interpolation for binary masks to preserve discrete values
        upscaled = cv2.resize(
            mask.astype(np.uint8),
            target_size,
            interpolation=cv2.INTER_NEAREST,
        )

        return upscaled

    def get_scale_factors(self) -> tuple[float, float]:
        """
        Get scale factors (ratio_w, ratio_h) for manual scaling.

        Returns:
            Tuple of (scale_x, scale_y)
        """
        return (self.transform_meta.ratio_w, self.transform_meta.ratio_h)


def create_identity_transformer(height: int, width: int) -> CoordinateTransformer:
    """
    Create identity transformer (no scaling).

    Useful when model resolution matches DICOM resolution.

    Args:
        height: Image height
        width: Image width

    Returns:
        CoordinateTransformer with 1:1 scaling
    """
    transform_meta = TransformMetadata(
        orig_h=height,
        orig_w=width,
        model_h=height,
        model_w=width,
        ratio_h=1.0,
        ratio_w=1.0,
    )

    return CoordinateTransformer(transform_meta)
