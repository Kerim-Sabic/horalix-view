/**
 * Geometry Service
 *
 * Provides geometric calculations for measurements including:
 * - Distance calculations in mm
 * - Area calculations using Shoelace formula
 * - Perimeter calculations
 * - Volume calculations from stacked contours
 * - Hit-testing for selection
 */

import type {
  Point2D,
  PixelSpacing,
  Measurement,
  LineMeasurement,
  PolygonMeasurement,
  PolylineMeasurement,
  FreehandMeasurement,
  EllipseMeasurement,
  RectangleMeasurement,
  HitTestResult,
} from '../types';

// ============================================================================
// Basic Geometry
// ============================================================================

/**
 * Calculate Euclidean distance between two points in pixels
 */
export function distancePixels(p1: Point2D, p2: Point2D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate Euclidean distance between two points in mm
 * Returns null if pixel spacing is not available
 */
export function calculateDistanceMm(
  p1: Point2D,
  p2: Point2D,
  pixelSpacing: PixelSpacing | null
): number | null {
  if (!pixelSpacing) return null;

  const dxPixels = p2.x - p1.x;
  const dyPixels = p2.y - p1.y;
  const dxMm = dxPixels * pixelSpacing.columnSpacing;
  const dyMm = dyPixels * pixelSpacing.rowSpacing;

  return Math.sqrt(dxMm * dxMm + dyMm * dyMm);
}

/**
 * Calculate the midpoint between two points
 */
export function midpoint(p1: Point2D, p2: Point2D): Point2D {
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
  };
}

/**
 * Calculate the centroid of a polygon
 */
export function centroid(points: Point2D[]): Point2D {
  if (points.length === 0) return { x: 0, y: 0 };

  const sum = points.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
    { x: 0, y: 0 }
  );

  return {
    x: sum.x / points.length,
    y: sum.y / points.length,
  };
}

// ============================================================================
// Area Calculations
// ============================================================================

/**
 * Calculate polygon area using Shoelace formula
 * Works for any simple (non-self-intersecting) polygon
 * Returns area in mm² if pixel spacing available, null otherwise
 */
export function calculatePolygonAreaMm2(
  points: Point2D[],
  pixelSpacing: PixelSpacing | null
): number | null {
  if (!pixelSpacing || points.length < 3) return null;

  // Convert to mm coordinates
  const mmPoints = points.map((p) => ({
    x: p.x * pixelSpacing.columnSpacing,
    y: p.y * pixelSpacing.rowSpacing,
  }));

  // Shoelace formula
  let area = 0;
  const n = mmPoints.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += mmPoints[i].x * mmPoints[j].y;
    area -= mmPoints[j].x * mmPoints[i].y;
  }

  return Math.abs(area) / 2;
}

/**
 * Calculate polygon area in pixels (for display when spacing unavailable)
 */
export function calculatePolygonAreaPixels(points: Point2D[]): number {
  if (points.length < 3) return 0;

  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }

  return Math.abs(area) / 2;
}

/**
 * Calculate ellipse area in mm²
 */
export function calculateEllipseAreaMm2(
  radiusXPixels: number,
  radiusYPixels: number,
  pixelSpacing: PixelSpacing | null
): number | null {
  if (!pixelSpacing) return null;

  const radiusXMm = radiusXPixels * pixelSpacing.columnSpacing;
  const radiusYMm = radiusYPixels * pixelSpacing.rowSpacing;

  return Math.PI * radiusXMm * radiusYMm;
}

/**
 * Calculate rectangle area in mm²
 */
export function calculateRectangleAreaMm2(
  widthPixels: number,
  heightPixels: number,
  pixelSpacing: PixelSpacing | null
): number | null {
  if (!pixelSpacing) return null;

  const widthMm = widthPixels * pixelSpacing.columnSpacing;
  const heightMm = heightPixels * pixelSpacing.rowSpacing;

  return widthMm * heightMm;
}

// ============================================================================
// Perimeter Calculations
// ============================================================================

/**
 * Calculate polygon/polyline perimeter in mm
 * @param closed - If true, includes distance from last point to first
 */
