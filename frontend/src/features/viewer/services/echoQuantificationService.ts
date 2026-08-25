import type { LineMeasurement, Measurement, TrackingData } from '../types';
import { isLineMeasurement } from '../types';
import { assessMeasurementProtocol } from '../domain/echoMeasurementProtocol';
import { analyseCardiacPhases } from './cardiacPhaseService';

export interface LvLinearQuantification {
  lvedd: LineMeasurement | null;
  lvesd: LineMeasurement | null;
  ivsd: LineMeasurement | null;
  lvpwd: LineMeasurement | null;
  fractionalShorteningPercent: number | null;
  lvMassGrams: number | null;
  relativeWallThickness: number | null;
  lveddMm: number | null;
  lvesdMm: number | null;
  lvidSource: 'paired-calipers' | 'tracked-cycle' | null;
  phaseFrames: { ed: number; es: number } | null;
  warnings: string[];
}

const lineForRole = (
  measurements: Measurement[],
  role: LineMeasurement['clinicalRole'],
): LineMeasurement | null => {
  const candidates = measurements.filter(
    (measurement): measurement is LineMeasurement =>
      isLineMeasurement(measurement) &&
      measurement.clinicalRole === role &&
      measurement.reviewStatus !== 'rejected' &&
      assessMeasurementProtocol(measurement).compatible,
  );
  return candidates.sort((a, b) => b.modifiedAt - a.modifiedAt)[0] ?? null;
};

const usableLength = (measurement: LineMeasurement | null): number | null => {
  if (measurement?.reviewStatus !== 'accepted' && measurement?.reviewStatus !== 'modified') {
    return null;
  }
  const value = measurement?.lengthMm;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
};

const sameAcquisition = (measurements: Array<LineMeasurement | null>): boolean => {
  const present = measurements.filter((value): value is LineMeasurement => value !== null);
  if (present.length < 2) return true;
  const instanceUids = new Set(present.map((value) => value.instanceUid).filter(Boolean));
  return instanceUids.size <= 1 && new Set(present.map((value) => value.seriesUid)).size === 1;
};

/**
 * Derive only from explicitly assigned clinical roles. There is intentionally
 * no "only line on screen" or fuzzy-label fallback.
 */
