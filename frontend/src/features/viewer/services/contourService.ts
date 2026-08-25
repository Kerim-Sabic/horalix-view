/**
 * Contour shaping
 *
 * Pure geometry for hand-drawn borders: simplify away the noise a mouse
 * introduces, smooth the corners a sampled path leaves behind, and splice a
 * corrective stroke into an existing contour.
 *
 * Smoothing runs once when a stroke is committed, never while drawing. Doing it
 * per-sample would fight the user's hand and make the line feel like it lags.
 */

import type { Point2D } from '../types';

const distance = (a: Point2D, b: Point2D) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Perpendicular distance from `point` to the segment `start`-`end`.
 */
function perpendicularDistance(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return distance(point, start);

  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq;
  const clamped = Math.max(0, Math.min(1, t));
  return distance(point, { x: start.x + clamped * dx, y: start.y + clamped * dy });
}

/**
 * Ramer-Douglas-Peucker simplification.
 *
 * Drops points that lie within `tolerance` of the line their neighbours
 * already describe, so a fast stroke and a slow one over the same border end
 * up with comparable point counts.
 */
export function simplifyContour(points: Point2D[], tolerance: number): Point2D[] {
  if (points.length <= 2 || tolerance <= 0) return points;

  let maxDistance = 0;
  let index = 0;
  const last = points.length - 1;

  for (let i = 1; i < last; i += 1) {
    const d = perpendicularDistance(points[i], points[0], points[last]);
    if (d > maxDistance) {
      maxDistance = d;
      index = i;
    }
  }

  if (maxDistance <= tolerance) {
    return [points[0], points[last]];
  }

  const head = simplifyContour(points.slice(0, index + 1), tolerance);
  const tail = simplifyContour(points.slice(index), tolerance);
  return [...head.slice(0, -1), ...tail];
}

/**
 * One iteration of Chaikin's corner-cutting on a closed contour.
 *
 * Each edge contributes two points at 1/4 and 3/4 along it, which rounds
 * corners without pulling the curve away from the traced border the way a
 * moving average does.
 */
function chaikinOnce(points: Point2D[]): Point2D[] {
  const count = points.length;
  if (count < 3) return points;

  const result: Point2D[] = [];
  for (let i = 0; i < count; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % count];
    result.push({
      x: current.x * 0.75 + next.x * 0.25,
      y: current.y * 0.75 + next.y * 0.25,
    });
    result.push({
      x: current.x * 0.25 + next.x * 0.75,
      y: current.y * 0.25 + next.y * 0.75,
    });
  }
  return result;
}

/**
 * Smooth a closed contour by corner-cutting.
 *
 * Two iterations is enough to remove hand tremor; more starts visibly shrinking
 * the enclosed area, which would bias every measurement taken from it.
 */
export function smoothClosedContour(points: Point2D[], iterations = 2): Point2D[] {
  if (points.length < 3 || iterations <= 0) return points;
  let result = points;
  for (let i = 0; i < iterations; i += 1) {
    result = chaikinOnce(result);
  }
  return result;
}

/** Total length of a contour, closing it back to the first point. */
export function contourPerimeter(points: Point2D[], closed = true): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1], points[i]);
  }
  if (closed && points.length > 2) {
    total += distance(points[points.length - 1], points[0]);
  }
  return total;
}

/**
 * Resample a closed contour to exactly `targetCount` evenly spaced points.
 *
 * Tracking needs a stable point count across frames so that point *i* means
 * the same place on the border in every frame.
 */