export function calculatePerimeterMm(
  points: Point2D[],
  pixelSpacing: PixelSpacing | null,
  closed: boolean
): number | null {
  if (!pixelSpacing || points.length < 2) return null;

  let perimeter = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dist = calculateDistanceMm(points[i], points[i + 1], pixelSpacing);
    if (dist === null) return null;
    perimeter += dist;
  }

  if (closed && points.length > 2) {
    const closingDist = calculateDistanceMm(
      points[points.length - 1],
      points[0],
      pixelSpacing
    );
    if (closingDist !== null) {
      perimeter += closingDist;
    }
  }

  return perimeter;
}

/**
 * Calculate individual segment lengths for polyline
 */
export function calculateSegmentLengths(
  points: Point2D[],
  pixelSpacing: PixelSpacing | null
): (number | null)[] {
  if (points.length < 2) return [];

  const lengths: (number | null)[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    lengths.push(calculateDistanceMm(points[i], points[i + 1], pixelSpacing));
  }

  return lengths;
}

// ============================================================================
// Volume Calculations
// ============================================================================

/**
 * Calculate volume from stacked contours using trapezoidal rule
 * Assumes contours are parallel planes with uniform spacing
 */
export function calculateVolumeFromContours(
  contours: Map<number, Point2D[]>,
  pixelSpacing: PixelSpacing,
  sliceThicknessMm: number
): number | null {
  if (contours.size < 2) return null;

  const sliceIndices = Array.from(contours.keys()).sort((a, b) => a - b);
  let volume = 0;

  for (let i = 0; i < sliceIndices.length - 1; i++) {
    const slice1 = sliceIndices[i];
    const slice2 = sliceIndices[i + 1];

    const contour1 = contours.get(slice1);
    const contour2 = contours.get(slice2);

    if (!contour1 || !contour2) continue;

    const area1 = calculatePolygonAreaMm2(contour1, pixelSpacing);
    const area2 = calculatePolygonAreaMm2(contour2, pixelSpacing);

    if (area1 === null || area2 === null) continue;

    // Trapezoidal rule: V = (A1 + A2) / 2 * h
    const sliceDistance = (slice2 - slice1) * sliceThicknessMm;
    volume += ((area1 + area2) / 2) * sliceDistance;
  }

  return volume;
}

/**
 * Calculate volume using Simpson's rule (more accurate for curved surfaces)
 */
export function calculateVolumeSimpsons(
  contours: Map<number, Point2D[]>,
  pixelSpacing: PixelSpacing,
  sliceThicknessMm: number
): number | null {
  if (contours.size < 3) {
    // Simpson's needs at least 3 slices, fall back to trapezoidal
    return calculateVolumeFromContours(contours, pixelSpacing, sliceThicknessMm);
  }

  const sliceIndices = Array.from(contours.keys()).sort((a, b) => a - b);
  const areas: number[] = [];

  for (const idx of sliceIndices) {
    const contour = contours.get(idx);
    if (!contour) continue;
    const area = calculatePolygonAreaMm2(contour, pixelSpacing);
    if (area === null) return null;
    areas.push(area);
  }

  // Simpson's rule: V = h/3 * (A0 + 4*A1 + 2*A2 + 4*A3 + ... + An)
  const h = sliceThicknessMm;
  let volume = areas[0] + areas[areas.length - 1];

  for (let i = 1; i < areas.length - 1; i++) {
    const multiplier = i % 2 === 1 ? 4 : 2;
    volume += multiplier * areas[i];
  }

  return (volume * h) / 3;
}

// ============================================================================
// Hit Testing
// ============================================================================

/**
 * Distance from a point to a line segment
 */
export function distanceToLineSegment(
  point: Point2D,
  lineStart: Point2D,
  lineEnd: Point2D
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    // Line segment is a point
    return distancePixels(point, lineStart);
  }

  // Project point onto line, clamped to segment
  let t =
    ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) /
    lengthSquared;
  t = Math.max(0, Math.min(1, t));

  const projection = {
    x: lineStart.x + t * dx,
    y: lineStart.y + t * dy,
  };

  return distancePixels(point, projection);
}

