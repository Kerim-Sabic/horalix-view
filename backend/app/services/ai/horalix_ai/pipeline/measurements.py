from __future__ import annotations

import math
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np
import torch

from app.services.ai.horalix_ai.postprocessing import (
    CoordinateTransformer,
    compute_distance_statistics,
    compute_length_cm,
    extract_keypoints_from_logits,
)
from app.services.ai.horalix_ai.preprocessing import preprocess_for_measurements
from app.services.ai.horalix_ai.schema import (
    FrameBundle,
    LineOverlay,
    MeasurementRecord,
    OverlayTarget,
    Point2D,
)
from app.services.ai.horalix_ai.utils import (
    get_compatible_measurements,
    get_logger,
    validate_measurement,
)

logger = get_logger(__name__)

def compute_teichholz_ef(measurements: List[MeasurementRecord]) -> List[MeasurementRecord]:
    """Legacy compatibility helper; not emitted by the clinical pipeline.

    ASE chamber guidance no longer recommends deriving LV volumes or EF from a
    single linear dimension because the fixed-shape assumption fails in
    remodelled ventricles. New results use reviewed Simpson A4C/A2C contours.
    """
    by_instance: Dict[Optional[str], Dict[str, MeasurementRecord]] = {}
    for record in measurements:
        measurement_type = record.measurement_type.lower()
        if measurement_type == "lvid_ed":
            by_instance.setdefault(record.instance_uid, {})["ed"] = record
        elif measurement_type == "lvid_es":
            by_instance.setdefault(record.instance_uid, {})["es"] = record

    derived: List[MeasurementRecord] = []
    for instance_uid, entries in by_instance.items():
        ed = entries.get("ed")
        es = entries.get("es")
        if not ed or not es:
            continue
        ed_diam = float(ed.value)
        es_diam = float(es.value)
        if ed_diam <= 0 or es_diam <= 0:
            continue

        edv = (7.0 / (2.4 + ed_diam)) * (ed_diam ** 3)
        esv = (7.0 / (2.4 + es_diam)) * (es_diam ** 3)
        if edv <= 0:
            continue

        ef = ((edv - esv) / edv) * 100
        derived.append(
            MeasurementRecord(
                measurement_type="ef_teichholz",
                measurement_name="LVEF Teichholz",
                value=round(ef, 2),
                unit="%",
                instance_uid=instance_uid,
                frame_number=ed.frame_number,
                view=ed.view,
                method="Teichholz",
            )
        )

    return derived


