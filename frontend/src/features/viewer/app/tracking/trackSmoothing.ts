import { lerp } from '../../domain/math';
import type { Point2D } from '../../types';

type TrackFramePoints = {
  frame_index: number;
  points: Point2D[];
  length_mm?: number | null;
  area_mm2?: number | null;
  valid?: boolean;
};

export type PolygonTrackFrame = {
  frame_index: number;
  points: Point2D[];
  area_mm2: number | null;
};

const sortTrackFrames = <T extends TrackFramePoints>(frames: T[]) =>
  [...frames].sort((a, b) => a.frame_index - b.frame_index);

const buildAveragedPoints = <T extends TrackFramePoints>(
  frames: T[],
  start: number,
  end: number,
  pointCount: number,
) => {
  const sampleCount = end - start + 1;
  return Array.from({ length: pointCount }, (_, pointIndex) => {
    let sumX = 0;
    let sumY = 0;
    for (let i = start; i <= end; i += 1) {
      const p = frames[i].points[pointIndex];
      sumX += p.x;
      sumY += p.y;
    }
    return { x: sumX / sampleCount, y: sumY / sampleCount };
  });
};

const smoothTrackFramesTemporal = <T extends TrackFramePoints>(
  frames: T[],
  window: number,
): T[] => {
  const safeWindow = Math.max(0, Math.floor(window));
  if (safeWindow <= 0 || frames.length <= 1) return frames;

  const sorted = sortTrackFrames(frames);
  const pointCount = sorted[0]?.points.length ?? 0;
  if (pointCount === 0) return sorted;

  const consistent = sorted.every((frame) => frame.points.length === pointCount);
  if (!consistent) return sorted;

  return sorted.map((frame, index) => {
    const start = Math.max(0, index - safeWindow);
    const end = Math.min(sorted.length - 1, index + safeWindow);
    const points = buildAveragedPoints(sorted, start, end, pointCount);

    return { ...frame, points } as T;
  });
};

const findNeighborFrames = <T extends TrackFramePoints>(sorted: T[], frameIndex: number) => {
  let prev: T | null = null;
  let next: T | null = null;
  for (const frame of sorted) {
    if (frame.frame_index < frameIndex) {
      prev = frame;
      continue;
    }
    if (frame.frame_index > frameIndex) {
      next = frame;
      break;
    }
  }
  return { prev, next };
};

const interpolateScalar = (prev: number | null | undefined, next: number | null | undefined, t: number) => {
  if (prev != null && next != null) return lerp(prev, next, t);
  return prev ?? next ?? null;
};

const buildInterpolatedFrame = <T extends TrackFramePoints>(
  prev: T,
  next: T,
  frameIndex: number,
  t: number,
): T => {
  const points = prev.points.map((point, index) => ({
    x: lerp(point.x, next.points[index].x, t),
    y: lerp(point.y, next.points[index].y, t),
  }));

  return {
    ...prev,
    frame_index: frameIndex,
    points,
    length_mm: interpolateScalar(prev.length_mm, next.length_mm, t),
    area_mm2: interpolateScalar(prev.area_mm2, next.area_mm2, t),
    valid: prev.valid ?? next.valid,
  } as T;
};

export const interpolateTrackFrame = <T extends TrackFramePoints>(
  frames: T[],
  frameIndex: number,
): T | null => {
  if (!frames.length) return null;
  const sorted = sortTrackFrames(frames);
  const exact = sorted.find((frame) => frame.frame_index === frameIndex);
  if (exact) return exact;

  const { prev, next } = findNeighborFrames(sorted, frameIndex);
  if (!prev && !next) return null;
  if (!prev) return next;
  if (!next) return prev;

  const delta = next.frame_index - prev.frame_index;
  if (delta <= 0) return prev;
  if (prev.points.length !== next.points.length) return prev;

  const t = (frameIndex - prev.frame_index) / delta;
  return buildInterpolatedFrame(prev, next, frameIndex, t);
};

export const smoothLineTracks = <TTrack extends { frames: TrackFramePoints[] }>(
  tracks: Record<string, TTrack>,
  window: number,
): Record<string, TTrack> => {
  if (window <= 0) return tracks;
  const smoothed: Record<string, TTrack> = {};
  for (const [id, track] of Object.entries(tracks)) {
    smoothed[id] = {
      ...track,
      frames: smoothTrackFramesTemporal(track.frames, window),
    };
  }
  return smoothed;
};

export const smoothPolygonTracks = <TTrack extends { frames: PolygonTrackFrame[] }>(
  tracks: Record<string, TTrack>,
  window: number,
): Record<string, TTrack> => {
  if (window <= 0) return tracks;
  const smoothed: Record<string, TTrack> = {};
  for (const [id, track] of Object.entries(tracks)) {
    smoothed[id] = {
      ...track,
      frames: smoothTrackFramesTemporal(track.frames, window),
    };
  }
  return smoothed;
};

export const buildPathFromPoints = (points: Point2D[], closed: boolean = true): string => {
  if (points.length === 0) return '';
  const commands = points.map((p, index) => `${index === 0 ? 'M' : 'L'} ${p.x} ${p.y}`);
  if (closed && points.length > 2) {
    commands.push('Z');
  }
  return commands.join(' ');
};

export const getTrailFrames = <T extends TrackFramePoints>(
  frames: T[],
  currentIndex: number,
  trailLength: number,
): Array<{ frame: T; distance: number }> => {
  if (trailLength <= 0) return [];
  return frames
    .map((frame) => ({
      frame,
      distance: Math.abs(frame.frame_index - currentIndex),
    }))
    .filter((entry) => entry.distance > 0 && entry.distance <= trailLength)
    .sort((a, b) => a.distance - b.distance);
};
