"""
Contour extraction from binary masks.

Extracts vector contours from segmentation masks for overlay rendering.

Replicates logic from Echocardiology_App/backend/app/api/inference/infer_echonet_dynamic_api.py
"""

import numpy as np
import cv2
from typing import List


def extract_contours_from_mask(
    mask: np.ndarray,
    min_area_px: int = 100,
    sort_by_area: bool = True,
) -> List[np.ndarray]:
    """
    Extract contours from binary segmentation mask.

    Args:
        mask: Binary mask (H, W) with values 0 or 1 (or 0-255)
        min_area_px: Minimum contour area in pixels (filters noise)
        sort_by_area: If True, sort contours by area (largest first)

    Returns:
        List of contours, each (N, 2) array of (x, y) coordinates

    Example:
        >>> mask = np.zeros((100, 100), dtype=np.uint8)
        >>> cv2.circle(mask, (50, 50), 30, 255, -1)
        >>> contours = extract_contours_from_mask(mask)
        >>> len(contours)
        1
        >>> contours[0].shape
        (N, 2)  # N points defining the circle contour
    """
    # Ensure binary mask (0 or 255)
    if mask.max() <= 1:
        mask_binary = (mask * 255).astype(np.uint8)
    else:
        mask_binary = mask.astype(np.uint8)

    # Find contours (EXTERNAL = outer boundaries only)
    contours, _ = cv2.findContours(
        mask_binary,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE,
    )

    # Filter by area
    filtered_contours = []

    for contour in contours:
        area = cv2.contourArea(contour)

        if area >= min_area_px:
            # Convert from (N, 1, 2) to (N, 2)
            contour_squeezed = contour.squeeze()

            # Handle edge case: single point
            if contour_squeezed.ndim == 1:
                contour_squeezed = contour_squeezed.reshape(1, -1)

            filtered_contours.append(contour_squeezed)

    # Sort by area (largest first)
    if sort_by_area and filtered_contours:
        filtered_contours.sort(
            key=lambda cnt: cv2.contourArea(cnt.reshape(-1, 1, 2)),
            reverse=True,
        )

    return filtered_contours


def smooth_contour(
    contour: np.ndarray,
    epsilon_factor: float = 0.01,
) -> np.ndarray:
    """
    Smooth contour using Douglas-Peucker algorithm.

    Args:
        contour: Contour points (N, 2)
        epsilon_factor: Approximation accuracy factor (0.01 = 1% of perimeter)

    Returns:
        Smoothed contour (M, 2) where M <= N

    Example:
        >>> noisy_contour = np.random.rand(100, 2) * 100
        >>> smooth = smooth_contour(noisy_contour, epsilon_factor=0.02)
        >>> smooth.shape[0] < noisy_contour.shape[0]
        True  # Fewer points after smoothing
    """
    # Reshape to (N, 1, 2) for cv2.approxPolyDP
    contour_reshaped = contour.reshape(-1, 1, 2).astype(np.float32)

    # Compute perimeter
    perimeter = cv2.arcLength(contour_reshaped, closed=True)

    # Epsilon = epsilon_factor * perimeter
    epsilon = epsilon_factor * perimeter

    # Apply Douglas-Peucker algorithm
    smoothed = cv2.approxPolyDP(contour_reshaped, epsilon, closed=True)

    # Reshape back to (M, 2)
    smoothed_squeezed = smoothed.squeeze()

    if smoothed_squeezed.ndim == 1:
        smoothed_squeezed = smoothed_squeezed.reshape(1, -1)

    return smoothed_squeezed


def get_largest_contour(contours: List[np.ndarray]) -> np.ndarray | None:
    """
    Get largest contour by area.

    Args:
        contours: List of contours

    Returns:
        Largest contour or None if list is empty
    """
    if not contours:
        return None

    return max(
        contours,
        key=lambda cnt: cv2.contourArea(cnt.reshape(-1, 1, 2)),
    )


def postprocess_segmentation_mask(
    mask: np.ndarray,
    apply_morphology: bool = True,
    kernel_size: int = 5,
) -> np.ndarray:
    """
    Apply morphological operations to clean up segmentation mask.

    Replicates EchoNet-Dynamic postprocessing.

    Args:
        mask: Binary mask (H, W)
        apply_morphology: If True, apply open and close operations
        kernel_size: Morphological kernel size

    Returns:
        Cleaned binary mask
    """
    if not apply_morphology:
        return mask

    # Ensure binary
    if mask.max() <= 1:
        mask_binary = (mask * 255).astype(np.uint8)
    else:
        mask_binary = mask.astype(np.uint8)

    # Create elliptical kernel
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (kernel_size, kernel_size),
    )

    # Morphological closing (fill small holes)
    closed = cv2.morphologyEx(mask_binary, cv2.MORPH_CLOSE, kernel)

    # Morphological opening (remove small noise)
    opened = cv2.morphologyEx(closed, cv2.MORPH_OPEN, kernel)

    # Optional: Gaussian blur to smooth edges
    # blurred = cv2.GaussianBlur(opened, (7, 7), 0)
    # _, opened = cv2.threshold(blurred, 127, 255, cv2.THRESH_BINARY)

    return (opened > 127).astype(np.uint8)


def compute_contour_properties(contour: np.ndarray) -> dict:
    """
    Compute geometric properties of a contour.

    Args:
        contour: Contour points (N, 2)

    Returns:
        Dictionary with area, perimeter, centroid, bounding box
    """
    # Reshape for OpenCV
    contour_reshaped = contour.reshape(-1, 1, 2).astype(np.float32)

    # Area
    area = cv2.contourArea(contour_reshaped)

    # Perimeter
    perimeter = cv2.arcLength(contour_reshaped, closed=True)

    # Centroid (moments)
    M = cv2.moments(contour_reshaped)

    if M["m00"] > 0:
        cx = M["m10"] / M["m00"]
        cy = M["m01"] / M["m00"]
    else:
        cx, cy = contour.mean(axis=0)

    # Bounding box
    x, y, w, h = cv2.boundingRect(contour_reshaped)

    return {
        "area_px": float(area),
        "perimeter_px": float(perimeter),
        "centroid": (float(cx), float(cy)),
        "bounding_box": {"x": int(x), "y": int(y), "width": int(w), "height": int(h)},
        "num_points": len(contour),
    }
