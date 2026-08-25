/**
 * Left ventricular volumes by Simpson's method of disks
 *
 * The ASE-recommended method for LV volumes from 2D echo. The traced
 * endocardial border is divided into 20 disks stacked along the long axis; each
 * disk's volume is its cross-sectional area times the disk height, and the
 * total is their sum.
 *
 *   Single plane: the disk is assumed circular, so the one traced view sets
 *   both of its axes.  V = Σ (π/4) · d² · (L/20)
 *
 *   Biplane: A4C and A2C are traced independently and supply the two axes of
 *   an elliptical disk at each level.  V = Σ (π/4) · a · b · (L/20)
 *
 * Biplane is the reference standard because it does not assume the ventricle is
 * rotationally symmetric — the assumption that fails hardest in exactly the
 * remodelled ventricles where the number matters most.
 *
 * Not to be confused with `calculateVolumeSimpsons` in geometryService, which
 * integrates the areas of parallel CT/MR slices. Same name, different method.
 */

import type { Point2D, PixelSpacing } from '../types';

/** ASE convention. */
export const SIMPSON_DISK_COUNT = 20;

export type VolumeMethod = 'biplane' | 'single-plane';

export interface LongAxis {
  /** Midpoint of the mitral annulus. */
  base: Point2D;
  /** Apex of the ventricle. */
  apex: Point2D;
}

export interface DiskMeasurement {
  /** 0 at the base, increasing toward the apex. */
  index: number;
  /** Disk diameter in millimetres. */
  diameterMm: number;
}

export interface SinglePlaneVolumeResult {
  method: 'single-plane';
  volumeMl: number;
  longAxisMm: number;
  diskCount: number;
  disks: DiskMeasurement[];
}

export interface BiplaneVolumeResult {
  method: 'biplane';
  volumeMl: number;
  /** The longer measured LV length from A4C/A2C, per ASE chamber guidance. */
  longAxisMm: number;
  a4cLongAxisMm: number;
  a2cLongAxisMm: number;
  /** Absolute difference between the two long axes, as a fraction of the longer. */
  longAxisDiscrepancy: number;
  diskCount: number;
}

export type VolumeResult = SinglePlaneVolumeResult | BiplaneVolumeResult;

/**
 * ASE guidance treats a long-axis difference beyond ~10% between the two apical
 * views as evidence that one of them is foreshortened.
 */
export const FORESHORTENING_THRESHOLD = 0.1;

const toMm = (point: Point2D, spacing: PixelSpacing): Point2D => ({
  x: point.x * spacing.columnSpacing,
  y: point.y * spacing.rowSpacing,
});

const distanceMm = (a: Point2D, b: Point2D, spacing: PixelSpacing): number => {
  const am = toMm(a, spacing);
  const bm = toMm(b, spacing);
  return Math.hypot(bm.x - am.x, bm.y - am.y);
};

/**
 * Find the apex: the contour point furthest from the annulus midpoint.
 *
 * This is a starting position, not a final answer — the user can drag it. It is
 * still a measurement of the traced border, which is what distinguishes it from
 * assuming a long axis from the area.
 */
export function findApex(contour: Point2D[], base: Point2D): Point2D | null {
  if (contour.length < 3) return null;
  let apex = contour[0];
  let furthest = -1;
  for (const point of contour) {
    const d = Math.hypot(point.x - base.x, point.y - base.y);
    if (d > furthest) {
      furthest = d;
      apex = point;
    }
  }
  return apex;
}

/**
 * Estimate the long axis of a traced apical contour, with no landmarks placed.
 *
 * The contour's principal axis is found by eigen-decomposition of its
 * covariance; the ventricle's long axis runs along it. Which end is the apex is
 * then decided by taper: an apical LV trace is widest at the mitral annulus and
 * narrows toward the apex, so the wider end is the base.
 *
 * This is a starting position the operator can drag, not a substitute for their
 * judgement. What matters is that the axis is *measured from the trace* rather
 * than assumed from its area.
 */
