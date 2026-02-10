import { type Point2D, smoothPolygon } from '../../types';
import { buildPathFromPoints, getTrailFrames } from '../tracking/trackSmoothing';
import type { LegacyLineMeasurement, LegacyPolygonMeasurement } from './legacyTypes';
import type { LineTrackResponse, PolygonTrackResponse } from './trackingMaps';

type LineTrailSegment = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  opacity: number;
  strokeWidth: number;
};

type LineLabel = {
  text: string;
  x: number;
  y: number;
  emphasized: boolean;
};

export type LineRenderModel = {
  id: string;
  start: Point2D;
  end: Point2D;
  strokeColor: string;
  strokeWidth: number;
  handleRadius: number;
  isSelected: boolean;
  trailSegments: LineTrailSegment[];
  label: LineLabel | null;
};

type PolygonTrailPath = {
  id: string;
  d: string;
  opacity: number;
  strokeWidth: number;
};

type PolygonLabel = {
  text: string;
  x: number;
  y: number;
  emphasized: boolean;
};

type PolygonInstruction = {
  text: string;
  x: number;
  y: number;
};

export type PolygonRenderModel = {
  id: string;
  isActive: boolean;
  isSelected: boolean;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  pathD: string;
  previewPath: string | null;
  vertexHandles: Array<{ id: string; x: number; y: number; radius: number; fill: string; stroke: string }>;
  trailPaths: PolygonTrailPath[];
  areaLabel: PolygonLabel | null;
  instructionLabel: PolygonInstruction | null;
};

const getTrailOpacity = (distance: number, trailLength: number): number => {
  if (trailLength <= 0) return 0;
  const normalized = (trailLength - distance + 1) / (trailLength + 1);
  return Math.max(0.05, Math.min(0.35, 0.05 + normalized * 0.25));
};

const getLineStyle = (isSelected: boolean) => ({
  strokeColor: isSelected ? '#f59e0b' : '#3b82f6',
  strokeWidth: isSelected ? 3 : 2,
  handleRadius: isSelected ? 6 : 4,
});

const getPolygonStyle = (isSelected: boolean, isActive: boolean) => {
  const strokeColor = isSelected ? '#f59e0b' : '#10b981';
  const fillColor = isActive
    ? 'rgba(16, 185, 129, 0.2)'
    : isSelected
      ? 'rgba(245, 158, 11, 0.2)'
      : 'rgba(16, 185, 129, 0.15)';
  return { strokeColor, fillColor };
};

const getCentroid = (points: Point2D[]) => {
  if (points.length === 0) return { x: 0, y: 0 };
  const sum = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
};

const buildLineTrailSegments = (
  measurement: LegacyLineMeasurement,
  track: LineTrackResponse | null,
  showTrackingTrails: boolean,
  currentSlice: number,
  trackingTrailLength: number,
  strokeWidth: number,
): LineTrailSegment[] => {
  if (!showTrackingTrails || !track) return [];
  const trailFrames = getTrailFrames(track.frames, currentSlice, trackingTrailLength);
  return trailFrames.map(({ frame, distance }) => ({
    id: `trail-${measurement.id}-${frame.frame_index}`,
    x1: frame.points[0]?.x ?? measurement.start.x,
    y1: frame.points[0]?.y ?? measurement.start.y,
    x2: frame.points[1]?.x ?? measurement.end.x,
    y2: frame.points[1]?.y ?? measurement.end.y,
    strokeWidth: Math.max(1, strokeWidth - 1),
    opacity: getTrailOpacity(distance, trackingTrailLength),
  }));
};

const buildLineLabel = (
  measurement: LegacyLineMeasurement,
  isSelected: boolean,
): LineLabel | null => {
  if (measurement.lengthMm === null) return null;
  return {
    text: `${measurement.lengthMm.toFixed(1)} mm`,
    x: (measurement.start.x + measurement.end.x) / 2,
    y: (measurement.start.y + measurement.end.y) / 2 - 8,
    emphasized: isSelected,
  };
};

export const buildLineRenderModels = ({
  measurements,
  selectedMeasurementId,
  displayTracks,
  showTrackingTrails,
  trackingTrailLength,
  currentSlice,
  effectiveScope,
}: {
  measurements: LegacyLineMeasurement[];
  selectedMeasurementId: string | null;
  displayTracks: Record<string, LineTrackResponse>;
  showTrackingTrails: boolean;
  trackingTrailLength: number;
  currentSlice: number;
  effectiveScope: 'frame' | 'cine';
}): LineRenderModel[] => {
  return measurements.map((measurement) => {
    const isSelected = selectedMeasurementId === measurement.id;
    const { strokeColor, strokeWidth, handleRadius } = getLineStyle(isSelected);
    const track = effectiveScope === 'cine' ? displayTracks[measurement.id] ?? null : null;
    return {
      id: measurement.id,
      start: measurement.start,
      end: measurement.end,
      strokeColor,
      strokeWidth,
      handleRadius,
      isSelected,
      trailSegments: buildLineTrailSegments(
        measurement,
        track,
        showTrackingTrails,
        currentSlice,
        trackingTrailLength,
        strokeWidth,
      ),
      label: buildLineLabel(measurement, isSelected),
    };
  });
};

