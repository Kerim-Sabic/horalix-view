/**
 * AI Results Panel
 *
 * Clinical-grade echocardiography AI analysis display:
 * - EF with color-coded severity
 * - LV dimensions & volumes (PanEcho)
 * - RV, atrial, and valve assessments
 * - View classification badges
 * - Measurement overlays from model keypoints
 * - EchoNet-Dynamic volume curves
 */

import React, { useMemo } from 'react';
import {
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme, type Theme } from '@mui/material/styles';
import {
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Refresh as RefreshIcon,
  FavoriteBorder as HeartIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import {
  buildEchoPrimeSignals,
  buildIntegratedMeasurements,
  getNumericStatus,
  statusToSeverity,
  type IntegratedTask,
  type MeasurementStatus,
} from './integratedMeasurements';

// ============================================================================
// Types
// ============================================================================

interface CardiacOutput {
  view_predictions?: Record<string, string>;
  view_confidences?: Record<string, number>;
  view_diagnostics?: Record<string, {
    view_label?: string;
    confidence?: number;
    mapping_status?: string;
    mapping_reason?: string | null;
    measurement_models?: string[];
    measurement_skip_reason?: string | null;
    echonet_status?: string;
    echonet_skip_reason?: string | null;
  }>;
  findings?: Record<string, unknown>;
  overlays?: Array<Record<string, unknown>>;
  measurements?: Array<{
    measurement_type: string;
    measurement_name: string;
    value: number;
    unit: string;
    view?: string;
    validation?: {
      status?: string;
      normal_min?: number;
      normal_max?: number;
      plausible_min?: number;
      plausible_max?: number;
      unit?: string;
      message?: string;
    };
  }>;
  curves?: Array<{
    name: string;
    unit: string;
    instance_uid: string;
    t_ms: number[];
    y: number[];
    markers?: Record<string, number>;
  }>;
  report?: {
    sections?: Record<string, Record<string, unknown>>;
    text?: string;
  };
  inference_time_ms?: number;
  timestamp?: string;
  gpu_id?: number;
  patient_sex?: string | null;
  patient_height_cm?: number | null;
  patient_weight_kg?: number | null;
  patient_bmi?: number | null;
  patient_context_source?: string | null;
  fused_metrics?: Record<string, {
    value: number;
    panecho?: number;
    echoprime?: number;
    source: string;
    confidence?: string;
  }>;
}

export type PatientContext = {
  sex?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  bmi?: number | null;
  source?: string | null;
};

export interface AIResultsPanelProps {
  cardiacResults: Array<Record<string, unknown>>;
  latestCardiacJob: {
    job_id: string;
    model_type: string;
    task_type: string;
    completed_at: string | null;
    inference_time_ms: number | null;
    results: Record<string, unknown> | null;
    result_files: Record<string, string> | null;
  } | null;
  showOverlay: boolean;
  onToggleOverlay: () => void;
  showMeasurementOverlay: boolean;
  onToggleMeasurementOverlay: () => void;
  showContourOverlay: boolean;
  onToggleContourOverlay: () => void;
  onRerunAI?: () => void;
  onRerunAIWithContext?: (context: PatientContext | null) => void;
  isRunning?: boolean;
  progress?: number | null;
  activeInstanceUid?: string | null;
  overlayVisibleCount?: number | null;
  lineOverlayCount?: number | null;
  contourOverlayCount?: number | null;
  onJumpToNextOverlay?: () => void;
  onSelectView?: (view: string, instanceUids: string[]) => void;
  patientContextOverride?: PatientContext | null;
}

// ============================================================================
// PanEcho Data Parser
// ============================================================================

/** Extract a scalar from PanEcho's [[value]] format */
function pv(raw: unknown): number | null {
  if (typeof raw === 'number') return raw;
  if (Array.isArray(raw)) {
    const inner = raw[0];
    if (Array.isArray(inner)) return typeof inner[0] === 'number' ? inner[0] : null;
    if (typeof inner === 'number') return inner;
  }
  return null;
}

/** Extract a probability array from PanEcho's [[p0, p1, p2]] format */
function pa(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const inner = Array.isArray(raw[0]) ? raw[0] : raw;
  if (!Array.isArray(inner)) return null;
  const nums = inner.map(Number).filter((n) => Number.isFinite(n));
  return nums.length ? nums : null;
}

/** Classify a categorical prediction from probability array [[p0, p1, p2]] */
function classify3(raw: unknown, labels: string[]): { label: string; confidence: number } | null {
  if (!Array.isArray(raw)) return null;
  const arr = Array.isArray(raw[0]) ? raw[0] : raw;
  if (!Array.isArray(arr) || arr.length < 2) return null;
  const nums = arr.map(Number).filter((n) => !isNaN(n));
  if (nums.length === 0) return null;
  const maxIdx = nums.indexOf(Math.max(...nums));
  const label = labels[maxIdx] ?? `Class ${maxIdx}`;
  return { label, confidence: nums[maxIdx] };
}

/** Severity color for clinical values (discrete categories) */
function severityColor(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('normal') || l.includes('none') || l.includes('trace')) return '#22c55e';
  if (l.includes('mild')) return '#f59e0b';
  if (l.includes('moderate')) return '#f97316';
  if (l.includes('severe') || l.includes('abnormal')) return '#ef4444';
  return '#94a3b8';
}

const PLACEHOLDER_TEXT = 'Unable to calculate';

const formatConfidenceText = (value: number | null): string | null => {
  if (value === null || !Number.isFinite(value)) return null;
  if (value <= 0) return null;
  const pct = value <= 1 ? value * 100 : value;
  if (!Number.isFinite(pct) || pct < 5) return null;
  return `${Math.round(pct)}%`;
};

const deriveStatusFromLabel = (label: string): MeasurementStatus | null => {
  const l = label.toLowerCase();
  if (l.includes('normal') || l.includes('none') || l.includes('trace') || l.includes('absent')) {
    return { status: 'normal', statusLabel: 'Normal' };
  }
  if (l.includes('borderline') || l.includes('mild')) {
    return { status: 'borderline', statusLabel: 'Borderline' };
  }
  if (l.includes('moderate') || l.includes('severe') || l.includes('abnormal') || l.includes('present')) {
    return { status: 'abnormal', statusLabel: 'Abnormal' };
  }
  return null;
};

/**
 * Gradient severity color based on how far from normal a value is.
 * Returns a color interpolated from green (normal) -> yellow -> orange -> red (severe).
 *
 * @param value - The actual measurement value
 * @param normalLow - Lower bound of normal range
 * @param normalHigh - Upper bound of normal range
 * @param severeLow - Lower severe threshold (below which is critical)
 * @param severeHigh - Upper severe threshold (above which is critical)
 * @returns CSS color string
 */
function gradientSeverityColor(
  value: number,
  normalLow: number,
  normalHigh: number,
  severeLow?: number,
  severeHigh?: number
): string {
  // Colors for gradient: green -> yellow -> orange -> red
  const colors = {
    normal: { r: 34, g: 197, b: 94 },    // #22c55e
    mild: { r: 245, g: 158, b: 11 },     // #f59e0b
    moderate: { r: 249, g: 115, b: 22 }, // #f97316
    severe: { r: 239, g: 68, b: 68 },    // #ef4444
  };

  // Within normal range -> green
  if (value >= normalLow && value <= normalHigh) {
    return `rgb(${colors.normal.r}, ${colors.normal.g}, ${colors.normal.b})`;
  }

  // Calculate how far from normal the value is
  let deviation: number;

  if (value < normalLow) {
    const range = severeLow !== undefined ? normalLow - severeLow : normalLow * 0.5;
    deviation = (normalLow - value) / Math.max(range, 0.01);
  } else {
    const range = severeHigh !== undefined ? severeHigh - normalHigh : normalHigh * 0.5;
    deviation = (value - normalHigh) / Math.max(range, 0.01);
  }

  // Clamp deviation to 0-1
  deviation = Math.max(0, Math.min(1, deviation));

  // Interpolate color based on deviation
  let startColor: { r: number; g: number; b: number };
  let endColor: { r: number; g: number; b: number };
  let t: number;

  if (deviation < 0.33) {
    // Green -> Yellow (mild)
    startColor = colors.normal;
    endColor = colors.mild;
    t = deviation / 0.33;
  } else if (deviation < 0.66) {
    // Yellow -> Orange (moderate)
    startColor = colors.mild;
    endColor = colors.moderate;
    t = (deviation - 0.33) / 0.33;
  } else {
    // Orange -> Red (severe)
    startColor = colors.moderate;
    endColor = colors.severe;
    t = (deviation - 0.66) / 0.34;
  }

  // Linear interpolation
  const r = Math.round(startColor.r + (endColor.r - startColor.r) * t);
  const g = Math.round(startColor.g + (endColor.g - startColor.g) * t);
  const b = Math.round(startColor.b + (endColor.b - startColor.b) * t);

  return `rgb(${r}, ${g}, ${b})`;
}

