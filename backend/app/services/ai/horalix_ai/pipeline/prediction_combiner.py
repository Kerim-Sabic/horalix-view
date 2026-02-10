"""
PanEcho + EchoPrime prediction combining.

Ported from Echocardiology_App to ensure identical ensemble logic and thresholds.
"""

from typing import Any, Dict, List, Optional
import json
import pathlib
import logging

logger = logging.getLogger(__name__)

# Load configuration file once
CONFIG_FILE = pathlib.Path(__file__).with_name("thresholds.config.json")
try:
    with open(CONFIG_FILE, encoding="utf-8") as f:
        TASK_CONFIG: Dict[str, Any] = json.load(f)
except Exception as exc:
    TASK_CONFIG = {}
    logger.warning("[prediction_combiner] Could not load thresholds config: %s", exc)


def _build_regression_task_set(config: Dict[str, Any], name_key: str) -> set:
    names = set()
    for cfg in (config or {}).values():
        if cfg.get("units") is None:
            continue
        name = cfg.get(name_key)
        if name:
            names.add(name)
    return names


# ---------------------------------------------------------------------------
# PanEcho task metadata (class orders, positive labels, units)
# ---------------------------------------------------------------------------
PANECHO_MULTICLASS_LABELS = {
    "LVSize": ["Mildly Increased", "Moderately or Severely Increased", "Normal"],
    "LVSystolicFunction": ["Mildly Decreased", "Moderately or Severely Decreased", "Normal or Hyperdynamic"],
    "LVDiastolicFunction": ["Mild or Indeterminate", "Moderate or Severe", "Normal"],
    "RVSize": ["Mildly Increased", "Moderately or Severely Increased", "Normal"],
    "LASize": ["Mildly Dilated", "Moderately or Severely Dilated", "Normal"],
    "AVStenosis": ["Mild or Moderate", "None", "Severe"],
    "AVRegurg": ["Mild", "Moderate or Severe", "None or Trace"],
    "MVRegurgitation": ["Mild", "Moderate or Severe", "None or Trace"],
    "TVRegurgitation": ["Mild", "Moderate or Severe", "None or Trace"],
}
PANECHO_BINARY_POSITIVE_LABEL = {
    "pericardial-effusion": "Present",
    "LVWallThickness-increased-any": "Increased",
    "LVWallThickness-increased-modsev": "Moderately or Severely Increased",
    "LVWallMotionAbnormalities": "Present",
    "RVSystolicFunction": "Decreased",
    "RASize": "Dilated",
    "AVStructure": "Bicuspid",
    "LVOT20mmHg": "Present",
    "MVStenosis": "Mild or Moderate or Severe",
    "RAP-8-or-higher": "Present",
}
PANECHO_REGRESSION_UNITS = {
    "EF": "%", "GLS": "%", "LVEDV": "cm^3", "LVESV": "cm^3", "LVSV": "cm^3",
    "IVSd": "cm", "LVPWd": "cm", "LVIDs": "cm", "LVIDd": "cm", "LVOTDiam": "cm",
    "E|EAvg": "E/E' ratio", "RVSP": "mmHg", "RVIDd": "cm", "TAPSE": "cm", "RVSVel": "cm/s",
    "LAIDs2D": "cm", "LAVol": "cm^3", "RADimensionM-L(cm)": "cm", "AVPkVel(m|s)": "m/s",
    "TVPkGrad": "mmHg", "AORoot": "cm",
}
PANECHO_REGRESSION_TASKS = _build_regression_task_set(TASK_CONFIG, "panecho_name")
ECHOPRIME_REGRESSION_TASKS = _build_regression_task_set(TASK_CONFIG, "echoprime_name")
PANECHO_POSITIVE_CLASSES = {
    "MVRegurgitation": ["Moderate or Severe"],
    "TVRegurgitation": ["Moderate or Severe"],
    "AVRegurg": ["Moderate or Severe"],
    "AVStenosis": ["Severe"],
}

PANECHO_BINARY_NEGATIVE_LABEL = {
    "pericardial-effusion": "Absent",
    "LVWallThickness-increased-any": "Not Increased",
    "LVWallThickness-increased-modsev": "Not Moderately or Severely Increased",
    "LVWallMotionAbnormalities": "Absent",
    "RVSystolicFunction": "Normal",
    "RASize": "Normal",
    "AVStructure": "Not Bicuspid",
    "LVOT20mmHg": "Absent",
    "MVStenosis": "None",
    "RAP-8-or-higher": "Below 8",
}


