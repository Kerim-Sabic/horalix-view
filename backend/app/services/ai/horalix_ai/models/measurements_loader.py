"""
Measurements model loader.

Loads the 9 anatomical measurement models (DeepLabV3 ResNet50) for 2D keypoint detection.

Models:
- IVS (Interventricular Septum)
- LVID (LV Internal Diameter)
- LVPW (LV Posterior Wall)
- Aorta
- Aortic Root
- LA (Left Atrium)
- RV Base (Right Ventricle)
- PA (Pulmonary Artery)
- IVC (Inferior Vena Cava)

Each model outputs 2-class segmentation (2 keypoints per frame).
"""

import logging
from pathlib import Path
import torch
import torch.nn as nn
from torchvision.models.segmentation import deeplabv3_resnet50

logger = logging.getLogger(__name__)

# Standard measurement model names
MEASUREMENT_MODEL_NAMES = [
    "ivs",          # Interventricular Septum
    "lvid",         # LV Internal Diameter
    "lvpw",         # LV Posterior Wall
    "aorta",        # Aorta
    "aortic_root",  # Aortic Root
    "la",           # Left Atrium
    "rv_base",      # Right Ventricle Base
    "pa",           # Pulmonary Artery
    "ivc",          # Inferior Vena Cava
]


def load_measurement_model(
    weights_path: Path,
    device: str = "cuda",
    model_name: str | None = None,
) -> nn.Module:
    """
    Load a single measurements model (DeepLabV3 ResNet50 with 2 output classes).

    Replicates loading logic from Echocardiology_App's runner_2d.py.

    Args:
        weights_path: Path to .ckpt file
        device: Target device
        model_name: Optional model name for logging

    Returns:
        Loaded model in eval mode

    Raises:
        FileNotFoundError: If weights file doesn't exist
        RuntimeError: If model loading fails
    """
    weights_path = Path(weights_path)

    if not weights_path.exists():
        raise FileNotFoundError(
            f"Measurement model weights not found at {weights_path}. "
            f"Ensure the Echocardiology_App AI_models directory is mounted correctly."
        )

    logger.info(f"Loading measurement model {model_name or 'unknown'} from {weights_path}")

    try:
        # Create DeepLabV3 ResNet50 with 2 output classes (2 keypoints)
        model = deeplabv3_resnet50(num_classes=2, pretrained=False)

        # Load checkpoint
        # Checkpoint may be:
        # - Direct state_dict
        # - Dict with 'state_dict' key
        # - Dict with 'model_state_dict' key
        checkpoint = torch.load(weights_path, map_location=device)

        if isinstance(checkpoint, dict):
            if "state_dict" in checkpoint:
                model.load_state_dict(checkpoint["state_dict"], strict=False)
            elif "model_state_dict" in checkpoint:
                model.load_state_dict(checkpoint["model_state_dict"], strict=False)
            elif "model" in checkpoint:
                model.load_state_dict(checkpoint["model"], strict=False)
            else:
                # Assume checkpoint is the state dict itself
                model.load_state_dict(checkpoint, strict=False)
        else:
            model.load_state_dict(checkpoint, strict=False)

        # Move to device and set to eval mode
        model = model.to(device)
        model.eval()

        logger.info(
            f"Measurement model {model_name or 'unknown'} loaded successfully on {device} "
            f"({sum(p.numel() for p in model.parameters())/1e6:.1f}M parameters)"
        )

        return model

    except Exception as e:
        logger.error(f"Failed to load measurement model {model_name}: {e}", exc_info=True)
        raise RuntimeError(f"Measurement model loading failed: {e}") from e


