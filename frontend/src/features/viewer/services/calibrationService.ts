/**
 * Spatial calibration
 *
 * One place that answers "can this image be measured in millimetres, and at
 * what scale?". Every measurement in the viewer goes through here.
 *
 * The rule this module exists to enforce: when an image carries no spatial
 * calibration, measurements are reported in pixels and labelled as such. They
 * are never silently scaled by 1 mm/px, because a pixel count wearing a mm
 * label is indistinguishable from a real measurement at the point of care.
 */

import type { Instance, PixelSpacingSource } from '@/services/api';

import type { PixelSpacing, Point2D } from '../types';

export type MeasurementUnit = 'mm' | 'px';

export interface Calibration {
  /** Millimetres per pixel, or null when the image is uncalibrated. */
  spacing: PixelSpacing | null;
  /** Where the spacing came from. */
  source: PixelSpacingSource;
  /** Unit that lengths should be reported in. */
  lengthUnit: MeasurementUnit;
  /** Unit that areas should be reported in. */
  areaUnit: 'mm²' | 'px²';
  /** Volumes require real spacing; never available uncalibrated. */
  canMeasureVolume: boolean;
  /** Pixel bounds the calibration is valid inside, ultrasound only. */
  region: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

export const UNCALIBRATED: Calibration = {
  spacing: null,
  source: 'none',
  lengthUnit: 'px',
  areaUnit: 'px²',
  canMeasureVolume: false,
  region: null,
};

/**
 * Resolve the calibration for an instance.
 *
 * Returns UNCALIBRATED rather than a 1 mm/px fallback when the instance has no
 * usable spacing — callers must handle that case explicitly.
 */
export function getCalibration(instance: Instance | null | undefined): Calibration {
  if (!instance) return UNCALIBRATED;

  const source = instance.pixel_spacing_source ?? 'none';
  const raw = instance.pixel_spacing;

  if (source === 'none' || !raw || raw.length !== 2) {
    return UNCALIBRATED;
  }

  const [rowSpacing, columnSpacing] = raw;
  if (
    !Number.isFinite(rowSpacing) ||
    !Number.isFinite(columnSpacing) ||
    rowSpacing <= 0 ||
    columnSpacing <= 0
  ) {
    return UNCALIBRATED;
  }

  const bounds = instance.ultrasound_region;
  return {
    spacing: { rowSpacing, columnSpacing },
    source,
    lengthUnit: 'mm',
    areaUnit: 'mm²',
    canMeasureVolume: true,
    region:
      bounds && bounds.length === 4
        ? { minX: bounds[0], minY: bounds[1], maxX: bounds[2], maxY: bounds[3] }
        : null,
  };
}

/**
 * Spacing to hand to the geometry helpers.
 *
 * Uncalibrated images use unit spacing so the same code path produces a pixel
 * count — but the caller must pair it with `calibration.lengthUnit`, never
 * assume mm.
 */
export function spacingForGeometry(calibration: Calibration): PixelSpacing {
  return calibration.spacing ?? { rowSpacing: 1, columnSpacing: 1 };
}

/** True when every point lies inside the calibrated region (or there is none). */
export function pointsWithinCalibratedRegion(
  calibration: Calibration,
  points: Point2D[]
): boolean {
  const { region } = calibration;
  if (!region || points.length === 0) return true;
  return points.every(
    (p) => p.x >= region.minX && p.x <= region.maxX && p.y >= region.minY && p.y <= region.maxY
  );
}

/** Format a length for display, with the unit the calibration allows. */
export function formatLength(
  value: number | null | undefined,
  calibration: Calibration,
  decimals = 1
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(decimals)} ${calibration.lengthUnit}`;
}

/** Format an area for display, with the unit the calibration allows. */
export function formatArea(
  value: number | null | undefined,
  calibration: Calibration,
  decimals = 1
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(decimals)} ${calibration.areaUnit}`;
}

/** Short reason a study cannot be measured, for display next to the tools. */
export function uncalibratedReason(instance: Instance | null | undefined): string | null {
  if (!instance) return null;
  const calibration = getCalibration(instance);
  if (calibration.spacing) return null;
  return 'This image carries no spatial calibration, so measurements are shown in pixels. Volume tools are unavailable.';
}