def _panecho_negative_label(task_name: str) -> str:
    pos = PANECHO_BINARY_POSITIVE_LABEL.get(task_name)
    if pos == "Present":
        return "Absent"
    return PANECHO_BINARY_NEGATIVE_LABEL.get(task_name, f"Not {pos or 'Present'}")


def _panecho_positive_probability(
    task_name: str,
    panecho_normalized: Dict[str, Any],
) -> Optional[float]:
    """
    Returns the probability of a clinically significant finding from PanEcho:
    - Binary tasks: probability_present
    - Multiclass: sum of positive classes (if configured), else 1 - p(normal)
    """
    node = panecho_normalized.get(task_name)
    if not node:
        return None

    kind = node.get("kind")
    if kind == "binary":
        return node.get("probability_present")

    if kind == "multiclass":
        class_probs = node.get("probs") or {}
        positive_labels = PANECHO_POSITIVE_CLASSES.get(task_name)
        if positive_labels:
            return float(sum(class_probs.get(label, 0.0) for label in positive_labels))

        normal_class_by_task = {
            "LVSize": "Normal",
            "LVSystolicFunction": "Normal or Hyperdynamic",
            "LVDiastolicFunction": "Normal",
            "RVSize": "Normal",
            "LASize": "Normal",
            "AVStenosis": "None",
            "AVRegurg": "None or Trace",
            "MVRegurgitation": "None or Trace",
            "TVRegurgitation": "None or Trace",
        }
        normal_label = normal_class_by_task.get(task_name)
        if not normal_label:
            return None
        p_norm = class_probs.get(normal_label)
        if p_norm is None:
            return None
        return 1.0 - float(p_norm)

    return None


