import pytest

from app.services.ai.horalix_ai.schema import MeasurementRecord
from app.services.ai.horalix_ai.worker import HoralixAIWorker


def build_measurement(measurement_type: str, value: float) -> MeasurementRecord:
    return MeasurementRecord(
        measurement_type=measurement_type,
        measurement_name="LVEF Teichholz",
        value=value,
        unit="%",
        instance_uid="1.2.3.4",
        frame_number=0,
        view="PLAX",
        method="Teichholz",
    )


def test_extract_teichholz_ef_median():
    worker = HoralixAIWorker.__new__(HoralixAIWorker)
    measurements = [
        build_measurement("ef_teichholz", 50.0),
        build_measurement("ef_teichholz", 60.0),
        build_measurement("lvef_teichholz", 55.0),
    ]
    result = worker._extract_teichholz_ef(measurements)
    assert result == pytest.approx(55.0)


def test_generate_report_includes_teichholz():
    worker = HoralixAIWorker.__new__(HoralixAIWorker)
    measurements = [build_measurement("ef_teichholz", 52.0)]

    report = worker._generate_report(findings={}, measurements=measurements, curves=[], view_predictions=None)

    assert "Left Ventricle" in report.sections
    lv_section = report.sections["Left Ventricle"]
    assert "EF (Teichholz)" in lv_section
    assert "Teichholz" in report.text


def test_stage_7_normalize_adds_teichholz_to_fused_metrics():
    worker = HoralixAIWorker.__new__(HoralixAIWorker)
    worker.gpu_id = 0
    measurements = [build_measurement("ef_teichholz", 52.0)]

    output = worker.stage_7_normalize(
        study_uid="1.2.3",
        findings={},
        measurements=measurements,
        measurement_overlays=[],
        echonet_results=[],
        echonet_overlays=[],
        view_predictions={},
    )

    fused_metrics = output.findings.get("fused_metrics")
    assert isinstance(fused_metrics, dict)
    assert fused_metrics["EF_Teichholz"]["value"] == pytest.approx(52.0)
