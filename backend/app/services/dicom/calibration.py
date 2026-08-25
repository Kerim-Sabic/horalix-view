"""Spatial calibration for DICOM images.

A single source of truth for "how many millimetres is one pixel?".

For CT/MR/CR this is simply ``PixelSpacing`` (0028,0030). For ultrasound it
usually is not present at all: echo images carry their calibration in the
Sequence of Ultrasound Regions (0018,6011), one entry per region of the image
(the 2D sector, an M-mode strip, a spectral Doppler trace...), each with its
own ``PhysicalDeltaX``/``PhysicalDeltaY`` and its own *units*.

Reading the first region blindly is wrong: on a duplex image the first region
may be a spectral Doppler trace whose X axis is measured in seconds. Only a
region whose spatial format is 2D and whose axes are both in centimetres can
calibrate a distance or area measurement.

Nothing here guesses. When no region qualifies, the result carries
``source="none"`` and callers must treat the image as uncalibrated rather than
falling back to 1 mm/px.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from app.core.logging import get_logger

logger = get_logger(__name__)

# Region Spatial Format (0018,6012)
REGION_SPATIAL_FORMAT_2D = 1

# Region Data Type (0018,6014)
REGION_DATA_TYPE_TISSUE = 1
REGION_DATA_TYPE_COLOR_FLOW = 2

# Physical Units X/Y Direction (0018,6024) / (0018,6026)
PHYSICAL_UNIT_CM = 3

# Below this the delta is almost certainly a units error rather than a real
# probe geometry (0.1 um/px), and above it a single pixel would span 1 cm.
MIN_PLAUSIBLE_MM_PER_PX = 1e-4
MAX_PLAUSIBLE_MM_PER_PX = 10.0


@dataclass(frozen=True)
class UltrasoundRegion:
    """The image rectangle a calibration applies to, in pixels."""

    min_x: int
    min_y: int
    max_x: int
    max_y: int

    def contains(self, x: float, y: float) -> bool:
        return self.min_x <= x <= self.max_x and self.min_y <= y <= self.max_y

    @property
    def area_px(self) -> int:
        return max(0, self.max_x - self.min_x) * max(0, self.max_y - self.min_y)


@dataclass(frozen=True)
class Calibration:
    """Millimetres per pixel, and where the value came from.

    ``source`` is one of:
      ``pixel_spacing``      - PixelSpacing (0028,0030)
      ``ultrasound_region``  - a 2D region of SequenceOfUltrasoundRegions
      ``imager_pixel_spacing`` - ImagerPixelSpacing (0018,1164), detector-plane
      ``none``               - the image is not spatially calibrated
    """

    row_mm: float | None
    column_mm: float | None
    source: str
    region: UltrasoundRegion | None = None

    @property
    def is_calibrated(self) -> bool:
        return (
            self.row_mm is not None
            and self.column_mm is not None
            and self.source != "none"
        )

    @property
    def as_tuple(self) -> tuple[float, float] | None:
        """(row_mm, column_mm), or None when uncalibrated."""
        if not self.is_calibrated:
            return None
        return (float(self.row_mm), float(self.column_mm))  # type: ignore[arg-type]

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "row_mm": self.row_mm,
            "column_mm": self.column_mm,
            "source": self.source,
        }
        if self.region is not None:
            payload["region"] = asdict(self.region)
        return payload


UNCALIBRATED = Calibration(row_mm=None, column_mm=None, source="none")


def _plausible(value: float) -> bool:
    return MIN_PLAUSIBLE_MM_PER_PX <= value <= MAX_PLAUSIBLE_MM_PER_PX


def _pair_from_pixel_spacing(raw: Any) -> tuple[float, float] | None:
    try:
        row_mm = float(raw[0])
        column_mm = float(raw[1])
    except (TypeError, ValueError, IndexError):
        return None
    if not (_plausible(row_mm) and _plausible(column_mm)):
        return None
    return row_mm, column_mm


def _region_bounds(region: Any) -> UltrasoundRegion | None:
    try:
        return UltrasoundRegion(
            min_x=int(region.RegionLocationMinX0),
            min_y=int(region.RegionLocationMinY0),
            max_x=int(region.RegionLocationMaxX1),
            max_y=int(region.RegionLocationMaxY1),
        )
    except (AttributeError, TypeError, ValueError):
        return None


def _calibration_from_region(region: Any) -> Calibration | None:
    """Return a calibration for a single ultrasound region, or None if it
    cannot calibrate a spatial measurement."""
    spatial_format = getattr(region, "RegionSpatialFormat", None)
    if spatial_format is not None and int(spatial_format) != REGION_SPATIAL_FORMAT_2D:
        # M-mode and spectral regions have a time axis; not spatially measurable.
        return None

    units_x = getattr(region, "PhysicalUnitsXDirection", None)
    units_y = getattr(region, "PhysicalUnitsYDirection", None)
    if units_x is None or units_y is None:
        return None
    if int(units_x) != PHYSICAL_UNIT_CM or int(units_y) != PHYSICAL_UNIT_CM:
        return None

    delta_x = getattr(region, "PhysicalDeltaX", None)
    delta_y = getattr(region, "PhysicalDeltaY", None)
    if delta_x is None or delta_y is None:
        return None

    try:
        # PhysicalDelta is cm per pixel along each axis; DICOM allows a signed
        # value to encode axis direction, and magnitude is what we measure with.
        column_mm = abs(float(delta_x)) * 10.0
        row_mm = abs(float(delta_y)) * 10.0
    except (TypeError, ValueError):
        return None

    if not (_plausible(row_mm) and _plausible(column_mm)):
        return None

    return Calibration(
        row_mm=row_mm,
        column_mm=column_mm,
        source="ultrasound_region",
        region=_region_bounds(region),
    )


def _score_region(
    calibration: Calibration,
    region: Any,
    center: tuple[float, float] | None,
) -> tuple[int, int, int]:
    """Rank candidate regions. Higher sorts first.

    Preference order: the region containing the image centre, then a tissue
    (B-mode) region over colour flow, then the physically largest region.
    """
    contains_center = 0
    if center is not None and calibration.region is not None:
        contains_center = 1 if calibration.region.contains(*center) else 0

    data_type = getattr(region, "RegionDataType", None)
    is_tissue = 0
    if data_type is not None:
        try:
            is_tissue = 1 if int(data_type) == REGION_DATA_TYPE_TISSUE else 0
        except (TypeError, ValueError):
            is_tissue = 0

    area = calibration.region.area_px if calibration.region is not None else 0
    return (contains_center, is_tissue, area)


def calibration_from_ultrasound_regions(ds: Any) -> Calibration | None:
    """Best 2D calibration among the ultrasound regions, if any qualifies."""
    regions = getattr(ds, "SequenceOfUltrasoundRegions", None)
    if not regions:
        return None

    rows = getattr(ds, "Rows", None)
    columns = getattr(ds, "Columns", None)
    center: tuple[float, float] | None = None
    if rows and columns:
        center = (float(columns) / 2.0, float(rows) / 2.0)

    candidates: list[tuple[tuple[int, int, int], Calibration]] = []
    for region in regions:
        calibration = _calibration_from_region(region)
        if calibration is None:
            continue
        candidates.append((_score_region(calibration, region, center), calibration))

    if not candidates:
        return None

    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def get_calibration(ds: Any) -> Calibration:
    """Resolve millimetres-per-pixel for a DICOM dataset.

    Ultrasound regions are consulted before ``PixelSpacing`` when the modality
    is US, because some vendors emit a placeholder ``PixelSpacing`` on echo
    images that does not describe the sector geometry.
    """
    modality = str(getattr(ds, "Modality", "") or "").upper()

    if modality == "US":
        from_regions = calibration_from_ultrasound_regions(ds)
        if from_regions is not None:
            return from_regions

    raw_spacing = getattr(ds, "PixelSpacing", None)
    if raw_spacing:
        pair = _pair_from_pixel_spacing(raw_spacing)
        if pair is not None:
            return Calibration(row_mm=pair[0], column_mm=pair[1], source="pixel_spacing")

    if modality != "US":
        from_regions = calibration_from_ultrasound_regions(ds)
        if from_regions is not None:
            return from_regions

    raw_imager = getattr(ds, "ImagerPixelSpacing", None)
    if raw_imager:
        pair = _pair_from_pixel_spacing(raw_imager)
        if pair is not None:
            # Detector-plane spacing, not patient-plane; usable but distinct.
            return Calibration(
                row_mm=pair[0], column_mm=pair[1], source="imager_pixel_spacing"
            )

    logger.debug(
        "No spatial calibration found (modality=%s, has_regions=%s)",
        modality or "unknown",
        bool(getattr(ds, "SequenceOfUltrasoundRegions", None)),
    )
    return UNCALIBRATED
