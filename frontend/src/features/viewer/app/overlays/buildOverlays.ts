import { api } from '@/services/api';
import { clampMaskSliceIndex, scaleDetectionBox } from '@/utils/overlayMapping';

import type { ImageDimensions } from '../../types';

type AiJob = {
  job_id: string;
  task_type: string;
  results?: Record<string, unknown> | null;
  result_files?: Record<string, string> | null;
};

type AiStudyResults = {
  detections: Record<string, unknown>[];
  cardiac: Record<string, unknown>[];
  jobs: AiJob[];
};

type DetectionOverlay = {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
};

type SegmentationOverlay = { id: string; url: string };

type CardiacLine = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  color: string;
  measurementValue?: number;
  measurementUnit?: string;
};

type CardiacPoly = {
  id: string;
  points: string;
  label: string;
  color: string;
  closed: boolean;
};

type CardiacOverlayResult = { lines: CardiacLine[]; polylines: CardiacPoly[] };

export type OverlayTarget = {
  instanceUid: string;
  frameIndex: number | null;
  label?: string | null;
};

export type InteractiveSegmentationResult = {
  id: string;
  seriesUid: string;
  instanceUid: string;
  frameIndex: number;
  maskFilename: string;
  maskShape: number[];
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

const getSeriesUid = (result: Record<string, unknown>): string | null =>
  typeof result.series_uid === 'string' ? result.series_uid : null;

const getSliceIndex = (result: Record<string, unknown>): number | null =>
  typeof result.slice_index === 'number' ? result.slice_index : null;

const getInputShape = (result: Record<string, unknown>): [number, number] | null => {
  const inputShape = Array.isArray(result.input_shape) ? result.input_shape : null;
  if (!inputShape || inputShape.length < 2) return null;
  return [inputShape[0], inputShape[1]];
};

const getDetectionLabel = (det: Record<string, unknown>): string =>
  typeof det.class_name === 'string' ? det.class_name : `Class ${det.class_id ?? ''}`;

const buildDetectionOverlay = (
  det: Record<string, unknown>,
  inputShape: [number, number],
  imageDimensions: ImageDimensions,
): DetectionOverlay | null => {
  if (
    typeof det.x !== 'number' ||
    typeof det.y !== 'number' ||
    typeof det.width !== 'number' ||
    typeof det.height !== 'number'
  ) {
    return null;
  }
  const scaled = scaleDetectionBox(
    {
      x: det.x,
      y: det.y,
      width: det.width,
      height: det.height,
    },
    inputShape,
    [imageDimensions.rows, imageDimensions.columns],
  );
  return { ...scaled, label: getDetectionLabel(det) };
};

const extractDetectionOverlays = (
  result: Record<string, unknown>,
  seriesUid: string,
  currentSlice: number,
  imageDimensions: ImageDimensions,
): DetectionOverlay[] => {
  const resultSeries = getSeriesUid(result);
  if (resultSeries && resultSeries !== seriesUid) return [];
  const sliceIndex = getSliceIndex(result);
  if (sliceIndex !== null && sliceIndex !== currentSlice) return [];

  const detections = Array.isArray(result.detections) ? result.detections : [];
  const inputShape = getInputShape(result) ?? [imageDimensions.rows, imageDimensions.columns];

  return detections
    .map((det) => asRecord(det))
    .filter((det): det is Record<string, unknown> => Boolean(det))
    .map((det) => buildDetectionOverlay(det, inputShape, imageDimensions))
    .filter((overlay): overlay is DetectionOverlay => Boolean(overlay));
};

const getJobMaskFilename = (job: AiJob): string | null => {
  const results = job.results || {};
  const maskPath = job.result_files?.mask || (typeof results.mask === 'string' ? results.mask : null);
  if (!maskPath) return null;
  return maskPath.split('/').pop() ?? null;
};

const matchesTarget = (
  target: Record<string, unknown> | undefined,
  seriesUid: string,
  currentInstanceUid: string | null,
  currentFrameIndex: number,
): boolean => {
  if (!target) return true;
  const overlaySeries = target.series_uid as string | undefined;
  if (overlaySeries && overlaySeries !== seriesUid) return false;
  const overlayInstance = target.instance_uid as string | undefined;
  if (overlayInstance && currentInstanceUid && overlayInstance !== currentInstanceUid) return false;
  const overlayFrame = target.frame_index as number | undefined;
  if (overlayFrame !== undefined && overlayFrame !== null && overlayFrame !== currentFrameIndex) return false;
  return true;
};

const toCardiacLine = (overlay: Record<string, unknown>, fallbackId: string): CardiacLine | null => {
  const start = overlay.start_px as Record<string, number> | undefined;
  const end = overlay.end_px as Record<string, number> | undefined;
  if (
    !start ||
    !end ||
    typeof start.x !== 'number' ||
    typeof start.y !== 'number' ||
    typeof end.x !== 'number' ||
    typeof end.y !== 'number'
  ) {
    return null;
  }
  return {
    id: (overlay.id as string) || fallbackId,
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    label: (overlay.label as string) || '',
    color: (overlay.color as string) || '#00FF00',
    measurementValue: typeof overlay.measurement_value === 'number' ? overlay.measurement_value : undefined,
    measurementUnit: typeof overlay.measurement_unit === 'string' ? overlay.measurement_unit : undefined,
  };
};

const toCardiacPolyline = (
  overlay: Record<string, unknown>,
  fallbackId: string,
): CardiacPoly | null => {
  const pts = overlay.points_px as Array<Record<string, number>> | undefined;
  if (!pts || pts.length < 2) return null;
  const pointsStr = pts.map((p) => `${p.x},${p.y}`).join(' ');
  return {
    id: (overlay.id as string) || fallbackId,
    points: pointsStr,
    label: (overlay.label as string) || '',
    color: (overlay.color as string) || '#FF0000',
    closed: (overlay.closed as boolean) ?? false,
  };
};

const getOverlayOutput = (result: Record<string, unknown>): Record<string, unknown> => {
  const output = (result.output ?? result) as Record<string, unknown>;
  return output ?? {};
};

const extractOverlayTargets = (overlays: Record<string, unknown>[]): OverlayTarget[] => {
  const targets: OverlayTarget[] = [];
  const seen = new Set<string>();

  overlays.forEach((overlay) => {
    const target = overlay.target as Record<string, unknown> | undefined;
    const instanceUid =
      (typeof target?.instance_uid === 'string' ? target.instance_uid : null) ??
      (typeof overlay.instance_uid === 'string' ? overlay.instance_uid : null);
    if (!instanceUid) return;
    const frameIndex = typeof target?.frame_index === 'number' ? target.frame_index : null;
    const key = `${instanceUid}:${frameIndex ?? -1}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({
      instanceUid,
      frameIndex,
      label: typeof overlay.label === 'string' ? overlay.label : null,
    });
  });

  return targets;
};

export const buildDetectionOverlays = ({
  aiResults,
  seriesUid,
  currentSlice,
  imageDimensions,
}: {
  aiResults: AiStudyResults | null;
  seriesUid: string | null;
  currentSlice: number;
  imageDimensions: ImageDimensions;
}): DetectionOverlay[] => {
  if (!aiResults || !seriesUid) return [];
  return aiResults.detections
    .map((result) => asRecord(result))
    .filter((result): result is Record<string, unknown> => Boolean(result))
    .flatMap((result) => extractDetectionOverlays(result, seriesUid, currentSlice, imageDimensions));
};

export const buildSegmentationOverlays = ({
  aiResults,
  studyUid,
  seriesUid,
  currentSlice,
}: {
  aiResults: AiStudyResults | null;
  studyUid: string | null;
  seriesUid: string | null;
  currentSlice: number;
}): SegmentationOverlay[] => {
  if (!aiResults || !studyUid || !seriesUid) return [];
  const overlays: SegmentationOverlay[] = [];

  aiResults.jobs.forEach((job) => {
    if (job.task_type !== 'segmentation') return;
    const results = job.results || {};
    const jobSeries = typeof results.series_uid === 'string' ? results.series_uid : null;
    if (jobSeries && jobSeries !== seriesUid) return;
    const filename = getJobMaskFilename(job);
    if (!filename) return;
    const maskShape = Array.isArray(results.mask_shape) ? results.mask_shape : null;
    const sliceIndex = clampMaskSliceIndex(currentSlice, maskShape);
    overlays.push({
      id: job.job_id,
      url: api.ai.getMaskOverlayUrl(studyUid, filename, sliceIndex),
    });
  });

  return overlays;
};

export const buildCardiacOverlays = ({
  aiResults,
  seriesUid,
  currentInstanceUid,
  currentFrameIndex,
}: {
  aiResults: AiStudyResults | null;
  seriesUid: string | null;
  currentInstanceUid: string | null;
  currentFrameIndex: number;
}): CardiacOverlayResult => {
  if (!aiResults || !seriesUid) return { lines: [], polylines: [] };
  const lines: CardiacLine[] = [];
  const polylines: CardiacPoly[] = [];

  aiResults.cardiac.forEach((result) => {
    const resultAny = asRecord(result);
    if (!resultAny) return;
    const output = getOverlayOutput(resultAny);
    const overlays = Array.isArray(output.overlays) ? output.overlays : [];

    overlays
      .map((overlay) => asRecord(overlay))
      .filter((overlay): overlay is Record<string, unknown> => Boolean(overlay))
      .filter((overlay) =>
        matchesTarget(
          overlay.target as Record<string, unknown> | undefined,
          seriesUid,
          currentInstanceUid,
          currentFrameIndex,
        ),
      )
      .forEach((overlay) => {
        if (overlay.type === 'line') {
          const line = toCardiacLine(overlay, `line-${lines.length}`);
          if (line) lines.push(line);
          return;
        }
        if (overlay.type === 'polyline') {
          const poly = toCardiacPolyline(overlay, `poly-${polylines.length}`);
          if (poly) polylines.push(poly);
        }
      });
  });

  return { lines, polylines };
};

export const collectOverlayTargets = (aiResults: AiStudyResults | null): OverlayTarget[] => {
  if (!aiResults) return [];
  const cardiacResults = Array.isArray(aiResults.cardiac) ? aiResults.cardiac : [];
  const overlays = cardiacResults
    .map((result) => asRecord(result))
    .filter((result): result is Record<string, unknown> => Boolean(result))
    .flatMap((result) => {
      const output = getOverlayOutput(result);
      return Array.isArray(output.overlays) ? output.overlays : [];
    })
    .map((overlay) => asRecord(overlay))
    .filter((overlay): overlay is Record<string, unknown> => Boolean(overlay));

  return extractOverlayTargets(overlays);
};

export const buildInteractiveSegmentationOverlays = ({
  interactiveSegmentations,
  studyUid,
  seriesKey,
  currentInstanceUid,
  currentFrameIndex,
}: {
  interactiveSegmentations: InteractiveSegmentationResult[];
  studyUid: string | null;
  seriesKey: string | null;
  currentInstanceUid: string | null;
  currentFrameIndex: number;
}): SegmentationOverlay[] => {
  if (!studyUid || !seriesKey || !currentInstanceUid) return [];
  return interactiveSegmentations
    .filter((result) => result.seriesUid === seriesKey && result.instanceUid === currentInstanceUid)
    .filter((result) => {
      if (!result.maskShape) return false;
      if (result.maskShape.length === 2) {
        return result.frameIndex === currentFrameIndex;
      }
      return true;
    })
    .map((result) => {
      const sliceIndex = clampMaskSliceIndex(currentFrameIndex, result.maskShape);
      return {
        id: result.id,
        url: api.ai.getMaskOverlayUrl(studyUid, result.maskFilename, sliceIndex),
      };
    });
};
