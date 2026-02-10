import type { Point2D } from '../types';

const TRACKING_POINT_LIMIT = 96;

export const resampleClosedPolygon = (points: Point2D[], targetCount: number) => {
  if (points.length < 3 || targetCount <= 0 || points.length === targetCount) {
    return points;
  }

  const closed = [...points, points[0]];
  const distances: number[] = [0];
  let total = 0;
  for (let i = 1; i < closed.length; i += 1) {
    const dx = closed[i].x - closed[i - 1].x;
    const dy = closed[i].y - closed[i - 1].y;
    const segment = Math.sqrt(dx * dx + dy * dy);
    total += segment;
    distances.push(total);
  }

  if (total === 0) return points;
  const step = total / targetCount;
  const resampled: Point2D[] = [];
  let segIndex = 1;

  for (let i = 0; i < targetCount; i += 1) {
    const targetDist = i * step;
    while (segIndex < distances.length - 1 && distances[segIndex] < targetDist) {
      segIndex += 1;
    }
    const prevDist = distances[segIndex - 1];
    const nextDist = distances[segIndex];
    const ratio = nextDist - prevDist === 0 ? 0 : (targetDist - prevDist) / (nextDist - prevDist);
    const p1 = closed[segIndex - 1];
    const p2 = closed[segIndex];
    resampled.push({
      x: p1.x + (p2.x - p1.x) * ratio,
      y: p1.y + (p2.y - p1.y) * ratio,
    });
  }

  return resampled;
};

export const normalizeTrackingPoints = (
  points: Point2D[],
  targetCount = TRACKING_POINT_LIMIT,
) => {
  if (points.length <= 2) return points;
  const capped = Math.max(3, Math.min(points.length, targetCount));
  if (points.length > capped) {
    return resampleClosedPolygon(points, capped);
  }
  return points;
};