/**
 * Check if a point is inside a polygon (ray casting algorithm)
 */
export function isPointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Check if a point is inside an ellipse
 */
export function isPointInEllipse(
  point: Point2D,
  center: Point2D,
  radiusX: number,
  radiusY: number,
  rotationDegrees: number = 0
): boolean {
  // Translate point to ellipse center
  let dx = point.x - center.x;
  let dy = point.y - center.y;

  // Rotate point by negative rotation to align with ellipse axes
  if (rotationDegrees !== 0) {
    const rad = (-rotationDegrees * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rotX = dx * cos - dy * sin;
    const rotY = dx * sin + dy * cos;
    dx = rotX;
    dy = rotY;
  }

  // Check ellipse equation: (x/a)² + (y/b)² <= 1
  return (dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY) <= 1;
}

/**
 * Hit test a line measurement
 */
function hitTestLine(
  point: Point2D,
  measurement: LineMeasurement,
  tolerance: number
): HitTestResult | null {
  const [p1, p2] = measurement.points;

  // Check endpoints first (higher priority)
  const d1 = distancePixels(point, p1);
  if (d1 <= tolerance) {
    return { measurementId: measurement.id, pointIndex: 0, distance: d1 };
  }

  const d2 = distancePixels(point, p2);
  if (d2 <= tolerance) {
    return { measurementId: measurement.id, pointIndex: 1, distance: d2 };
  }

  // Check distance to line segment
  const lineDistance = distanceToLineSegment(point, p1, p2);
  if (lineDistance <= tolerance) {
    return {
      measurementId: measurement.id,
      pointIndex: null,
      distance: lineDistance,
    };
  }

  return null;
}

/**
 * Hit test a polygon/polyline measurement
 */
function hitTestPolygon(
  point: Point2D,
  measurement: PolygonMeasurement | PolylineMeasurement | FreehandMeasurement,
  tolerance: number
): HitTestResult | null {
  const { points } = measurement;
  if (points.length === 0) return null;

  // Check vertices first
  for (let i = 0; i < points.length; i++) {
    const dist = distancePixels(point, points[i]);
    if (dist <= tolerance) {
      return { measurementId: measurement.id, pointIndex: i, distance: dist };
    }
  }

  // Check edges
  const isClosed = measurement.type === 'polygon' ||
    (measurement.type === 'freehand' && (measurement as FreehandMeasurement).closed);
  const edgeCount = isClosed ? points.length : points.length - 1;

  let minDistance = Infinity;
  for (let i = 0; i < edgeCount; i++) {
    const j = (i + 1) % points.length;
    const dist = distanceToLineSegment(point, points[i], points[j]);
    if (dist < minDistance) minDistance = dist;
  }

  if (minDistance <= tolerance) {
    return {
      measurementId: measurement.id,
      pointIndex: null,
      distance: minDistance,
    };
  }

  // For closed shapes, also check if point is inside
  if (isClosed && isPointInPolygon(point, points)) {
    return {
      measurementId: measurement.id,
      pointIndex: null,
      distance: 0,
    };
  }

  return null;
}

/**
 * Hit test an ellipse measurement
 */
function hitTestEllipse(
  point: Point2D,
  measurement: EllipseMeasurement,
  tolerance: number
): HitTestResult | null {
  const { center, radiusX, radiusY, rotation } = measurement;

  // Check if point is on or inside ellipse
  if (isPointInEllipse(point, center, radiusX + tolerance, radiusY + tolerance, rotation)) {
    // Approximate distance to edge
    const dist = Math.abs(
      Math.sqrt(
        Math.pow((point.x - center.x) / radiusX, 2) +
        Math.pow((point.y - center.y) / radiusY, 2)
      ) - 1
    ) * Math.min(radiusX, radiusY);

    return {
      measurementId: measurement.id,
      pointIndex: null,
      distance: dist,
    };
  }

  return null;
}

/**
 * Hit test a rectangle measurement
 */
function hitTestRectangle(
  point: Point2D,
  measurement: RectangleMeasurement,
  tolerance: number
): HitTestResult | null {
  const { topLeft, bottomRight } = measurement;

  // Check corners first
  const corners: Point2D[] = [
    topLeft,
    { x: bottomRight.x, y: topLeft.y },
    bottomRight,
    { x: topLeft.x, y: bottomRight.y },
  ];

  for (let i = 0; i < corners.length; i++) {
    const dist = distancePixels(point, corners[i]);
    if (dist <= tolerance) {
      return { measurementId: measurement.id, pointIndex: i, distance: dist };
    }
  }

  // Check edges
  const edges: [Point2D, Point2D][] = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ];

  let minDistance = Infinity;
  for (const [p1, p2] of edges) {
    const dist = distanceToLineSegment(point, p1, p2);
    if (dist < minDistance) minDistance = dist;
  }

  if (minDistance <= tolerance) {
    return {
      measurementId: measurement.id,
      pointIndex: null,
      distance: minDistance,
    };
  }

  // Check if inside rectangle
  if (
    point.x >= topLeft.x &&
    point.x <= bottomRight.x &&
    point.y >= topLeft.y &&
    point.y <= bottomRight.y
  ) {
    return {
      measurementId: measurement.id,
      pointIndex: null,
      distance: 0,
    };
  }

  return null;
}

