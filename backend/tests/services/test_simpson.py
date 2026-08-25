"""Tests for Simpson's method of disks.

The behaviour under test is that volumes come from a *measured* long axis. The
implementation this replaces derived the long axis from the area with a fixed
constant, which made the millilitre figures an assumption about ventricular
shape rather than a measurement of one.
"""

import numpy as np
import pytest

from app.services.ai.horalix_ai.postprocessing.simpson import (
    SIMPSON_DISK_COUNT,
    LongAxis,
    ejection_fraction,
    estimate_long_axis,
    simpson_biplane,
    simpson_single_plane,
)

#: 1 px == 1 mm, so pixel and millimetre figures coincide.
UNIT_SPACING = (1.0, 1.0)


def ellipse(semi_minor: float, semi_major: float, count: int = 180) -> np.ndarray:
    """An ellipse with its long axis vertical, standing in for an apical trace."""
    angles = np.linspace(0, 2 * np.pi, count, endpoint=False)
    return np.column_stack(
        [np.cos(angles) * semi_minor, np.sin(angles) * semi_major]
    )


def tapered(count: int = 180) -> np.ndarray:
    """Wide at the base (y<0), narrowing toward the apex (y>0)."""
    angles = np.linspace(0, 2 * np.pi, count, endpoint=False)
    y = np.sin(angles) * 50
    half_width = 22 - ((y + 50) / 100) * 12
    return np.column_stack([np.cos(angles) * half_width, y])


def prolate_spheroid_ml(semi_minor: float, semi_major: float) -> float:
    """Analytic volume of the solid an ellipse sweeps about its long axis."""
    return (4 / 3) * np.pi * semi_minor**2 * semi_major / 1000.0


class TestEstimateLongAxis:
    def test_finds_the_full_length(self):
        axis = estimate_long_axis(tapered())
        assert axis is not None
        length = np.hypot(axis.apex_x - axis.base_x, axis.apex_y - axis.base_y)
        assert length > 90

    def test_puts_base_at_the_wide_end(self):
        axis = estimate_long_axis(tapered())
        assert axis is not None
        assert axis.base_y < 0
        assert axis.apex_y > 0

    def test_follows_a_rotated_ventricle(self):
        theta = np.pi / 5
        rotation = np.array(
            [[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]]
        )
        axis = estimate_long_axis(tapered() @ rotation.T)
        assert axis is not None
        expected_apex = rotation @ np.array([0.0, 50.0])
        assert np.hypot(axis.apex_x - expected_apex[0], axis.apex_y - expected_apex[1]) < 12

    def test_rejects_a_tiny_contour(self):
        assert estimate_long_axis(np.array([[0.0, 0.0], [1.0, 1.0]])) is None

    def test_rejects_a_malformed_array(self):
        assert estimate_long_axis(np.zeros((10, 3))) is None


