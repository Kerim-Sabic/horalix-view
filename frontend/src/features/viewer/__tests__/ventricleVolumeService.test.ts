import { describe, expect, it } from 'vitest';

import {
  SIMPSON_DISK_COUNT,
  estimateLongAxisFromContour,
  flipLongAxis,
  biplaneVolume,
  bodySurfaceArea,
  buildLongAxis,
  ejectionFraction,
  findApex,
  indexToBsa,
  isForeshortened,
  longAxisLengthMm,
  measureDisks,
  singlePlaneVolume,
} from '../services/ventricleVolumeService';
import type { LongAxis } from '../services/ventricleVolumeService';
import type { PixelSpacing, Point2D } from '../types';

/** 1 px == 1 mm, so pixel figures and millimetre figures coincide. */
const unitSpacing: PixelSpacing = { rowSpacing: 1, columnSpacing: 1 };

/**
 * An ellipse with the long axis vertical, standing in for an apical LV trace.
 * `semiMajor` runs base-to-apex, `semiMinor` is the half-width.
 */
function ellipseContour(
  semiMinor: number,
  semiMajor: number,
  count = 180,
  cx = 0,
  cy = 0
): Point2D[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    return { x: cx + Math.cos(angle) * semiMinor, y: cy + Math.sin(angle) * semiMajor };
  });
}

/** Long axis running down the middle of an ellipse centred on the origin. */
const ellipseAxis = (semiMajor: number): LongAxis => ({
  base: { x: 0, y: -semiMajor },
  apex: { x: 0, y: semiMajor },
});

describe('findApex', () => {
  it('picks the contour point furthest from the annulus midpoint', () => {
    const contour = ellipseContour(20, 50);
    const apex = findApex(contour, { x: 0, y: -50 });
    expect(apex).not.toBeNull();
    expect(apex!.y).toBeGreaterThan(45);
    expect(Math.abs(apex!.x)).toBeLessThan(5);
  });

  it('returns null for a degenerate contour', () => {
    expect(findApex([{ x: 0, y: 0 }], { x: 0, y: 0 })).toBeNull();
  });
});

describe('buildLongAxis', () => {
  it('places the base at the midpoint of the two annulus points', () => {
    const contour = ellipseContour(20, 50);
    const axis = buildLongAxis(contour, { x: -20, y: -50 }, { x: 20, y: -50 });
    expect(axis).not.toBeNull();
    expect(axis!.base.x).toBeCloseTo(0);
    expect(axis!.base.y).toBeCloseTo(-50);
  });
});

describe('longAxisLengthMm', () => {
  it('measures in millimetres, honouring anisotropic spacing', () => {
    const axis: LongAxis = { base: { x: 0, y: 0 }, apex: { x: 0, y: 100 } };
    expect(longAxisLengthMm(axis, unitSpacing)).toBeCloseTo(100);
    expect(longAxisLengthMm(axis, { rowSpacing: 0.5, columnSpacing: 0.5 })).toBeCloseTo(50);
  });
});

describe('measureDisks', () => {
  it('returns the requested number of disks', () => {
    const disks = measureDisks(ellipseContour(20, 50), ellipseAxis(50), unitSpacing);
    expect(disks).toHaveLength(SIMPSON_DISK_COUNT);
  });

  it('measures the widest disk near the middle of the long axis', () => {
    const disks = measureDisks(ellipseContour(20, 50), ellipseAxis(50), unitSpacing);
    const widest = disks.reduce((best, d) => (d.diameterMm > best.diameterMm ? d : best));
    // Mid-stack for an ellipse; allow a disk either side of centre.
    expect(widest.index).toBeGreaterThanOrEqual(8);
    expect(widest.index).toBeLessThanOrEqual(11);
    expect(widest.diameterMm).toBeCloseTo(40, 0);
  });

  it('tapers toward the apex', () => {
    const disks = measureDisks(ellipseContour(20, 50), ellipseAxis(50), unitSpacing);
    expect(disks[disks.length - 1].diameterMm).toBeLessThan(disks[10].diameterMm);
  });

  it('scales diameters with pixel spacing', () => {
    const contour = ellipseContour(20, 50);
    const coarse = measureDisks(contour, ellipseAxis(50), { rowSpacing: 2, columnSpacing: 2 });
    const fine = measureDisks(contour, ellipseAxis(50), unitSpacing);
    expect(coarse[10].diameterMm).toBeCloseTo(fine[10].diameterMm * 2, 1);
  });

  it('returns nothing for a zero-length axis', () => {
    const axis: LongAxis = { base: { x: 0, y: 0 }, apex: { x: 0, y: 0 } };
    expect(measureDisks(ellipseContour(20, 50), axis, unitSpacing)).toEqual([]);
  });
});