/**
 * Hit test a single measurement
 */
function hitTestSingleMeasurement(
  point: Point2D,
  measurement: Measurement,
  tolerance: number
): HitTestResult | null {
  switch (measurement.type) {
    case 'line':
      return hitTestLine(point, measurement, tolerance);
    case 'polygon':
    case 'polyline':
    case 'freehand':
      return hitTestPolygon(point, measurement, tolerance);
    case 'ellipse':
      return hitTestEllipse(point, measurement, tolerance);
    case 'rectangle':
      return hitTestRectangle(point, measurement, tolerance);
    default:
      return null;
  }
}

/**
 * Hit test against all visible measurements
 * Returns the closest hit, prioritizing control points over edges/bodies
 *
 * @param point - Point in image coordinates
 * @param measurements - Array of measurements to test
 * @param tolerance - Hit tolerance in pixels (default 8)
 */
export function hitTestMeasurements(
  point: Point2D,
  measurements: Measurement[],
  tolerance: number = 8
): HitTestResult | null {
  let bestHit: HitTestResult | null = null;
  let bestDistance = Infinity;
  let hasPointHit = false;

  for (const measurement of measurements) {
    // Skip hidden or locked measurements
    if (!measurement.visible || measurement.locked) continue;

    const result = hitTestSingleMeasurement(point, measurement, tolerance);
    if (!result) continue;

    // Prioritize control point hits
    const isPointHit = result.pointIndex !== null;

    if (isPointHit && !hasPointHit) {
      // First point hit takes priority
      bestHit = result;
      bestDistance = result.distance;
      hasPointHit = true;
    } else if (isPointHit === hasPointHit && result.distance < bestDistance) {
      // Same priority level, take closer hit
      bestHit = result;
      bestDistance = result.distance;
    }
  }

  return bestHit;
}

// ============================================================================
// Bounding Box
// ============================================================================

/**
 * Bounding box type
 */
export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Calculate bounding box for a set of points
 */
export function getBoundingBox(points: Point2D[]): BoundingBox {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Get bounding box for a measurement
 */
export function getMeasurementBoundingBox(measurement: Measurement): BoundingBox {
  switch (measurement.type) {
    case 'line':
      return getBoundingBox(measurement.points);
    case 'polygon':
    case 'polyline':
    case 'freehand':
      return getBoundingBox(measurement.points);
    case 'ellipse': {
      const { center, radiusX, radiusY } = measurement;
      return {
        minX: center.x - radiusX,
        minY: center.y - radiusY,
        maxX: center.x + radiusX,
        maxY: center.y + radiusY,
      };
    }
    case 'rectangle':
      return {
        minX: measurement.topLeft.x,
        minY: measurement.topLeft.y,
        maxX: measurement.bottomRight.x,
        maxY: measurement.bottomRight.y,
      };
    default:
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
}
