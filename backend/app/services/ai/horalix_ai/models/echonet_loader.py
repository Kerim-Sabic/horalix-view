"""
EchoNet-Dynamic model loader.

Loads the EchoNet-Dynamic DeepLabV3 ResNet50 model for LV segmentation.

The model performs frame-by-frame segmentation of the left ventricle cavity,
enabling volume estimation and EF calculation across the cardiac cycle.

Architecture: DeepLabV3 ResNet50 with 1 output channel (binary segmentation)
Input: 112×112 RGB frames
Output: Binary mask (sigmoid activation, threshold at 0.5)
"""

import logging
from pathlib import Path
import torch
import torch.nn as nn
from torchvision.models.segmentation import deeplabv3_resnet50

logger = logging.getLogger(__name__)


def load_echonet_model(
    weights_path: Path,
    device: str = "cuda",
) -> nn.Module:
    """
    Load EchoNet-Dynamic model from checkpoint.

    Replicates loading logic from Echocardiology_App's infer_echonet_dynamic_api.py:load_model()

    Args:
        weights_path: Path to best.pt checkpoint
        device: Target device

    Returns:
        Loaded model in eval mode

    Raises:
        FileNotFoundError: If weights file doesn't exist
        RuntimeError: If model loading fails
    """
    weights_path = Path(weights_path)

    if not weights_path.exists():
        raise FileNotFoundError(
            f"EchoNet-Dynamic weights not found at {weights_path}. "
            f"Ensure the Echocardiology_App AI_models directory is mounted correctly."
        )

    logger.info(f"Loading EchoNet-Dynamic model from {weights_path}")

    try:
        # Create DeepLabV3 ResNet50 with 1 output channel (binary segmentation)
        model = deeplabv3_resnet50(num_classes=1, pretrained=False)

        # Load checkpoint
        # EchoNet checkpoint structure may vary:
        # - Direct state_dict
        # - Dict with 'state_dict' key
        # - Dict with 'model' key
        checkpoint = torch.load(weights_path, map_location=device)

        if isinstance(checkpoint, dict):
            if "state_dict" in checkpoint:
                state_dict = checkpoint["state_dict"]
            elif "model" in checkpoint:
                state_dict = checkpoint["model"]
            elif "model_state_dict" in checkpoint:
                state_dict = checkpoint["model_state_dict"]
            else:
                # Assume checkpoint is the state dict itself
                state_dict = checkpoint

            # Load state dict
            # May need to handle keys with 'module.' prefix (from DataParallel)
            if any(k.startswith("module.") for k in state_dict.keys()):
                # Remove 'module.' prefix
                state_dict = {k.replace("module.", ""): v for k, v in state_dict.items()}

            # Use strict=False to ignore auxiliary classifier weights if present
            model.load_state_dict(state_dict, strict=False)

        else:
            # Use strict=False to ignore auxiliary classifier weights if present
            model.load_state_dict(checkpoint, strict=False)

        # Move to device and set to eval mode
        model = model.to(device)
        model.eval()

        logger.info(
            f"EchoNet-Dynamic model loaded successfully on {device} "
            f"({sum(p.numel() for p in model.parameters())/1e6:.1f}M parameters)"
        )

        return model

    except Exception as e:
        logger.error(f"Failed to load EchoNet-Dynamic model: {e}", exc_info=True)
        raise RuntimeError(f"EchoNet-Dynamic model loading failed: {e}") from e


def get_echonet_metadata() -> dict:
    """
    Get metadata about EchoNet-Dynamic model.

    Returns:
        Dictionary with model metadata
    """
    return {
        "name": "EchoNet-Dynamic",
        "architecture": "DeepLabV3 ResNet50",
        "task": "LV Segmentation",
        "input_size": (112, 112),
        "output_channels": 1,
        "activation": "sigmoid",
        "threshold": 0.5,
        "modality": "Echocardiography",
        "compatible_views": ["A4C", "A2C"],  # Primarily A4C
        "reference": "Ouyang et al., Nature 2020",
        "doi": "10.1038/s41586-020-2145-8",
    }


def validate_echonet_output(
    mask: torch.Tensor,
    expected_shape: tuple[int, int] = (112, 112),
) -> bool:
    """
    Validate EchoNet-Dynamic model output.

    Args:
        mask: Output mask tensor
        expected_shape: Expected spatial dimensions

    Returns:
        True if output is valid
    """
    if mask.dim() not in [2, 3, 4]:
        logger.error(f"Invalid mask dimensions: {mask.shape}")
        return False

    # Get spatial dimensions (last 2 dims)
    h, w = mask.shape[-2:]

    if (h, w) != expected_shape:
        logger.warning(f"Unexpected mask shape: {(h, w)}, expected {expected_shape}")

    # Check value range (should be [0, 1] after sigmoid)
    if mask.min() < 0 or mask.max() > 1:
        logger.error(f"Mask values out of range: [{mask.min():.3f}, {mask.max():.3f}]")
        return False

    return True