/** Reference ranges for gradient severity calculation */
const CLINICAL_RANGES: Record<string, { normalLow: number; normalHigh: number; severeLow?: number; severeHigh?: number }> = {
  EF: { normalLow: 50, normalHigh: 70, severeLow: 25, severeHigh: 80 },
  GLS: { normalLow: -25, normalHigh: -18, severeLow: -10, severeHigh: -30 },
  LVEDV: { normalLow: 56, normalHigh: 155, severeLow: 30, severeHigh: 250 },
  LVESV: { normalLow: 19, normalHigh: 58, severeLow: 10, severeHigh: 120 },
  TAPSE: { normalLow: 1.7, normalHigh: 3.5, severeLow: 0.8, severeHigh: 4.0 },
  RVSP: { normalLow: 15, normalHigh: 35, severeLow: 0, severeHigh: 80 },
  'E/e\'': { normalLow: 4, normalHigh: 8, severeLow: 0, severeHigh: 25 },
  ivs: { normalLow: 0.6, normalHigh: 1.0, severeLow: 0.3, severeHigh: 1.6 },
  lvid: { normalLow: 3.5, normalHigh: 5.6, severeLow: 2.5, severeHigh: 7.5 },
  lvpw: { normalLow: 0.6, normalHigh: 1.0, severeLow: 0.3, severeHigh: 1.6 },
  la: { normalLow: 2.7, normalHigh: 4.0, severeLow: 2.0, severeHigh: 6.0 },
  aorta: { normalLow: 2.0, normalHigh: 3.7, severeLow: 1.5, severeHigh: 5.5 },
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Compute mean of non-null numbers */
function mean(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  const total = nums.reduce((sum, val) => sum + val, 0);
  return total / nums.length;
}

/** Average probability arrays across instances */
function averageProbArray(values: (number[] | null)[]): number[] | null {
  const arrays = values.filter((v): v is number[] => Array.isArray(v) && v.length > 0);
  if (arrays.length === 0) return null;
  const length = arrays[0].length;
  const filtered = arrays.filter((arr) => arr.length === length && arr.every(Number.isFinite));
  if (filtered.length === 0) return null;
  const sums = new Array<number>(length).fill(0);
  filtered.forEach((arr) => {
    arr.forEach((val, idx) => {
      sums[idx] += val;
    });
  });
  return sums.map((sum) => sum / filtered.length);
}

interface PanEchoData {
  ef: number | null;
  gls: number | null;
  lvedv: number | null;
  lvesv: number | null;
  lvsv: number | null;
  ivsd: number | null;
  lvpwd: number | null;
  lvids: number | null;
  lvidd: number | null;
  lvotDiam: number | null;
  tapse: number | null;
  rvidd: number | null;
  rvSVel: number | null;
  laids: number | null;
  laVol: number | null;
  raDim: number | null;
  aoRoot: number | null;
  avPkVel: number | null;
  tvPkGrad: number | null;
  rvsp: number | null;
  eEavg: number | null;
  lvSize: { label: string; confidence: number } | null;
  lvSystolic: { label: string; confidence: number } | null;
  lvDiastolic: { label: string; confidence: number } | null;
  rvSize: { label: string; confidence: number } | null;
  rvSystolic: number | null;
  laSize: { label: string; confidence: number } | null;
  raSize: number | null;
  avStructure: number | null;
  avStenosis: { label: string; confidence: number } | null;
  avRegurg: { label: string; confidence: number } | null;
  mvStenosis: number | null;
  mvRegurg: { label: string; confidence: number } | null;
  tvRegurg: { label: string; confidence: number } | null;
  periEff: number | null;
  wma: number | null;
  lvWallThick: number | null;
  instanceCount: number;
}

const SIZE_LABELS = ['Dilated', 'Borderline', 'Normal'];
const FUNC_LABELS = ['Abnormal', 'Borderline', 'Normal'];
const STENOSIS_LABELS = ['Mild+', 'None/Trace', 'Severe'];
const REGURG_LABELS = ['Mild+', 'Moderate+', 'None/Trace'];
const DIASTOLIC_LABELS = ['Abnormal', 'Borderline', 'Normal'];

const isMeaningfulNumber = (value: number | null): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) > 0.0001;

function parsePanEcho(findings: Record<string, unknown>): PanEchoData | null {
  const panecho = findings.panecho as Record<string, unknown> | undefined;
  const panechoAggregated = findings.panecho_aggregated as Record<string, unknown> | undefined;
  let raws: Record<string, unknown>[] = [];

  if (panecho && typeof panecho === 'object') {
    const entries = Object.values(panecho);
    if (entries.length > 0) {
      // Parse all instances into raw output dictionaries
      raws = entries
        .map((entry) => {
          const inst = entry as Record<string, unknown>;
          const raw = (inst?.raw_output ?? inst) as Record<string, unknown>;
          if (!raw || typeof raw !== 'object') return null;
          return raw;
        })
        .filter((v): v is Record<string, unknown> => v !== null);
    }
  }

  // Fallback: allow aggregated PanEcho outputs
  if (raws.length === 0 && panechoAggregated && typeof panechoAggregated === 'object') {
    raws = [panechoAggregated as Record<string, unknown>];
  }

  if (raws.length === 0) return null;

  const scalarMean = (key: string) => mean(raws.map((raw) => pv(raw[key])));
  const probMean = (key: string) => averageProbArray(raws.map((raw) => pa(raw[key])));

  // Aggregate: mean for scalars & probability arrays (matches Echocardiology_App)
  return {
    ef: scalarMean('EF'),
    gls: scalarMean('GLS'),
    lvedv: scalarMean('LVEDV'),
    lvesv: scalarMean('LVESV'),
    lvsv: scalarMean('LVSV'),
    ivsd: scalarMean('IVSd'),
    lvpwd: scalarMean('LVPWd'),
    lvids: scalarMean('LVIDs'),
    lvidd: scalarMean('LVIDd'),
    lvotDiam: scalarMean('LVOTDiam'),
    tapse: scalarMean('TAPSE'),
    rvidd: scalarMean('RVIDd'),
    rvSVel: scalarMean('RVSVel'),
    laids: scalarMean('LAIDs2D'),
    laVol: scalarMean('LAVol'),
    raDim: scalarMean('RADimensionM-L(cm)'),
    aoRoot: scalarMean('AORoot'),
    avPkVel: scalarMean('AVPkVel(m|s)'),
    tvPkGrad: scalarMean('TVPkGrad'),
    rvsp: scalarMean('RVSP'),
    eEavg: scalarMean('E|EAvg'),
    lvSize: classify3(probMean('LVSize'), SIZE_LABELS),
    lvSystolic: classify3(probMean('LVSystolicFunction'), FUNC_LABELS),
    lvDiastolic: classify3(probMean('LVDiastolicFunction'), DIASTOLIC_LABELS),
    rvSize: classify3(probMean('RVSize'), SIZE_LABELS),
    rvSystolic: scalarMean('RVSystolicFunction'),
    laSize: classify3(probMean('LASize'), SIZE_LABELS),
    raSize: scalarMean('RASize'),
    avStructure: scalarMean('AVStructure'),
    avStenosis: classify3(probMean('AVStenosis'), STENOSIS_LABELS),
    avRegurg: classify3(probMean('AVRegurg'), REGURG_LABELS),
    mvStenosis: scalarMean('MVStenosis'),
    mvRegurg: classify3(probMean('MVRegurgitation'), REGURG_LABELS),
    tvRegurg: classify3(probMean('TVRegurgitation'), REGURG_LABELS),
    periEff: scalarMean('pericardial-effusion'),
    wma: scalarMean('LVWallMotionAbnormalities'),
    lvWallThick: scalarMean('LVWallThickness-increased-any'),
    instanceCount: raws.length,
  };
}

// ============================================================================
// Sub-components
// ============================================================================

const getPanelTokens = (theme: Theme) => {
  const isDark = theme.palette.mode === 'dark';
  return {
    panelBg: isDark ? '#0f131a' : '#f8fafc',
    panelBorder: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(15,23,42,0.12)',
    sectionBg: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)',
    sectionBorder: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(15,23,42,0.08)',
    rowDivider: isDark ? 'rgba(148,163,184,0.16)' : 'rgba(15,23,42,0.08)',
    labelColor: isDark ? '#94a3b8' : '#64748b',
    valueColor: isDark ? '#e2e8f0' : '#0f172a',
  };
};

const getSectionCardSx = (theme: Theme) => {
  const tokens = getPanelTokens(theme);
  return {
    px: 0.75,
    py: 0.55,
    bgcolor: tokens.sectionBg,
    border: `1px solid ${tokens.sectionBorder}`,
    borderRadius: 1.2,
    '& .metric-row': {
      borderBottom: `1px solid ${tokens.rowDivider}`,
    },
    '& .metric-row:last-of-type': {
      borderBottom: 'none',
    },
  } as const;
};

const SectionHeader: React.FC<{ title: string }> = ({ title }) => {
  const theme = useTheme();
  const { labelColor } = getPanelTokens(theme);
  return (
    <Typography
      variant="caption"
      sx={{
        display: 'block',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: labelColor,
        mt: 1.1,
        mb: 0.4,
        fontSize: '0.6rem',
      }}
    >
      {title}
    </Typography>
  );
};

/** Clinical reference ranges for measurements (cm) */
const MEASUREMENT_RANGES: Record<string, { low: number; high: number; unit: string; fullName: string }> = {
  ivs: { low: 0.6, high: 1.0, unit: 'cm', fullName: 'IVS Thickness' },
  lvid: { low: 3.5, high: 5.6, unit: 'cm', fullName: 'LV Internal Diameter' },
  lvpw: { low: 0.6, high: 1.0, unit: 'cm', fullName: 'LV Posterior Wall' },
  aorta: { low: 2.0, high: 3.7, unit: 'cm', fullName: 'Aortic Diameter' },
  aortic_root: { low: 2.0, high: 3.7, unit: 'cm', fullName: 'Aortic Root' },
  la: { low: 2.7, high: 4.0, unit: 'cm', fullName: 'Left Atrium' },
  rv_base: { low: 2.0, high: 2.8, unit: 'cm', fullName: 'RV Base' },
  pa: { low: 1.5, high: 2.5, unit: 'cm', fullName: 'Pulmonary Artery' },
  ivc: { low: 1.5, high: 2.5, unit: 'cm', fullName: 'IVC Diameter' },
};

/** Determine severity for a measurement value vs. reference range */
function measurementSeverity(
  measurementType: string,
  value: number
): { severity: 'normal' | 'low' | 'high'; rangeText: string } | null {
  // Extract base name: "la_ED" -> "la", "ivs_ES" -> "ivs"
  const base = measurementType.replace(/_ED$|_ES$/, '');
  const ref = MEASUREMENT_RANGES[base];
  if (!ref) return null;
  const rangeText = `${ref.low}-${ref.high} ${ref.unit}`;
  if (value < ref.low) return { severity: 'low', rangeText };
  if (value > ref.high) return { severity: 'high', rangeText };
  return { severity: 'normal', rangeText };
}

type MeasurementValidation = NonNullable<CardiacOutput['measurements']>[number]['validation'];

type ValidationSeverity = {
  severity: 'normal' | 'low' | 'high' | 'mild' | 'severe';
  rangeText?: string;
  statusLabel?: string;
};

