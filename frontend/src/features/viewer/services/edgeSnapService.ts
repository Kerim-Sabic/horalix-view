/**
 * Magnetic edge snapping for traced contours
 *
 * The endocardial border is a strong intensity gradient: dark blood pool inside,
 * bright myocardium outside. Nudging each traced point onto the nearest gradient
 * peak along the contour's local normal removes the last few pixels of hand
 * error without taking the trace away from the operator -- the shape stays
 * theirs, only the placement is refined.
 *
 * This is deliberately not an active contour. A snake would move points to
 * wherever its energy term prefers, including away from a border the operator
 * placed correctly on a poorly-contrasted segment. Searching a few pixels along
 * the normal cannot do that: with no gradient in range, the point stays put.
 */

import type { Point2D } from '../types';

/** Reads luminance at a pixel. Returns null outside the image. */
export type LuminanceSampler = (x: number, y: number) => number | null;

export interface SnapOptions {
  /** How far along the normal to search, in image pixels. */
  radius?: number;
  /**
   * Minimum gradient magnitude to accept, in luminance units per pixel.
   * Below this the neighbourhood is flat and the point is left alone.
   */
  minGradient?: number;
}

const DEFAULT_RADIUS = 4;
const DEFAULT_MIN_GRADIENT = 6;

/**
 * Build a sampler over an ImageData buffer.
 *
 * Uses Rec. 601 luma, which matches how a grayscale ultrasound frame is
 * encoded into RGB by the server-side renderer.
 */
export function createLuminanceSampler(
  data: ImageData,
  imageWidth: number,
  imageHeight: number
): LuminanceSampler {
  const { width, height, data: pixels } = data;
  const scaleX = width / imageWidth;
  const scaleY = height / imageHeight;

  return (x: number, y: number): number | null => {
    const px = Math.round(x * scaleX);
    const py = Math.round(y * scaleY);
    if (px < 0 || py < 0 || px >= width || py >= height) return null;
    const offset = (py * width + px) * 4;
    return (
      0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2]
    );
  };
}

/**
 * Outward normal at point `i` of a closed contour.
 *
 * Taken from the neighbouring points rather than the point itself, so a single
 * jittery sample does not rotate the search direction.
 */
export function contourNormal(points: Point2D[], index: number): Point2D {
  const count = points.length;
  const previous = points[(index - 1 + count) % count];
  const next = points[(index + 1) % count];

  const tx = next.x - previous.x;
  const ty = next.y - previous.y;
  const length = Math.hypot(tx, ty);
  if (length === 0) return { x: 0, y: 0 };

  // Rotate the tangent by 90 degrees.
  return { x: -ty / length, y: tx / length };
}

/**
 * Move one point onto the strongest intensity gradient along `normal`.
 *
 * Returns the original point when nothing in range beats `minGradient`.
 */
export function snapPointToEdge(
  point: Point2D,
  normal: Point2D,
  sample: LuminanceSampler,
  { radius = DEFAULT_RADIUS, minGradient = DEFAULT_MIN_GRADIENT }: SnapOptions = {}
): Point2D {
  if (normal.x === 0 && normal.y === 0) return point;

  let best = point;
  let bestGradient = minGradient;

  for (let offset = -radius; offset <= radius; offset += 1) {
    const x = point.x + normal.x * offset;
    const y = point.y + normal.y * offset;

    // Central difference along the normal.
    const ahead = sample(x + normal.x, y + normal.y);
    const behind = sample(x - normal.x, y - normal.y);
    if (ahead === null || behind === null) continue;

    const gradient = Math.abs(ahead - behind) / 2;
    if (gradient > bestGradient) {
      bestGradient = gradient;
      best = { x, y };
    }
  }

  return best;
}

/**
 * Snap every point of a closed contour onto the nearest strong edge.
 *
 * Points with no gradient in range are left exactly where they were, so a
 * segment traced across a dropout is preserved rather than pulled onto whatever
 * noise happens to be nearby.
 */
export function snapContourToEdges(
  points: Point2D[],
  sample: LuminanceSampler,
  options: SnapOptions = {}
): Point2D[] {
  if (points.length < 3) return points;
  return points.map((point, index) =>
    snapPointToEdge(point, contourNormal(points, index), sample, options)
  );
}

/**
 * Fraction of points that moved, as a confidence signal.
 *
 * A low value means the snap found little to lock onto -- worth surfacing, since
 * it usually indicates a poorly contrasted border rather than a perfect trace.
 */
export function snapCoverage(before: Point2D[], after: Point2D[]): number {
  if (before.length === 0 || before.length !== after.length) return 0;
  let moved = 0;
  for (let i = 0; i < before.length; i += 1) {
    if (Math.hypot(after[i].x - before[i].x, after[i].y - before[i].y) > 0.01) {
      moved += 1;
    }
  }
  return moved / before.length;
}
