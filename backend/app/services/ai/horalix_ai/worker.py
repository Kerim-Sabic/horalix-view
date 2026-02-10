"""
Horalix AI Worker Process.

Loads all models at startup and processes inference jobs from the queue.

Architecture:
- One worker per GPU
- Models loaded once at startup (no lazy loading)
- Polls job queue for new jobs
- Executes 8-stage pipeline
- Writes results to shared volume

Entry point: python -m app.services.ai.horalix_ai.worker --gpu-id 0
"""

import os
import sys
import json
import time
import hashlib
import argparse
import logging
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, List, Optional

import torch
import numpy as np
import cv2

# Add backend to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from app.core.config import get_settings
from app.services.ai.horalix_ai.schema import (
    Job,
    JobStatus,
    HoralixAIOutput,
    FrameBundle,
    MeasurementRecord,
    LineOverlay,
    MaskOverlay,
    PolylineOverlay,
    OverlayTarget,
    Point2D,
    CurveData,
    StructuredReport,
)
from app.services.ai.horalix_ai.models import (
    load_panecho_model,
    load_echoprime_models,
    load_all_measurement_models,
    load_echonet_model,
    get_echoprime_view_classes,
)
from app.services.ai.horalix_ai.preprocessing import (
    preprocess_for_panecho,
    sample_frames_for_panecho,
    preprocess_for_echoprime,
    sample_frames_for_echoprime,
    preprocess_for_echonet,
)
from app.services.ai.horalix_ai.pipeline import run_measurements_stage, combine_predictions
from app.services.ai.horalix_ai.postprocessing import (
    CoordinateTransformer,
    extract_contours_from_mask,
    postprocess_segmentation_mask,
)
from app.services.ai.horalix_ai.caching import FrameCache, EmbeddingCache
from app.services.ai.horalix_ai.utils import (
    extract_dicom_metadata,
    get_pixel_spacing,
    get_logger,
    log_inference_metrics,
    Timer,
)
from app.services.ai.horalix_ai.utils.overlay_gating import area_change_valid, area_ratio_valid
from app.services.ai.horalix_ai.utils.view_gating import (
    VIEW_CONFIDENCE_THRESHOLD,
    get_compatible_measurements,
    normalize_view_label,
)
from app.services.ai.horalix_ai.runtime import HoralixRuntimeContext

logger = get_logger(__name__)

class JobCancelled(Exception):
    """Raised when a job is cancelled while running."""


class JobTimedOut(Exception):
    """Raised when a job exceeds the worker timeout."""