export function estimateLongAxisFromContour(contour: Point2D[]): LongAxis | null {
  if (contour.length < 8) return null;

  const n = contour.length;
  const cx = contour.reduce((sum, p) => sum + p.x, 0) / n;
  const cy = contour.reduce((sum, p) => sum + p.y, 0) / n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const point of contour) {
    const dx = point.x - cx;
    const dy = point.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= n;
  syy /= n;
  sxy /= n;

  // Principal eigenvector of the 2x2 covariance matrix.
  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  const eigenvalue = trace / 2 + disc;

  let ax: number;
  let ay: number;
  if (Math.abs(sxy) > 1e-9) {
    ax = eigenvalue - syy;
    ay = sxy;
  } else {
    // Axis-aligned contour; pick whichever axis has more spread.
    ax = sxx >= syy ? 1 : 0;
    ay = sxx >= syy ? 0 : 1;
  }
  const norm = Math.hypot(ax, ay);
  if (norm === 0) return null;
  ax /= norm;
  ay /= norm;

  // Extremes of the projection onto the principal axis are the two ends.
  let minT = Infinity;
  let maxT = -Infinity;
  for (const point of contour) {
    const t = (point.x - cx) * ax + (point.y - cy) * ay;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }
  if (!Number.isFinite(minT) || !Number.isFinite(maxT) || maxT - minT === 0) return null;

  const endA = { x: cx + ax * minT, y: cy + ay * minT };
  const endB = { x: cx + ax * maxT, y: cy + ay * maxT };

  // Compare widths a short way in from each end; the annulus end is wider.
  const direction = { x: ax, y: ay };
  const inset = (maxT - minT) * 0.15;
  const probeA = { x: cx + ax * (minT + inset), y: cy + ay * (minT + inset) };
  const probeB = { x: cx + ax * (maxT - inset), y: cy + ay * (maxT - inset) };

  const chordA = contourChord(contour, probeA, direction);
  const chordB = contourChord(contour, probeB, direction);
  const widthA = chordA ? Math.hypot(chordA.max.x - chordA.min.x, chordA.max.y - chordA.min.y) : 0;
  const widthB = chordB ? Math.hypot(chordB.max.x - chordB.min.x, chordB.max.y - chordB.min.y) : 0;

  return widthA >= widthB ? { base: endA, apex: endB } : { base: endB, apex: endA };
}

/** Flip which end of the axis is treated as the apex. */
export function flipLongAxis(axis: LongAxis): LongAxis {
  return { base: axis.apex, apex: axis.base };
}

/** Long axis from two annulus points and the contour they belong to. */
export function buildLongAxis(
  contour: Point2D[],
  annulusA: Point2D,
  annulusB: Point2D,
): LongAxis | null {
  const base = { x: (annulusA.x + annulusB.x) / 2, y: (annulusA.y + annulusB.y) / 2 };
  const apex = findApex(contour, base);
  if (!apex) return null;
  return { base, apex };
}

/**
 * Intersections of a closed contour with an infinite line, returned as the
 * parameter positions along that line's direction.
 */
function contourChord(
  contour: Point2D[],
  origin: Point2D,
  direction: Point2D,
): { min: Point2D; max: Point2D } | null {
  // Perpendicular to the long axis; the chord runs along it.
  const nx = -direction.y;
  const ny = direction.x;

  const hits: { point: Point2D; t: number }[] = [];

  for (let i = 0; i < contour.length; i += 1) {
    const p1 = contour[i];
    const p2 = contour[(i + 1) % contour.length];

    // Signed distance of each endpoint from the cutting line.
    const d1 = (p1.x - origin.x) * direction.x + (p1.y - origin.y) * direction.y;
    const d2 = (p2.x - origin.x) * direction.x + (p2.y - origin.y) * direction.y;

    if ((d1 > 0 && d2 > 0) || (d1 < 0 && d2 < 0)) continue;
    const span = d1 - d2;
    if (span === 0) continue;

    const s = d1 / span;
    const point = { x: p1.x + (p2.x - p1.x) * s, y: p1.y + (p2.y - p1.y) * s };
    hits.push({ point, t: (point.x - origin.x) * nx + (point.y - origin.y) * ny });
  }

  if (hits.length < 2) return null;
  hits.sort((a, b) => a.t - b.t);
  return { min: hits[0].point, max: hits[hits.length - 1].point };
}

/**
 * Measure the disk diameters of a traced contour along its long axis.
 *
 * Disks are sampled at the midpoint of each slab, which is the midpoint rule
 * for the integral and avoids the zero-width disk at the apex that sampling at
 * slab edges would produce.
 */
export function measureDisks(
  contour: Point2D[],
  axis: LongAxis,
  spacing: PixelSpacing,
  diskCount: number = SIMPSON_DISK_COUNT,
): DiskMeasurement[] {
  if (contour.length < 3 || diskCount < 1) return [];

  const dx = axis.apex.x - axis.base.x;
  const dy = axis.apex.y - axis.base.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [];

  const direction = { x: dx / length, y: dy / length };
  const disks: DiskMeasurement[] = [];

  for (let i = 0; i < diskCount; i += 1) {
    const fraction = (i + 0.5) / diskCount;
    const origin = {
      x: axis.base.x + dx * fraction,
      y: axis.base.y + dy * fraction,
    };
    const chord = contourChord(contour, origin, direction);
    disks.push({
      index: i,
      diameterMm: chord ? distanceMm(chord.min, chord.max, spacing) : 0,
    });
  }

  return disks;
}

