import { describe, expect, it } from 'vitest';
import { computeEditMovement, recomputeLegacyLineLengths, recomputeLegacyPolygonMetrics } from '../app/measurements/editFinalize';
import type { MeasurementEditState } from '../app/measurements/interaction';
import type { LegacyLineMeasurement, LegacyPolygonMeasurement } from '../app/measurements/legacyTypes';

describe('editFinalize helpers', () => {
  it('treats movement under 0.01px as no-op', () => {
    const editState: MeasurementEditState = {
      id: 'line-1',
      type: 'line',
      mode: 'move',
      startImagePoint: { x: 0, y: 0 },
      originalPoints: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
    };

    const tinyMove = computeEditMovement(editState, { x: 0.005, y: 0 });
    expect(tinyMove.hasMovement).toBe(false);

    const significantMove = computeEditMovement(editState, { x: 0.02, y: 0 });
    expect(significantMove.hasMovement).toBe(true);
  });

  it('recomputes legacy line lengths for edited line', () => {
    const editState: MeasurementEditState = {
      id: 'line-1',
      type: 'line',
      mode: 'move',
      startImagePoint: { x: 0, y: 0 },
      originalPoints: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
    };

    const maps: Record<string, LegacyLineMeasurement[]> = {
      frame: [
        {
          id: 'line-1',
          start: { x: 0, y: 0 },
          end: { x: 10, y: 20 },
          lengthMm: 0,
          instanceUid: null,
        },
      ],
    };

    const updated = recomputeLegacyLineLengths(maps, editState, [2, 1]);
    const lengthMm = updated.frame[0]?.lengthMm ?? 0;
    expect(lengthMm).toBeCloseTo(Math.sqrt(10 * 10 + 40 * 40), 5);
  });

  it('recomputes polygon area/perimeter for edited polygon', () => {
    const editState: MeasurementEditState = {
      id: 'poly-1',
      type: 'polygon',
      mode: 'move',
      startImagePoint: { x: 0, y: 0 },
      originalPoints: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
    };

    const maps: Record<string, LegacyPolygonMeasurement[]> = {
      frame: [
        {
          id: 'poly-1',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
          areaMm2: null,
          perimeterMm: null,
          instanceUid: null,
        },
      ],
    };

    const updated = recomputeLegacyPolygonMetrics(maps, editState, {
      rowSpacing: 1,
      columnSpacing: 1,
    });
    const polygon = updated.frame[0];
    expect(polygon?.areaMm2).toBeCloseTo(100, 5);
    expect(polygon?.perimeterMm).toBeCloseTo(40, 5);
  });
});
