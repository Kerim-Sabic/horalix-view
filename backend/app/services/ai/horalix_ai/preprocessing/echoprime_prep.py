"""
EchoPrime preprocessing.

Replicates EchoPrime preprocessing from Echocardiology_App:
- Use the first 32 frames (pad with zeros if fewer)
- Apply ultrasound mask + crop/scale
- Resize to 224x224
- Custom normalization (mean=[29.11, 28.08, 29.10], std=[47.99, 46.46, 47.20])
- Apply stride=2 (effective 16 frames)
- Output: (1, 3, 16, 224, 224) tensor

Reference: Echocardiology_App/backend/app/AI_models/EchoPrime/echo_prime/model.py
"""

import numpy as np
import torch
import cv2
from typing import List, Tuple

# EchoPrime custom normalization constants (computed from training data)
ECHOPRIME_MEAN = np.array([29.11, 28.08, 29.10], dtype=np.float32) / 255.0
ECHOPRIME_STD = np.array([47.99, 46.46, 47.20], dtype=np.float32) / 255.0

TARGET_SIZE = (224, 224)
FRAMES_TO_TAKE = 32
FRAME_STRIDE = 2
EFFECTIVE_FRAMES = FRAMES_TO_TAKE // FRAME_STRIDE
ZOOM_FACTOR = 0.1  # 10% inset crop


def apply_ultrasound_mask(frame: np.ndarray, mask_value: int = 0) -> np.ndarray:
    """
    Mask pixels outside the ultrasound wedge (circular/sector region).

    Replicates EchoPrime preprocessing to focus on relevant anatomical region.

    Strategy:
    - Find bright region (ultrasound data)
    - Fit bounding circle/ellipse
    - Mask pixels outside

    Args:
        frame: Input frame (H, W, 3) RGB uint8
        mask_value: Value to set masked pixels (default: 0 = black)

    Returns:
        Masked frame (H, W, 3) RGB uint8
    """
    # Convert to grayscale for thresholding
    if frame.ndim == 3:
        gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
    else:
        gray = frame

    # Apply Otsu's thresholding to find ultrasound region
    # Ultrasound data is typically brighter than background
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # Morphological operations to clean up mask
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)

    # Find contours
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        # No contour found, return original frame
        return frame

    # Get largest contour (assume it's the ultrasound wedge)
    largest_contour = max(contours, key=cv2.contourArea)

    # Fit minimum enclosing circle
    (x, y), radius = cv2.minEnclosingCircle(largest_contour)
    center = (int(x), int(y))
    radius = int(radius)

    # Create circular mask
    mask = np.zeros(frame.shape[:2], dtype=np.uint8)
    cv2.circle(mask, center, radius, 255, -1)

    # Apply mask
    masked_frame = frame.copy()
    masked_frame[mask == 0] = mask_value

    return masked_frame


def zoom_crop(frame: np.ndarray, zoom: float = ZOOM_FACTOR) -> np.ndarray:
    """
    Apply zoom crop (crop edges, then resize back to original size).

    This focuses attention on the central region while maintaining aspect ratio.

    Args:
        frame: Input frame (H, W, 3)
        zoom: Zoom factor (0.1 = 10% inset)

    Returns:
        Cropped and resized frame (H, W, 3)
    """
    h, w = frame.shape[:2]

    # Calculate crop dimensions (90% of original if zoom=0.1)
    crop_h = int(h * (1 - zoom))
    crop_w = int(w * (1 - zoom))

    # Calculate crop offsets (center crop)
    top = (h - crop_h) // 2
    left = (w - crop_w) // 2

    # Crop
    cropped = frame[top:top+crop_h, left:left+crop_w]

    # Resize back to original size
    resized = cv2.resize(cropped, (w, h), interpolation=cv2.INTER_LINEAR)

    return resized


def sample_frames_for_echoprime(frames: List[np.ndarray], num_frames: int = FRAMES_TO_TAKE) -> List[np.ndarray]:
    """
    Prepare frames for EchoPrime (match upstream behavior).

    EchoPrime uses the first 32 frames, then applies stride=2 internally.
    If fewer than 32 frames are available, pad with zeros.
    """
    total_frames = len(frames)
    if total_frames == 0:
        raise ValueError("Cannot sample frames from empty frame list")

    # Take the first N frames (no even-spacing)
    sampled = frames[:num_frames]

    # Pad with zeros if needed
    if len(sampled) < num_frames:
        h, w = frames[0].shape[:2]
        pad_frame = np.zeros((h, w, 3), dtype=frames[0].dtype)
        sampled.extend([pad_frame] * (num_frames - len(sampled)))

    return sampled


