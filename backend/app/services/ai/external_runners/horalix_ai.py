"""Horalix AI external runner for PanEcho/EchoPrime/EchoNetDynamic/Measurements."""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

import numpy as np


def _load_payload() -> tuple[dict[str, Any], dict[str, Any]]:
    input_json = Path(os.environ["HORALIX_INPUT_JSON"])
    if not input_json.exists():
        return {}, {}
    payload = json.loads(input_json.read_text())
    if not isinstance(payload, dict):
        return {}, {}
    extra = payload.get("extra")
    return payload, extra if isinstance(extra, dict) else {}


def _write_output(output_json: Path, payload: dict[str, Any]) -> None:
    output_json.write_text(json.dumps(payload))


def _select_device(device_hint: str | None) -> "torch.device":
    import torch

    if not device_hint:
        device_hint = "cuda"
    device_hint = device_hint.strip().lower()
    if device_hint.startswith("cuda") and torch.cuda.is_available():
        return torch.device(device_hint)
    return torch.device("cpu")


def _resolve_study_dir(study_uid: str | None, input_file: Path | None) -> Path:
    if study_uid:
        try:
            from app.core.config import get_settings

            settings = get_settings()
            storage_dir = Path(settings.dicom.storage_dir)
            for patient_dir in storage_dir.iterdir():
                if patient_dir.name.startswith("."):
                    continue
                study_dir = patient_dir / study_uid
                if study_dir.exists():
                    return study_dir
        except Exception:
            pass

    if input_file:
        try:
            return input_file.parent.parent
        except Exception:
            pass

    raise RuntimeError("Study directory could not be resolved. Provide study_uid or input_file.")


# ---------------------- PanEcho ----------------------

def _pick_frames_from_dicom(dicom_path: Path, num_frames: int = 16) -> List["Image.Image"]:
    from PIL import Image
    import pydicom

    ds = pydicom.dcmread(str(dicom_path))
    arr = ds.pixel_array

    frames: List[np.ndarray] = []
    if arr.ndim == 2:
        frames = [arr]
    elif arr.ndim == 3:
        if arr.shape[-1] == 3:
            frames = [arr]
        else:
            frames = [arr[i] for i in range(arr.shape[0])]
    elif arr.ndim == 4:
        frames = [arr[i, :, :, 0] for i in range(arr.shape[0])]

    if not frames:
        return []

    total = len(frames)
    if total == 0:
        return []
    indices = [min(total - 1, max(0, math.floor(i * total / num_frames))) for i in range(num_frames)]

    images: List[Image.Image] = []
    for idx in indices:
        frame = frames[idx]
        if frame.ndim == 2:
            img = Image.fromarray(frame).convert("L").convert("RGB")
        else:
            img = Image.fromarray(frame)
            if img.mode != "RGB":
                img = img.convert("RGB")
        img = img.resize((224, 224), Image.BILINEAR)
        images.append(img)

    return images


def _stack_to_tensor(frames: List["Image.Image"]) -> "torch.Tensor":
    import torch

    arr = np.stack([np.asarray(f).astype(np.float32) / 255.0 for f in frames], axis=0)  # (T,H,W,C)
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)[None, None, None, :]
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)[None, None, None, :]
    arr = (arr - mean) / std
    arr = np.transpose(arr, (3, 0, 1, 2))  # (C,T,H,W)
    return torch.from_numpy(arr).unsqueeze(0)


def _convert_preds(preds_batch: dict[str, Any], batch_size: int, idx: int) -> Dict[str, Any]:
    import torch

    results: Dict[str, Any] = {}
    for task, val in preds_batch.items():
        if torch.is_tensor(val):
            slice_val = val[idx] if val.dim() > 0 and val.size(0) == batch_size else val
            if slice_val.numel() == 1:
                results[task] = float(slice_val.detach().cpu().item())
            else:
                results[task] = slice_val.detach().cpu().flatten().tolist()
        elif isinstance(val, (list, tuple)):
            results[task] = val[idx] if len(val) == batch_size else val
        else:
            try:
                results[task] = float(val)
            except Exception:
                results[task] = val
    return results


