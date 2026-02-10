import logging
import os
import time
from datetime import datetime
from typing import Tuple, List, Dict, Optional

import cv2
import numpy as np
import torch
from torchvision.models.segmentation import deeplabv3_resnet50

from app.helpers.AVI_to_MP4_converter import ffmpeg_write_mp4_from_frames
from app.helpers.batch_config import get_batch_size
from app.core.config import settings

try:
    import pydicom
    from pydicom.pixel_data_handlers.util import convert_color_space
except Exception:  # pragma: no cover
    pydicom = None
    convert_color_space = None


# Cache for loaded models per weight key
_loaded_models: Dict[str, torch.nn.Module] = {}
_device: Optional[torch.device] = None

logger = logging.getLogger(__name__)


VALID_2D_WEIGHTS = {
    "ivs",
    "lvid",
    "lvpw",
    "aorta",
    "aortic_root",
    "la",
    "rv_base",
    "pa",
    "ivc",
}


def get_device() -> torch.device:
    global _device
    if _device is None:
        _device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    return _device


def _segmentation_to_coordinates(logits: torch.Tensor, order: str = "XY") -> torch.Tensor:
    # logits: (N, 2, H, W) after sigmoid/threshold
    h, w = logits.shape[-2], logits.shape[-1]
    rows = torch.arange(h, device=logits.device)[None, None, :, None]
    cols = torch.arange(w, device=logits.device)[None, None, None, :]

    # weighted centroids per channel
    denom = logits.sum(dim=(-2, -1), keepdim=True) + 1e-8
    y = (rows * logits).sum(dim=(-2, -1)) / denom.squeeze(-1).squeeze(-1)
    x = (cols * logits).sum(dim=(-2, -1)) / denom.squeeze(-1).squeeze(-1)
    if order.upper() == "XY":
        coords = torch.stack([x, y], dim=-1)  # (N, 2, 2)
    else:
        coords = torch.stack([y, x], dim=-1)
    return coords


def _ensure_three_channel(frame: np.ndarray) -> np.ndarray:
    # frame could be HxW (mono) or HxWx1; ensure HxWx3 in uint8
    if frame.ndim == 2:
        frame = np.stack([frame, frame, frame], axis=-1)
    elif frame.ndim == 3 and frame.shape[-1] == 1:
        frame = np.repeat(frame, 3, axis=-1)
    return frame


