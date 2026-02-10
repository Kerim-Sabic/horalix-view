import type { Point2D } from '../../types';
import type { HandleHit } from './hitTesting';
import type { MeasurementEditState } from './interaction';
import type { LegacyLineMeasurement, LegacyPolygonMeasurement } from './legacyTypes';

const findLineById = (measurements: LegacyLineMeasurement[], id: string) =>
  measurements.find((measurement) => measurement.id === id);

const findPolygonById = (polygons: LegacyPolygonMeasurement[], id: string) =>
  polygons.find((polygon) => polygon.id === id);

export const buildHandleEditState = (
  hit: HandleHit,
  startImagePoint: Point2D,
  measurements: LegacyLineMeasurement[],
  polygons: LegacyPolygonMeasurement[]
): MeasurementEditState | null => {
  if (hit.type === 'line') {
    const line = findLineById(measurements, hit.id);
    if (!line) return null;
    return {
      id: hit.id,
      type: 'line',
      mode: 'handle',
      handleIndex: hit.handleIndex,
      startImagePoint,
      originalPoints: [line.start, line.end],
    };
  }

  const polygon = findPolygonById(polygons, hit.id);
  if (!polygon) return null;
  return {
    id: hit.id,
    type: 'polygon',
    mode: 'handle',
    handleIndex: hit.handleIndex,
    startImagePoint,
    originalPoints: [...polygon.points],
  };
};

export const buildBodyEditState = (
  measurementId: string,
  startImagePoint: Point2D,
  measurements: LegacyLineMeasurement[],
  polygons: LegacyPolygonMeasurement[]
): MeasurementEditState | null => {
  const line = findLineById(measurements, measurementId);
  if (line) {
    return {
      id: measurementId,
      type: 'line',
      mode: 'move',
      startImagePoint,
      originalPoints: [line.start, line.end],
    };
  }

  const polygon = findPolygonById(polygons, measurementId);
  if (!polygon) return null;
  return {
    id: measurementId,
    type: 'polygon',
    mode: 'move',
    startImagePoint,
    originalPoints: [...polygon.points],
  };
};
