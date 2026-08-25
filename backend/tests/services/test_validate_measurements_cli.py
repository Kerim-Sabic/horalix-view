"""Tests for the measurement-validation CLI.

The behaviour that matters: it fails only against a tolerance the caller states.
Without one it reports and exits 0, because a comparison is not a verdict.
"""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "validate_measurements.py"


def _load_cli():
    spec = importlib.util.spec_from_file_location("validate_measurements", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["validate_measurements"] = module
    spec.loader.exec_module(module)
    return module


cli = _load_cli()


def write_csv(path: Path, rows: list[str]) -> Path:
    path.write_text(
        "case_id,measurement,horalix,reference\n" + "\n".join(rows), encoding="utf-8"
    )
    return path


def agreeing_rows(measurement: str = "LVEDV", offset: float = 0.0) -> list[str]:
    values = [80, 95, 110, 125, 140, 155, 170, 88, 102, 133]
    return [
        f"C{i:03d},{measurement},{v + offset:.1f},{v:.1f}" for i, v in enumerate(values)
    ]


class TestParseTolerances:
    def test_parses_a_single_tolerance(self):
        assert cli.parse_tolerances(["LVEDV=10"]) == {"LVEDV": 10.0}

    def test_parses_several(self):
        assert cli.parse_tolerances(["LVEDV=10", "EF=5"]) == {"LVEDV": 10.0, "EF": 5.0}

    def test_uppercases_the_name(self):
        assert cli.parse_tolerances(["lvedv=10"]) == {"LVEDV": 10.0}

    def test_rejects_a_missing_equals(self):
        with pytest.raises(Exception, match="NAME=VALUE"):
            cli.parse_tolerances(["LVEDV"])

    def test_rejects_a_non_numeric_value(self):
        with pytest.raises(Exception, match="must be a number"):
            cli.parse_tolerances(["LVEDV=lots"])


class TestReadPairs:
    def test_groups_by_measurement(self, tmp_path: Path):
        path = write_csv(
            tmp_path / "pairs.csv", agreeing_rows("LVEDV") + agreeing_rows("LVESV")
        )
        grouped = cli.read_pairs(path)
        assert set(grouped) == {"LVEDV", "LVESV"}
        assert len(grouped["LVEDV"][0]) == 10

    def test_blank_cells_become_nan(self, tmp_path: Path):
        path = write_csv(tmp_path / "pairs.csv", ["C001,LVEDV,,120.0"])
        test_values, _ = cli.read_pairs(path)["LVEDV"]
        # A blank must not be read as zero, which would silently bias the result.
        assert test_values[0] != 0.0
        assert test_values[0] != test_values[0]  # NaN

    def test_unparseable_cells_become_nan(self, tmp_path: Path):
        path = write_csv(tmp_path / "pairs.csv", ["C001,LVEDV,n/a,120.0"])
        test_values, _ = cli.read_pairs(path)["LVEDV"]
        assert test_values[0] != test_values[0]

    def test_rejects_a_file_missing_columns(self, tmp_path: Path):
        path = tmp_path / "bad.csv"
        path.write_text("case_id,value\nC001,10\n", encoding="utf-8")
        with pytest.raises(SystemExit, match="missing required column"):
            cli.read_pairs(path)

    def test_skips_rows_with_no_measurement_name(self, tmp_path: Path):
        path = write_csv(tmp_path / "pairs.csv", ["C001,,10,10", *agreeing_rows()])
        assert set(cli.read_pairs(path)) == {"LVEDV"}


class TestMain:
    def test_agreeing_methods_exit_zero(self, tmp_path: Path, capsys):
        path = write_csv(tmp_path / "pairs.csv", agreeing_rows(offset=0.5))
        assert cli.main([str(path), "--tolerance", "LVEDV=5"]) == 0
        assert "LVEDV" in capsys.readouterr().out

    def test_a_breached_tolerance_exits_one(self, tmp_path: Path, capsys):
        path = write_csv(tmp_path / "pairs.csv", agreeing_rows(offset=25.0))
        assert cli.main([str(path), "--tolerance", "LVEDV=5"]) == 1
        assert "exceeds the stated tolerance" in capsys.readouterr().err

    def test_without_a_tolerance_it_reports_rather_than_judging(
        self, tmp_path: Path, capsys
    ):
        # A large offset, but nothing was declared acceptable, so this is a
        # report and must not pretend to be a verdict.
        path = write_csv(tmp_path / "pairs.csv", agreeing_rows(offset=40.0))
        assert cli.main([str(path)]) == 0
        assert "Systematic offset" in capsys.readouterr().out

    def test_writes_json_when_asked(self, tmp_path: Path, capsys):
        path = write_csv(tmp_path / "pairs.csv", agreeing_rows())
        out = tmp_path / "report.json"
        assert cli.main([str(path), "--json", str(out)]) == 0
        capsys.readouterr()

        payload = json.loads(out.read_text(encoding="utf-8"))
        assert payload[0]["measurement"] == "LVEDV"
        assert "bias" in payload[0]["bland_altman"]
        assert "loa_width" in payload[0]["bland_altman"]

    def test_missing_file_is_reported(self, tmp_path: Path):
        with pytest.raises(SystemExit, match="No such file"):
            cli.main([str(tmp_path / "absent.csv")])

    def test_a_file_with_no_usable_pairs_is_reported(self, tmp_path: Path, capsys):
        path = write_csv(tmp_path / "pairs.csv", ["C001,LVEDV,10,10"])
        with pytest.raises(SystemExit, match="enough complete pairs"):
            cli.main([str(path)])
        capsys.readouterr()

    def test_reports_each_measurement_separately(self, tmp_path: Path, capsys):
        path = write_csv(
            tmp_path / "pairs.csv", agreeing_rows("LVEDV") + agreeing_rows("LVESV")
        )
        cli.main([str(path)])
        out = capsys.readouterr().out
        assert "LVEDV (mL)" in out
        assert "LVESV (mL)" in out

    def test_unknown_measurements_are_reported_without_a_unit(
        self, tmp_path: Path, capsys
    ):
        path = write_csv(tmp_path / "pairs.csv", agreeing_rows("SOMETHING_NEW"))
        assert cli.main([str(path)]) == 0
        assert "SOMETHING_NEW" in capsys.readouterr().out