/** Long-axis length in millimetres. */
export function longAxisLengthMm(axis: LongAxis, spacing: PixelSpacing): number {
  return distanceMm(axis.base, axis.apex, spacing);
}

/**
 * Single-plane Simpson's volume from one traced apical view.
 *
 * Each disk is treated as circular, so this assumes a rotationally symmetric
 * ventricle. Prefer biplane when both views are available.
 */
export function singlePlaneVolume(
  contour: Point2D[],
  axis: LongAxis,
  spacing: PixelSpacing,
  diskCount: number = SIMPSON_DISK_COUNT,
): SinglePlaneVolumeResult | null {
  const disks = measureDisks(contour, axis, spacing, diskCount);
  if (disks.length === 0) return null;

  const longAxisMm = longAxisLengthMm(axis, spacing);
  if (longAxisMm <= 0) return null;

  const height = longAxisMm / diskCount;
  const volumeMm3 = disks.reduce(
    (sum, disk) => sum + (Math.PI / 4) * disk.diameterMm * disk.diameterMm * height,
    0,
  );

  return {
    method: 'single-plane',
    volumeMl: volumeMm3 / 1000,
    longAxisMm,
    diskCount,
    disks,
  };
}

export interface BiplaneInput {
  contour: Point2D[];
  axis: LongAxis;
  spacing: PixelSpacing;
}

/**
 * Biplane Simpson's volume from matched A4C and A2C traces.
 *
 * Disks are paired by fractional position along each view's own long axis, so
 * disk *i* describes the same fractional anatomical level in both views even
 * when the two traces differ slightly in length. ASE chamber guidance specifies
 * the longer measured LV length from A4C/A2C for the biplane calculation.
 */
export function biplaneVolume(
  a4c: BiplaneInput,
  a2c: BiplaneInput,
  diskCount: number = SIMPSON_DISK_COUNT,
): BiplaneVolumeResult | null {
  const a4cDisks = measureDisks(a4c.contour, a4c.axis, a4c.spacing, diskCount);
  const a2cDisks = measureDisks(a2c.contour, a2c.axis, a2c.spacing, diskCount);
  if (a4cDisks.length === 0 || a2cDisks.length === 0) return null;

  const a4cLongAxisMm = longAxisLengthMm(a4c.axis, a4c.spacing);
  const a2cLongAxisMm = longAxisLengthMm(a2c.axis, a2c.spacing);
  if (a4cLongAxisMm <= 0 || a2cLongAxisMm <= 0) return null;

  const longAxisMm = Math.max(a4cLongAxisMm, a2cLongAxisMm);
  const longer = Math.max(a4cLongAxisMm, a2cLongAxisMm);
  const height = longAxisMm / diskCount;

  let volumeMm3 = 0;
  for (let i = 0; i < diskCount; i += 1) {
    volumeMm3 += (Math.PI / 4) * a4cDisks[i].diameterMm * a2cDisks[i].diameterMm * height;
  }

  return {
    method: 'biplane',
    volumeMl: volumeMm3 / 1000,
    longAxisMm,
    a4cLongAxisMm,
    a2cLongAxisMm,
    longAxisDiscrepancy: longer > 0 ? Math.abs(a4cLongAxisMm - a2cLongAxisMm) / longer : 0,
    diskCount,
  };
}

/** True when the two apical views disagree enough to suspect foreshortening. */
export function isForeshortened(result: BiplaneVolumeResult): boolean {
  return result.longAxisDiscrepancy > FORESHORTENING_THRESHOLD;
}

/**
 * Ejection fraction from end-diastolic and end-systolic volumes.
 *
 * EF is a ratio of volumes. Computing it from areas instead gives fractional
 * area change, which is a different measurement with different reference
 * ranges — volume scales with roughly area^1.5, so an area ratio reads low.
 */
export function ejectionFraction(edvMl: number, esvMl: number): number | null {
  if (!Number.isFinite(edvMl) || !Number.isFinite(esvMl) || edvMl <= 0) return null;
  if (esvMl < 0 || esvMl > edvMl) return null;
  return ((edvMl - esvMl) / edvMl) * 100;
}

/**
 * Body surface area by the Du Bois formula, in m².
 *
 * Volumes are classified on their BSA-indexed values, not their absolute ones.
 */
export function bodySurfaceArea(heightCm: number, weightKg: number): number | null {
  if (!(heightCm > 0) || !(weightKg > 0)) return null;
  return 0.007184 * Math.pow(heightCm, 0.725) * Math.pow(weightKg, 0.425);
}

/** Index a volume to body surface area, in mL/m². */
export function indexToBsa(volumeMl: number, bsaM2: number | null): number | null {
  if (bsaM2 === null || !(bsaM2 > 0)) return null;
  return volumeMl / bsaM2;
}