def _aggregate_predictions(all_preds: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not all_preds:
        return {}
    aggregated: Dict[str, Any] = {}
    tasks = all_preds[0].keys()
    for task in tasks:
        task_values = [p[task] for p in all_preds if task in p]
        if not task_values:
            continue
        if all(isinstance(value, (int, float)) for value in task_values):
            aggregated[task] = float(np.mean(task_values))
        elif all(isinstance(value, list) for value in task_values):
            arr = np.array(task_values, dtype=np.float32)
            aggregated[task] = arr.mean(axis=0).tolist()
        else:
            aggregated[task] = task_values[0]
    return aggregated


def _run_panecho(weights_root: Path, study_dir: Path, device: "torch.device") -> Dict[str, Any]:
    import torch

    model = torch.hub.load(str(weights_root / "PanEcho"), "PanEcho", source="local")
    model.to(device).eval()

    dicoms = sorted(study_dir.rglob("*.dcm"))
    if not dicoms:
        raise RuntimeError("No DICOM files found for PanEcho.")

    all_preds: List[Dict[str, Any]] = []
    batch_tensors: List["torch.Tensor"] = []
    valid_paths: List[str] = []
    batch_size = 4

    for dicom_path in dicoms:
        frames = _pick_frames_from_dicom(dicom_path, 16)
        if not frames:
            continue
        tensor = _stack_to_tensor(frames)
        batch_tensors.append(tensor)
        valid_paths.append(str(dicom_path))

        if len(batch_tensors) >= batch_size:
            batch = torch.cat(batch_tensors, dim=0).to(device)
            with torch.no_grad():
                preds_batch = model(batch)
            for idx in range(len(valid_paths)):
                all_preds.append(_convert_preds(preds_batch, len(valid_paths), idx))
            batch_tensors = []
            valid_paths = []

    if batch_tensors:
        batch = torch.cat(batch_tensors, dim=0).to(device)
        with torch.no_grad():
            preds_batch = model(batch)
        for idx in range(len(valid_paths)):
            all_preds.append(_convert_preds(preds_batch, len(valid_paths), idx))

    if not all_preds:
        raise RuntimeError("No PanEcho predictions produced.")

    aggregated = _aggregate_predictions(all_preds)
    return {
        "num_instances": len(all_preds),
        "predictions": aggregated,
    }


# ---------------------- EchoPrime ----------------------

def _run_echoprime(weights_root: Path, study_dir: Path) -> Dict[str, Any]:
    sys.path.insert(0, str(weights_root / "EchoPrime"))
    from echo_prime.model import EchoPrime

    ep = EchoPrime()
    stack_of_videos = ep.process_dicoms(str(study_dir))
    encoded = ep.encode_study(stack_of_videos, visualize=False)
    predictions = ep.predict_metrics(encoded)

    view_list, view_confidence_list = ep.get_views(
        stack_of_videos,
        visualize=False,
        return_view_list=True,
        return_scores=True,
    )

    dicom_paths = sorted(study_dir.rglob("*.dcm"))
    views: List[Dict[str, Any]] = []
    for idx, path in enumerate(dicom_paths[: len(view_list)]):
        view_label = view_list[idx]
        view_conf = float(view_confidence_list[idx]) if idx < len(view_confidence_list) else None
        views.append(
            {
                "dicom_path": str(path),
                "view": str(view_label).upper() if view_label else None,
                "confidence": view_conf,
            }
        )

    return {
        "num_instances": len(dicom_paths),
        "predictions": predictions,
        "views": views,
    }


# ---------------------- EchoNet Dynamic ----------------------

def _read_dicom_frames(dicom_path: Path, apply_mask: bool = True) -> Tuple[List[np.ndarray], float]:
    import cv2
    import pydicom

    ds = pydicom.dcmread(str(dicom_path), force=True)
    px = ds.pixel_array

    if px.ndim == 2:
        px = px[np.newaxis, ...]
    elif px.ndim == 4:
        px = px[..., 0]

    frames = []
    for i in range(px.shape[0]):
        gray = px[i].astype(np.float32)
        mn, mx = float(np.min(gray)), float(np.max(gray))
        if mx > mn:
            gray = (gray - mn) / (mx - mn) * 255.0
        else:
            gray = np.zeros_like(gray)
        gray = gray.astype(np.uint8)
        if apply_mask:
            dimension = gray.shape[0]
            m1, m2 = np.meshgrid(np.arange(dimension), np.arange(dimension))
            mask = ((m1 + m2) > int(dimension / 2) + int(dimension / 10))
            mask &= ((m1 - m2) < int(dimension / 2) + int(dimension / 10))
            mask = mask.astype(np.uint8)
            gray = cv2.bitwise_and(gray, gray, mask=mask)
        bgr = cv2.merge([gray, gray, gray])
        frames.append(bgr)

    cine_rate = getattr(ds, "CineRate", None)
    frame_time = getattr(ds, "FrameTime", None)
    if isinstance(cine_rate, (int, float)) and cine_rate > 0:
        fps = float(cine_rate)
    elif isinstance(frame_time, (int, float)) and frame_time > 0:
        fps = max(1.0, 1000.0 / float(frame_time))
    else:
        fps = 30.0

    return frames, float(fps)


def _ffmpeg_write_mp4_from_frames(
    frames: Iterable[np.ndarray],
    width: int,
    height: int,
    fps: float,
    output_path: str,
) -> str:
    import subprocess

    cmd = [
        "ffmpeg",
        "-y",
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "-s", f"{width}x{height}",
        "-r", str(fps),
        "-i", "-",
        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", "16",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_path,
    ]

    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    if not proc.stdin:
        raise RuntimeError("Failed to open ffmpeg stdin")

    for frame in frames:
        proc.stdin.write(frame.tobytes())
    proc.stdin.close()
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError("ffmpeg encoding failed")
    return output_path


def _load_echonet_dynamic_model(weights_root: Path, device: "torch.device") -> "torch.nn.Module":
    import torch
    import torchvision

    checkpoint_path = weights_root / "EchonetDynamic" / "output" / "segmentation" / "deeplabv3_resnet50_random" / "best.pt"
    if not checkpoint_path.exists():
        raise RuntimeError(f"EchoNetDynamic weights not found at {checkpoint_path}")

    model = torchvision.models.segmentation.deeplabv3_resnet50(weights=None)
    model.classifier[-1] = torch.nn.Conv2d(
        model.classifier[-1].in_channels,
        1,
        kernel_size=model.classifier[-1].kernel_size,
    )
    try:
        checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=True)
    except TypeError:
        checkpoint = torch.load(checkpoint_path, map_location=device)
    state_dict = checkpoint.get("state_dict", checkpoint)

    new_state_dict = {}
    for key, value in state_dict.items():
        name = key
        if name.startswith("module."):
            name = name[len("module.") :]
        if name.startswith("model."):
            name = name[len("model.") :]
        new_state_dict[name] = value

    model.load_state_dict(new_state_dict, strict=False)
    model.to(device).eval()
    return model


