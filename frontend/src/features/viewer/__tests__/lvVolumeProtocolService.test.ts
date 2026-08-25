import { describe, expect, it } from 'vitest';

import type { LvContourProtocolInput } from '../services/lvVolumeProtocolService';
import { assessLvVolumeProtocol, contourMatchesSlot } from '../services/lvVolumeProtocolService';

const contour = (
  id: string,
  view: 'A4C' | 'A2C',
  phase: 'end-diastole' | 'end-systole',
  instanceUid: string,
): LvContourProtocolInput => ({
  id,
  points: Array.from({ length: 12 }, (_, index) => ({ x: index, y: index % 3 })),
  calibration: {
    spacing: { rowSpacing: 0.3, columnSpacing: 0.3 },
    source: 'ultrasound_region',
    lengthUnit: 'mm',
    areaUnit: 'mm²',
    canMeasureVolume: true,
    region: null,
  },
  instanceUid,
  frameIndex: phase === 'end-diastole' ? 2 : 8,
  beatKey: '0:12',
  view,
  viewConfidence: 0.94,
  phase,
  reviewStatus: 'accepted',
});

describe('assessLvVolumeProtocol', () => {
  const valid = {
    a4cEd: contour('a4c-ed', 'A4C', 'end-diastole', 'a4c'),
    a4cEs: contour('a4c-es', 'A4C', 'end-systole', 'a4c'),
    a2cEd: contour('a2c-ed', 'A2C', 'end-diastole', 'a2c'),
    a2cEs: contour('a2c-es', 'A2C', 'end-systole', 'a2c'),
  };

  it('accepts a complete calibrated A4C/A2C ED/ES set', () => {
    expect(assessLvVolumeProtocol('biplane', valid).complete).toBe(true);
  });

  it('rejects a contour in the wrong view slot', () => {
    const result = assessLvVolumeProtocol('biplane', {
      ...valid,
      a4cEd: contour('wrong', 'A2C', 'end-diastole', 'a4c'),
    });
    expect(result.complete).toBe(false);
    expect(result.blocking.join(' ')).toMatch(/not A4C/i);
  });

  it('rejects ED and ES taken from different cines', () => {
    const result = assessLvVolumeProtocol('biplane', {
      ...valid,
      a4cEs: contour('other', 'A4C', 'end-systole', 'other-a4c'),
    });
    expect(result.complete).toBe(false);
    expect(result.blocking.join(' ')).toMatch(/same cine/i);
  });

  it('rejects tracked ED and ES from different beats', () => {
    const result = assessLvVolumeProtocol('biplane', {
      ...valid,
      a4cEs: { ...valid.a4cEs, beatKey: '13:25' },
    });
    expect(result.complete).toBe(false);
    expect(result.blocking.join(' ')).toMatch(/different tracked beats/i);
  });

  it('rejects automatic ED and ES from different source contours', () => {
    const result = assessLvVolumeProtocol('biplane', {
      ...valid,
      a4cEd: {
        ...valid.a4cEd,
        sourceMeasurementId: 'trace-one',
        phaseSource: 'tracked-auto',
      },
      a4cEs: {
        ...valid.a4cEs,
        sourceMeasurementId: 'trace-two',
        phaseSource: 'tracked-auto',
      },
    });
    expect(result.complete).toBe(false);
    expect(result.blocking.join(' ')).toMatch(/same tracked contour/i);
  });

  it('rejects one cine being used as both biplane views', () => {
    const result = assessLvVolumeProtocol('biplane', {
      ...valid,
      a2cEd: contour('a2c-ed', 'A2C', 'end-diastole', 'a4c'),
      a2cEs: contour('a2c-es', 'A2C', 'end-systole', 'a4c'),
    });
    expect(result.complete).toBe(false);
    expect(result.blocking.join(' ')).toMatch(/different cines/i);
  });

  it('allows a single-plane A2C protocol when explicitly selected', () => {
    const result = assessLvVolumeProtocol(
      'single-plane',
      { ...valid, a4cEd: valid.a2cEd, a4cEs: valid.a2cEs },
      'A2C',
    );
    expect(result.complete).toBe(true);
  });
});

describe('contourMatchesSlot', () => {
  it('filters by both view and phase', () => {
    const a4cEd = contour('a4c-ed', 'A4C', 'end-diastole', 'a4c');
    expect(contourMatchesSlot(a4cEd, 'A4C', 'ED')).toBe(true);
    expect(contourMatchesSlot(a4cEd, 'A2C', 'ED')).toBe(false);
    expect(contourMatchesSlot(a4cEd, 'A4C', 'ES')).toBe(false);
  });
});
