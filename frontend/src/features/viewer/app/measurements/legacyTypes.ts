import type { Point2D } from '../../types';

export type LegacyLineMeasurement = {
  id: string;
  start: Point2D;
  end: Point2D;
  lengthMm: number | null;
  instanceUid?: string | null;
};

export type LegacyPolygonMeasurement = {
  id: string;
  points: Point2D[];
  areaMm2: number | null;
  perimeterMm: number | null;
  instanceUid?: string | null;
};

export type LegacyMeasurementMaps = {
  measurementsByFrame: Record<string, LegacyLineMeasurement[]>;
  measurementsBySeries: Record<string, LegacyLineMeasurement[]>;
  polygonsByFrame: Record<string, LegacyPolygonMeasurement[]>;
  polygonsBySeries: Record<string, LegacyPolygonMeasurement[]>;
};