class TestSinglePlane:
    def test_matches_the_analytic_volume(self):
        result = simpson_single_plane(ellipse(20, 50), UNIT_SPACING)
        assert result is not None
        expected = prolate_spheroid_ml(20, 50)
        assert result.volume_ml == pytest.approx(expected, rel=0.05)

    def test_returns_the_measured_long_axis(self):
        result = simpson_single_plane(ellipse(20, 50), UNIT_SPACING)
        assert result is not None
        # 100 px at 1 mm/px == 10 cm.
        assert result.long_axis_cm == pytest.approx(10.0, rel=0.02)

    def test_uses_the_ase_disk_count(self):
        result = simpson_single_plane(ellipse(20, 50), UNIT_SPACING)
        assert result is not None
        assert result.disk_count == SIMPSON_DISK_COUNT
        assert len(result.disk_diameters_cm) == SIMPSON_DISK_COUNT

    def test_scales_cubically_with_spacing(self):
        contour = ellipse(20, 50)
        fine = simpson_single_plane(contour, (1.0, 1.0))
        coarse = simpson_single_plane(contour, (2.0, 2.0))
        assert fine is not None and coarse is not None
        assert coarse.volume_ml / fine.volume_ml == pytest.approx(8.0, rel=0.05)

    def test_honours_an_explicit_axis(self):
        result = simpson_single_plane(
            ellipse(20, 50),
            UNIT_SPACING,
            axis=LongAxis(base_x=0, base_y=-50, apex_x=0, apex_y=50),
        )
        assert result is not None
        assert result.long_axis_cm == pytest.approx(10.0)

    def test_rejects_a_zero_length_axis(self):
        result = simpson_single_plane(
            ellipse(20, 50),
            UNIT_SPACING,
            axis=LongAxis(base_x=1, base_y=1, apex_x=1, apex_y=1),
        )
        assert result is None

    def test_rejects_non_positive_spacing(self):
        assert simpson_single_plane(ellipse(20, 50), (0.0, 1.0)) is None
        assert simpson_single_plane(ellipse(20, 50), (1.0, -1.0)) is None

    def test_rejects_a_contour_too_small_to_fit(self):
        assert simpson_single_plane(np.zeros((4, 2)), UNIT_SPACING) is None

    def test_does_not_reproduce_the_old_area_length_estimate(self):
        """The previous code took L as sqrt(A) * 1.5 and applied the
        area-length formula. That is what this replaces."""
        contour = ellipse(20, 50)
        result = simpson_single_plane(contour, UNIT_SPACING)
        assert result is not None

        area_cm2 = (np.pi * 20 * 50) / 100.0
        assumed_length_cm = np.sqrt(area_cm2) * 1.5
        old_estimate = (8 / (3 * np.pi)) * area_cm2**2 / assumed_length_cm

        # The assumed axis is materially shorter than the measured one, and
        # because it sits in the denominator the volume is inflated by more than
        # the axis error alone -- the old figure is a different quantity, not a
        # noisier version of this one.
        assert assumed_length_cm < result.long_axis_cm * 0.9
        assert abs(old_estimate - result.volume_ml) > result.volume_ml * 0.15


class TestBiplane:
    def test_matches_single_plane_for_identical_views(self):
        contour = ellipse(20, 50)
        single = simpson_single_plane(contour, UNIT_SPACING)
        both = simpson_biplane(contour, contour, UNIT_SPACING, UNIT_SPACING)
        assert single is not None and both is not None
        assert both.volume_ml == pytest.approx(single.volume_ml, rel=1e-6)

    def test_uses_each_view_independently(self):
        wide = ellipse(20, 50)
        narrow = ellipse(12, 50)
        both = simpson_biplane(wide, narrow, UNIT_SPACING, UNIT_SPACING)
        single_wide = simpson_single_plane(wide, UNIT_SPACING)
        assert both is not None and single_wide is not None
        assert both.volume_ml < single_wide.volume_ml
        assert both.volume_ml / single_wide.volume_ml == pytest.approx(12 / 20, rel=0.1)

    def test_labels_its_method(self):
        contour = ellipse(20, 50)
        both = simpson_biplane(contour, contour, UNIT_SPACING, UNIT_SPACING)
        assert both is not None
        assert both.method == "simpson_biplane"

    def test_returns_none_when_a_view_cannot_be_fitted(self):
        assert (
            simpson_biplane(ellipse(20, 50), np.zeros((3, 2)), UNIT_SPACING, UNIT_SPACING)
            is None
        )


class TestEjectionFraction:
    def test_computes_from_volumes(self):
        assert ejection_fraction(120, 48) == pytest.approx(60.0)

    def test_rejects_a_non_positive_edv(self):
        assert ejection_fraction(0, 10) is None

    def test_rejects_esv_above_edv(self):
        assert ejection_fraction(50, 60) is None

    def test_rejects_non_finite_input(self):
        assert ejection_fraction(float("nan"), 10) is None
        assert ejection_fraction(120, float("inf")) is None
