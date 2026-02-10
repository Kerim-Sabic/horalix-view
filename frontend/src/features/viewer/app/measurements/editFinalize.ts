import { calculatePerimeterMm, calculatePolygonAreaMm2 } from '../../services/geometryService';
import type { Point2D } from '../../types';
import type { MeasurementEditState } from './interaction';
import type { LegacyLineMeasurement, LegacyPolygonMeasurement } from './legacyTypes';

type PixelSpacing = {
  rowSpacing: number;
  columnSpacing: number;
};

type LineSpacing = [number, number];

type MeasurementUpdate = {
  points: Point2D[];
  lengthMm?: number | null;
  areaMm2?: number | null;
  perimeterMm?: number | null;
};

export const computeEditMovement = (
  editState: MeasurementEditState,
  currentPoint: Point2D | null
) => {
  const dx = currentPoint ? currentPoint.x - editState.startImagePoint.x : 0;
  const dy = currentPoint ? currentPoint.y - editState.startImagePoint.y : 0;
  const hasMovement = Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01;
  return { dx, dy, hasMovement };
};

export const getEditCleanupState = () => ({
  editingMeasurement: null as MeasurementEditState | null,
  isDragging: false,
});

const computeLineLengthMm = (start: Point2D, end: Point2D, spacing: LineSpacing) => {
  const dxMm = (end.x - start.x) * spacing[1];
  const dyMm = (end.y - start.y) * spacing[0];
  return Math.sqrt(dxMm * dxMm + dyMm * dyMm);
};

export const recomputeLegacyLineLengths = (
  maps: Record<string, LegacyLineMeasurement[]>,
  editState: MeasurementEditState,
  spacing: LineSpacing
) => {
  if (editState.type !== 'line') return maps;
  const updated: Record<string, LegacyLineMeasurement[]> = {};
  for (const [key, list] of Object.entries(maps)) {
    updated[key] = list.map((measurement) => {
      if (measurement.id !== editState.id) return measurement;
      const lengthMm = computeLineLengthMm(measurement.start, measurement.end, spacing);
      return { ...measurement, lengthMm };
    });
  }
  return updated;
};

export const recomputeLegacyPolygonMetrics = (
  maps: Record<string, LegacyPolygonMeasurement[]>,
  editState: MeasurementEditState,
  pixelSpacing: PixelSpacing
) => {
  if (editState.type !== 'polygon') return maps;
  const updated: Record<string, LegacyPolygonMeasurement[]> = {};
  for (const [key, list] of Object.entries(maps)) {
    updated[key] = list.map((polygon) => {
      if (polygon.id !== editState.id) return polygon;
      const areaMm2 = calculatePolygonAreaMm2(polygon.points, pixelSpacing);
      const perimeterMm = calculatePerimeterMm(polygon.points, pixelSpacing, true);
      return { ...polygon, areaMm2, perimeterMm };
    });
  }
  return updated;
};

export const buildEditedStoreUpdate = (
  editState: MeasurementEditState,
  newPoints: Point2D[],
  spacing: LineSpacing,
  pixelSpacing: PixelSpacing
): MeasurementUpdate | null => {
  if (editState.type === 'line') {
    const lengthMm = computeLineLengthMm(newPoints[0], newPoints[1], spacing);
    return { points: [newPoints[0], newPoints[1]], lengthMm };
  }
  if (editState.type === 'polygon') {
    const areaMm2 = calculatePolygonAreaMm2(newPoints, pixelSpacing);
    const perimeterMm = calculatePerimeterMm(newPoints, pixelSpacing, true);
    return { points: newPoints, areaMm2, perimeterMm };
  }
  return null;
};