def _to_float_or_none(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        return float(str(value))
    except Exception:
        return None


def _normalize_panecho_multiclass(task_name: str, raw_value: Any) -> Dict[str, Any]:
    labels = PANECHO_MULTICLASS_LABELS.get(task_name)
    if not labels:
        return {"raw": raw_value, "kind": "unknown"}

    if isinstance(raw_value, dict):
        class_probs = {str(k): float(v) for k, v in raw_value.items()}
    elif isinstance(raw_value, (list, tuple)):
        probs: List[float] = []
        for v in raw_value:
            fv = _to_float_or_none(v)
            if fv is None:
                return {"raw": raw_value, "kind": "unknown"}
            probs.append(fv)
        total = sum(probs)
        if total <= 0.0:
            return {"raw": raw_value, "kind": "unknown"}
        probs = [p / total for p in probs]
        class_probs = {labels[i]: probs[i] for i in range(min(len(labels), len(probs)))}
    else:
        return {"raw": raw_value, "kind": "unknown"}

    top_label = None
    top_prob = None
    for lab, p in class_probs.items():
        if top_prob is None or float(p) > float(top_prob):
            top_label = lab
            top_prob = float(p)

    return {
        "kind": "multiclass",
        "probs": class_probs,
        "label": top_label,
        "confidence": top_prob,
    }


def normalize_panecho_predictions(panecho_raw: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    normalized: Dict[str, Dict[str, Any]] = {}

    for task_name, raw_val in panecho_raw.items():
        if task_name in PANECHO_MULTICLASS_LABELS:
            normalized[task_name] = _normalize_panecho_multiclass(task_name, raw_val)
            continue

        if task_name in PANECHO_REGRESSION_TASKS:
            val = _to_float_or_none(raw_val)
            if val is None:
                normalized[task_name] = {"raw": raw_val, "kind": "unknown"}
            else:
                if task_name == "GLS":
                    val = -1.0 * val
                normalized[task_name] = {"value": val, "kind": "regression_like"}
            continue

        val = _to_float_or_none(raw_val)
        if val is None:
            normalized[task_name] = {"raw": raw_val, "kind": "unknown"}
            continue

        if 0.0 <= val <= 1.0:
            normalized[task_name] = {"probability_present": val, "kind": "binary"}
        else:
            normalized[task_name] = {"value": val, "kind": "regression_like"}

    return normalized


def normalize_echoprime_predictions(echoprime_raw: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    normalized: Dict[str, Dict[str, Any]] = {}

    for task_name, raw_value in echoprime_raw.items():
        if task_name in ECHOPRIME_REGRESSION_TASKS:
            numeric_value = _to_float_or_none(raw_value)
            if numeric_value is None:
                normalized[task_name] = {"raw": raw_value, "kind": "unknown"}
            else:
                normalized[task_name] = {"value": numeric_value, "kind": "regression_like"}
            continue

        numeric_value = _to_float_or_none(raw_value)
        if numeric_value is None:
            normalized[task_name] = {"raw": raw_value, "kind": "unknown"}
        elif 0.0 <= numeric_value <= 1.0:
            normalized[task_name] = {"probability_present": numeric_value, "kind": "binary_like"}
        else:
            normalized[task_name] = {"value": numeric_value, "kind": "regression_like"}

    return normalized


def _panecho_abnormal_probability(task_name: str, panecho_normalized: Dict[str, Any]) -> Optional[float]:
    node = panecho_normalized.get(task_name)
    if not node:
        return None
    if node.get("kind") == "binary":
        return node.get("probability_present")
    if node.get("kind") == "multiclass":
        class_probabilities: Dict[str, float] = node.get("probs") or {}
        normal_class_by_task = {
            "LVSize": "Normal",
            "LVSystolicFunction": "Normal or Hyperdynamic",
            "LVDiastolicFunction": "Normal",
            "RVSize": "Normal",
            "LASize": "Normal",
            "AVStenosis": "None",
            "AVRegurg": "None or Trace",
            "MVRegurgitation": "None or Trace",
            "TVRegurgitation": "None or Trace",
        }
        normal_label = normal_class_by_task.get(task_name)
        if not normal_label:
            return None
        probability_normal = class_probabilities.get(normal_label)
        if probability_normal is None:
            return None
        return 1.0 - probability_normal
    return None


def _has_large_gap(value_a: Optional[float], value_b: Optional[float], threshold: float) -> bool:
    return value_a is not None and value_b is not None and abs(value_b - value_a) >= threshold


def _binary_label_and_conf(
    prob_present: Optional[float],
    positive_label: str,
    negative_label: str,
    is_positive: bool,
) -> tuple[Optional[str], Optional[float]]:
    if prob_present is None:
        return None, None
    if is_positive:
        return positive_label, float(prob_present)
    return negative_label, float(1.0 - prob_present)


def _ep_labels() -> tuple[str, str]:
    return "Present", "Absent"


def combine_results(
    study_uid: str,
    panecho_predictions: Dict[str, Any],
    echoprime_predictions: Dict[str, Any],
    task_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Combine PanEcho and EchoPrime outputs into a single integrated_tasks mapping.

    Returns:
        {"integrated_tasks": {task_key: {...}}}
    """
    config = task_config or TASK_CONFIG

    panecho_normalized = normalize_panecho_predictions(panecho_predictions)
    echoprime_normalized = normalize_echoprime_predictions(echoprime_predictions)

    integrated_tasks: Dict[str, Dict[str, Any]] = {}

    for task_key, cfg in (config or {}).items():
        panecho_name = cfg.get("panecho_name")
        echoprime_name = cfg.get("echoprime_name")

        pan_prob = None
        pan_val = None
        panecho_node = None
        if panecho_name:
            panecho_node = panecho_normalized.get(panecho_name)
            if panecho_node:
                if panecho_node.get("kind") in ("binary", "binary_like"):
                    pan_prob = _panecho_positive_probability(panecho_name, panecho_normalized)
                elif panecho_node.get("kind") == "multiclass":
                    pan_prob = _panecho_positive_probability(panecho_name, panecho_normalized)
                elif panecho_node.get("kind") in ("regression", "regression_like"):
                    pan_val = panecho_node.get("value")

        echo_prob = None
        echo_val = None
        if echoprime_name:
            node = echoprime_normalized.get(echoprime_name)
            if node:
                if node.get("kind") in ("binary", "binary_like"):
                    echo_prob = node.get("probability_present")
                elif node.get("kind") in ("regression", "regression_like"):
                    echo_val = node.get("value")

        panecho_pass = (
            pan_prob is not None
            and cfg.get("panecho_threshold") is not None
            and pan_prob >= cfg.get("panecho_threshold")
        )
        echoprime_pass = (
            echo_prob is not None
            and cfg.get("echoprime_threshold") is not None
            and echo_prob >= cfg.get("echoprime_threshold")
        )

        rule = cfg.get("combine_rule")
        integrated_label = None
        integrated_value = None
        sources: List[str] = []
        discrepancy: Optional[bool] = None
        preferred_model = (
            rule.split(":", 1)[1].strip()
            if isinstance(rule, str) and rule.startswith("prefer_model")
            else None
        )

        if rule == "average_value":
            if pan_val is not None and echo_val is not None:
                integrated_value = (pan_val + echo_val) / 2.0
                sources = ["PanEcho", "EchoPrime"]
                thr = cfg.get("discrepancy_threshold")
                if thr is not None:
                    try:
                        discrepancy = abs(float(pan_val) - float(echo_val)) > float(thr)
                    except Exception:
                        discrepancy = False
            elif pan_val is not None:
                integrated_value = pan_val
                sources = ["PanEcho"]
            elif echo_val is not None:
                integrated_value = echo_val
                sources = ["EchoPrime"]
        elif isinstance(rule, str) and rule.startswith("prefer_model"):
            preferred_model = rule.split(":", 1)[1].strip()

            is_numeric = (pan_val is not None) or (echo_val is not None)
            if is_numeric:
                if preferred_model == "PanEcho" and (pan_val is not None):
                    integrated_value = pan_val
                    sources = ["PanEcho"]
                elif preferred_model == "EchoPrime" and (echo_val is not None):
                    integrated_value = echo_val
                    sources = ["EchoPrime"]
                else:
                    if pan_val is not None:
                        integrated_value = pan_val
                        sources = ["PanEcho"]
                    elif echo_val is not None:
                        integrated_value = echo_val
                        sources = ["EchoPrime"]

                thr = cfg.get("discrepancy_threshold")
                if (thr is not None) and (pan_val is not None) and (echo_val is not None):
                    try:
                        discrepancy = abs(float(pan_val) - float(echo_val)) > float(thr)
                    except Exception:
                        discrepancy = False
            else:
                if preferred_model == "PanEcho":
                    pos = PANECHO_BINARY_POSITIVE_LABEL.get(panecho_name, "Present")
                    neg = _panecho_negative_label(panecho_name) if panecho_name else "Absent"
                    is_pos = bool(panecho_pass)
                    integrated_label, integrated_value = _binary_label_and_conf(pan_prob, pos, neg, is_pos)
                    sources = ["PanEcho"] if integrated_label else []
                else:
                    pos, neg = _ep_labels()
                    is_pos = bool(echoprime_pass)
                    integrated_label, integrated_value = _binary_label_and_conf(echo_prob, pos, neg, is_pos)
                    sources = ["EchoPrime"] if integrated_label else []
        elif rule == "positive_if_either_positive":
            if panecho_pass or echoprime_pass:
                pan_p = pan_prob if panecho_pass else None
                ep_p = echo_prob if echoprime_pass else None
                use_pan = (pan_p is not None) and (ep_p is None or pan_p >= ep_p)
                if use_pan:
                    pos = PANECHO_BINARY_POSITIVE_LABEL.get(panecho_name, "Present")
                    neg = _panecho_negative_label(panecho_name) if panecho_name else "Absent"
                    integrated_label, integrated_value = _binary_label_and_conf(pan_prob, pos, neg, True)
                    sources = ["PanEcho"]
                else:
                    pos, neg = _ep_labels()
                    integrated_label, integrated_value = _binary_label_and_conf(echo_prob, pos, neg, True)
                    sources = ["EchoPrime"]
            else:
                pos_pan = PANECHO_BINARY_POSITIVE_LABEL.get(panecho_name, "Present")
                neg_pan = _panecho_negative_label(panecho_name) if panecho_name else "Absent"
                pos_ep, neg_ep = _ep_labels()
                pan_neg_conf = (1.0 - pan_prob) if pan_prob is not None else None
                ep_neg_conf = (1.0 - echo_prob) if echo_prob is not None else None
                use_pan = (pan_neg_conf is not None) and (ep_neg_conf is None or pan_neg_conf >= ep_neg_conf)
                if use_pan:
                    integrated_label, integrated_value = _binary_label_and_conf(pan_prob, pos_pan, neg_pan, False)
                    sources = ["PanEcho"]
                else:
                    integrated_label, integrated_value = _binary_label_and_conf(echo_prob, pos_ep, neg_ep, False)
                    sources = ["EchoPrime"]
        elif rule == "agree_if_both_positive":
            if panecho_pass and echoprime_pass:
                pos = PANECHO_BINARY_POSITIVE_LABEL.get(panecho_name, "Present")
                integrated_label = pos
                integrated_value = float(min(pan_prob, echo_prob)) if pan_prob is not None and echo_prob is not None else None
                sources = ["PanEcho", "EchoPrime"]
            else:
                neg = _panecho_negative_label(panecho_name) if panecho_name else "Absent"
                worst = max([p for p in [pan_prob, echo_prob] if p is not None], default=None)
                integrated_label = neg
                integrated_value = (1.0 - worst) if worst is not None else None
                sources = []
        elif rule == "prefer_panecho_if_echoprime_zero":
            if echoprime_pass:
                pos, neg = _ep_labels()
                integrated_label, integrated_value = _binary_label_and_conf(echo_prob, pos, neg, True)
                sources = ["EchoPrime"]
            elif panecho_pass:
                pos = PANECHO_BINARY_POSITIVE_LABEL.get(panecho_name, "Present")
                neg = _panecho_negative_label(panecho_name) if panecho_name else "Absent"
                integrated_label, integrated_value = _binary_label_and_conf(pan_prob, pos, neg, True)
                sources = ["PanEcho"]
            else:
                pos_pan = PANECHO_BINARY_POSITIVE_LABEL.get(panecho_name, "Present")
                neg_pan = _panecho_negative_label(panecho_name) if panecho_name else "Absent"
                pos_ep, neg_ep = _ep_labels()
                pan_neg_conf = (1.0 - pan_prob) if pan_prob is not None else None
                ep_neg_conf = (1.0 - echo_prob) if echo_prob is not None else None
                use_pan = (pan_neg_conf is not None) and (ep_neg_conf is None or pan_neg_conf >= ep_neg_conf)
                if use_pan:
                    integrated_label, integrated_value = _binary_label_and_conf(pan_prob, pos_pan, neg_pan, False)
                    sources = ["PanEcho"]
                else:
                    integrated_label, integrated_value = _binary_label_and_conf(echo_prob, pos_ep, neg_ep, False)
                    sources = ["EchoPrime"]

        prefer_pan_multiclass = (
            preferred_model == "PanEcho"
            and panecho_node is not None
            and panecho_node.get("kind") == "multiclass"
        )
        if prefer_pan_multiclass:
            probs = panecho_node.get("probs") or {}
            integrated_label = panecho_node.get("label")
            integrated_value = panecho_node.get("confidence")
            sources = ["PanEcho"]
        else:
            probs = None

        panecho_payload = (
            probs if prefer_pan_multiclass else (pan_val if pan_val is not None else pan_prob)
        )

        integrated_tasks[task_key] = {
            "panecho_value_or_prob": panecho_payload,
            "echoprime_value_or_prob": echo_val if echo_val is not None else echo_prob,
            "integrated_value": integrated_value,
            "integrated_label": integrated_label,
            "units": cfg.get("units"),
            "sources": sources,
            "discrepancy": (
                discrepancy
                if discrepancy is not None
                else (
                    (panecho_pass != echoprime_pass)
                    if (pan_prob is not None and echo_prob is not None)
                    else None
                )
            ),
        }

    return {
        "integrated_tasks": integrated_tasks,
    }


def combine_predictions(
    panecho_predictions: Dict[str, Any],
    echoprime_predictions: Dict[str, Any],
    task_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Dict[str, Any]]:
    """
    Backward-compatible wrapper used by the worker.

    Returns the integrated_tasks dict directly.
    """
    combined = combine_results("", panecho_predictions, echoprime_predictions, task_config=task_config)
    return combined.get("integrated_tasks", {})
