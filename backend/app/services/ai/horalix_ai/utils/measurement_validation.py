"""
Hospital-grade measurement validation.

Validates AI-generated echocardiographic measurements against clinical
normal ranges from ASE (American Society of Echocardiography) guidelines.

Provides:
- Normal/borderline/abnormal classification per measurement
- Physiologically impossible value rejection
- Sex-specific reference ranges where applicable
"""

from typing import Any, Dict, List, Optional, Tuple
import logging

logger = logging.getLogger(__name__)


# ============================================================================
# Clinical Reference Ranges (ASE Guidelines)
# Format: (min_normal, max_normal, min_plausible, max_plausible, unit)
# min/max_plausible: values outside this range are physiologically impossible
# ============================================================================

REFERENCE_RANGES: Dict[str, Dict[str, Tuple[float, float, float, float, str]]] = {
    # Measurement: {sex: (normal_min, normal_max, plausible_min, plausible_max, unit)}
    "ivs_ED": {
        "male":   (0.6, 1.0, 0.2, 2.5, "cm"),
        "female": (0.6, 0.9, 0.2, 2.5, "cm"),
        "unisex": (0.6, 1.0, 0.2, 2.5, "cm"),
    },
    "ivs_ES": {
        "unisex": (0.9, 1.6, 0.3, 3.0, "cm"),
    },
    "lvid_ED": {
        "male":   (4.2, 5.8, 2.0, 9.0, "cm"),
        "female": (3.8, 5.2, 2.0, 9.0, "cm"),
        "unisex": (3.8, 5.8, 2.0, 9.0, "cm"),
    },
    "lvid_ES": {
        "male":   (2.5, 4.0, 1.0, 7.0, "cm"),
        "female": (2.2, 3.5, 1.0, 7.0, "cm"),
        "unisex": (2.2, 4.0, 1.0, 7.0, "cm"),
    },
    "lvpw_ED": {
        "male":   (0.6, 1.0, 0.2, 2.5, "cm"),
        "female": (0.6, 0.9, 0.2, 2.5, "cm"),
        "unisex": (0.6, 1.0, 0.2, 2.5, "cm"),
    },
    "lvpw_ES": {
        "unisex": (0.9, 1.6, 0.3, 3.0, "cm"),
    },
    "aortic_root_ED": {
        "male":   (2.0, 3.7, 1.0, 6.0, "cm"),
        "female": (2.0, 3.4, 1.0, 6.0, "cm"),
        "unisex": (2.0, 3.7, 1.0, 6.0, "cm"),
    },
    "la_ED": {
        "male":   (3.0, 4.0, 1.5, 7.0, "cm"),
        "female": (2.7, 3.8, 1.5, 7.0, "cm"),
        "unisex": (2.7, 4.0, 1.5, 7.0, "cm"),
    },
    "ef_teichholz": {
        "unisex": (52.0, 72.0, 5.0, 95.0, "%"),
    },
    "rv_base_ED": {
        "unisex": (2.5, 4.1, 1.0, 7.0, "cm"),
    },
    "tapse_ES": {
        "unisex": (1.6, 3.0, 0.5, 5.0, "cm"),
    },
    "pa_ED": {
        "unisex": (1.5, 2.5, 0.5, 5.0, "cm"),
    },
    "ivc_ED": {
        "unisex": (1.5, 2.1, 0.5, 4.0, "cm"),
    },
}


def _normalize_sex(sex: Any) -> str:
    """Normalize sex to 'male', 'female', or 'unisex'."""
    if sex is None:
        return "unisex"
    cleaned = str(sex).strip().lower()
    if cleaned in ("m", "male"):
        return "male"
    if cleaned in ("f", "female"):
        return "female"
    return "unisex"


def validate_measurement(
    measurement_type: str,
    value: float,
    patient_sex: Any = None,
) -> Dict[str, Any]:
    """
    Validate a measurement against clinical reference ranges.

    Args:
        measurement_type: Measurement type key (e.g., "lvid_ED")
        value: Measured value
        patient_sex: Patient sex ("M"/"F"/"male"/"female" or None)

    Returns:
        Dict with:
            - status: "normal" | "borderline" | "abnormal" | "implausible" | "unknown"
            - normal_min: Lower bound of normal range
            - normal_max: Upper bound of normal range
            - unit: Unit of measurement
            - message: Human-readable assessment
    """
    ranges = REFERENCE_RANGES.get(measurement_type)
    if not ranges:
        return {
            "status": "unknown",
            "message": f"No reference range for {measurement_type}",
        }

    sex = _normalize_sex(patient_sex)
    sex_range = ranges.get(sex) or ranges.get("unisex")
    if not sex_range:
        return {
            "status": "unknown",
            "message": f"No reference range for {measurement_type} ({sex})",
        }

    normal_min, normal_max, plausible_min, plausible_max, unit = sex_range

    # Check for physiologically impossible values
    if value < plausible_min or value > plausible_max:
        logger.warning(
            f"Implausible measurement rejected: {measurement_type}={value} {unit} "
            f"(plausible range: {plausible_min}-{plausible_max})"
        )
        return {
            "status": "implausible",
            "normal_min": normal_min,
            "normal_max": normal_max,
            "plausible_min": plausible_min,
            "plausible_max": plausible_max,
            "unit": unit,
            "message": (
                f"{measurement_type}={value:.2f} {unit} is physiologically implausible "
                f"(expected {plausible_min}-{plausible_max} {unit})"
            ),
        }

    # Determine clinical status
    if normal_min <= value <= normal_max:
        status = "normal"
        message = f"{measurement_type}={value:.2f} {unit} (normal)"
    else:
        # Borderline = within 20% of normal range boundary
        borderline_margin = (normal_max - normal_min) * 0.2
        if (
            (normal_min - borderline_margin) <= value < normal_min
            or normal_max < value <= (normal_max + borderline_margin)
        ):
            status = "borderline"
            message = f"{measurement_type}={value:.2f} {unit} (borderline)"
        else:
            status = "abnormal"
            direction = "low" if value < normal_min else "high"
            message = f"{measurement_type}={value:.2f} {unit} (abnormally {direction})"

    return {
        "status": status,
        "normal_min": normal_min,
        "normal_max": normal_max,
        "unit": unit,
        "message": message,
    }


def validate_measurement_batch(
    measurements: List[Dict[str, Any]],
    patient_sex: Any = None,
) -> List[Dict[str, Any]]:
    """
    Validate a batch of measurements. Filters out implausible values.

    Args:
        measurements: List of measurement dicts with 'measurement_type' and 'value'
        patient_sex: Patient sex

    Returns:
        List of measurements with 'validation' field added.
        Implausible measurements are flagged but NOT removed (for audit trail).
    """
    validated = []
    for m in measurements:
        mtype = m.get("measurement_type", "")
        value = m.get("value")
        if value is None:
            validated.append(m)
            continue

        validation = validate_measurement(mtype, float(value), patient_sex)
        enriched = {**m, "validation": validation}
        validated.append(enriched)

    # Log summary
    statuses = [m.get("validation", {}).get("status", "unknown") for m in validated]
    implausible_count = statuses.count("implausible")
    abnormal_count = statuses.count("abnormal")
    if implausible_count > 0:
        logger.warning(
            f"Measurement validation: {implausible_count} implausible values detected"
        )
    if abnormal_count > 0:
        logger.info(f"Measurement validation: {abnormal_count} abnormal values")

    return validated
