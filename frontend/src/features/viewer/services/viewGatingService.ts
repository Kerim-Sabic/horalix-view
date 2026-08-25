/**
 * View gating for ventricular volumes
 *
 * EchoPrime classifies every cine into one of eleven views. Simpson's method is
 * only valid on an apical view that shows the full LV length, so the classifier
 * decides which volume mode the viewer offers.
 *
 * The gate is deliberately conservative: below the confidence threshold nothing
 * is offered automatically and the operator states the view themselves, which
 * is then recorded on the measurement as a manual attribution.
 */

/** Canonical EchoPrime view labels. Mirrors backend utils/view_gating.py. */
export type EchoView =
  | 'A2C'
  | 'A3C'
  | 'A4C'
  | 'A5C'
  | 'Apical_Doppler'
  | 'Doppler_Parasternal_Long'
  | 'Doppler_Parasternal_Short'
  | 'Parasternal_Long'
  | 'Parasternal_Short'
  | 'SSN'
  | 'Subcostal'
  | 'Unknown';

/** Matches VIEW_CONFIDENCE_THRESHOLD in the backend gating module. */
export const VIEW_CONFIDENCE_THRESHOLD = 0.7;

const VIEW_ALIASES: Record<string, EchoView> = {
  plax: 'Parasternal_Long',
  'parasternal long': 'Parasternal_Long',
  psax: 'Parasternal_Short',
  'parasternal short': 'Parasternal_Short',
  psax_av: 'Parasternal_Short',
  psax_mv: 'Parasternal_Short',
  psax_pm: 'Parasternal_Short',
  psax_ap: 'Parasternal_Short',
  a2c: 'A2C',
  a3c: 'A3C',
  a4c: 'A4C',
  a5c: 'A5C',
  rv_inflow: 'A4C',
  rv_outflow: 'Parasternal_Short',
  suprasternal: 'SSN',
  ssn: 'SSN',
  subcostal: 'Subcostal',
};

const CANONICAL: EchoView[] = [
  'A2C',
  'A3C',
  'A4C',
  'A5C',
  'Apical_Doppler',
  'Doppler_Parasternal_Long',
  'Doppler_Parasternal_Short',
  'Parasternal_Long',
  'Parasternal_Short',
  'SSN',
  'Subcostal',
];

export function normalizeView(label: string | null | undefined): EchoView {
  if (!label) return 'Unknown';
  const trimmed = label.trim();
  const exact = CANONICAL.find((view) => view === trimmed);
  if (exact) return exact;
  return VIEW_ALIASES[trimmed.toLowerCase()] ?? 'Unknown';
}

export type VolumeSupport = 'preferred' | 'allowed' | 'discouraged' | 'unsupported';

export interface ViewCapability {
  view: EchoView;
  /** Whether a single-plane Simpson's trace is meaningful in this view. */
  singlePlane: VolumeSupport;
  /** Whether this view can take part in a biplane pair. */
  biplane: VolumeSupport;
  /** The view this one pairs with for biplane, if any. */
  pairsWith: EchoView | null;
  /** Shown to the operator when the mode is discouraged or unsupported. */
  note: string | null;
}

