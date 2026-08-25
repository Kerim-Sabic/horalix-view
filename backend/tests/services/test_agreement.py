"""Tests for method-comparison statistics.

The property these guard is the one the module exists for: a method that reads
systematically high must score badly, even when it correlates almost perfectly
with the reference. Correlation alone would call it excellent.
"""

import math

import numpy as np
import pytest

from app.services.validation.agreement import (
    bland_altman,
    build_report,
    concordance_correlation,
    format_report,
    intraclass_correlation,
    linear_fit,
    pearson_correlation,
)

# A plausible spread of LV end-diastolic volumes, in mL.
REFERENCE = [
    82.0, 110.0, 145.0, 96.0, 131.0, 167.0, 74.0, 122.0, 155.0, 103.0,
    89.0, 138.0, 176.0, 115.0, 92.0, 149.0, 128.0, 107.0, 161.0, 98.0,
]


def offset_by(values, amount: float):
    """The same measurements, read uniformly high or low."""
    return [v + amount for v in values]


def noisy(values, sigma: float, seed: int = 7):
    rng = np.random.default_rng(seed)
    return [float(v + rng.normal(0, sigma)) for v in values]


class TestBlandAltman:
    def test_identical_methods_have_no_bias(self):
        result = bland_altman(REFERENCE, REFERENCE)
        assert result.bias == pytest.approx(0.0)
        assert result.sd_difference == pytest.approx(0.0)
        assert result.lower_loa == pytest.approx(0.0)
        assert result.upper_loa == pytest.approx(0.0)

    def test_recovers_a_known_offset(self):
        result = bland_altman(offset_by(REFERENCE, 12.0), REFERENCE)
        assert result.bias == pytest.approx(12.0)
        # A pure offset adds no scatter.
        assert result.sd_difference == pytest.approx(0.0, abs=1e-9)

    def test_sign_says_which_method_reads_high(self):
        high = bland_altman(offset_by(REFERENCE, 8.0), REFERENCE)
        low = bland_altman(offset_by(REFERENCE, -8.0), REFERENCE)
        assert high.bias > 0
        assert low.bias < 0

    def test_limits_bracket_the_bias(self):
        result = bland_altman(noisy(REFERENCE, 6.0), REFERENCE)
        assert result.lower_loa < result.bias < result.upper_loa

    def test_limits_widen_with_scatter(self):
        tight = bland_altman(noisy(REFERENCE, 2.0), REFERENCE)
        loose = bland_altman(noisy(REFERENCE, 15.0), REFERENCE)
        assert loose.loa_width > tight.loa_width

    def test_flags_a_systematic_offset(self):
        result = bland_altman(offset_by(REFERENCE, 20.0), REFERENCE)
        assert result.bias_is_significant is True

    def test_does_not_flag_symmetric_noise(self):
        result = bland_altman(noisy(REFERENCE, 5.0, seed=11), REFERENCE)
        # Scatter without offset should leave zero inside the CI.
        assert result.bias_ci_lower <= 0.0 <= result.bias_ci_upper

    def test_bias_percent_is_scale_free(self):
        result = bland_altman(offset_by(REFERENCE, 12.0), REFERENCE)
        grand_mean = float(np.mean([(v + 12.0 + v) / 2 for v in REFERENCE]))
        assert result.bias_percent == pytest.approx(12.0 / grand_mean * 100.0)

    def test_rejects_mismatched_lengths(self):
        with pytest.raises(ValueError, match="Paired data"):
            bland_altman([1.0, 2.0], [1.0])

    def test_rejects_too_few_pairs(self):
        with pytest.raises(ValueError, match="two complete pairs"):
            bland_altman([1.0], [1.0])

    def test_drops_incomplete_pairs(self):
        test = [*REFERENCE, float("nan")]
        reference = [*REFERENCE, 100.0]
        assert bland_altman(test, reference).n == len(REFERENCE)


class TestConcordance:
    def test_identical_methods_score_one(self):
        assert concordance_correlation(REFERENCE, REFERENCE) == pytest.approx(1.0)

    def test_penalises_a_systematic_offset(self):
        """The behaviour that distinguishes this from correlation."""
        shifted = offset_by(REFERENCE, 25.0)
        assert pearson_correlation(shifted, REFERENCE) == pytest.approx(1.0)
        assert concordance_correlation(shifted, REFERENCE) < 0.9

    def test_penalises_a_scale_error(self):
        scaled = [v * 1.3 for v in REFERENCE]
        assert pearson_correlation(scaled, REFERENCE) == pytest.approx(1.0)
        assert concordance_correlation(scaled, REFERENCE) < 0.95

    def test_stays_within_bounds(self):
        value = concordance_correlation(noisy(REFERENCE, 20.0), REFERENCE)
        assert -1.0 <= value <= 1.0

    def test_two_identical_constants_agree(self):
        assert concordance_correlation([5.0, 5.0], [5.0, 5.0]) == pytest.approx(1.0)


class TestIntraclassCorrelation:
    def test_identical_methods_score_one(self):
        assert intraclass_correlation(REFERENCE, REFERENCE) == pytest.approx(1.0)

    def test_absolute_agreement_penalises_an_offset(self):
        # Consistency-form ICC would ignore this; the absolute-agreement form
        # must not, which is why that form is the one used.
        offset = intraclass_correlation(offset_by(REFERENCE, 30.0), REFERENCE)
        assert offset < 0.95

    def test_falls_with_noise(self):
        clean = intraclass_correlation(noisy(REFERENCE, 2.0), REFERENCE)
        messy = intraclass_correlation(noisy(REFERENCE, 25.0), REFERENCE)
        assert messy < clean

    def test_stays_within_bounds(self):
        assert -1.0 <= intraclass_correlation(noisy(REFERENCE, 40.0), REFERENCE) <= 1.0


