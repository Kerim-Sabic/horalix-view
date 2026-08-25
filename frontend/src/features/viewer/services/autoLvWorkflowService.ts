import type { CardiacPhase, MeasurementReviewStatus, Point2D } from '../types';
import type { Calibration } from './calibrationService';
import { normalizeView } from './viewGatingService';
import {
  buildLongAxis,
  estimateLongAxisFromContour,
  singlePlaneVolume,
} from './ventricleVolumeService';

export type LvAutoView = 'A4C' | 'A2C';

export interface AutoLvContourInput {
  id: string;
  sourceMeasurementId: string;
  points: Point2D[];
  calibration: Calibration;
  instanceUid: string | null;
  frameIndex: number | null;
  beatKey: string | null;
  view: string | null;
  viewConfidence: number | null;
  phase: CardiacPhase | null;
  reviewStatus: MeasurementReviewStatus;
  phaseSource: 'manual' | 'ai' | 'tracked-auto';
  trackingQuality: number | null;
  trackedBeatCount: number | null;
  cycleLengthFrames: number | null;
}

export interface AutoLvPhasePair {
  view: LvAutoView;
  sourceMeasurementId: string;
  beatKey: string;
  ed: AutoLvContourInput;
  es: AutoLvContourInput;
}

export interface AutoLvPhaseSelection {
  a4c: AutoLvPhasePair | null;
  a2c: AutoLvPhasePair | null;
}

export type AutoLvViewState =
  | { status: 'needs-trace'; view: LvAutoView }
  | { status: 'tracking'; view: LvAutoView; sourceMeasurementId: string }
  | { status: 'ready'; view: LvAutoView; pair: AutoLvPhasePair };

interface PairCandidate {
  ed?: AutoLvContourInput;
  es?: AutoLvContourInput;
}

/**
 * Use a Simpson single-plane volume as the phase curve when calibration and a
 * usable long axis are present. Area remains an explicit fallback for older or
 * uncalibrated tracking data; the caller can then block volume reporting while
 * still offering timing for review.
 */
export function trackedLvPhaseValue(
  points: Point2D[],
  calibration: Calibration,
  fallbackAreaMm2: number | null | undefined,
  hasAnnulusEndpoints = true,
): number {
  if (points.length >= 8 && calibration.spacing) {
    const first = points[0];
    const last = points[points.length - 1];
    const distinctEndpoints = Math.hypot(last.x - first.x, last.y - first.y) > 2;
    const axis =
      hasAnnulusEndpoints && distinctEndpoints
        ? buildLongAxis(points, first, last)
        : estimateLongAxisFromContour(points);
    if (axis) {
      const result = singlePlaneVolume(points, axis, calibration.spacing);
      if (result && Number.isFinite(result.volumeMl) && result.volumeMl > 0) {
        return result.volumeMl;
      }
    }
  }

  return fallbackAreaMm2 ?? NaN;
}

function pairScore(pair: AutoLvPhasePair): number {
  const calibrationScore = pair.ed.calibration.spacing && pair.es.calibration.spacing ? 30 : 0;
  const trackingScore = Math.min(pair.ed.trackingQuality ?? 0, pair.es.trackingQuality ?? 0) * 40;
  const viewScore = Math.min(pair.ed.viewConfidence ?? 0, pair.es.viewConfidence ?? 0) * 20;
  const contourScore = (Math.min(pair.ed.points.length, pair.es.points.length, 32) / 32) * 10;
  return calibrationScore + trackingScore + viewScore + contourScore;
}

function bestPairForView(contours: AutoLvContourInput[], view: LvAutoView): AutoLvPhasePair | null {
  const grouped = new Map<string, PairCandidate>();

  for (const contour of contours) {
    if (contour.phaseSource !== 'tracked-auto') continue;
    if (normalizeView(contour.view) !== view) continue;
    if (!contour.instanceUid || !contour.beatKey || contour.frameIndex === null) continue;
    if (contour.points.length < 8) continue;
    if (contour.phase !== 'end-diastole' && contour.phase !== 'end-systole') continue;

    const key = [contour.sourceMeasurementId, contour.instanceUid, contour.beatKey].join('|');
    const candidate = grouped.get(key) ?? {};
    if (contour.phase === 'end-diastole') candidate.ed = contour;
    if (contour.phase === 'end-systole') candidate.es = contour;
    grouped.set(key, candidate);
  }

  const pairs: AutoLvPhasePair[] = [];
  for (const candidate of grouped.values()) {
    if (!candidate.ed || !candidate.es) continue;
    if (candidate.ed.frameIndex === candidate.es.frameIndex) continue;
    pairs.push({
      view,
      sourceMeasurementId: candidate.ed.sourceMeasurementId,
      beatKey: candidate.ed.beatKey!,
      ed: candidate.ed,
      es: candidate.es,
    });
  }

  return pairs.sort((a, b) => pairScore(b) - pairScore(a))[0] ?? null;
}

/**
 * Select complete ED/ES pairs without ever mixing contours from different
 * tracking runs or beats. Calibration, tracking validity, and EchoPrime
 * confidence only rank complete pairs; they never manufacture a missing phase.
 */
export function selectBestAutoLvPhases(contours: AutoLvContourInput[]): AutoLvPhaseSelection {
  return {
    a4c: bestPairForView(contours, 'A4C'),
    a2c: bestPairForView(contours, 'A2C'),
  };
}

export function getAutoLvViewState(
  contours: AutoLvContourInput[],
  view: LvAutoView,
  trackingMeasurementId: string | null,
): AutoLvViewState {
  const pair = bestPairForView(contours, view);
  if (pair) return { status: 'ready', view, pair };

  if (
    trackingMeasurementId &&
    contours.some(
      (contour) =>
        contour.sourceMeasurementId === trackingMeasurementId &&
        contour.phase === 'cycle' &&
        normalizeView(contour.view) === view,
    )
  ) {
    return { status: 'tracking', view, sourceMeasurementId: trackingMeasurementId };
  }

  return { status: 'needs-trace', view };
}