class HoralixAIWorker:
    """
    Inference worker that loads models at startup and processes jobs.

    Each worker is pinned to a specific GPU and runs independently.
    GPU load balancing is achieved via:
    - Round-robin job assignment based on GPU ID
    - GPU memory throttling to keep utilization under 95%
    - Atomic job claiming with worker affinity
    """

    # Maximum GPU memory utilization (leave 5% headroom for stability)
    MAX_GPU_UTIL = 0.95

    def __init__(self, gpu_id: int):
        """
        Initialize worker.

        Args:
            gpu_id: GPU ID to use (0 or 1)
        """
        self.gpu_id = gpu_id
        self.settings = get_settings()
        self.total_workers = self.settings.ai.horalix_ai_num_workers

        # Respect AI_DEVICE setting
        requested_device = self.settings.ai.device.lower()
        if "cpu" in requested_device:
            self.device = "cpu"
        elif torch.cuda.is_available() and "cuda" in requested_device:
            self.device = f"cuda:{gpu_id}"
            torch.cuda.set_device(gpu_id)
            os.environ["CUDA_VISIBLE_DEVICES"] = str(gpu_id)
        else:
            # Fall back to CPU if CUDA not available
            self.device = "cpu"

        logger.info(f"Worker {gpu_id} initialized on device {self.device}")

        # Models (loaded in load_models())
        self.panecho_model = None
        self.echoprime_model = None
        self.view_classifier = None
        self.measurements_models = {}
        self.echonet_model = None

        # Caching
        self.frame_cache = FrameCache(
            max_size_gb=self.settings.ai.horalix_ai_cache_max_size_gb
        ) if self.settings.ai.horalix_ai_cache_enabled else None

        self.embedding_cache = EmbeddingCache(
            cache_dir=self.settings.ai.cache_dir / "horalix_ai_embeddings",
            enabled=self.settings.ai.horalix_ai_cache_enabled,
        )

        self.runtime = HoralixRuntimeContext(
            settings=self.settings,
            device=self.device,
            gpu_id=self.gpu_id,
            frame_cache=self.frame_cache,
            embedding_cache=self.embedding_cache,
        )

        # Paths
        self.job_queue_dir = self.settings.ai.horalix_ai_job_queue_dir
        self.job_queue_dir.mkdir(parents=True, exist_ok=True)
        self.results_dir = self.settings.ai.results_dir / "horalix_ai"
        self.results_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"Job queue: {self.job_queue_dir}")
        logger.info(f"Results dir: {self.results_dir}")

        # Current job context (single-threaded worker)
        self._current_job_id: Optional[str] = None
        self._current_job_start: Optional[float] = None

    def load_models(self):
        """Load all models into GPU memory."""
        logger.info(f"Worker {self.gpu_id}: Loading models...")
        models_root = self.settings.ai.horalix_ai_models_root
        load_timings: dict[str, float] = {}

        try:
            # Load PanEcho
            logger.info("Loading PanEcho...")
            t0 = time.perf_counter()
            panecho_weights = models_root / self.settings.ai.horalix_ai_panecho_weights
            panecho_hub_dir = models_root / self.settings.ai.horalix_ai_panecho_hub_dir
            self.panecho_model = load_panecho_model(
                panecho_weights,
                device=self.device,
                hub_dir=panecho_hub_dir
            )
            load_timings["panecho_ms"] = (time.perf_counter() - t0) * 1000

            # Load EchoPrime
            logger.info("Loading EchoPrime...")
            t0 = time.perf_counter()
            self.echoprime_model, self.view_classifier = load_echoprime_models(
                encoder_path=models_root / self.settings.ai.horalix_ai_echoprime_encoder,
                text_encoder_path=models_root / self.settings.ai.horalix_ai_echoprime_text_encoder,
                view_classifier_path=models_root / self.settings.ai.horalix_ai_view_classifier,
                device=self.device,
            )
            if self.echoprime_model is not None and self.view_classifier is not None:
                try:
                    setattr(self.echoprime_model, "view_classifier", self.view_classifier)
                    logger.info("Attached configured EchoPrime view classifier to runtime model")
                except Exception as exc:
                    logger.warning(f"Failed to attach configured EchoPrime view classifier: {exc}")
            load_timings["echoprime_ms"] = (time.perf_counter() - t0) * 1000

            # Load Measurements models
            if self.settings.ai.horalix_ai_enable_measurements_2d:
                logger.info("Loading Measurements models...")
                t0 = time.perf_counter()
                measurements_dir = models_root / self.settings.ai.horalix_ai_measurements_dir
                self.measurements_models = load_all_measurement_models(
                    measurements_dir=measurements_dir,
                    device=self.device,
                )
                load_timings["measurements_ms"] = (time.perf_counter() - t0) * 1000

            # Load EchoNet-Dynamic
            if self.settings.ai.horalix_ai_enable_echonet_dynamic:
                logger.info("Loading EchoNet-Dynamic...")
                t0 = time.perf_counter()
                echonet_weights = models_root / self.settings.ai.horalix_ai_echonet_weights
                self.echonet_model = load_echonet_model(echonet_weights, device=self.device)
                load_timings["echonet_ms"] = (time.perf_counter() - t0) * 1000

            self.runtime.panecho_model = self.panecho_model
            self.runtime.echoprime_model = self.echoprime_model
            self.runtime.view_classifier = self.view_classifier
            self.runtime.measurements_models = self.measurements_models
            self.runtime.echonet_model = self.echonet_model

            logger.info(f"Worker {self.gpu_id}: All models loaded successfully")
            if load_timings:
                logger.info(
                    "Model load timings (ms): "
                    + ", ".join(f"{k}={v:.1f}" for k, v in load_timings.items())
                )

            # Enable cuDNN auto-tuner for optimal convolution algorithms
            if torch.cuda.is_available():
                torch.backends.cudnn.benchmark = True
                torch.backends.cudnn.enabled = True

            # Log GPU memory
            if torch.cuda.is_available():
                allocated = torch.cuda.memory_allocated(self.gpu_id) / 1024**3
                reserved = torch.cuda.memory_reserved(self.gpu_id) / 1024**3
                total = torch.cuda.get_device_properties(self.gpu_id).total_memory / 1024**3
                logger.info(
                    f"GPU {self.gpu_id}: {allocated:.2f} GB allocated, "
                    f"{reserved:.2f} GB reserved, {total:.1f} GB total"
                )

            # Optional warmup to keep models hot and initialize CUDA kernels
            if self.settings.ai.horalix_ai_warmup:
                self._warmup_models()

        except Exception as e:
            logger.error(f"Worker {self.gpu_id}: Failed to load models: {e}", exc_info=True)
            raise

    def _warmup_models(self):
        """Run lightweight dummy inference to keep models hot and initialize CUDA kernels."""
        if self.device == "cpu":
            logger.info("Warmup skipped (CPU device)")
            return

        logger.info(f"Worker {self.gpu_id}: Warming up models...")
        try:
            use_amp = self.settings.ai.horalix_ai_mixed_precision
            with torch.no_grad():
                # PanEcho warmup
                if self.panecho_model:
                    dummy = torch.zeros((1, 3, 16, 224, 224), device=self.device)
                    _ = self.panecho_model(dummy)

                # View classifier warmup
                if self.view_classifier:
                    dummy = torch.zeros((4, 3, 224, 224), device=self.device)
                    _ = self.view_classifier(dummy)

                # EchoPrime warmup
                if self.echoprime_model:
                    dummy = torch.zeros((1, 3, 32, 224, 224), device=self.device)
                    try:
                        _ = self.echoprime_model.encode_study(dummy)
                    except Exception:
                        _ = self.echoprime_model.embed_videos(dummy)

                # Measurements warmup (run one model to avoid long startup)
                if self.measurements_models:
                    first_model = next(iter(self.measurements_models.values()))
                    dummy = torch.zeros((1, 3, 480, 640), device=self.device)
                    with torch.autocast(device_type="cuda", enabled=use_amp):
                        _ = first_model(dummy)["out"]

                # EchoNet warmup
                if self.echonet_model:
                    dummy = torch.zeros((1, 3, 112, 112), device=self.device)
                    with torch.autocast(device_type="cuda", enabled=use_amp):
                        _ = self.echonet_model(dummy)["out"]

            if torch.cuda.is_available():
                torch.cuda.synchronize()
            logger.info(f"Worker {self.gpu_id}: Warmup complete")
        except Exception as e:
            logger.warning(f"Worker {self.gpu_id}: Warmup failed: {e}")

    def _resolve_study_path(self, study_uid: str) -> Optional[Path]:
        """Resolve and cache the filesystem path for a study UID."""
        if getattr(self, "_current_study_uid", None) == study_uid and getattr(self, "_current_study_path", None):
            return self._current_study_path

        try:
            import asyncio
            from app.services.dicom.storage import DicomStorageService

            storage_service = DicomStorageService(storage_dir=self.settings.dicom.storage_dir)
            study_path = asyncio.run(storage_service.get_study_path(study_uid))
        except Exception as exc:
            logger.warning(f"Failed to resolve study path for {study_uid}: {exc}")
            study_path = None

        self._current_study_uid = study_uid
        self._current_study_path = study_path
        return study_path

    def _set_view_diagnostic(
        self,
        instance_uid: str,
        *,
        view_label: Optional[str] = None,
        confidence: Optional[float] = None,
        mapping_status: Optional[str] = None,
        mapping_reason: Optional[str] = None,
        measurement_models: Optional[List[str]] = None,
        measurement_skip_reason: Optional[str] = None,
        echonet_status: Optional[str] = None,
        echonet_skip_reason: Optional[str] = None,
    ) -> None:
        diagnostics = getattr(self, "_view_diagnostics", None)
        if diagnostics is None:
            diagnostics = {}
            self._view_diagnostics = diagnostics
        entry = diagnostics.get(instance_uid, {})
        if view_label is not None:
            entry["view_label"] = view_label
        if confidence is not None:
            entry["confidence"] = float(confidence)
        if mapping_status is not None:
            entry["mapping_status"] = mapping_status
        if mapping_reason is not None:
            entry["mapping_reason"] = mapping_reason
        if measurement_models is not None:
            entry["measurement_models"] = measurement_models
        if measurement_skip_reason is not None:
            entry["measurement_skip_reason"] = measurement_skip_reason
        if echonet_status is not None:
            entry["echonet_status"] = echonet_status
        if echonet_skip_reason is not None:
            entry["echonet_skip_reason"] = echonet_skip_reason
        diagnostics[instance_uid] = entry

    def _uid_order_fingerprint(self, ordered_uids: List[str]) -> str:
        payload = "\n".join(ordered_uids).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()[:16]

    def _collect_echoprime_cines(self, study_path: Path) -> List[Dict[str, Any]]:
        """
        Build deterministic cine ordering used for EchoPrime stack mapping.

        Filters using the same inclusion rules as EchoPrime process_dicoms:
        - skip ndim < 3
        - skip single RGB image (ndim == 3 and shape[2] == 3)
        - skip unreadable/corrupt DICOMs
        """
        try:
            import glob
            import pydicom
        except Exception as exc:
            logger.error(f"EchoPrime cine collection failed: missing dependency: {exc}")
            return []

        dicom_paths = glob.glob(str(study_path / "**" / "*.dcm"), recursive=True)
        cines: List[Dict[str, Any]] = []

        for raw_path in dicom_paths:
            dicom_path = Path(raw_path)
            try:
                ds = pydicom.dcmread(str(dicom_path), force=True)
                pixels = ds.pixel_array
            except Exception:
                continue

            if pixels.ndim < 3:
                continue
            if pixels.ndim == 3 and pixels.shape[2] == 3:
                continue

            instance_number = getattr(ds, "InstanceNumber", None)
            try:
                instance_number_int = int(instance_number) if instance_number is not None else 2**31 - 1
            except Exception:
                instance_number_int = 2**31 - 1

            cines.append(
                {
                    "dicom_path": str(dicom_path),
                    "sop_instance_uid": str(getattr(ds, "SOPInstanceUID", dicom_path.stem)),
                    "series_instance_uid": str(getattr(ds, "SeriesInstanceUID", "") or ""),
                    "instance_number": instance_number_int,
                    "acquisition_time": str(getattr(ds, "AcquisitionTime", "") or ""),
                    "content_time": str(getattr(ds, "ContentTime", "") or ""),
                }
            )

        cines.sort(
            key=lambda item: (
                item["series_instance_uid"],
                item["instance_number"],
                item["acquisition_time"],
                item["content_time"],
                item["sop_instance_uid"],
                item["dicom_path"],
            )
        )
        return cines

    def _load_echoprime_stack(
        self,
        study_uid: str,
    ) -> tuple[Optional[torch.Tensor], list[str]]:
        """
        Load EchoPrime-preprocessed videos directly from DICOM files.

        Returns:
            (stack_of_videos, instance_uids) aligned by index
        """
        cached = getattr(self, "_echoprime_cache", None)
        if cached and cached.get("study_uid") == study_uid:
            self._echoprime_view_mapping_ok = cached.get("mapping_ok", True)
            self._echoprime_view_mapping_reason = cached.get("mapping_reason")
            return cached.get("stack"), cached.get("instance_uids", [])

        study_path = self._resolve_study_path(study_uid)
        if not study_path:
            return None, []

        canonical_cines = self._collect_echoprime_cines(Path(study_path))
        if not canonical_cines:
            self._echoprime_view_mapping_ok = False
            self._echoprime_view_mapping_reason = "no_valid_cines"
            logger.warning(f"EchoPrime stack load: no valid cines found for study {study_uid}")
            return None, []

        canonical_paths = [cine["dicom_path"] for cine in canonical_cines]
        canonical_uids = [cine["sop_instance_uid"] for cine in canonical_cines]
        order_fingerprint = self._uid_order_fingerprint(canonical_uids)
        self._echoprime_order_fingerprint = order_fingerprint
        self._echoprime_cine_index = {cine["sop_instance_uid"]: cine for cine in canonical_cines}
        logger.info(
            "EchoPrime cine order fingerprint "
            f"study={study_uid} count={len(canonical_uids)} hash={order_fingerprint} "
            f"head={canonical_uids[:3]} tail={canonical_uids[-3:]}"
        )

        try:
            result = self.echoprime_model.process_dicoms(canonical_paths, return_meta=True)
        except TypeError as exc:
            model_module_name = getattr(self.echoprime_model.__class__, "__module__", "unknown")
            model_file = getattr(sys.modules.get(model_module_name), "__file__", "unknown")
            logger.exception(
                "EchoPrime process_dicoms(return_meta=True) unsupported; "
                f"study={study_uid} model_file={model_file} "
                f"configured_root={self.settings.ai.horalix_ai_models_root}"
            )
            self._echoprime_view_mapping_ok = False
            self._echoprime_view_mapping_reason = "return_meta_unsupported"
            return None, []
        except Exception as exc:
            logger.error(f"EchoPrime process_dicoms failed for {study_uid}: {exc}")
            self._echoprime_view_mapping_ok = False
            self._echoprime_view_mapping_reason = "process_dicoms_failed"
            return None, []

        stack = None
        model_uids: list[str] = []
        model_meta: list[dict[str, Any]] = []
        if isinstance(result, tuple):
            if len(result) >= 1:
                stack = result[0]
            if len(result) >= 3:
                model_uids = [str(uid) for uid in result[2]]
            elif len(result) >= 2:
                model_uids = [str(Path(path).stem) for path in result[1]]
            if len(result) >= 4 and isinstance(result[3], list):
                model_meta = [
                    dict(item) for item in result[3]
                    if isinstance(item, dict)
                ]
        else:
            stack = result

        if not isinstance(stack, torch.Tensor):
            self._echoprime_view_mapping_ok = False
            self._echoprime_view_mapping_reason = "invalid_stack_type"
            return None, []

        stack_count = int(stack.shape[0])
        expected_count = len(canonical_paths)
        instance_uids = canonical_uids[:stack_count]

        mapping_ok = True
        mapping_reason = ""

        if stack_count != expected_count:
            mapping_ok = False
            mapping_reason = f"count_mismatch stack={stack_count} expected={expected_count}"

        if model_meta:
            meta_uids = [str(item.get("sop_instance_uid", "")).strip() for item in model_meta]
            if len(meta_uids) != expected_count:
                mapping_ok = False
                mapping_reason = f"meta_count_mismatch meta={len(meta_uids)} expected={expected_count}"
            elif meta_uids != canonical_uids:
                mapping_ok = False
                mapping_reason = "meta_uid_order_mismatch"
        elif model_uids:
            if len(model_uids) != expected_count:
                mapping_ok = False
                mapping_reason = f"uid_count_mismatch model={len(model_uids)} expected={expected_count}"
            elif model_uids != canonical_uids:
                mapping_ok = False
                mapping_reason = "uid_order_mismatch"
        else:
            mapping_ok = False
            mapping_reason = "missing_uid_metadata"

        if not mapping_ok:
            logger.warning(
                "EchoPrime mapping validation failed "
                f"study={study_uid} reason={mapping_reason} "
                f"stack_count={stack_count} expected_count={expected_count}"
            )
        self._echoprime_view_mapping_ok = mapping_ok
        self._echoprime_view_mapping_reason = mapping_reason or None

        self._echoprime_cache = {
            "study_uid": study_uid,
            "stack": stack,
            "instance_uids": instance_uids,
            "mapping_ok": mapping_ok,
            "mapping_reason": self._echoprime_view_mapping_reason,
        }

        return stack, instance_uids

    def _derive_echoprime_instance_uids(self, study_path: Path) -> list[str]:
        """
        Replicate EchoPrime's process_dicoms file inclusion order to align
        view predictions with SOP Instance UIDs.

        EchoPrime's process_dicoms uses glob(**/*.dcm) and skips:
          - files whose pixel_array has ndim < 3
          - files where pixels.ndim == 3 and pixels.shape[2] == 3 (single RGB image)
          - any file that fails to decode pixel data
        """
        try:
            import glob
            import pydicom
        except Exception as exc:
            logger.warning(f"EchoPrime UID mapping: pydicom/glob unavailable: {exc}")
            return []

        dicom_paths = sorted(glob.glob(str(study_path / "**" / "*.dcm"), recursive=True))
        instance_uids: list[str] = []

        for path in dicom_paths:
            try:
                ds = pydicom.dcmread(path)
                pixels = ds.pixel_array

                if pixels.ndim < 3:
                    continue
                if pixels.ndim == 3 and pixels.shape[2] == 3:
                    # Likely a single RGB image; EchoPrime skips these
                    continue

                sop_uid = str(getattr(ds, "SOPInstanceUID", Path(path).stem))
                instance_uids.append(sop_uid)
            except Exception:
                # Mirror EchoPrime behavior: skip corrupt or unreadable files
                continue

        return instance_uids

    def _predict_views_from_stack(
        self,
        stack: torch.Tensor,
        max_frames: int = 8,
    ) -> tuple[list[str], list[float]]:
        """
        Predict view labels for a preprocessed EchoPrime stack.

        Modes:
        - first: classify on the first non-empty frame per cine
        - sampled_mean: sample K frames and average logits per cine
        """
        n_videos = int(stack.shape[0])
        if n_videos <= 0:
            return [], []

        mode = str(getattr(self.settings.ai, "horalix_ai_view_aggregation", "sampled_mean")).strip().lower()
        if mode not in {"first", "sampled_mean"}:
            logger.warning(f"Unknown view aggregation mode '{mode}', defaulting to 'sampled_mean'")
            mode = "sampled_mean"

        # Prefer the configured classifier loaded by our stack, then fall back to
        # EchoPrime's bundled classifier if needed.
        classifier = self.view_classifier or getattr(self.echoprime_model, "view_classifier", None)
        if classifier is None:
            if mode == "first" and self.echoprime_model is not None:
                # Legacy fallback path for older deployments.
                try:
                    view_list, view_conf_list = self.echoprime_model.get_views(
                        stack,
                        visualize=False,
                        return_view_list=True,
                        return_scores=True,
                    )
                    if len(view_list) != n_videos or len(view_conf_list) != n_videos:
                        logger.warning(
                            "EchoPrime get_views returned unexpected lengths "
                            f"(views={len(view_list)}, confs={len(view_conf_list)}, expected={n_videos})"
                        )
                        return (["Unknown"] * n_videos, [0.0] * n_videos)
                    return [str(v) for v in view_list], [float(c) for c in view_conf_list]
                except Exception as exc:
                    model_module_name = getattr(self.echoprime_model.__class__, "__module__", "unknown")
                    model_file = getattr(sys.modules.get(model_module_name), "__file__", "unknown")
                    logger.exception(
                        "EchoPrime get_views failed "
                        f"mode=first device={self.device} stack_shape={tuple(stack.shape)} "
                        f"model_file={model_file}: {exc}"
                    )
                    return (["Unknown"] * n_videos, [0.0] * n_videos)

            logger.error("No EchoPrime view classifier available for view aggregation")
            return (["Unknown"] * n_videos, [0.0] * n_videos)

        view_classes = get_echoprime_view_classes()
        view_list: list[str] = []
        view_conf_list: list[float] = []
        sample_k = int(getattr(self.settings.ai, "horalix_ai_view_aggregation_k", 5))
        sample_k = max(1, min(sample_k, 16))

        classifier.eval()

        with torch.no_grad():
            for i in range(n_videos):
                video = stack[i]
                # video: (3, 16, 224, 224) -> frames: (16, 3, 224, 224)
                frames = video.permute(1, 0, 2, 3)
                frame_energy = frames.abs().mean(dim=(1, 2, 3))
                valid_mask = frame_energy > 1e-4
                if valid_mask.any():
                    frames = frames[valid_mask]
                else:
                    frames = frames[:1]

                if mode == "first":
                    selected_frames = frames[:1]
                else:
                    if frames.shape[0] > max_frames:
                        idx = torch.linspace(0, frames.shape[0] - 1, steps=max_frames).round().long()
                        frames = frames[idx]
                    if frames.shape[0] > sample_k:
                        idx = torch.linspace(0, frames.shape[0] - 1, steps=sample_k).round().long()
                        frames = frames[idx]
                    selected_frames = frames

                logits = classifier(selected_frames.to(self.device, non_blocking=True))
                logits_for_probs = logits[0] if mode == "first" else logits.mean(dim=0)
                probs = torch.softmax(logits_for_probs, dim=0)
                conf, cls_idx = torch.max(probs, dim=0)
                label_idx = int(cls_idx)
                label = view_classes[label_idx] if label_idx < len(view_classes) else "Unknown"
                view_list.append(label)
                view_conf_list.append(float(conf.detach().cpu()))

        return view_list, view_conf_list

    def _predict_views_from_bundles(
        self,
        cine_bundles: List[FrameBundle],
    ) -> tuple[Dict[str, str], Dict[str, float]]:
        """
        Predict views from in-memory cine frames as a fallback.
        """
        view_predictions: Dict[str, str] = {}
        view_confidences: Dict[str, float] = {}
        if not cine_bundles:
            return view_predictions, view_confidences

        for bundle in cine_bundles:
            if not bundle.frames:
                continue
            try:
                sampled = sample_frames_for_echoprime(bundle.frames)
                tensor = preprocess_for_echoprime(sampled, use_echoprime_utils=False)
                view_list, view_conf_list = self._predict_views_from_stack(tensor)
                if view_list:
                    view_predictions[bundle.instance_uid] = view_list[0]
                    view_confidences[bundle.instance_uid] = float(view_conf_list[0]) if view_conf_list else 0.0
            except Exception as exc:
                logger.warning(f"View fallback failed for {bundle.instance_uid}: {exc}")
                continue

        return view_predictions, view_confidences

    def _build_ultrasound_mask(self, frame: np.ndarray) -> Optional[np.ndarray]:
        """Estimate ultrasound wedge mask from a single frame for overlay quality gating."""
        try:
            if frame.ndim == 3:
                gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
            else:
                gray = frame

            _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
            binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
            return binary > 0
        except Exception:
            return None

    def _infer_view_from_metadata(self, metadata: dict) -> Optional[str]:
        """
        Infer view label from DICOM metadata strings when EchoPrime confidence is low.

        Uses SeriesDescription / ProtocolName / ViewPosition / ImageType text.
        """
        if not metadata:
            return None

        parts = []
        for key in ("series_description", "protocol_name", "view_position", "body_part_examined"):
            value = metadata.get(key)
            if value:
                parts.append(str(value))
        image_type = metadata.get("image_type")
        if isinstance(image_type, (list, tuple)):
            parts.extend([str(v) for v in image_type if v])
        text = " ".join(parts).lower()
        if not text:
            return None

        def has(*tokens: str) -> bool:
            return any(tok in text for tok in tokens)

        # Apical views
        if has("a4c", "apical 4", "apical4", "ap4"):
            return "A4C"
        if has("a2c", "apical 2", "apical2", "ap2"):
            return "A2C"
        if has("a3c", "apical 3", "apical3", "ap3", "apical long"):
            return "A3C"
        if has("a5c", "apical 5", "apical5", "ap5"):
            return "A5C"

        # Parasternal views
        if has("plax", "parasternal long"):
            return "Parasternal_Long"
        if has("psax", "parasternal short"):
            return "Parasternal_Short"

        # Subcostal / SSN
        if has("subcostal", "sub-costal"):
            return "Subcostal"
        if has("suprasternal", "ssn"):
            return "SSN"

        # Doppler
        if has("doppler", "pw", "cw"):
            if has("parasternal long", "plax"):
                return "Doppler_Parasternal_Long"
            if has("parasternal short", "psax"):
                return "Doppler_Parasternal_Short"
            if has("apical"):
                return "Apical_Doppler"
            return "Apical_Doppler"

        return None

    def _write_heartbeat(self):
        """Write heartbeat file so Docker healthcheck knows we're alive."""
        try:
            heartbeat_file = self.job_queue_dir / "status" / f"worker_{self.gpu_id}_heartbeat"
            heartbeat_file.parent.mkdir(parents=True, exist_ok=True)
            heartbeat_file.write_text(str(time.time()))
        except Exception:
            pass  # Non-critical

    def _status_file_path(self, job_id: str) -> Path:
        """Get status file path for a job."""
        return self.job_queue_dir / "status" / f"{job_id}.json"

    def _should_cancel(self, job_id: str) -> bool:
        """Check if a job has been cancelled."""
        try:
            status_file = self._status_file_path(job_id)
            if not status_file.exists():
                return False
            status_data = json.loads(status_file.read_text())
            return status_data.get("status") == "CANCELLED"
        except Exception:
            return False

    def _check_timeout(self, job_id: str, start_time: float) -> None:
        """Raise if job exceeded worker timeout."""
        timeout_s = self.settings.ai.horalix_ai_worker_timeout
        if timeout_s and (time.time() - start_time) > timeout_s:
            raise JobTimedOut(f"Job {job_id} exceeded worker timeout ({timeout_s}s)")

    def _tick_job(self) -> None:
        """Heartbeat + cancellation/timeout checks for the active job."""
        if self._current_job_id:
            if self._should_cancel(self._current_job_id):
                raise JobCancelled(f"Job {self._current_job_id} cancelled")
            if self._current_job_start is not None:
                self._check_timeout(self._current_job_id, self._current_job_start)
        self._write_heartbeat()

    def _check_gpu_memory(self) -> tuple[float, float]:
        """
        Check GPU memory utilization.

        Returns:
            (utilization_fraction, free_gb): Current memory usage as fraction and free memory in GB
        """
        if self.device == "cpu":
            return 0.0, float('inf')

        try:
            allocated = torch.cuda.memory_allocated(self.gpu_id)
            reserved = torch.cuda.memory_reserved(self.gpu_id)
            total = torch.cuda.get_device_properties(self.gpu_id).total_memory

            # Use reserved memory as the actual GPU memory footprint
            utilization = reserved / total
            free_gb = (total - reserved) / (1024 ** 3)

            return utilization, free_gb
        except Exception:
            return 0.0, float('inf')

    def _throttle_if_needed(self):
        """
        Throttle processing if GPU memory is too high.
        Waits for memory to drop below MAX_GPU_UTIL before proceeding.
        """
        if self.device == "cpu":
            return

        util, free_gb = self._check_gpu_memory()
        if util >= self.MAX_GPU_UTIL:
            logger.warning(
                f"Worker {self.gpu_id}: GPU memory at {util:.1%}, throttling... "
                f"(free: {free_gb:.2f} GB)"
            )
            # Force garbage collection
            import gc
            gc.collect()
            torch.cuda.empty_cache()

            # Wait for memory to drop
            for _ in range(30):  # Max 30 seconds
                time.sleep(1)
                util, free_gb = self._check_gpu_memory()
                if util < self.MAX_GPU_UTIL:
                    logger.info(f"Worker {self.gpu_id}: GPU memory recovered to {util:.1%}")
                    break
            else:
                logger.warning(f"Worker {self.gpu_id}: GPU memory still at {util:.1%} after throttle wait")

    def run(self):
        """Main worker loop."""
        logger.info(f"Worker {self.gpu_id}: Ready for jobs")
        self._write_heartbeat()

        while True:
            try:
                self._write_heartbeat()

                # Poll for jobs
                job = self.poll_job_queue()

                if job is None:
                    time.sleep(self.settings.ai.horalix_ai_worker_poll_interval)
                    continue

                # Process job
                logger.info(f"Worker {self.gpu_id}: Processing job {job.job_id}")

                result = self.process_job(job)

                # Save results
                self.save_results(job.job_id, result)

                # Update job status
                self.update_job_status(job.job_id, "COMPLETED", result_path=self.get_result_path(job.job_id))

                logger.info(f"Worker {self.gpu_id}: Job {job.job_id} completed in {result.inference_time_ms:.1f} ms")

            except JobCancelled as e:
                logger.warning(f"Worker {self.gpu_id}: Job cancelled: {e}")
                if 'job' in locals():
                    self.update_job_status(job.job_id, "CANCELLED", error_message=str(e))
            except JobTimedOut as e:
                logger.error(f"Worker {self.gpu_id}: Job timed out: {e}")
                if 'job' in locals():
                    self.update_job_status(job.job_id, "FAILED", error_message=str(e))
            except Exception as e:
                logger.error(f"Worker {self.gpu_id}: Job failed: {e}", exc_info=True)

                if 'job' in locals():
                    self.update_job_status(job.job_id, "FAILED", error_message=str(e))

    def poll_job_queue(self) -> Optional[Job]:
        """
        Poll job queue for new jobs with GPU-aware load balancing.

        Uses round-robin assignment: job N goes to GPU (N mod total_workers).
        This ensures even distribution across GPUs.

        Returns:
            Job if found and assigned to this GPU, None otherwise
        """
        # Check GPU memory before accepting new job
        util, free_gb = self._check_gpu_memory()
        if util >= self.MAX_GPU_UTIL:
            logger.debug(f"Worker {self.gpu_id}: GPU memory at {util:.1%}, skipping job poll")
            return None

        pending_dir = self.job_queue_dir / "pending"
        pending_dir.mkdir(exist_ok=True)

        # List pending jobs sorted by creation time (oldest first)
        job_files = sorted(pending_dir.glob("*.json"), key=lambda p: p.stat().st_mtime)

        if not job_files:
            return None

        # Find jobs assigned to this GPU using round-robin
        # Each job gets assigned to a GPU based on its sequence number
        for idx, job_file in enumerate(job_files):
            # Check if this job is assigned to this worker
            # For proper load balancing, we assign jobs round-robin:
            # Job 0 -> GPU 0, Job 1 -> GPU 1, Job 2 -> GPU 0, etc.
            #
            # But we also need to handle the case where one worker is faster
            # and the other hasn't claimed its jobs yet. So we use file index.
            assigned_gpu = idx % max(self.total_workers, 1)

            if assigned_gpu != self.gpu_id:
                # Check if this job has been pending too long (stale assignment)
                # If a job's assigned worker hasn't claimed it in 30 seconds,
                # allow any worker to claim it
                try:
                    age_seconds = time.time() - job_file.stat().st_mtime
                    if age_seconds < 30:
                        continue  # Skip, let assigned worker claim it
                    else:
                        logger.info(
                            f"Worker {self.gpu_id}: Claiming stale job {job_file.name} "
                            f"(was assigned to GPU {assigned_gpu}, age={age_seconds:.0f}s)"
                        )
                except Exception:
                    continue

            # Try to claim this job (atomic move)
            claimed_dir = self.job_queue_dir / "processing"
            claimed_dir.mkdir(exist_ok=True)
            claimed_file = claimed_dir / job_file.name

            try:
                job_file.rename(claimed_file)

                # Read job
                with open(claimed_file, "r") as f:
                    job_data = json.load(f)

                job = Job(**job_data)

                # Update status to RUNNING
                self.update_job_status(job.job_id, "RUNNING", gpu_id=self.gpu_id, worker_pid=os.getpid())

                logger.info(f"Worker {self.gpu_id}: Claimed job {job.job_id}")
                return job

            except FileNotFoundError:
                # Another worker claimed it first - race condition
                logger.debug(f"Worker {self.gpu_id}: Job {job_file.name} already claimed by another worker")
                continue
            except Exception as e:
                logger.warning(f"Worker {self.gpu_id}: Failed to claim job {job_file}: {e}")
                continue

        return None

    def process_job(self, job: Job) -> HoralixAIOutput:
        """
        Execute full 8-stage pipeline with granular progress tracking.

        Progress breakdown:
        - Stage 0 (Ingest): 0-10%
        - Stage 1 (View Classification): 10-20%
        - Stage 2 (PanEcho): 20-35%
        - Stage 3 (EchoPrime): 35-50%
        - Stage 4 (Fusion): 50-55%
        - Stage 5 (Measurements): 55-75%
        - Stage 6 (EchoNet): 75-90%
        - Stage 7 (Normalize): 90-95%
        - Stage 8 (Persist): 95-100%

        Args:
            job: Job to process

        Returns:
            HoralixAIOutput with complete results
        """
        def progress_callback(stage: str, current: int, total: int, base: float, span: float):
            """Update progress within a stage."""
            if total > 0:
                stage_progress = current / total
                overall_progress = base + (stage_progress * span)
                self.update_job_status(job.job_id, "RUNNING", progress=overall_progress)
                logger.debug(f"Stage {stage}: {current}/{total} ({overall_progress:.1f}%)")
            self._tick_job()

        self._current_job_id = job.job_id
        self._current_job_start = time.time()
        stage_timings: dict[str, float] = {}
        self._patient_sex = None
        self._patient_height_cm = None
        self._patient_weight_kg = None
        self._patient_bmi = None
        self._patient_context_source = None

        if isinstance(job.patient_context, dict) and job.patient_context:
            ctx = job.patient_context
            self._patient_sex = ctx.get("sex") or None
            height_cm = ctx.get("height_cm") or ctx.get("heightCm")
            weight_kg = ctx.get("weight_kg") or ctx.get("weightKg")
            try:
                self._patient_height_cm = float(height_cm) if height_cm is not None else None
            except Exception:
                self._patient_height_cm = None
            try:
                self._patient_weight_kg = float(weight_kg) if weight_kg is not None else None
            except Exception:
                self._patient_weight_kg = None
            if self._patient_height_cm and self._patient_weight_kg:
                height_m = self._patient_height_cm / 100.0
                if height_m > 0:
                    self._patient_bmi = self._patient_weight_kg / (height_m * height_m)
            self._patient_context_source = "manual"

        try:
            with Timer() as timer:
                # Throttle if GPU memory is high
                self._throttle_if_needed()
                self._tick_job()

                # Stage 0: Ingest (0% -> 10%)
                stage_start = time.perf_counter()
                self.update_job_status(job.job_id, "RUNNING", progress=2.0)
                cine_bundles = self.stage_0_ingest(job.study_uid, job.series_uid)
                num_bundles = len(cine_bundles)
                self.update_job_status(job.job_id, "RUNNING", progress=10.0)
                stage_timings["stage_0_ms"] = (time.perf_counter() - stage_start) * 1000
                logger.info(f"Stage 0 complete: {num_bundles} cines loaded")

                if not cine_bundles:
                    # No data to process - return empty result
                    logger.warning(f"Job {job.job_id}: No cine data found, returning empty result")
                    return HoralixAIOutput(
                        study_uid=job.study_uid,
                        view_predictions={},
                        findings={},
                        overlays=[],
                        measurements=[],
                        curves=[],
                        report=StructuredReport(sections={}, text="No echocardiography cines found in study."),
                        inference_time_ms=timer.elapsed_ms,
                        gpu_id=self.gpu_id,
                        timestamp=datetime.now(),
                    )

                # Stage 1: View Classification (10% -> 20%)
                stage_start = time.perf_counter()
                self.update_job_status(job.job_id, "RUNNING", progress=12.0)
                view_predictions = self.stage_1_view_classification(cine_bundles)
                self.update_job_status(job.job_id, "RUNNING", progress=20.0)
                stage_timings["stage_1_ms"] = (time.perf_counter() - stage_start) * 1000
                logger.info(f"Stage 1 complete: {len(view_predictions)} views classified")

                # Stage 2: PanEcho Inference (20% -> 35%)
                stage_start = time.perf_counter()
                self.update_job_status(job.job_id, "RUNNING", progress=22.0)
                panecho_predictions = self.stage_2_panecho(
                    cine_bundles,
                    progress_callback=lambda c, t: progress_callback("PanEcho", c, t, 22.0, 13.0)
                )
                self.update_job_status(job.job_id, "RUNNING", progress=35.0)
                stage_timings["stage_2_ms"] = (time.perf_counter() - stage_start) * 1000
                logger.info(f"Stage 2 complete: PanEcho processed {len(panecho_predictions)} instances")

                # Stage 3: EchoPrime Inference (35% -> 50%)
                stage_start = time.perf_counter()
                self.update_job_status(job.job_id, "RUNNING", progress=37.0)
                echoprime_predictions = self.stage_3_echoprime(
                    cine_bundles,
                    progress_callback=lambda c, t: progress_callback("EchoPrime", c, t, 37.0, 13.0)
                )
                self.update_job_status(job.job_id, "RUNNING", progress=50.0)
                stage_timings["stage_3_ms"] = (time.perf_counter() - stage_start) * 1000
                logger.info(f"Stage 3 complete: EchoPrime processed {len(echoprime_predictions)} instances")

                # Throttle between heavy stages
                self._throttle_if_needed()
                self._tick_job()

                # Stage 4: Prediction Fusion (50% -> 55%)
                stage_start = time.perf_counter()
                self.update_job_status(job.job_id, "RUNNING", progress=52.0)
                combined_findings = self.stage_4_fusion(panecho_predictions, echoprime_predictions)
                self.update_job_status(job.job_id, "RUNNING", progress=55.0)
                stage_timings["stage_4_ms"] = (time.perf_counter() - stage_start) * 1000
                logger.info("Stage 4 complete: Predictions fused")

                # Stage 5: Measurements (2D) (55% -> 75%)
                measurements = []
                measurement_overlays = []
                stage_start = time.perf_counter()

                if job.enable_measurements and self.measurements_models:
                    self.update_job_status(job.job_id, "RUNNING", progress=57.0)
                    measurements, measurement_overlays = self.stage_5_measurements(
                        cine_bundles,
                        view_predictions,
                        progress_callback=lambda c, t: progress_callback("Measurements", c, t, 57.0, 18.0)
                    )
                self.update_job_status(job.job_id, "RUNNING", progress=75.0)
                stage_timings["stage_5_ms"] = (time.perf_counter() - stage_start) * 1000
                logger.info(f"Stage 5 complete: {len(measurements)} measurements")

                # Stage 6: EchoNet-Dynamic (optional) (75% -> 90%)
                echonet_results = []
                echonet_overlays = []
                stage_start = time.perf_counter()

                if job.enable_echonet and self.echonet_model:
                    self.update_job_status(job.job_id, "RUNNING", progress=77.0)
                    echonet_results, echonet_overlays = self.stage_6_echonet(
                        cine_bundles,
                        view_predictions,
                        progress_callback=lambda c, t: progress_callback("EchoNet", c, t, 77.0, 13.0)
                    )
                self.update_job_status(job.job_id, "RUNNING", progress=90.0)
                stage_timings["stage_6_ms"] = (time.perf_counter() - stage_start) * 1000
                logger.info(f"Stage 6 complete: {len(echonet_results)} curves, {len(echonet_overlays)} overlays")

                # Final throttle check
                self._throttle_if_needed()
                self._tick_job()

                # Stage 7: Normalize to Overlay Schema (90% -> 95%)
                stage_start = time.perf_counter()
                self.update_job_status(job.job_id, "RUNNING", progress=92.0)
                output = self.stage_7_normalize(
                    study_uid=job.study_uid,
                    findings=combined_findings,
                    measurements=measurements,
                    measurement_overlays=measurement_overlays,
                    echonet_results=echonet_results,
                    echonet_overlays=echonet_overlays,
                    view_predictions=view_predictions,
                )
                self.update_job_status(job.job_id, "RUNNING", progress=95.0)
                stage_timings["stage_7_ms"] = (time.perf_counter() - stage_start) * 1000
                logger.info("Stage 7 complete: Output normalized")

                # Stage 8: Persist (handled in save_results)
                output.inference_time_ms = timer.elapsed_ms
                output.gpu_id = self.gpu_id
                output.timestamp = datetime.now()

            # Log metrics
            total_frames = sum(bundle.num_frames for bundle in cine_bundles)
            log_inference_metrics(
                logger,
                job_id=job.job_id,
                study_uid=job.study_uid,
                model_name="horalix_ai",
                inference_time_ms=output.inference_time_ms,
                gpu_id=self.gpu_id,
                num_instances=len(cine_bundles),
                num_frames=total_frames,
                additional_metrics=stage_timings,
            )

            return output
        finally:
            self._current_job_id = None
            self._current_job_start = None

    def stage_0_ingest(self, study_uid: str, series_uid: Optional[str]) -> List[FrameBundle]:
        """
        Stage 0: Load DICOM study and extract frames.

        Loads each multi-frame DICOM instance (cine) as a separate FrameBundle
        with ALL its frames preserved. This is critical for echocardiography
        where each cine has 30-120 frames representing one cardiac cycle.

        Args:
            study_uid: Study UID
            series_uid: Optional series UID (if None, loads all US series)

        Returns:
            List of FrameBundles (one per cine instance)
        """
        logger.info(f"Stage 0: Ingesting study {study_uid}")

        # Reset per-study caches
        self._echoprime_cache = None
        self._view_confidences = {}
        self._view_diagnostics = {}
        self._echoprime_view_mapping_ok = True
        self._echoprime_view_mapping_reason = None
        self._echoprime_order_fingerprint = None
        self._echoprime_cine_index = {}
        self._patient_sex = None

        import asyncio
        import pydicom
        from app.services.dicom.storage import DicomStorageService

        # Initialize storage
        storage_service = DicomStorageService(storage_dir=self.settings.dicom.storage_dir)

        bundles = []

        def _load_frames_from_cache(instance_uid: str) -> Optional[tuple[list[np.ndarray], dict]]:
            """Attempt to reconstruct all frames for an instance from the frame cache."""
            if not self.frame_cache:
                return None
            cached = self.frame_cache.get(instance_uid, 0)
            if not cached:
                return None
            frame0, meta = cached
            num_frames = meta.get("num_frames")
            if not isinstance(num_frames, int) or num_frames <= 0:
                return None
            frames = [frame0]
            for i in range(1, num_frames):
                hit = self.frame_cache.get(instance_uid, i)
                if not hit:
                    return None
                frames.append(hit[0])
            return frames, meta

        try:
            # Get study path
            study_path = asyncio.run(storage_service.get_study_path(study_uid))

            # Cache study path for EchoPrime stages
            self._current_study_uid = study_uid
            self._current_study_path = study_path

            if study_path is None:
                logger.error(f"Study not found: {study_uid}")
                return bundles

            # Find series to process
            if series_uid:
                series_paths = [study_path / series_uid]
            else:
                # Load all series directories in study
                series_paths = [p for p in study_path.iterdir() if p.is_dir()]

            # Load each instance (cine) individually from each series
            for series_path in series_paths:
                if not series_path.exists():
                    continue

                series_id = series_path.name

                # Find all DICOM files in this series
                dcm_files = sorted(series_path.glob("*.dcm"))
                if not dcm_files:
                    continue

                for dcm_file in dcm_files:
                    try:
                        self._tick_job()
                        # Read header first to get identifiers without decoding pixels
                        ds_header = pydicom.dcmread(str(dcm_file), stop_before_pixels=True, force=True)
                        instance_uid = getattr(ds_header, "SOPInstanceUID", dcm_file.stem)

                        if self._patient_sex is None:
                            sex = getattr(ds_header, "PatientSex", None)
                            if sex:
                                self._patient_sex = str(sex)
                        if self._patient_height_cm is None:
                            size_m = getattr(ds_header, "PatientSize", None)
                            try:
                                if size_m is not None:
                                    size_m = float(size_m)
                                    if size_m > 0:
                                        self._patient_height_cm = size_m * 100.0
                            except Exception:
                                pass
                        if self._patient_weight_kg is None:
                            weight_kg = getattr(ds_header, "PatientWeight", None)
                            try:
                                if weight_kg is not None:
                                    weight_kg = float(weight_kg)
                                    if weight_kg > 0:
                                        self._patient_weight_kg = weight_kg
                            except Exception:
                                pass
                        if self._patient_context_source is None and (
                            self._patient_sex or self._patient_height_cm or self._patient_weight_kg
                        ):
                            self._patient_context_source = "dicom"

                        # Capture lightweight metadata for view fallback + patient context
                        meta_snapshot = {
                            "series_description": getattr(ds_header, "SeriesDescription", None),
                            "protocol_name": getattr(ds_header, "ProtocolName", None),
                            "view_position": getattr(ds_header, "ViewPosition", None),
                            "image_type": list(getattr(ds_header, "ImageType", [])) if hasattr(ds_header, "ImageType") else None,
                            "body_part_examined": getattr(ds_header, "BodyPartExamined", None),
                        }

                        # Serve from cache if available (avoids re-decoding)
                        cached = _load_frames_from_cache(str(instance_uid))
                        if cached:
                            rgb_frames, meta = cached
                            bundle = FrameBundle(
                                instance_uid=str(instance_uid),
                                series_uid=series_id,
                                frames=rgb_frames,
                                num_frames=len(rgb_frames),
                                pixel_spacing=meta.get("pixel_spacing"),
                                frame_time_ms=meta.get("frame_time_ms"),
                                metadata=meta.get("metadata", meta_snapshot),
                            )
                            bundles.append(bundle)
                            logger.info(
                                f"Loaded cine {instance_uid} from cache: {len(rgb_frames)} frames"
                            )
                            continue

                        # Check modality from header - skip non-US before decoding pixels
                        modality = getattr(ds_header, "Modality", "")
                        if modality != "US":
                            logger.debug(f"Skipping non-US instance: {dcm_file.stem} (modality: {modality})")
                            continue

                        # Cache miss: decode full pixel data
                        ds = pydicom.dcmread(str(dcm_file), force=True)
                        instance_uid = getattr(ds, "SOPInstanceUID", dcm_file.stem)

                        # Extract pixel array with ALL frames
                        pixel_array = ds.pixel_array  # (N, H, W) or (N, H, W, 3) or (H, W)

                        # Get number of frames
                        num_frames_tag = int(getattr(ds, "NumberOfFrames", 1))

                        # Skip single-frame static images (need cines for echo analysis)
                        if num_frames_tag <= 1 and pixel_array.ndim <= 2:
                            logger.debug(f"Skipping single-frame instance: {instance_uid}")
                            continue

                        # Convert pixel_array to list of RGB uint8 frames
                        rgb_frames = []

                        if pixel_array.ndim == 4:
                            # (N, H, W, C) - multi-frame color
                            for i in range(pixel_array.shape[0]):
                                frame = np.clip(pixel_array[i], 0, 255).astype(np.uint8)
                                if frame.shape[-1] == 1:
                                    frame = np.concatenate([frame] * 3, axis=-1)
                                elif frame.shape[-1] == 4:
                                    frame = frame[..., :3]
                                rgb_frames.append(frame)
                        elif pixel_array.ndim == 3:
                            if pixel_array.shape[-1] in (3, 4):
                                # (H, W, C) - single color frame
                                frame = np.clip(pixel_array, 0, 255).astype(np.uint8)
                                if frame.shape[-1] == 4:
                                    frame = frame[..., :3]
                                rgb_frames.append(frame)
                            else:
                                # (N, H, W) - multi-frame grayscale
                                for i in range(pixel_array.shape[0]):
                                    frame_u8 = np.clip(pixel_array[i], 0, 255).astype(np.uint8)
                                    rgb_frame = np.stack([frame_u8] * 3, axis=-1)
                                    rgb_frames.append(rgb_frame)
                        elif pixel_array.ndim == 2:
                            # (H, W) - single grayscale frame
                            frame_u8 = np.clip(pixel_array, 0, 255).astype(np.uint8)
                            rgb_frame = np.stack([frame_u8] * 3, axis=-1)
                            rgb_frames.append(rgb_frame)

                        if not rgb_frames:
                            continue

                        # Get pixel spacing
                        ps = getattr(ds, "PixelSpacing", None)
                        if ps:
                            pixel_spacing = (float(ps[0]), float(ps[1]))
                        else:
                            # Try SequenceOfUltrasoundRegions for US-specific spacing
                            regions = getattr(ds, "SequenceOfUltrasoundRegions", None)
                            if regions and len(regions) > 0:
                                region = regions[0]
                                dx = getattr(region, "PhysicalDeltaX", 0.015)
                                dy = getattr(region, "PhysicalDeltaY", 0.015)
                                # Convert cm to mm
                                pixel_spacing = (float(dy) * 10.0, float(dx) * 10.0)
                            else:
                                pixel_spacing = (0.15, 0.15)  # Default fallback

                        # Get frame time
                        frame_time = getattr(ds, "FrameTime", None)
                        if frame_time:
                            frame_time_ms = float(frame_time)
                        else:
                            cine_rate = getattr(ds, "CineRate", None) or getattr(ds, "RecommendedDisplayFrameRate", None)
                            if cine_rate:
                                frame_time_ms = 1000.0 / float(cine_rate)
                            else:
                                frame_time_ms = 33.0  # Default ~30 FPS

                        # Create FrameBundle - one per cine instance
                        bundle = FrameBundle(
                            instance_uid=str(instance_uid),
                            series_uid=series_id,
                            frames=rgb_frames,
                            num_frames=len(rgb_frames),
                            pixel_spacing=pixel_spacing,
                            frame_time_ms=frame_time_ms,
                            metadata=meta_snapshot,
                        )

                        bundles.append(bundle)

                        logger.info(
                            f"Loaded cine {instance_uid}: {len(rgb_frames)} frames, "
                            f"shape {rgb_frames[0].shape}, spacing {pixel_spacing}"
                        )

                        # Cache frames if enabled
                        if self.frame_cache:
                            cache_meta = {
                                "study_uid": study_uid,
                                "series_uid": series_id,
                                "num_frames": len(rgb_frames),
                                "pixel_spacing": pixel_spacing,
                                "frame_time_ms": frame_time_ms,
                                "metadata": meta_snapshot,
                            }
                            for i, frame in enumerate(rgb_frames):
                                self.frame_cache.put(str(instance_uid), i, frame, cache_meta)

                    except Exception as e:
                        logger.warning(f"Failed to load instance {dcm_file.stem}: {e}")
                        continue

        except Exception as e:
            logger.error(f"Stage 0 failed: {e}", exc_info=True)

        logger.info(f"Stage 0 complete: Loaded {len(bundles)} cine instances")

        return bundles

    def stage_1_view_classification(self, cine_bundles: List[FrameBundle]) -> Dict[str, str]:
        """
        Stage 1: Classify view for each instance using EchoPrime view classifier.

        Args:
            cine_bundles: List of frame bundles

        Returns:
            Dict mapping instance_uid to view_label
        """
        logger.info("Stage 1: Classifying views")

        view_predictions: Dict[str, str] = {}
        view_confidences: Dict[str, float] = {}
        view_diagnostics: Dict[str, Dict[str, Any]] = {}
        cine_uids = {bundle.instance_uid for bundle in cine_bundles} if cine_bundles else set()

        if not self.echoprime_model:
            return view_predictions

        study_uid = getattr(self, "_current_study_uid", None)
        if not study_uid:
            return view_predictions

        try:
            stack, instance_uids = self._load_echoprime_stack(study_uid)
            mapping_ok = getattr(self, "_echoprime_view_mapping_ok", True)
            mapping_reason = getattr(self, "_echoprime_view_mapping_reason", None)
            if stack is not None and instance_uids and mapping_ok:
                view_list, view_conf_list = self._predict_views_from_stack(stack)

                n = min(len(instance_uids), len(view_list), len(view_conf_list))
                for idx in range(n):
                    instance_uid = instance_uids[idx]
                    if cine_uids and instance_uid not in cine_uids:
                        continue
                    view_label = str(view_list[idx]) if view_list else "Unknown"
                    confidence = float(view_conf_list[idx]) if view_conf_list else 0.0
                    view_predictions[instance_uid] = view_label
                    view_confidences[instance_uid] = confidence
                    view_diagnostics[instance_uid] = {
                        "view_label": view_label,
                        "confidence": confidence,
                        "mapping_status": "ok",
                        "mapping_reason": None,
                    }

                for instance_uid in cine_uids:
                    if instance_uid in view_predictions:
                        continue
                    view_predictions[instance_uid] = "Unknown"
                    view_confidences[instance_uid] = 0.0
                    view_diagnostics[instance_uid] = {
                        "view_label": "Unknown",
                        "confidence": 0.0,
                        "mapping_status": "partial",
                        "mapping_reason": "uid_not_in_stack_mapping",
                    }

                logger.info(f"Stage 1 complete: Classified {len(view_predictions)} views")
            elif not mapping_ok:
                logger.warning(
                    f"EchoPrime mapping invalid for {study_uid}; assigning Unknown views (reason={mapping_reason})"
                )
                for instance_uid in cine_uids:
                    view_predictions[instance_uid] = "Unknown"
                    view_confidences[instance_uid] = 0.0
                    view_diagnostics[instance_uid] = {
                        "view_label": "Unknown",
                        "confidence": 0.0,
                        "mapping_status": "invalid",
                        "mapping_reason": mapping_reason or "mapping_invalid",
                    }
            else:
                logger.warning(f"EchoPrime stack unavailable for {study_uid}; assigning Unknown views")
                for instance_uid in cine_uids:
                    view_predictions[instance_uid] = "Unknown"
                    view_confidences[instance_uid] = 0.0
                    view_diagnostics[instance_uid] = {
                        "view_label": "Unknown",
                        "confidence": 0.0,
                        "mapping_status": "missing",
                        "mapping_reason": "stack_unavailable",
                    }

        except Exception as e:
            logger.error(f"Stage 1 failed: {e}", exc_info=True)
            for instance_uid in cine_uids:
                view_predictions[instance_uid] = "Unknown"
                view_confidences[instance_uid] = 0.0
                view_diagnostics[instance_uid] = {
                    "view_label": "Unknown",
                    "confidence": 0.0,
                    "mapping_status": "error",
                    "mapping_reason": "stage_1_exception",
                }

        # EchoPrime-only mode: do not apply fallback classifiers or metadata heuristics.
        # This keeps view labels strictly tied to EchoPrime process_dicoms + get_views.

        self._view_confidences = view_confidences
        self._view_diagnostics = view_diagnostics

        return view_predictions

    def stage_2_panecho(
        self,
        cine_bundles: List[FrameBundle],
        progress_callback: Optional[callable] = None,
    ) -> Dict:
        """
        Stage 2: Run PanEcho inference (39-task multi-task model).

        Args:
            cine_bundles: List of frame bundles
            progress_callback: Optional callback(current, total) for progress updates

        Returns:
            PanEcho predictions dict with per-instance results
        """
        logger.info("Stage 2: Running PanEcho inference")

        panecho_results = {}

        if not self.panecho_model or not cine_bundles:
            return panecho_results

        total = len(cine_bundles)

        try:
            with torch.no_grad():
                for idx, bundle in enumerate(cine_bundles):
                    if progress_callback:
                        progress_callback(idx, total)

                    if not bundle.frames:
                        continue

                    # Sample frames for PanEcho (needs 16 frames)
                    sampled_frames = sample_frames_for_panecho(bundle.frames)

                    # Preprocess frames
                    input_tensor = preprocess_for_panecho(sampled_frames)
                    input_tensor = input_tensor.to(self.device)

                    # Run inference
                    output = self.panecho_model(input_tensor)

                    # Parse output (39 tasks)
                    # PanEcho outputs a dict with keys for each task
                    # Store raw predictions for now
                    panecho_results[bundle.instance_uid] = {
                        "raw_output": {k: v.cpu().numpy().tolist() for k, v in output.items()},
                        "num_tasks": len(output),
                    }

                    logger.debug(f"PanEcho inference for {bundle.instance_uid}: {len(output)} tasks")

                if progress_callback:
                    progress_callback(total, total)

        except Exception as e:
            logger.error(f"Stage 2 failed: {e}", exc_info=True)

        logger.info(f"Stage 2 complete: Processed {len(panecho_results)} instances")

        return panecho_results

    def stage_3_echoprime(
        self,
        cine_bundles: List[FrameBundle],
        progress_callback: Optional[callable] = None,
    ) -> Dict:
        """
        Stage 3: Run EchoPrime inference (vision-language model).

        Produces per-instance video embeddings AND study-level clinical predictions
        via EchoPrime's MIL-based predict_metrics().

        Args:
            cine_bundles: List of frame bundles
            progress_callback: Optional callback(current, total) for progress updates

        Returns:
            EchoPrime predictions dict with per-instance embeddings and study-level metrics
        """
        logger.info("Stage 3: Running EchoPrime inference")

        echoprime_results: Dict[str, Any] = {}

        if not self.echoprime_model:
            return echoprime_results

        study_uid = getattr(self, "_current_study_uid", None)
        if not study_uid:
            return echoprime_results

        try:
            stack, instance_uids = self._load_echoprime_stack(study_uid)
            if stack is None or not instance_uids:
                return echoprime_results
            mapping_ok = getattr(self, "_echoprime_view_mapping_ok", True)

            total = len(instance_uids)
            if progress_callback:
                progress_callback(0, total)

            with torch.no_grad():
                # EchoPrime encode_study produces (N, 523) embeddings
                study_embeddings = self.echoprime_model.encode_study(stack)

                # Store per-instance embeddings only when mapping is trusted
                if mapping_ok:
                    n = min(len(instance_uids), study_embeddings.shape[0])
                    for idx in range(n):
                        instance_uid = instance_uids[idx]
                        emb = study_embeddings[idx]
                        echoprime_results[instance_uid] = {
                            "video_embeddings": emb.cpu().numpy().tolist(),
                            "embedding_dim": emb.shape[-1],
                        }

                        if progress_callback:
                            progress_callback(idx + 1, total)
                else:
                    logger.warning(
                        f"EchoPrime stack/UID mismatch for {study_uid}; skipping per-instance embeddings"
                    )
                    if progress_callback:
                        progress_callback(total, total)

                # Cache embeddings at study level if enabled
                if self.embedding_cache:
                    self.embedding_cache.put(
                        study_uid=study_uid,
                        model_name="echoprime",
                        data=study_embeddings.cpu().numpy(),
                        weights_hash="v1.0",
                    )

                # Study-level phenotypes
                try:
                    metrics = self.echoprime_model.predict_metrics(study_embeddings)
                    metrics_serialized: Dict[str, Any] = {}
                    for k, v in metrics.items():
                        if isinstance(v, torch.Tensor):
                            metrics_serialized[k] = v.cpu().numpy().tolist()
                        elif isinstance(v, (int, float, str, bool)):
                            metrics_serialized[k] = v
                        elif isinstance(v, dict):
                            metrics_serialized[k] = {
                                sk: sv.cpu().numpy().tolist() if isinstance(sv, torch.Tensor) else sv
                                for sk, sv in v.items()
                            }
                        else:
                            metrics_serialized[k] = str(v)
                    echoprime_results["_study_metrics"] = metrics_serialized
                    logger.info(f"EchoPrime predict_metrics: {len(metrics_serialized)} phenotypes")
                except Exception as e:
                    logger.warning(f"EchoPrime predict_metrics failed (non-fatal): {e}")

        except Exception as e:
            logger.error(f"Stage 3 failed: {e}", exc_info=True)

        logger.info(f"Stage 3 complete: Processed {len(echoprime_results)} instances")

        # Clear per-study EchoPrime cache to free memory
        self._echoprime_cache = None

        return echoprime_results

    def stage_4_fusion(self, panecho_preds: Dict, echoprime_preds: Dict) -> Dict:
        """
        Stage 4: Fuse predictions from PanEcho and EchoPrime using hospital-grade ensemble.

        Fusion strategy (hospital-grade):
        - Uses combine_predictions() for per-task configurable rules
        - Discrepancy detection flags when models disagree significantly
        - Per-task confidence thresholds for clinical safety
        - Multiple combining rules: average_value, positive_if_either_positive, prefer_model

        Args:
            panecho_preds: PanEcho predictions (per-instance raw outputs)
            echoprime_preds: EchoPrime predictions (per-instance embeddings + _study_metrics)

        Returns:
            Combined findings dict with 'panecho', 'echoprime', 'fused_metrics', 'integrated' keys
        """
        logger.info("Stage 4: Fusing predictions (hospital-grade ensemble)")

        combined = {
            "panecho": panecho_preds,
            "echoprime": {},
        }

        # Extract EchoPrime study-level metrics (from predict_metrics)
        study_metrics = echoprime_preds.pop("_study_metrics", None)

        # Store per-instance echoprime data (without embeddings for compact output)
        for inst_uid, inst_data in echoprime_preds.items():
            combined["echoprime"][inst_uid] = {
                "embedding_dim": inst_data.get("embedding_dim"),
            }

        if study_metrics:
            combined["echoprime_study_metrics"] = study_metrics

        def extract_scalar(val):
            """Extract scalar from [[value]] or [value] format."""
            v = val
            if isinstance(v, list):
                v = v[0] if v else None
                if isinstance(v, list):
                    v = v[0] if v else None
            if isinstance(v, (int, float)):
                return float(v)
            return None

        def _normalize_list(val: Any) -> Any:
            """Flatten single-nested lists like [[...]] -> [...]."""
            if isinstance(val, list) and len(val) == 1 and isinstance(val[0], list):
                return val[0]
            return val


        # Aggregate PanEcho outputs across instances (match Echocardiology_App)
        panecho_aggregated: Dict[str, Any] = {}
        if panecho_preds:
            panecho_values: Dict[str, List[Any]] = {}
            for _inst_uid, inst_data in panecho_preds.items():
                raw = inst_data.get("raw_output", inst_data) if isinstance(inst_data, dict) else {}
                if not isinstance(raw, dict):
                    continue
                for key, val in raw.items():
                    panecho_values.setdefault(key, []).append(_normalize_list(val))

            for key, vals in panecho_values.items():
                if not vals:
                    continue
                if all(isinstance(v, (int, float)) for v in vals):
                    panecho_aggregated[key] = float(np.mean(vals))
                    continue
                if all(isinstance(v, list) for v in vals):
                    try:
                        arr = np.array(vals, dtype=np.float32)
                        panecho_aggregated[key] = arr.mean(axis=0).tolist()
                        continue
                    except Exception:
                        panecho_aggregated[key] = vals[0]
                        continue
                panecho_aggregated[key] = vals[0]

        # Extract EchoPrime scalars from study_metrics (handle flat and nested)
        echoprime_scalars: Dict[str, float] = {}
        if study_metrics and isinstance(study_metrics, dict):
            for section_name, section_data in study_metrics.items():
                if isinstance(section_data, dict):
                    for metric_name, metric_val in section_data.items():
                        scalar = extract_scalar(metric_val)
                        if scalar is not None:
                            echoprime_scalars[metric_name] = scalar
                            echoprime_scalars[f"{section_name}_{metric_name}"] = scalar
                else:
                    scalar = extract_scalar(section_data)
                    if scalar is not None:
                        echoprime_scalars[section_name] = scalar

        # === Hospital-grade ensemble combining ===
        # Use Echocardiology_App thresholds and combine logic
        integrated_results = combine_predictions(
            panecho_predictions=panecho_aggregated,
            echoprime_predictions=echoprime_scalars,
            task_config=None,
        )

        # Build fused_metrics for backward compatibility with frontend
        fused_metrics: Dict[str, Any] = {}
        for task_key, result in integrated_results.items():
            val = result.get("integrated_value")
            if val is None:
                continue

            panecho_val = result.get("panecho_value_or_prob", result.get("panecho_value"))
            echoprime_val = result.get("echoprime_value_or_prob", result.get("echoprime_value"))
            sources = result.get("sources", []) or []

            fused_metrics[task_key] = {
                "value": round(val, 2) if isinstance(val, (int, float)) else val,
                "panecho": panecho_val,
                "echoprime": echoprime_val,
                "source": "fused" if len(sources) > 1 else (sources[0].lower() if sources else "unknown"),
                "confidence": "high" if len(sources) > 1 else "medium",
                "label": result.get("integrated_label"),
                "discrepancy": result.get("discrepancy"),
                "units": result.get("units"),
            }

            # UI compatibility: expose EF key if present
            if task_key == "ejection_fraction" and "EF" not in fused_metrics:
                fused_metrics["EF"] = fused_metrics[task_key]

        # Add PanEcho-only metrics not covered by task config
        for key, val in panecho_aggregated.items():
            if key not in fused_metrics and val is not None:
                fused_metrics[key] = {
                    "value": round(val, 2) if isinstance(val, (int, float)) else val,
                    "panecho": round(val, 2) if isinstance(val, (int, float)) else val,
                    "source": "panecho",
                }

        # Store all data for audit trail
        fused = {
            "panecho_aggregated": panecho_aggregated,
            "echoprime_phenotypes": study_metrics,
            "fused_metrics": fused_metrics,
            "integrated_results": integrated_results,
        }

        combined["panecho_aggregated"] = panecho_aggregated
        combined["fused"] = fused
        combined["fused_metrics"] = fused_metrics  # Direct access for frontend
        combined["integrated_tasks"] = integrated_results

        # Count discrepancies for logging
        discrepancy_count = sum(
            1 for r in integrated_results.values() if r.get("discrepancy")
        )

        logger.info(
            f"Fusion complete (hospital-grade): {len(panecho_aggregated)} PanEcho tasks, "
            f"{len(echoprime_scalars)} EchoPrime tasks, "
            f"{len(fused_metrics)} fused metrics, {discrepancy_count} discrepancies flagged"
        )

        return combined

    def stage_5_measurements(
        self,
        cine_bundles: List[FrameBundle],
        view_predictions: Dict[str, str],
        progress_callback: Optional[callable] = None,
    ) -> tuple[List[MeasurementRecord], List[LineOverlay]]:
        """
        Stage 5: Run 2D measurements (9 anatomical measurements).

        Processes ALL frames with batched inference (no sampling) to preserve quality.

        Args:
            cine_bundles: List of frame bundles
            view_predictions: View predictions per instance
            progress_callback: Optional callback(current, total) for progress updates

        Returns:
            Tuple of (measurements list, line overlays list)
        """
        mapping_ok = getattr(self, "_echoprime_view_mapping_ok", True)
        view_confidences = getattr(self, "_view_confidences", {}) or {}
        for bundle in cine_bundles:
            view_label = view_predictions.get(bundle.instance_uid, "Unknown")
            confidence = view_confidences.get(bundle.instance_uid)
            compatible = get_compatible_measurements(view_label, confidence=confidence)
            enabled_models = [name for name in compatible if name in self.runtime.measurements_models]

            skip_reason: Optional[str] = None
            if confidence is not None and confidence < VIEW_CONFIDENCE_THRESHOLD:
                skip_reason = "low_confidence"
            elif not mapping_ok:
                skip_reason = "mapping_invalid"
            elif not compatible:
                skip_reason = "incompatible_view_or_unknown"
            elif not enabled_models:
                skip_reason = "no_models_available"

            self._set_view_diagnostic(
                bundle.instance_uid,
                measurement_models=enabled_models,
                measurement_skip_reason=skip_reason,
            )

        return run_measurements_stage(
            cine_bundles=cine_bundles,
            view_predictions=view_predictions,
            view_confidences=view_confidences,
            patient_sex=getattr(self, "_patient_sex", None),
            measurements_models=self.runtime.measurements_models,
            device=self.runtime.device,
            batch_size=self.settings.ai.horalix_ai_measurements_batch,
            tick_job=self._tick_job,
            progress_callback=progress_callback,
        )

    def stage_6_echonet(
        self,
        cine_bundles: List[FrameBundle],
        view_predictions: Dict[str, str],
        progress_callback: Optional[callable] = None,
    ) -> tuple[List[CurveData], List[MaskOverlay]]:
        """
        Stage 6: Run EchoNet-Dynamic LV segmentation and EF curve generation.

        Args:
            cine_bundles: List of frame bundles
            view_predictions: View predictions per instance
            progress_callback: Optional callback(current, total) for progress updates

        Returns:
            Tuple of (curves list, mask overlays list)
        """
        logger.info("Stage 6: Running EchoNet-Dynamic")

        curves = []
        overlays = []

        if not self.echonet_model or not cine_bundles:
            return curves, overlays

        total = len(cine_bundles)

        try:
            # Use mixed precision for faster inference on modern GPUs (RTX 30xx, 40xx, 50xx)
            use_amp = self.settings.ai.horalix_ai_mixed_precision and self.device != "cpu"

            with torch.no_grad():
                for idx, bundle in enumerate(cine_bundles):
                    if progress_callback:
                        progress_callback(idx, total)
                    if not bundle.frames:
                        continue

                    # EchoNet-Dynamic is trained on apical-4-chamber (A4C) views.
                    # For clinical-grade safety, we restrict overlays to A4C only.
                    view_label = view_predictions.get(bundle.instance_uid, "Unknown")
                    confidence = getattr(self, "_view_confidences", {}).get(bundle.instance_uid)
                    if confidence is not None and confidence < max(0.7, VIEW_CONFIDENCE_THRESHOLD):
                        self._set_view_diagnostic(
                            bundle.instance_uid,
                            echonet_status="skipped",
                            echonet_skip_reason="low_confidence",
                        )
                        logger.debug(
                            f"Skipping EchoNet for {bundle.instance_uid}: view confidence {confidence:.2f} below 0.70"
                        )
                        continue
                    canonical_view = normalize_view_label(view_label)
                    ECHONET_VALID_VIEWS = ["A4C"]
                    if canonical_view not in ECHONET_VALID_VIEWS:
                        self._set_view_diagnostic(
                            bundle.instance_uid,
                            echonet_status="skipped",
                            echonet_skip_reason=f"unsupported_view:{canonical_view}",
                        )
                        logger.debug(
                            f"Skipping EchoNet for {bundle.instance_uid}: view={view_label} not in {ECHONET_VALID_VIEWS}"
                        )
                        continue

                    # Preprocess frames for EchoNet (112x112)
                    input_tensor, transform_meta = preprocess_for_echonet(bundle.frames)
                    input_tensor = input_tensor.to(self.device)

                    # Create coordinate transformer
                    transformer = CoordinateTransformer(transform_meta)

                    # Run inference with optional mixed precision
                    with torch.autocast(device_type="cuda", enabled=use_amp):
                        logits = self.echonet_model(input_tensor)["out"]

                    # Convert logits to binary masks (sigmoid + threshold)
                    probs = torch.sigmoid(logits)
                    masks = (probs > 0.5).cpu().numpy().astype(np.uint8)

                    # Extract volumes and EF curve
                    volumes_ml = []
                    frame_numbers = []
                    cine_overlays = []
                    allow_overlays = True
                    prev_area_ratio: Optional[float] = None

                    ultrasound_mask = self._build_ultrasound_mask(bundle.frames[0]) if bundle.frames else None

                    for frame_idx in range(masks.shape[0]):
                        mask = masks[frame_idx, 0]  # (112, 112)

                        # Upscale mask to DICOM resolution
                        mask_dicom = transformer.scale_mask_to_dicom(mask)

                        # Compute LV area from mask
                        area_px = np.sum(mask_dicom > 0)
                        frame_area = float(mask_dicom.shape[0] * mask_dicom.shape[1])
                        area_ratio = (area_px / frame_area) if frame_area > 0 else 0.0

                        # Quality gate: reject implausible masks (too small or too large)
                        if not area_ratio_valid(area_ratio):
                            if allow_overlays:
                                allow_overlays = False
                                cine_overlays = []
                                self._set_view_diagnostic(
                                    bundle.instance_uid,
                                    echonet_status="degraded",
                                    echonet_skip_reason="quality_gate_area_ratio",
                                )
                            continue

                        # Quality gate: centroid must remain inside ultrasound wedge
                        if ultrasound_mask is not None:
                            if ultrasound_mask.shape[:2] != mask_dicom.shape[:2]:
                                ultrasound_mask = None
                            else:
                                ys, xs = np.where(mask_dicom > 0)
                                if ys.size == 0 or xs.size == 0:
                                    if allow_overlays:
                                        allow_overlays = False
                                        cine_overlays = []
                                        self._set_view_diagnostic(
                                            bundle.instance_uid,
                                            echonet_status="degraded",
                                            echonet_skip_reason="quality_gate_empty_mask",
                                        )
                                    continue
                                cy = int(np.clip(np.mean(ys), 0, mask_dicom.shape[0] - 1))
                                cx = int(np.clip(np.mean(xs), 0, mask_dicom.shape[1] - 1))
                                if not ultrasound_mask[cy, cx]:
                                    if allow_overlays:
                                        allow_overlays = False
                                        cine_overlays = []
                                        self._set_view_diagnostic(
                                            bundle.instance_uid,
                                            echonet_status="degraded",
                                            echonet_skip_reason="quality_gate_outside_ultrasound",
                                        )
                                    continue

                        # Quality gate: area change between frames should be stable
                        if not area_change_valid(prev_area_ratio, area_ratio):
                            if allow_overlays:
                                allow_overlays = False
                                cine_overlays = []
                                self._set_view_diagnostic(
                                    bundle.instance_uid,
                                    echonet_status="degraded",
                                    echonet_skip_reason="quality_gate_area_change",
                                )
                        prev_area_ratio = area_ratio

                        area_cm2 = area_px * (bundle.pixel_spacing[0] / 10.0) * (bundle.pixel_spacing[1] / 10.0)

                        # Estimate volume using Simpson's method (simplified)
                        # V = (8/3pi) x A^2 / L, assume L ~= sqrt(A) x 1.5 for apical views
                        length_cm = np.sqrt(area_cm2) * 1.5
                        volume_ml = (8 / (3 * np.pi)) * (area_cm2**2) / length_cm if length_cm > 0 else 0

                        volumes_ml.append(volume_ml)
                        frame_numbers.append(frame_idx)

                        if allow_overlays:
                            # Create contour overlay for EVERY frame so the LV
                            # contour follows the cine smoothly across playback.
                            contours = extract_contours_from_mask(mask_dicom)

                            if contours:
                                # Use largest contour (LV should be the dominant structure)
                                largest_contour = max(contours, key=lambda c: len(c))

                                # Keep ALL points for maximum accuracy (hospital-grade)
                                # The contour is already at DICOM resolution after upscaling
                                polyline_points = [
                                    Point2D(x=float(pt[0]), y=float(pt[1]))
                                    for pt in largest_contour
                                ]

                                # Create polyline overlay for LV contour
                                contour_overlay = PolylineOverlay(
                                    id=f"{bundle.instance_uid}_lv_contour_{frame_idx}",
                                    type="polyline",
                                    label=f"LV ({volume_ml:.0f} mL)",
                                    target=OverlayTarget(
                                        series_uid=bundle.series_uid,
                                        instance_uid=bundle.instance_uid,
                                        frame_index=frame_idx,
                                    ),
                                    points_px=polyline_points,
                                    closed=True,  # LV contour is closed
                                    color="#FF0000",  # Red for LV
                                    line_width=2,
                                )

                                cine_overlays.append(contour_overlay)

                    if allow_overlays and cine_overlays:
                        overlays.extend(cine_overlays)
                        self._set_view_diagnostic(
                            bundle.instance_uid,
                            echonet_status="ok",
                            echonet_skip_reason=None,
                        )
                    elif not allow_overlays and cine_overlays:
                        self._set_view_diagnostic(
                            bundle.instance_uid,
                            echonet_status="degraded",
                            echonet_skip_reason="quality_gated_overlay",
                        )
                        logger.debug(
                            f"EchoNet overlays suppressed for {bundle.instance_uid}: failed quality gating"
                        )
                    else:
                        self._set_view_diagnostic(
                            bundle.instance_uid,
                            echonet_status="partial",
                            echonet_skip_reason="no_contours_extracted",
                        )

                    # Compute EF curve
                    if len(volumes_ml) >= 2:
                        volumes_array = np.array(volumes_ml)
                        edv = np.max(volumes_array)  # End-diastolic volume
                        esv = np.min(volumes_array)  # End-systolic volume
                        ef = ((edv - esv) / edv) * 100 if edv > 0 else 0

                        # Create EF curve data
                        # Convert frame numbers to time in ms (assuming frame_time_ms is available)
                        frame_time = bundle.frame_time_ms or 33.33  # Default to ~30fps if not specified
                        t_ms = [float(f * frame_time) for f in frame_numbers]

                        ed_frame_idx = int(np.argmax(volumes_array))  # Max volume = ED
                        es_frame_idx = int(np.argmin(volumes_array))  # Min volume = ES

                        ef_curve = CurveData(
                            name=f"LV Volume (EF: {ef:.1f}%)",
                            unit="mL",
                            instance_uid=bundle.instance_uid,
                            t_ms=t_ms,
                            y=volumes_ml,
                            markers={
                                "ED": ed_frame_idx,
                                "ES": es_frame_idx,
                            },
                        )

                        curves.append(ef_curve)

                        logger.debug(
                            f"EchoNet for {bundle.instance_uid}: "
                            f"EDV={edv:.1f} mL, ESV={esv:.1f} mL, EF={ef:.1f}%"
                        )
                    else:
                        self._set_view_diagnostic(
                            bundle.instance_uid,
                            echonet_status="skipped",
                            echonet_skip_reason="no_valid_frames",
                        )

                if progress_callback:
                    progress_callback(total, total)

        except Exception as e:
            logger.error(f"Stage 6 failed: {e}", exc_info=True)

        logger.info(f"Stage 6 complete: {len(curves)} curves, {len(overlays)} mask overlays")

        return curves, overlays

    def _extract_teichholz_ef(self, measurements: List[MeasurementRecord]) -> Optional[float]:
        values = [
            float(record.value)
            for record in measurements
            if record.measurement_type.lower() in ("ef_teichholz", "lvef_teichholz")
            and isinstance(record.value, (int, float))
        ]
        if not values:
            return None
        values.sort()
        mid = len(values) // 2
        if len(values) % 2 == 1:
            return float(values[mid])
        return float((values[mid - 1] + values[mid]) / 2)

    def stage_7_normalize(
        self,
        study_uid: str,
        findings: Dict,
        measurements: List[MeasurementRecord],
        measurement_overlays: List[LineOverlay],
        echonet_results: List[CurveData],
        echonet_overlays: List[MaskOverlay],
        view_predictions: Optional[Dict[str, str]] = None,
    ) -> HoralixAIOutput:
        """
        Stage 7: Normalize all results to overlay-first schema.

        Args:
            study_uid: Study UID
            findings: Combined findings dict
            measurements: Measurement records
            measurement_overlays: Measurement line overlays
            echonet_results: EchoNet curves
            echonet_overlays: EchoNet mask overlays
            view_predictions: View classification per instance

        Returns:
            HoralixAIOutput
        """
        logger.info("Stage 7: Normalizing output")

        # Combine all overlays
        all_overlays = []
        all_overlays.extend(measurement_overlays)
        all_overlays.extend(echonet_overlays)

        # Attach Teichholz EF into findings/fused metrics for UI + reporting
        teichholz_ef = self._extract_teichholz_ef(measurements)
        if teichholz_ef is not None:
            fused_metrics = findings.get("fused_metrics")
            if not isinstance(fused_metrics, dict):
                fused_metrics = {}
            fused_metrics["EF_Teichholz"] = {
                "value": round(teichholz_ef, 2),
                "source": "teichholz",
                "confidence": "medium",
            }
            findings["fused_metrics"] = fused_metrics

            derived_metrics = findings.get("derived_metrics")
            if not isinstance(derived_metrics, dict):
                derived_metrics = {}
            derived_metrics["EF_Teichholz"] = round(teichholz_ef, 2)
            findings["derived_metrics"] = derived_metrics

        # Generate structured report from findings
        report = self._generate_report(findings, measurements, echonet_results, view_predictions)

        # Build output
        height_cm = getattr(self, "_patient_height_cm", None)
        weight_kg = getattr(self, "_patient_weight_kg", None)
        bmi = getattr(self, "_patient_bmi", None)
        if bmi is None and height_cm and weight_kg:
            try:
                height_m = float(height_cm) / 100.0
                if height_m > 0:
                    bmi = float(weight_kg) / (height_m * height_m)
            except Exception:
                bmi = None

        output = HoralixAIOutput(
            study_uid=study_uid,
            view_predictions=view_predictions or {},
            view_confidences=getattr(self, "_view_confidences", {}) or {},
            view_diagnostics=getattr(self, "_view_diagnostics", {}) or {},
            patient_sex=getattr(self, "_patient_sex", None),
            patient_height_cm=height_cm,
            patient_weight_kg=weight_kg,
            patient_bmi=bmi,
            patient_context_source=getattr(self, "_patient_context_source", None),
            findings=findings,
            overlays=all_overlays,
            measurements=measurements,
            curves=echonet_results,
            report=report,
            inference_time_ms=0.0,  # Will be set by caller
            gpu_id=self.gpu_id,
        )

        return output

    def _generate_report(
        self,
        findings: Dict,
        measurements: List[MeasurementRecord],
        curves: List[CurveData],
        view_predictions: Optional[Dict[str, str]] = None,
    ) -> StructuredReport:
        """Generate a structured report from AI findings with clinical severity assessment."""
        import numpy as np
        from app.services.ai.horalix_ai.models.measurements_loader import get_measurement_model_info

        sections: Dict[str, Dict] = {}
        lines: list[str] = []

        # Clinical reference ranges for severity assessment
        REFERENCE_RANGES = {
            "EF": {"normal": (50, 100), "mild": (40, 49), "moderate": (30, 39), "severe": (0, 29), "unit": "%"},
            "LVEDV": {"normal": (56, 155), "mild": (156, 178), "moderate": (179, 201), "severe": (202, 999), "unit": "mL"},
            "LVESV": {"normal": (19, 58), "mild": (59, 70), "moderate": (71, 82), "severe": (83, 999), "unit": "mL"},
            "GLS": {"normal": (-25, -18), "mild": (-17, -14), "moderate": (-13, -10), "severe": (-9, 0), "unit": "%"},
            "E/e'": {"normal": (0, 8), "mild": (8, 14), "moderate": (14, 20), "severe": (20, 100), "unit": ""},
            "TAPSE": {"normal": (1.7, 4.0), "mild": (1.3, 1.69), "moderate": (1.0, 1.29), "severe": (0, 0.99), "unit": "cm"},
            "RVSP": {"normal": (0, 35), "mild": (36, 49), "moderate": (50, 64), "severe": (65, 200), "unit": "mmHg"},
        }

        def _severity(key: str, value: float) -> str:
            """Determine clinical severity from reference ranges."""
            ref = REFERENCE_RANGES.get(key)
            if not ref:
                return ""
            for sev in ["normal", "mild", "moderate", "severe"]:
                rng = ref.get(sev)
                if rng and rng[0] <= value <= rng[1]:
                    return sev
            return ""

        def _measurement_scalar(keys: list[str]) -> Optional[float]:
            vals = []
            for record in measurements:
                record_key = record.measurement_type.lower()
                if record_key in keys and isinstance(record.value, (int, float)):
                    vals.append(float(record.value))
            return float(np.median(vals)) if vals else None

        teichholz_ef = _measurement_scalar(["ef_teichholz", "lvef_teichholz"])

        # Extract PanEcho predictions (aggregate across instances)
        panecho = findings.get("panecho", {})
        if panecho and isinstance(panecho, dict):
            all_outputs = []
            for inst_data in panecho.values():
                if isinstance(inst_data, dict):
                    raw = inst_data.get("raw_output", inst_data)
                    if isinstance(raw, dict):
                        all_outputs.append(raw)

            if all_outputs:
                def _scalar(key: str) -> Optional[float]:
                    vals = []
                    for raw in all_outputs:
                        v = raw.get(key)
                        if isinstance(v, (int, float)):
                            vals.append(float(v))
                        elif isinstance(v, list):
                            inner = v[0] if v else None
                            if isinstance(inner, list) and inner:
                                inner = inner[0]
                            if isinstance(inner, (int, float)):
                                vals.append(float(inner))
                    return float(np.median(vals)) if vals else None

                def _classify(key: str, labels: list[str]) -> Optional[str]:
                    for raw in all_outputs:
                        v = raw.get(key)
                        if not isinstance(v, list):
                            continue
                        arr = v[0] if isinstance(v[0], list) else v
                        if not isinstance(arr, list) or len(arr) < 2:
                            continue
                        nums = [float(x) for x in arr if isinstance(x, (int, float))]
                        if nums:
                            idx = nums.index(max(nums))
                            return labels[idx] if idx < len(labels) else None
                    return None

                # LV section
                ef = _scalar("EF")
                lv_section = {}
                if ef is not None:
                    ef_pct = ef * 100 if ef <= 1 else ef
                    sev = _severity("EF", ef_pct)
                    lv_section["EF"] = f"{ef_pct:.0f}%"
                    lv_section["EF_severity"] = sev
                    if sev == "normal":
                        lines.append(f"LV ejection fraction is normal ({ef_pct:.0f}%).")
                    elif sev == "mild":
                        lines.append(f"LV ejection fraction is mildly reduced ({ef_pct:.0f}%).")
                    elif sev == "moderate":
                        lines.append(f"LV ejection fraction is moderately reduced ({ef_pct:.0f}%).")
                    else:
                        lines.append(f"LV ejection fraction is severely reduced ({ef_pct:.0f}%).")

                if teichholz_ef is not None:
                    teichholz_pct = teichholz_ef * 100 if teichholz_ef <= 1 else teichholz_ef
                    sev = _severity("EF", teichholz_pct)
                    lv_section["EF (Teichholz)"] = f"{teichholz_pct:.0f}%"
                    lv_section["EF_Teichholz_severity"] = sev
                    if ef is None:
                        if sev == "normal":
                            lines.append(
                                f"LV ejection fraction by Teichholz is normal ({teichholz_pct:.0f}%)."
                            )
                        elif sev == "mild":
                            lines.append(
                                f"LV ejection fraction by Teichholz is mildly reduced ({teichholz_pct:.0f}%)."
                            )
                        elif sev == "moderate":
                            lines.append(
                                f"LV ejection fraction by Teichholz is moderately reduced ({teichholz_pct:.0f}%)."
                            )
                        elif sev == "severe":
                            lines.append(
                                f"LV ejection fraction by Teichholz is severely reduced ({teichholz_pct:.0f}%)."
                            )
                        else:
                            lines.append(f"LV ejection fraction by Teichholz is {teichholz_pct:.0f}%.")

                lvedv = _scalar("LVEDV")
                if lvedv is not None:
                    sev = _severity("LVEDV", lvedv)
                    lv_section["LVEDV"] = f"{lvedv:.0f} mL"
                    lv_section["LVEDV_severity"] = sev
                    if sev not in ("normal", ""):
                        lines.append(f"LV end-diastolic volume is {sev}ly increased ({lvedv:.0f} mL).")

                gls = _scalar("GLS")
                if gls is not None:
                    sev = _severity("GLS", gls)
                    lv_section["GLS"] = f"{gls:.1f}%"
                    lv_section["GLS_severity"] = sev
                    if sev not in ("normal", ""):
                        lines.append(f"Global longitudinal strain is {sev}ly reduced ({gls:.1f}%).")

                lv_func = _classify("LVSystolicFunction", ["Abnormal", "Borderline", "Normal"])
                if lv_func:
                    lv_section["Systolic Function"] = lv_func

                lv_diast = _classify("LVDiastolicFunction", ["Abnormal", "Borderline", "Normal"])
                if lv_diast:
                    lv_section["Diastolic Function"] = lv_diast
                    if lv_diast != "Normal":
                        lines.append(f"LV diastolic function: {lv_diast.lower()}.")

                if lv_section:
                    sections["Left Ventricle"] = lv_section

        if teichholz_ef is not None and "Left Ventricle" not in sections:
            teichholz_pct = teichholz_ef * 100 if teichholz_ef <= 1 else teichholz_ef
            sev = _severity("EF", teichholz_pct)
            sections["Left Ventricle"] = {
                "EF (Teichholz)": f"{teichholz_pct:.0f}%",
                "EF_Teichholz_severity": sev,
            }
            if sev == "normal":
                lines.append(
                    f"LV ejection fraction by Teichholz is normal ({teichholz_pct:.0f}%)."
                )
            elif sev == "mild":
                lines.append(
                    f"LV ejection fraction by Teichholz is mildly reduced ({teichholz_pct:.0f}%)."
                )
            elif sev == "moderate":
                lines.append(
                    f"LV ejection fraction by Teichholz is moderately reduced ({teichholz_pct:.0f}%)."
                )
            elif sev == "severe":
                lines.append(
                    f"LV ejection fraction by Teichholz is severely reduced ({teichholz_pct:.0f}%)."
                )
            else:
                lines.append(f"LV ejection fraction by Teichholz is {teichholz_pct:.0f}%.")

                # RV section
                rv_section = {}
                rv_size = _classify("RVSize", ["Dilated", "Borderline", "Normal"])
                if rv_size:
                    rv_section["Size"] = rv_size
                    if rv_size != "Normal":
                        lines.append(f"RV size: {rv_size.lower()}.")

                tapse = _scalar("TAPSE")
                if tapse is not None:
                    sev = _severity("TAPSE", tapse)
                    rv_section["TAPSE"] = f"{tapse:.1f} cm"
                    rv_section["TAPSE_severity"] = sev
                    if sev not in ("normal", ""):
                        lines.append(f"TAPSE is {sev}ly reduced ({tapse:.1f} cm), suggesting RV systolic dysfunction.")

                rvsp = _scalar("RVSP")
                if rvsp is not None:
                    sev = _severity("RVSP", rvsp)
                    rv_section["RVSP"] = f"{rvsp:.0f} mmHg"
                    rv_section["RVSP_severity"] = sev
                    if sev not in ("normal", ""):
                        lines.append(f"Estimated RVSP is {sev}ly elevated ({rvsp:.0f} mmHg).")

                if rv_section:
                    sections["Right Ventricle"] = rv_section

                # Valves
                valve_section = {}
                for key, name, labels in [
                    ("AVStenosis", "AV Stenosis", ["Mild+", "None/Trace", "Severe"]),
                    ("AVRegurg", "AV Regurg.", ["Mild+", "Moderate+", "None/Trace"]),
                    ("MVRegurgitation", "MV Regurg.", ["Mild+", "Moderate+", "None/Trace"]),
                    ("TVRegurgitation", "TV Regurg.", ["Mild+", "Moderate+", "None/Trace"]),
                ]:
                    cls = _classify(key, labels)
                    if cls:
                        valve_section[name] = cls
                        if "none" not in cls.lower() and "trace" not in cls.lower():
                            lines.append(f"{name}: {cls.lower()}.")

                e_ea = _scalar("E|EAvg")
                if e_ea is not None:
                    sev = _severity("E/e'", e_ea)
                    valve_section["E/e' avg"] = f"{e_ea:.1f}"
                    valve_section["E/e'_severity"] = sev
                    if sev not in ("normal", ""):
                        lines.append(f"E/e' average is elevated ({e_ea:.1f}), suggesting increased filling pressures.")

                if valve_section:
                    sections["Valves"] = valve_section

                # Pericardium
                peri = _scalar("pericardial-effusion")
                if peri is not None and peri > 0.3:
                    sections["Pericardium"] = {"Effusion probability": f"{peri * 100:.0f}%"}
                    lines.append(f"Pericardial effusion detected (probability {peri * 100:.0f}%).")

        # EchoPrime study-level phenotypes
        echoprime_metrics = findings.get("echoprime_study_metrics")
        if echoprime_metrics and isinstance(echoprime_metrics, dict):
            ep_section = {}
            for section_name, section_data in echoprime_metrics.items():
                if isinstance(section_data, dict):
                    for finding_name, finding_val in section_data.items():
                        if isinstance(finding_val, (int, float)):
                            ep_section[f"{section_name}: {finding_name}"] = f"{finding_val:.2f}"
                        elif isinstance(finding_val, str):
                            ep_section[f"{section_name}: {finding_name}"] = finding_val
            if ep_section:
                sections["EchoPrime Phenotypes"] = ep_section

        # EchoNet section
        if curves:
            for curve in curves:
                if "volume" in curve.name.lower() or "lv" in curve.name.lower():
                    edv = max(curve.y) if curve.y else None
                    esv = min(curve.y) if curve.y else None
                    if edv and esv and edv > 0:
                        en_ef = ((edv - esv) / edv) * 100
                        sev = _severity("EF", en_ef)
                        sections["EchoNet-Dynamic"] = {
                            "EDV": f"{edv:.0f} {curve.unit}",
                            "ESV": f"{esv:.0f} {curve.unit}",
                            "EF": f"{en_ef:.0f}%",
                            "EF_severity": sev,
                        }

        # View classification summary - show ALL views with their instance UIDs
        if view_predictions:
            from collections import Counter
            view_counts = Counter(view_predictions.values())

            # Create views section with counts
            views_section = {}
            for view, count in view_counts.most_common():
                views_section[view] = f"{count} cine(s)"

            # Add detailed per-cine breakdown
            view_details = {}
            for inst_uid, view in view_predictions.items():
                short_uid = inst_uid[-8:] if len(inst_uid) > 8 else inst_uid
                view_details[short_uid] = view

            sections["Views"] = views_section
            sections["Cine Details"] = view_details

            # Add views to report text
            view_summary = ", ".join([f"{v} ({c})" for v, c in view_counts.most_common()])
            lines.append(f"Analyzed {len(view_predictions)} cines: {view_summary}.")

        # Measurement summary with reference ranges
        if measurements:
            meas_info = get_measurement_model_info()
            meas_section = {}
            for m in measurements:
                # Look up reference range for this measurement
                meas_key = m.measurement_type.rsplit("_", 1)[0]  # e.g., "la_ED" -> "la"
                info = meas_info.get(meas_key, {})
                normal_range = info.get("normal_range")

                display = f"{m.value:.2f} {m.unit}"
                if normal_range:
                    low, high = normal_range
                    if m.value < low:
                        display += " (below normal)"
                        lines.append(f"{m.measurement_name} is below normal range ({m.value:.2f} {m.unit}, ref: {low}-{high} {m.unit}).")
                    elif m.value > high:
                        display += " (above normal)"
                        lines.append(f"{m.measurement_name} is above normal range ({m.value:.2f} {m.unit}, ref: {low}-{high} {m.unit}).")
                    else:
                        display += " (normal)"

                meas_section[m.measurement_name] = display

            sections["Measurements"] = meas_section

        text = " ".join(lines) if lines else "All assessed parameters within normal limits."

        return StructuredReport(sections=sections, text=text)

    def save_results(self, job_id: str, result: HoralixAIOutput):
        """Save results to shared volume."""
        result_file = self.get_result_path(job_id)
        result_file.parent.mkdir(parents=True, exist_ok=True)

        with open(result_file, "w") as f:
            json.dump(result.model_dump(), f, indent=2, default=str)

        logger.info(f"Results saved to {result_file}")

    def get_result_path(self, job_id: str) -> Path:
        """Get result file path for job."""
        return self.results_dir / f"{job_id}.json"

    def update_job_status(
        self,
        job_id: str,
        status: str,
        gpu_id: Optional[int] = None,
        worker_pid: Optional[int] = None,
        error_message: Optional[str] = None,
        result_path: Optional[Path] = None,
        progress: Optional[float] = None,
    ):
        """Update job status file."""
        status_dir = self.job_queue_dir / "status"
        status_dir.mkdir(exist_ok=True)
        status_file = status_dir / f"{job_id}.json"

        # Read existing status
        if status_file.exists():
            with open(status_file, "r") as f:
                status_data = json.load(f)
            job_status = JobStatus(**status_data)
        else:
            job_status = JobStatus(job_id=job_id, status="PENDING")

        # Update fields
        job_status.status = status

        if gpu_id is not None:
            job_status.gpu_id = gpu_id

        if worker_pid is not None:
            job_status.worker_pid = worker_pid

        if error_message is not None:
            job_status.error_message = error_message

        if result_path is not None:
            job_status.result_path = str(result_path)

        if progress is not None:
            job_status.progress = progress

        # Update timestamps
        now = datetime.now()

        if status == "RUNNING":
            if job_status.started_at is None:
                job_status.started_at = now
        elif status in ["COMPLETED", "FAILED", "CANCELLED"]:
            if job_status.completed_at is None:
                job_status.completed_at = now

        # Write status
        with open(status_file, "w") as f:
            json.dump(job_status.model_dump(), f, indent=2, default=str)


def main():
    """Entry point for worker process."""
    parser = argparse.ArgumentParser(description="Horalix AI Worker")
    parser.add_argument("--gpu-id", type=int, required=True, help="GPU ID (0 or 1)")
    args = parser.parse_args()

    # Initialize worker
    worker = HoralixAIWorker(gpu_id=args.gpu_id)

    # Load models
    worker.load_models()

    # Run worker loop
    worker.run()


if __name__ == "__main__":
    main()
