import type { Measurement as StoreMeasurement } from '../../types';

type MeasurementInstanceSource = {
  id: string;
  instanceUid?: string | null;
  frameKey?: string | null;
  trackingData?: { instanceUid?: string | null } | null;
};

type MeasurementGetter = (id: string) => StoreMeasurement | undefined;

export const createMeasurementInstanceResolver = (
  getMeasurement: MeasurementGetter,
  resolveInstanceUidFromFrameKey: (frameKey?: string | null) => string | null,
) => {
  return (measurement: MeasurementInstanceSource): string | null => {
    const storeMeasurement = getMeasurement(measurement.id);
    const source = storeMeasurement ?? measurement;
    const trackingInstanceUid =
      'trackingData' in source && source.trackingData ? source.trackingData.instanceUid : null;
    return source.instanceUid ?? trackingInstanceUid ?? resolveInstanceUidFromFrameKey(source.frameKey) ?? null;
  };
};

export const filterMeasurementsForInstance = (
  measurements: StoreMeasurement[],
  activeInstanceUid: string | null,
  cineGrouping: 'instance' | 'series',
  resolveInstanceUid: (measurement: MeasurementInstanceSource) => string | null,
): StoreMeasurement[] => {
  if (!activeInstanceUid || cineGrouping !== 'instance') return measurements;
  return measurements.filter((measurement) => {
    const instanceUid = resolveInstanceUid(measurement);
    return instanceUid ? instanceUid === activeInstanceUid : false;
  });
};
