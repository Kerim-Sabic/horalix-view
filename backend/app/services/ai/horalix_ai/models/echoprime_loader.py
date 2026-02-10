"""
EchoPrime model loader.

Loads the EchoPrime multi-view vision-language model components:
- Video encoder (MViT-v2 Small)
- Text encoder
- View classifier (ConvNeXt Base)

Replicates loading logic from Echocardiology_App.
"""

import logging
import os
import importlib
from pathlib import Path
import torch
import torch.nn as nn
import sys

logger = logging.getLogger(__name__)


def load_echoprime_models(
    encoder_path: Path,
    text_encoder_path: Path,
    view_classifier_path: Path,
    device: str = "cuda",
) -> tuple[nn.Module, nn.Module]:
    """
    Load EchoPrime model components.

    Args:
        encoder_path: Path to echo_prime_encoder.pt
        text_encoder_path: Path to echo_prime_text_encoder.pt
        view_classifier_path: Path to view_classifier.pt
        device: Target device

    Returns:
        Tuple of (echoprime_model, view_classifier)

    Raises:
        FileNotFoundError: If any weights file doesn't exist
        RuntimeError: If model loading fails
    """
    encoder_path = Path(encoder_path)
    text_encoder_path = Path(text_encoder_path)
    view_classifier_path = Path(view_classifier_path)

    # Validate all paths exist
    for path, name in [
        (encoder_path, "EchoPrime encoder"),
        (text_encoder_path, "EchoPrime text encoder"),
        (view_classifier_path, "View classifier"),
    ]:
        if not path.exists():
            raise FileNotFoundError(
                f"{name} weights not found at {path}. "
                f"Ensure the Echocardiology_App AI_models directory is mounted correctly."
            )

    logger.info("Loading EchoPrime models...")

    try:
        # Add EchoPrime parent directory to Python path for proper package imports
        # EchoPrime uses relative imports (from ..utils), so we need the parent
        echoprime_dir = encoder_path.parent.parent.parent  # .../EchoPrime/
        echoprime_parent = echoprime_dir.parent  # .../horalix_ai/

        if str(echoprime_parent) not in sys.path:
            sys.path.insert(0, str(echoprime_parent))

        # Import EchoPrime model classes
        # NOTE: This requires the EchoPrime source code to be present in the mounted directory
        from EchoPrime.echo_prime.model import EchoPrime  # type: ignore
        model_module = importlib.import_module("EchoPrime.echo_prime.model")
        model_file = Path(getattr(model_module, "__file__", "")).resolve()
        configured_root = echoprime_dir.resolve()

        logger.info(f"EchoPrime configured root: {configured_root}")
        logger.info(f"EchoPrime imported model file: {model_file}")
        logger.info(
            "EchoPrime env overrides: "
            f"AI_HORALIX_AI_MODELS_ROOT={os.getenv('AI_HORALIX_AI_MODELS_ROOT')} "
            f"AI_HORALIX_AI_MODELS_DIR={os.getenv('AI_HORALIX_AI_MODELS_DIR')} "
            f"HORALIX_AI_MODELS_DIR={os.getenv('HORALIX_AI_MODELS_DIR')}"
        )

        try:
            model_file.relative_to(configured_root)
        except ValueError as exc:
            raise RuntimeError(
                "EchoPrime import source mismatch: "
                f"imported model.py is outside configured root. imported={model_file}, "
                f"configured_root={configured_root}"
            ) from exc

        # Load EchoPrime main model (encoder + text encoder)
        # NOTE: EchoPrime automatically loads weights from model_data/weights/ relative to its location
        echoprime_model = EchoPrime(device=device)
        # Model is already set to eval mode in __init__

        logger.info(f"EchoPrime model loaded successfully on {device}")

        # Load view classifier separately
        view_classifier = torch.load(view_classifier_path, map_location=device)
        if isinstance(view_classifier, dict):
            # If checkpoint is a state dict, need to instantiate model
            # Assuming ConvNeXt Base architecture with 11 output classes
            from torchvision.models import convnext_base
            classifier = convnext_base(num_classes=11)
            classifier.load_state_dict(view_classifier)
            view_classifier = classifier

        view_classifier = view_classifier.to(device)
        view_classifier.eval()

        logger.info(f"View classifier loaded successfully on {device}")
        logger.info(f"View classifier has {sum(p.numel() for p in view_classifier.parameters())/1e6:.1f}M parameters")

        return echoprime_model, view_classifier

    except ImportError as e:
        logger.error(
            f"Failed to import EchoPrime source code. Ensure echo_prime/ module is present in {echoprime_dir}",
            exc_info=True,
        )
        raise RuntimeError(f"EchoPrime import failed: {e}. Check that source code is available.") from e

    except Exception as e:
        logger.error(f"Failed to load EchoPrime models: {e}", exc_info=True)
        raise RuntimeError(f"EchoPrime model loading failed: {e}") from e


def get_echoprime_view_classes() -> list[str]:
    """
    Get list of EchoPrime view classes (11 total).

    Returns:
        List of view class names
    """
    return [
        "A2C",  # Apical 2-chamber
        "A3C",  # Apical 3-chamber
        "A4C",  # Apical 4-chamber
        "A5C",  # Apical 5-chamber
        "Apical_Doppler",
        "Doppler_Parasternal_Long",
        "Doppler_Parasternal_Short",
        "Parasternal_Long",
        "Parasternal_Short",
        "SSN",  # Suprasternal notch
        "Subcostal",
    ]


def get_echoprime_anatomical_sections() -> list[str]:
    """
    Get list of EchoPrime anatomical sections (16 total).

    Returns:
        List of anatomical section names
    """
    return [
        "Left Ventricle",
        "Resting Segmental Wall Motion Analysis",
        "Right Ventricle",
        "Left Atrium",
        "Right Atrium",
        "Atrial Septum",
        "Mitral Valve",
        "Aortic Valve",
        "Tricuspid Valve",
        "Pulmonic Valve",
        "Pericardium",
        "Aorta",
        "IVC",
        "Pulmonary Artery",
        "Pulmonary Veins",
        "Postoperative Findings",
    ]


def load_echoprime_candidate_embeddings(echoprime_dir: Path, device: str = "cuda") -> tuple[torch.Tensor, torch.Tensor]:
    """
    Load pre-computed candidate report embeddings (used for retrieval-based predictions).

    Args:
        echoprime_dir: Path to EchoPrime root directory
        device: Target device

    Returns:
        Tuple of (embeddings_p1, embeddings_p2) tensors
    """
    candidates_dir = echoprime_dir / "model_data" / "candidates_data"

    embedding_p1_path = candidates_dir / "candidate_embeddings_p1.pt"
    embedding_p2_path = candidates_dir / "candidate_embeddings_p2.pt"

    if not embedding_p1_path.exists() or not embedding_p2_path.exists():
        logger.warning(f"Candidate embeddings not found in {candidates_dir}. Retrieval-based predictions may not work.")
        return torch.empty(0), torch.empty(0)

    try:
        embeddings_p1 = torch.load(embedding_p1_path, map_location=device)
        embeddings_p2 = torch.load(embedding_p2_path, map_location=device)

        logger.info(f"Loaded candidate embeddings: part1 shape={embeddings_p1.shape}, part2 shape={embeddings_p2.shape}")

        return embeddings_p1, embeddings_p2

    except Exception as e:
        logger.error(f"Failed to load candidate embeddings: {e}")
        return torch.empty(0), torch.empty(0)
