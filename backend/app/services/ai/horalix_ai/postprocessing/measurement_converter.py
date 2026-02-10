"""
Measurement conversion from pixels to physical units.

Converts pixel distances to cm/mm using DICOM PixelSpacing metadata.

Replicates logic from Echocardiology_App/backend/app/AI_models/measurements/runner_2d.py
"""

import numpy as np
from typing import Tuple


def compute_length_cm(
    point1: np.ndarray,
    point2: np.ndarray,
    pixel_spacing: Tuple[float, float],
) -> float:
    """
    Compute Euclidean distance between two points in cm.

    Uses DICOM PixelSpacing to convert pixel distance to physical distance.

    Args:
        point1: First point (x, y) in DICOM pixel coordinates
        point2: Second point (x, y) in DICOM pixel coordinates
        pixel_spacing: (row_spacing_mm, col_spacing_mm) from DICOM (0028,0030)

    Returns:
        Distance in cm

    Example:
        >>> point1 = np.array([100, 150])
        >>> point2 = np.array([200, 250])
        >>> pixel_spacing = (0.15, 0.15)  # 0.15 mm/pixel
        >>> length_cm = compute_length_cm(point1, point2, pixel_spacing)
        >>> length_cm
        2.12  # cm
    """
    # Extract pixel coordinates
    x1, y1 = point1
    x2, y2 = point2

    # Pixel differences
    dx_px = x2 - x1
    dy_px = y2 - y1

    # Convert pixel spacing from mm to cm
    row_cm = pixel_spacing[0] / 10.0  # mm → cm
    col_cm = pixel_spacing[1] / 10.0  # mm → cm

    # Compute distances in cm
    dx_cm = dx_px * col_cm  # X uses column spacing
    dy_cm = dy_px * row_cm  # Y uses row spacing

    # Euclidean distance
    length_cm = np.sqrt(dx_cm**2 + dy_cm**2)

    return float(length_cm)


def compute_area_cm2(
    contour: np.ndarray,
    pixel_spacing: Tuple[float, float],
) -> float:
    """
    Compute area enclosed by a contour in cm².

    Args:
        contour: Contour points (N, 2) in DICOM pixel coordinates
        pixel_spacing: (row_spacing_mm, col_spacing_mm) from DICOM

    Returns:
        Area in cm²

    Example:
        >>> contour = np.array([[100, 100], [200, 100], [200, 200], [100, 200]])
        >>> pixel_spacing = (0.15, 0.15)
        >>> area_cm2 = compute_area_cm2(contour, pixel_spacing)
    """
    # Compute area in pixels using Shoelace formula
    x = contour[:, 0]
    y = contour[:, 1]

    area_px = 0.5 * np.abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))

    # Convert pixel spacing from mm to cm
    row_cm = pixel_spacing[0] / 10.0
    col_cm = pixel_spacing[1] / 10.0

    # Convert pixel area to cm²
    area_cm2 = area_px * row_cm * col_cm

    return float(area_cm2)


def compute_distance_statistics(
    keypoints: np.ndarray,
    pixel_spacing: Tuple[float, float],
) -> dict:
    """
    Compute distance statistics across multiple frames (for ED/ES detection).

    Args:
        keypoints: Keypoints across frames (N, 2, 2) - N frames × 2 keypoints × (x, y)
        pixel_spacing: DICOM pixel spacing

    Returns:
        Dictionary with min/max/mean/median distances and frame indices
    """
    distances_cm = []

    for frame_kpts in keypoints:
        point1, point2 = frame_kpts
        dist = compute_length_cm(point1, point2, pixel_spacing)
        distances_cm.append(dist)

    distances_cm = np.array(distances_cm)

    return {
        "min_cm": float(np.min(distances_cm)),
        "max_cm": float(np.max(distances_cm)),
        "mean_cm": float(np.mean(distances_cm)),
        "median_cm": float(np.median(distances_cm)),
        "frame_min": int(np.argmin(distances_cm)),  # End-systole (smallest)
        "frame_max": int(np.argmax(distances_cm)),  # End-diastole (largest)
        "all_distances_cm": distances_cm.tolist(),
    }


def compute_volume_from_area(
    area_cm2: float,
    length_cm: float,
    method: str = "simpson",
) -> float:
    """
    Estimate volume from area and length (for LV volume calculation).

    Args:
        area_cm2: Cross-sectional area in cm²
        length_cm: Length in cm
        method: Volume estimation method ("simpson", "ellipsoid")

    Returns:
        Volume in mL

    Note:
        Simpson's rule: V = (8/3π) × A² / L
        Ellipsoid: V = (4/3π) × (A / π)^(3/2)
    """
    if method == "simpson":
        # Simpson's biplane method
        volume_ml = (8 / (3 * np.pi)) * (area_cm2**2) / length_cm
    elif method == "ellipsoid":
        # Ellipsoid approximation
        radius = np.sqrt(area_cm2 / np.pi)
        volume_ml = (4 / 3) * np.pi * (radius**3)
    else:
        raise ValueError(f"Unknown volume method: {method}")

    return float(volume_ml)
