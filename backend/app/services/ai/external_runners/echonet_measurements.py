"""EchoNet measurements runner that writes structured JSON output."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pydicom

ULTRASOUND_REGIONS_TAG = (0x0018, 0x6011)
REGION_X0_SUBTAG = (0x0018, 0x6018)
REGION_Y0_SUBTAG = (0x0018, 0x601A)
REGION_X1_SUBTAG = (0x0018, 0x601C)
REGION_Y1_SUBTAG = (0x0018, 0x601E)
REGION_PHYSICAL_DELTA_X_SUBTAG = (0x0018, 0x602C)
REGION_PHYSICAL_DELTA_Y_SUBTAG = (0x0018, 0x602E)

ALLOWED_MEASUREMENTS = {
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


def _load_extra(input_json: Path) -> dict[str, Any]:
    if not input_json.exists():
        return {}
    payload = json.loads(input_json.read_text())
    if isinstance(payload, dict):
        extra = payload.get("extra")
        if isinstance(extra, dict):
            return extra
    return {}


def _get_ultrasound_region(ds: pydicom.Dataset) -> dict[str, Any] | None:
    if ULTRASOUND_REGIONS_TAG not in ds:
        return None

    region_candidates: list[tuple[dict[str, Any], list[int]]] = []
    for region in ds[ULTRASOUND_REGIONS_TAG].value:
        coords = []
        for subtag in (REGION_X0_SUBTAG, REGION_Y0_SUBTAG, REGION_X1_SUBTAG, REGION_Y1_SUBTAG):
            coords.append(region[subtag].value if subtag in region else None)
        if all(value is not None for value in coords):
            region_candidates.append((region, coords))

    if not region_candidates:
        return None

    region_candidates.sort(key=lambda item: item[1][1], reverse=True)
    return region_candidates[0][0]


def _get_conversion_factors(ds: pydicom.Dataset) -> tuple[float | None, float | None]:
    region = _get_ultrasound_region(ds)
    if region is not None:
        conv_x = (
            abs(float(region[REGION_PHYSICAL_DELTA_X_SUBTAG].value))
            if REGION_PHYSICAL_DELTA_X_SUBTAG in region
            else None
        )
        conv_y = (
            abs(float(region[REGION_PHYSICAL_DELTA_Y_SUBTAG].value))
            if REGION_PHYSICAL_DELTA_Y_SUBTAG in region
            else None
        )
        if conv_x and conv_y:
            return conv_x, conv_y

    if hasattr(ds, "PixelSpacing") and ds.PixelSpacing:
        try:
            conv_y = float(ds.PixelSpacing[0])
            conv_x = float(ds.PixelSpacing[1])
            return conv_x, conv_y
        except (TypeError, ValueError):
            return None, None

    return None, None


def _summarize(values: np.ndarray) -> dict[str, float]:
    if values.size == 0:
        return {}
    return {
        "min": float(values.min()),
        "max": float(values.max()),
        "mean": float(values.mean()),
        "std": float(values.std()),
    }


def _compute_diameters(
    df: pd.DataFrame, ds: pydicom.Dataset
) -> tuple[np.ndarray, str, dict[str, float | None]]:
    input_dicom = ds.pixel_array
    height = int(input_dicom.shape[1])
    ratio = height / 480.0 if height else 1.0

    delta_x = (df["pred_x2"] - df["pred_x1"]).abs().to_numpy() * ratio
    delta_y = (df["pred_y2"] - df["pred_y1"]).abs().to_numpy() * ratio

    conv_x, conv_y = _get_conversion_factors(ds)
    if conv_x and conv_y:
        diameters = np.sqrt((delta_x * conv_x) ** 2 + (delta_y * conv_y) ** 2)
        return diameters, "mm", {"conv_x": conv_x, "conv_y": conv_y}

    diameters = np.sqrt(delta_x**2 + delta_y**2)
    return diameters, "px", {"conv_x": conv_x, "conv_y": conv_y}


def _run_echonet(weights_path: Path, measurement: str, input_file: Path, output_avi: Path, phase: bool) -> None:
    command = [
        sys.executable,
        "inference_2D_image.py",
        "--model_weights",
        measurement,
        "--file_path",
        str(input_file),
        "--output_path",
        str(output_avi),
    ]
    if phase:
        command.append("--phase_estimate")

    subprocess.run(
        command,
        cwd=str(weights_path),
        env=os.environ.copy(),
        check=True,
        capture_output=True,
        text=True,
    )


def main() -> None:
    input_json = Path(os.environ["HORALIX_INPUT_JSON"])
    output_json = Path(os.environ["HORALIX_OUTPUT_JSON"])
    weights_path = Path(os.environ["HORALIX_WEIGHTS_PATH"])
    run_dir = Path(os.environ["HORALIX_RESULTS_DIR"])

    input_file_raw = os.environ.get("HORALIX_INPUT_FILE")
    if not input_file_raw:
        raise RuntimeError("EchoNet measurements requires HORALIX_INPUT_FILE.")
    input_file = Path(input_file_raw)
    if not input_file.exists():
        raise RuntimeError("EchoNet input file not found.")

    extra = _load_extra(input_json)
    measurement = (
        extra.get("measurement")
        or extra.get("model_weights")
        or extra.get("target")
        or "lvid"
    )
    if measurement not in ALLOWED_MEASUREMENTS:
        raise RuntimeError(f"Unsupported EchoNet measurement: {measurement}")

    phase_estimate = bool(extra.get("phase_estimate"))

    run_dir.mkdir(parents=True, exist_ok=True)
    output_avi = run_dir / f"echonet_{measurement}.avi"

    _run_echonet(weights_path, measurement, input_file, output_avi, phase_estimate)

    output_csv = output_avi.with_suffix(".csv")
    if not output_csv.exists():
        raise RuntimeError("EchoNet inference did not produce a CSV output.")

    df = pd.read_csv(output_csv)
    ds = pydicom.dcmread(str(input_file))
    diameters, units, conversion = _compute_diameters(df, ds)

    result_payload = {
        "measurement": measurement,
        "units": units,
        "frame_count": int(len(diameters)),
        "diameters": diameters.tolist(),
        "summary": _summarize(diameters),
        "conversion": conversion,
        "coordinates": {
            "x1": df["pred_x1"].tolist(),
            "y1": df["pred_y1"].tolist(),
            "x2": df["pred_x2"].tolist(),
            "y2": df["pred_y2"].tolist(),
        },
    }

    output_payload = {
        "results": result_payload,
        "result_files": {
            "overlay_video": str(output_avi),
            "coordinates_csv": str(output_csv),
        },
    }

    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(output_payload))


if __name__ == "__main__":
    main()