function validationSeverity(
  validation: MeasurementValidation | undefined,
  value: number
): ValidationSeverity | null {
  if (!validation || !validation.status) return null;

  const status = validation.status.toLowerCase();
  const normalMin = typeof validation.normal_min === 'number' ? validation.normal_min : null;
  const normalMax = typeof validation.normal_max === 'number' ? validation.normal_max : null;
  const unit = validation.unit;

  const rangeText =
    normalMin !== null && normalMax !== null
      ? `${normalMin}-${normalMax}${unit ? ` ${unit}` : ''}`
      : undefined;

  if (status === 'normal') {
    return { severity: 'normal', rangeText, statusLabel: 'Normal' };
  }
  if (status === 'borderline') {
    return { severity: 'mild', rangeText, statusLabel: 'Borderline' };
  }
  if (status === 'implausible') {
    return { severity: 'severe', rangeText, statusLabel: 'Implausible' };
  }
  if (status === 'abnormal') {
    if (normalMin !== null && value < normalMin) {
      return { severity: 'low', rangeText, statusLabel: 'Abnormal' };
    }
    if (normalMax !== null && value > normalMax) {
      return { severity: 'high', rangeText, statusLabel: 'Abnormal' };
    }
    return { severity: 'severe', rangeText, statusLabel: 'Abnormal' };
  }

  return null;
}

const MetricRow: React.FC<{
  label: string;
  value: string | number | null;
  unit?: string;
  decimals?: number;
  severity?: 'normal' | 'low' | 'high' | 'mild' | 'moderate' | 'severe' | null;
  rangeText?: string;
  metricKey?: string; // For gradient severity lookup
  statusLabel?: string | null;
  confidenceText?: string | null;
  confidenceLabel?: string;
  tooltip?: string;
  sourceLabel?: string | null;
  sourceColor?: string;
  dotColor?: string;
  onRowClick?: () => void;
  rowHighlight?: boolean;
}> = (props) => {
  const {
    label,
    value,
    unit,
    decimals = 1,
    severity,
    rangeText,
    metricKey,
    statusLabel,
    confidenceText,
    confidenceLabel,
    tooltip,
    sourceLabel,
    dotColor,
    onRowClick,
    rowHighlight,
  } = props;
  const theme = useTheme();
  const { labelColor, valueColor } = getPanelTokens(theme);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  if (value === null || value === undefined) return null;
  const rawText = typeof value === 'number' ? value.toFixed(decimals) : String(value);
  const hasLetters = typeof value === 'string' && /[a-zA-Z]/.test(value);
  const isCategoryValue = typeof value === 'string' && hasLetters;
  const isPlaceholder =
    typeof value === 'string' &&
    value.toLowerCase().includes('unable to calculate');
  const valueIsNormalWord = isCategoryValue && rawText.trim().toLowerCase() === 'normal';
  const statusIsNormal = statusLabel?.toLowerCase() === 'normal';
  const hideCategoryValue = isCategoryValue && statusIsNormal && !isPlaceholder;
  const showValueText = !isCategoryValue || isPlaceholder || (!valueIsNormalWord && !hideCategoryValue);
  const isPureNumber = typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()));
  const numericValue = isPureNumber ? Number(value) : null;

  // Determine color: use gradient if we have a metricKey and numeric value, otherwise discrete severity
  let sevColor: string | undefined = dotColor;

  if (!sevColor && metricKey && numericValue !== null && !Number.isNaN(numericValue)) {
    const range = CLINICAL_RANGES[metricKey];
    if (range) {
      sevColor = gradientSeverityColor(
        numericValue,
        range.normalLow,
        range.normalHigh,
        range.severeLow,
        range.severeHigh
      );
    }
  }

  if (!sevColor && severity) {
    sevColor = severity === 'normal'
      ? '#22c55e'
      : severity === 'low' || severity === 'mild'
        ? '#f59e0b'
        : severity === 'high' || severity === 'moderate'
          ? '#f97316'
          : severity === 'severe'
            ? '#ef4444'
            : undefined;
  }

  if (!sevColor && statusLabel) {
    const status = statusLabel.toLowerCase();
    if (status.includes('normal')) sevColor = '#22c55e';
    else if (status.includes('border')) sevColor = '#f59e0b';
    else if (status.includes('abnormal') || status.includes('implausible')) sevColor = '#ef4444';
  }

  if (!sevColor && isCategoryValue) {
    sevColor = severityColor(rawText);
  }

  const rangeFallback = (() => {
    if (rangeText) return rangeText;
    if (!metricKey || numericValue === null) return null;
    const range = CLINICAL_RANGES[metricKey];
    if (!range) return null;
    const unitSuffix = unit ? ` ${unit}` : '';
    return `${range.normalLow}-${range.normalHigh}${unitSuffix}`;
  })();
  const derivedStatusLabel = (() => {
    if (statusLabel) return statusLabel;
    if (numericValue === null || !metricKey) return null;
    const range = CLINICAL_RANGES[metricKey];
    if (!range) return null;
    if (numericValue < range.normalLow || numericValue > range.normalHigh) return 'Abnormal';
    return 'Normal';
  })();

  const detailLines: Array<{ label: string; value: string }> = [];
  if (rawText) detailLines.push({ label: 'Value', value: `${rawText}${!isPlaceholder && unit ? ` ${unit}` : ''}` });
  if (derivedStatusLabel) detailLines.push({ label: 'Status', value: derivedStatusLabel });
  if (rangeFallback) detailLines.push({ label: 'Normal Range', value: rangeFallback });
  if (confidenceText) detailLines.push({ label: confidenceLabel ?? 'Confidence', value: confidenceText });
  if (sourceLabel) detailLines.push({ label: 'Source', value: sourceLabel });
  if (tooltip) detailLines.push({ label: 'Notes', value: tooltip });

  const hasDetails = detailLines.length > 0;
  const handleToggleDetails = (event: React.MouseEvent<HTMLElement>) => {
    if (!hasDetails) return;
    event.stopPropagation();
    setDetailsOpen((prev) => !prev);
  };

  return (
    <>
      <Box
        className="metric-row"
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          py: 0.35,
          px: 0.4,
          gap: 1,
          borderRadius: 1,
          transition: 'background-color 120ms ease',
          bgcolor: detailsOpen
            ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.12 : 0.08)
            : rowHighlight
              ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.08 : 0.06)
              : 'transparent',
          '&:hover': {
            bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.08 : 0.05),
          },
          cursor: onRowClick ? 'pointer' : 'default',
        }}
        onClick={onRowClick}
      >
        <Typography variant="caption" sx={{ color: labelColor, fontSize: '0.7rem' }}>
          {label}
        </Typography>
        <Stack direction="row" spacing={0.5} alignItems="center">
          {showValueText && (
            <Typography
              variant="caption"
              sx={{
                color: isPlaceholder ? labelColor : valueColor,
                fontWeight: isPlaceholder ? 500 : 600,
                fontFamily: isPlaceholder ? 'inherit' : 'monospace',
                fontStyle: isPlaceholder ? 'italic' : 'normal',
                fontSize: '0.7rem',
              }}
            >
              {rawText}{!isPlaceholder && unit ? ` ${unit}` : ''}
            </Typography>
          )}
          {confidenceText && (
            null
          )}
          {sevColor && (
            <Tooltip title={hasDetails ? 'View details' : ''} arrow disableHoverListener={!hasDetails}>
              <Box
                onClick={handleToggleDetails}
                role={hasDetails ? 'button' : undefined}
                sx={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  bgcolor: sevColor,
                  boxShadow: `0 0 0 2px ${alpha(sevColor, 0.3)}`,
                  cursor: hasDetails ? 'pointer' : 'default',
                }}
              />
            </Tooltip>
          )}
        </Stack>
      </Box>
      <Collapse in={detailsOpen} timeout="auto" unmountOnExit>
        <Box
          sx={{
            mt: 0.35,
            mb: 0.4,
            mx: 0.4,
            p: 0.6,
            borderRadius: 1,
            border: `1px solid ${alpha(theme.palette.text.primary, 0.12)}`,
            bgcolor: theme.palette.mode === 'dark'
              ? 'rgba(15, 23, 42, 0.45)'
              : 'rgba(248, 250, 252, 0.9)',
          }}
        >
          <Stack spacing={0.4}>
            {detailLines.map((item) => (
              <Stack key={item.label} direction="row" spacing={0.6} alignItems="baseline">
                <Typography variant="caption" sx={{ color: labelColor, fontSize: '0.6rem', minWidth: 78 }}>
                  {item.label}
                </Typography>
                <Typography variant="caption" sx={{ color: valueColor, fontSize: '0.65rem', fontWeight: 600 }}>
                  {item.value}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Box>
      </Collapse>
    </>
  );
};

const PROBABILITY_BANDS: Array<{ max: number; label: string; color: string }> = [
  { max: 20, label: 'Absent', color: '#22c55e' },
  { max: 50, label: 'Possible', color: '#f59e0b' },
  { max: 80, label: 'Likely', color: '#f97316' },
  { max: 100, label: 'Present', color: '#ef4444' },
];

function normalizeProbability(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const pct = value <= 1 ? value * 100 : value;
  if (!Number.isFinite(pct)) return null;
  return Math.max(0, Math.min(100, pct));
}

const ProbabilityRow: React.FC<{
  label: string;
  value: number | null;
}> = ({ label, value }) => {
  const pct = value === null || value === undefined ? null : normalizeProbability(value);
  if (pct === null) {
    return <MetricRow label={label} value="Unable to calculate" />;
  }
  const band = PROBABILITY_BANDS.find((entry) => pct <= entry.max) ?? PROBABILITY_BANDS[PROBABILITY_BANDS.length - 1];
  const pctText = `${pct.toFixed(0)}%`;
  const severity =
    band.label === 'Absent'
      ? 'normal'
      : band.label === 'Possible'
        ? 'mild'
        : band.label === 'Likely'
          ? 'moderate'
          : 'severe';

  return (
    <MetricRow
      label={label}
      value={band.label}
      severity={severity}
      statusLabel={band.label === 'Absent' ? 'Normal' : band.label}
      confidenceText={pctText}
      confidenceLabel="Probability"
      tooltip="Absent <20%, Possible 20-50%, Likely 50-80%, Present >80%"
    />
  );
};

const EFHero: React.FC<{
  value: number;
  method?: string | null;
  status?: MeasurementStatus | null;
}> = ({ value, method, status }) => {
  const theme = useTheme();
  const { labelColor, valueColor } = getPanelTokens(theme);
  const pct = value <= 1 ? value * 100 : value;
  const derivedStatus: MeasurementStatus =
    pct >= 55
      ? { status: 'normal', statusLabel: 'Normal' }
      : pct >= 50
        ? { status: 'borderline', statusLabel: 'Borderline' }
        : { status: 'abnormal', statusLabel: 'Abnormal' };
  const useStatus = status ?? derivedStatus;
  const severity =
    useStatus.status === 'normal'
      ? 'normal'
      : useStatus.status === 'borderline'
        ? 'borderline'
        : 'abnormal';
  const accent =
    severity === 'normal'
      ? theme.palette.success.main
      : severity === 'borderline'
        ? theme.palette.warning.main
        : theme.palette.error.main;
  const classification =
    pct >= 55
      ? 'Normal'
      : pct >= 50
        ? 'Low-Normal'
        : pct >= 40
          ? 'Mildly Reduced'
          : pct >= 30
            ? 'Moderately Reduced'
            : 'Severely Reduced';

  return (
    <Box
      sx={{
        p: 1.2,
        borderRadius: 1.6,
        border: `1px solid ${alpha(accent, theme.palette.mode === 'dark' ? 0.45 : 0.35)}`,
        background: `linear-gradient(135deg, ${alpha(accent, theme.palette.mode === 'dark' ? 0.25 : 0.16)} 0%, ${alpha(accent, 0.05)} 100%)`,
        boxShadow: theme.palette.mode === 'dark'
          ? '0 10px 24px rgba(6, 10, 18, 0.45)'
          : '0 12px 24px rgba(15, 23, 42, 0.12)',
      }}
    >
      <Stack direction="row" spacing={1.2} alignItems="center" justifyContent="space-between">
        <Stack direction="row" spacing={1} alignItems="center">
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              bgcolor: alpha(accent, 0.25),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: accent,
            }}
          >
            <HeartIcon sx={{ fontSize: 22 }} />
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: labelColor, fontWeight: 700, letterSpacing: '0.08em' }}>
              EJECTION FRACTION
            </Typography>
            <Stack direction="row" spacing={1} alignItems="baseline">
              <Typography variant="h3" sx={{ fontWeight: 700, color: valueColor, lineHeight: 1 }}>
                {pct.toFixed(0)}%
              </Typography>
              <Typography variant="caption" sx={{ color: labelColor }}>
                {classification}
              </Typography>
            </Stack>
          </Box>
        </Stack>
        <Stack direction="row" spacing={0.6} alignItems="center">
          <Chip
            size="small"
            label={useStatus.statusLabel}
            sx={{
              height: 18,
              fontSize: '0.6rem',
              fontWeight: 700,
              bgcolor: accent,
              color: '#fff',
            }}
          />
        </Stack>
      </Stack>
      {method && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.6, color: labelColor }}>
          Method: {method}
        </Typography>
      )}
    </Box>
  );
};

