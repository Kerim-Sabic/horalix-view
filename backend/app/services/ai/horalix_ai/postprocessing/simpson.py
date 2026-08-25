"""Left ventricular volume by Simpson's method of disks.

Mirrors the frontend implementation in
``features/viewer/services/ventricleVolumeService.ts`` so a volume produced by
the model and one traced by hand are computed the same way and can be compared
directly.

This replaces an earlier estimate that applied the area-length formula
``V = (8/3pi) A^2 / L`` with ``L`` supplied as ``sqrt(A) * 1.5`` -- a fixed
shape constant rather than a measurement. Ejection fraction partly survived that
because the constant cancels between end-diastole and end-systole, but the
volumes in millilitres did not: they were an area re-expressed through an
assumption about LV geometry, and that assumption fails hardest in the dilated
and aneurysmal ventricles where the number matters most.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

#: ASE convention for the number of disks.
SIMPSON_DISK_COUNT = 20


@dataclass(frozen=True)
class LongAxis:
    """Long axis of a ventricle, in pixel coordinates."""

    base_x: float
    base_y: float
    apex_x: float
    apex_y: float

    @property
    def base(self) -> tuple[float, float]:
        return (self.base_x, self.base_y)

    @property
    def apex(self) -> tuple[float, float]:
        return (self.apex_x, self.apex_y)


@dataclass(frozen=True)
class SimpsonResult:
    """A single-plane Simpson's volume and the measurements behind it."""

    volume_ml: float
    long_axis_cm: float
    disk_diameters_cm: list[float]
    disk_count: int
    method: str = "simpson_single_plane"


