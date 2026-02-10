#!/usr/bin/env python3
"""
Horalix AI Setup Validation Script

Validates that all model weights and configuration are correctly set up
before deploying with Docker.

Usage:
    python scripts/validate_horalix_ai_setup.py
"""

import os
import sys
from pathlib import Path
from typing import List, Tuple

# Color codes for terminal output
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
RESET = "\033[0m"


def print_header(text: str):
    """Print section header."""
    print(f"\n{BLUE}{'=' * 70}{RESET}")
    print(f"{BLUE}{text:^70}{RESET}")
    print(f"{BLUE}{'=' * 70}{RESET}\n")


def print_success(text: str):
    """Print success message."""
    print(f"{GREEN}[OK] {text}{RESET}")


def print_error(text: str):
    """Print error message."""
    print(f"{RED}[X] {text}{RESET}")


def print_warning(text: str):
    """Print warning message."""
    print(f"{YELLOW}[!] {text}{RESET}")


def print_info(text: str):
    """Print info message."""
    print(f"  {text}")


def check_file_exists(file_path: Path, description: str) -> bool:
    """Check if a file exists."""
    if file_path.exists() and file_path.is_file():
        size_mb = file_path.stat().st_size / (1024 * 1024)
        print_success(f"{description}: {file_path.name} ({size_mb:.1f} MB)")
        return True
    else:
        print_error(f"{description}: NOT FOUND at {file_path}")
        return False


def check_directory_exists(dir_path: Path, description: str) -> bool:
    """Check if a directory exists."""
    if dir_path.exists() and dir_path.is_dir():
        print_success(f"{description}: {dir_path}")
        return True
    else:
        print_error(f"{description}: NOT FOUND at {dir_path}")
        return False


def resolve_weights_root(path_value: str) -> Path:
    """
    Resolve HORALIX_AI_MODELS_HOST_PATH from .env.

    Docker compose resolves relative bind-mount sources from the compose file
    location (`docker/`). Local scripts resolve from repo root, so support both.
    """
    raw = Path(path_value.strip())
    candidates = [raw]

    if not raw.is_absolute():
        candidates.append((Path("docker") / raw).resolve())

    for candidate in candidates:
        if candidate.exists():
            return candidate

    return candidates[0]


def validate_weights_structure(weights_root: Path) -> Tuple[bool, List[str]]:
    """
    Validate the complete weights directory structure.

    Returns:
        Tuple of (all_valid, list_of_errors)
    """
    errors = []
    all_valid = True

    print_header("Validating Model Weights Structure")

    # Check root directory
    if not weights_root.exists():
        print_error(f"Weights root directory not found: {weights_root}")
        print_info("Expected a folder containing: PanEcho/, EchoPrime/, measurements/, EchonetDynamic/")
        return False, ["Weights root directory not found"]

    print_info(f"Weights root: {weights_root}")

    # PanEcho
    print("\n[1/4] PanEcho")
    panecho_dir = weights_root / "PanEcho"
    panecho_weights = panecho_dir / "weights" / "panecho.pt"
    panecho_hubconf = panecho_dir / "hubconf.py"

    if not check_directory_exists(panecho_dir, "PanEcho directory"):
        errors.append("PanEcho directory not found")
        all_valid = False

    if not check_file_exists(panecho_weights, "PanEcho weights"):
        errors.append("PanEcho weights not found")
        all_valid = False

    if not check_file_exists(panecho_hubconf, "PanEcho hubconf.py"):
        errors.append("PanEcho hubconf.py not found")
        all_valid = False

    # EchoPrime
    print("\n[2/4] EchoPrime")
    echoprime_dir = weights_root / "EchoPrime"
    echoprime_encoder = echoprime_dir / "model_data" / "weights" / "echo_prime_encoder.pt"
    echoprime_text_encoder = echoprime_dir / "model_data" / "weights" / "echo_prime_text_encoder.pt"
    view_classifier = echoprime_dir / "model_data" / "weights" / "view_classifier.pt"

    if not check_directory_exists(echoprime_dir, "EchoPrime directory"):
        errors.append("EchoPrime directory not found")
        all_valid = False

    if not check_file_exists(echoprime_encoder, "EchoPrime video encoder"):
        errors.append("EchoPrime encoder not found")
        all_valid = False

    if not check_file_exists(echoprime_text_encoder, "EchoPrime text encoder"):
        errors.append("EchoPrime text encoder not found")
        all_valid = False

    if not check_file_exists(view_classifier, "View classifier"):
        errors.append("View classifier not found")
        all_valid = False

    # Measurements
    print("\n[3/4] Measurements (9 models)")
    measurements_dir = weights_root / "measurements"
    measurements_2d_dir = measurements_dir / "weights" / "2D_models"

    if not check_directory_exists(measurements_dir, "Measurements directory"):
        errors.append("Measurements directory not found")
        all_valid = False

    if not check_directory_exists(measurements_2d_dir, "Measurements 2D models directory"):
        errors.append("Measurements 2D models directory not found")
        all_valid = False

    measurement_models = [
        "ivs_weights.ckpt",
        "lvid_weights.ckpt",
        "lvpw_weights.ckpt",
        "aorta_weights.ckpt",
        "aortic_root_weights.ckpt",
        "la_weights.ckpt",
        "rv_base_weights.ckpt",
        "pa_weights.ckpt",
        "ivc_weights.ckpt",
    ]

    for i, model_name in enumerate(measurement_models, 1):
        model_path = measurements_2d_dir / model_name
        if not check_file_exists(model_path, f"  [{i}/9] {model_name.replace('_weights.ckpt', '').upper()}"):
            errors.append(f"Measurement model {model_name} not found")
            all_valid = False

    # EchoNet-Dynamic
    print("\n[4/4] EchoNet-Dynamic")
    echonet_dir = weights_root / "EchonetDynamic"
    echonet_weights = echonet_dir / "output" / "segmentation" / "deeplabv3_resnet50_random" / "best.pt"

    if not check_directory_exists(echonet_dir, "EchoNet-Dynamic directory"):
        errors.append("EchoNet-Dynamic directory not found")
        all_valid = False

    if not check_file_exists(echonet_weights, "EchoNet-Dynamic weights"):
        errors.append("EchoNet-Dynamic weights not found")
        all_valid = False

    return all_valid, errors


