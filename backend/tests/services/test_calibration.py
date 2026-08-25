"""Tests for DICOM spatial calibration resolution.

The behaviour under test is a clinical-safety rule: an image that carries no
usable spatial calibration must resolve to "uncalibrated", never to a 1 mm/px
default, because a pixel count labelled in millimetres is indistinguishable
from a real measurement.
"""

from types import SimpleNamespace

import pytest

from app.services.dicom.calibration import (
    PHYSICAL_UNIT_CM,
    REGION_DATA_TYPE_COLOR_FLOW,
    REGION_DATA_TYPE_TISSUE,
    REGION_SPATIAL_FORMAT_2D,
    Calibration,
    get_calibration,
)

# Physical Units values that are not centimetres.
PHYSICAL_UNIT_SECONDS = 4
PHYSICAL_UNIT_CM_PER_SEC = 7

# Region Spatial Format values.
SPATIAL_FORMAT_M_MODE = 2
SPATIAL_FORMAT_SPECTRAL = 3


def make_region(
    *,
    delta_x=0.02,
    delta_y=0.02,
    units_x=PHYSICAL_UNIT_CM,
    units_y=PHYSICAL_UNIT_CM,
    spatial_format=REGION_SPATIAL_FORMAT_2D,
    data_type=REGION_DATA_TYPE_TISSUE,
    bounds=(0, 0, 640, 480),
):
    return SimpleNamespace(
        PhysicalDeltaX=delta_x,
        PhysicalDeltaY=delta_y,
        PhysicalUnitsXDirection=units_x,
        PhysicalUnitsYDirection=units_y,
        RegionSpatialFormat=spatial_format,
        RegionDataType=data_type,
        RegionLocationMinX0=bounds[0],
        RegionLocationMinY0=bounds[1],
        RegionLocationMaxX1=bounds[2],
        RegionLocationMaxY1=bounds[3],
    )


def make_ds(*, modality="US", regions=None, rows=480, columns=640, **extra):
    ds = SimpleNamespace(Modality=modality, Rows=rows, Columns=columns, **extra)
    if regions is not None:
        ds.SequenceOfUltrasoundRegions = regions
    return ds


class TestUncalibrated:
    def test_no_tags_at_all_is_uncalibrated(self):
        result = get_calibration(make_ds())
        assert result.source == "none"
        assert result.is_calibrated is False
        assert result.as_tuple is None

    def test_uncalibrated_never_returns_unit_spacing(self):
        """The regression this module exists to prevent."""
        result = get_calibration(make_ds())
        assert result.as_tuple != (1.0, 1.0)
        assert result.row_mm is None
        assert result.column_mm is None

    def test_empty_region_sequence_is_uncalibrated(self):
        assert get_calibration(make_ds(regions=[])).source == "none"

    @pytest.mark.parametrize("spacing", [[0.0, 0.0], [-1.0, 2.0], ["x", "y"]])
    def test_implausible_pixel_spacing_rejected(self, spacing):
        ds = make_ds(modality="CT", PixelSpacing=spacing)
        assert get_calibration(ds).source == "none"

    def test_absurdly_large_spacing_rejected(self):
        # 50 mm per pixel is not a real acquisition.
        ds = make_ds(modality="CT", PixelSpacing=[50.0, 50.0])
        assert get_calibration(ds).source == "none"


class TestPixelSpacing:
    def test_ct_uses_pixel_spacing(self):
        ds = make_ds(modality="CT", PixelSpacing=[0.7, 0.7])
        result = get_calibration(ds)
        assert result.source == "pixel_spacing"
        assert result.as_tuple == (0.7, 0.7)

    def test_row_and_column_order_preserved(self):
        ds = make_ds(modality="CT", PixelSpacing=[0.5, 0.9])
        result = get_calibration(ds)
        assert result.row_mm == 0.5
        assert result.column_mm == 0.9

    def test_imager_pixel_spacing_is_last_resort(self):
        ds = make_ds(modality="CR", ImagerPixelSpacing=[0.14, 0.14])
        result = get_calibration(ds)
        assert result.source == "imager_pixel_spacing"
        assert result.as_tuple == (0.14, 0.14)


