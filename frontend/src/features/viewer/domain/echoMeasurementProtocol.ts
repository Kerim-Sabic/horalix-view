import { type EchoView, normalizeView } from '../services/viewGatingService';
import type { CardiacPhase, ClinicalMeasurementRole, Measurement, MeasurementType } from '../types';

export interface EchoMeasurementProtocol {
  role: ClinicalMeasurementRole;
  shortLabel: string;
  label: string;
  geometry: Extract<MeasurementType, 'line' | 'polygon'>;
  phase: CardiacPhase;
  allowedViews: EchoView[];
  instruction: string;
  tracked: boolean;
}

/**
 * Measurement protocols supported by calibrated 2D geometry in the viewer.
 * Doppler values are deliberately absent: their x/y axes are time and velocity,
 * not spatial millimetres, and require a separate ultrasound-region calibration.
 */
export const ECHO_MEASUREMENT_PROTOCOLS: readonly EchoMeasurementProtocol[] = [
  {
    role: 'lv_lvid_cycle',
    shortLabel: 'LVID cycle',
    label: 'LV internal diameter · tracked cardiac cycle',
    geometry: 'line',
    phase: 'cycle',
    allowedViews: ['Parasternal_Long'],
    instruction:
      'PLAX at the mitral leaflet tips, perpendicular to the LV long axis. Track one caliper pair through a complete beat; ED is the largest and ES the smallest valid dimension in that beat.',
    tracked: true,
  },
  {
    role: 'lv_lvid_ed',
    shortLabel: 'LVEDD',
    label: 'LV internal diameter · end-diastole',
    geometry: 'line',
    phase: 'end-diastole',
    allowedViews: ['Parasternal_Long'],
    instruction:
      'PLAX, perpendicular to the LV long axis at or immediately below the mitral leaflet tips; compacted myocardium–cavity interface.',
    tracked: true,
  },
  {
    role: 'lv_lvid_es',
    shortLabel: 'LVESD',
    label: 'LV internal diameter · end-systole',
    geometry: 'line',
    phase: 'end-systole',
    allowedViews: ['Parasternal_Long'],
    instruction:
      'Use the same PLAX level and orientation as LVEDD, at the smallest LV cavity dimension.',
    tracked: true,
  },
  {
    role: 'lv_ivs_ed',
    shortLabel: 'IVSd',
    label: 'Interventricular septum · end-diastole',
    geometry: 'line',
    phase: 'end-diastole',
    allowedViews: ['Parasternal_Long'],
    instruction: 'PLAX at the LV dimension level, perpendicular to the LV long axis.',
    tracked: false,
  },
  {
    role: 'lv_lvpw_ed',
    shortLabel: 'LVPWd',
    label: 'LV posterior wall · end-diastole',
    geometry: 'line',
    phase: 'end-diastole',
    allowedViews: ['Parasternal_Long'],
    instruction: 'PLAX at the LV dimension level, perpendicular to the LV long axis.',
    tracked: false,
  },
  {
    role: 'lv_endocardial_cycle',
    shortLabel: 'LV auto ED/ES',
    label: 'LV endocardial contour · tracked cardiac cycle',
    geometry: 'polygon',
    phase: 'cycle',
    allowedViews: ['A4C', 'A2C'],
    instruction:
      'Trace once from one mitral hinge through the compacted endocardial border and apex to the opposite hinge. The viewer tracks the contour through one beat and proposes the largest cavity as ED and the smallest as ES; verify both frames before reporting.',
    tracked: true,
  },
  {
    role: 'lv_endocardial_ed',
    shortLabel: 'LV ED contour',
    label: 'LV endocardial contour · end-diastole',
    geometry: 'polygon',
    phase: 'end-diastole',
    allowedViews: ['A4C', 'A2C'],
    instruction:
      'Start at one mitral hinge, trace the compacted endocardial border through the apex to the opposite hinge, then close across the annulus. Exclude papillary muscles from the cavity.',
    tracked: true,
  },
  {
    role: 'lv_endocardial_es',
    shortLabel: 'LV ES contour',
    label: 'LV endocardial contour · end-systole',
    geometry: 'polygon',
    phase: 'end-systole',
    allowedViews: ['A4C', 'A2C'],
    instruction:
      'Use the smallest LV cavity in the same beat; trace compacted endocardium from hinge to hinge through the apex and exclude papillary muscles.',
    tracked: true,
  },
  {
    role: 'lvot_diameter',
    shortLabel: 'LVOT diameter',
    label: 'LV outflow tract diameter · mid-systole',
    geometry: 'line',
    phase: 'mid-systole',
    allowedViews: ['Parasternal_Long'],
    instruction:
      'Inner edge to inner edge at the same anatomic level as the PW Doppler sample; record whether the annulus or 0.5–1.0 cm proximal level is used.',
    tracked: false,
  },
  {
    role: 'la_endocardial_es',
    shortLabel: 'LA ES contour',
    label: 'Left atrial endocardial contour · ventricular end-systole',
    geometry: 'polygon',
    phase: 'end-systole',
    allowedViews: ['A4C', 'A2C'],
    instruction:
      'Trace at maximum LA size; exclude pulmonary veins and the appendage. Use non-foreshortened LA-focused A4C/A2C views.',
    tracked: true,
  },
  {
    role: 'rv_endocardial_ed',
    shortLabel: 'RV ED contour',
    label: 'RV endocardial contour · end-diastole',
    geometry: 'polygon',
    phase: 'end-diastole',
    allowedViews: ['A4C'],
    instruction: 'Use an RV-focused A4C view and trace the RV endocardial border at end-diastole.',
    tracked: true,
  },
  {
    role: 'rv_endocardial_es',
    shortLabel: 'RV ES contour',
    label: 'RV endocardial contour · end-systole',
    geometry: 'polygon',
    phase: 'end-systole',
    allowedViews: ['A4C'],
    instruction: 'Use the same RV-focused A4C view and beat as the ED trace.',
    tracked: true,
  },
  {
    role: 'rv_base_ed',
    shortLabel: 'RV basal diameter',
    label: 'RV basal diameter · end-diastole',
    geometry: 'line',
    phase: 'end-diastole',
    allowedViews: ['A4C'],
    instruction: 'RV-focused A4C, maximal transverse basal dimension in end-diastole.',
    tracked: false,
  },
  {
    role: 'tapse',
    shortLabel: 'TAPSE',
    label: 'Tricuspid annular plane systolic excursion',
    geometry: 'line',
    phase: 'cycle',
    allowedViews: ['A4C'],
    instruction:
      'Measure longitudinal excursion of the lateral tricuspid annulus in an RV-focused A4C view.',
    tracked: true,
  },
  {
    role: 'aortic_root_diameter',
    shortLabel: 'Aortic root',
    label: 'Aortic root diameter',
    geometry: 'line',
    phase: 'end-diastole',
    allowedViews: ['Parasternal_Long'],
    instruction:
      'PLAX perpendicular to the long axis at the specified root level; use one lab convention consistently.',
    tracked: false,
  },
  {
    role: 'ivc_expiration',
    shortLabel: 'IVC expiration',
    label: 'IVC diameter · end-expiration',
    geometry: 'line',
    phase: 'cycle',
    allowedViews: ['Subcostal'],
    instruction: 'Subcostal long axis, 1–2 cm from the right atrial junction, at end-expiration.',
    tracked: true,
  },
  {
    role: 'ivc_inspiration',
    shortLabel: 'IVC inspiration',
    label: 'IVC diameter · inspiration/sniff',
    geometry: 'line',
    phase: 'cycle',
    allowedViews: ['Subcostal'],
    instruction: 'Same IVC level as expiration during inspiration or sniff.',
    tracked: true,
  },
] as const;

