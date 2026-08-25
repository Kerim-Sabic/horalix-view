/**
 * Cardiac phase detection from a tracked area curve
 *
 * A cine usually holds two or three beats. Taking the global maximum and
 * minimum of the area curve can therefore pair the end-diastole of one beat
 * with the end-systole of another, and a single ectopic or badly tracked beat
 * captures both. Volumes and EF must come from within one beat.
 *
 * Beats are found by autocorrelating the area curve, which needs no ECG and
 * works on any tracked structure. When the clip carries an R-wave time vector
 * the caller should prefer it and pass the boundaries in directly.
 */

export interface PhaseSample {
  frameIndex: number;
  /** Tracked area (or length) at this frame. */
  value: number;
  /** False when tracking flagged the frame as unreliable. */
  valid?: boolean;
}

export interface Beat {
  /** Index into the sample array, inclusive. */
  startIndex: number;
  /** Index into the sample array, inclusive. */
  endIndex: number;
  /** Frame with the largest area in this beat. */
  edFrame: number;
  /** Frame with the smallest area in this beat. */
  esFrame: number;
  edValue: number;
  esValue: number;
  /** Fraction of samples in this beat that tracking considered valid. */
  quality: number;
  /** (ED - ES) / ED, the fractional change over this beat. */
  fractionalChange: number;
}

export interface PhaseAnalysis {
  beats: Beat[];
  /** The beat to report from: the highest-quality one. */
  selectedBeat: Beat | null;
  /** Estimated beat length in frames, or null when no cycle was detected. */
  cycleLengthFrames: number | null;
  /** True when more than one beat was found in the clip. */
  multipleBeats: boolean;
}

const MIN_CYCLE_FRAMES = 6;

/**
 * Estimate the dominant cycle length by autocorrelation.
 *
 * Returns null when no lag stands out, which is the honest answer for a clip
 * holding less than one full beat.
 */
export function estimateCycleLength(values: number[]): number | null {
  const count = values.length;
  if (count < MIN_CYCLE_FRAMES * 2) return null;

  const mean = values.reduce((a, b) => a + b, 0) / count;
  const centred = values.map((v) => v - mean);
  const energy = centred.reduce((sum, v) => sum + v * v, 0);
  if (energy === 0) return null;

  const maxLag = Math.floor(count / 2);
  let bestLag: number | null = null;
  let bestScore = 0;

  for (let lag = MIN_CYCLE_FRAMES; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = 0; i + lag < count; i += 1) {
      sum += centred[i] * centred[i + lag];
    }
    const score = sum / energy;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  // A weak peak means the curve is noise rather than a repeating cycle.
  return bestScore > 0.3 ? bestLag : null;
}

/**
 * Split the samples into beats, each running from one area maximum to the next.
 *
 * Diastolic peaks are used as the boundary because end-diastole is the more
 * reproducible landmark on an area curve — the peak is broader and less
 * sensitive to a single mistracked frame than the systolic trough.
 */
function findBeatBoundaries(values: number[], cycleLength: number): number[] {
  const boundaries: number[] = [];
  const window = Math.max(2, Math.floor(cycleLength * 0.35));

  for (let i = 0; i < values.length; i += 1) {
    const from = Math.max(0, i - window);
    const to = Math.min(values.length - 1, i + window);
    let isPeak = true;
    for (let j = from; j <= to; j += 1) {
      if (values[j] > values[i]) {
        isPeak = false;
        break;
      }
    }
    // Keep the first index of a flat-topped peak rather than every index in it.
    if (isPeak && (boundaries.length === 0 || i - boundaries[boundaries.length - 1] >= window)) {
      boundaries.push(i);
    }
  }

  return boundaries;
}