class TestUltrasoundRegions:
    def test_cm_converted_to_mm(self):
        # 0.02 cm/px -> 0.2 mm/px
        ds = make_ds(regions=[make_region(delta_x=0.02, delta_y=0.03)])
        result = get_calibration(ds)
        assert result.source == "ultrasound_region"
        assert result.column_mm == pytest.approx(0.2)
        assert result.row_mm == pytest.approx(0.3)

    def test_region_bounds_captured(self):
        ds = make_ds(regions=[make_region(bounds=(10, 20, 600, 460))])
        region = get_calibration(ds).region
        assert region is not None
        assert (region.min_x, region.min_y, region.max_x, region.max_y) == (10, 20, 600, 460)

    def test_negative_delta_uses_magnitude(self):
        """DICOM permits a signed delta to encode axis direction."""
        ds = make_ds(regions=[make_region(delta_x=-0.02, delta_y=-0.02)])
        result = get_calibration(ds)
        assert result.column_mm == pytest.approx(0.2)
        assert result.row_mm == pytest.approx(0.2)

    def test_ultrasound_preferred_over_placeholder_pixel_spacing(self):
        """Some vendors emit a PixelSpacing on echo that does not describe the
        sector; the region is authoritative for US."""
        ds = make_ds(
            regions=[make_region(delta_x=0.02, delta_y=0.02)],
            PixelSpacing=[1.0, 1.0],
        )
        result = get_calibration(ds)
        assert result.source == "ultrasound_region"
        assert result.as_tuple == pytest.approx((0.2, 0.2))


class TestRegionSelection:
    def test_spectral_doppler_region_rejected(self):
        """A spectral region's X axis is seconds, not distance."""
        spectral = make_region(
            spatial_format=SPATIAL_FORMAT_SPECTRAL,
            units_x=PHYSICAL_UNIT_SECONDS,
            units_y=PHYSICAL_UNIT_CM_PER_SEC,
        )
        assert get_calibration(make_ds(regions=[spectral])).source == "none"

    def test_m_mode_region_rejected(self):
        m_mode = make_region(
            spatial_format=SPATIAL_FORMAT_M_MODE,
            units_x=PHYSICAL_UNIT_SECONDS,
        )
        assert get_calibration(make_ds(regions=[m_mode])).source == "none"

    def test_duplex_picks_the_2d_region_not_the_trace(self):
        """The bug this ordering prevents: reading the first region blindly on
        a duplex image calibrates distance against a time axis."""
        trace = make_region(
            spatial_format=SPATIAL_FORMAT_SPECTRAL,
            units_x=PHYSICAL_UNIT_SECONDS,
            units_y=PHYSICAL_UNIT_CM_PER_SEC,
            delta_x=0.005,
            delta_y=0.5,
            bounds=(0, 300, 640, 480),
        )
        sector = make_region(delta_x=0.03, delta_y=0.03, bounds=(0, 0, 640, 300))
        result = get_calibration(make_ds(regions=[trace, sector]))
        assert result.source == "ultrasound_region"
        assert result.as_tuple == pytest.approx((0.3, 0.3))

    def test_region_containing_image_centre_wins(self):
        off_centre = make_region(delta_x=0.01, delta_y=0.01, bounds=(0, 0, 100, 100))
        centred = make_region(delta_x=0.04, delta_y=0.04, bounds=(50, 40, 600, 450))
        ds = make_ds(regions=[off_centre, centred], rows=480, columns=640)
        assert get_calibration(ds).as_tuple == pytest.approx((0.4, 0.4))

    def test_tissue_preferred_over_colour_flow_at_same_position(self):
        colour = make_region(
            data_type=REGION_DATA_TYPE_COLOR_FLOW,
            delta_x=0.01,
            delta_y=0.01,
            bounds=(0, 0, 640, 480),
        )
        tissue = make_region(
            data_type=REGION_DATA_TYPE_TISSUE,
            delta_x=0.05,
            delta_y=0.05,
            bounds=(0, 0, 640, 480),
        )
        ds = make_ds(regions=[colour, tissue])
        assert get_calibration(ds).as_tuple == pytest.approx((0.5, 0.5))

    def test_region_missing_units_rejected(self):
        region = SimpleNamespace(PhysicalDeltaX=0.02, PhysicalDeltaY=0.02)
        assert get_calibration(make_ds(regions=[region])).source == "none"


class TestRegionGeometry:
    def test_contains_is_inclusive(self):
        ds = make_ds(regions=[make_region(bounds=(10, 10, 100, 100))])
        region = get_calibration(ds).region
        assert region is not None
        assert region.contains(10, 10)
        assert region.contains(100, 100)
        assert region.contains(55, 55)
        assert not region.contains(9, 55)
        assert not region.contains(55, 101)

    def test_area_px(self):
        ds = make_ds(regions=[make_region(bounds=(0, 0, 640, 480))])
        region = get_calibration(ds).region
        assert region is not None
        assert region.area_px == 640 * 480


class TestSerialisation:
    def test_to_dict_omits_region_when_absent(self):
        payload = Calibration(row_mm=0.5, column_mm=0.5, source="pixel_spacing").to_dict()
        assert payload == {"row_mm": 0.5, "column_mm": 0.5, "source": "pixel_spacing"}

    def test_to_dict_includes_region_when_present(self):
        ds = make_ds(regions=[make_region(bounds=(1, 2, 3, 4))])
        payload = get_calibration(ds).to_dict()
        assert payload["region"] == {"min_x": 1, "min_y": 2, "max_x": 3, "max_y": 4}
