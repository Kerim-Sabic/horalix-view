import type { CardiacPhase, MeasurementReviewStatus, Point2D } from '../types';
import type { Calibration } from './calibrationService';
import { normalizeView, VIEW_CONFIDENCE_THRESHOLD } from './viewGatingService';
import type { VolumeMethod } from './ventricleVolumeService';

export interface LvContourProtocolInput {
  id: string;
  points: Point2D[];
  calibration: Calibration;
  instanceUid: string | null;
  frameIndex: number | null;
  /** Selected beat bounds for tracked contours, e.g. "12:31". */
  beatKey: string | null;
  view: string | null;
  viewConfidence: number | null;
  phase: CardiacPhase | null;
  reviewStatus: MeasurementReviewStatus;
  /** Original contour that produced an automatically tracked phase. */
  sourceMeasurementId?: string;
  phaseSource?: 'manual' | 'ai' | 'tracked-auto';
  trackingQuality?: number | null;
  cycleLengthFrames?: number | null;
}

export interface LvVolumeSelectionSet {
  a4cEd: LvContourProtocolInput | null;
  a4cEs: LvContourProtocolInput | null;
  a2cEd: LvContourProtocolInput | null;
  a2cEs: LvContourProtocolInput | null;
}

export interface LvVolumeProtocolAssessment {
  blocking: string[];
  cautions: string[];
  complete: boolean;
}

const expectedPhase = (phase: 'ED' | 'ES'): CardiacPhase =>
  phase === 'ED' ? 'end-diastole' : 'end-systole';

function assessContour(
  contour: LvContourProtocolInput | null,
  label: string,
  expectedView: 'A4C' | 'A2C',
  phase: 'ED' | 'ES',
  blocking: string[],
  cautions: string[],
): void {
  if (!contour) {
    blocking.push(`${label} contour is missing.`);
    return;
  }
  if (contour.points.length < 8) blocking.push(`${label} contour needs at least 8 points.`);
  if (!contour.calibration.spacing) blocking.push(`${label} has no spatial calibration.`);

  const view = normalizeView(contour.view);
  if (view !== 'Unknown' && view !== expectedView) {
    blocking.push(`${label} is ${view}, not ${expectedView}.`);
  } else if (view === 'Unknown') {
    cautions.push(`${label} view is unclassified and must be confirmed by the operator.`);
  }

  const wantedPhase = expectedPhase(phase);
  if (contour.phase && contour.phase !== 'unspecified' && contour.phase !== wantedPhase) {
    blocking.push(`${label} is assigned to ${contour.phase}, not ${wantedPhase}.`);
  } else if (!contour.phase || contour.phase === 'unspecified') {
    cautions.push(`${label} phase is not explicitly recorded.`);
  }

  if (contour.viewConfidence !== null && contour.viewConfidence < VIEW_CONFIDENCE_THRESHOLD) {
    cautions.push(
      `${label} EchoPrime view confidence is ${(contour.viewConfidence * 100).toFixed(0)}%; confirm manually.`,
    );
  }
  if (contour.phaseSource === 'tracked-auto') {
    if (
      contour.trackingQuality !== null &&
      contour.trackingQuality !== undefined &&
      contour.trackingQuality < 0.8
    ) {
      cautions.push(
        `${label} contour tracking retained ${(contour.trackingQuality * 100).toFixed(0)}% valid frames; inspect the border through the selected beat.`,
      );
    }
    if (contour.cycleLengthFrames === null) {
      cautions.push(
        `${label} cardiac periodicity was not confidently detected; verify valve timing.`,
      );
    }
  }
}

function assessSameTrackedSource(
  ed: LvContourProtocolInput | null,
  es: LvContourProtocolInput | null,
  label: string,
  blocking: string[],
): void {
  if (!ed || !es) return;
  if (ed.phaseSource !== 'tracked-auto' && es.phaseSource !== 'tracked-auto') return;
  if (!ed.sourceMeasurementId || !es.sourceMeasurementId) {
    blocking.push(`${label} automatic ED and ES are missing their source contour.`);
    return;
  }
  if (ed.sourceMeasurementId !== es.sourceMeasurementId) {
    blocking.push(`${label} automatic ED and ES must come from the same tracked contour.`);
  }
}