def _covariance_axis(points: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    """Principal axis of a point cloud: (centroid, unit direction)."""
    if points.shape[0] < 8:
        return None

    centroid = points.mean(axis=0)
    centred = points - centroid
    covariance = np.cov(centred, rowvar=False)
    if not np.all(np.isfinite(covariance)):
        return None

    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    direction = eigenvectors[:, int(np.argmax(eigenvalues))]
    norm = float(np.linalg.norm(direction))
    if norm == 0:
        return None
    return centroid, direction / norm


def _chord_width(
    contour: np.ndarray,
    origin: np.ndarray,
    direction: np.ndarray,
) -> float:
    """Width of the contour across the line through ``origin`` perpendicular to
    ``direction``, in pixels."""
    # Signed distance of each vertex from the cutting line.
    offsets = (contour - origin) @ direction
    rolled_offsets = np.roll(offsets, -1)
    rolled_contour = np.roll(contour, -1, axis=0)

    # Edges that straddle the line.
    crossing = (offsets > 0) != (rolled_offsets > 0)
    if not np.any(crossing):
        return 0.0

    starts = contour[crossing]
    ends = rolled_contour[crossing]
    d1 = offsets[crossing]
    d2 = rolled_offsets[crossing]

    span = d1 - d2
    span = np.where(span == 0, np.finfo(float).eps, span)
    t = (d1 / span)[:, None]
    hits = starts + (ends - starts) * t

    if hits.shape[0] < 2:
        return 0.0

    # Project onto the perpendicular and take the extent.
    perpendicular = np.array([-direction[1], direction[0]])
    projections = (hits - origin) @ perpendicular
    return float(projections.max() - projections.min())


def estimate_long_axis(contour: np.ndarray) -> LongAxis | None:
    """Estimate the long axis of a traced apical contour.

    The principal axis of the contour gives the direction. Which end is the apex
    is decided by taper: an apical LV trace is widest at the mitral annulus and
    narrows toward the apex, so the wider end is the base.

    Args:
        contour: (N, 2) array of x, y pixel coordinates.

    Returns:
        The long axis, or None when the contour is too small to fit one.
    """
    points = np.asarray(contour, dtype=float)
    if points.ndim != 2 or points.shape[1] != 2:
        return None

    axis = _covariance_axis(points)
    if axis is None:
        return None
    centroid, direction = axis

    offsets = (points - centroid) @ direction
    min_t = float(offsets.min())
    max_t = float(offsets.max())
    if max_t - min_t <= 0:
        return None

    end_a = centroid + direction * min_t
    end_b = centroid + direction * max_t

    # Compare widths a short way in from each end.
    inset = (max_t - min_t) * 0.15
    width_a = _chord_width(points, centroid + direction * (min_t + inset), direction)
    width_b = _chord_width(points, centroid + direction * (max_t - inset), direction)

    base, apex = (end_a, end_b) if width_a >= width_b else (end_b, end_a)
    return LongAxis(
        base_x=float(base[0]),
        base_y=float(base[1]),
        apex_x=float(apex[0]),
        apex_y=float(apex[1]),
    )


def simpson_single_plane(
    contour: np.ndarray,
    pixel_spacing_mm: tuple[float, float],
    axis: LongAxis | None = None,
    disk_count: int = SIMPSON_DISK_COUNT,
) -> SimpsonResult | None:
    """Left ventricular volume from one traced apical contour.

    Args:
        contour: (N, 2) array of x, y pixel coordinates.
        pixel_spacing_mm: (row_mm, column_mm) millimetres per pixel.
        axis: Long axis; estimated from the contour when omitted.
        disk_count: Number of disks; 20 by ASE convention.

    Returns:
        The volume and the measurements behind it, or None when the contour
        cannot support a disk stack.
    """
    points = np.asarray(contour, dtype=float)
    if points.ndim != 2 or points.shape[1] != 2 or points.shape[0] < 8:
        return None
    if disk_count < 1:
        return None

    row_mm, col_mm = pixel_spacing_mm
    if not (row_mm > 0 and col_mm > 0):
        return None

    resolved_axis = axis or estimate_long_axis(points)
    if resolved_axis is None:
        return None

    base = np.array(resolved_axis.base, dtype=float)
    apex = np.array(resolved_axis.apex, dtype=float)
    delta = apex - base
    length_px = float(np.linalg.norm(delta))
    if length_px == 0:
        return None
    direction = delta / length_px

    # Long axis in centimetres, honouring anisotropic spacing.
    long_axis_cm = (
        float(np.hypot(delta[0] * col_mm, delta[1] * row_mm)) / 10.0
    )
    if long_axis_cm <= 0:
        return None

    height_cm = long_axis_cm / disk_count
    perpendicular = np.array([-direction[1], direction[0]])

    diameters_cm: list[float] = []
    volume_cm3 = 0.0

    for i in range(disk_count):
        # Midpoint rule: sample at the centre of each slab rather than its edge,
        # which avoids a zero-width disk at the apex.
        fraction = (i + 0.5) / disk_count
        origin = base + delta * fraction
        width_px = _chord_width(points, origin, direction)

        # The chord runs along the perpendicular, so convert its pixel length
        # using the spacing components along that direction.
        diameter_cm = (
            float(
                np.hypot(
                    width_px * perpendicular[0] * col_mm,
                    width_px * perpendicular[1] * row_mm,
                )
            )
            / 10.0
        )
        diameters_cm.append(diameter_cm)
        volume_cm3 += (np.pi / 4.0) * diameter_cm * diameter_cm * height_cm

    return SimpsonResult(
        volume_ml=float(volume_cm3),
        long_axis_cm=long_axis_cm,
        disk_diameters_cm=diameters_cm,
        disk_count=disk_count,
    )


def simpson_biplane(
    a4c_contour: np.ndarray,
    a2c_contour: np.ndarray,
    a4c_spacing_mm: tuple[float, float],
    a2c_spacing_mm: tuple[float, float],
    disk_count: int = SIMPSON_DISK_COUNT,
) -> SimpsonResult | None:
    """Left ventricular volume from matched A4C and A2C traces.

    Disks are elliptical, with each view supplying one axis at the same
    fractional level along its own long axis. This is the reference standard
    because it does not assume the ventricle is rotationally symmetric.
    """
    a4c = simpson_single_plane(a4c_contour, a4c_spacing_mm, disk_count=disk_count)
    a2c = simpson_single_plane(a2c_contour, a2c_spacing_mm, disk_count=disk_count)
    if a4c is None or a2c is None:
        return None

    # ASE: use the shorter long axis for disk height.
    long_axis_cm = min(a4c.long_axis_cm, a2c.long_axis_cm)
    height_cm = long_axis_cm / disk_count

    volume_cm3 = sum(
        (np.pi / 4.0) * a * b * height_cm
        for a, b in zip(a4c.disk_diameters_cm, a2c.disk_diameters_cm)
    )

    return SimpsonResult(
        volume_ml=float(volume_cm3),
        long_axis_cm=long_axis_cm,
        disk_diameters_cm=a4c.disk_diameters_cm,
        disk_count=disk_count,
        method="simpson_biplane",
    )


def ejection_fraction(edv_ml: float, esv_ml: float) -> float | None:
    """Ejection fraction from volumes, as a percentage.

    Returns None rather than a misleading value when the inputs cannot describe
    a cardiac cycle.
    """
    if not np.isfinite(edv_ml) or not np.isfinite(esv_ml):
        return None
    if edv_ml <= 0 or esv_ml < 0 or esv_ml > edv_ml:
        return None
    return float((edv_ml - esv_ml) / edv_ml * 100.0)
