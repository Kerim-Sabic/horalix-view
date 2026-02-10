import { clamp } from '../../domain/math';
import type { Point2D } from '../../types';
import type { LegacyLineMeasurement } from './legacyTypes';

export type MeasureDragState = {
  measureStart: Point2D;
  measureId: string;
  measureFrameKey?: string;
  measureSeriesKey?: string;
  measureInstanceUid?: string;
  measureScope: 'frame' | 'cine';
};

type DragStartParams = {
  point: Point2D;
  imageDimensions: { rows: number; columns: number };
  frameKey?: string | null;
  seriesKey?: string | null;
  instanceUid?: string | null;
  scope: 'frame' | 'cine';
  id: string;
};

type DragUpdateParams = {
  dragState: MeasureDragState;
  currentPoint: Point2D;
  imageDimensions: { rows: number; columns: number };
  pixelSpacing: [number, number];
};

const clampPoint = (point: Point2D, dimensions: { rows: number; columns: number }) => ({
  x: clamp(point.x, 0, dimensions.columns),
  y: clamp(point.y, 0, dimensions.rows),
});

export const createMeasureDragStart = ({
  point,
  imageDimensions,
  frameKey,
  seriesKey,
  instanceUid,
  scope,
  id,
}: DragStartParams): { dragState: MeasureDragState; measurement: LegacyLineMeasurement } => {
  const start = clampPoint(point, imageDimensions);
  return {
    dragState: {
      measureStart: start,
      measureId: id,
      measureFrameKey: frameKey ?? undefined,
      measureSeriesKey: seriesKey ?? undefined,
      measureInstanceUid: instanceUid ?? undefined,
      measureScope: scope,
    },
    measurement: {
      id,
      start,
      end: start,
      lengthMm: 0,
      instanceUid: instanceUid ?? null,
    },
  };
};

export const updateMeasureDrag = ({
  dragState,
  currentPoint,
  imageDimensions,
  pixelSpacing,
}: DragUpdateParams): LegacyLineMeasurement => {
  const end = clampPoint(currentPoint, imageDimensions);
  const dxMm = (end.x - dragState.measureStart.x) * pixelSpacing[1];
  const dyMm = (end.y - dragState.measureStart.y) * pixelSpacing[0];
  const lengthMm = Math.sqrt(dxMm * dxMm + dyMm * dyMm);

  return {
    id: dragState.measureId,
    start: dragState.measureStart,
    end,
    lengthMm,
    instanceUid: dragState.measureInstanceUid ?? null,
  };
};
