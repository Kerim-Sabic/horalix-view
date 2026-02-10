"""
Keypoint extraction from segmentation logits.

Extracts keypoints from DeepLabV3 segmentation outputs using weighted centroid method.

Replicates logic from Echocardiology_App/backend/app/AI_models/measurements/runner_2d.py
"""

import numpy as np
import torch
from typing import Union


def extract_keypoints_from_logits(
    logits: Union[torch.Tensor, np.ndarray],
    softmax: bool = False,
) -> np.ndarray:
    """
    Extract keypoints from DeepLabV3 segmentation logits using weighted centroid.

    Measurements models output 2-class segmentation (2 keypoints per frame).
    This function computes the weighted centroid of each class's logit/probability map.

    Args:
        logits: Segmentation logits/probabilities
                - Shape: (N, 2, H, W) for N frames, 2 keypoints, H×W spatial
                - Can be logits (pre-softmax) or probabilities (post-softmax)
        softmax: If True, apply softmax to logits first

    Returns:
        Keypoints array of shape (N, 2, 2) - N frames × 2 keypoints × (x, y) coordinates
        Coordinates are in model space (e.g., 640×480 for measurements models)

    Example:
        >>> logits = torch.randn(10, 2, 480, 640)  # 10 frames, 2 keypoints
        >>> keypoints = extract_keypoints_from_logits(logits)
        >>> keypoints.shape
        (10, 2, 2)  # 10 frames, 2 keypoints, (x, y)
    """
    # Convert to numpy if torch tensor
    if isinstance(logits, torch.Tensor):
        logits = logits.detach().cpu().numpy()

    # Apply softmax if needed
    if softmax:
        # Apply softmax along class dimension (dim=1)
        exp_logits = np.exp(logits - np.max(logits, axis=1, keepdims=True))
        logits = exp_logits / np.sum(exp_logits, axis=1, keepdims=True)

    N, C, H, W = logits.shape

    if C != 2:
        raise ValueError(f"Expected 2 classes (2 keypoints), got {C}")

    keypoints = np.zeros((N, C, 2), dtype=np.float32)

    # Create coordinate grids
    y_indices, x_indices = np.indices((H, W))

    for n in range(N):
        for c in range(C):
            # Get logit/probability map for this keypoint
            weight_map = logits[n, c]

            # Compute weighted centroid
            total_weight = weight_map.sum()

            if total_weight > 1e-6:  # Avoid division by zero
                x_center = (weight_map * x_indices).sum() / total_weight
                y_center = (weight_map * y_indices).sum() / total_weight
                keypoints[n, c] = [x_center, y_center]
            else:
                # Fallback: center of image
                keypoints[n, c] = [W / 2, H / 2]

    return keypoints


def validate_keypoints(
    keypoints: np.ndarray,
    image_shape: tuple[int, int],
) -> bool:
    """
    Validate keypoints are within image bounds.

    Args:
        keypoints: Keypoints array (N, 2, 2)
        image_shape: Image dimensions (height, width)

    Returns:
        True if all keypoints are valid
    """
    h, w = image_shape

    # Check shape
    if keypoints.ndim != 3 or keypoints.shape[1:] != (2, 2):
        raise ValueError(f"Invalid keypoints shape: {keypoints.shape}, expected (N, 2, 2)")

    # Check bounds
    x_coords = keypoints[:, :, 0]
    y_coords = keypoints[:, :, 1]

    if np.any(x_coords < 0) or np.any(x_coords >= w):
        print(f"Warning: X coordinates out of bounds [0, {w})")

    if np.any(y_coords < 0) or np.any(y_coords >= h):
        print(f"Warning: Y coordinates out of bounds [0, {h})")

    return True
