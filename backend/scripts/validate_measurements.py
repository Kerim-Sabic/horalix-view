#!/usr/bin/env python
"""Compare Horalix measurements against a reference method.

Testing the volume code against analytic geometry proves the arithmetic. It
says nothing about agreement with cardiac MR, or with the echo package a
reading room already trusts, on real ventricles. That question needs paired
measurements and the statistics this script reports.

Input is a CSV with one row per case:

    case_id,measurement,horalix,reference
    A001,LVEDV,142.0,138.0
    A001,LVESV,58.0,55.0
    A001,EF,59.2,60.1
    ...

Only the four columns above are required; anything else is carried through
untouched. Rows with a missing value on either side are excluded and counted.

Usage:

    python scripts/validate_measurements.py results.csv
    python scripts/validate_measurements.py results.csv --json report.json
    python scripts/validate_measurements.py results.csv \\
        --tolerance LVEDV=10 --tolerance EF=5

The ``--tolerance`` values are the clinically acceptable bias for each
measurement, in its own units. They are supplied rather than assumed, because
what counts as acceptable depends on the decision the number feeds.

Exit status is 1 when any measurement exceeds a stated tolerance, so this can
gate a release; without tolerances it always exits 0 and simply reports.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path

# Allow running from the repository root without installing the package.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.validation.agreement import (  # noqa: E402
    AgreementReport,
    build_report,
    format_report,
)

REQUIRED_COLUMNS = {"measurement", "horalix", "reference"}

#: Units for the measurements this tool expects to see. Anything else is
#: reported without a unit rather than rejected.
KNOWN_UNITS = {
    "LVEDV": "mL",
    "LVESV": "mL",
    "EF": "%",
    "LVEDVI": "mL/m2",
    "LVESVI": "mL/m2",
    "LVEDD": "mm",
    "LVESD": "mm",
    "FS": "%",
    "LA_VOLUME": "mL",
}


def parse_tolerances(values: list[str]) -> dict[str, float]:
    """Parse ``--tolerance NAME=VALUE`` arguments."""
    tolerances: dict[str, float] = {}
    for item in values:
        if "=" not in item:
            raise argparse.ArgumentTypeError(
                f"Tolerance must be NAME=VALUE, got {item!r}"
            )
        name, _, raw = item.partition("=")
        try:
            tolerances[name.strip().upper()] = float(raw)
        except ValueError as exc:
            raise argparse.ArgumentTypeError(
                f"Tolerance for {name!r} must be a number, got {raw!r}"
            ) from exc
    return tolerances


def _to_float(raw: str | None) -> float:
    """Empty cells become NaN so the report counts them as excluded rather
    than silently treating a blank as zero."""
    if raw is None:
        return float("nan")
    text = raw.strip()
    if not text:
        return float("nan")
    try:
        return float(text)
    except ValueError:
        return float("nan")


def read_pairs(path: Path) -> dict[str, tuple[list[float], list[float]]]:
    """Group paired measurements by measurement name."""
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise SystemExit(f"{path} is empty")

        columns = {name.strip().lower() for name in reader.fieldnames}
        missing = REQUIRED_COLUMNS - columns
        if missing:
            raise SystemExit(
                f"{path} is missing required column(s): {', '.join(sorted(missing))}"
            )

        grouped: dict[str, tuple[list[float], list[float]]] = defaultdict(
            lambda: ([], [])
        )
        for row in reader:
            normalised = {
                (key or "").strip().lower(): value for key, value in row.items()
            }
            name = (normalised.get("measurement") or "").strip().upper()
            if not name:
                continue
            test_values, reference_values = grouped[name]
            test_values.append(_to_float(normalised.get("horalix")))
            reference_values.append(_to_float(normalised.get("reference")))

    return dict(grouped)


def build_reports(
    grouped: dict[str, tuple[list[float], list[float]]],
    tolerances: dict[str, float],
) -> list[AgreementReport]:
    reports: list[AgreementReport] = []
    for name in sorted(grouped):
        test_values, reference_values = grouped[name]
        try:
            reports.append(
                build_report(
                    name,
                    KNOWN_UNITS.get(name, ""),
                    test_values,
                    reference_values,
                    acceptable_bias=tolerances.get(name),
                )
            )
        except ValueError as exc:
            print(f"{name}: skipped ({exc})", file=sys.stderr)
    return reports


def report_to_dict(report: AgreementReport) -> dict:
    payload = asdict(report)
    payload["bland_altman"]["loa_width"] = report.bland_altman.loa_width
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Compare Horalix measurements against a reference method.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("csv_path", type=Path, help="Paired measurements CSV")
    parser.add_argument(
        "--tolerance",
        action="append",
        default=[],
        metavar="NAME=VALUE",
        help="Acceptable bias for a measurement, in its own units. Repeatable.",
    )
    parser.add_argument(
        "--json",
        type=Path,
        metavar="PATH",
        help="Also write the full report as JSON.",
    )
    args = parser.parse_args(argv)

    if not args.csv_path.exists():
        raise SystemExit(f"No such file: {args.csv_path}")

    tolerances = parse_tolerances(args.tolerance)
    grouped = read_pairs(args.csv_path)
    if not grouped:
        raise SystemExit("No measurements found in the input")

    reports = build_reports(grouped, tolerances)
    if not reports:
        raise SystemExit("No measurement had enough complete pairs to analyse")

    for report in reports:
        print(format_report(report))
        print()

    if args.json:
        args.json.write_text(
            json.dumps([report_to_dict(r) for r in reports], indent=2),
            encoding="utf-8",
        )
        print(f"Wrote {args.json}")

    # Fail only against a stated tolerance; without one this is a report, not a
    # verdict, and should not pretend otherwise.
    breached = [
        report.measurement
        for report in reports
        if report.measurement in tolerances
        and abs(report.bland_altman.bias) > tolerances[report.measurement]
    ]
    if breached:
        print(
            f"Bias exceeds the stated tolerance for: {', '.join(breached)}",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
