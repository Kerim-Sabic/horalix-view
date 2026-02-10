import type { TrackingData } from '../../types';
import type { Measurement as StoreMeasurement } from '../../types';
import type { Point2D } from '../../types';

type LineTrackFrame = {
  frame_index: number;
  points: Point2D[];
  length_mm?: number | null;
  area_mm2?: number | null;
  valid?: boolean;
};

type LineTrackSummary = {
  min_mm: number | null;
  max_mm: number | null;
  mean_mm: number | null;
  min_area_mm2?: number | null;
  max_area_mm2?: number | null;
  mean_area_mm2?: number | null;
};

export type LineTrackResponse = {
  series_uid: string;
  instance_uid?: string | null;
  total_frames: number;
  frames: LineTrackFrame[];
  summary: LineTrackSummary;
};

export type PolygonTrackResponse = {
  frames: Array<{
    frame_index: number;
    points: Point2D[];
    area_mm2: number | null;
  }>;
};

export type TrackingMaps = {
  lineTracks: Record<string, LineTrackResponse>;
  polygonTracks: Record<string, PolygonTrackResponse>;
};

const toLineTrack = (tracking: TrackingData): LineTrackResponse => ({
  series_uid: tracking.seriesUid,
  instance_uid: tracking.instanceUid ?? undefined,
  total_frames: tracking.totalFrames,
  frames: tracking.frames.map((frame) => ({
    frame_index: frame.frameIndex,
    points: frame.points,
    length_mm: frame.lengthMm,
    area_mm2: frame.areaMm2 ?? null,
    valid: frame.valid,
  })),
  summary: {
    min_mm: tracking.summary.minMm ?? null,
    max_mm: tracking.summary.maxMm ?? null,
    mean_mm: tracking.summary.meanMm ?? null,
    min_area_mm2: tracking.summary.minAreaMm2 ?? null,
    max_area_mm2: tracking.summary.maxAreaMm2 ?? null,
    mean_area_mm2: tracking.summary.meanAreaMm2 ?? null,
  },
});

const toPolygonTrack = (tracking: TrackingData): PolygonTrackResponse => ({
  frames: tracking.frames.map((frame) => ({
    frame_index: frame.frameIndex,
    points: frame.points,
    area_mm2: frame.areaMm2 ?? null,
  })),
});

export const buildTrackingMaps = (
  trackingData: Map<string, TrackingData>,
  measurements: Map<string, StoreMeasurement>,
): TrackingMaps => {
  const lineTracks: Record<string, LineTrackResponse> = {};
  const polygonTracks: Record<string, PolygonTrackResponse> = {};

  for (const [id, tracking] of trackingData.entries()) {
    const measurement = measurements.get(id);
    if (!measurement) continue;

    if (measurement.type === 'line') {
      lineTracks[id] = toLineTrack(tracking);
    } else if (measurement.type === 'polygon') {
      polygonTracks[id] = toPolygonTrack(tracking);
    }
  }

  return { lineTracks, polygonTracks };
};