const ViewBadges: React.FC<{
  predictions: Record<string, string>;
  confidences?: Record<string, number>;
  onSelectView?: (view: string, instanceUids: string[]) => void;
  activeInstanceUid?: string | null;
}> = ({ predictions, confidences, onSelectView, activeInstanceUid }) => {
  const theme = useTheme();
  const { labelColor } = getPanelTokens(theme);
  const viewMap = useMemo(() => {
    const map: Record<string, { uids: string[]; confs: number[] }> = {};
    Object.entries(predictions).forEach(([instanceUid, viewRaw]) => {
      const viewLabel = typeof viewRaw === 'string' && viewRaw.trim().length > 0 ? viewRaw : 'Unknown';
      if (!map[viewLabel]) {
        map[viewLabel] = { uids: [], confs: [] };
      }
      map[viewLabel].uids.push(instanceUid);
      const conf = confidences?.[instanceUid];
      if (typeof conf === 'number' && Number.isFinite(conf)) {
        map[viewLabel].confs.push(conf);
      }
    });
    return map;
  }, [predictions, confidences]);

  const viewEntries = useMemo(() => {
    return Object.entries(viewMap).sort((a, b) => {
      const countDiff = b[1].uids.length - a[1].uids.length;
      if (countDiff !== 0) return countDiff;
      return a[0].localeCompare(b[0]);
    });
  }, [viewMap]);

  if (viewEntries.length === 0) return null;

  const confidenceColor = (value: number | null) => {
    if (value === null || Number.isNaN(value)) return theme.palette.text.disabled;
    if (value >= 0.85) return '#22c55e';
    if (value >= 0.7) return '#38bdf8';
    if (value >= 0.6) return '#f59e0b';
    return '#94a3b8';
  };

  const median = (values: number[]): number | null => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  };

  const totalCines = Object.keys(predictions).length;
  const totalViews = viewEntries.length;
  const activeView =
    activeInstanceUid && predictions[activeInstanceUid]
      ? predictions[activeInstanceUid]
      : activeInstanceUid
        ? 'Unknown'
        : null;

  return (
    <Box>
      <Typography
        variant="caption"
        sx={{ mb: 0.4, display: 'block', fontWeight: 700, fontSize: '0.6rem', color: labelColor }}
      >
        VIEWS ({totalViews}) | CINES ({totalCines})
      </Typography>
      <Box sx={getSectionCardSx(theme)}>
        {viewEntries.map(([view, payload]) => {
          const instanceUids = payload.uids;
          const confidence = median(payload.confs);
          const confidenceText = confidence !== null ? `${Math.round(confidence * 100)}%` : null;
          const isActive = activeView === view;
          return (
            <MetricRow
              key={view}
              label={view}
              value={`${instanceUids.length} cine${instanceUids.length === 1 ? '' : 's'}`}
              severity={confidence !== null && confidence >= 0.7 ? 'normal' : confidence !== null && confidence >= 0.6 ? 'mild' : confidence !== null ? 'moderate' : null}
              confidenceText={confidenceText}
              confidenceLabel="View confidence"
              dotColor={confidenceColor(confidence)}
              tooltip="Median confidence across cines in this view."
              onRowClick={onSelectView ? () => onSelectView(view, instanceUids) : undefined}
              rowHighlight={isActive}
            />
          );
        })}
      </Box>
    </Box>
  );
};