def validate_docker_config() -> Tuple[bool, List[str]]:
    """Validate Docker configuration."""
    errors = []
    all_valid = True

    print_header("Validating Docker Configuration")

    # Check docker-compose.yml
    docker_compose = Path("docker/docker-compose.yml")
    if not check_file_exists(docker_compose, "docker-compose.yml"):
        errors.append("docker-compose.yml not found")
        all_valid = False
    else:
        # Check for worker services
        with open(docker_compose, "r") as f:
            content = f.read()

        if "horalix-ai-worker-0:" in content:
            print_success("Worker 0 service found in docker-compose.yml")
        else:
            print_error("Worker 0 service not found in docker-compose.yml")
            errors.append("Worker 0 service missing")
            all_valid = False

        if "horalix-ai-worker-1:" in content:
            if 'profiles: ["gpu"]' in content or "profiles: ['gpu']" in content:
                print_success("Worker 1 service found (GPU profile)")
            else:
                print_warning("Worker 1 service found but not gated behind a GPU profile")
        else:
            print_warning("Worker 1 service not found (dual-GPU profile disabled)")

        # Accept either a named job-queue volume or a bind mount path.
        if (
            "horalix-ai-job-queue:" in content
            or "/app/job_queue" in content
            or "AI_HORALIX_AI_JOB_QUEUE_DIR=/app/job_queue" in content
        ):
            print_success("Job queue configuration found in docker-compose.yml")
        else:
            print_error("Job queue configuration not found in docker-compose.yml")
            errors.append("Job queue configuration missing")
            all_valid = False

    # Check ./.env file
    env_file = Path(".env")
    if not env_file.exists():
        print_warning("./.env file not found - using ./.env.example as reference")
        env_file = Path(".env.example")

    if env_file.exists():
        with open(env_file, "r") as f:
            env_content = f.read()

        if "HORALIX_AI_MODELS_HOST_PATH=" in env_content:
            print_success("./.env contains HORALIX_AI_MODELS_HOST_PATH")
        else:
            print_warning("./.env missing HORALIX_AI_MODELS_HOST_PATH")

        if "WORKER_0_GPU_COUNT=" in env_content:
            print_success("./.env contains WORKER_0_GPU_COUNT")
        else:
            print_warning("./.env missing WORKER_0_GPU_COUNT (CPU/GPU mode switching may break)")

        if "AI_HORALIX_AI_PRELOAD=true" in env_content:
            print_success("./.env has preload enabled")
        else:
            print_info("Note: AI_HORALIX_AI_PRELOAD not set to true (models will load on-demand)")

    return all_valid, errors


def validate_python_environment():
    """Validate Python environment and dependencies."""
    print_header("Validating Python Environment")

    print_info(f"Python version: {sys.version}")

    try:
        import torch
        print_success(f"PyTorch: {torch.__version__}")

        if torch.cuda.is_available():
            print_success(f"CUDA available: {torch.cuda.device_count()} GPU(s)")
            for i in range(torch.cuda.device_count()):
                gpu_name = torch.cuda.get_device_name(i)
                gpu_memory = torch.cuda.get_device_properties(i).total_memory / (1024**3)
                print_info(f"  GPU {i}: {gpu_name} ({gpu_memory:.1f} GB)")
        else:
            print_warning("CUDA not available (will run on CPU)")

    except ImportError:
        print_warning("PyTorch not installed (required in Docker, not locally)")

    try:
        import pydicom
        print_success(f"pydicom: {pydicom.__version__}")
    except ImportError:
        print_warning("pydicom not installed")

    try:
        import cv2
        print_success(f"OpenCV: {cv2.__version__}")
    except ImportError:
        print_warning("OpenCV not installed")