describe('singlePlaneVolume', () => {
  it('approximates the volume of the prolate spheroid it traces', () => {
    // Rotating an ellipse with semi-axes (20, 50) about its long axis gives
    // V = 4/3 * pi * a^2 * c = 4/3 * pi * 400 * 50 mm^3 ~= 83.8 mL.
    const result = singlePlaneVolume(ellipseContour(20, 50), ellipseAxis(50), unitSpacing);
    expect(result).not.toBeNull();
    const expectedMl = ((4 / 3) * Math.PI * 20 * 20 * 50) / 1000;
    expect(result!.volumeMl).toBeGreaterThan(expectedMl * 0.97);
    expect(result!.volumeMl).toBeLessThan(expectedMl * 1.03);
  });

  it('reports the measured long axis rather than assuming one', () => {
    const result = singlePlaneVolume(ellipseContour(20, 50), ellipseAxis(50), unitSpacing);
    expect(result!.longAxisMm).toBeCloseTo(100);
  });

  it('scales cubically with spacing', () => {
    const contour = ellipseContour(20, 50);
    const axis = ellipseAxis(50);
    const fine = singlePlaneVolume(contour, axis, unitSpacing)!;
    const coarse = singlePlaneVolume(contour, axis, { rowSpacing: 2, columnSpacing: 2 })!;
    expect(coarse.volumeMl / fine.volumeMl).toBeCloseTo(8, 0);
  });

  it('returns null when the axis has no length', () => {
    const axis: LongAxis = { base: { x: 1, y: 1 }, apex: { x: 1, y: 1 } };
    expect(singlePlaneVolume(ellipseContour(20, 50), axis, unitSpacing)).toBeNull();
  });
});

describe('biplaneVolume', () => {
  it('matches single-plane when both views are identical', () => {
    const contour = ellipseContour(20, 50);
    const axis = ellipseAxis(50);
    const single = singlePlaneVolume(contour, axis, unitSpacing)!;
    const bi = biplaneVolume(
      { contour, axis, spacing: unitSpacing },
      { contour, axis, spacing: unitSpacing }
    )!;
    expect(bi.volumeMl).toBeCloseTo(single.volumeMl, 5);
  });

  it('uses each view independently when the ventricle is asymmetric', () => {
    // A ventricle 40 mm wide in A4C and 24 mm wide in A2C is not the same as
    // one that is 40 mm wide in both -- this is what biplane exists to capture.
    const wide = ellipseContour(20, 50);
    const narrow = ellipseContour(12, 50);
    const axis = ellipseAxis(50);

    const bi = biplaneVolume(
      { contour: wide, axis, spacing: unitSpacing },
      { contour: narrow, axis, spacing: unitSpacing }
    )!;
    const singleWide = singlePlaneVolume(wide, axis, unitSpacing)!;

    expect(bi.volumeMl).toBeLessThan(singleWide.volumeMl);
    // Elliptical disks: the result tracks the product of the two half-widths.
    expect(bi.volumeMl / singleWide.volumeMl).toBeCloseTo(12 / 20, 1);
  });

  it('uses the shorter long axis for disk height', () => {
    const contour = ellipseContour(20, 50);
    const bi = biplaneVolume(
      { contour, axis: ellipseAxis(50), spacing: unitSpacing },
      { contour, axis: { base: { x: 0, y: -40 }, apex: { x: 0, y: 40 } }, spacing: unitSpacing }
    )!;
    expect(bi.longAxisMm).toBeCloseTo(80);
    expect(bi.a4cLongAxisMm).toBeCloseTo(100);
    expect(bi.a2cLongAxisMm).toBeCloseTo(80);
  });

  it('reports the long-axis discrepancy between views', () => {
    const contour = ellipseContour(20, 50);
    const bi = biplaneVolume(
      { contour, axis: ellipseAxis(50), spacing: unitSpacing },
      { contour, axis: { base: { x: 0, y: -45 }, apex: { x: 0, y: 45 } }, spacing: unitSpacing }
    )!;
    expect(bi.longAxisDiscrepancy).toBeCloseTo(0.1, 2);
  });
});

describe('isForeshortened', () => {
  it('flags views whose long axes disagree beyond the threshold', () => {
    const contour = ellipseContour(20, 50);
    const mismatched = biplaneVolume(
      { contour, axis: ellipseAxis(50), spacing: unitSpacing },
      { contour, axis: { base: { x: 0, y: -35 }, apex: { x: 0, y: 35 } }, spacing: unitSpacing }
    )!;
    expect(isForeshortened(mismatched)).toBe(true);
  });

  it('accepts views that agree', () => {
    const contour = ellipseContour(20, 50);
    const matched = biplaneVolume(
      { contour, axis: ellipseAxis(50), spacing: unitSpacing },
      { contour, axis: { base: { x: 0, y: -48 }, apex: { x: 0, y: 48 } }, spacing: unitSpacing }
    )!;
    expect(isForeshortened(matched)).toBe(false);
  });
});

