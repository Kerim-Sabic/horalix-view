"""
View-based measurement gating.

Determines which measurement models are compatible with which echocardiographic views.

EchoPrime View Classifier outputs (11 classes, ConvNeXt Base):
    A2C, A3C, A4C, A5C,
    Apical_Doppler,
    Doppler_Parasternal_Long, Doppler_Parasternal_Short,
    Parasternal_Long, Parasternal_Short,
    SSN (Suprasternal), Subcostal

Example: IVS/LVID/LVPW measurements only apply to Parasternal_Long (PLAX) views.
"""

from typing import Dict, List, Optional

# ============================================================================
# Canonical EchoPrime view labels
# ============================================================================

ECHOPRIME_VIEW_CLASSES: List[str] = [
    "A2C",
    "A3C",
    "A4C",
    "A5C",
    "Apical_Doppler",
    "Doppler_Parasternal_Long",
    "Doppler_Parasternal_Short",
    "Parasternal_Long",
    "Parasternal_Short",
    "SSN",
    "Subcostal",
]

# Legacy label aliases -> canonical EchoPrime label
# This handles the case where labels come from other classifiers or user input
VIEW_LABEL_ALIASES: Dict[str, str] = {
    "PLAX": "Parasternal_Long",
    "plax": "Parasternal_Long",
    "Parasternal Long": "Parasternal_Long",
    "PSAX": "Parasternal_Short",
    "psax": "Parasternal_Short",
    "Parasternal Short": "Parasternal_Short",
    "PSAX_AV": "Parasternal_Short",
    "PSAX_MV": "Parasternal_Short",
    "PSAX_PM": "Parasternal_Short",
    "PSAX_AP": "Parasternal_Short",
    "a2c": "A2C",
    "a3c": "A3C",
    "a4c": "A4C",
    "a5c": "A5C",
    "RV_Inflow": "A4C",
    "RV_Outflow": "Parasternal_Short",
    "Suprasternal": "SSN",
    "suprasternal": "SSN",
    "subcostal": "Subcostal",
}

# ============================================================================
# Minimum confidence for view classification to be trusted
# Below this threshold, measurements are skipped (hospital-grade safety)
# ============================================================================

VIEW_CONFIDENCE_THRESHOLD: float = 0.70


# ============================================================================
# View -> compatible measurement models
# Uses canonical EchoPrime labels exclusively
# ============================================================================

VIEW_COMPATIBLE_MEASUREMENTS: Dict[str, List[str]] = {
    # A4C: EchoNet LV + RV basal diameter
    "rv_base": ["A4C"],

    # Parasternal long axis (PLAX): core 2D measurements
    "aorta": ["Parasternal_Long"],
    "aortic_root": ["Parasternal_Long"],
    "ivc": ["Parasternal_Long"],
    "ivs": ["Parasternal_Long"],
    "la": ["Parasternal_Long"],
    "lvid": ["Parasternal_Long"],
    "lvpw": ["Parasternal_Long"],
    "pa": ["Parasternal_Long"],
}


def normalize_view_label(view_label: str) -> str:
    """
    Normalize a view label to canonical EchoPrime format.

    Handles legacy labels (PLAX, PSAX, etc.) and case variations.

    Args:
        view_label: Raw view label from any source

    Returns:
        Canonical EchoPrime view label

    Example:
        >>> normalize_view_label("PLAX")
        'Parasternal_Long'
        >>> normalize_view_label("A4C")
        'A4C'
    """
    if view_label in ECHOPRIME_VIEW_CLASSES:
        return view_label
    return VIEW_LABEL_ALIASES.get(view_label, view_label)


def get_compatible_measurements(
    view_label: str,
    confidence: Optional[float] = None,
) -> List[str]:
    """
    Get measurement models compatible with a given view.

    Hospital-grade safety: If confidence is provided and below threshold,
    returns empty list (no measurements attempted on uncertain views).

    Args:
        view_label: View label (raw or canonical)
        confidence: Optional view classification confidence (0-1)

    Returns:
        List of compatible measurement model names

    Example:
        >>> get_compatible_measurements("Parasternal_Long")
        ['aorta', 'aortic_root', 'ivc', 'ivs', 'la', 'lvid', 'lvpw', 'pa']
        >>> get_compatible_measurements("A4C", confidence=0.3)
        []  # below threshold
    """
    # Hospital-grade: reject low-confidence classifications
    if confidence is not None and confidence < VIEW_CONFIDENCE_THRESHOLD:
        return []

    canonical = normalize_view_label(view_label)
    compatible = []

    for measurement_name, compatible_views in VIEW_COMPATIBLE_MEASUREMENTS.items():
        if canonical in compatible_views:
            compatible.append(measurement_name)

    return compatible


def is_measurement_compatible(
    measurement_name: str,
    view_label: str,
    confidence: Optional[float] = None,
) -> bool:
    """
    Check if a measurement is compatible with a view.

    Args:
        measurement_name: Measurement model name (e.g., "ivs")
        view_label: View label (e.g., "PLAX" or "Parasternal_Long")
        confidence: Optional view classification confidence

    Returns:
        True if compatible and confidence is above threshold
    """
    if confidence is not None and confidence < VIEW_CONFIDENCE_THRESHOLD:
        return False

    if measurement_name not in VIEW_COMPATIBLE_MEASUREMENTS:
        return False

    canonical = normalize_view_label(view_label)
    return canonical in VIEW_COMPATIBLE_MEASUREMENTS[measurement_name]


def get_all_view_mappings() -> Dict[str, List[str]]:
    """Get complete view compatibility mapping."""
    return VIEW_COMPATIBLE_MEASUREMENTS.copy()
