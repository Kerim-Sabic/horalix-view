import { describe, expect, it } from 'vitest';

import {
  contourPerimeter,
  finishFreehandStroke,
  isNearContour,
  nearestPointIndex,
  resampleClosedContour,
  simplifyContour,
  smoothClosedContour,
  spliceStroke,
} from '../services/contourService';
import { calculatePolygonAreaPixels } from '../services/geometryService';
import type { Point2D } from '../types';

const square: Point2D[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

/** A circle sampled densely, standing in for a traced border. */
const circle = (radius: number, count: number, cx = 0, cy = 0): Point2D[] =>
  Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });

describe('simplifyContour', () => {
  it('drops collinear points', () => {
    const line: Point2D[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ];
    expect(simplifyContour(line, 0.1)).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it('keeps points that carry the shape', () => {
    const corner: Point2D[] = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 0 },
    ];
    expect(simplifyContour(corner, 0.1)).toHaveLength(3);
  });

  it('removes jitter without moving the corners', () => {
    const jittered: Point2D[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0.3 },
      { x: 4, y: -0.3 },
      { x: 6, y: 0.2 },
      { x: 8, y: -0.2 },
      { x: 10, y: 0 },
    ];
    const result = simplifyContour(jittered, 1);
    expect(result.length).toBeLessThan(jittered.length);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[result.length - 1]).toEqual({ x: 10, y: 0 });
  });

  it('is a no-op below three points', () => {
    const pair = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(simplifyContour(pair, 5)).toEqual(pair);
  });
});

describe('smoothClosedContour', () => {
  it('doubles the point count per iteration', () => {
    expect(smoothClosedContour(square, 1)).toHaveLength(8);
    expect(smoothClosedContour(square, 2)).toHaveLength(16);
  });

  it('keeps the contour centred where it was', () => {
    const smoothed = smoothClosedContour(square, 2);
    const cx = smoothed.reduce((sum, p) => sum + p.x, 0) / smoothed.length;
    const cy = smoothed.reduce((sum, p) => sum + p.y, 0) / smoothed.length;
    expect(cx).toBeCloseTo(5, 1);
    expect(cy).toBeCloseTo(5, 1);
  });

  it('shrinks the enclosed area only slightly', () => {
    // Corner-cutting always loses a little area; if it lost a lot, every
    // measurement taken from a smoothed contour would read low.
    const before = calculatePolygonAreaPixels(circle(50, 64));
    const after = calculatePolygonAreaPixels(smoothClosedContour(circle(50, 64), 2));
    expect(after / before).toBeGreaterThan(0.99);
  });

  it('is a no-op at zero iterations', () => {
    expect(smoothClosedContour(square, 0)).toEqual(square);
  });
});

describe('resampleClosedContour', () => {
  it('returns exactly the requested point count', () => {
    expect(resampleClosedContour(circle(10, 100), 32)).toHaveLength(32);
  });

  it('spaces points evenly around the contour', () => {
    const resampled = resampleClosedContour(circle(10, 100), 40);
    const gaps = resampled.map((p, i) => {
      const next = resampled[(i + 1) % resampled.length];
      return Math.hypot(next.x - p.x, next.y - p.y);
    });
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    gaps.forEach((gap) => expect(gap).toBeCloseTo(mean, 1));
  });

  it('preserves the enclosed area', () => {
    const before = calculatePolygonAreaPixels(circle(20, 128));
    const after = calculatePolygonAreaPixels(resampleClosedContour(circle(20, 128), 48));
    expect(after / before).toBeGreaterThan(0.99);
  });
});

describe('contourPerimeter', () => {
  it('closes the loop when asked', () => {
    expect(contourPerimeter(square, true)).toBe(40);
  });

  it('leaves the loop open otherwise', () => {
    expect(contourPerimeter(square, false)).toBe(30);
  });
});

describe('finishFreehandStroke', () => {
  it('caps the point count at the tracking limit', () => {
    const dense = circle(100, 500);
    const result = finishFreehandStroke(dense, { maxPoints: 96 });
    expect(result.length).toBeLessThanOrEqual(96);
  });

  it('keeps a traced circle circular', () => {
    const result = finishFreehandStroke(circle(50, 200));
    const radii = result.map((p) => Math.hypot(p.x, p.y));
    const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
    expect(mean).toBeGreaterThan(48);
    expect(mean).toBeLessThan(51);
  });

  it('passes very short strokes through untouched', () => {
    const tiny = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(finishFreehandStroke(tiny)).toEqual(tiny);
  });

  it('skips smoothing when iterations are zero', () => {
    const raw = circle(30, 40);
    const result = finishFreehandStroke(raw, { smoothing: 0, tolerance: 0.01 });
    expect(result.length).toBeLessThanOrEqual(raw.length);
  });
});

describe('nearestPointIndex', () => {
  it('finds the closest vertex', () => {
    expect(nearestPointIndex(square, { x: 9, y: 9 })).toBe(2);
  });

  it('returns -1 for an empty contour', () => {
    expect(nearestPointIndex([], { x: 0, y: 0 })).toBe(-1);
  });
});

describe('spliceStroke', () => {
  it('replaces an arc with the corrective stroke', () => {
    const contour = circle(10, 24);
    const stroke: Point2D[] = [
      { x: 10, y: 0 },
      { x: 14, y: 4 },
      { x: 10, y: 8 },
    ];
    const merged = spliceStroke(contour, stroke);
    expect(merged).not.toBeNull();
    // The bulge the stroke describes has to survive into the result.
    expect(merged!.some((p) => p.x > 13)).toBe(true);
  });

  it('produces a contour that still encloses an area', () => {
    const contour = circle(10, 24);
    const stroke: Point2D[] = [
      { x: 10, y: 0 },
      { x: 13, y: 3 },
      { x: 9, y: 6 },
    ];
    const merged = spliceStroke(contour, stroke)!;
    expect(calculatePolygonAreaPixels(merged)).toBeGreaterThan(0);
  });

  it('rejects a stroke whose ends land on the same point', () => {
    const stroke = [{ x: 10, y: 0 }, { x: 10.01, y: 0.01 }];
    expect(spliceStroke(circle(10, 24), stroke)).toBeNull();
  });

  it('rejects a single-point stroke', () => {
    expect(spliceStroke(square, [{ x: 0, y: 0 }])).toBeNull();
  });

  it('rejects splicing into a degenerate contour', () => {
    expect(spliceStroke([{ x: 0, y: 0 }], square)).toBeNull();
  });
});

describe('isNearContour', () => {
  it('detects a point on an edge, not just on a vertex', () => {
    // The midpoint of the top edge is far from every vertex.
    expect(isNearContour(square, { x: 5, y: 0.5 }, 1)).toBe(true);
  });

  it('rejects a point outside the tolerance', () => {
    expect(isNearContour(square, { x: 5, y: 5 }, 1)).toBe(false);
  });

  it('treats the closing edge as part of the contour', () => {
    expect(isNearContour(square, { x: 0.2, y: 5 }, 1)).toBe(true);
  });

  it('returns false for a degenerate contour', () => {
    expect(isNearContour([{ x: 0, y: 0 }], { x: 0, y: 0 }, 5)).toBe(false);
  });
});
