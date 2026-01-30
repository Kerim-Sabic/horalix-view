/**
 * Geometry Service Tests
 *
 * Unit tests for geometric calculations including:
 * - Distance calculations
 * - Area calculations (Shoelace formula)
 * - Volume calculations (trapezoidal rule)
 * - Hit-testing
 */

import { describe, it, expect } from 'vitest';
import {
  distancePixels,
  calculateDistanceMm,
  midpoint,
  centroid,
  calculatePolygonAreaMm2,
  calculatePolygonAreaPixels,
  calculateEllipseAreaMm2,
  calculateRectangleAreaMm2,
  calculatePerimeterMm,
  calculateSegmentLengths,
  calculateVolumeFromContours,
  distanceToLineSegment,
  isPointInPolygon,
  isPointInEllipse,
  hitTestMeasurements,
  getBoundingBox,
} from '../services/geometryService';
import type { LineMeasurement, PolygonMeasurement, PixelSpacing, Point2D } from '../types';

// ============================================================================
// Test Fixtures
// ============================================================================

const isotropicSpacing: PixelSpacing = { rowSpacing: 1, columnSpacing: 1 };
const anisotropicSpacing: PixelSpacing = { rowSpacing: 0.5, columnSpacing: 1 };

function createLineMeasurement(
  start: Point2D,
  end: Point2D,
  id: string = 'test-line'
): LineMeasurement {
  return {
    id,
    type: 'line',
    scope: 'series',
    points: [start, end],
    lengthMm: null,
    trackingData: null,
    label: null,
    color: '#3b82f6',
    visible: true,
    locked: false,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    seriesUid: 'test-series',
    frameKey: null,
  };
}

function createPolygonMeasurement(
  points: Point2D[],
  id: string = 'test-polygon'
): PolygonMeasurement {
  return {
    id,
    type: 'polygon',
    scope: 'series',
    points,
    perimeterMm: null,
    areaMm2: null,
    volumeData: null,
    trackingData: null,
    label: null,
    color: '#3b82f6',
    visible: true,
    locked: false,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    seriesUid: 'test-series',
    frameKey: null,
  };
}

// ============================================================================
// Distance Tests
// ============================================================================

