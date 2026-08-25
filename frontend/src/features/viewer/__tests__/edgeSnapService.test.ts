import { describe, expect, it } from 'vitest';

import {
  contourNormal,
  snapContourToEdges,
  snapCoverage,
  snapPointToEdge,
} from '../services/edgeSnapService';
import type { LuminanceSampler } from '../services/edgeSnapService';
import type { Point2D } from '../types';

/**
 * A synthetic frame with a dark disc on a bright ground, standing in for a
 * blood pool inside myocardium. The edge sits at `radius` from the origin.
 */
const discSampler = (radius: number, inside = 20, outside = 200): LuminanceSampler =>
  (x, y) => (Math.hypot(x, y) < radius ? inside : outside);

/** A featureless frame: nothing to snap to. */
const flatSampler: LuminanceSampler = () => 128;

/** Reports out-of-bounds beyond a square, like a real image edge. */
const boundedSampler = (size: number): LuminanceSampler =>
  (x, y) => (x < 0 || y < 0 || x > size || y > size ? null : 128);

const circle = (radius: number, count: number): Point2D[] =>
  Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });

describe('contourNormal', () => {
  it('points perpendicular to the local tangent', () => {
    const square: Point2D[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const normal = contourNormal(square, 1);
    // Tangent through point 1 runs from (0,0) to (10,10); normal is perpendicular.
    expect(normal.x * 1 + normal.y * 1).toBeCloseTo(0, 5);
  });

  it('is a unit vector', () => {
    const normal = contourNormal(circle(10, 32), 5);
    expect(Math.hypot(normal.x, normal.y)).toBeCloseTo(1, 5);
  });

  it('returns a zero vector for a degenerate neighbourhood', () => {
    const degenerate: Point2D[] = [
      { x: 5, y: 5 },
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ];
    expect(contourNormal(degenerate, 1)).toEqual({ x: 0, y: 0 });
  });
});

describe('snapPointToEdge', () => {
  it('pulls a point onto a nearby edge', () => {
    // The edge is at x=20; start 3 px inside it.
    const snapped = snapPointToEdge(
      { x: 17, y: 0 },
      { x: 1, y: 0 },
      discSampler(20),
      { radius: 5 }
    );
    expect(snapped.x).toBeGreaterThan(18);
    expect(snapped.x).toBeLessThan(22);
  });

  it('leaves a point alone when nothing is in range', () => {
    const point = { x: 5, y: 5 };
    expect(snapPointToEdge(point, { x: 1, y: 0 }, flatSampler, { radius: 4 })).toEqual(point);
  });

  it('leaves a point alone when the gradient is below threshold', () => {
    // A 4-unit step is real but weaker than the default threshold.
    const weak: LuminanceSampler = (x) => (x < 10 ? 100 : 104);
    const point = { x: 8, y: 0 };
    expect(snapPointToEdge(point, { x: 1, y: 0 }, weak, { radius: 5 })).toEqual(point);
  });

  it('accepts a weak edge when the threshold is lowered', () => {
    const weak: LuminanceSampler = (x) => (x < 10 ? 100 : 104);
    const snapped = snapPointToEdge(
      { x: 8, y: 0 },
      { x: 1, y: 0 },
      weak,
      { radius: 5, minGradient: 0.5 }
    );
    expect(snapped.x).not.toBe(8);
  });

  it('does not move a point with a zero normal', () => {
    const point = { x: 17, y: 0 };
    expect(snapPointToEdge(point, { x: 0, y: 0 }, discSampler(20))).toEqual(point);
  });

  it('ignores samples outside the image', () => {
    const point = { x: 0, y: 0 };
    expect(snapPointToEdge(point, { x: 1, y: 0 }, boundedSampler(10), { radius: 20 })).toEqual(
      point
    );
  });

  it('never moves further than the search radius', () => {
    const snapped = snapPointToEdge(
      { x: 10, y: 0 },
      { x: 1, y: 0 },
      discSampler(20),
      { radius: 3 }
    );
    expect(Math.abs(snapped.x - 10)).toBeLessThanOrEqual(3);
  });
});

describe('snapContourToEdges', () => {
  it('tightens a contour drawn just inside the border onto it', () => {
    const drawn = circle(17, 48);
    const snapped = snapContourToEdges(drawn, discSampler(20), { radius: 5 });
    const radii = snapped.map((p) => Math.hypot(p.x, p.y));
    const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
    expect(mean).toBeGreaterThan(18.5);
    expect(mean).toBeLessThan(21.5);
  });

  it('leaves a contour untouched on a featureless frame', () => {
    const drawn = circle(17, 24);
    expect(snapContourToEdges(drawn, flatSampler)).toEqual(drawn);
  });

  it('passes a degenerate contour straight through', () => {
    const pair = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(snapContourToEdges(pair, discSampler(20))).toEqual(pair);
  });

  it('preserves the point count', () => {
    const drawn = circle(17, 40);
    expect(snapContourToEdges(drawn, discSampler(20))).toHaveLength(40);
  });
});

describe('snapCoverage', () => {
  it('reports the fraction of points that moved', () => {
    const before = circle(17, 40);
    const after = snapContourToEdges(before, discSampler(20), { radius: 5 });
    expect(snapCoverage(before, after)).toBeGreaterThan(0.8);
  });

  it('reports zero when nothing moved', () => {
    const before = circle(17, 24);
    expect(snapCoverage(before, before)).toBe(0);
  });

  it('reports zero for mismatched lengths', () => {
    expect(snapCoverage(circle(10, 8), circle(10, 12))).toBe(0);
  });
});
