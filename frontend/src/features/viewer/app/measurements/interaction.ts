import { clamp } from '../../domain/math';
import type { Point2D } from '../../types';

export type MeasurementEditState = {
  id: string;
  type: 'line' | 'polygon';
  mode: 'move' | 'handle';
  handleIndex?: number;
  startImagePoint: Point2D;
  originalPoints: Point2D[];
};

type ImageBounds = {
  rows: number;
  columns: number;
};

const clampPoint = (point: Point2D, bounds: ImageBounds): Point2D => ({
  x: clamp(point.x, 0, bounds.columns),
  y: clamp(point.y, 0, bounds.rows),
});

export const buildEditedPoints = (
  editState: MeasurementEditState,
  currentPoint: Point2D,
  imageDimensions: ImageBounds
): Point2D[] => {
  const dx = currentPoint.x - editState.startImagePoint.x;
  const dy = currentPoint.y - editState.startImagePoint.y;
  const hasHandle = editState.mode === 'handle' && editState.handleIndex !== undefined;

  const nextPoints = editState.originalPoints.map((point, index) => {
    if (hasHandle && index !== editState.handleIndex) {
      return point;
    }
    return { x: point.x + dx, y: point.y + dy };
  });

  return nextPoints.map((point) => clampPoint(point, imageDimensions));
};
