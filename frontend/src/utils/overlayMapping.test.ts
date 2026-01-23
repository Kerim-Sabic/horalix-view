import { describe, expect, it } from 'vitest';
import { clampMaskSliceIndex, scaleDetectionBox } from './overlayMapping';

describe('overlayMapping', () => {
  it('scales detection boxes to output image space', () => {
    const scaled = scaleDetectionBox(
      { x: 100, y: 200, width: 50, height: 60 },
      [512, 512],
      [1024, 1024]
    );

    expect(scaled).toEqual({ x: 200, y: 400, width: 100, height: 120 });
  });

  it('clamps mask slice index to mask depth', () => {
    expect(clampMaskSliceIndex(5, [10, 512, 512])).toBe(5);
    expect(clampMaskSliceIndex(12, [10, 512, 512])).toBe(9);
    expect(clampMaskSliceIndex(-3, [10, 512, 512])).toBe(0);
    expect(clampMaskSliceIndex(3, [512, 512])).toBe(0);
  });
});