def load_all_measurement_models(
    measurements_dir: Path,
    device: str = "cuda",
    required_models: list[str] | None = None,
) -> dict[str, nn.Module]:
    """
    Load all (or subset of) measurement models.

    Args:
        measurements_dir: Path to measurements/weights directory
        device: Target device
        required_models: Optional list of model names to load. If None, loads all.

    Returns:
        Dict mapping model names to loaded models

    Raises:
        RuntimeError: If any required model fails to load
    """
    measurements_dir = Path(measurements_dir)
    models_2d_dir = measurements_dir / "2D_models"

    if not models_2d_dir.exists():
        raise FileNotFoundError(
            f"Measurements 2D models directory not found at {models_2d_dir}. "
            f"Ensure the directory structure is: {measurements_dir}/2D_models/*.ckpt"
        )

    # Determine which models to load
    models_to_load = required_models if required_models is not None else MEASUREMENT_MODEL_NAMES

    loaded_models = {}
    failed_models = []

    logger.info(f"Loading {len(models_to_load)} measurement models from {models_2d_dir}")

    for model_name in models_to_load:
        weights_path = models_2d_dir / f"{model_name}_weights.ckpt"

        if not weights_path.exists():
            logger.warning(f"Measurement model weights not found: {weights_path}")
            failed_models.append(model_name)
            continue

        try:
            model = load_measurement_model(weights_path, device=device, model_name=model_name)
            loaded_models[model_name] = model

        except Exception as e:
            logger.error(f"Failed to load measurement model {model_name}: {e}")
            failed_models.append(model_name)

    # Summary
    logger.info(
        f"Loaded {len(loaded_models)}/{len(models_to_load)} measurement models successfully"
    )

    if failed_models:
        logger.warning(f"Failed to load models: {', '.join(failed_models)}")

        if required_models is not None:
            # If specific models were required and failed, raise error
            missing_required = set(required_models) & set(failed_models)
            if missing_required:
                raise RuntimeError(
                    f"Required measurement models failed to load: {', '.join(missing_required)}"
                )

    return loaded_models


def get_measurement_model_info() -> dict[str, dict]:
    """
    Get metadata about available measurement models.

    Returns:
        Dict mapping model names to metadata (anatomical structure, view compatibility)
    """
    return {
        "ivs": {
            "full_name": "Interventricular Septum Thickness",
            "anatomical_structure": "IVS",
            "compatible_views": ["PLAX", "Parasternal_Long"],
            "unit": "cm",
            "normal_range": (0.6, 1.0),
        },
        "lvid": {
            "full_name": "LV Internal Diameter",
            "anatomical_structure": "LV",
            "compatible_views": ["PLAX", "Parasternal_Long"],
            "unit": "cm",
            "normal_range": (3.5, 5.6),
        },
        "lvpw": {
            "full_name": "LV Posterior Wall Thickness",
            "anatomical_structure": "LVPW",
            "compatible_views": ["PLAX", "Parasternal_Long"],
            "unit": "cm",
            "normal_range": (0.6, 1.0),
        },
        "aorta": {
            "full_name": "Aortic Diameter",
            "anatomical_structure": "Aorta",
            "compatible_views": ["PLAX", "Parasternal_Long"],
            "unit": "cm",
            "normal_range": (2.0, 3.7),
        },
        "aortic_root": {
            "full_name": "Aortic Root Diameter",
            "anatomical_structure": "Aortic Root",
            "compatible_views": ["PLAX", "Parasternal_Long"],
            "unit": "cm",
            "normal_range": (2.0, 3.7),
        },
        "la": {
            "full_name": "Left Atrium Diameter",
            "anatomical_structure": "LA",
            "compatible_views": ["PLAX", "Parasternal_Long", "A4C"],
            "unit": "cm",
            "normal_range": (2.7, 4.0),
        },
        "rv_base": {
            "full_name": "RV Base Diameter",
            "anatomical_structure": "RV",
            "compatible_views": ["A4C", "PSAX", "Parasternal_Short"],
            "unit": "cm",
            "normal_range": (2.0, 2.8),
        },
        "pa": {
            "full_name": "Pulmonary Artery Diameter",
            "anatomical_structure": "PA",
            "compatible_views": ["PSAX", "Parasternal_Short"],
            "unit": "cm",
            "normal_range": (1.5, 2.5),
        },
        "ivc": {
            "full_name": "Inferior Vena Cava Diameter",
            "anatomical_structure": "IVC",
            "compatible_views": ["Subcostal"],
            "unit": "cm",
            "normal_range": (1.5, 2.5),
        },
    }
