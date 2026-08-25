"""Method-comparison statistics for measurement validation.

Testing a volume calculation against analytic geometry proves the arithmetic is
right. It says nothing about whether the numbers agree with a reference method
on real ventricles, which is the question that decides whether they can be
reported clinically.

Answering it needs paired measurements — the same case measured by this viewer
and by the reference — and the statistics below. Correlation is not enough and
is the usual mistake: two methods can correlate almost perfectly while one reads
systematically 20 mL high, because correlation measures whether the values move
together, not whether they are the same. Bland-Altman answers the question that
matters (how far apart are they, and how far apart could they be for the next
patient), and Lin's concordance and ICC add the agreement-versus-association
distinction on a single scale.

None of this decides anything on its own. It produces the numbers a reviewer
needs to decide.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Sequence

import numpy as np

#: The conventional Bland-Altman coverage: limits enclose ~95% of differences.
LOA_MULTIPLIER = 1.96


@dataclass(frozen=True)
class BlandAltman:
    """Agreement between two methods measuring the same quantity."""

    n: int
    #: Mean difference (test - reference). Positive means the test reads high.
    bias: float
    #: Standard deviation of the differences.
    sd_difference: float
    lower_loa: float
    upper_loa: float
    #: 95% confidence interval on the bias itself.
    bias_ci_lower: float
    bias_ci_upper: float
    #: Bias as a percentage of the mean measurement, for scale-free comparison.
    bias_percent: float
    #: True when the bias CI excludes zero, i.e. a systematic offset is present.
    bias_is_significant: bool

    @property
    def loa_width(self) -> float:
        """How far apart the limits are; the practical spread of disagreement."""
        return self.upper_loa - self.lower_loa


@dataclass(frozen=True)
class AgreementReport:
    """Everything needed to judge whether two methods can be used
    interchangeably for a given measurement."""

    measurement: str
    unit: str
    bland_altman: BlandAltman
    #: Lin's concordance correlation coefficient: agreement with the line of
    #: identity, not with a best-fit line.
    concordance: float
    #: Pearson correlation, reported only to contrast with concordance -- a gap
    #: between the two is exactly the systematic offset correlation hides.
    correlation: float
    #: ICC(2,1): two-way random effects, absolute agreement, single measurement.
    icc: float
    #: Ordinary least squares fit of test on reference.
    slope: float
    intercept: float
    #: Cases excluded because either value was missing or non-finite.
    excluded: int = 0
    notes: list[str] = field(default_factory=list)


def _clean_pairs(
    test: Sequence[float], reference: Sequence[float]
) -> tuple[np.ndarray, np.ndarray, int]:
    """Drop pairs where either value is missing or non-finite."""
    if len(test) != len(reference):
        raise ValueError(
            f"Paired data required: got {len(test)} test and {len(reference)} reference values"
        )

    a = np.asarray(test, dtype=float)
    b = np.asarray(reference, dtype=float)
    usable = np.isfinite(a) & np.isfinite(b)
    return a[usable], b[usable], int((~usable).sum())


def bland_altman(test: Sequence[float], reference: Sequence[float]) -> BlandAltman:
    """Bias and limits of agreement between two methods.

    The limits describe where the difference for a *future* case is expected to
    fall. They are what a reviewer weighs against the clinically acceptable
    error for the measurement -- a bias near zero with limits spanning 40 mL is
    not interchangeable, however good the correlation looks.
    """
    a, b, _ = _clean_pairs(test, reference)
    n = a.size
    if n < 2:
        raise ValueError("At least two complete pairs are required")

    differences = a - b
    bias = float(np.mean(differences))
    sd = float(np.std(differences, ddof=1))

    # Confidence interval on the bias, using the normal approximation for
    # larger samples and Student's t below that.
    standard_error = sd / math.sqrt(n)
    critical = LOA_MULTIPLIER if n >= 30 else _t_critical_95(n - 1)
    ci_lower = bias - critical * standard_error
    ci_upper = bias + critical * standard_error

    grand_mean = float(np.mean((a + b) / 2))
    bias_percent = (bias / grand_mean * 100.0) if grand_mean != 0 else 0.0

    return BlandAltman(
        n=n,
        bias=bias,
        sd_difference=sd,
        lower_loa=bias - LOA_MULTIPLIER * sd,
        upper_loa=bias + LOA_MULTIPLIER * sd,
        bias_ci_lower=ci_lower,
        bias_ci_upper=ci_upper,
        bias_percent=bias_percent,
        bias_is_significant=not (ci_lower <= 0.0 <= ci_upper),
    )


#: Two-sided 95% critical values of Student's t, by degrees of freedom.
_T_TABLE = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
    8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145,
    15: 2.131, 16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086,
    21: 2.080, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.060, 26: 2.056,
    27: 2.052, 28: 2.048, 29: 2.045,
}


def _t_critical_95(df: int) -> float:
    if df in _T_TABLE:
        return _T_TABLE[df]
    return LOA_MULTIPLIER


def concordance_correlation(test: Sequence[float], reference: Sequence[float]) -> float:
    """Lin's concordance correlation coefficient.

    Measures agreement with the 45-degree line of identity rather than with a
    best-fit line, so a method that reads consistently high scores poorly here
    even when its Pearson correlation is near 1.
    """
    a, b, _ = _clean_pairs(test, reference)
    if a.size < 2:
        raise ValueError("At least two complete pairs are required")

    mean_a = float(np.mean(a))
    mean_b = float(np.mean(b))
    var_a = float(np.var(a))
    var_b = float(np.var(b))
    covariance = float(np.mean((a - mean_a) * (b - mean_b)))

    denominator = var_a + var_b + (mean_a - mean_b) ** 2
    if denominator == 0:
        # Both methods returned a single identical constant.
        return 1.0
    return 2.0 * covariance / denominator


def pearson_correlation(test: Sequence[float], reference: Sequence[float]) -> float:
    """Pearson r. Reported only alongside concordance, never instead of it."""
    a, b, _ = _clean_pairs(test, reference)
    if a.size < 2:
        raise ValueError("At least two complete pairs are required")
    if np.std(a) == 0 or np.std(b) == 0:
        return 0.0
    return float(np.corrcoef(a, b)[0, 1])


def intraclass_correlation(test: Sequence[float], reference: Sequence[float]) -> float:
    """ICC(2,1): two-way random effects, absolute agreement, single rater.

    Absolute agreement rather than consistency, so a systematic offset between
    the methods reduces it -- which is the point.
    """
    a, b, _ = _clean_pairs(test, reference)
    n = a.size
    if n < 2:
        raise ValueError("At least two complete pairs are required")

    matrix = np.column_stack([a, b])
    k = matrix.shape[1]

    grand_mean = float(np.mean(matrix))
    row_means = np.mean(matrix, axis=1)
    column_means = np.mean(matrix, axis=0)

    # Mean squares for rows (subjects), columns (methods), and residual error.
    ss_rows = k * float(np.sum((row_means - grand_mean) ** 2))
    ss_columns = n * float(np.sum((column_means - grand_mean) ** 2))
    ss_total = float(np.sum((matrix - grand_mean) ** 2))
    ss_error = ss_total - ss_rows - ss_columns

    df_rows = n - 1
    df_columns = k - 1
    df_error = df_rows * df_columns
    if df_rows <= 0 or df_error <= 0:
        return 0.0

    ms_rows = ss_rows / df_rows
    ms_columns = ss_columns / df_columns
    ms_error = ss_error / df_error

    denominator = ms_rows + (k - 1) * ms_error + k * (ms_columns - ms_error) / n
    if denominator == 0:
        return 0.0
    return float((ms_rows - ms_error) / denominator)


def linear_fit(test: Sequence[float], reference: Sequence[float]) -> tuple[float, float]:
    """Least-squares slope and intercept of test on reference."""
    a, b, _ = _clean_pairs(test, reference)
    if a.size < 2 or float(np.std(b)) == 0:
        return (0.0, 0.0)
    slope, intercept = np.polyfit(b, a, 1)
    return (float(slope), float(intercept))


def build_report(
    measurement: str,
    unit: str,
    test: Sequence[float],
    reference: Sequence[float],
    *,
    acceptable_bias: float | None = None,
    acceptable_loa_width: float | None = None,
) -> AgreementReport:
    """Full method-comparison report for one measurement.

    ``acceptable_bias`` and ``acceptable_loa_width`` are the clinically
    tolerable limits for this measurement, in its own units. They are supplied
    by whoever is reviewing rather than assumed here, because what counts as
    acceptable depends on the decision the number feeds.
    """
    a, b, excluded = _clean_pairs(test, reference)
    stats = bland_altman(a, b)
    slope, intercept = linear_fit(a, b)

    notes: list[str] = []
    if excluded:
        notes.append(f"{excluded} pair(s) excluded for missing or non-finite values.")
    if stats.n < 20:
        notes.append(
            f"Only {stats.n} pairs; limits of agreement are wide and unstable below "
            "about 20 cases. Treat this as a smoke test, not a validation."
        )
    if stats.bias_is_significant:
        notes.append(
            f"Systematic offset: bias {stats.bias:.2f} {unit} "
            f"(95% CI {stats.bias_ci_lower:.2f} to {stats.bias_ci_upper:.2f}) excludes zero."
        )
    if acceptable_bias is not None and abs(stats.bias) > acceptable_bias:
        notes.append(
            f"Bias {stats.bias:.2f} {unit} exceeds the stated tolerance of "
            f"{acceptable_bias:.2f} {unit}."
        )
    if acceptable_loa_width is not None and stats.loa_width > acceptable_loa_width:
        notes.append(
            f"Limits of agreement span {stats.loa_width:.2f} {unit}, wider than the stated "
            f"tolerance of {acceptable_loa_width:.2f} {unit}."
        )

    correlation = pearson_correlation(a, b)
    concordance = concordance_correlation(a, b)
    if correlation - concordance > 0.1:
        notes.append(
            "Correlation materially exceeds concordance: the methods track each other but "
            "do not agree, which is the pattern a systematic offset produces."
        )

    return AgreementReport(
        measurement=measurement,
        unit=unit,
        bland_altman=stats,
        concordance=concordance,
        correlation=correlation,
        icc=intraclass_correlation(a, b),
        slope=slope,
        intercept=intercept,
        excluded=excluded,
        notes=notes,
    )


def format_report(report: AgreementReport) -> str:
    """Render a report as plain text for a terminal or a log."""
    ba = report.bland_altman
    lines = [
        f"{report.measurement} ({report.unit})",
        "-" * max(24, len(report.measurement) + len(report.unit) + 3),
        f"  Pairs analysed      {ba.n}" + (f"  ({report.excluded} excluded)" if report.excluded else ""),
        f"  Bias                {ba.bias:+.2f} {report.unit}  ({ba.bias_percent:+.1f}%)",
        f"  95% CI of bias      {ba.bias_ci_lower:+.2f} to {ba.bias_ci_upper:+.2f}",
        f"  Limits of agreement {ba.lower_loa:+.2f} to {ba.upper_loa:+.2f}  "
        f"(span {ba.loa_width:.2f})",
        f"  Concordance (CCC)   {report.concordance:.3f}",
        f"  Correlation (r)     {report.correlation:.3f}",
        f"  ICC(2,1)            {report.icc:.3f}",
        f"  Fit                 test = {report.slope:.3f} x reference {report.intercept:+.2f}",
    ]
    if report.notes:
        lines.append("  Notes")
        lines.extend(f"    - {note}" for note in report.notes)
    return "\n".join(lines)
