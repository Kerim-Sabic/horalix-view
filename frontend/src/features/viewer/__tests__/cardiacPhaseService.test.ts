import { describe, expect, it } from 'vitest';

import {
  analyseCardiacPhases,
  estimateCycleLength,
  matchBeatToReference,
} from '../services/cardiacPhaseService';
import type { PhaseSample } from '../services/cardiacPhaseService';

/**
 * A synthetic area curve: `beats` cycles of `framesPerBeat` frames, with the
 * area peaking at end-diastole and troughing at end-systole.
 */
function areaCurve(
  beats: number,
  framesPerBeat: number,
  { amplitude = 400, baseline = 1600, scale = 1 } = {}
): PhaseSample[] {
  const total = beats * framesPerBeat;
  return Array.from({ length: total }, (_, i) => {
    const phase = (i / framesPerBeat) * Math.PI * 2;
    return {
      frameIndex: i,
      value: (baseline + Math.cos(phase) * amplitude) * scale,
    };
  });
}

describe('estimateCycleLength', () => {
  it('recovers the period of a repeating curve', () => {
    const values = areaCurve(3, 20).map((s) => s.value);
    const cycle = estimateCycleLength(values);
    expect(cycle).not.toBeNull();
    expect(Math.abs(cycle! - 20)).toBeLessThanOrEqual(2);
  });

  it('returns null for a curve with no cycle', () => {
    const flat = Array.from({ length: 40 }, () => 1000);
    expect(estimateCycleLength(flat)).toBeNull();
  });

  it('returns null for a clip too short to hold a beat', () => {
    expect(estimateCycleLength([1, 2, 3, 4])).toBeNull();
  });
});

describe('analyseCardiacPhases', () => {
  it('finds multiple beats in a multi-beat clip', () => {
    const analysis = analyseCardiacPhases(areaCurve(3, 20));
    expect(analysis.multipleBeats).toBe(true);
    expect(analysis.beats.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps ED and ES within the same beat', () => {
    // The bug this replaces: a global max/min could pair the ED of one beat
    // with the ES of another.
    const analysis = analyseCardiacPhases(areaCurve(3, 20));
    for (const beat of analysis.beats) {
      const edWithin = beat.edFrame >= analysis.beats[0].startIndex;
      expect(edWithin).toBe(true);
      expect(Math.abs(beat.edFrame - beat.esFrame)).toBeLessThan(20);
    }
  });

  it('reports ED above ES', () => {
    const analysis = analyseCardiacPhases(areaCurve(3, 20));
    expect(analysis.selectedBeat).not.toBeNull();
    expect(analysis.selectedBeat!.edValue).toBeGreaterThan(analysis.selectedBeat!.esValue);
  });

  it('prefers the beat tracking considered reliable', () => {
    const samples = areaCurve(3, 20);
    // Mark the first third as badly tracked.
    const degraded = samples.map((s, i) => ({ ...s, valid: i >= 20 }));
    const analysis = analyseCardiacPhases(degraded);
    expect(analysis.selectedBeat).not.toBeNull();
    expect(analysis.selectedBeat!.quality).toBeGreaterThan(0.5);
  });

  it('treats a sub-cycle clip as one beat', () => {
    const short: PhaseSample[] = [
      { frameIndex: 0, value: 2000 },
      { frameIndex: 1, value: 1800 },
      { frameIndex: 2, value: 1600 },
    ];
    const analysis = analyseCardiacPhases(short);
    expect(analysis.multipleBeats).toBe(false);
    expect(analysis.selectedBeat!.edFrame).toBe(0);
    expect(analysis.selectedBeat!.esFrame).toBe(2);
  });

  it('handles an empty curve', () => {
    const analysis = analyseCardiacPhases([]);
    expect(analysis.beats).toEqual([]);
    expect(analysis.selectedBeat).toBeNull();
  });

  it('sorts samples arriving out of order', () => {
    const shuffled: PhaseSample[] = [
      { frameIndex: 2, value: 1600 },
      { frameIndex: 0, value: 2000 },
      { frameIndex: 1, value: 1800 },
    ];
    const analysis = analyseCardiacPhases(shuffled);
    expect(analysis.selectedBeat!.edFrame).toBe(0);
  });

  it('computes fractional change over the selected beat', () => {
    const analysis = analyseCardiacPhases(areaCurve(3, 20, { baseline: 2000, amplitude: 500 }));
    // (2500 - 1500) / 2500 = 0.4
    expect(analysis.selectedBeat!.fractionalChange).toBeGreaterThan(0.3);
    expect(analysis.selectedBeat!.fractionalChange).toBeLessThan(0.5);
  });
});

describe('matchBeatToReference', () => {
  it('picks the beat whose excursion matches the reference', () => {
    const reference = analyseCardiacPhases(areaCurve(3, 20)).selectedBeat!;
    // A second view of the same heart, at a different scale and frame count.
    const other = analyseCardiacPhases(areaCurve(3, 24, { scale: 1.3 }));
    const matched = matchBeatToReference(other, reference);
    expect(matched).not.toBeNull();
    expect(Math.abs(matched!.fractionalChange - reference.fractionalChange)).toBeLessThan(0.15);
  });

  it('returns null when the other view has no beats', () => {
    const reference = analyseCardiacPhases(areaCurve(3, 20)).selectedBeat!;
    const empty = analyseCardiacPhases([]);
    expect(matchBeatToReference(empty, reference)).toBeNull();
  });
});