def run_measurements_stage(
    *,
    cine_bundles: List[FrameBundle],
    view_predictions: Dict[str, str],
    view_confidences: Optional[Dict[str, float]] = None,
    patient_sex: Optional[str] = None,
    measurements_models: Dict[str, torch.nn.Module],
    device: str,
    batch_size: int,
    tick_job: Optional[Callable[[], None]] = None,
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> Tuple[List[MeasurementRecord], List[LineOverlay]]:
    """
    Run 2D measurements across all frames with batched inference.
    """
    logger.info("Stage 5: Running 2D measurements (batched)")

    measurements: List[MeasurementRecord] = []
    overlays: List[LineOverlay] = []

    if not measurements_models or not cine_bundles:
        return measurements, overlays

    batch_size = max(1, int(batch_size))

    total_steps = 0
    bundle_plans: list[tuple[FrameBundle, str, list[str], int, int]] = []
    for bundle in cine_bundles:
        if not bundle.frames:
            continue
        view_label = view_predictions.get(bundle.instance_uid, "Unknown")
        confidence = view_confidences.get(bundle.instance_uid) if view_confidences else None
        compatible = get_compatible_measurements(view_label, confidence=confidence)
        if not compatible:
            continue
        compatible = [m for m in compatible if m in measurements_models]
        if not compatible:
            continue
        n_frames = len(bundle.frames)
        num_batches = max(1, math.ceil(n_frames / batch_size))
        total_steps += num_batches * len(compatible)
        bundle_plans.append((bundle, view_label, compatible, n_frames, num_batches))

    if total_steps == 0:
        return measurements, overlays

    step = 0

    def tick() -> None:
        if tick_job:
            tick_job()

    try:
        with torch.no_grad():
            for bundle, view_label, compatible_measurements, n_frames, _num_batches in bundle_plans:
                if progress_callback:
                    progress_callback(step, total_steps)
                tick()

                input_tensor, transform_meta = preprocess_for_measurements(bundle.frames)
                if device != "cpu":
                    input_tensor = input_tensor.pin_memory()

                transformer = CoordinateTransformer(transform_meta)

                for measurement_name in compatible_measurements:
                    model = measurements_models.get(measurement_name)
                    if not model:
                        continue

                    try:
                        all_keypoints = []
                        for batch_start in range(0, n_frames, batch_size):
                            batch_end = min(batch_start + batch_size, n_frames)
                            batch_tensor = input_tensor[batch_start:batch_end].to(
                                device,
                                non_blocking=True,
                            )

                            logits = model(batch_tensor)["out"]
                            keypoints_batch = extract_keypoints_from_logits(logits, softmax=False)
                            all_keypoints.append(keypoints_batch)

                            step += 1
                            if progress_callback:
                                progress_callback(step, total_steps)
                            tick()

                        keypoints_model = (
                            np.concatenate(all_keypoints, axis=0)
                            if len(all_keypoints) > 1
                            else all_keypoints[0]
                        )

                        keypoints_dicom = transformer.model_to_dicom(keypoints_model)

                        min_pixel_separation = 5.0
                        valid_frame_indices = []
                        for frame_i in range(keypoints_dicom.shape[0]):
                            kp1, kp2 = keypoints_dicom[frame_i]
                            sep = np.sqrt((kp1[0] - kp2[0]) ** 2 + (kp1[1] - kp2[1]) ** 2)
                            if sep >= min_pixel_separation:
                                valid_frame_indices.append(frame_i)

                        if len(valid_frame_indices) < 2:
                            logger.warning(
                                f"Measurement {measurement_name} for {bundle.instance_uid}: "
                                f"Only {len(valid_frame_indices)} valid frames (need >=2), skipping"
                            )
                            continue

                        valid_keypoints = keypoints_dicom[valid_frame_indices]
                        distance_stats = compute_distance_statistics(
                            valid_keypoints,
                            bundle.pixel_spacing,
                        )

                        ed_valid_idx = distance_stats["frame_max"]
                        es_valid_idx = distance_stats["frame_min"]
                        ed_frame_idx = valid_frame_indices[ed_valid_idx]
                        es_frame_idx = valid_frame_indices[es_valid_idx]

                        min_valid_cm = 0.1

                        for phase, frame_idx in [("ED", ed_frame_idx), ("ES", es_frame_idx)]:
                            kpt1, kpt2 = keypoints_dicom[frame_idx]
                            distance_cm = compute_length_cm(kpt1, kpt2, bundle.pixel_spacing)

                            if distance_cm < min_valid_cm:
                                logger.warning(
                                    f"Measurement {measurement_name} {phase}: "
                                    f"{distance_cm:.3f} cm < {min_valid_cm} cm threshold, skipping"
                                )
                                continue

                            measurement_record = MeasurementRecord(
                                measurement_type=f"{measurement_name}_{phase}",
                                measurement_name=f"{measurement_name.upper()} {phase}",
                                value=round(distance_cm, 2),
                                unit="cm",
                                instance_uid=bundle.instance_uid,
                                frame_number=int(frame_idx),
                                view=view_label,
                                method="DeepLabV3_keypoints",
                            )

                            measurements.append(measurement_record)

                            line_overlay = LineOverlay(
                                id=f"{bundle.instance_uid}_{measurement_name}_{phase}",
                                type="line",
                                label=f"{measurement_name.upper()} {phase}: {distance_cm:.2f} cm",
                                target=OverlayTarget(
                                    series_uid=bundle.series_uid,
                                    instance_uid=bundle.instance_uid,
                                    frame_index=int(frame_idx),
                                ),
                                start_px=Point2D(x=float(kpt1[0]), y=float(kpt1[1])),
                                end_px=Point2D(x=float(kpt2[0]), y=float(kpt2[1])),
                                color="#00FF00",
                                line_width=2,
                                measurement_value=round(distance_cm, 2),
                                measurement_unit="cm",
                            )

                            overlays.append(line_overlay)

                        logger.debug(
                            f"Measurement {measurement_name} for {bundle.instance_uid} "
                            f"(view={view_label}, {len(valid_frame_indices)}/{n_frames} valid frames): "
                            f"ED={distance_stats['max_cm']:.2f} cm, ES={distance_stats['min_cm']:.2f} cm"
                        )

                    except Exception as exc:
                        logger.error(
                            f"Measurement {measurement_name} failed for {bundle.instance_uid}: {exc}"
                        )

            if progress_callback:
                progress_callback(total_steps, total_steps)

    except Exception as exc:
        logger.error(f"Stage 5 failed: {exc}", exc_info=True)

    logger.info(f"Stage 5 complete: {len(measurements)} measurements, {len(overlays)} overlays")

    # Attach clinical validation metadata (hospital-grade)
    validated: List[MeasurementRecord] = []
    for record in measurements:
        try:
            validation = validate_measurement(
                record.measurement_type,
                float(record.value),
                patient_sex,
            )
        except Exception:
            validation = None
        validated.append(record.model_copy(update={"validation": validation}))

    measurements = validated

    return measurements, overlays