const BY_ROLE = new Map(ECHO_MEASUREMENT_PROTOCOLS.map((protocol) => [protocol.role, protocol]));

export function getEchoMeasurementProtocol(
  role: ClinicalMeasurementRole | null | undefined,
): EchoMeasurementProtocol | null {
  return role ? (BY_ROLE.get(role) ?? null) : null;
}

export function protocolsForMeasurement(measurement: Measurement): EchoMeasurementProtocol[] {
  return ECHO_MEASUREMENT_PROTOCOLS.filter((protocol) => protocol.geometry === measurement.type);
}

export interface ProtocolAssessment {
  compatible: boolean;
  warnings: string[];
}

export function assessMeasurementProtocol(measurement: Measurement): ProtocolAssessment {
  const protocol = getEchoMeasurementProtocol(measurement.clinicalRole);
  if (!protocol) {
    return {
      compatible: false,
      warnings: ['Assign a clinical role before using this measurement in a calculation.'],
    };
  }

  const warnings: string[] = [];
  if (measurement.type !== protocol.geometry) {
    warnings.push(`${protocol.shortLabel} requires ${protocol.geometry} geometry.`);
  }
  const view = normalizeView(measurement.sourceView);
  if (view === 'Unknown') {
    warnings.push('Source view is unconfirmed.');
  } else if (!protocol.allowedViews.includes(view)) {
    warnings.push(`${protocol.shortLabel} is not valid in ${view}.`);
  }
  if (measurement.cardiacPhase && measurement.cardiacPhase !== protocol.phase) {
    warnings.push(`Expected ${protocol.phase}; recorded ${measurement.cardiacPhase}.`);
  }
  if (measurement.reviewStatus === 'rejected') {
    warnings.push('The measurement was rejected during review.');
  }

  return { compatible: warnings.length === 0, warnings };
}