const CAPABILITIES: Record<EchoView, ViewCapability> = {
  A4C: {
    view: 'A4C',
    singlePlane: 'allowed',
    biplane: 'preferred',
    pairsWith: 'A2C',
    note: null,
  },
  A2C: {
    view: 'A2C',
    singlePlane: 'allowed',
    biplane: 'preferred',
    pairsWith: 'A4C',
    note: null,
  },
  A3C: {
    view: 'A3C',
    singlePlane: 'discouraged',
    biplane: 'unsupported',
    pairsWith: null,
    note: 'The apical 3-chamber view foreshortens the LV. Volumes from it read low.',
  },
  A5C: {
    view: 'A5C',
    singlePlane: 'unsupported',
    biplane: 'unsupported',
    pairsWith: null,
    note: 'The apical 5-chamber view has the LVOT in plane, so the traced cavity is not the full LV.',
  },
  Parasternal_Long: {
    view: 'Parasternal_Long',
    singlePlane: 'unsupported',
    biplane: 'unsupported',
    pairsWith: null,
    note: 'Parasternal long axis supports linear measurements and fractional shortening, not disk summation.',
  },
  Parasternal_Short: {
    view: 'Parasternal_Short',
    singlePlane: 'unsupported',
    biplane: 'unsupported',
    pairsWith: null,
    note: 'Short axis shows a cross-section, not the long axis a disk stack needs.',
  },
  Subcostal: {
    view: 'Subcostal',
    singlePlane: 'unsupported',
    biplane: 'unsupported',
    pairsWith: null,
    note: 'Subcostal views are not validated for Simpson’s volumes.',
  },
  SSN: {
    view: 'SSN',
    singlePlane: 'unsupported',
    biplane: 'unsupported',
    pairsWith: null,
    note: 'The suprasternal view does not show the left ventricle.',
  },
  Apical_Doppler: {
    view: 'Apical_Doppler',
    singlePlane: 'unsupported',
    biplane: 'unsupported',
    pairsWith: null,
    note: 'Doppler views have their own measurement set.',
  },
  Doppler_Parasternal_Long: {
    view: 'Doppler_Parasternal_Long',
    singlePlane: 'unsupported',
    biplane: 'unsupported',
    pairsWith: null,
    note: 'Doppler views have their own measurement set.',
  },
  Doppler_Parasternal_Short: {
    view: 'Doppler_Parasternal_Short',
    singlePlane: 'unsupported',
    biplane: 'unsupported',
    pairsWith: null,
    note: 'Doppler views have their own measurement set.',
  },
  Unknown: {
    view: 'Unknown',
    singlePlane: 'allowed',
    biplane: 'allowed',
    pairsWith: null,
    note: 'View not classified. Confirm the view before reporting a volume.',
  },
};

export function getViewCapability(label: string | null | undefined): ViewCapability {
  return CAPABILITIES[normalizeView(label)];
}

export interface GateInput {
  view: string | null | undefined;
  confidence?: number | null;
  /** False when the image carries no spatial calibration. */
  calibrated: boolean;
}

export interface GateResult {
  view: EchoView;
  /** Whether the volume tools should be offered at all. */
  allowed: boolean;
  /** Whether the classification is trusted enough to act on automatically. */
  confident: boolean;
  capability: ViewCapability;
  /** Why the tools are unavailable, or a caution to show alongside them. */
  reason: string | null;
}

/**
 * Decide whether volume tools apply to a cine.
 *
 * Calibration is checked first: without millimetres per pixel there is no
 * volume to compute, regardless of the view.
 */
export function gateVolumeTools({ view, confidence, calibrated }: GateInput): GateResult {
  const capability = getViewCapability(view);
  const normalized = capability.view;
  const confident =
    typeof confidence === 'number' ? confidence >= VIEW_CONFIDENCE_THRESHOLD : false;

  if (!calibrated) {
    return {
      view: normalized,
      allowed: false,
      confident,
      capability,
      reason:
        'This image carries no spatial calibration, so a volume cannot be computed from it.',
    };
  }

  if (capability.singlePlane === 'unsupported' && capability.biplane === 'unsupported') {
    return {
      view: normalized,
      allowed: false,
      confident,
      capability,
      reason: capability.note,
    };
  }

  // A confident classification into a non-apical view is a positive signal that
  // the tools do not apply; a low-confidence one is merely an absence of
  // evidence, so the operator decides.
  if (!confident && normalized !== 'Unknown') {
    return {
      view: normalized,
      allowed: true,
      confident: false,
      capability,
      reason: `View classified as ${normalized} below the confidence threshold. Confirm the view before reporting.`,
    };
  }

  return {
    view: normalized,
    allowed: true,
    confident,
    capability,
    reason: capability.note,
  };
}

export interface BiplanePairCandidate {
  instanceUid: string;
  view: string | null | undefined;
  confidence?: number | null;
}

/**
 * Find the instance that completes a biplane pair with `view`.
 *
 * Returns the highest-confidence candidate in the complementary view. Returns
 * null when no candidate clears the confidence threshold, because pairing two
 * views on a guess produces a volume that looks authoritative and is not.
 */
export function findBiplanePartner(
  view: string | null | undefined,
  candidates: BiplanePairCandidate[]
): BiplanePairCandidate | null {
  const capability = getViewCapability(view);
  const target = capability.pairsWith;
  if (!target) return null;

  const matches = candidates
    .filter((candidate) => normalizeView(candidate.view) === target)
    .filter(
      (candidate) =>
        typeof candidate.confidence !== 'number' ||
        candidate.confidence >= VIEW_CONFIDENCE_THRESHOLD
    );

  if (matches.length === 0) return null;

  return matches.reduce((best, candidate) =>
    (candidate.confidence ?? 0) > (best.confidence ?? 0) ? candidate : best
  );
}
