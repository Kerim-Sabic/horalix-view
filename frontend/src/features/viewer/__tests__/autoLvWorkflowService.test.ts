import { describe, expect, it } from 'vitest';

import type { AutoLvContourInput } from '../services/autoLvWorkflowService';
import {
  getAutoLvViewState,
  selectBestAutoLvPhases,
  trackedLvPhaseValue,
} from '../services/autoLvWorkflowService';

const calibrated = {
  spacing: { rowSpacing: 0.4, columnSpacing: 0.4 },
  source: 'pixel_spacing' as const,
  lengthUnit: 'mm' as const,
  areaUnit: 'mm²' as const,
  canMeasureVolume: true,
  region: null,
};

function contour(
  id: string,
  sourceMeasurementId: string,
  view: 'A4C' | 'A2C',
  phase: 'end-diastole' | 'end-systole',
  beatKey: string,
  frameIndex: number,
  quality = 0.9,
): AutoLvContourInput {
  return {
    id,
    sourceMeasurementId,
    points: Array.from({ length: 16 }, (_, index) => ({ x: index, y: index % 4 })),
    calibration: calibrated,
    instanceUid: `${view}-cine`,
    frameIndex,
    beatKey,
    view,
    viewConfidence: 0.96,
    phase,
    reviewStatus: 'unreviewed',
    phaseSource: 'tracked-auto',
    trackingQuality: quality,
    trackedBeatCount: 2,
    cycleLengthFrames: 18,
  };
}

describe('selectBestAutoLvPhases', () => {
  it('keeps ED and ES tied to the same tracked contour and beat', () => {
    const inputs = [
      contour('trace-1:ED', 'trace-1', 'A4C', 'end-diastole', '2:20', 2),
      contour('trace-2:ES', 'trace-2', 'A4C', 'end-systole', '2:20', 11),
      contour('trace-1:ES', 'trace-1', 'A4C', 'end-systole', '2:20', 10),
    ];

    const result = selectBestAutoLvPhases(inputs);

    expect(result.a4c?.ed.id).toBe('trace-1:ED');
    expect(result.a4c?.es.id).toBe('trace-1:ES');
  });

  it('does not pair phases from different beats', () => {
    const inputs = [
      contour('trace-1:ED', 'trace-1', 'A4C', 'end-diastole', '2:20', 2),
      contour('trace-1:ES', 'trace-1', 'A4C', 'end-systole', '21:39', 30),
    ];

    expect(selectBestAutoLvPhases(inputs).a4c).toBeNull();
  });

  it('does not treat ordinary tracked polygons as automatic LV phases', () => {
    const ed = contour('other:ED', 'other', 'A4C', 'end-diastole', '0:18', 0);
    const es = contour('other:ES', 'other', 'A4C', 'end-systole', '0:18', 9);

    expect(
      selectBestAutoLvPhases([
        { ...ed, phaseSource: 'manual' },
        { ...es, phaseSource: 'manual' },
      ]).a4c,
    ).toBeNull();
  });

  it('prefers the higher-quality complete tracking run', () => {
    const inputs = [
      contour('low:ED', 'low', 'A2C', 'end-diastole', '0:18', 0, 0.55),
      contour('low:ES', 'low', 'A2C', 'end-systole', '0:18', 9, 0.55),
      contour('high:ED', 'high', 'A2C', 'end-diastole', '3:22', 3, 0.98),
      contour('high:ES', 'high', 'A2C', 'end-systole', '3:22', 13, 0.98),
    ];

    expect(selectBestAutoLvPhases(inputs).a2c?.sourceMeasurementId).toBe('high');
  });

  it('reports tracking and ready workflow states explicitly', () => {
    const seed: AutoLvContourInput = {
      ...contour('seed', 'seed', 'A4C', 'end-diastole', '0:18', 0),
      phase: 'cycle',
      phaseSource: 'manual',
      beatKey: null,
      frameIndex: null,
    };

    expect(getAutoLvViewState([seed], 'A4C', 'seed').status).toBe('tracking');

    const complete = [
      seed,
      contour('seed:ED', 'seed', 'A4C', 'end-diastole', '0:18', 0),
      contour('seed:ES', 'seed', 'A4C', 'end-systole', '0:18', 9),
    ];
    expect(getAutoLvViewState(complete, 'A4C', null).status).toBe('ready');
  });
});

describe('trackedLvPhaseValue', () => {
  it('uses Simpson volume so the larger LV contour ranks as ED', () => {
    const halfEllipse = (width: number, height: number) =>
      Array.from({ length: 64 }, (_, index) => {
        const angle = Math.PI + (index / 63) * Math.PI;
        return { x: Math.cos(angle) * width, y: Math.sin(angle) * height };
      });

    const edValue = trackedLvPhaseValue(halfEllipse(24, 55), calibrated, 4000);
    const esValue = trackedLvPhaseValue(halfEllipse(16, 45), calibrated, 2200);

    expect(edValue).toBeGreaterThan(esValue);
  });
});