describe('distancePixels', () => {
  it('calculates distance between two points', () => {
    expect(distancePixels({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('returns 0 for same point', () => {
    expect(distancePixels({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });

  it('handles negative coordinates', () => {
    expect(distancePixels({ x: -3, y: -4 }, { x: 0, y: 0 })).toBe(5);
  });
});

describe('calculateDistanceMm', () => {
  it('calculates distance with isotropic spacing', () => {
    const result = calculateDistanceMm(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      isotropicSpacing
    );
    expect(result).toBeCloseTo(100);
  });

  it('calculates diagonal distance correctly', () => {
    const result = calculateDistanceMm(
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      isotropicSpacing
    );
    expect(result).toBeCloseTo(5);
  });

  it('calculates distance with anisotropic spacing', () => {
    const result = calculateDistanceMm(
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      anisotropicSpacing
    );
    // dx = 100 * 1 = 100mm, dy = 100 * 0.5 = 50mm
    expect(result).toBeCloseTo(Math.sqrt(100 * 100 + 50 * 50));
  });

  it('returns null when spacing is null', () => {
    const result = calculateDistanceMm({ x: 0, y: 0 }, { x: 100, y: 100 }, null);
    expect(result).toBeNull();
  });
});

describe('midpoint', () => {
  it('calculates midpoint correctly', () => {
    const result = midpoint({ x: 0, y: 0 }, { x: 10, y: 10 });
    expect(result).toEqual({ x: 5, y: 5 });
  });

  it('handles negative coordinates', () => {
    const result = midpoint({ x: -10, y: -10 }, { x: 10, y: 10 });
    expect(result).toEqual({ x: 0, y: 0 });
  });
});

describe('centroid', () => {
  it('calculates centroid of triangle', () => {
    const result = centroid([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 0, y: 3 },
    ]);
    expect(result.x).toBeCloseTo(1);
    expect(result.y).toBeCloseTo(1);
  });

  it('returns origin for empty array', () => {
    expect(centroid([])).toEqual({ x: 0, y: 0 });
  });
});

// ============================================================================
// Area Tests
// ============================================================================

describe('calculatePolygonAreaMm2', () => {
  it('calculates area of a square', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const result = calculatePolygonAreaMm2(square, isotropicSpacing);
    expect(result).toBeCloseTo(10000); // 100mm x 100mm
  });

  it('calculates area of a triangle', () => {
    const triangle = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 100 },
    ];
    const result = calculatePolygonAreaMm2(triangle, isotropicSpacing);
    expect(result).toBeCloseTo(5000); // 0.5 * 100 * 100
  });

  it('calculates area with anisotropic spacing', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const result = calculatePolygonAreaMm2(square, anisotropicSpacing);
    // 100mm (x) * 50mm (y) = 5000mm²
    expect(result).toBeCloseTo(5000);
  });

  it('returns null for less than 3 points', () => {
    const result = calculatePolygonAreaMm2(
      [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      isotropicSpacing
    );
    expect(result).toBeNull();
  });

  it('returns null when spacing is null', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(calculatePolygonAreaMm2(square, null)).toBeNull();
  });

  it('handles clockwise and counter-clockwise winding', () => {
    const ccw = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const cw = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
    ];
    const resultCcw = calculatePolygonAreaMm2(ccw, isotropicSpacing);
    const resultCw = calculatePolygonAreaMm2(cw, isotropicSpacing);
    expect(resultCcw).toBeCloseTo(resultCw!);
  });
});

describe('calculatePolygonAreaPixels', () => {
  it('calculates area in pixels', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(calculatePolygonAreaPixels(square)).toBeCloseTo(100);
  });

  it('returns 0 for less than 3 points', () => {
    expect(calculatePolygonAreaPixels([{ x: 0, y: 0 }])).toBe(0);
  });
});

describe('calculateEllipseAreaMm2', () => {
  it('calculates area of a circle', () => {
    const result = calculateEllipseAreaMm2(10, 10, isotropicSpacing);
    expect(result).toBeCloseTo(Math.PI * 100); // π * r²
  });

  it('calculates area of an ellipse', () => {
    const result = calculateEllipseAreaMm2(10, 5, isotropicSpacing);
    expect(result).toBeCloseTo(Math.PI * 50); // π * a * b
  });

  it('returns null when spacing is null', () => {
    expect(calculateEllipseAreaMm2(10, 10, null)).toBeNull();
  });
});

describe('calculateRectangleAreaMm2', () => {
  it('calculates area correctly', () => {
    const result = calculateRectangleAreaMm2(100, 50, isotropicSpacing);
    expect(result).toBeCloseTo(5000);
  });

  it('returns null when spacing is null', () => {
    expect(calculateRectangleAreaMm2(100, 50, null)).toBeNull();
  });
});

// ============================================================================
// Perimeter Tests
// ============================================================================

describe('calculatePerimeterMm', () => {
  it('calculates perimeter of closed square', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const result = calculatePerimeterMm(square, isotropicSpacing, true);
    expect(result).toBeCloseTo(400);
  });

  it('calculates length of open polyline', () => {
    const polyline = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const result = calculatePerimeterMm(polyline, isotropicSpacing, false);
    expect(result).toBeCloseTo(200);
  });

  it('returns null when spacing is null', () => {
    expect(calculatePerimeterMm([{ x: 0, y: 0 }, { x: 100, y: 0 }], null, false)).toBeNull();
  });
});

describe('calculateSegmentLengths', () => {
  it('calculates individual segment lengths', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const result = calculateSegmentLengths(points, isotropicSpacing);
    expect(result).toHaveLength(2);
    expect(result[0]).toBeCloseTo(100);
    expect(result[1]).toBeCloseTo(100);
  });

  it('returns empty array for less than 2 points', () => {
    expect(calculateSegmentLengths([{ x: 0, y: 0 }], isotropicSpacing)).toHaveLength(0);
  });
});

// ============================================================================
// Volume Tests
// ============================================================================

