import { isLineMeasurement, isPolygonMeasurement, type Measurement as StoreMeasurement } from '../../types';
import type {
  LegacyLineMeasurement,
  LegacyMeasurementMaps,
  LegacyPolygonMeasurement,
} from './legacyTypes';

const pushRecord = <T>(record: Record<string, T[]>, key: string, value: T) => {
  if (!record[key]) {
    record[key] = [];
  }
  record[key].push(value);
};

export const buildLegacyMeasurementMaps = (
  measurements: StoreMeasurement[],
): LegacyMeasurementMaps => {
  const measurementsByFrame: Record<string, LegacyLineMeasurement[]> = {};
  const measurementsBySeries: Record<string, LegacyLineMeasurement[]> = {};
  const polygonsByFrame: Record<string, LegacyPolygonMeasurement[]> = {};
  const polygonsBySeries: Record<string, LegacyPolygonMeasurement[]> = {};

  measurements.forEach((measurement) => {
    if (isLineMeasurement(measurement)) {
      const mapped: LegacyLineMeasurement = {
        id: measurement.id,
        start: measurement.points[0],
        end: measurement.points[1],
        lengthMm: measurement.lengthMm ?? null,
        instanceUid: measurement.instanceUid ?? null,
      };
      if (measurement.scope === 'frame' && measurement.frameKey) {
        pushRecord(measurementsByFrame, measurement.frameKey, mapped);
      } else {
        pushRecord(measurementsBySeries, measurement.seriesUid, mapped);
      }
      return;
    }

    if (isPolygonMeasurement(measurement)) {
      const mapped: LegacyPolygonMeasurement = {
        id: measurement.id,
        points: measurement.points,
        areaMm2: measurement.areaMm2 ?? null,
        perimeterMm: measurement.perimeterMm ?? null,
        instanceUid: measurement.instanceUid ?? null,
      };
      if (measurement.scope === 'frame' && measurement.frameKey) {
        pushRecord(polygonsByFrame, measurement.frameKey, mapped);
      } else {
        pushRecord(polygonsBySeries, measurement.seriesUid, mapped);
      }
    }
  });

  return {
    measurementsByFrame,
    measurementsBySeries,
    polygonsByFrame,
    polygonsBySeries,
  };
};
