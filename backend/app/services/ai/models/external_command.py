"""
External command AI model wrapper.

Runs real inference via a configurable command and expects a JSON output file.
No simulated outputs: if the command or weights are missing, the model fails clearly.
"""

from __future__ import annotations

import asyncio
import json
import os
import shlex
import tempfile
import time
from pathlib import Path
from string import Template
from typing import Any

import numpy as np

from app.core.logging import get_logger
from app.services.ai.base import BaseAIModel, InferenceResult, ModelMetadata

logger = get_logger(__name__)


class ExternalCommandModel(BaseAIModel):
    """Execute an external command for inference and parse JSON output."""

    def __init__(
        self,
        metadata: ModelMetadata,
        command_template: str | None,
        weights_path: Path,
        results_dir: Path,
        work_dir: Path | None = None,
        timeout_seconds: int = 900,
        input_kind: str = "image",
        export_frames: bool = False,
    ) -> None:
        super().__init__()
        self._metadata = metadata
        self.command_template = command_template
        self.weights_path = weights_path
        self.results_dir = results_dir
        self.work_dir = work_dir
        self.timeout_seconds = timeout_seconds
        self.input_kind = input_kind
        self.export_frames = export_frames

    @property
    def metadata(self) -> ModelMetadata:
        return self._metadata

    def _weights_exist(self) -> bool:
        if self.weights_path.is_file():
            return True
        if self.weights_path.is_dir():
            for pattern in [
                "*.pt",
                "*.pth",
                "*.ckpt",
                "*.bin",
                "*.onnx",
                "*.h5",
                "*.tar",
                "*.tar.gz",
                "*.zip",
                "model.*",
            ]:
                if list(self.weights_path.rglob(pattern)):
                    return True
        return False

    def check_availability(self) -> tuple[bool, list[str]]:
        errors: list[str] = []
        if not self.command_template:
            errors.append("External command not configured")
        if not self._weights_exist():
            errors.append(f"Weights not found at {self.weights_path}")
        return len(errors) == 0, errors

    async def load(self, device: str = "cuda") -> None:
        available, errors = self.check_availability()
        if not available:
            if any("Weights not found" in error for error in errors):
                raise FileNotFoundError(" ".join(errors))
            raise RuntimeError(" ".join(errors))

        self._device = device
        self._loaded = True

    async def unload(self) -> None:
        self._loaded = False

    async def predict(self, image: Any, **kwargs: Any) -> InferenceResult:
        if not self._loaded:
            raise RuntimeError("Model not loaded. Call load() first.")

        array, metadata, input_file = self._normalize_input(image, kwargs)
        run_dir = self._create_run_dir()

        input_npz = run_dir / "input.npz"
        input_json = run_dir / "input.json"
        output_json = run_dir / "output.json"
        frames_dir = run_dir / "frames"

        np.savez_compressed(input_npz, array=array.astype(np.float32))
        input_payload = {
            "model_name": self.metadata.name,
            "input_kind": self.input_kind,
            "shape": list(array.shape),
            "dtype": str(array.dtype),
            "metadata": metadata,
            "extra": kwargs,
        }
        input_json.write_text(json.dumps(input_payload))

        if self.export_frames:
            frames_dir.mkdir(parents=True, exist_ok=True)
            self._export_frames(array, frames_dir)

        env = os.environ.copy()
        env.update(
            {
                "HORALIX_INPUT_NPZ": str(input_npz),
                "HORALIX_INPUT_JSON": str(input_json),
                "HORALIX_INPUT_DIR": str(frames_dir),
                "HORALIX_OUTPUT_JSON": str(output_json),
                "HORALIX_DEVICE": self._device,
                "HORALIX_WEIGHTS_PATH": str(self.weights_path),
                "HORALIX_RESULTS_DIR": str(run_dir),
            }
        )
        if input_file:
            env["HORALIX_INPUT_FILE"] = input_file

        command = self._render_command(
            {
                "INPUT_NPZ": str(input_npz),
                "INPUT_JSON": str(input_json),
                "INPUT_DIR": str(frames_dir),
                "OUTPUT_JSON": str(output_json),
                "DEVICE": self._device,
                "WEIGHTS_PATH": str(self.weights_path),
                "RESULTS_DIR": str(run_dir),
                "MODEL_NAME": self.metadata.name,
            }
        )

        logger.info(
            "Running external model command",
            model=self.metadata.name,
            command=command,
            run_dir=str(run_dir),
        )

        start_time = time.perf_counter()
        stdout, stderr = await self._run_command(command, env)
        inference_time_ms = (time.perf_counter() - start_time) * 1000

        if not output_json.exists():
            raise RuntimeError("External model did not produce output.json")

        output_payload = json.loads(output_json.read_text())
        results = output_payload.get("results", output_payload)
        result_files = output_payload.get("result_files", {})
        confidence = output_payload.get("confidence")

        return InferenceResult(
            model_name=self.metadata.name,
            model_version=self.metadata.version,
            inference_time_ms=inference_time_ms,
            output=results,
            confidence=float(confidence) if isinstance(confidence, (int, float)) else None,
            metadata={
                "run_dir": str(run_dir),
                "stdout": stdout,
                "stderr": stderr,
                "result_files": result_files if isinstance(result_files, dict) else {},
            },
        )

    def _normalize_input(self, image: Any, kwargs: dict[str, Any]) -> tuple[np.ndarray, dict, str | None]:
        input_file = kwargs.pop("input_file", None)
        metadata: dict[str, Any] = {}

        if hasattr(image, "pixel_data") and hasattr(image, "metadata"):
            array = image.pixel_data
            metadata = self._metadata_to_dict(image.metadata)
        elif isinstance(image, dict):
            array = image.get("array")
            metadata = image.get("metadata", {})
            input_file = image.get("input_file", input_file)
        else:
            array = image

        if array is None or not isinstance(array, np.ndarray):
            raise ValueError("External model input must be a numpy array or LoadedVolume")

        return array, metadata, input_file

    def _metadata_to_dict(self, metadata: Any) -> dict[str, Any]:
        if isinstance(metadata, dict):
            return metadata
        result: dict[str, Any] = {}
        for field_name in dir(metadata):
            if field_name.startswith("_"):
                continue
            value = getattr(metadata, field_name, None)
            if callable(value):
                continue
            result[field_name] = value
        return result

    def _create_run_dir(self) -> Path:
        self.results_dir.mkdir(parents=True, exist_ok=True)
        run_dir = Path(
            tempfile.mkdtemp(prefix=f"{self.metadata.name}_", dir=str(self.results_dir))
        )
        return run_dir

    def _render_command(self, tokens: dict[str, str]) -> list[str]:
        if not self.command_template:
            raise RuntimeError("External command not configured")
        template = Template(self.command_template)
        rendered = template.safe_substitute(tokens)
        return shlex.split(rendered)

    async def _run_command(self, command: list[str], env: dict[str, str]) -> tuple[str, str]:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(self.work_dir) if self.work_dir else None,
            env=env,
        )
        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                process.communicate(), timeout=self.timeout_seconds
            )
        except asyncio.TimeoutError as exc:
            process.kill()
            raise RuntimeError("External model command timed out") from exc

        stdout = stdout_bytes.decode("utf-8", errors="replace") if stdout_bytes else ""
        stderr = stderr_bytes.decode("utf-8", errors="replace") if stderr_bytes else ""

        if process.returncode != 0:
            raise RuntimeError(
                f"External model command failed (exit {process.returncode}): {stderr[:2000]}"
            )

        return stdout[:2000], stderr[:2000]

    def _export_frames(self, array: np.ndarray, frames_dir: Path) -> None:
        from PIL import Image

        frames = self._split_frames(array)
        for idx, frame in enumerate(frames):
            frame_u8 = self._normalize_to_uint8(frame)
            img = Image.fromarray(frame_u8)
            img.save(frames_dir / f"frame_{idx:04d}.png")

    def _split_frames(self, array: np.ndarray) -> list[np.ndarray]:
        if self.input_kind == "cine":
            if array.ndim == 2:
                return [array]
            if array.ndim >= 3 and array.shape[-1] in (3, 4):
                return [array]
            return [array[i] for i in range(array.shape[0])]
        return [array]

    def _normalize_to_uint8(self, frame: np.ndarray) -> np.ndarray:
        if frame.ndim == 3 and frame.shape[-1] in (3, 4):
            data = frame
        else:
            data = frame.astype(np.float32)
            min_val = float(np.nanmin(data))
            max_val = float(np.nanmax(data))
            if max_val - min_val < 1e-6:
                return np.zeros_like(data, dtype=np.uint8)
            data = (data - min_val) / (max_val - min_val)
            data = (data * 255.0).clip(0, 255)
        return data.astype(np.uint8)