describe('ejectionFraction', () => {
  it('computes EF from volumes', () => {
    expect(ejectionFraction(120, 48)).toBeCloseTo(60);
  });

  it('rejects a non-positive EDV', () => {
    expect(ejectionFraction(0, 10)).toBeNull();
    expect(ejectionFraction(-5, 1)).toBeNull();
  });

  it('rejects an ESV larger than EDV', () => {
    expect(ejectionFraction(50, 60)).toBeNull();
  });

  it('differs from the area ratio it used to be computed from', () => {
    // The regression this replaces: EF taken from an area ratio reads low,
    // because volume scales with roughly area^1.5.
    const edArea = 2000;
    const esArea = 1200;
    const areaRatioEf = ((edArea - esArea) / edArea) * 100;

    const edVolume = Math.pow(edArea, 1.5);
    const esVolume = Math.pow(esArea, 1.5);
    const volumeEf = ejectionFraction(edVolume, esVolume)!;

    expect(areaRatioEf).toBeCloseTo(40, 0);
    expect(volumeEf).toBeGreaterThan(50);
    expect(volumeEf - areaRatioEf).toBeGreaterThan(10);
  });
});

describe('bodySurfaceArea', () => {
  it('matches the Du Bois value for a typical adult', () => {
    // 175 cm, 70 kg -> ~1.85 m^2
    expect(bodySurfaceArea(175, 70)).toBeCloseTo(1.85, 1);
  });

  it('rejects non-positive inputs', () => {
    expect(bodySurfaceArea(0, 70)).toBeNull();
    expect(bodySurfaceArea(175, 0)).toBeNull();
  });
});

describe('indexToBsa', () => {
  it('divides the volume by body surface area', () => {
    expect(indexToBsa(150, 1.9)).toBeCloseTo(78.9, 1);
  });

  it('returns null without a body surface area', () => {
    expect(indexToBsa(150, null)).toBeNull();
    expect(indexToBsa(150, 0)).toBeNull();
  });
});

describe('estimateLongAxisFromContour', () => {
  /** A tapered ventricle: wide at the base (y<0), narrowing to the apex (y>0). */
  function taperedContour(count = 120): Point2D[] {
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2;
      const y = Math.sin(angle) * 50;
      // Half-width falls from 22 mm at the base to 10 mm at the apex.
      const taper = 22 - ((y + 50) / 100) * 12;
      return { x: Math.cos(angle) * taper, y };
    });
  }

  it('finds an axis running the length of the ventricle', () => {
    const axis = estimateLongAxisFromContour(taperedContour())!;
    expect(axis).not.toBeNull();
    expect(longAxisLengthMm(axis, unitSpacing)).toBeGreaterThan(90);
  });

  it('puts the base at the wide end and the apex at the narrow end', () => {
    const axis = estimateLongAxisFromContour(taperedContour())!;
    expect(axis.base.y).toBeLessThan(0);
    expect(axis.apex.y).toBeGreaterThan(0);
  });

  it('follows a rotated ventricle', () => {
    const rotate = (p: Point2D, radians: number): Point2D => ({
      x: p.x * Math.cos(radians) - p.y * Math.sin(radians),
      y: p.x * Math.sin(radians) + p.y * Math.cos(radians),
    });
    const rotated = taperedContour().map((p) => rotate(p, Math.PI / 5));
    const axis = estimateLongAxisFromContour(rotated)!;
    expect(longAxisLengthMm(axis, unitSpacing)).toBeGreaterThan(90);
    // The apex should still sit at the narrow end after rotation.
    const expectedApex = rotate({ x: 0, y: 50 }, Math.PI / 5);
    expect(Math.hypot(axis.apex.x - expectedApex.x, axis.apex.y - expectedApex.y)).toBeLessThan(12);
  });

  it('gives a volume close to the analytic one for the shape it traced', () => {
    const contour = ellipseContour(20, 50);
    const estimated = estimateLongAxisFromContour(contour)!;
    const result = singlePlaneVolume(contour, estimated, unitSpacing)!;
    const expectedMl = ((4 / 3) * Math.PI * 20 * 20 * 50) / 1000;
    expect(result.volumeMl).toBeGreaterThan(expectedMl * 0.95);
    expect(result.volumeMl).toBeLessThan(expectedMl * 1.05);
  });

  it('returns null for a contour with too few points', () => {
    expect(estimateLongAxisFromContour([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
  });
});

describe('flipLongAxis', () => {
  it('swaps base and apex', () => {
    const axis = { base: { x: 0, y: 0 }, apex: { x: 0, y: 10 } };
    const flipped = flipLongAxis(axis);
    expect(flipped.base).toEqual(axis.apex);
    expect(flipped.apex).toEqual(axis.base);
  });
});
