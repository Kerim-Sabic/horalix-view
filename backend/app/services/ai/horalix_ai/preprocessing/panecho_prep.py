"""
PanEcho preprocessing.

Replicates exact preprocessing from Echocardiology_App for PanEcho model:
- 16 uniformly-sampled frames
- Resize to 224×224 (BILINEAR interpolation)
- ImageNet normalization (mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
- Output: (1, 3, 16, 224, 224) tensor

Reference: Echocardiology_App/backend/app/helpers/inference_functions.py
"""

import numpy as np
import torch
import cv2
from typing import List

# ImageNet normalization constants
IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

TARGET_SIZE = (224, 224)
NUM_FRAMES = 16


def sample_frames_for_panecho(frames: List[np.ndarray], num_frames: int = NUM_FRAMES) -> List[np.ndarray]:
    """
    Sample evenly-spaced frames from a cine sequence.

    Replicates Echocardiology_App's pick_frames_from_instance logic.

    Args:
        frames: List of frame arrays (H, W, 3) RGB
        num_frames: Number of frames to sample (default: 16)

    Returns:
        List of sampled frames (always num_frames, even if input is shorter/longer)
    """
    total_frames = len(frames)

    if total_frames == 0:
        raise ValueError("Cannot sample frames from empty frame list")

    # Calculate evenly-spaced indices
    # Formula: floor(i * total_frames / num_frames) for i in range(num_frames)
    indices = [
        min(int(i * total_frames / num_frames), total_frames - 1)
        for i in range(num_frames)
    ]

    sampled_frames = [frames[idx] for idx in indices]

    return sampled_frames


def preprocess_for_panecho(frames: List[np.ndarray]) -> torch.Tensor:
    """
    Preprocess frames for PanEcho model.

    CRITICAL: Must exactly match Echocardiology_App preprocessing.

    Steps:
    1. Resize each frame to 224×224 (BILINEAR)
    2. Convert to float [0, 1]
    3. Apply ImageNet normalization
    4. Stack to (1, 3, 16, 224, 224) tensor

    Args:
        frames: List of 16 frames (H, W, 3) RGB uint8

    Returns:
        Preprocessed tensor (1, 3, 16, 224, 224) float32

    Raises:
        ValueError: If frames list is not 16 frames
    """
    if len(frames) != NUM_FRAMES:
        raise ValueError(
            f"PanEcho requires exactly {NUM_FRAMES} frames, got {len(frames)}. "
            f"Use sample_frames_for_panecho() first."
        )

    processed_frames = []

    for frame in frames:
        # Ensure RGB
        if frame.ndim == 2:
            frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2RGB)
        elif frame.shape[2] == 4:  # RGBA
            frame = cv2.cvtColor(frame, cv2.COLOR_RGBA2RGB)

        # Resize to 224×224 (BILINEAR interpolation)
        resized = cv2.resize(frame, TARGET_SIZE, interpolation=cv2.INTER_LINEAR)

        # Convert to float [0, 1]
        normalized = resized.astype(np.float32) / 255.0

        # Apply ImageNet normalization
        normalized = (normalized - IMAGENET_MEAN) / IMAGENET_STD

        processed_frames.append(normalized)

    # Stack to (16, 224, 224, 3)
    stacked = np.stack(processed_frames, axis=0)

    # Transpose to (1, 3, 16, 224, 224)
    # From (16, H, W, 3) to (3, 16, H, W) then add batch dim
    tensor = torch.from_numpy(stacked).permute(3, 0, 1, 2).unsqueeze(0).float()

    return tensor


def validate_panecho_input(tensor: torch.Tensor) -> bool:
    """
    Validate PanEcho input tensor.

    Args:
        tensor: Input tensor to validate

    Returns:
        True if valid
    """
    if tensor.shape != (1, 3, NUM_FRAMES, TARGET_SIZE[0], TARGET_SIZE[1]):
        raise ValueError(
            f"Invalid PanEcho input shape: {tensor.shape}, "
            f"expected (1, 3, {NUM_FRAMES}, {TARGET_SIZE[0]}, {TARGET_SIZE[1]})"
        )

    return True
