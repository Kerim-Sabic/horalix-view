import { beforeEach, describe, expect, it } from 'vitest';
import { useMeasurementStore } from '../hooks/useMeasurementStore';
import { finalizeMeasureDrag } from '../app/measurements/finalize';
import type { LegacyLineMeasurement } from '../app/measurements/legacyTypes';
import type { MeasureDragState } from '../app/measurements/dragging';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

const getStore = () => useMeasurementStore.getState();

const applyFinalizeResult = (
  result: ReturnType<typeof finalizeMeasureDrag>,
  legacySeries: Record<string, LegacyLineMeasurement[]>,
  legacyFrame: Record<string, LegacyLineMeasurement[]>
) => {
  if (result.legacyInsert) {
    if (result.legacyInsert.scope === 'series') {
      const existing = legacySeries[result.legacyInsert.key] ?? [];
      legacySeries[result.legacyInsert.key] = [...existing, result.legacyInsert.measurement];
    } else {
      const existing = legacyFrame[result.legacyInsert.key] ?? [];
      legacyFrame[result.legacyInsert.key] = [...existing, result.legacyInsert.measurement];
    }
  }

  if (result.storeInsert) {
    getStore().createMeasurement(result.storeInsert.payload, result.storeInsert.id);
  }
};

describe('finalize measure flow', () => {
  beforeEach(() => {
    getStore().reset();
    localStorageMock.clear();
  });

  it('inserts into frame legacy map + store for frame scope', () => {
    const legacySeries: Record<string, LegacyLineMeasurement[]> = {};
    const legacyFrame: Record<string, LegacyLineMeasurement[]> = {};

    const dragState: MeasureDragState = {
      measureStart: { x: 0, y: 0 },
      measureId: 'm-frame',
      measureFrameKey: 'inst-1:0',
      measureSeriesKey: 'series-1',
      measureInstanceUid: 'inst-1',
      measureScope: 'frame',
    };

    const measurement: LegacyLineMeasurement = {
      id: 'm-frame',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      lengthMm: 10,
      instanceUid: 'inst-1',
    };

    const result = finalizeMeasureDrag({
      dragState,
      measurement,
      cineGrouping: 'instance',
      currentInstanceUid: 'inst-1',
      seriesKey: 'series-1',
    });

    applyFinalizeResult(result, legacySeries, legacyFrame);

    expect(legacyFrame['inst-1:0']).toHaveLength(1);
    expect(legacySeries['series-1']).toBeUndefined();

    const stored = getStore().measurements.get('m-frame');
    expect(stored?.scope).toBe('frame');
    expect(stored?.frameKey).toBe('inst-1:0');
  });

  it('inserts into series legacy map + store for cine scope', () => {
    const legacySeries: Record<string, LegacyLineMeasurement[]> = {};
    const legacyFrame: Record<string, LegacyLineMeasurement[]> = {};

    const dragState: MeasureDragState = {
      measureStart: { x: 0, y: 0 },
      measureId: 'm-cine',
      measureFrameKey: 'inst-1:0',
      measureSeriesKey: 'series-1',
      measureInstanceUid: 'inst-1',
      measureScope: 'cine',
    };

    const measurement: LegacyLineMeasurement = {
      id: 'm-cine',
      start: { x: 0, y: 0 },
      end: { x: 15, y: 0 },
      lengthMm: 15,
      instanceUid: 'inst-1',
    };

    const result = finalizeMeasureDrag({
      dragState,
      measurement,
      cineGrouping: 'instance',
      currentInstanceUid: 'inst-1',
      seriesKey: 'series-1',
    });

    applyFinalizeResult(result, legacySeries, legacyFrame);

    expect(legacySeries['series-1']).toHaveLength(1);
    expect(legacyFrame['inst-1:0']).toBeUndefined();

    const stored = getStore().measurements.get('m-cine');
    expect(stored?.scope).toBe('series');
    expect(stored?.frameKey).toBe('inst-1:0');
  });
});