const MiniVolumeCurve: React.FC<{
  values: number[];
  edIdx?: number;
  esIdx?: number;
}> = ({ values, edIdx, esIdx }) => {
  const width = 248;
  const height = 55;
  const pad = 6;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (width - 2 * pad);
      const y = pad + (1 - (v - min) / range) * (height - 2 * pad);
      return `${x},${y}`;
    })
    .join(' ');

  const pt = (idx: number | undefined) => {
    if (idx == null || idx >= values.length) return null;
    return {
      x: pad + (idx / (values.length - 1)) * (width - 2 * pad),
      y: pad + (1 - (values[idx] - min) / range) * (height - 2 * pad),
    };
  };
  const edPt = pt(edIdx);
  const esPt = pt(esIdx);

  return (
    <svg width={width} height={height} style={{ display: 'block', borderRadius: 4, background: 'rgba(255,255,255,0.04)' }}>
      <polyline points={points} fill="none" stroke="#60a5fa" strokeWidth={1.5} />
      {edPt && (
        <>
          <circle cx={edPt.x} cy={edPt.y} r={4} fill="#ef4444" stroke="#fff" strokeWidth={1} />
          <text x={edPt.x} y={edPt.y - 6} fill="#ef4444" fontSize={9} fontWeight="bold" textAnchor="middle">ED</text>
        </>
      )}
      {esPt && (
        <>
          <circle cx={esPt.x} cy={esPt.y} r={4} fill="#22c55e" stroke="#fff" strokeWidth={1} />
          <text x={esPt.x} y={esPt.y - 6} fill="#22c55e" fontSize={9} fontWeight="bold" textAnchor="middle">ES</text>
        </>
      )}
    </svg>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const AIResultsPanel: React.FC<AIResultsPanelProps> = React.memo(
  ({
    cardiacResults,
    latestCardiacJob,
    showOverlay,
    onToggleOverlay,
    showMeasurementOverlay,
    onToggleMeasurementOverlay,
    showContourOverlay,
    onToggleContourOverlay,
    onRerunAI,
    onRerunAIWithContext,
    isRunning,
    progress,
    activeInstanceUid,
    overlayVisibleCount,
    lineOverlayCount,
    contourOverlayCount,
    onJumpToNextOverlay,
    onSelectView,
    patientContextOverride,
  }) => {
    const theme = useTheme();
    const panelTokens = useMemo(() => getPanelTokens(theme), [theme]);
    const sectionCardSx = useMemo(() => getSectionCardSx(theme), [theme]);
    const headerBg = useMemo(
      () => alpha(panelTokens.valueColor, theme.palette.mode === 'dark' ? 0.06 : 0.04),
      [panelTokens.valueColor, theme.palette.mode]
    );
    // Extract cardiac output from results
    const output = useMemo<CardiacOutput | null>(() => {
      const latestJobOutput = latestCardiacJob?.results?.output as CardiacOutput | undefined;
      if (latestJobOutput && typeof latestJobOutput === 'object') return latestJobOutput;
      if (!cardiacResults.length) return null;
      const latest = cardiacResults[cardiacResults.length - 1] as Record<string, unknown>;
      const o = latest?.output as CardiacOutput | undefined;
      return o && typeof o === 'object' ? o : null;
    }, [cardiacResults, latestCardiacJob]);

    // Parse PanEcho clinical data (aggregated across all instances)
    const panEcho = useMemo(() => {
      if (!output?.findings) return null;
      return parsePanEcho(output.findings);
    }, [output]);

    const ef = panEcho?.ef ?? null;
    const lineCount = typeof lineOverlayCount === 'number' ? lineOverlayCount : null;
    const contourCount = typeof contourOverlayCount === 'number' ? contourOverlayCount : null;
    const overlayTotalCount = output?.overlays?.length ?? ((lineCount ?? 0) + (contourCount ?? 0));
    const overlayVisible =
      typeof overlayVisibleCount === 'number' ? overlayVisibleCount : null;
    const overlayLabel =
      overlayTotalCount > 0
        ? `${overlayVisible !== null ? `${overlayVisible}/` : ''}${overlayTotalCount} overlays`
        : '0 overlays';
    const measurementOverlayLabel =
      lineCount !== null ? `Measurements ${lineCount}` : 'Measurements';
    const contourOverlayLabel =
      contourCount !== null ? `LV Contour ${contourCount}` : 'LV Contour';
    const measurementCount = output?.measurements?.length ?? 0;
    const viewCount = output?.view_predictions ? Object.keys(output.view_predictions).length : 0;
    const viewDiagnostics = output?.view_diagnostics ?? {};
    const hasViewDiagnostics = Object.keys(viewDiagnostics).length > 0;
    const hasResults = output !== null;
    const hasPanEcho = panEcho !== null;
    const [showViewDiagnostics, setShowViewDiagnostics] = React.useState(false);

    // LV volume curve from EchoNet
    const lvCurve = useMemo(() => {
      if (!output?.curves?.length) return null;
      return output.curves.find(
        (c) => c.name.toLowerCase().includes('volume') || c.name.toLowerCase().includes('lv')
      ) ?? null;
    }, [output]);

    // EchoNet EF from volume curve
    const echonetEF = useMemo(() => {
      if (!lvCurve || lvCurve.y.length < 2) return null;
      const edv = Math.max(...lvCurve.y);
      const esv = Math.min(...lvCurve.y);
      if (edv <= 0) return null;
      return ((edv - esv) / edv) * 100;
    }, [lvCurve]);

    // EchoPrime study-level phenotype metrics
    const echoPrimeMetrics = useMemo(() => {
      if (!output?.findings) return null;
      const findings = output.findings as Record<string, unknown>;
      const metrics =
        (findings.echoprime_study_metrics as Record<string, unknown> | undefined) ??
        ((findings.fused as Record<string, unknown> | undefined)?.echoprime_phenotypes as Record<string, unknown> | undefined);
      if (!metrics || typeof metrics !== 'object') return null;
      return metrics as Record<string, unknown>;
    }, [output]);

    const summaryLines = useMemo(() => {
      const text = output?.report?.text;
      if (!text || text === 'Placeholder report text') return [];
      return text
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    }, [output]);

    const integratedTasks = useMemo(() => {
      if (!output?.findings) return null;
      const findings = output.findings as Record<string, unknown>;
      const tasks = findings.integrated_tasks as Record<string, unknown> | undefined;
      if (!tasks || typeof tasks !== 'object') return null;
      return tasks as Record<string, IntegratedTask>;
    }, [output]);

    const patientSex = patientContextOverride?.sex ?? output?.patient_sex ?? null;
    const outputPatientContext = useMemo<PatientContext | null>(() => {
      if (!output) return null;
      const heightCm = typeof output.patient_height_cm === 'number' ? output.patient_height_cm : null;
      const weightKg = typeof output.patient_weight_kg === 'number' ? output.patient_weight_kg : null;
      const bmi = typeof output.patient_bmi === 'number' ? output.patient_bmi : null;
      const source = output.patient_context_source ?? null;
      const sex = output.patient_sex ?? null;
      if (!sex && heightCm === null && weightKg === null && bmi === null) return null;
      return { sex, heightCm, weightKg, bmi, source };
    }, [output]);

    const effectivePatientContext = patientContextOverride ?? outputPatientContext;

    const computedBmi = useMemo(() => {
      const heightCm = effectivePatientContext?.heightCm;
      const weightKg = effectivePatientContext?.weightKg;
      if (!heightCm || !weightKg) return null;
      const heightM = heightCm / 100;
      if (heightM <= 0) return null;
      return weightKg / (heightM * heightM);
    }, [effectivePatientContext]);

    const displayPatientContext: PatientContext | null = effectivePatientContext
      ? {
          ...effectivePatientContext,
          bmi: effectivePatientContext.bmi ?? computedBmi,
        }
      : null;

    const integratedView = useMemo(
      () => buildIntegratedMeasurements(integratedTasks, patientSex),
      [integratedTasks, patientSex]
    );
    const integratedSections = integratedView.sections;
    const integratedMain = integratedView.mainMeasurements;
    const hasIntegrated = integratedSections.length > 0 || integratedMain.length > 0;

    const panEchoMeasurementSections = useMemo(() => {
      if (!panEcho) return [];
      type PanEchoItem = {
        label: string;
        value: number | string;
        unit: string;
        decimals: number;
        metricKey?: string;
        sourceLabel: string;
        statusLabel: string | null;
        rangeText: string | null;
        severity: 'normal' | 'mild' | 'severe' | null;
      };
      type PanEchoSection = { title: string; items: PanEchoItem[] };
      type RawItem = {
        label: string;
        value: number | null;
        unit: string;
        decimals: number;
        metricKey?: string;
        statusKey?: string;
      };

      const sections: Array<{ title: string; items: RawItem[] }> = [
        {
          title: 'Left Ventricle',
          items: [
            { label: 'Ejection Fraction (EF)', value: panEcho.ef, unit: '%', decimals: 0, metricKey: 'EF', statusKey: 'ejection_fraction' },
            { label: 'Global Longitudinal Strain (GLS)', value: panEcho.gls, unit: '%', decimals: 1, metricKey: 'GLS', statusKey: 'gls' },
            { label: 'LVEDV', value: panEcho.lvedv, unit: 'mL', decimals: 0, metricKey: 'LVEDV', statusKey: 'lvedv' },
            { label: 'LVESV', value: panEcho.lvesv, unit: 'mL', decimals: 0, metricKey: 'LVESV', statusKey: 'lvesv' },
            { label: 'LVSV', value: panEcho.lvsv, unit: 'mL', decimals: 0, statusKey: 'lvsv' },
            { label: 'LVIDd', value: panEcho.lvidd, unit: 'cm', decimals: 1, metricKey: 'lvid', statusKey: 'lvidd' },
            { label: 'LVIDs', value: panEcho.lvids, unit: 'cm', decimals: 1, metricKey: 'lvid', statusKey: 'lvids' },
            { label: 'IVSd', value: panEcho.ivsd, unit: 'cm', decimals: 1, metricKey: 'ivs', statusKey: 'ivsd' },
            { label: 'LVPWd', value: panEcho.lvpwd, unit: 'cm', decimals: 1, metricKey: 'lvpw', statusKey: 'lvpwd' },
            { label: 'LVOT Diam', value: panEcho.lvotDiam, unit: 'cm', decimals: 1, statusKey: 'lvotdiam' },
          ],
        },
        {
          title: 'Right Ventricle',
          items: [
            { label: 'RVIDd', value: panEcho.rvidd, unit: 'cm', decimals: 1, statusKey: 'rvidd' },
            { label: 'TAPSE', value: panEcho.tapse, unit: 'cm', decimals: 1, metricKey: 'TAPSE', statusKey: 'tapse' },
            { label: "RV S' Vel", value: panEcho.rvSVel, unit: 'cm/s', decimals: 1, statusKey: 'rv_s_vel' },
            { label: 'RVSP', value: panEcho.rvsp, unit: 'mmHg', decimals: 0, metricKey: 'RVSP', statusKey: 'pulmonary_artery_pressure' },
          ],
        },
        {
          title: 'Atria',
          items: [
            { label: 'LA Diam (2D)', value: panEcho.laids, unit: 'cm', decimals: 1, metricKey: 'la', statusKey: 'laids2d' },
            { label: 'LA Volume', value: panEcho.laVol, unit: 'mL', decimals: 0, statusKey: 'lavol' },
            { label: 'RA Diam (M-L)', value: panEcho.raDim, unit: 'cm', decimals: 1, statusKey: 'radimension_ml' },
          ],
        },
        {
          title: 'Valves & Hemodynamics',
          items: [
            { label: 'AV Peak Vel', value: panEcho.avPkVel, unit: 'm/s', decimals: 1, statusKey: 'avpkvel' },
            { label: 'Aortic Root', value: panEcho.aoRoot, unit: 'cm', decimals: 1, metricKey: 'aorta', statusKey: 'aortic_root_diameter' },
            { label: "E/e' avg", value: panEcho.eEavg, unit: '', decimals: 1, metricKey: "E/e'", statusKey: 'e_eavg' },
            { label: 'TV Peak Grad', value: panEcho.tvPkGrad, unit: 'mmHg', decimals: 0, statusKey: 'tvpkgrad' },
          ],
        },
      ];

      const built: PanEchoSection[] = [];
      sections.forEach((section) => {
        const items: PanEchoItem[] = section.items.map((item) => {
          const numericValue = isMeaningfulNumber(item.value) ? item.value : null;
          const displayValue = numericValue !== null ? numericValue : PLACEHOLDER_TEXT;
          const status = numericValue !== null && item.statusKey
            ? getNumericStatus(item.statusKey, numericValue, patientSex)
            : null;
          return {
            label: item.label,
            value: displayValue,
            unit: item.unit,
            decimals: item.decimals,
            metricKey: item.metricKey,
            sourceLabel: 'PanEcho',
            statusLabel: status?.statusLabel ?? null,
            rangeText: status?.rangeText ?? null,
            severity: statusToSeverity(status),
          };
        });
        built.push({ title: section.title, items });
      });

      return built;
    }, [panEcho, patientSex]);

    const panEchoFindingSections = useMemo(() => {
      if (!panEcho) return [];
      type FindingItem =
        | { type: 'classification'; label: string; value: string | null; confidence: number | null }
        | { type: 'probability'; label: string; value: number | null };

      const sections: Array<{ title: string; items: FindingItem[] }> = [
        {
          title: 'Left Ventricle',
          items: [
            { type: 'classification', label: 'LV Size', value: panEcho.lvSize?.label ?? null, confidence: panEcho.lvSize?.confidence ?? null },
            { type: 'classification', label: 'LV Systolic Function', value: panEcho.lvSystolic?.label ?? null, confidence: panEcho.lvSystolic?.confidence ?? null },
            { type: 'classification', label: 'LV Diastolic Function', value: panEcho.lvDiastolic?.label ?? null, confidence: panEcho.lvDiastolic?.confidence ?? null },
            { type: 'probability', label: 'Wall Motion Abn.', value: panEcho.wma },
            { type: 'probability', label: 'LV Wall Thickening', value: panEcho.lvWallThick },
          ],
        },
        {
          title: 'Right Ventricle',
          items: [
            { type: 'classification', label: 'RV Size', value: panEcho.rvSize?.label ?? null, confidence: panEcho.rvSize?.confidence ?? null },
            { type: 'probability', label: 'RV Dysfunction', value: panEcho.rvSystolic },
          ],
        },
        {
          title: 'Atria',
          items: [
            { type: 'classification', label: 'LA Size', value: panEcho.laSize?.label ?? null, confidence: panEcho.laSize?.confidence ?? null },
            { type: 'probability', label: 'RA Enlargement', value: panEcho.raSize },
          ],
        },
        {
          title: 'Valves',
          items: [
            { type: 'classification', label: 'AV Stenosis', value: panEcho.avStenosis?.label ?? null, confidence: panEcho.avStenosis?.confidence ?? null },
            { type: 'classification', label: 'AV Regurg.', value: panEcho.avRegurg?.label ?? null, confidence: panEcho.avRegurg?.confidence ?? null },
            { type: 'classification', label: 'MV Regurg.', value: panEcho.mvRegurg?.label ?? null, confidence: panEcho.mvRegurg?.confidence ?? null },
            { type: 'classification', label: 'TV Regurg.', value: panEcho.tvRegurg?.label ?? null, confidence: panEcho.tvRegurg?.confidence ?? null },
            { type: 'probability', label: 'AV Structural Abn.', value: panEcho.avStructure },
            { type: 'probability', label: 'MV Stenosis', value: panEcho.mvStenosis },
          ],
        },
        {
          title: 'Other',
          items: [
            { type: 'probability', label: 'Pericardial Effusion', value: panEcho.periEff },
          ],
        },
      ];

      return sections;
    }, [panEcho]);

    const summaryHighlights = useMemo(() => {
      const items: Array<{ text: string; severity: 'normal' | 'borderline' | 'abnormal' }> = [];

      integratedView.sections.forEach((section) => {
        section.items.forEach((item) => {
          if (!item.status || item.status.status === 'normal') return;
          const valueText = `${item.value}${item.unit ? ` ${item.unit}` : ''}`;
          items.push({
            text: `${item.label}: ${valueText}`,
            severity: item.status.status,
          });
        });
      });

      if (items.length === 0) {
        integratedView.mainMeasurements.forEach((item) => {
          const valueText = `${item.value}${item.unit ? ` ${item.unit}` : ''}`;
          items.push({
            text: `${item.label}: ${valueText}`,
            severity: 'normal',
          });
        });
      }

      return items.slice(0, 6);
    }, [integratedView]);

    // Format inference time
    const inferenceTime = useMemo(() => {
      const ms = output?.inference_time_ms ?? latestCardiacJob?.inference_time_ms;
      if (!ms) return null;
      return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
    }, [output, latestCardiacJob]);

    // Format timestamp
    const analysisTimestamp = useMemo(() => {
      const ts = output?.timestamp ?? latestCardiacJob?.completed_at;
      if (!ts) return null;
      try {
        const date = new Date(ts);
        return date.toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      } catch {
        return null;
      }
    }, [output, latestCardiacJob]);

    // Extract fused metrics for display
    const fusedMetrics = useMemo(() => {
      if (!output?.findings) return null;
      const findings = output.findings as Record<string, unknown>;
      const fused = findings.fused_metrics as Record<string, unknown> | undefined;
      return fused ?? null;
    }, [output]);

    const fusedEf = useMemo(() => {
      if (!fusedMetrics) return null;
      const data = fusedMetrics.EF as { value?: unknown } | undefined;
      if (!data || typeof data !== 'object') return null;
      const value = data.value;
      return typeof value === 'number' ? value : null;
    }, [fusedMetrics]);

    const efDisplay = useMemo(() => {
      if (typeof fusedEf === 'number') return fusedEf;
      if (ef === null) return null;
      return ef <= 1 ? ef * 100 : ef;
    }, [fusedEf, ef]);

    const integratedEf = integratedMain.find((item) => item.key === 'ejection_fraction') ?? null;
    const heroEfValue = integratedEf?.numericValue ?? efDisplay;
    const heroStatus =
      integratedEf?.status ??
      (heroEfValue !== null && heroEfValue !== undefined
        ? heroEfValue >= 55
          ? { status: 'normal', statusLabel: 'Normal' }
          : heroEfValue >= 50
            ? { status: 'borderline', statusLabel: 'Borderline' }
            : { status: 'abnormal', statusLabel: 'Abnormal' }
        : null);
    const heroMethod =
      integratedEf?.sourceLabel?.startsWith('F')
        ? 'PanEcho + EchoPrime'
        : integratedEf?.sourceLabel?.startsWith('P')
          ? 'PanEcho'
          : integratedEf?.sourceLabel?.startsWith('E')
            ? 'EchoPrime'
            : integratedEf?.sourceLabel
              ? 'Integrated'
              : fusedEf !== null
                ? 'PanEcho + EchoPrime'
                : ef !== null
                  ? panEcho?.instanceCount && panEcho.instanceCount > 1
                    ? `PanEcho, ${panEcho.instanceCount} views`
                    : 'PanEcho'
                  : null;

    const echoPrimeSignals = useMemo(
      () => buildEchoPrimeSignals(echoPrimeMetrics, patientSex),
      [echoPrimeMetrics, patientSex]
    );

    const [patientDialogOpen, setPatientDialogOpen] = React.useState(false);
    const [patientDraft, setPatientDraft] = React.useState<PatientContext>({
      sex: displayPatientContext?.sex ?? null,
      heightCm: displayPatientContext?.heightCm ?? null,
      weightKg: displayPatientContext?.weightKg ?? null,
      bmi: displayPatientContext?.bmi ?? null,
      source: displayPatientContext?.source ?? null,
    });

    React.useEffect(() => {
      if (!patientDialogOpen) return;
      setPatientDraft({
        sex: displayPatientContext?.sex ?? null,
        heightCm: displayPatientContext?.heightCm ?? null,
        weightKg: displayPatientContext?.weightKg ?? null,
        bmi: displayPatientContext?.bmi ?? null,
        source: displayPatientContext?.source ?? null,
      });
    }, [patientDialogOpen, displayPatientContext]);

    const handleApplyPatientContext = () => {
      const normalized: PatientContext = {
        sex: patientDraft.sex ? patientDraft.sex : null,
        heightCm: patientDraft.heightCm ?? null,
        weightKg: patientDraft.weightKg ?? null,
        bmi: patientDraft.bmi ?? null,
        source: 'manual',
      };
      if (onRerunAIWithContext) {
        onRerunAIWithContext(normalized);
      }
      setPatientDialogOpen(false);
    };

    return (
      <>
        <Paper
          sx={{
            width: 300,
            borderRadius: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderLeft: 1,
            borderColor: panelTokens.panelBorder,
            bgcolor: panelTokens.panelBg,
            color: panelTokens.valueColor,
          }}
          elevation={0}
        >
        {/* Header */}
        <Box
          sx={{
            px: 1.5,
            py: 1,
            borderBottom: 1,
            borderColor: panelTokens.panelBorder,
            bgcolor: headerBg,
          }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: '0.85rem', color: panelTokens.valueColor }}>
              AI Echo Report
            </Typography>
            <Stack direction="row" spacing={0.25}>
              <Tooltip title={showOverlay ? 'Hide overlays' : 'Show overlays'}>
                <span>
                  <IconButton size="small" onClick={onToggleOverlay} disabled={overlayTotalCount === 0 && measurementCount === 0}>
                    {showOverlay ? <VisibilityIcon fontSize="small" /> : <VisibilityOffIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
              {onRerunAI && (
                <Tooltip title="Re-run AI">
                  <span>
                    <IconButton size="small" onClick={onRerunAI} disabled={isRunning}>
                      <RefreshIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
            </Stack>
          </Stack>

          {/* Status chips */}
          {hasResults && !isRunning && (
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.25 }} flexWrap="wrap" useFlexGap>
              <Chip
                size="small"
                label="Complete"
                color="success"
                sx={{ height: 18, fontSize: '0.6rem', fontWeight: 600 }}
              />
              {overlayTotalCount > 0 && (
                <Tooltip title={onJumpToNextOverlay ? 'Jump to next overlay' : 'Overlays on this study'} arrow>
                  <span>
                    <Chip
                      size="small"
                      label={overlayLabel}
                      variant="outlined"
                      clickable={Boolean(onJumpToNextOverlay)}
                      onClick={onJumpToNextOverlay}
                      sx={{
                        height: 18,
                        fontSize: '0.6rem',
                        fontWeight: 600,
                        borderColor: panelTokens.panelBorder,
                        color: panelTokens.valueColor,
                      }}
                    />
                  </span>
                </Tooltip>
              )}
              {overlayTotalCount > 0 && (
                <Tooltip
                  title={showMeasurementOverlay ? 'Hide measurement overlays' : 'Show measurement overlays'}
                  arrow
                >
                  <span>
                    <Chip
                      size="small"
                      label={measurementOverlayLabel}
                      variant={showOverlay && showMeasurementOverlay ? 'filled' : 'outlined'}
                      color={showOverlay && showMeasurementOverlay ? 'primary' : 'default'}
                      clickable
                      onClick={onToggleMeasurementOverlay}
                      disabled={!showOverlay || (lineCount ?? 0) === 0}
                      sx={{
                        height: 18,
                        fontSize: '0.6rem',
                        fontWeight: 600,
                        borderColor: panelTokens.panelBorder,
                        color: panelTokens.valueColor,
                      }}
                    />
                  </span>
                </Tooltip>
              )}
              {overlayTotalCount > 0 && (
                <Tooltip
                  title={showContourOverlay ? 'Hide LV contour overlays' : 'Show LV contour overlays'}
                  arrow
                >
                  <span>
                    <Chip
                      size="small"
                      label={contourOverlayLabel}
                      variant={showOverlay && showContourOverlay ? 'filled' : 'outlined'}
                      color={showOverlay && showContourOverlay ? 'info' : 'default'}
                      clickable
                      onClick={onToggleContourOverlay}
                      disabled={!showOverlay || (contourCount ?? 0) === 0}
                      sx={{
                        height: 18,
                        fontSize: '0.6rem',
                        fontWeight: 600,
                        borderColor: panelTokens.panelBorder,
                        color: panelTokens.valueColor,
                      }}
                    />
                  </span>
                </Tooltip>
              )}
              {measurementCount > 0 && (
                <Chip
                  size="small"
                  label={`${measurementCount} meas.`}
                  variant="outlined"
                  sx={{
                    height: 18,
                    fontSize: '0.6rem',
                    fontWeight: 600,
                    borderColor: panelTokens.panelBorder,
                    color: panelTokens.valueColor,
                  }}
                />
              )}
              {hasViewDiagnostics && (
                <Chip
                  size="small"
                  label={showViewDiagnostics ? 'Debug ON' : 'Debug'}
                  variant={showViewDiagnostics ? 'filled' : 'outlined'}
                  color={showViewDiagnostics ? 'warning' : 'default'}
                  onClick={() => setShowViewDiagnostics((prev) => !prev)}
                  sx={{
                    height: 18,
                    fontSize: '0.6rem',
                    fontWeight: 600,
                    borderColor: panelTokens.panelBorder,
                    color: panelTokens.valueColor,
                  }}
                />
              )}
              {inferenceTime && (
                <Chip
                  size="small"
                  label={inferenceTime}
                  variant="outlined"
                  sx={{
                    height: 18,
                    fontSize: '0.6rem',
                    fontWeight: 600,
                    borderColor: panelTokens.panelBorder,
                    color: panelTokens.valueColor,
                  }}
                />
              )}
            </Stack>
          )}

          {/* Timestamp display */}
          {hasResults && !isRunning && analysisTimestamp && (
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                mt: 0.5,
                color: panelTokens.labelColor,
                fontSize: '0.65rem',
                fontStyle: 'italic',
              }}
            >
              Analyzed: {analysisTimestamp}
              {output?.gpu_id !== undefined && ` (GPU ${output.gpu_id})`}
            </Typography>
          )}

          {/* Running state with progress */}
          {isRunning && (
            <Box sx={{ mt: 0.5 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="caption" sx={{ flexShrink: 0, color: panelTokens.labelColor }}>
                  Analyzing...
                </Typography>
                {typeof progress === 'number' && progress > 0 && (
                  <Typography variant="caption" fontFamily="monospace" sx={{ color: panelTokens.labelColor }}>
                    {Math.round(progress)}%
                  </Typography>
                )}
              </Stack>
              <LinearProgress
                variant={typeof progress === 'number' && progress > 0 ? 'determinate' : 'indeterminate'}
                value={typeof progress === 'number' ? progress : undefined}
                sx={{ mt: 0.5, height: 3, borderRadius: 1 }}
              />
            </Box>
          )}

          {/* No results state */}
          {!hasResults && !isRunning && (
            <Typography variant="caption" sx={{ mt: 0.25, display: 'block', color: panelTokens.labelColor }}>
              No AI results. Run analysis from AI Tools menu.
            </Typography>
          )}
        </Box>

        {/* Scrollable content */}
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          {hasResults && (
            <Box sx={{ p: 1.1 }}>
              {heroEfValue !== null && heroEfValue !== undefined && (
                <Box sx={{ mb: 1.2 }}>
                  <EFHero value={heroEfValue} method={heroMethod} status={heroStatus} />
                </Box>
              )}

              {(displayPatientContext || onRerunAIWithContext) && (
                <>
                  <SectionHeader title="Patient Context" />
                  <Box sx={{ ...sectionCardSx, display: 'grid', gap: 0.6 }}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                      <Stack spacing={0.35}>
                        <Typography variant="caption" sx={{ fontSize: '0.7rem', color: panelTokens.labelColor }}>
                          Sex: <strong style={{ color: panelTokens.valueColor }}>{displayPatientContext?.sex ?? 'Unknown'}</strong>
                        </Typography>
                        <Typography variant="caption" sx={{ fontSize: '0.7rem', color: panelTokens.labelColor }}>
                          Height: <strong style={{ color: panelTokens.valueColor }}>
                            {displayPatientContext?.heightCm ? `${displayPatientContext.heightCm.toFixed(0)} cm` : '-'}
                          </strong>
                        </Typography>
                        <Typography variant="caption" sx={{ fontSize: '0.7rem', color: panelTokens.labelColor }}>
                          Weight: <strong style={{ color: panelTokens.valueColor }}>
                            {displayPatientContext?.weightKg ? `${displayPatientContext.weightKg.toFixed(1)} kg` : '-'}
                          </strong>
                        </Typography>
                        <Typography variant="caption" sx={{ fontSize: '0.7rem', color: panelTokens.labelColor }}>
                          BMI: <strong style={{ color: panelTokens.valueColor }}>
                            {displayPatientContext?.bmi ? displayPatientContext.bmi.toFixed(1) : '-'}
                          </strong>
                        </Typography>
                        {displayPatientContext?.source && (
                          <Typography variant="caption" sx={{ fontSize: '0.6rem', color: panelTokens.labelColor }}>
                            Source: {displayPatientContext.source}
                          </Typography>
                        )}
                      </Stack>
                      {onRerunAIWithContext && (
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<EditIcon fontSize="small" />}
                          onClick={() => setPatientDialogOpen(true)}
                          sx={{ textTransform: 'none', fontWeight: 600 }}
                        >
                          Edit
                        </Button>
                      )}
                    </Stack>
                  </Box>
                </>
              )}

              {/* ====== VIEW CLASSIFICATION ====== */}
              {viewCount > 0 && output?.view_predictions && (
                <Box sx={{ mt: 1.5 }}>
                  <ViewBadges
                    predictions={output.view_predictions}
                    confidences={output.view_confidences}
                    onSelectView={onSelectView}
                    activeInstanceUid={activeInstanceUid}
                  />
                </Box>
              )}

              {showViewDiagnostics && hasViewDiagnostics && (
                <Box sx={{ mt: 1.2 }}>
                  <SectionHeader title="View Debug" />
                  <Box sx={sectionCardSx}>
                    {Object.entries(viewDiagnostics)
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([instanceUid, diag]) => {
                        const confidence =
                          typeof diag.confidence === 'number' && Number.isFinite(diag.confidence)
                            ? `${Math.round(diag.confidence * 100)}%`
                            : '-';
                        const measurementModels =
                          Array.isArray(diag.measurement_models) && diag.measurement_models.length > 0
                            ? diag.measurement_models.join(', ')
                            : 'none';
                        return (
                          <Box
                            key={`view-diag-${instanceUid}`}
                            sx={{
                              borderBottom: `1px solid ${alpha(panelTokens.panelBorder, 0.55)}`,
                              py: 0.5,
                              '&:last-of-type': { borderBottom: 'none' },
                            }}
                          >
                            <Typography variant="caption" sx={{ fontSize: '0.62rem', color: panelTokens.labelColor }}>
                              UID: {instanceUid}
                            </Typography>
                            <Typography variant="caption" sx={{ display: 'block', fontSize: '0.68rem' }}>
                              View: {diag.view_label ?? 'Unknown'} ({confidence})
                            </Typography>
                            <Typography variant="caption" sx={{ display: 'block', fontSize: '0.66rem', color: panelTokens.labelColor }}>
                              Mapping: {diag.mapping_status ?? '-'} {diag.mapping_reason ? `(${diag.mapping_reason})` : ''}
                            </Typography>
                            <Typography variant="caption" sx={{ display: 'block', fontSize: '0.66rem', color: panelTokens.labelColor }}>
                              Measurements: {measurementModels}
                              {diag.measurement_skip_reason ? ` | skip=${diag.measurement_skip_reason}` : ''}
                            </Typography>
                            <Typography variant="caption" sx={{ display: 'block', fontSize: '0.66rem', color: panelTokens.labelColor }}>
                              EchoNet: {diag.echonet_status ?? '-'}
                              {diag.echonet_skip_reason ? ` | ${diag.echonet_skip_reason}` : ''}
                            </Typography>
                          </Box>
                        );
                      })}
                  </Box>
                </Box>
              )}

              {/* ====== INTEGRATED AI SECTIONS ====== */}
              {hasIntegrated && (
                <>
                  {integratedSections.length === 0 && integratedMain.length > 0 && (
                    <>
                      <SectionHeader title="Key Metrics" />
                      <Box sx={sectionCardSx}>
                        {integratedMain.map((item) => (
                            <MetricRow
                              key={item.key}
                              label={item.label}
                              value={item.value}
                              unit={item.unit ?? undefined}
                              severity={statusToSeverity(item.status ?? null)}
                              statusLabel={item.status?.statusLabel ?? null}
                              rangeText={item.status?.rangeText}
                              sourceLabel={item.sourceLabel}
                              sourceColor={item.sourceColor}
                              confidenceText={item.confidenceText ?? null}
                              tooltip={item.tooltip ?? undefined}
                            />
                          ))}
                      </Box>
                    </>
                  )}
                  {integratedSections.map((section) => {
                    if (!section.items.length) return null;
                    return (
                      <React.Fragment key={section.section}>
                        <SectionHeader title={section.section} />
                        <Box sx={sectionCardSx}>
                          {section.items.map((item) => (
                            <MetricRow
                              key={item.key}
                              label={item.label}
                              value={item.value}
                              unit={item.unit ?? undefined}
                              severity={statusToSeverity(item.status ?? null)}
                              statusLabel={item.status?.statusLabel ?? null}
                              rangeText={item.status?.rangeText}
                              sourceLabel={item.sourceLabel}
                              sourceColor={item.sourceColor}
                              confidenceText={item.confidenceText ?? null}
                              tooltip={item.tooltip ?? undefined}
                            />
                          ))}
                        </Box>
                      </React.Fragment>
                    );
                  })}
                </>
              )}

              {/* ====== PANECHO FINDINGS ====== */}
              {hasPanEcho && panEchoFindingSections.length > 0 && (
                <>
                  {panEchoFindingSections.map((section) => (
                    <React.Fragment key={`panecho-findings-${section.title}`}>
                      <SectionHeader title={`PanEcho - ${section.title}`} />
                      <Box sx={sectionCardSx}>
                        {section.items.map((item, idx) => {
                          if (item.type === 'probability') {
                            return (
                              <ProbabilityRow
                                key={`panecho-prob-${section.title}-${item.label}-${idx}`}
                                label={item.label}
                                value={item.value}
                              />
                            );
                          }
                          const displayValue = item.value ?? PLACEHOLDER_TEXT;
                          const status = item.value ? deriveStatusFromLabel(item.value) : null;
                          return (
                            <MetricRow
                              key={`panecho-class-${section.title}-${item.label}-${idx}`}
                              label={item.label}
                              value={displayValue}
                              statusLabel={status?.statusLabel ?? null}
                              severity={statusToSeverity(status)}
                              confidenceText={formatConfidenceText(item.confidence)}
                              sourceLabel="PanEcho"
                            />
                          );
                        })}
                      </Box>
                    </React.Fragment>
                  ))}
                </>
              )}

              {/* ====== PANECHO MEASUREMENTS ====== */}
              {hasPanEcho && panEchoMeasurementSections.length > 0 && (
                <>
                  {panEchoMeasurementSections.map((section) => (
                    <React.Fragment key={`panecho-${section.title}`}>
                      <SectionHeader title={`PanEcho - ${section.title} Measurements`} />
                      <Box sx={sectionCardSx}>
                        {section.items.map((item) => (
                          <MetricRow
                            key={`panecho-${section.title}-${item.label}`}
                            label={item.label}
                            value={item.value}
                            unit={item.unit}
                            decimals={item.decimals}
                            metricKey={item.metricKey}
                            sourceLabel={item.sourceLabel}
                            statusLabel={item.statusLabel}
                            rangeText={item.rangeText ?? undefined}
                            severity={item.severity}
                          />
                        ))}
                      </Box>
                    </React.Fragment>
                  ))}
                </>
              )}

              {/* ====== ECHONET VOLUME CURVE ====== */}
              {lvCurve && lvCurve.y.length > 1 && (
                <>
                  <SectionHeader title="LV Volume Curve (EchoNet)" />
                  <Box sx={{ ...sectionCardSx, p: 0.9 }}>
                    <MiniVolumeCurve
                      values={lvCurve.y}
                      edIdx={lvCurve.markers?.ED}
                      esIdx={lvCurve.markers?.ES}
                    />
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.25, mt: 0.5 }}>
                      <Typography variant="caption" fontFamily="monospace" sx={{ color: panelTokens.valueColor }}>
                        EDV: <strong>{Math.max(...lvCurve.y).toFixed(0)} {lvCurve.unit}</strong>
                      </Typography>
                      <Typography variant="caption" fontFamily="monospace" sx={{ color: panelTokens.valueColor }}>
                        ESV: <strong>{Math.min(...lvCurve.y).toFixed(0)} {lvCurve.unit}</strong>
                      </Typography>
                      <Typography variant="caption" fontFamily="monospace" sx={{ color: panelTokens.valueColor }}>
                        SV: <strong>{(Math.max(...lvCurve.y) - Math.min(...lvCurve.y)).toFixed(0)} {lvCurve.unit}</strong>
                      </Typography>
                      <Typography variant="caption" fontFamily="monospace" sx={{ color: panelTokens.valueColor }}>
                        EF: <strong>{echonetEF !== null ? `${echonetEF.toFixed(0)}%` : '-'}</strong>
                      </Typography>
                    </Box>
                  </Box>
                </>
              )}

              {/* ====== KEYPOINT MEASUREMENTS ====== */}
              {measurementCount > 0 ? (
                <>
                  <SectionHeader title={`Keypoint Measurements (${measurementCount})`} />
                  <Box sx={sectionCardSx}>
                    {output?.measurements?.map((m, i) => {
                      const validationInfo = validationSeverity(m.validation, m.value);
                      const fallbackSev = measurementSeverity(m.measurement_type, m.value);
                      const sev = validationInfo?.severity
                        ? { severity: validationInfo.severity, rangeText: validationInfo.rangeText }
                        : fallbackSev;
                      // Extract base metric key for gradient color lookup
                      const baseKey = m.measurement_type.replace(/_ED$|_ES$/, '');
                      return (
                        <MetricRow
                          key={`${m.measurement_type}-${i}`}
                          label={m.measurement_name}
                          value={m.value}
                          unit={m.unit}
                          severity={sev?.severity ?? null}
                          rangeText={sev?.rangeText}
                          metricKey={baseKey}
                          statusLabel={validationInfo?.statusLabel ?? null}
                        />
                      );
                    })}
                  </Box>
                </>
              ) : output?.measurements ? (
                <>
                  <SectionHeader title="Keypoint Measurements" />
                  <Box sx={sectionCardSx}>
                    <Typography variant="caption" sx={{ color: panelTokens.labelColor, px: 0.5 }}>
                      Unable to calculate (no compatible views or low view confidence).
                    </Typography>
                  </Box>
                </>
              ) : null}

              {/* ====== FUSED METRICS (Fallback) ====== */}
              {!hasIntegrated && !hasPanEcho && fusedMetrics && Object.keys(fusedMetrics).length > 0 && (
                <>
                  <SectionHeader title="Fused AI Predictions" />
                  <Box sx={sectionCardSx}>
                    {Object.entries(fusedMetrics).map(([key, data]) => {
                      if (!data || typeof data !== 'object') return null;
                      const d = data as { value?: unknown; source?: string; confidence?: string };
                      const numericValue = isFiniteNumber(d.value) ? d.value : null;
                      const display: string | number | null = numericValue !== null
                        ? numericValue.toFixed(1)
                        : Array.isArray(d.value)
                          ? `[${d.value.length} values]`
                          : d.value != null
                            ? String(d.value)
                            : '?';
                      return (
                        <MetricRow
                          key={key}
                          label={key}
                          value={display}
                          tooltip={`Source: ${d.source ?? 'unknown'}${d.confidence ? ` (${d.confidence})` : ''}`}
                        />
                      );
                    })}
                    <Typography
                      variant="caption"
                      sx={{ fontSize: '0.55rem', color: panelTokens.labelColor, px: 0.5, display: 'block', mt: 0.5 }}
                    >
                      Fallback view (integrated tasks unavailable)
                    </Typography>
                  </Box>
                </>
              )}

              {/* ====== ECHOPRIME SIGNALS ====== */}
              {echoPrimeMetrics && (
                <>
                  <SectionHeader title="EchoPrime Signals" />
                  <Box sx={sectionCardSx}>
                    {echoPrimeSignals.length > 0 ? (
                      echoPrimeSignals.map((entry) => (
                        <MetricRow
                          key={`echoprime-${entry.key}`}
                          label={entry.label}
                          value={entry.value}
                          unit={entry.unit ?? undefined}
                          severity={statusToSeverity(entry.status)}
                          statusLabel={entry.status.statusLabel}
                          confidenceText={entry.confidenceText ?? null}
                          sourceLabel="E"
                          sourceColor="#14b8a6"
                        />
                      ))
                    ) : (
                      <Typography variant="caption" sx={{ color: panelTokens.labelColor, px: 0.5 }}>
                        No EchoPrime findings above threshold.
                      </Typography>
                    )}
                  </Box>
                </>
              )}

              {/* ====== REPORT ====== */}
              {(summaryLines.length > 0 || summaryHighlights.length > 0 || hasIntegrated) && (
                <>
                  <SectionHeader title="AI Clinical Summary" />
                  <Box
                    sx={{
                      ...sectionCardSx,
                      px: 0.8,
                      py: 0.7,
                      bgcolor: alpha(panelTokens.valueColor, theme.palette.mode === 'dark' ? 0.06 : 0.03),
                    }}
                  >
                    {summaryHighlights.length > 0 && (
                      <Box sx={{ mb: 1 }}>
                        <Typography
                          variant="caption"
                          sx={{ fontWeight: 700, fontSize: '0.6rem', color: panelTokens.labelColor, display: 'block', mb: 0.5 }}
                        >
                          Key Highlights
                        </Typography>
                        <Stack spacing={0.35}>
                          {summaryHighlights.map((item, idx) => (
                            <Stack key={`highlight-${idx}`} direction="row" spacing={0.5} alignItems="center">
                              <Box
                                sx={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: '50%',
                                  bgcolor: item.severity === 'abnormal'
                                    ? '#ef4444'
                                    : item.severity === 'borderline'
                                      ? '#f59e0b'
                                      : '#22c55e',
                                }}
                              />
                              <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>
                                {item.text}
                              </Typography>
                            </Stack>
                          ))}
                        </Stack>
                      </Box>
                    )}
                    <Stack spacing={0.5}>
                      {summaryLines.map((line, idx) => (
                        <Typography
                          key={`summary-${idx}`}
                          variant="caption"
                          sx={{ lineHeight: 1.55, fontSize: '0.7rem', color: panelTokens.valueColor }}
                        >
                          {line}
                        </Typography>
                      ))}
                      {summaryLines.length === 0 && summaryHighlights.length === 0 && (
                        <Typography variant="caption" sx={{ lineHeight: 1.55, fontSize: '0.7rem', color: panelTokens.valueColor }}>
                          No significant abnormalities detected in AI findings.
                        </Typography>
                      )}
                      {summaryLines.length === 0 && summaryHighlights.length > 0 && (
                        <Typography variant="caption" sx={{ lineHeight: 1.55, fontSize: '0.7rem', color: panelTokens.valueColor }}>
                          See highlights above for the key clinical findings.
                        </Typography>
                      )}
                    </Stack>
                  </Box>
                </>
              )}

              {/* Empty data fallback */}
              {!hasPanEcho && !hasIntegrated && !lvCurve && measurementCount === 0 && viewCount === 0 && (
                <Box sx={{ textAlign: 'center', py: 3 }}>
                  <Typography variant="body2" sx={{ color: panelTokens.valueColor }}>
                    AI completed but no clinical data extracted.
                  </Typography>
                  <Typography variant="caption" sx={{ color: panelTokens.labelColor }}>
                    Ensure the study contains echocardiography cines.
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </Box>
        </Paper>
      <Dialog open={patientDialogOpen} onClose={() => setPatientDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Patient Context</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 1.2, pt: 1 }}>
          <TextField
            select
            label="Sex"
            size="small"
            value={patientDraft.sex ?? ''}
            onChange={(event) => setPatientDraft((prev) => ({ ...prev, sex: event.target.value || null }))}
            SelectProps={{ native: true }}
          >
            <option value="">Unknown</option>
            <option value="M">Male</option>
            <option value="F">Female</option>
            <option value="O">Other</option>
          </TextField>
          <TextField
            label="Height (cm)"
            size="small"
            type="number"
            value={patientDraft.heightCm ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              setPatientDraft((prev) => ({ ...prev, heightCm: value ? Number(value) : null }));
            }}
          />
          <TextField
            label="Weight (kg)"
            size="small"
            type="number"
            value={patientDraft.weightKg ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              setPatientDraft((prev) => ({ ...prev, weightKg: value ? Number(value) : null }));
            }}
          />
          <TextField
            label="BMI (auto)"
            size="small"
            value={
              patientDraft.heightCm && patientDraft.weightKg
                ? (patientDraft.weightKg / Math.pow(patientDraft.heightCm / 100, 2)).toFixed(1)
                : '-'
            }
            InputProps={{ readOnly: true }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPatientDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleApplyPatientContext} disabled={!onRerunAIWithContext}>
            Apply & Re-run
          </Button>
        </DialogActions>
      </Dialog>
      </>
    );
  }
);

AIResultsPanel.displayName = 'AIResultsPanel';
export default AIResultsPanel;