def _run_echonet_dynamic(weights_root: Path, input_file: Path, device: "torch.device", output_path: Path) -> Dict[str, Any]:
    import cv2
    import torch
    from torchvision.transforms import functional as F

    frames, fps = _read_dicom_frames(input_file, apply_mask=True)
    if not frames:
        raise RuntimeError("No frames available for EchoNetDynamic inference")

    frame_size = (frames[0].shape[1], frames[0].shape[0])
    model = _load_echonet_dynamic_model(weights_root, device)

    batch_size = 8
    output_frames: List[np.ndarray] = []

    for batch_start in range(0, len(frames), batch_size):
        batch_frames = frames[batch_start : batch_start + batch_size]
        tensors = []
        for frame in batch_frames:
            img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            resized = cv2.resize(img_rgb, (112, 112), interpolation=cv2.INTER_LINEAR)
            tensors.append(F.to_tensor(resized))

        batch_tensor = torch.stack(tensors).to(device)
        with torch.no_grad():
            outputs = model(batch_tensor)["out"][:, 0]

        for local_idx, output in enumerate(outputs):
            frame = batch_frames[local_idx]
            mask_small = (torch.sigmoid(output) > 0.5).cpu().numpy().astype(np.uint8)
            mask_resized = cv2.resize(mask_small, frame_size, interpolation=cv2.INTER_NEAREST)

            mask_binary = (mask_resized > 0).astype(np.uint8)
            mask_smooth = cv2.GaussianBlur(mask_binary * 255, (7, 7), 0)
            _, mask_binary = cv2.threshold(mask_smooth, 127, 1, cv2.THRESH_BINARY)
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            mask_binary = cv2.morphologyEx(mask_binary, cv2.MORPH_OPEN, kernel, iterations=1)
            mask_binary = cv2.morphologyEx(mask_binary, cv2.MORPH_CLOSE, kernel, iterations=1)

            contours, _ = cv2.findContours(mask_binary.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            overlay = frame.copy()
            cv2.drawContours(overlay, contours, -1, (0, 255, 0), thickness=2)
            output_frames.append(overlay)

    _ffmpeg_write_mp4_from_frames(output_frames, frame_size[0], frame_size[1], fps, str(output_path))

    return {
        "frame_count": len(output_frames),
        "fps": fps,
        "output_file": str(output_path),
    }


# ---------------------- Measurements 2D ----------------------

def _convert_to_mp4(input_path: Path) -> Path:
    output_path = input_path.with_suffix(".mp4")
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-an",
        "-movflags",
        "+faststart",
        str(output_path),
    ]
    subprocess.run(cmd, check=True)
    return output_path


