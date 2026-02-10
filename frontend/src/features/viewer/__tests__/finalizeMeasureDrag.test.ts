import { describe, expect, it } from 'vitest';
import { finalizeMeasureDrag } from '../app/measurements/finalize';
import type { LegacyLineMeasurement } from '../app/measurements/legacyTypes';
import type { MeasureDragState } from '../app/measurements/dragging';

describe('finalizeMeasureDrag', () => {
  it('returns autoTrack for cine scope', () => {
    const dragState: MeasureDragState = {
      measureStart: { x: 0, y: 0 },
      measureId: 'm1',
      measureFrameKey: 'inst-1:0',
      measureSeriesKey: 'series-1',
      measureInstanceUid: 'inst-1',
      measureScope: 'cine',
    };

    const measurement: LegacyLineMeasurement = {
      id: 'm1',
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

    expect(result.autoTrack).toBeTruthy();
    expect(result.autoTrack?.seriesKey).toBe('series-1');
  });
});