class TestLinearFit:
    def test_recovers_slope_and_intercept(self):
        test = [2.0 * v + 5.0 for v in REFERENCE]
        slope, intercept = linear_fit(test, REFERENCE)
        assert slope == pytest.approx(2.0)
        assert intercept == pytest.approx(5.0)

    def test_identity_fit(self):
        slope, intercept = linear_fit(REFERENCE, REFERENCE)
        assert slope == pytest.approx(1.0)
        assert intercept == pytest.approx(0.0, abs=1e-9)

    def test_constant_reference_yields_no_fit(self):
        assert linear_fit([1.0, 2.0, 3.0], [5.0, 5.0, 5.0]) == (0.0, 0.0)


class TestBuildReport:
    def test_clean_agreement_produces_no_warnings(self):
        report = build_report("LVEDV", "mL", noisy(REFERENCE, 3.0, seed=3), REFERENCE)
        assert report.measurement == "LVEDV"
        assert report.concordance > 0.95
        assert not any("Systematic offset" in note for note in report.notes)

    def test_reports_a_systematic_offset(self):
        report = build_report("LVEDV", "mL", offset_by(REFERENCE, 22.0), REFERENCE)
        assert any("Systematic offset" in note for note in report.notes)

    def test_contrasts_correlation_with_concordance(self):
        """The report should say so when the two diverge, because that gap is
        exactly what a correlation-only analysis would hide."""
        report = build_report("LVEDV", "mL", offset_by(REFERENCE, 40.0), REFERENCE)
        assert any("do not agree" in note for note in report.notes)

    def test_flags_a_bias_beyond_tolerance(self):
        report = build_report(
            "LVEDV", "mL", offset_by(REFERENCE, 15.0), REFERENCE, acceptable_bias=10.0
        )
        assert any("exceeds the stated tolerance" in note for note in report.notes)

    def test_accepts_a_bias_within_tolerance(self):
        report = build_report(
            "LVEDV", "mL", offset_by(REFERENCE, 4.0), REFERENCE, acceptable_bias=10.0
        )
        assert not any("exceeds the stated tolerance" in note for note in report.notes)

    def test_flags_limits_beyond_tolerance(self):
        report = build_report(
            "LVEDV",
            "mL",
            noisy(REFERENCE, 30.0),
            REFERENCE,
            acceptable_loa_width=20.0,
        )
        assert any("wider than the stated tolerance" in note for note in report.notes)

    def test_warns_about_a_small_sample(self):
        report = build_report("LVEDV", "mL", [80.0, 100.0, 120.0], [82.0, 98.0, 121.0])
        assert any("smoke test" in note for note in report.notes)

    def test_counts_excluded_pairs(self):
        report = build_report(
            "LVEDV", "mL", [*REFERENCE, float("nan")], [*REFERENCE, 100.0]
        )
        assert report.excluded == 1
        assert any("excluded" in note for note in report.notes)


class TestFormatReport:
    def test_renders_every_headline_statistic(self):
        text = format_report(build_report("LVEDV", "mL", noisy(REFERENCE, 5.0), REFERENCE))
        for expected in ["LVEDV", "Bias", "Limits of agreement", "Concordance", "ICC(2,1)"]:
            assert expected in text

    def test_renders_notes_when_present(self):
        text = format_report(build_report("LVEDV", "mL", offset_by(REFERENCE, 30.0), REFERENCE))
        assert "Notes" in text

    def test_output_is_finite(self):
        text = format_report(build_report("EF", "%", noisy(REFERENCE, 4.0), REFERENCE))
        assert "nan" not in text.lower()
        assert "inf" not in text.lower()


class TestKnownValues:
    """Checks against figures computed by hand, so a refactor cannot quietly
    change what the statistics mean."""

    def test_bland_altman_against_hand_calculation(self):
        test = [10.0, 12.0, 14.0, 16.0]
        reference = [9.0, 12.0, 13.0, 17.0]
        # Differences: 1, 0, 1, -1 -> mean 0.25, sd (ddof=1) = 0.9574
        result = bland_altman(test, reference)
        assert result.bias == pytest.approx(0.25)
        assert result.sd_difference == pytest.approx(0.957427, rel=1e-4)
        assert result.upper_loa == pytest.approx(0.25 + 1.96 * 0.957427, rel=1e-4)

    def test_concordance_against_hand_calculation(self):
        test = [1.0, 2.0, 3.0, 4.0]
        reference = [1.0, 2.0, 3.0, 5.0]
        # cov = 1.625, var_a = 1.25, var_b = 2.1875, mean diff = -0.25
        expected = 2 * 1.625 / (1.25 + 2.1875 + 0.0625)
        assert concordance_correlation(test, reference) == pytest.approx(expected, rel=1e-6)

    def test_perfect_offset_concordance_is_analytic(self):
        # For a pure offset d with variance v on both sides:
        # CCC = 2v / (2v + d^2)
        values = [10.0, 20.0, 30.0, 40.0]
        offset = 5.0
        variance = float(np.var(values))
        expected = 2 * variance / (2 * variance + offset**2)
        assert concordance_correlation(offset_by(values, offset), values) == pytest.approx(
            expected, rel=1e-6
        )

    def test_loa_multiplier_is_the_conventional_one(self):
        test = [1.0, 3.0, 5.0, 7.0, 9.0]
        reference = [2.0, 2.0, 6.0, 6.0, 10.0]
        result = bland_altman(test, reference)
        expected_span = 2 * 1.96 * result.sd_difference
        assert result.loa_width == pytest.approx(expected_span)
        assert not math.isnan(result.loa_width)
