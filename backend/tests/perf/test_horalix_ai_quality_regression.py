import os
import json
from collections import defaultdict

import pytest


def _load_output(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and "output" in data and isinstance(data["output"], dict):
        return data["output"]
    return data


def _group_measurements(measurements: list[dict]) -> dict[str, list[float]]:
    grouped: dict[str, list[float]] = defaultdict(list)
    for m in measurements:
        mtype = m.get("measurement_type") or m.get("measurement_name") or "unknown"
        value = m.get("value")
        if isinstance(value, (int, float)):
            grouped[mtype].append(float(value))
    return grouped


def _median(values: list[float]) -> float:
    vals = sorted(values)
    n = len(vals)
    if n == 0:
        return 0.0
    mid = n // 2
    if n % 2 == 1:
        return vals[mid]
    return (vals[mid - 1] + vals[mid]) / 2


@pytest.mark.skipif(
    not os.getenv("HORALIX_AI_BASELINE_JSON") or not os.getenv("HORALIX_AI_CANDIDATE_JSON"),
    reason="Set HORALIX_AI_BASELINE_JSON and HORALIX_AI_CANDIDATE_JSON to enable quality regression test",
)
def test_horalix_ai_quality_regression():
    baseline_path = os.environ["HORALIX_AI_BASELINE_JSON"]
    candidate_path = os.environ["HORALIX_AI_CANDIDATE_JSON"]
    tol = float(os.getenv("HORALIX_AI_MEAS_TOL", "0.05"))

    baseline = _load_output(baseline_path)
    candidate = _load_output(candidate_path)

    base_meas = _group_measurements(baseline.get("measurements", []) or [])
    cand_meas = _group_measurements(candidate.get("measurements", []) or [])

    failures = []
    for mtype, base_vals in base_meas.items():
        if mtype not in cand_meas:
            failures.append(f"missing_measurement_type={mtype}")
            continue
        base_med = _median(base_vals)
        cand_med = _median(cand_meas[mtype])
        delta = abs(base_med - cand_med)
        if delta > tol:
            failures.append(
                f"measurement_delta_exceeded type={mtype} baseline={base_med:.3f} candidate={cand_med:.3f} delta={delta:.3f}"
            )

    assert not failures, "\n".join(failures)