const buildPolygonTrailPaths = (
  polygon: LegacyPolygonMeasurement,
  track: PolygonTrackResponse | null,
  showTrackingTrails: boolean,
  currentSlice: number,
  trackingTrailLength: number,
  strokeWidth: number,
  smoothContoursEnabled: boolean,
  smoothContoursIterations: number,
): PolygonTrailPath[] => {
  if (!showTrackingTrails || !track) return [];
  const trailFrames = getTrailFrames(track.frames, currentSlice, trackingTrailLength);
  return trailFrames.map(({ frame, distance }) => {
    const trailPoints =
      smoothContoursEnabled && frame.points.length >= 3
        ? smoothPolygon(frame.points, smoothContoursIterations)
        : frame.points;
    return {
      id: `trail-${polygon.id}-${frame.frame_index}`,
      d: buildPathFromPoints(trailPoints, true),
      strokeWidth: Math.max(1, strokeWidth - 1),
      opacity: getTrailOpacity(distance, trackingTrailLength),
    };
  });
};

const buildPolygonPaths = (
  polygon: LegacyPolygonMeasurement,
  isActive: boolean,
  polygonPreviewPoint: Point2D | null,
  smoothContoursEnabled: boolean,
  smoothContoursIterations: number,
) => {
  const basePoints =
    isActive && polygonPreviewPoint ? [...polygon.points, polygonPreviewPoint] : polygon.points;
  const renderPoints =
    !isActive && smoothContoursEnabled && basePoints.length >= 3
      ? smoothPolygon(basePoints, smoothContoursIterations)
      : basePoints;
  const previewSmoothPoints =
    isActive && smoothContoursEnabled && basePoints.length >= 3
      ? smoothPolygon(basePoints, smoothContoursIterations)
      : null;
  return {
    pathD: buildPathFromPoints(renderPoints, !isActive),
    previewPath: previewSmoothPoints ? buildPathFromPoints(previewSmoothPoints, false) : null,
  };
};

const buildPolygonHandles = (
  polygon: LegacyPolygonMeasurement,
  isActive: boolean,
  isSelected: boolean,
  strokeColor: string,
) =>
  polygon.points.map((point, idx) => ({
    id: `${polygon.id}-${idx}`,
    x: point.x,
    y: point.y,
    radius: isActive && idx === 0 ? 6 : isSelected ? 5 : 4,
    fill: isActive && idx === 0 ? '#22c55e' : strokeColor,
    stroke: (isActive && idx === 0) || isSelected ? '#fff' : 'none',
  }));

const buildPolygonLabels = (
  polygon: LegacyPolygonMeasurement,
  isActive: boolean,
  isSelected: boolean,
) => {
  const { x, y } = getCentroid(polygon.points);
  return {
    areaLabel:
      !isActive && polygon.areaMm2 !== null
        ? {
            text: `${polygon.areaMm2.toFixed(1)} mm^2`,
            x,
            y,
            emphasized: isSelected,
          }
        : null,
    instructionLabel:
      isActive && polygon.points.length >= 3
        ? { text: 'Double-click to close', x, y }
        : null,
  };
};

type PolygonRenderModelOptions = {
  activePolygon: LegacyPolygonMeasurement | null;
  selectedMeasurementId: string | null;
  displayTracks: Record<string, PolygonTrackResponse>;
  showTrackingTrails: boolean;
  trackingTrailLength: number;
  currentSlice: number;
  polygonPreviewPoint: Point2D | null;
  smoothContoursEnabled: boolean;
  smoothContoursIterations: number;
  effectiveScope: 'frame' | 'cine';
};

const buildPolygonRenderModel = (
  polygon: LegacyPolygonMeasurement,
  options: PolygonRenderModelOptions,
): PolygonRenderModel => {
  const {
    activePolygon,
    selectedMeasurementId,
    displayTracks,
    showTrackingTrails,
    trackingTrailLength,
    currentSlice,
    polygonPreviewPoint,
    smoothContoursEnabled,
    smoothContoursIterations,
    effectiveScope,
  } = options;

  const isActive = activePolygon?.id === polygon.id;
  const isSelected = selectedMeasurementId === polygon.id;
  const { strokeColor, fillColor } = getPolygonStyle(isSelected, isActive);
  const track = effectiveScope === 'cine' ? displayTracks[polygon.id] ?? null : null;
  const paths = buildPolygonPaths(
    polygon,
    isActive,
    polygonPreviewPoint,
    smoothContoursEnabled,
    smoothContoursIterations,
  );
  const labels = buildPolygonLabels(polygon, isActive, isSelected);

  return {
    id: polygon.id,
    isActive,
    isSelected,
    strokeColor,
    fillColor,
    strokeWidth: isSelected ? 3 : 2,
    pathD: paths.pathD,
    previewPath: paths.previewPath,
    vertexHandles: buildPolygonHandles(polygon, isActive, isSelected, strokeColor),
    trailPaths: buildPolygonTrailPaths(
      polygon,
      track,
      showTrackingTrails && !isActive,
      currentSlice,
      trackingTrailLength,
      isSelected ? 3 : 2,
      smoothContoursEnabled,
      smoothContoursIterations,
    ),
    areaLabel: labels.areaLabel,
    instructionLabel: labels.instructionLabel,
  };
};

export const buildPolygonRenderModels = ({
  polygons,
  ...options
}: {
  polygons: LegacyPolygonMeasurement[];
} & PolygonRenderModelOptions): PolygonRenderModel[] => {
  return polygons.map((polygon) => buildPolygonRenderModel(polygon, options));
};
