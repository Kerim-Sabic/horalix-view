"""Prov-GigaPath runner that writes structured JSON output."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Iterable

import numpy as np
import pydicom
import torch
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from torchvision import transforms

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}


def _find_weight(base: Path, names: Iterable[str]) -> Path | None:
    for name in names:
        candidate = base / name
        if candidate.exists():
            return candidate
    for name in names:
        matches = list(base.rglob(name))
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


def _load_array_from_npz(npz_path: Path) -> np.ndarray:
    data = np.load(npz_path)
    if "array" not in data:
        raise RuntimeError("Input npz missing array key.")
    return data["array"]


def _load_input_image(
    input_dir: Path | None, input_file: Path | None, input_npz: Path | None, run_dir: Path
) -> list[str]:
    if input_dir and input_dir.exists():
        images = [
            str(path)
            for path in input_dir.iterdir()
            if path.suffix.lower() in IMAGE_EXTENSIONS
        ]
        if images:
            return images

    tiles_dir = run_dir / "tiles"
    tiles_dir.mkdir(parents=True, exist_ok=True)

    if input_file and input_file.exists():
        if input_file.suffix.lower() in IMAGE_EXTENSIONS:
            target = tiles_dir / "x0_y0.png"
            target.write_bytes(input_file.read_bytes())
            return [str(target)]
        ds = pydicom.dcmread(str(input_file))
        array = ds.pixel_array
        rgb = _array_to_rgb(array)
        target = tiles_dir / "x0_y0.png"
        Image.fromarray(rgb).save(target)
        return [str(target)]

    if input_npz and input_npz.exists():
        array = _load_array_from_npz(input_npz)
        rgb = _array_to_rgb(array)
        target = tiles_dir / "x0_y0.png"
        Image.fromarray(rgb).save(target)
        return [str(target)]

    raise RuntimeError("Prov-GigaPath requires an input image, DICOM, or npz array.")


class TileEncodingDataset(Dataset):
    def __init__(self, image_paths: list[str], transform: transforms.Compose) -> None:
        self.image_paths = image_paths
        self.transform = transform

    def __len__(self) -> int:
        return len(self.image_paths)

    def __getitem__(self, idx: int) -> dict[str, torch.Tensor]:
        img_path = self.image_paths[idx]
        img_name = Path(img_path).name
        coords = (0, 0)
        if "x" in img_name and "y" in img_name:
            try:
                base = img_name.split(".png")[0]
                x_val, y_val = base.split("_")
                coords = (int(x_val.replace("x", "")), int(y_val.replace("y", "")))
            except ValueError:
                coords = (0, 0)
        with open(img_path, "rb") as handle:
            img = Image.open(handle).convert("RGB")
        img_tensor = self.transform(img)
        return {
            "img": img_tensor,
            "coords": torch.tensor(coords, dtype=torch.float32),
        }


def _tile_transforms() -> transforms.Compose:
    return transforms.Compose(
        [
            transforms.Resize(256, interpolation=transforms.InterpolationMode.BICUBIC),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=(0.485, 0.456, 0.406),
                std=(0.229, 0.224, 0.225),
            ),
        ]
    )


def _run_tile_encoder(
    image_paths: list[str],
    tile_encoder: torch.nn.Module,
    batch_size: int,
    device: str,
) -> dict[str, torch.Tensor]:
    dataset = TileEncodingDataset(image_paths, transform=_tile_transforms())
    data_loader = DataLoader(dataset, batch_size=batch_size, shuffle=False)

    tile_encoder = tile_encoder.to(device)
    tile_encoder.eval()
    outputs = {"tile_embeds": [], "coords": []}

    with torch.no_grad():
        for batch in data_loader:
            images = batch["img"].float().to(device)
            embeds = tile_encoder(images)
            outputs["tile_embeds"].append(embeds.cpu())
            outputs["coords"].append(batch["coords"])

    return {key: torch.cat(values) for key, values in outputs.items()}


def _run_slide_encoder(
    slide_encoder: torch.nn.Module,
    tile_embeds: torch.Tensor,
    coords: torch.Tensor,
    device: str,
) -> dict[str, torch.Tensor]:
    if tile_embeds.ndim == 2:
        tile_embeds = tile_embeds.unsqueeze(0)
    if coords.ndim == 2:
        coords = coords.unsqueeze(0)

    slide_encoder = slide_encoder.to(device)
    slide_encoder.eval()
    with torch.no_grad():
        slide_embeds = slide_encoder(
            tile_embeds.to(device), coords.to(device), all_layer_embed=True
        )

    return {f"layer_{i}_embed": slide_embeds[i].cpu() for i in range(len(slide_embeds))}


def main() -> None:
    weights_path = Path(os.environ["HORALIX_WEIGHTS_PATH"])
    output_json = Path(os.environ["HORALIX_OUTPUT_JSON"])
    run_dir = Path(os.environ["HORALIX_RESULTS_DIR"])

    input_dir = Path(os.environ["HORALIX_INPUT_DIR"]) if os.environ.get("HORALIX_INPUT_DIR") else None
    input_file = Path(os.environ["HORALIX_INPUT_FILE"]) if os.environ.get("HORALIX_INPUT_FILE") else None
    input_npz = Path(os.environ["HORALIX_INPUT_NPZ"]) if os.environ.get("HORALIX_INPUT_NPZ") else None

    device_env = os.environ.get("HORALIX_DEVICE", "cuda")
    if device_env.startswith("cuda") and not torch.cuda.is_available():
        raise RuntimeError("CUDA requested but not available.")
    device = "cuda" if device_env.startswith("cuda") else "cpu"

    run_dir.mkdir(parents=True, exist_ok=True)
    image_paths = _load_input_image(input_dir, input_file, input_npz, run_dir)

    if str(weights_path) not in sys.path:
        sys.path.insert(0, str(weights_path))

    import timm  # type: ignore
    from gigapath import slide_encoder  # type: ignore

    tile_weights = _find_weight(
        weights_path,
        ["tile_encoder.pth", "tile_encoder.bin", "tile_encoder.pt", "tile_encoder.ckpt"],
    )
    slide_weights = _find_weight(
        weights_path,
        ["slide_encoder.pth", "slide_encoder.bin", "slide_encoder.pt", "slide_encoder.ckpt"],
    )

    tile_encoder = timm.create_model(
        "hf_hub:prov-gigapath/prov-gigapath",
        pretrained=False,
        checkpoint_path=str(tile_weights) if tile_weights else None,
    )
    slide_model = slide_encoder.create_model(
        str(slide_weights) if slide_weights else "",
        "gigapath_slide_enc12l768d",
        1536,
        global_pool=False,
    )

    tile_outputs = _run_tile_encoder(
        image_paths=image_paths,
        tile_encoder=tile_encoder,
        batch_size=16,
        device=device,
    )

    tile_path = run_dir / "gigapath_tile_embeddings.npz"
    np.savez_compressed(
        tile_path,
        tile_embeds=tile_outputs["tile_embeds"].numpy(),
        coords=tile_outputs["coords"].numpy(),
    )

    result_files: dict[str, str] = {"tile_embeddings": str(tile_path)}
    slide_summary: dict[str, list[int]] | None = None

    if slide_model is not None:
        slide_outputs = _run_slide_encoder(
            slide_encoder=slide_model,
            tile_embeds=tile_outputs["tile_embeds"],
            coords=tile_outputs["coords"],
            device=device,
        )
        slide_path = run_dir / "gigapath_slide_embeddings.npz"
        np.savez_compressed(
            slide_path,
            **{key: value.numpy() for key, value in slide_outputs.items()},
        )
        result_files["slide_embeddings"] = str(slide_path)
        slide_summary = {key: list(value.shape) for key, value in slide_outputs.items()}

    results = {
        "tile_count": int(tile_outputs["tile_embeds"].shape[0]),
        "tile_embedding_shape": list(tile_outputs["tile_embeds"].shape),
        "slide_embedding_shapes": slide_summary,
    }

    output_payload = {"results": results, "result_files": result_files}
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(output_payload))


if __name__ == "__main__":
    main()
