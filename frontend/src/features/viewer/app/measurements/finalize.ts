import type { LineMeasurement } from '../../types';
import type { MeasureDragState } from './dragging';
import type { LegacyLineMeasurement } from './legacyTypes';

type FinalizeMeasureDragInput = {
  dragState: MeasureDragState;
  measurement: LegacyLineMeasurement;
  cineGrouping: 'instance' | 'series';
  currentInstanceUid?: string | null;
  seriesKey?: string | null;
};

export type LegacyInsert = {
  scope: 'series' | 'frame';
  key: string;
  measurement: LegacyLineMeasurement;
};

export type StoreInsert = {
  payload: Omit<LineMeasurement, 'id' | 'createdAt' | 'modifiedAt'>;
  id: string;
};

export type AutoTrackRequest = {
  seriesKey: string;
  measurement: LegacyLineMeasurement;
  instanceUid: string | null;
};

export type FinalizeMeasureDragResult = {
  legacyInsert?: LegacyInsert;
  storeInsert?: StoreInsert;
  selectedId?: string;
  autoTrack?: AutoTrackRequest;
};

const buildSeriesResult = (
  dragState: MeasureDragState,
  measurement: LegacyLineMeasurement,
  instanceUidForScope: string | null,
  cineGrouping: 'instance' | 'series'
): FinalizeMeasureDragResult => ({
  legacyInsert: {
    scope: 'series',
    key: dragState.measureSeriesKey as string,
    measurement,
  },
  storeInsert: {
    payload: {
      type: 'line',
      seriesUid: dragState.measureSeriesKey as string,
      frameKey: dragState.measureFrameKey || null,
      scope: 'series',
      instanceUid: instanceUidForScope,
      points: [measurement.start, measurement.end],
      label: null,
      visible: true,
      locked: false,
      color: '#3b82f6',
      lengthMm: measurement.lengthMm,
      trackingData: null,
    },
    id: measurement.id,
  },
  selectedId: measurement.id,
  autoTrack: {
    seriesKey: dragState.measureSeriesKey as string,
    measurement,
    instanceUid: cineGrouping === 'instance' ? dragState.measureInstanceUid ?? null : null,
  },
});

const buildFrameResult = (
  dragState: MeasureDragState,
  measurement: LegacyLineMeasurement,
  currentInstanceUid: string | null,
  seriesKey?: string | null
): FinalizeMeasureDragResult => {
  const result: FinalizeMeasureDragResult = {
    legacyInsert: {
      scope: 'frame',
      key: dragState.measureFrameKey as string,
      measurement,
    },
    selectedId: measurement.id,
  };

  if (!seriesKey) return result;

  result.storeInsert = {
    payload: {
      type: 'line',
      seriesUid: seriesKey,
      frameKey: dragState.measureFrameKey as string,
      scope: 'frame',
      instanceUid: dragState.measureInstanceUid ?? currentInstanceUid ?? null,
      points: [measurement.start, measurement.end],
      label: null,
      visible: true,
      locked: false,
      color: '#3b82f6',
      lengthMm: measurement.lengthMm,
      trackingData: null,
    },
    id: measurement.id,
  };

  return result;
};

export const finalizeMeasureDrag = ({
  dragState,
  measurement,
  cineGrouping,
  currentInstanceUid,
  seriesKey,
}: FinalizeMeasureDragInput): FinalizeMeasureDragResult => {
  const instanceUidForScope =
    cineGrouping === 'instance' ? dragState.measureInstanceUid ?? currentInstanceUid ?? null : null;

  if (dragState.measureScope === 'cine' && dragState.measureSeriesKey) {
    return buildSeriesResult(dragState, measurement, instanceUidForScope, cineGrouping);
  }

  if (dragState.measureFrameKey) {
    return buildFrameResult(dragState, measurement, currentInstanceUid ?? null, seriesKey);
  }

  return {};
};
