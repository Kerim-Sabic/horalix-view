import { describe, expect, it } from 'vitest';

import {
  calculateLvotHemodynamics,
  deriveLvLinearQuantification,
} from '../services/echoQuantificationService';
import type { ClinicalMeasurementRole, LineMeasurement } from '../types';

const line = (
  id: string,
  role: ClinicalMeasurementRole,
  lengthMm: number,
  overrides: Partial<LineMeasurement> = {},
): LineMeasurement => ({
  id,
  type: 'line',
  scope: 'series',
  label: role,
  color: '#fff',
  visible: true,
  locked: false,
  createdAt: 1,
  modifiedAt: 1,
  seriesUid: 'series',
  frameKey: null,
  instanceUid: 'plax-cine',
  clinicalRole: role,
  cardiacPhase: role === 'lv_lvid_es' ? 'end-systole' : 'end-diastole',
  sourceView: 'Parasternal_Long',
  viewConfidence: 0.95,
  reviewStatus: 'accepted',
  points: [
    { x: 0, y: 0 },
    { x: lengthMm, y: 0 },
  ],
  lengthMm,
  trackingData: null,
  ...overrides,
});

describe('deriveLvLinearQuantification', () => {
  it('derives FS only from explicit, reviewed ED and ES roles', () => {
    const result = deriveLvLinearQuantification([
      line('ed', 'lv_lvid_ed', 50),
      line('es', 'lv_lvid_es', 30),
    ]);
    expect(result.fractionalShorteningPercent).toBeCloseTo(40);
  });

  it('does not treat the only line as both LVEDD and LVESD', () => {
    const result = deriveLvLinearQuantification([line('only', 'lv_lvid_ed', 50)]);
    expect(result.lvedd?.id).toBe('only');
    expect(result.lvesd).toBeNull();
    expect(result.fractionalShorteningPercent).toBeNull();
  });

  it('withholds calculation until the geometry is reviewed', () => {
    const result = deriveLvLinearQuantification([
      line('ed', 'lv_lvid_ed', 50, { reviewStatus: 'unreviewed' }),
      line('es', 'lv_lvid_es', 30),
    ]);
    expect(result.fractionalShorteningPercent).toBeNull();
  });

  it('takes ED and ES from one tracked beat for an LVID cycle role', () => {
    const tracked = line('cycle', 'lv_lvid_cycle', 45, {
      cardiacPhase: 'cycle',
      trackingData: {
        seriesUid: 'series',
        instanceUid: 'plax-cine',
        totalFrames: 6,
        startFrameIndex: 0,
        frames: [50, 45, 35, 30, 38, 48].map((lengthMm, frameIndex) => ({
          frameIndex,
          points: [
            { x: 0, y: 0 },
            { x: lengthMm, y: 0 },
          ],
          lengthMm,
          valid: true,
        })),
        summary: { minMm: 30, maxMm: 50, meanMm: 41 },
      },
    });
    const result = deriveLvLinearQuantification([tracked]);
    expect(result.lvidSource).toBe('tracked-cycle');
    expect(result.lveddMm).toBeCloseTo(50);
    expect(result.lvesdMm).toBeCloseTo(30);
    expect(result.fractionalShorteningPercent).toBeCloseTo(40);
    expect(result.phaseFrames).toEqual({ ed: 0, es: 3 });
  });

  it('rejects ED and ES from different cines', () => {
    const result = deriveLvLinearQuantification([
      line('ed', 'lv_lvid_ed', 50, { instanceUid: 'cine-a' }),
      line('es', 'lv_lvid_es', 30, { instanceUid: 'cine-b' }),
    ]);
    expect(result.fractionalShorteningPercent).toBeNull();
    expect(result.warnings.join(' ')).toMatch(/same PLAX cine/i);
  });

  it('calculates ASE cube-formula LV mass and relative wall thickness', () => {
    const result = deriveLvLinearQuantification([
      line('ed', 'lv_lvid_ed', 50),
      line('ivs', 'lv_ivs_ed', 10),
      line('pw', 'lv_lvpw_ed', 10),
    ]);
    expect(result.lvMassGrams).toBeCloseTo(182, 0);
    expect(result.relativeWallThickness).toBeCloseTo(0.4, 2);
  });
});

describe('calculateLvotHemodynamics', () => {
  it('calculates LVOT area, stroke volume, output, and indexed values', () => {
    const result = calculateLvotHemodynamics(20, 20, 75, 2)!;
    expect(result.areaCm2).toBeCloseTo(Math.PI, 4);
    expect(result.strokeVolumeMl).toBeCloseTo(62.83, 2);
    expect(result.cardiacOutputLMin).toBeCloseTo(4.71, 2);
    expect(result.strokeVolumeIndexMlM2).toBeCloseTo(31.42, 2);
    expect(result.cardiacIndexLMinM2).toBeCloseTo(2.36, 2);
  });

  it('rejects non-physically-positive inputs', () => {
    expect(calculateLvotHemodynamics(0, 20)).toBeNull();
    expect(calculateLvotHemodynamics(20, -1)).toBeNull();
    expect(calculateLvotHemodynamics(20, 20, 0)).toBeNull();
  });
});
