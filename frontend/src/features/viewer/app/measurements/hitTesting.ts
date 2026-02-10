import type { Point2D } from '../../types';
import type { LegacyLineMeasurement, LegacyPolygonMeasurement } from './legacyTypes';

export type HandleHit = {
  id: string;
  type: 'line' | 'polygon';
  handleIndex: number;
};

type HitTestParams = {
  imagePoint: Point2D;
  scale: number;
  screenTolerance?: number;
};

type MeasurementHitTestParams = HitTestParams & {
  measurements: LegacyLineMeasurement[];
  polygons: LegacyPolygonMeasurement[];
};

const distance = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y);

const distanceToSegment = (point: Point2D, start: Point2D, end: Point2D) => {
  const lineLengthSq = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (lineLengthSq === 0) return distance(point, start);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) /
        lineLengthSq
    )
  );
  const projX = start.x + t * (end.x - start.x);
  const projY = start.y + t * (end.y - start.y);
  return Math.hypot(point.x - projX, point.y - projY);
};

const isPointInPolygon = (point: Point2D, polygon: Point2D[]) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    if ((yi > point.y) !== (yj > point.y)) {
      const intersect = (xj - xi) * (point.y - yi) / (yj - yi) + xi;
      if (point.x < intersect) inside = !inside;
    }
  }
  return inside;
};

export const hitTestMeasurement = ({
  imagePoint,
  scale,
  screenTolerance = 8,
  measurements,
  polygons,
}: MeasurementHitTestParams): string | null => {
  const tolerance = screenTolerance / Math.max(scale, 0.0001);

  for (const measurement of measurements) {
    const dist = distanceToSegment(imagePoint, measurement.start, measurement.end);
    if (dist <= tolerance) return measurement.id;
  }

  for (const polygon of polygons) {
    const { points } = polygon;
    if (points.length < 3) continue;

    for (let i = 0; i < points.length; i += 1) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      if (distanceToSegment(imagePoint, p1, p2) <= tolerance) return polygon.id;
    }

    if (isPointInPolygon(imagePoint, points)) return polygon.id;
  }

  return null;
};

export const hitTestHandle = ({
  imagePoint,
  scale,
  screenTolerance = 10,
  measurements,
  polygons,
}: MeasurementHitTestParams): HandleHit | null => {
  const tolerance = screenTolerance / Math.max(scale, 0.0001);

  for (const measurement of measurements) {
    if (distance(imagePoint, measurement.start) <= tolerance) {
      return { id: measurement.id, type: 'line', handleIndex: 0 };
    }
    if (distance(imagePoint, measurement.end) <= tolerance) {
      return { id: measurement.id, type: 'line', handleIndex: 1 };
    }
  }

  for (const polygon of polygons) {
    for (let i = 0; i < polygon.points.length; i += 1) {
      if (distance(imagePoint, polygon.points[i]) <= tolerance) {
        return { id: polygon.id, type: 'polygon', handleIndex: i };
      }
    }
  }

  return null;
};
