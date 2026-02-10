/**
 * Measurement Hydration + Import Regression Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { importMeasurementsFromJson, loadMeasurementsFromStorage, saveMeasurementsToStorage } from '../services/measurementPersistence';
import { useMeasurementStore } from '../hooks/useMeasurementStore';
import type { LineMeasurement, TrackingData } from '../types';

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

const ensureCrypto = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return;
  let counter = 0;
  const cryptoStub = {
    randomUUID: () => `test-uuid-${++counter}`,
  } as Crypto;
  Object.defineProperty(globalThis, 'crypto', { value: cryptoStub });
};

const fixtureJson = (() => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const fixturePath = join(__dirname, 'fixtures', 'measurements', 'import.json');
  return readFileSync(fixturePath, 'utf-8');
})();

describe('measurement hydration + import', () => {
  beforeEach(() => {
    ensureCrypto();
    useMeasurementStore.getState().reset();
    localStorageMock.clear();
  });

  it('regenerates ids and timestamps on import', () => {
    const imported = importMeasurementsFromJson(fixtureJson);

    expect(imported.length).toBe(2);

    const line = imported.find((m) => m.type === 'line') as LineMeasurement;
    expect(line).toBeDefined();
    expect(line.id).not.toBe('line-1');
    expect(line.createdAt).toBe(1600000000000);
    expect(line.modifiedAt).toBeGreaterThan(1600000000000);

    const polygon = imported.find((m) => m.type === 'polygon');
    expect(polygon?.id).not.toBe('poly-1');
  });

  it('hydrates visible measurements by scope and frame', () => {
    const imported = importMeasurementsFromJson(fixtureJson);
    const store = useMeasurementStore.getState();
    store.importMeasurements(imported);

    const visibleFrame0 = store.getVisibleMeasurements('series-1', 'instance-1:0', 'frame');
    expect(visibleFrame0.some((m) => m.type === 'line')).toBe(true);
    expect(visibleFrame0.some((m) => m.type === 'polygon')).toBe(true);

    const visibleFrame1 = store.getVisibleMeasurements('series-1', 'instance-1:1', 'frame');
    expect(visibleFrame1.some((m) => m.type === 'line')).toBe(false);
    expect(visibleFrame1.some((m) => m.type === 'polygon')).toBe(true);
  });

  it('persists tracking data alongside measurements', () => {
    const imported = importMeasurementsFromJson(fixtureJson);
    const store = useMeasurementStore.getState();
    store.importMeasurements(imported);

    const line = imported.find((m) => m.type === 'line') as LineMeasurement;
    const trackingData: TrackingData = {
      seriesUid: 'series-1',
      instanceUid: 'instance-1',
      totalFrames: 2,
      startFrameIndex: 0,
      frames: [
        {
          frameIndex: 0,
          points: line.points,
          lengthMm: line.lengthMm ?? 25.4,
          valid: true,
        },
        {
          frameIndex: 1,
          points: line.points.map((p) => ({ x: p.x + 1, y: p.y + 1 })),
          lengthMm: line.lengthMm ?? 25.4,
          valid: true,
        },
      ],
      summary: {
        minMm: line.lengthMm ?? 25.4,
        maxMm: line.lengthMm ?? 25.4,
        meanMm: line.lengthMm ?? 25.4,
      },
    };

    store.setTrackingData(line.id, trackingData);

    const { trackingData: trackingMap } = useMeasurementStore.getState();
    saveMeasurementsToStorage('series-1', imported, trackingMap);
    const loaded = loadMeasurementsFromStorage('series-1');

    expect(loaded.measurements.length).toBe(imported.length);
    expect(loaded.trackingData.get(line.id)).toEqual(trackingData);
  });
});