def _run_measurements_2d(weights_root: Path, input_file: Path, model_weights: str, output_dir: Path) -> Dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_avi = output_dir / f"measurements_{model_weights}.avi"

    cmd = [
        sys.executable,
        "inference_2D_image.py",
        "--model_weights",
        model_weights,
        "--file_path",
        str(input_file),
        "--output_path",
        str(output_avi),
    ]

    subprocess.run(cmd, cwd=str(weights_root / "measurements"), check=True)

    output_csv = output_avi.with_suffix(".csv")
    min_len_cm = None
    max_len_cm = None
    if output_csv.exists():
        import pandas as pd

        df = pd.read_csv(output_csv)
        if "length_cm" in df.columns:
            vals = pd.to_numeric(df["length_cm"], errors="coerce").dropna()
            if not vals.empty:
                min_len_cm = float(vals.min())
                max_len_cm = float(vals.max())

    output_mp4 = _convert_to_mp4(output_avi)

    return {
        "output_file": str(output_mp4),
        "min_length_cm": min_len_cm,
        "max_length_cm": max_len_cm,
        "model_weights": model_weights,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    args = parser.parse_args()

    output_json = Path(os.environ["HORALIX_OUTPUT_JSON"])
    weights_root = Path(os.environ["HORALIX_WEIGHTS_PATH"])
    device_hint = os.environ.get("HORALIX_DEVICE")
    input_file_raw = os.environ.get("HORALIX_INPUT_FILE")
    input_file = Path(input_file_raw) if input_file_raw else None

    payload, extra = _load_payload()
    study_uid = extra.get("study_uid") or payload.get("metadata", {}).get("study_uid")

    model_name = args.model
    if model_name.startswith("horalix_ai_"):
        model_key = model_name[len("horalix_ai_") :]
    else:
        model_key = model_name

    device = _select_device(device_hint)

    result_files: Dict[str, str] = {}
    results: Dict[str, Any]

    if model_key in {"panecho", "panecho_alltasks", "panecho_all"}:
        study_dir = _resolve_study_dir(study_uid, input_file)
        results = _run_panecho(weights_root, study_dir, device)
    elif model_key in {"echoprime", "echo_prime"}:
        study_dir = _resolve_study_dir(study_uid, input_file)
        results = _run_echoprime(weights_root, study_dir)
    elif model_key in {"echonet_dynamic", "echonet-dynamic", "echonet_dynamic_lv"}:
        if not input_file or not input_file.exists():
            raise RuntimeError("EchoNetDynamic requires HORALIX_INPUT_FILE")
        run_dir = Path(os.environ["HORALIX_RESULTS_DIR"])
        output_path = run_dir / f"echonet_dynamic_{int(time.time())}.mp4"
        results = _run_echonet_dynamic(weights_root, input_file, device, output_path)
        result_files["video"] = str(output_path)
    elif model_key in {"measurements", "measurements_2d", "echonet_measurements"}:
        if not input_file or not input_file.exists():
            raise RuntimeError("Measurements 2D requires HORALIX_INPUT_FILE")
        model_weights = (extra.get("model_weights") or extra.get("measurement") or "lvid").lower()
        results = _run_measurements_2d(weights_root, input_file, model_weights, Path(os.environ["HORALIX_RESULTS_DIR"]))
        result_files["video"] = results.get("output_file") or ""
    else:
        raise RuntimeError(f"Unsupported Horalix AI model: {model_name}")

    payload = {
        "results": results,
        "result_files": result_files,
    }
    _write_output(output_json, payload)


if __name__ == "__main__":
    main()
