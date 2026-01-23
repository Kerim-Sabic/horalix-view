"""HoVer-Net runner that writes structured JSON output."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Iterable

import numpy as np
import pydicom
from PIL import Image

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}


def _find_checkpoint(base: Path, patterns: Iterable[str]) -> Path | None:
    if base.is_file():
        return base
    for pattern in patterns:
        matches = list(base.rglob(pattern))
        if matches:
            return matches[0]
    return None


def _normalize_to_uint8(array: np.ndarray) -> np.ndarray:
    data = array.astype(np.float32)
    min_val = float(np.nanmin(data))
    max_val = float(np.nanmax(data))
    if max_val - min_val < 1e-6:
        return np.zeros_like(data, dtype=np.uint8)
    data = (data - min_val) / (max_val - min_val)
    data = (data * 255.0).clip(0, 255)
    return data.astype(np.uint8)


def _array_to_rgb(array: np.ndarray) -> np.ndarray:
    if array.ndim == 3 and array.shape[-1] in (3, 4):
        rgb = array[..., :3]
        return _normalize_to_uint8(rgb)
    if array.ndim >= 3:
        array = array[array.shape[0] // 2]
    gray = _normalize_to_uint8(array)
    return np.repeat(gray[..., None], 3, axis=-1)


def _ensure_input_dir(
    input_dir: Path | None, input_file: Path | None, input_npz: Path | None, run_dir: Path
) -> Path:
    if input_dir and input_dir.exists():
        has_images = any(path.suffix.lower() in IMAGE_EXTENSIONS for path in input_dir.iterdir())
        if has_images:
            return input_dir

    tiles_dir = run_dir / "tiles"
    tiles_dir.mkdir(parents=True, exist_ok=True)

    if input_file and input_file.exists():
        if input_file.suffix.lower() in IMAGE_EXTENSIONS:
            target = tiles_dir / "tile_0000.png"
            target.write_bytes(input_file.read_bytes())
            return tiles_dir
        ds = pydicom.dcmread(str(input_file))
        rgb = _array_to_rgb(ds.pixel_array)
        Image.fromarray(rgb).save(tiles_dir / "tile_0000.png")
        return tiles_dir

    if input_npz and input_npz.exists():
        data = np.load(input_npz)
        if "array" not in data:
            raise RuntimeError("Input npz missing array key.")
        rgb = _array_to_rgb(data["array"])
        Image.fromarray(rgb).save(tiles_dir / "tile_0000.png")
        return tiles_dir

    raise RuntimeError("HoVer-Net requires input images or a DICOM/npz array.")


def _resolve_gpu(device: str) -> str:
    if device.startswith("cuda"):
        parts = device.split(":")
        return parts[1] if len(parts) > 1 else "0"
    raise RuntimeError("HoVer-Net inference requires CUDA.")


def main() -> None:
    weights_path = Path(os.environ["HORALIX_WEIGHTS_PATH"])
    output_json = Path(os.environ["HORALIX_OUTPUT_JSON"])
    run_dir = Path(os.environ["HORALIX_RESULTS_DIR"])

    input_dir = Path(os.environ["HORALIX_INPUT_DIR"]) if os.environ.get("HORALIX_INPUT_DIR") else None
    input_file = Path(os.environ["HORALIX_INPUT_FILE"]) if os.environ.get("HORALIX_INPUT_FILE") else None
    input_npz = Path(os.environ["HORALIX_INPUT_NPZ"]) if os.environ.get("HORALIX_INPUT_NPZ") else None

    device_env = os.environ.get("HORALIX_DEVICE", "cuda")
    gpu_id = _resolve_gpu(device_env)

    run_dir.mkdir(parents=True, exist_ok=True)
    input_dir = _ensure_input_dir(input_dir, input_file, input_npz, run_dir)

    checkpoint = _find_checkpoint(
        weights_path,
        ["*.pth", "*.pt", "*.ckpt", "*.tar", "*.tar.gz"],
    )
    if checkpoint is None:
        raise RuntimeError("HoVer-Net checkpoint not found.")

    output_dir = run_dir / "hovernet_output"
    output_dir.mkdir(parents=True, exist_ok=True)

    command = [
        sys.executable,
        "run_infer.py",
        "--gpu",
        gpu_id,
        "--model_mode",
        "fast",
        "--model_path",
        str(checkpoint),
        "tile",
        "--input_dir",
        str(input_dir),
        "--output_dir",
        str(output_dir),
    ]

    subprocess.run(
        command,
        cwd=str(weights_path),
        env=os.environ.copy(),
        check=True,
        capture_output=True,
        text=True,
    )

    json_dir = output_dir / "json"
    overlay_dir = output_dir / "overlay"
    json_count = len(list(json_dir.glob("*.json"))) if json_dir.exists() else 0

    results = {
        "tile_count": int(json_count),
        "output_dir": str(output_dir),
    }

    output_payload = {
        "results": results,
        "result_files": {
            "json_dir": str(json_dir),
            "overlay_dir": str(overlay_dir),
        },
    }

    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(output_payload))


if __name__ == "__main__":
    main()