export function assessLvVolumeProtocol(
  method: VolumeMethod,
  selections: LvVolumeSelectionSet,
  primaryView: 'A4C' | 'A2C' = 'A4C',
): LvVolumeProtocolAssessment {
  const blocking: string[] = [];
  const cautions: string[] = [];
  assessContour(selections.a4cEd, `${primaryView} ED`, primaryView, 'ED', blocking, cautions);
  assessContour(selections.a4cEs, `${primaryView} ES`, primaryView, 'ES', blocking, cautions);

  if (
    selections.a4cEd &&
    selections.a4cEs &&
    selections.a4cEd.instanceUid !== selections.a4cEs.instanceUid
  ) {
    blocking.push(`${primaryView} ED and ES must come from the same cine.`);
  }
  if (selections.a4cEd?.id === selections.a4cEs?.id && selections.a4cEd) {
    blocking.push(`${primaryView} ED and ES cannot be the same contour.`);
  }
  if (selections.a4cEd && selections.a4cEs) {
    assessSameTrackedSource(selections.a4cEd, selections.a4cEs, primaryView, blocking);
    if (
      selections.a4cEd.beatKey &&
      selections.a4cEs.beatKey &&
      selections.a4cEd.beatKey !== selections.a4cEs.beatKey
    ) {
      blocking.push(`${primaryView} ED and ES were selected from different tracked beats.`);
    } else if (!selections.a4cEd.beatKey || !selections.a4cEs.beatKey) {
      cautions.push(`${primaryView} same-beat selection must be confirmed manually.`);
    }
  }

  if (method === 'biplane') {
    assessContour(selections.a2cEd, 'A2C ED', 'A2C', 'ED', blocking, cautions);
    assessContour(selections.a2cEs, 'A2C ES', 'A2C', 'ES', blocking, cautions);
    if (
      selections.a2cEd &&
      selections.a2cEs &&
      selections.a2cEd.instanceUid !== selections.a2cEs.instanceUid
    ) {
      blocking.push('A2C ED and ES must come from the same cine.');
    }
    if (selections.a2cEd?.id === selections.a2cEs?.id && selections.a2cEd) {
      blocking.push('A2C ED and ES cannot be the same contour.');
    }
    if (selections.a2cEd && selections.a2cEs) {
      assessSameTrackedSource(selections.a2cEd, selections.a2cEs, 'A2C', blocking);
      if (
        selections.a2cEd.beatKey &&
        selections.a2cEs.beatKey &&
        selections.a2cEd.beatKey !== selections.a2cEs.beatKey
      ) {
        blocking.push('A2C ED and ES were selected from different tracked beats.');
      } else if (!selections.a2cEd.beatKey || !selections.a2cEs.beatKey) {
        cautions.push('A2C same-beat selection must be confirmed manually.');
      }
    }
    if (
      selections.a4cEd?.instanceUid &&
      selections.a2cEd?.instanceUid &&
      selections.a4cEd.instanceUid === selections.a2cEd.instanceUid
    ) {
      blocking.push('A4C and A2C must be different cines.');
    }
  }

  return { blocking, cautions, complete: blocking.length === 0 };
}

export function contourMatchesSlot(
  contour: LvContourProtocolInput,
  view: 'A4C' | 'A2C',
  phase: 'ED' | 'ES',
): boolean {
  const normalizedView = normalizeView(contour.view);
  const compatibleView = normalizedView === view || normalizedView === 'Unknown';
  const wantedPhase = expectedPhase(phase);
  const compatiblePhase =
    !contour.phase || contour.phase === 'unspecified' || contour.phase === wantedPhase;
  return compatibleView && compatiblePhase;
}