export function deriveLvLinearQuantification(
  measurements: Measurement[],
  trackingById?: ReadonlyMap<string, TrackingData>,
): LvLinearQuantification {
  const lveddCaliper = lineForRole(measurements, 'lv_lvid_ed');
  const lvesdCaliper = lineForRole(measurements, 'lv_lvid_es');
  const cycleLvid = lineForRole(measurements, 'lv_lvid_cycle');
  let lvedd = lveddCaliper ?? cycleLvid;
  let lvesd = lvesdCaliper ?? cycleLvid;
  const ivsd = lineForRole(measurements, 'lv_ivs_ed');
  const lvpwd = lineForRole(measurements, 'lv_lvpw_ed');
  const warnings: string[] = [];

  let eddMm = usableLength(lveddCaliper);
  let esdMm = usableLength(lvesdCaliper);
  let lvidSource: LvLinearQuantification['lvidSource'] =
    eddMm !== null && esdMm !== null ? 'paired-calipers' : null;
  let phaseFrames: LvLinearQuantification['phaseFrames'] = null;

  if ((eddMm === null || esdMm === null) && cycleLvid) {
    const track = trackingById?.get(cycleLvid.id) ?? cycleLvid.trackingData;
    const cycleReviewed =
      cycleLvid.reviewStatus === 'accepted' || cycleLvid.reviewStatus === 'modified';
    if (track && cycleReviewed) {
      const analysis = analyseCardiacPhases(
        track.frames.map((frame) => ({
          frameIndex: frame.frameIndex,
          value: frame.lengthMm ?? NaN,
          valid: frame.valid,
        })),
      );
      const beat = analysis.selectedBeat;
      const edFrame = beat ? track.frames.find((frame) => frame.frameIndex === beat.edFrame) : null;
      const esFrame = beat ? track.frames.find((frame) => frame.frameIndex === beat.esFrame) : null;
      if (edFrame?.lengthMm && esFrame?.lengthMm) {
        eddMm = edFrame.lengthMm;
        esdMm = esFrame.lengthMm;
        lvedd = cycleLvid;
        lvesd = cycleLvid;
        lvidSource = 'tracked-cycle';
        phaseFrames = { ed: edFrame.frameIndex, es: esFrame.frameIndex };
      }
    }
  }
  let fractionalShorteningPercent: number | null = null;
  if (eddMm !== null && esdMm !== null) {
    if (lvedd?.id !== lvesd?.id && !sameAcquisition([lvedd, lvesd])) {
      warnings.push('LVEDD and LVESD must come from the same PLAX cine and measurement level.');
    } else if (esdMm >= eddMm) {
      warnings.push('LVESD is not smaller than LVEDD; confirm phases and caliper placement.');
    } else {
      fractionalShorteningPercent = ((eddMm - esdMm) / eddMm) * 100;
    }
  }

  const ivsMm = usableLength(ivsd);
  const lvpwMm = usableLength(lvpwd);
  let lvMassGrams: number | null = null;
  let relativeWallThickness: number | null = null;
  if (eddMm !== null && ivsMm !== null && lvpwMm !== null) {
    if (!sameAcquisition([lvedd, ivsd, lvpwd])) {
      warnings.push('LVIDd, IVSd, and LVPWd must be measured at the same PLAX level.');
    } else {
      const lvidCm = eddMm / 10;
      const ivsCm = ivsMm / 10;
      const lvpwCm = lvpwMm / 10;
      lvMassGrams = 0.8 * 1.04 * (Math.pow(lvidCm + ivsCm + lvpwCm, 3) - Math.pow(lvidCm, 3)) + 0.6;
      relativeWallThickness = (2 * lvpwMm) / eddMm;
    }
  }

  return {
    lvedd,
    lvesd,
    ivsd,
    lvpwd,
    fractionalShorteningPercent,
    lvMassGrams,
    relativeWallThickness,
    lveddMm: eddMm,
    lvesdMm: esdMm,
    lvidSource,
    phaseFrames,
    warnings,
  };
}

export interface LvotHemodynamics {
  diameterMm: number;
  areaCm2: number;
  vtiCm: number;
  strokeVolumeMl: number;
  heartRateBpm: number | null;
  cardiacOutputLMin: number | null;
  strokeVolumeIndexMlM2: number | null;
  cardiacIndexLMinM2: number | null;
}

/** Calculate LVOT flow from a spatial diameter and manually verified PW VTI. */
export function calculateLvotHemodynamics(
  diameterMm: number,
  vtiCm: number,
  heartRateBpm: number | null = null,
  bsaM2: number | null = null,
): LvotHemodynamics | null {
  if (!(diameterMm > 0) || !(vtiCm > 0)) return null;
  if (heartRateBpm !== null && !(heartRateBpm > 0)) return null;
  if (bsaM2 !== null && !(bsaM2 > 0)) return null;

  const diameterCm = diameterMm / 10;
  const areaCm2 = (Math.PI * diameterCm * diameterCm) / 4;
  const strokeVolumeMl = areaCm2 * vtiCm;
  const cardiacOutputLMin = heartRateBpm === null ? null : (strokeVolumeMl * heartRateBpm) / 1000;

  return {
    diameterMm,
    areaCm2,
    vtiCm,
    strokeVolumeMl,
    heartRateBpm,
    cardiacOutputLMin,
    strokeVolumeIndexMlM2: bsaM2 === null ? null : strokeVolumeMl / bsaM2,
    cardiacIndexLMinM2:
      bsaM2 === null || cardiacOutputLMin === null ? null : cardiacOutputLMin / bsaM2,
  };
}

export function findLvotDiameter(measurements: Measurement[]): LineMeasurement | null {
  return lineForRole(measurements, 'lvot_diameter');
}
