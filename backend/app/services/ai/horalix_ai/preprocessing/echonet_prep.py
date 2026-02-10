"""
EchoNet-Dynamic preprocessing.

Replicates exact preprocessing from Echocardiology_App for EchoNet-Dynamic model:
- Resize to 112x112
- Convert to float [0, 1]
- Track transform ratios for coordinate scaling
- Output: (N, 3, 112, 112) tensor + TransformMetadata

Reference: Echocardiology_App/backend/app/api/inference/infer_echonet_dynamic_api.py
"""

import numpy as np
import torch
import cv2
from typing import List, Tuple
from ..schema import TransformMetadata

TARGET_HEIGHT = 112
TARGET_WIDTH = 112
TARGET_SIZE = (TARGET_WIDTH, TARGET_HEIGHT)


def preprocess_for_echonet(
    frames: List[np.ndarray]
) -> Tuple[torch.Tensor, TransformMetadata]:
    """
    Preprocess frames for EchoNet-Dynamic model.

    CRITICAL: Must track transform metadata for upscaling masks back to original resolution.

    Steps:
    1. Resize to 112x112 (BILINEAR)
    2. Convert to float [0, 1]
    3. Store transform ratios
    4. Stack to (N, 3, 112, 112) tensor

    Args:
        frames: List of frames (H_orig, W_orig, 3) RGB uint8

    Returns:
        Tuple of:
        - Preprocessed tensor (N, 3, 112, 112) float32
        - TransformMetadata with ratios for mask upscaling

    Raises:
        ValueError: If frames list is empty
    """
    if len(frames) == 0:
        raise ValueError("Cannot preprocess empty frame list")

    # Get original dimensions from first frame
    orig_h, orig_w = frames[0].shape[:2]

    processed_frames = []

    for frame in frames:
        # Ensure RGB
        if frame.ndim == 2:
            frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2RGB)
        elif frame.shape[2] == 4:  # RGBA
            frame = cv2.cvtColor(frame, cv2.COLOR_RGBA2RGB)

        # Resize to 112x112 (BILINEAR interpolation)
        resized = cv2.resize(frame, TARGET_SIZE, interpolation=cv2.INTER_LINEAR)

        # Convert to float [0, 1]
        normalized = resized.astype(np.float32) / 255.0

        processed_frames.append(normalized)

    # Stack to (N, 112, 112, 3)
    stacked = np.stack(processed_frames, axis=0)

    # Transpose to (N, 3, 112, 112)
    tensor = torch.from_numpy(stacked).permute(0, 3, 1, 2).float()

    # Create transform metadata
    transform_meta = TransformMetadata(
        orig_h=orig_h,
        orig_w=orig_w,
        model_h=TARGET_HEIGHT,
        model_w=TARGET_WIDTH,
        ratio_h=orig_h / TARGET_HEIGHT,
        ratio_w=orig_w / TARGET_WIDTH,
    )

    return tensor, transform_meta


def validate_echonet_input(tensor: torch.Tensor, num_frames: int) -> bool:
    """
    Validate EchoNet input tensor.

    Args:
        tensor: Input tensor to validate
        num_frames: Expected number of frames

    Returns:
        True if valid
    """
    expected_shape = (num_frames, 3, TARGET_HEIGHT, TARGET_WIDTH)

    if tensor.shape != expected_shape:
        raise ValueError(
            f"Invalid EchoNet input shape: {tensor.shape}, "
            f"expected {expected_shape}"
        )

    return True