export function resampleClosedContour(points: Point2D[], targetCount: number): Point2D[] {
  if (points.length < 3 || targetCount < 3) return points;

  const closed = [...points, points[0]];
  const cumulative: number[] = [0];
  for (let i = 1; i < closed.length; i += 1) {
    cumulative.push(cumulative[i - 1] + distance(closed[i - 1], closed[i]));
  }

  const total = cumulative[cumulative.length - 1];
  if (total === 0) return points;

  const step = total / targetCount;
  const result: Point2D[] = [];
  let segment = 1;

  for (let i = 0; i < targetCount; i += 1) {
    const target = i * step;
    while (segment < cumulative.length - 1 && cumulative[segment] < target) {
      segment += 1;
    }
    const previous = cumulative[segment - 1];
    const next = cumulative[segment];
    const span = next - previous;
    const t = span === 0 ? 0 : (target - previous) / span;
    const a = closed[segment - 1];
    const b = closed[segment];
    result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }

  return result;
}

export interface FinishStrokeOptions {
  /** Simplification tolerance in image pixels. */
  tolerance?: number;
  /** Chaikin iterations. */
  smoothing?: number;
  /** Cap on the final point count; tracking rejects contours above this. */
  maxPoints?: number;
}

/**
 * Turn a raw freehand stroke into a contour worth measuring.
 *
 * Simplify first so smoothing operates on the shape rather than on sampling
 * noise, then smooth, then cap the point count.
 */
export function finishFreehandStroke(
  raw: Point2D[],
  { tolerance = 1.2, smoothing = 2, maxPoints = 96 }: FinishStrokeOptions = {}
): Point2D[] {
  if (raw.length < 3) return raw;

  const simplified = simplifyContour(raw, tolerance);
  if (simplified.length < 3) return raw;

  const smoothed = smoothClosedContour(simplified, smoothing);
  if (smoothed.length > maxPoints) {
    return resampleClosedContour(smoothed, maxPoints);
  }
  return smoothed;
}

/** Index of the contour point nearest `target`, or -1 for an empty contour. */
export function nearestPointIndex(contour: Point2D[], target: Point2D): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < contour.length; i += 1) {
    const d = distance(contour[i], target);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

/**
 * Splice a corrective stroke into an existing closed contour.
 *
 * The stroke's endpoints are matched to the nearest points on the contour, and
 * the shorter of the two arcs between them is replaced. This is what makes a
 * slightly wrong border fixable without retracing the whole thing.
 *
 * Returns null when the stroke is too short or its ends land on the same place,
 * so the caller can fall back to starting a new contour.
 */
export function spliceStroke(
  contour: Point2D[],
  stroke: Point2D[]
): Point2D[] | null {
  if (contour.length < 3 || stroke.length < 2) return null;

  const startIndex = nearestPointIndex(contour, stroke[0]);
  const endIndex = nearestPointIndex(contour, stroke[stroke.length - 1]);
  if (startIndex < 0 || endIndex < 0 || startIndex === endIndex) return null;

  // Two arcs connect the endpoints; replace whichever is shorter, since the
  // stroke is a local correction rather than a redefinition of the contour.
  const forward: Point2D[] = [];
  for (let i = endIndex; i !== startIndex; i = (i + 1) % contour.length) {
    forward.push(contour[i]);
  }
  forward.push(contour[startIndex]);

  const backward: Point2D[] = [];
  for (let i = startIndex; i !== endIndex; i = (i + 1) % contour.length) {
    backward.push(contour[i]);
  }
  backward.push(contour[endIndex]);

  const keep = forward.length >= backward.length ? forward : backward;
  const oriented = forward.length >= backward.length ? stroke : [...stroke].reverse();

  const merged = [...keep, ...oriented];
  return merged.length >= 3 ? merged : null;
}

/**
 * True when `point` lies within `tolerance` of any edge of a closed contour.
 *
 * Used to decide whether a new stroke is a correction to an existing contour or
 * the start of a new one.
 */
export function isNearContour(
  contour: Point2D[],
  point: Point2D,
  tolerance: number
): boolean {
  if (contour.length < 2) return false;
  for (let i = 0; i < contour.length; i += 1) {
    const start = contour[i];
    const end = contour[(i + 1) % contour.length];
    if (perpendicularDistance(point, start, end) <= tolerance) return true;
  }
  return false;
}