describe('calculateVolumeFromContours', () => {
  it('calculates volume from stacked squares', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const contours = new Map<number, Point2D[]>([
      [0, square],
      [1, square],
      [2, square],
    ]);

    const result = calculateVolumeFromContours(contours, isotropicSpacing, 2);
    // 3 slices of 100mm² each, 2mm thick
    // Volume = (100 + 100) / 2 * 2 + (100 + 100) / 2 * 2 = 400mm³
    expect(result).toBeCloseTo(400);
  });

  it('handles varying contour sizes', () => {
    const smallSquare = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ];
    const largeSquare = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const contours = new Map<number, Point2D[]>([
      [0, smallSquare], // 25mm²
      [1, largeSquare], // 100mm²
    ]);

    const result = calculateVolumeFromContours(contours, isotropicSpacing, 1);
    // Trapezoidal: (25 + 100) / 2 * 1 = 62.5mm³
    expect(result).toBeCloseTo(62.5);
  });

  it('returns null for single slice', () => {
    const contours = new Map<number, Point2D[]>([
      [0, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]],
    ]);
    expect(calculateVolumeFromContours(contours, isotropicSpacing, 1)).toBeNull();
  });
});

// ============================================================================
// Line Segment Distance Tests
// ============================================================================

describe('distanceToLineSegment', () => {
  it('returns distance to endpoint when closest', () => {
    const dist = distanceToLineSegment(
      { x: -10, y: 0 },
      { x: 0, y: 0 },
      { x: 100, y: 0 }
    );
    expect(dist).toBeCloseTo(10);
  });

  it('returns perpendicular distance when closest to middle', () => {
    const dist = distanceToLineSegment(
      { x: 50, y: 10 },
      { x: 0, y: 0 },
      { x: 100, y: 0 }
    );
    expect(dist).toBeCloseTo(10);
  });

  it('handles zero-length segment', () => {
    const dist = distanceToLineSegment(
      { x: 10, y: 10 },
      { x: 0, y: 0 },
      { x: 0, y: 0 }
    );
    expect(dist).toBeCloseTo(Math.sqrt(200));
  });
});

// ============================================================================
// Point in Polygon Tests
// ============================================================================

describe('isPointInPolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it('returns true for point inside', () => {
    expect(isPointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
  });

  it('returns false for point outside', () => {
    expect(isPointInPolygon({ x: 150, y: 50 }, square)).toBe(false);
  });

  it('returns false for empty polygon', () => {
    expect(isPointInPolygon({ x: 50, y: 50 }, [])).toBe(false);
  });

  it('handles concave polygon', () => {
    // Arrow-shaped polygon with concave notch at top
    const concave = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 50, y: 50 }, // Concave vertex pointing inward
      { x: 0, y: 100 },
    ];
    // Point clearly inside the polygon body
    expect(isPointInPolygon({ x: 25, y: 25 }, concave)).toBe(true);
    // Point in the triangular notch area (outside polygon)
    expect(isPointInPolygon({ x: 50, y: 80 }, concave)).toBe(false);
  });
});

// ============================================================================
// Point in Ellipse Tests
// ============================================================================

describe('isPointInEllipse', () => {
  it('returns true for point inside circle', () => {
    expect(isPointInEllipse({ x: 50, y: 50 }, { x: 50, y: 50 }, 10, 10)).toBe(true);
    expect(isPointInEllipse({ x: 55, y: 50 }, { x: 50, y: 50 }, 10, 10)).toBe(true);
  });

  it('returns false for point outside circle', () => {
    expect(isPointInEllipse({ x: 70, y: 50 }, { x: 50, y: 50 }, 10, 10)).toBe(false);
  });

  it('handles ellipse shape', () => {
    // Ellipse with radiusX=20, radiusY=10
    expect(isPointInEllipse({ x: 65, y: 50 }, { x: 50, y: 50 }, 20, 10)).toBe(true);
    expect(isPointInEllipse({ x: 50, y: 65 }, { x: 50, y: 50 }, 20, 10)).toBe(false);
  });
});

// ============================================================================
// Hit Testing Tests
// ============================================================================