def preprocess_for_echoprime(
    frames: List[np.ndarray],
    use_echoprime_utils: bool = True,
) -> torch.Tensor:
    """
    Preprocess frames for EchoPrime model.

    CRITICAL: Must exactly match Echocardiology_App preprocessing.

    Steps:
    1. Mask ultrasound wedge (EchoPrime utils if available)
    2. Crop/scale (EchoPrime utils if available)
    3. Resize to 224x224
    4. Convert to float [0, 1]
    5. Apply custom normalization
    6. Stack to (1, 3, 32, 224, 224) tensor
    7. Apply stride=2 to get (1, 3, 16, 224, 224)

    Args:
        frames: List of frames (H, W, 3) RGB uint8

    Returns:
        Preprocessed tensor (1, 3, 16, 224, 224) float32

    Raises:
        ValueError: If frames list is not 32 frames
    """
    if len(frames) != FRAMES_TO_TAKE:
        raise ValueError(
            f"EchoPrime requires exactly {FRAMES_TO_TAKE} frames, got {len(frames)}. "
            f"Use sample_frames_for_echoprime() first."
        )

    processed_frames = []

    # Attempt to use EchoPrime's exact preprocessing utilities if available
    echoprime_mask = None
    echoprime_crop = None
    if use_echoprime_utils:
        try:
            from EchoPrime.utils import utils as echoprime_utils  # type: ignore
            echoprime_mask = echoprime_utils.mask_outside_ultrasound
            echoprime_crop = echoprime_utils.crop_and_scale
        except Exception:
            echoprime_mask = None
            echoprime_crop = None

    # Apply video-level masking if EchoPrime utils are available
    if echoprime_mask is not None:
        try:
            frames_np = np.stack(frames, axis=0)
            frames_np = echoprime_mask(frames_np)
            frames = [frames_np[i] for i in range(frames_np.shape[0])]
        except Exception:
            # Fall back to per-frame masking
            echoprime_mask = None

    for frame in frames:
        # Ensure RGB
        if frame.ndim == 2:
            frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2RGB)
        elif frame.shape[2] == 4:  # RGBA
            frame = cv2.cvtColor(frame, cv2.COLOR_RGBA2RGB)

        if echoprime_mask is not None:
            masked = frame
        else:
            # Fallback: per-frame mask + zoom
            masked = apply_ultrasound_mask(frame)

        if echoprime_crop is not None:
            # EchoPrime crop_and_scale handles zoom internally
            resized = echoprime_crop(masked, res=TARGET_SIZE, zoom=ZOOM_FACTOR)
        else:
            zoomed = zoom_crop(masked, zoom=ZOOM_FACTOR)
            resized = cv2.resize(zoomed, TARGET_SIZE, interpolation=cv2.INTER_LINEAR)

        # Convert to float [0, 1]
        normalized = resized.astype(np.float32) / 255.0

        # Apply custom normalization
        normalized = (normalized - ECHOPRIME_MEAN) / ECHOPRIME_STD

        processed_frames.append(normalized)

    # Stack to (32, 224, 224, 3)
    stacked = np.stack(processed_frames, axis=0)

    # Transpose to (1, 3, 32, 224, 224)
    tensor = torch.from_numpy(stacked).permute(3, 0, 1, 2).unsqueeze(0).float()

    # Apply stride=2 to match EchoPrime (effective 16 frames)
    tensor = tensor[:, :, :FRAMES_TO_TAKE:FRAME_STRIDE, :, :]

    return tensor


def validate_echoprime_input(tensor: torch.Tensor) -> bool:
    """
    Validate EchoPrime input tensor.

    Args:
        tensor: Input tensor to validate

    Returns:
        True if valid
    """
    expected_shape = (1, 3, EFFECTIVE_FRAMES, TARGET_SIZE[0], TARGET_SIZE[1])
    if tensor.shape != expected_shape:
        raise ValueError(
            f"Invalid EchoPrime input shape: {tensor.shape}, "
            f"expected {expected_shape}"
        )

    return True
