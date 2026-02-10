"""
PanEcho model loader.

Loads the PanEcho model using PyTorch Hub (local repository mode) to replicate
the exact loading mechanism from Echocardiology_App.

Architecture: ConvNeXt Tiny + Transformer Encoder (4 layers, 8 heads) + Multi-task heads (39 tasks)
"""

import logging
from pathlib import Path
import torch
import torch.nn as nn

logger = logging.getLogger(__name__)


def load_panecho_model(
    weights_path: Path,
    device: str = "cuda",
    hub_dir: Path | None = None,
) -> nn.Module:
    """
    Load PanEcho model from weights file.

    Replicates the loading logic from Echocardiology_App's inference_functions.py:get_model_and_device()

    Args:
        weights_path: Path to panecho.pt weights file
        device: Target device ("cuda", "cuda:0", "cpu")
        hub_dir: Path to PanEcho repository (parent of weights/). If None, inferred from weights_path.

    Returns:
        Loaded PanEcho model in eval mode

    Raises:
        FileNotFoundError: If weights file doesn't exist
        RuntimeError: If model loading fails
    """
    weights_path = Path(weights_path)

    if not weights_path.exists():
        raise FileNotFoundError(
            f"PanEcho weights not found at {weights_path}. "
            f"Ensure the Echocardiology_App AI_models directory is mounted correctly."
        )

    # Infer hub directory (should be PanEcho/ root, parent of weights/)
    if hub_dir is None:
        # weights_path is typically .../PanEcho/weights/panecho.pt
        hub_dir = weights_path.parent.parent

    hub_dir = Path(hub_dir)
    if not (hub_dir / "hubconf.py").exists():
        raise FileNotFoundError(
            f"PanEcho repository not found at {hub_dir}. "
            f"Expected hubconf.py to exist at {hub_dir}/hubconf.py"
        )

    logger.info(f"Loading PanEcho model from {hub_dir} with weights {weights_path}")

    try:
        # Use torch.hub.load with local directory
        # This calls PanEcho() function from hubconf.py
        # IMPORTANT: Set TORCH_HOME to avoid downloading pretrained ConvNeXt backbone
        import os
        original_torch_home = os.environ.get("TORCH_HOME")
        cache_dir = hub_dir / "pytorch_hub_cache"
        cache_dir.mkdir(parents=True, exist_ok=True)
        os.environ["TORCH_HOME"] = str(cache_dir)

        # Load model via hub (offline mode)
        # Note: PanEcho hubconf.py automatically loads weights from weights/panecho.pt
        model = torch.hub.load(
            str(hub_dir),
            "PanEcho",
            source="local",
            pretrained=True,
        )

        # Restore TORCH_HOME
        if original_torch_home:
            os.environ["TORCH_HOME"] = original_torch_home
        else:
            os.environ.pop("TORCH_HOME", None)

        # Move to device and set to eval mode
        model = model.to(device)
        model.eval()

        logger.info(f"PanEcho model loaded successfully on {device}")
        logger.info(f"Model has {sum(p.numel() for p in model.parameters())/1e6:.1f}M parameters")

        return model

    except Exception as e:
        logger.error(f"Failed to load PanEcho model: {e}", exc_info=True)
        raise RuntimeError(f"PanEcho model loading failed: {e}") from e


def get_panecho_task_metadata(hub_dir: Path) -> dict:
    """
    Load PanEcho task metadata (39 tasks with names, types, classes).

    Args:
        hub_dir: Path to PanEcho repository

    Returns:
        Dictionary mapping task names to metadata (type, class_names, mean)
    """
    import pickle

    tasks_pkl = hub_dir / "content" / "tasks.pkl"

    if not tasks_pkl.exists():
        logger.warning(f"Tasks metadata not found at {tasks_pkl}, using defaults")
        return {}

    try:
        with open(tasks_pkl, "rb") as f:
            tasks = pickle.load(f)

        logger.info(f"Loaded metadata for {len(tasks)} PanEcho tasks")
        return tasks

    except Exception as e:
        logger.error(f"Failed to load PanEcho task metadata: {e}")
        return {}
