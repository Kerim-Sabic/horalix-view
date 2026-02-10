import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path


def _load_output(path: Path) -> dict:
    data = json.loads(path.read_text())
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare Horalix AI outputs for quality regression.")
    parser.add_argument("--baseline", required=True, help="Baseline JSON output file")
    parser.add_argument("--candidate", required=True, help="Candidate JSON output file")
    parser.add_argument("--tol", type=float, default=0.05, help="Allowed median delta per measurement (cm)")
    args = parser.parse_args()

    baseline = _load_output(Path(args.baseline))
    candidate = _load_output(Path(args.candidate))

    base_meas = _group_measurements(baseline.get("measurements", []) or [])
    cand_meas = _group_measurements(candidate.get("measurements", []) or [])

    failures = 0
    for mtype, base_vals in base_meas.items():
        if mtype not in cand_meas:
            print(f"missing_measurement_type={mtype}")
            failures += 1
            continue
        base_med = _median(base_vals)
        cand_med = _median(cand_meas[mtype])
        delta = abs(base_med - cand_med)
        if delta > args.tol:
            print(f"measurement_delta_exceeded type={mtype} baseline={base_med:.3f} candidate={cand_med:.3f} delta={delta:.3f}")
            failures += 1

    # Basic overlay count check
    base_overlays = len(baseline.get("overlays", []) or [])
    cand_overlays = len(candidate.get("overlays", []) or [])
    if base_overlays and cand_overlays and cand_overlays < base_overlays * 0.9:
        print(f"overlay_count_drop baseline={base_overlays} candidate={cand_overlays}")
        failures += 1

    # View classification parity check (per SOP UID)
    base_views = baseline.get("view_predictions", {}) or {}
    cand_views = candidate.get("view_predictions", {}) or {}
    if isinstance(base_views, dict) and isinstance(cand_views, dict) and base_views and cand_views:
        shared_uids = sorted(set(base_views.keys()) & set(cand_views.keys()))
        mismatch_pairs: dict[tuple[str, str], int] = defaultdict(int)
        mismatches = 0
        for uid in shared_uids:
            b = str(base_views.get(uid, "Unknown"))
            c = str(cand_views.get(uid, "Unknown"))
            if b != c:
                mismatches += 1
                mismatch_pairs[(b, c)] += 1
        if shared_uids:
            mismatch_rate = mismatches / len(shared_uids)
            print(
                f"view_parity shared={len(shared_uids)} mismatches={mismatches} "
                f"rate={mismatch_rate:.3f}"
            )
            if mismatch_pairs:
                top = sorted(mismatch_pairs.items(), key=lambda item: item[1], reverse=True)[:10]
                for (b, c), count in top:
                    print(f"view_confusion baseline={b} candidate={c} count={count}")

    if failures:
        print(f"FAILED: {failures} regression issues")
        return 1

    print("OK: outputs within tolerance")
    return 0


if __name__ == "__main__":
    sys.exit(main())