function buildBeat(samples: PhaseSample[], startIndex: number, endIndex: number): Beat | null {
  if (endIndex <= startIndex) return null;

  let edIdx = startIndex;
  let esIdx = startIndex;
  let validCount = 0;

  for (let i = startIndex; i <= endIndex; i += 1) {
    if (samples[i].value > samples[edIdx].value) edIdx = i;
    if (samples[i].value < samples[esIdx].value) esIdx = i;
    if (samples[i].valid !== false) validCount += 1;
  }

  const edValue = samples[edIdx].value;
  const esValue = samples[esIdx].value;

  return {
    startIndex,
    endIndex,
    edFrame: samples[edIdx].frameIndex,
    esFrame: samples[esIdx].frameIndex,
    edValue,
    esValue,
    quality: validCount / (endIndex - startIndex + 1),
    fractionalChange: edValue > 0 ? (edValue - esValue) / edValue : 0,
  };
}

/**
 * Score a beat for reporting.
 *
 * Tracking validity dominates, with a mild preference for longer beats since a
 * clipped partial beat at either end of the clip has a truncated excursion.
 */
function scoreBeat(beat: Beat, totalSamples: number): number {
  const span = (beat.endIndex - beat.startIndex + 1) / Math.max(1, totalSamples);
  return beat.quality * 0.8 + span * 0.2;
}

/**
 * Find the beats in a tracked curve and pick the one worth reporting.
 *
 * Falls back to treating the whole clip as one beat when no cycle is detected,
 * which is the correct behaviour for a clip shorter than a cardiac cycle.
 */
export function analyseCardiacPhases(samples: PhaseSample[]): PhaseAnalysis {
  const sorted = [...samples].sort((a, b) => a.frameIndex - b.frameIndex);
  const usable = sorted.filter((s) => Number.isFinite(s.value));

  if (usable.length === 0) {
    return { beats: [], selectedBeat: null, cycleLengthFrames: null, multipleBeats: false };
  }

  if (usable.length < MIN_CYCLE_FRAMES) {
    const beat = buildBeat(usable, 0, usable.length - 1);
    return {
      beats: beat ? [beat] : [],
      selectedBeat: beat,
      cycleLengthFrames: null,
      multipleBeats: false,
    };
  }

  const values = usable.map((s) => s.value);
  const cycleLength = estimateCycleLength(values);

  if (cycleLength === null) {
    const beat = buildBeat(usable, 0, usable.length - 1);
    return {
      beats: beat ? [beat] : [],
      selectedBeat: beat,
      cycleLengthFrames: null,
      multipleBeats: false,
    };
  }

  const boundaries = findBeatBoundaries(values, cycleLength);
  const beats: Beat[] = [];

  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const beat = buildBeat(usable, boundaries[i], boundaries[i + 1]);
    if (beat) beats.push(beat);
  }

  if (beats.length === 0) {
    const beat = buildBeat(usable, 0, usable.length - 1);
    return {
      beats: beat ? [beat] : [],
      selectedBeat: beat,
      cycleLengthFrames: cycleLength,
      multipleBeats: false,
    };
  }

  const selectedBeat = beats.reduce((best, beat) =>
    scoreBeat(beat, usable.length) > scoreBeat(best, usable.length) ? beat : best
  );

  return {
    beats,
    selectedBeat,
    cycleLengthFrames: cycleLength,
    multipleBeats: beats.length > 1,
  };
}

/**
 * Match a phase in a second view to the beat selected in the first.
 *
 * Biplane volumes are only meaningful if the A4C and A2C traces are measured at
 * the same cardiac event, so the second view's beat is chosen by how closely its
 * fractional change matches the reference beat rather than by frame number,
 * which two clips do not share.
 */
export function matchBeatToReference(
  analysis: PhaseAnalysis,
  reference: Beat
): Beat | null {
  if (analysis.beats.length === 0) return null;
  return analysis.beats.reduce((best, beat) => {
    const bestDelta = Math.abs(best.fractionalChange - reference.fractionalChange);
    const delta = Math.abs(beat.fractionalChange - reference.fractionalChange);
    return delta < bestDelta ? beat : best;
  });
}