def _read_avi_frames(path: str) -> Tuple[np.ndarray, float]:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise ValueError(f"Could not open input video: {path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames: List[np.ndarray] = []
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frames.append(frame)
    cap.release()
    if not frames:
        raise ValueError("No frames read from video")
    # keep as BGR; drawing will use BGR
    return np.asarray(frames), float(fps)


def _read_dicom_frames(path: str) -> Tuple[np.ndarray, float]:
    if pydicom is None:
        raise RuntimeError("pydicom is required to read DICOM inputs.")
    ds = pydicom.dcmread(path)
    arr = ds.pixel_array  # shape: (F, H, W) or (F, H, W, C)
    frames: List[np.ndarray] = []

    # Some DICOMs may store YBR_FULL_422; convert to RGB if so
    photometric = getattr(ds, "PhotometricInterpretation", None)
    for f in (arr if arr.ndim == 4 else arr[:, :, :]):  # iterate frames
        frame = f
        frame = _ensure_three_channel(frame)
        if photometric == "YBR_FULL_422" and convert_color_space is not None:
            try:
                frame = convert_color_space(frame, current="YBR_FULL_422", desired="RGB")
            except Exception:
                # Fallback: keep as-is if conversion fails
                pass
        # resize to model expected size (640x480)
        frame = cv2.resize(frame, (640, 480), interpolation=cv2.INTER_LINEAR)
        # convert to BGR for drawing/writing consistency
        if frame.shape[-1] == 3:
            frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
        frames.append(frame)

    if not frames:
        raise ValueError("No frames extracted from DICOM")
    # No reliable FPS in many echo DICOMs; default to 30
    return np.asarray(frames), 30.0


def _extract_dicom_scale(path: str) -> Optional[Dict[str, float]]:
    """
    Extract per-pixel physical spacing (in cm/pixel) for X and Y from DICOM Ultrasound Region tags
    or PixelSpacing fallback, plus original image size to compute resize ratios.
    Returns dict with keys: conv_x_cm, conv_y_cm, ratio_w, ratio_h. None if unavailable.
    """
    if pydicom is None:
        return None
    try:
        ds = pydicom.dcmread(path)
        arr = ds.pixel_array
        # Determine original width/height
        orig_h = None
        orig_w = None
        try:
            if arr.ndim == 4:
                orig_h, orig_w = int(arr.shape[1]), int(arr.shape[2])
            elif arr.ndim == 3:
                # Heuristics for cine vs still
                if getattr(ds, 'NumberOfFrames', 1) and arr.shape[0] > 5 and arr.shape[-1] != 3:
                    # (F,H,W)
                    orig_h, orig_w = int(arr.shape[1]), int(arr.shape[2])
                elif arr.shape[-1] == 3:
                    # (H,W,3)
                    orig_h, orig_w = int(arr.shape[0]), int(arr.shape[1])
                else:
                    # Assume (F,H,W)
                    orig_h, orig_w = int(arr.shape[1]), int(arr.shape[2])
            else:
                return None
        except Exception:
            return None

        conv_x_cm = None
        conv_y_cm = None

        # Try Ultrasound Region tags
        ULTRASOUND_REGIONS_TAG = (0x0018, 0x6011)
        REGION_X0_SUBTAG = (0x0018, 0x6018)
        REGION_Y0_SUBTAG = (0x0018, 0x601A)
        REGION_X1_SUBTAG = (0x0018, 0x601C)
        REGION_Y1_SUBTAG = (0x0018, 0x601E)
        REGION_PHYSICAL_DELTA_X_SUBTAG = (0x0018, 0x602C)
        REGION_PHYSICAL_DELTA_Y_SUBTAG = (0x0018, 0x602E)

        if ULTRASOUND_REGIONS_TAG in ds:
            regions = ds[ULTRASOUND_REGIONS_TAG].value
            regions_with_coords = []
            for region in regions:
                coords = []
                for tag in [REGION_X0_SUBTAG, REGION_Y0_SUBTAG, REGION_X1_SUBTAG, REGION_Y1_SUBTAG]:
                    coords.append(region[tag].value if tag in region else None)
                if all(c is not None for c in coords):
                    regions_with_coords.append((region, coords))
            if regions_with_coords:
                # Choose lowest region by Y0
                regions_with_coords.sort(key=lambda x: x[1][1], reverse=True)
                region = regions_with_coords[0][0]
                if REGION_PHYSICAL_DELTA_X_SUBTAG in region:
                    conv_x_cm = abs(float(region[REGION_PHYSICAL_DELTA_X_SUBTAG].value))
                if REGION_PHYSICAL_DELTA_Y_SUBTAG in region:
                    conv_y_cm = abs(float(region[REGION_PHYSICAL_DELTA_Y_SUBTAG].value))

        # Fallback to PixelSpacing (mm/pixel)
        if (conv_x_cm is None or conv_y_cm is None) and (0x0028, 0x0030) in ds:
            px_spacing = ds[(0x0028, 0x0030)].value  # [row_spacing_mm, col_spacing_mm]
            try:
                row_mm, col_mm = float(px_spacing[0]), float(px_spacing[1])
                # Convert to cm/pixel
                conv_y_cm = conv_y_cm or (row_mm / 10.0)
                conv_x_cm = conv_x_cm or (col_mm / 10.0)
            except Exception:
                pass

        if conv_x_cm is None or conv_y_cm is None:
            return None

        ratio_w = float(orig_w) / 640.0
        ratio_h = float(orig_h) / 480.0
        return {"conv_x_cm": conv_x_cm, "conv_y_cm": conv_y_cm, "ratio_w": ratio_w, "ratio_h": ratio_h}
    except Exception:
        return None


def _load_model(model_key: str) -> torch.nn.Module:
    if model_key not in VALID_2D_WEIGHTS:
        raise ValueError(f"Invalid model_weights '{model_key}'.")
    if model_key in _loaded_models:
        return _loaded_models[model_key]

    base_dir = os.path.dirname(os.path.abspath(__file__))
    weights_path = os.path.join(base_dir, "weights", "2D_models", f"{model_key}_weights.ckpt")
    if not os.path.exists(weights_path):
        raise FileNotFoundError(f"Weights not found: {weights_path}")

    device = get_device()
    try:
        state = torch.load(weights_path, map_location=device, weights_only=True)
    except TypeError:
        state = torch.load(weights_path, map_location=device)
    # Remove possible 'm.' prefix
    state = {k.replace("m.", ""): v for k, v in state.items()}

    start = time.time()
    model = deeplabv3_resnet50(num_classes=2)
    model.load_state_dict(state)
    model.to(device)
    model.eval()
    _loaded_models[model_key] = model
    logger.info("[Measurements2D] Loaded model '%s' on %s in %.1fs", model_key, device, time.time() - start)
    return model


def run_2d_inference(model_weights: str, input_path: str, output_dir: str) -> Tuple[str, str]:
    """
    Runs 2D frame-to-frame inference on AVI or DICOM input and saves an annotated AVI and CSV.

    Returns (output_avi_path, output_csv_path)
    """
    os.makedirs(output_dir, exist_ok=True)
    ext = os.path.splitext(input_path)[1].lower()
    if ext not in {".avi", ".dcm"}:
        raise ValueError("Only .avi or .dcm inputs are supported")

    # Read frames (BGR) and fps
    if ext == ".avi":
        frames_bgr, fps = _read_avi_frames(input_path)
        height, width = frames_bgr[0].shape[:2]
        # resize frames to 640x480 for the model
        frames_for_model = np.stack([cv2.resize(f, (640, 480)) for f in frames_bgr], axis=0)
    else:  # DICOM
        frames_bgr, fps = _read_dicom_frames(input_path)
        height, width = frames_bgr[0].shape[:2]
        frames_for_model = frames_bgr.copy()  # already resized to 640x480 in reader

    # Prepare tensor for model: convert BGR->RGB for model input, normalize to 0-1
    frames_rgb = np.stack([cv2.cvtColor(f, cv2.COLOR_BGR2RGB) for f in frames_for_model], axis=0)
    tensor = torch.from_numpy(frames_rgb).float() / 255.0  # (F, H, W, C)
    tensor = tensor.permute(0, 3, 1, 2)  # (F, C, H, W)

    model = _load_model(model_weights)
    device = get_device()
    batch_size = get_batch_size("measurements")

    preds: List[np.ndarray] = []
    logger.info(
        "[Measurements2D] Starting batched inference | frames=%d batch_size=%d device=%s",
        tensor.shape[0],
        batch_size,
        device,
    )

    inference_start = time.time()

    with torch.no_grad():
        for batch_start in range(0, tensor.shape[0], batch_size):
            batch_end = min(batch_start + batch_size, tensor.shape[0])
            batch_tensor = tensor[batch_start:batch_end].to(device)  # (B,3,H,W)
            logits = model(batch_tensor)["out"]  # (B,2,H,W)
            probs = torch.sigmoid(logits)
            coords_batch = _segmentation_to_coordinates(probs, order="XY").detach().cpu().numpy()  # (B,2,2)
            preds.extend(coords_batch)

            if batch_end == tensor.shape[0] or batch_end % max(1, batch_size * 2) == 0:
                elapsed = time.time() - inference_start
                fps = batch_end / elapsed if elapsed > 0 else 0
                logger.info(
                    "[Measurements2D] Processed %d/%d frames (%.1fs, %.1f fps, device=%s)",
                    batch_end,
                    tensor.shape[0],
                    elapsed,
                    fps,
                    device,
                )

    preds = np.asarray(preds)  # (F, 2, 2)
    if len(frames_bgr) == 0 or preds.shape[0] == 0:
        raise RuntimeError("No frames available for measurements.")

    # Prepare output video/CSV paths with short, unique base (timestamped)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    base_name = f"{model_weights}_{ts}"
    base_path = os.path.join(output_dir, base_name)
    out_video = base_path + ".mp4"
    out_csv = base_path + ".csv"

    # If path too long on Windows, fall back to very short names
    try:
        full_len_video = len(os.path.abspath(out_video))
    except Exception:
        full_len_video = 1000  # force fallback if any issue
    if full_len_video > 240:
        out_video = os.path.join(output_dir, f"{model_weights}_{ts}.mp4")
        out_csv = os.path.join(output_dir, f"{model_weights}_{ts}.csv")

    # If DICOM, extract scaling to compute physical length (cm)
    dicom_scale = None
    if ext == ".dcm":
        dicom_scale = _extract_dicom_scale(input_path)

    encode_width = width - (width % 2)
    encode_height = height - (height % 2)
    if encode_width <= 0 or encode_height <= 0:
        raise RuntimeError("Invalid frame dimensions for encoding.")
    if encode_width != width or encode_height != height:
        logger.info("[Measurements2D] Adjusted frame size to even dimensions: (%s, %s) -> (%s, %s)", width, height, encode_width, encode_height)

    # Draw predictions on frames_bgr (original resolution for display)
    # Scale coordinates if model frames were resized to different size
    scale_x = width / 640.0
    scale_y = height / 480.0

    def _clip(v: int, lo: int, hi: int) -> int:
        return int(max(lo, min(hi, v)))

    # Adaptive styling
    base = min(width, height)
    radius = max(2, int(round(base * 0.006)))
    thick = max(2, int(round(base * 0.004)))
    font_scale = max(0.5, base * 0.0015)
    alpha = 0.55

    # Colors (BGR)
    point0_color = (255, 255, 0)    # cyan
    point1_color = (255, 0, 255)    # magenta
    line_color = (255, 255, 255)    # white
    outline_color = (0, 0, 0)       # black outline

    def _overlay_frames():
        for i in range(len(frames_bgr)):
            frame = frames_bgr[i].copy()
            overlay = frame.copy()
            p0 = preds[i, 0]
            p1 = preds[i, 1]
            x0, y0 = int(round(p0[0] * scale_x)), int(round(p0[1] * scale_y))
            x1, y1 = int(round(p1[0] * scale_x)), int(round(p1[1] * scale_y))
            # ensure within frame bounds
            x0 = _clip(x0, 0, width - 1); y0 = _clip(y0, 0, height - 1)
            x1 = _clip(x1, 0, width - 1); y1 = _clip(y1, 0, height - 1)

            # Anti-aliased line on overlay
            cv2.line(overlay, (x0, y0), (x1, y1), line_color, thick, cv2.LINE_AA)

            # Circles with outline
            cv2.circle(overlay, (x0, y0), radius + 1, outline_color, 2, cv2.LINE_AA)
            cv2.circle(overlay, (x0, y0), radius, point0_color, -1, cv2.LINE_AA)
            cv2.circle(overlay, (x1, y1), radius + 1, outline_color, 2, cv2.LINE_AA)
            cv2.circle(overlay, (x1, y1), radius, point1_color, -1, cv2.LINE_AA)

            # Blend for a softer look
            frame = cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0)

            # Length label (prefer cm if DICOM scale available)
            mid_x = int(round((x0 + x1) / 2))
            mid_y = int(round((y0 + y1) / 2))
            if dicom_scale is not None:
                dx_model = abs(p1[0] - p0[0])
                dy_model = abs(p1[1] - p0[1])
                dx_orig = dx_model * dicom_scale["ratio_w"]
                dy_orig = dy_model * dicom_scale["ratio_h"]
                length_cm = (dx_orig * dicom_scale["conv_x_cm"]) ** 2 + (dy_orig * dicom_scale["conv_y_cm"]) ** 2
                length_cm = float(np.sqrt(length_cm))
                label = f"{length_cm:.2f} cm"
            else:
                # Fallback to pixel length
                length_px = float(np.hypot(p1[0] - p0[0], p1[1] - p0[1]))
                label = f"{length_px:.0f} px"

            text_pos = (min(mid_x + radius + 6, width - 1), max(mid_y - radius - 6, 0))
            cv2.putText(frame, label, text_pos, cv2.FONT_HERSHEY_SIMPLEX, font_scale, outline_color, 2, cv2.LINE_AA)
            cv2.putText(frame, label, text_pos, cv2.FONT_HERSHEY_SIMPLEX, font_scale, (200, 255, 200), 1, cv2.LINE_AA)

            if frame.shape[1] != encode_width or frame.shape[0] != encode_height:
                frame = cv2.resize(frame, (encode_width, encode_height), interpolation=cv2.INTER_LINEAR)

            yield frame

    fps_to_use = settings.MEASUREMENTS_OUTPUT_FPS if settings.MEASUREMENTS_OUTPUT_FPS > 0 else (fps if fps > 0 else 30.0)
    try:
        preset = "slow" if get_device().type == "cuda" else "medium"
        ffmpeg_write_mp4_from_frames(
            frames=_overlay_frames(),
            width=encode_width,
            height=encode_height,
            fps=fps_to_use,
            output_path=out_video,
            crf=16,
            preset=preset,
            timeout_seconds=float(settings.MEASUREMENTS_FFMPEG_TIMEOUT),
            per_frame_timeout=float(settings.MEASUREMENTS_FFMPEG_FRAME_TIMEOUT),
        )
    except Exception as ff_err:
        # Fallback to OpenCV writer if ffmpeg is unavailable
        logger.warning("[Measurements2D] ffmpeg encode failed, falling back to OpenCV: %s", ff_err)
        fallback_writer = cv2.VideoWriter(out_video, cv2.VideoWriter_fourcc(*"mp4v"), fps_to_use, (encode_width, encode_height))
        if not fallback_writer.isOpened():
            raise RuntimeError(f"Failed to open fallback VideoWriter: {ff_err}")
        for frame in _overlay_frames():
            fallback_writer.write(frame)
        fallback_writer.release()

    # Save CSV (path determined above with length guard)
    try:
        import pandas as pd
        df = pd.DataFrame({
            "frame_number": np.arange(len(preds), dtype=int),
            "pred_x1": preds[:, 0, 0],
            "pred_y1": preds[:, 0, 1],
            "pred_x2": preds[:, 1, 0],
            "pred_y2": preds[:, 1, 1],
        })
        # If DICOM scale exists, append per-frame length in cm
        if dicom_scale is not None:
            dx_model = np.abs(preds[:, 1, 0] - preds[:, 0, 0])
            dy_model = np.abs(preds[:, 1, 1] - preds[:, 0, 1])
            dx_orig = dx_model * dicom_scale["ratio_w"]
            dy_orig = dy_model * dicom_scale["ratio_h"]
            lengths_cm = np.sqrt((dx_orig * dicom_scale["conv_x_cm"]) ** 2 + (dy_orig * dicom_scale["conv_y_cm"]) ** 2)
            df["length_cm"] = lengths_cm
        df.to_csv(out_csv, index=False)
    except Exception:
        # Fallback to numpy save if pandas not available
        np.savetxt(
            out_csv,
            np.column_stack([
                np.arange(len(preds), dtype=int),
                preds[:, 0, 0], preds[:, 0, 1], preds[:, 1, 0], preds[:, 1, 1]
            ]),
            delimiter=",",
            header="frame_number,pred_x1,pred_y1,pred_x2,pred_y2",
            comments="",
        )

    return out_video, out_csv
