import { describe, it, expect } from 'vitest';
import { createMeasureDragStart, updateMeasureDrag } from '../app/measurements/dragging';

describe('measurement dragging', () => {
  it('clamps start point and computes length in mm', () => {
    const { dragState, measurement } = createMeasureDragStart({
      point: { x: 250, y: -10 },
      imageDimensions: { rows: 100, columns: 200 },
      frameKey: '1.2.3.4:0',
      seriesKey: '1.2.3',
      instanceUid: '1.2.3.4',
      scope: 'frame',
      id: 'measure-1',
    });

    expect(measurement.start).toEqual({ x: 200, y: 0 });
    expect(measurement.end).toEqual({ x: 200, y: 0 });

    const updated = updateMeasureDrag({
      dragState,
      currentPoint: { x: 300, y: 50 },
      imageDimensions: { rows: 100, columns: 200 },
      pixelSpacing: [2, 1],
    });

    expect(updated.end).toEqual({ x: 200, y: 50 });
    expect(updated.lengthMm).toBeCloseTo(100, 5);
  });
});