describe('hitTestMeasurements', () => {
  it('detects hit on line endpoint', () => {
    const measurement = createLineMeasurement({ x: 0, y: 0 }, { x: 100, y: 100 });
    const result = hitTestMeasurements({ x: 2, y: 2 }, [measurement], 8);

    expect(result).not.toBeNull();
    expect(result?.measurementId).toBe('test-line');
    expect(result?.pointIndex).toBe(0);
  });

  it('detects hit on line second endpoint', () => {
    const measurement = createLineMeasurement({ x: 0, y: 0 }, { x: 100, y: 100 });
    const result = hitTestMeasurements({ x: 98, y: 98 }, [measurement], 8);

    expect(result).not.toBeNull();
    expect(result?.measurementId).toBe('test-line');
    expect(result?.pointIndex).toBe(1);
  });

  it('detects hit on line segment', () => {
    const measurement = createLineMeasurement({ x: 0, y: 0 }, { x: 100, y: 0 });
    const result = hitTestMeasurements({ x: 50, y: 2 }, [measurement], 8);

    expect(result).not.toBeNull();
    expect(result?.measurementId).toBe('test-line');
    expect(result?.pointIndex).toBeNull(); // Hit on segment, not endpoint
  });

  it('returns null when clicking far from measurement', () => {
    const measurement = createLineMeasurement({ x: 0, y: 0 }, { x: 100, y: 0 });
    const result = hitTestMeasurements({ x: 50, y: 50 }, [measurement], 8);

    expect(result).toBeNull();
  });

  it('ignores hidden measurements', () => {
    const measurement = createLineMeasurement({ x: 0, y: 0 }, { x: 100, y: 0 });
    measurement.visible = false;
    const result = hitTestMeasurements({ x: 50, y: 0 }, [measurement], 8);

    expect(result).toBeNull();
  });

  it('ignores locked measurements', () => {
    const measurement = createLineMeasurement({ x: 0, y: 0 }, { x: 100, y: 0 });
    measurement.locked = true;
    const result = hitTestMeasurements({ x: 50, y: 0 }, [measurement], 8);

    expect(result).toBeNull();
  });

  it('prioritizes control point hits over segment hits', () => {
    const measurement = createLineMeasurement({ x: 0, y: 0 }, { x: 100, y: 0 });
    // Point closer to segment but within tolerance of endpoint
    const result = hitTestMeasurements({ x: 5, y: 3 }, [measurement], 10);

    expect(result).not.toBeNull();
    expect(result?.pointIndex).toBe(0); // Should prefer endpoint
  });

  it('detects hit inside polygon', () => {
    const polygon = createPolygonMeasurement([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    const result = hitTestMeasurements({ x: 50, y: 50 }, [polygon], 8);

    expect(result).not.toBeNull();
    expect(result?.measurementId).toBe('test-polygon');
  });

  it('finds closest measurement when multiple overlap', () => {
    const line1 = createLineMeasurement({ x: 0, y: 0 }, { x: 100, y: 0 }, 'line-1');
    const line2 = createLineMeasurement({ x: 0, y: 5 }, { x: 100, y: 5 }, 'line-2');

    // Click at y=2, closer to line1
    const result = hitTestMeasurements({ x: 50, y: 2 }, [line1, line2], 8);

    expect(result).not.toBeNull();
    expect(result?.measurementId).toBe('line-1');
  });
});

// ============================================================================
// Bounding Box Tests
// ============================================================================

describe('getBoundingBox', () => {
  it('calculates bounding box correctly', () => {
    const points = [
      { x: 10, y: 20 },
      { x: 50, y: 5 },
      { x: 30, y: 80 },
    ];
    const result = getBoundingBox(points);

    expect(result.minX).toBe(10);
    expect(result.minY).toBe(5);
    expect(result.maxX).toBe(50);
    expect(result.maxY).toBe(80);
  });

  it('handles empty array', () => {
    const result = getBoundingBox([]);
    expect(result).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it('handles single point', () => {
    const result = getBoundingBox([{ x: 25, y: 35 }]);
    expect(result.minX).toBe(25);
    expect(result.maxX).toBe(25);
    expect(result.minY).toBe(35);
    expect(result.maxY).toBe(35);
  });
});