def generate_setup_commands(weights_root: Path):
    """Generate setup commands."""
    print_header("Setup Commands")

    print_info("1. Copy .env.example to ./.env:")
    print(f"   {YELLOW}copy .env.example .env{RESET}")

    print_info("\n2. Edit ./.env and set HORALIX_AI_MODELS_HOST_PATH:")
    print(f"   {YELLOW}HORALIX_AI_MODELS_HOST_PATH={weights_root}{RESET}")
    print_info("   Then set runtime mode in ./.env:")
    print(
        f"   {YELLOW}CPU: AI_DEVICE=cpu, TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu, "
        f"WORKER_0_GPU_COUNT=0, AI_HORALIX_AI_NUM_WORKERS=1{RESET}"
    )
    print(
        f"   {YELLOW}Single GPU: AI_DEVICE=cuda:0, TORCH_INDEX_URL=https://download.pytorch.org/whl/cu124, "
        f"CUDA_VISIBLE_DEVICES=0, WORKER_0_GPU_COUNT=1, AI_HORALIX_AI_NUM_WORKERS=1{RESET}"
    )
    print(
        f"   {YELLOW}Dual GPU: AI_DEVICE=cuda:0, TORCH_INDEX_URL=https://download.pytorch.org/whl/cu124, "
        f"CUDA_VISIBLE_DEVICES=0,1, WORKER_0_GPU_COUNT=1, AI_HORALIX_AI_NUM_WORKERS=2{RESET}"
    )

    print_info("\n3. Start Docker services (from repo root):")
    print("   CPU:")
    print(
        "   "
        f"{YELLOW}docker compose --env-file ./.env -f docker/docker-compose.yml up -d --build{RESET}"
    )
    print("   Single GPU:")
    print(
        "   "
        f"{YELLOW}docker compose --env-file ./.env -f docker/docker-compose.yml up -d --build{RESET}"
    )
    print("   Dual GPU:")
    print(
        "   "
        f"{YELLOW}docker compose --env-file ./.env -f docker/docker-compose.yml --profile gpu up -d --build"
        f"{RESET}"
    )

    print_info("\n4. Watch worker logs:")
    print(
        "   "
        f"{YELLOW}docker compose --env-file ./.env -f docker/docker-compose.yml logs -f "
        "horalix-ai-worker-0"
        f"{RESET}"
    )
    print("   Dual-GPU logs:")
    print(
        "   "
        f"{YELLOW}docker compose --env-file ./.env -f docker/docker-compose.yml --profile gpu logs -f "
        "horalix-ai-worker-0 horalix-ai-worker-1"
        f"{RESET}"
    )

    print_info("\n5. Verify models loaded:")
    print(f"   {YELLOW}curl http://localhost:8000/api/v1/ai/models{RESET}")


def main():
    """Main validation function."""
    print_header("Horalix AI Setup Validation")

    # Determine weights root
    default_weights_root = Path("models/horalix_ai")

    # Check .env for custom path
    env_file = Path(".env")
    if env_file.exists():
        with open(env_file, "r") as f:
            for line in f:
                if line.startswith("HORALIX_AI_MODELS_HOST_PATH="):
                    custom_path = line.split("=", 1)[1].strip()
                    default_weights_root = resolve_weights_root(custom_path)
                    break

    print_info(f"Using weights root: {default_weights_root}")

    # Validate weights
    weights_valid, weights_errors = validate_weights_structure(default_weights_root)

    # Validate Docker config
    docker_valid, docker_errors = validate_docker_config()

    # Validate Python environment (optional)
    validate_python_environment()

    # Generate setup commands
    generate_setup_commands(default_weights_root)

    # Final summary
    print_header("Validation Summary")

    all_errors = weights_errors + docker_errors

    if not all_errors:
        print_success("All validations passed!")
        print_success("Ready to deploy with Docker")
        print_info("\nNext steps:")
        print_info("  1. Ensure Docker Desktop is running")
        print_info(
            "  2. CPU or single-GPU start: docker compose --env-file ./.env -f "
            "docker/docker-compose.yml up -d --build"
        )
        print_info(
            "     Dual-GPU start: docker compose --env-file ./.env -f "
            "docker/docker-compose.yml --profile gpu up -d --build"
        )
        print_info("  3. Wait ~35 seconds for model loading on GPU (longer on CPU)")
        print_info("  4. Access frontend: http://localhost:3000")
        return 0
    else:
        print_error(f"\nFound {len(all_errors)} error(s):")
        for i, error in enumerate(all_errors, 1):
            print_error(f"  {i}. {error}")

        print_warning("\nPlease fix these issues before deploying.")
        return 1


if __name__ == "__main__":
    sys.exit(main())

