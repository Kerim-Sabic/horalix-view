import measurementRanges from './data/measurementRanges.json';
import thresholdsConfig from './data/echoprimeThresholds.json';

export type IntegratedTask = {
  panecho_value_or_prob?: unknown;
  echoprime_value_or_prob?: unknown;
  integrated_value?: unknown;
  integrated_label?: string | null;
  units?: string | null;
  sources?: string[];
  discrepancy?: boolean | null;
};

type RangeDef = {
  min?: number;
  max?: number;
  exclusiveMin?: boolean;
  exclusiveMax?: boolean;
};

type RangeBands = {
  normal?: RangeDef[] | RangeDef;
  borderline?: RangeDef[] | RangeDef;
  abnormal?: RangeDef[] | RangeDef;
};

type RangeEntry = {
  bands?: {
    male?: RangeBands;
    female?: RangeBands;
    unisex?: RangeBands;
  };
  categories?: {
    normal?: string[];
    borderline?: string[];
    abnormal?: string[];
  };
};

export type MeasurementStatus = {
  status: 'normal' | 'borderline' | 'abnormal';
  statusLabel: 'Normal' | 'Borderline' | 'Abnormal';
  rangeText?: string;
};

export type IntegratedItem = {
  key: string;
  label: string;
  value: string | number;
  unit?: string | null;
  status?: MeasurementStatus | null;
  numericValue?: number | null;
  sourceLabel?: string | null;
  sourceColor?: string;
  confidenceText?: string | null;
  tooltip?: string | null;
};

export type IntegratedSection = {
  section: string;
  items: IntegratedItem[];
};

export type EchoPrimeSignal = {
  key: string;
  label: string;
  value: string | number;
  unit?: string | null;
  status: MeasurementStatus;
  confidenceText?: string | null;
};

const PLACEHOLDER_TEXT = 'Unable to calculate';

export const MAIN_KEYS = [
  { key: 'ejection_fraction', label: 'Ejection Fraction (EF)' },
  { key: 'gls', label: 'Global Longitudinal Strain (GLS)' },
  { key: 'pulmonary_artery_pressure', label: 'Pulmonary Artery Pressure' },
];

export const RANGE_KEYS = new Set(['ejection_fraction', 'pulmonary_artery_pressure']);

export const SECTION_MAP: Record<string, Record<string, string>> = {
  Valves: {
    aortic_stenosis: 'Aortic Stenosis',
    aortic_regurgitation: 'Aortic Regurgitation',
    mitral_regurgitation: 'Mitral Regurgitation',
    mitral_stenosis: 'Mitral Stenosis',
    tricuspid_valve_regurgitation: 'Tricuspid Regurgitation',
    tricuspid_stenosis: 'Tricuspid Stenosis',
    pulmonic_valve_regurgitation: 'Pulmonic Regurgitation',
    lvot20mmhg: 'LVOT Gradient (20 mmHg)',
    avpkvel: 'Aortic Valve Peak Velocity',
    lvotdiam: 'LVOT Diameter',
    mitral_annular_calcification: 'Mitral Annular Calcification',
  },
  'LV Size & Function': {
    ejection_fraction: 'Ejection Fraction (EF)',
    gls: 'Global Longitudinal Strain (GLS)',
    lvidd: 'LV Internal Diameter (Diastole)',
    lvids: 'LV Internal Diameter (Systole)',
    lvedv: 'LV End-Diastolic Volume (LVEDV)',
    lvesv: 'LV End-Systolic Volume (LVESV)',
    lvsv: 'LV Stroke Volume (LVSV)',
    ivsd: 'Interventricular Septum Thickness (IVSd)',
    lvpwd: 'LV Posterior Wall Thickness (LVPWd)',
    lvsize: 'LV Size',
    lvsystolicfunction: 'LV Systolic Function',
    lvwallmotionabnormalities: 'LV Wall Motion Abnormalities',
    wall_motion_hypokinesis: 'Regional Hypokinesis',
    lvdiastolicfunction: 'LV Diastolic Function',
    lvwallthickness_increased_any: 'LV Wall Thickening (Any)',
    lvwallthickness_increased_modsev: 'LV Wall Thickening (Mod/Sev)',
  },
  Atria: {
    lavol: 'LA Volume',
    laids2d: 'LA Internal Diameter at Systole (LAIDs2D)',
    e_eavg: "E/E' Ratio (Avg)",
    elevated_left_atrial_pressure: 'Elevated LA Pressure',
    left_atrium_dilation: 'Left Atrial Dilation',
    right_atrium_dilation: 'Right Atrial Dilation',
    atrial_septum_hypertrophy: 'Atrial Septum Hypertrophy',
  },
  'Right Heart': {
    pulmonary_artery_pressure: 'Pulmonary Artery Pressure',
    rvidd: 'RV Internal Diameter (Diastole)',
    tapse: 'TAPSE',
    rv_s_vel: "RV S' Velocity",
    tvpkgrad: 'Tricuspid Valve Peak Gradient',
    radimension_ml: 'RA Dimension (M/L)',
    right_ventricle_dilation: 'Right Ventricular Dilation',
    rv_systolic_function_depressed: 'RV Systolic Function Depressed',
    dilated_ivc: 'Dilated IVC',
    pericardial_effusion: 'Pericardial Effusion',
  },
  Aorta: {
    aortic_root_diameter: 'Aortic Root Diameter',
    aortic_root_dilation: 'Aortic Root Dilation',
    bicuspid_aortic_valve: 'Bicuspid Aortic Valve',
  },
  'Devices / Procedures': {
    pacemaker: 'Pacemaker',
    impella: 'Impella Device',
    mitraclip: 'MitraClip',
    tavr: 'TAVR Procedure',
  },
};

const NORMAL_RANGES: Record<string, RangeEntry> = {
  ...(measurementRanges as Record<string, RangeEntry>),
  aortic_stenosis: {
    categories: {
      normal: ['None'],
      borderline: ['Mild', 'Mild or Moderate'],
      abnormal: ['Moderate', 'Severe', 'Moderately or Severely Increased', 'Moderate or Severe'],
    },
  },
  aortic_regurgitation: {
    categories: {
      normal: ['None or Trace'],
      borderline: ['Mild'],
      abnormal: ['Moderate', 'Moderate or Severe', 'Severe'],
    },
  },
  mitral_regurgitation: {
    categories: {
      normal: ['None or Trace'],
      borderline: ['Mild'],
      abnormal: ['Moderate', 'Moderate or Severe', 'Severe'],
    },
  },
  mitral_stenosis: {
    categories: {
      normal: ['None'],
      borderline: ['Mild'],
      abnormal: ['Moderate', 'Moderate or Severe', 'Severe'],
    },
  },
  tricuspid_valve_regurgitation: {
    categories: {
      normal: ['None or Trace'],
      borderline: ['Mild'],
      abnormal: ['Moderate', 'Moderate or Severe', 'Severe'],
    },
  },
  tricuspid_stenosis: {
    categories: {
      normal: ['Absent', 'None'],
      borderline: [],
      abnormal: ['Present', 'Mild', 'Moderate', 'Severe'],
    },
  },
  pulmonic_valve_regurgitation: {
    categories: {
      normal: ['Absent', 'None', 'None or Trace'],
      borderline: ['Mild'],
      abnormal: ['Moderate', 'Moderate or Severe', 'Severe'],
    },
  },
  lvot20mmhg: {
    categories: {
      normal: ['Absent', 'No LVOT gradient >=20 mmHg'],
      borderline: [],
      abnormal: ['Present', 'LVOT gradient >=20 mmHg'],
    },
  },
  mitral_annular_calcification: {
    categories: {
      normal: ['Absent'],
      borderline: ['Mild'],
      abnormal: ['Moderate', 'Severe'],
    },
  },
  lvsize: {
    categories: {
      normal: ['Normal'],
      borderline: ['Mildly Increased'],
      abnormal: ['Moderately or Severely Increased'],
    },
  },
  lvsystolicfunction: {
    categories: {
      normal: ['Normal', 'Normal or Hyperdynamic'],
      borderline: ['Mildly Decreased'],
      abnormal: ['Moderately or Severely Decreased', 'Moderate or Severe'],
    },
  },
  lvwallmotionabnormalities: {
    categories: {
      normal: ['Absent', 'Normal'],
      borderline: [],
      abnormal: ['Present', 'Regional Abnormality'],
    },
  },
  wall_motion_hypokinesis: {
    categories: {
      normal: ['Absent', 'Normal'],
      borderline: ['Mild', 'Mild Hypokinesis'],
      abnormal: ['Moderate Hypokinesis', 'Severe Hypokinesis', 'Present'],
    },
  },
  lvdiastolicfunction: {
    categories: {
      normal: ['Normal'],
      borderline: ['Mild', 'Mild or Indeterminate', 'Indeterminate'],
      abnormal: ['Moderate', 'Severe', 'Moderate or Severe'],
    },
  },
  lvwallthickness_increased_any: {
    categories: {
      normal: ['Not Increased', 'Normal'],
      borderline: ['Mildly Increased'],
      abnormal: ['Moderately or Severely Increased', 'Increased'],
    },
  },
  lvwallthickness_increased_modsev: {
    categories: {
      normal: ['Not Moderately or Severely Increased'],
      borderline: [],
      abnormal: ['Moderately or Severely Increased'],
    },
  },
  left_atrium_dilation: {
    categories: {
      normal: ['Normal'],
      borderline: ['Mildly Dilated'],
      abnormal: ['Moderately or Severely Dilated'],
    },
  },
  right_atrium_dilation: {
    categories: {
      normal: ['Normal'],
      abnormal: ['Dilated'],
    },
  },
  elevated_left_atrial_pressure: {
    categories: {
      normal: ['Normal', 'Not Elevated', 'Absent'],
      borderline: [],
      abnormal: ['Elevated', 'Present'],
    },
  },
  atrial_septum_hypertrophy: {
    categories: {
      normal: ['Absent', 'Normal'],
      borderline: [],
      abnormal: ['Present'],
    },
  },
  right_ventricle_dilation: {
    categories: {
      normal: ['Normal'],
      borderline: ['Mildly Increased'],
      abnormal: ['Moderately or Severely Increased'],
    },
  },
  rv_systolic_function_depressed: {
    categories: {
      normal: ['Normal', 'Not Depressed'],
      borderline: [],
      abnormal: ['Depressed'],
    },
  },
  dilated_ivc: {
    categories: {
      normal: ['Absent', 'Normal'],
      borderline: [],
      abnormal: ['Present'],
    },
  },
  pericardial_effusion: {
    categories: {
      normal: ['Absent', 'None'],
      borderline: ['Trace', 'Small'],
      abnormal: ['Moderate', 'Large', 'Tamponade'],
    },
  },
  aortic_root_dilation: {
    categories: {
      normal: ['Absent', 'Normal'],
      borderline: ['Mild'],
      abnormal: ['Moderate', 'Severe', 'Present'],
    },
  },
  bicuspid_aortic_valve: {
    categories: {
      normal: ['Not Bicuspid'],
      borderline: [],
      abnormal: ['Bicuspid', 'Possible Bicuspid'],
    },
  },
  pacemaker: {
    categories: {
      normal: ['Absent'],
      borderline: [],
      abnormal: ['Present'],
    },
  },
  impella: {
    categories: {
      normal: ['Absent'],
      borderline: [],
      abnormal: ['Present'],
    },
  },
  mitraclip: {
    categories: {
      normal: ['Absent'],
      borderline: [],
      abnormal: ['Present'],
    },
  },
  tavr: {
    categories: {
      normal: ['Absent'],
      borderline: [],
      abnormal: ['Present'],
    },
  },
};

const LABEL_MAP: Record<string, string> = {
  ...Object.fromEntries(MAIN_KEYS.map((entry) => [entry.key, entry.label])),
  ...Object.values(SECTION_MAP).reduce((acc, section) => {
    Object.entries(section).forEach(([key, label]) => {
      acc[key] = label;
    });
    return acc;
  }, {} as Record<string, string>),
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeSex = (rawSex?: string | null): 'male' | 'female' | null => {
  if (!rawSex) return null;
  const cleaned = String(rawSex).trim().toLowerCase();
  if (cleaned === 'm' || cleaned === 'male') return 'male';
  if (cleaned === 'f' || cleaned === 'female') return 'female';
  return null;
};

const normalizeRanges = (ranges?: RangeDef[] | RangeDef | null): RangeDef[] => {
  if (!ranges) return [];
  return Array.isArray(ranges) ? ranges : [ranges];
};

const mergeBandRanges = (
  ranges: Array<RangeDef[] | RangeDef | undefined>,
  options: { minStrategy?: 'min' | 'max'; maxStrategy?: 'min' | 'max' } = {},
): RangeDef[] => {
  const normalized = ranges
    .flatMap((range) => normalizeRanges(range))
    .filter((range) => range && (range.min !== undefined || range.max !== undefined));
  if (!normalized.length) return [];

  const minStrategy = options.minStrategy ?? 'min';
  const maxStrategy = options.maxStrategy ?? 'max';

  const mins = normalized.map((range) => range.min).filter((value): value is number => value !== undefined);
  const maxes = normalized.map((range) => range.max).filter((value): value is number => value !== undefined);

  const min = mins.length ? (minStrategy === 'max' ? Math.max(...mins) : Math.min(...mins)) : null;
  const max = maxes.length ? (maxStrategy === 'min' ? Math.min(...maxes) : Math.max(...maxes)) : null;

  const exclusiveMin = min !== null
    ? normalized.filter((range) => range.min === min).every((range) => range.exclusiveMin)
    : false;
  const exclusiveMax = max !== null
    ? normalized.filter((range) => range.max === max).every((range) => range.exclusiveMax)
    : false;

  const merged: RangeDef = {};
  if (min !== null) merged.min = min;
  if (max !== null) merged.max = max;
  if (exclusiveMin) merged.exclusiveMin = true;
  if (exclusiveMax) merged.exclusiveMax = true;

  return [merged];
};

const deriveUnisexBands = (bands?: { male?: RangeBands; female?: RangeBands }): RangeBands | null => {
  if (!bands?.male && !bands?.female) return null;

  return {
    normal: mergeBandRanges([
      bands?.male?.normal,
      bands?.female?.normal,
    ], { minStrategy: 'min', maxStrategy: 'max' }),
    borderline: mergeBandRanges([
      bands?.male?.borderline,
      bands?.female?.borderline,
    ], { minStrategy: 'max', maxStrategy: 'max' }),
    abnormal: mergeBandRanges([
      bands?.male?.abnormal,
      bands?.female?.abnormal,
    ], { minStrategy: 'max', maxStrategy: 'min' }),
  };
};

const resolveBandsForKey = (key: string, patientSex?: string | null): { bands: RangeBands | null; preferNormal: boolean } => {
  const def = NORMAL_RANGES[key];
  if (!def?.bands) return { bands: null, preferNormal: false };
  const sexKey = normalizeSex(patientSex);
  if (sexKey && def.bands[sexKey]) return { bands: def.bands[sexKey] ?? null, preferNormal: false };
  if (def.bands.unisex) return { bands: def.bands.unisex, preferNormal: false };
  return { bands: deriveUnisexBands(def.bands) ?? null, preferNormal: true };
};

const matchesRange = (value: number, range: RangeDef): boolean => {
  if (range.min !== undefined) {
    const tooLow = range.exclusiveMin ? value <= range.min : value < range.min;
    if (tooLow) return false;
  }
  if (range.max !== undefined) {
    const tooHigh = range.exclusiveMax ? value >= range.max : value > range.max;
    if (tooHigh) return false;
  }
  return true;
};

const matchesAnyRange = (value: number, ranges?: RangeDef[] | RangeDef | null): boolean =>
  normalizeRanges(ranges).some((range) => matchesRange(value, range));

const formatNumber = (value: number): string => {
  const fixed = value.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
};

const formatRangeText = (ranges?: RangeDef[] | RangeDef | null): string | undefined => {
  const normalized = normalizeRanges(ranges);
  if (!normalized.length) return undefined;
  const range = normalized[0];
  if (range.min !== undefined && range.max !== undefined) return `${range.min}-${range.max}`;
  if (range.min !== undefined) return `>=${range.min}`;
  if (range.max !== undefined) return `<=${range.max}`;
  return undefined;
};

const classifyNumeric = (key: string, value: number, patientSex?: string | null): MeasurementStatus | null => {
  const { bands, preferNormal } = resolveBandsForKey(key, patientSex);
  if (!bands) return null;

  const normalMatch = matchesAnyRange(value, bands.normal);
  const borderlineMatch = matchesAnyRange(value, bands.borderline);
  const abnormalMatch = matchesAnyRange(value, bands.abnormal);

  const normalRangeText = formatRangeText(bands.normal);

  if (preferNormal) {
    if (normalMatch) return { status: 'normal', statusLabel: 'Normal', rangeText: normalRangeText };
    if (abnormalMatch) return { status: 'abnormal', statusLabel: 'Abnormal', rangeText: normalRangeText };
    if (borderlineMatch) return { status: 'borderline', statusLabel: 'Borderline', rangeText: normalRangeText };
  } else {
    if (abnormalMatch) return { status: 'abnormal', statusLabel: 'Abnormal', rangeText: normalRangeText };
    if (borderlineMatch) return { status: 'borderline', statusLabel: 'Borderline', rangeText: normalRangeText };
    if (normalMatch) return { status: 'normal', statusLabel: 'Normal', rangeText: normalRangeText };
  }

  if (normalizeRanges(bands.normal).length) {
    return { status: 'borderline', statusLabel: 'Borderline', rangeText: normalRangeText };
  }

  return null;
};

export const getNumericStatus = (
  key: string,
  value: number,
  patientSex?: string | null,
): MeasurementStatus | null => classifyNumeric(key, value, patientSex);

const classifyCategorical = (key: string, label: string): MeasurementStatus | null => {
  const def = NORMAL_RANGES[key];
  if (!def?.categories) return null;
  const normalize = (value: string) => value.trim().toLowerCase();
  const trimmed = normalize(label);
  const matches = (list: string[] | undefined) =>
    Array.isArray(list) && list.some((entry) => normalize(entry) === trimmed);
  if (matches(def.categories.normal)) return { status: 'normal', statusLabel: 'Normal' };
  if (matches(def.categories.borderline)) return { status: 'borderline', statusLabel: 'Borderline' };
  if (matches(def.categories.abnormal)) return { status: 'abnormal', statusLabel: 'Abnormal' };
  return null;
};

const buildSourceBadge = (task: IntegratedTask): { label: string | null; color: string; tooltip: string | null } => {
  const sources = Array.isArray(task.sources) ? task.sources : [];
  let label: string | null = null;
  let color = '#64748b';

  if (sources.length > 1) {
    label = task.discrepancy ? 'F!' : 'F';
    color = task.discrepancy ? '#f97316' : '#8b5cf6';
  } else if (sources[0] === 'PanEcho') {
    label = task.discrepancy ? 'P!' : 'P';
    color = task.discrepancy ? '#f97316' : '#0ea5e9';
  } else if (sources[0] === 'EchoPrime') {
    label = task.discrepancy ? 'E!' : 'E';
    color = task.discrepancy ? '#f97316' : '#14b8a6';
  }

  const tooltipParts = [] as string[];
  if (sources.length) tooltipParts.push(`Sources: ${sources.join(' + ')}`);
  if (task.discrepancy) tooltipParts.push('Discrepancy flagged');

  return { label, color, tooltip: tooltipParts.length ? tooltipParts.join(' | ') : null };
};

const getClassificationConfidence = (task: IntegratedTask, label: string): number | null => {
  const panechoMap = task.panecho_value_or_prob;
  if (panechoMap && typeof panechoMap === 'object' && !Array.isArray(panechoMap)) {
    const map = panechoMap as Record<string, unknown>;
    const direct = map[label];
    const directNum = toNumber(direct);
    if (directNum !== null) return directNum;
    const values = Object.values(map).map(toNumber).filter((val): val is number => val !== null);
    if (values.length) return Math.max(...values);
  }

  const echoProb = toNumber(task.echoprime_value_or_prob);
  if (echoProb !== null && echoProb >= 0 && echoProb <= 1) return echoProb;

  const integratedProb = toNumber(task.integrated_value);
  if (integratedProb !== null && integratedProb >= 0 && integratedProb <= 1) return integratedProb;

  return null;
};

const formatConfidence = (value: number | null): string | null => {
  if (value === null || value < 0.05) return null;
  if (value <= 1) return `${Math.round(value * 100)}%`;
  return null;
};

const extractNumericInputs = (task: IntegratedTask): number[] => {
  const values = [task.panecho_value_or_prob, task.echoprime_value_or_prob]
    .map(toNumber)
    .filter((val): val is number => val !== null);
  return values;
};

const buildIntegratedItem = (
  key: string,
  label: string,
  task: IntegratedTask,
  patientSex?: string | null,
): IntegratedItem | null => {
  const units = typeof task.units === 'string' ? task.units : null;
  const isClassification = units === null;
  const integratedLabel = typeof task.integrated_label === 'string' ? task.integrated_label : null;
  const integratedValue = toNumber(task.integrated_value);
  const sourceBadge = buildSourceBadge(task);

  if (isClassification) {
    if (!integratedLabel) {
      return {
        key,
        label,
        value: PLACEHOLDER_TEXT,
        unit: null,
        status: null,
        numericValue: null,
        sourceLabel: sourceBadge.label,
        sourceColor: sourceBadge.color,
        confidenceText: null,
        tooltip: sourceBadge.tooltip,
      };
    }
    const status = classifyCategorical(key, integratedLabel);
    const confidence = getClassificationConfidence(task, integratedLabel);
    return {
      key,
      label,
      value: integratedLabel,
      unit: null,
      status: status ?? null,
      numericValue: integratedValue,
      sourceLabel: sourceBadge.label,
      sourceColor: sourceBadge.color,
      confidenceText: formatConfidence(confidence),
      tooltip: sourceBadge.tooltip,
    };
  }

  const numericInputs = extractNumericInputs(task);
  const hasSources = Array.isArray(task.sources) && task.sources.length > 0;
  const numericValue = integratedValue ?? (numericInputs.length ? numericInputs.reduce((a, b) => a + b, 0) / numericInputs.length : null);

  if (numericValue === null || (numericValue === 0 && !hasSources)) {
    return {
      key,
      label,
      value: PLACEHOLDER_TEXT,
      unit: units,
      status: null,
      numericValue: null,
      sourceLabel: sourceBadge.label,
      sourceColor: sourceBadge.color,
      confidenceText: null,
      tooltip: sourceBadge.tooltip,
    };
  }

  let display: string | number | null = null;
  if (RANGE_KEYS.has(key) && numericInputs.length >= 2) {
    const min = Math.min(...numericInputs);
    const max = Math.max(...numericInputs);
    display = `${formatNumber(min)}-${formatNumber(max)}`;
  } else {
    display = formatNumber(numericValue);
  }

  const status = classifyNumeric(key, numericValue, patientSex);

  return {
    key,
    label,
    value: display,
    unit: units,
    status: status ?? null,
    numericValue,
    sourceLabel: sourceBadge.label,
    sourceColor: sourceBadge.color,
    confidenceText: null,
    tooltip: sourceBadge.tooltip,
  };
};

export const buildIntegratedMeasurements = (
  tasks: Record<string, IntegratedTask> | null,
  patientSex?: string | null,
): { mainMeasurements: IntegratedItem[]; sections: IntegratedSection[] } => {
  if (!tasks) return { mainMeasurements: [], sections: [] };

  const used = new Set<string>();

  const mainMeasurements = MAIN_KEYS
    .map((entry) => {
      const task = tasks[entry.key];
      if (!task) return null;
      const item = buildIntegratedItem(entry.key, entry.label, task, patientSex);
      if (item) used.add(entry.key);
      return item;
    })
    .filter((item): item is IntegratedItem => Boolean(item));

  const sections = Object.entries(SECTION_MAP)
    .map(([section, entries]) => {
      const items = Object.entries(entries)
        .map(([key, label]) => {
          const task = tasks[key];
          if (!task) return null;
          const item = buildIntegratedItem(key, label, task, patientSex);
          if (item) used.add(key);
          return item;
        })
        .filter((item): item is IntegratedItem => Boolean(item));
      return items.length ? { section, items } : null;
    })
    .filter((section): section is IntegratedSection => Boolean(section));

  const leftoverItems = Object.entries(tasks)
    .filter(([key]) => !used.has(key))
    .map(([key, task]) => {
      const label = LABEL_MAP[key] ?? toTitleCase(key);
      return buildIntegratedItem(key, label, task, patientSex);
    })
    .filter((item): item is IntegratedItem => Boolean(item));

  if (leftoverItems.length) {
    sections.push({ section: 'Other Findings', items: leftoverItems });
  }

  return { mainMeasurements, sections };
};

export const buildEchoPrimeSignals = (
  metrics: Record<string, unknown> | null,
  patientSex?: string | null,
): EchoPrimeSignal[] => {
  if (!metrics) return [];
  const config = thresholdsConfig as Record<string, {
    echoprime_name?: string | null;
    echoprime_threshold?: number | null;
    units?: string | null;
  }>;

  const signals: EchoPrimeSignal[] = [];

  Object.entries(config).forEach(([taskKey, cfg]) => {
    const metricKey = cfg?.echoprime_name;
    if (!metricKey) return;
    const rawValue = metrics[metricKey];
    const numericValue = toNumber(rawValue);
    if (numericValue === null) return;

    const label = LABEL_MAP[taskKey] ?? toTitleCase(taskKey);

    if (cfg.units) {
      const rangeKey = taskKey === 'pulmonary_artery_pressure'
        ? 'pulmonary_artery_pressure'
        : taskKey;
      const status = classifyNumeric(rangeKey, numericValue, patientSex);
      if (!status || status.status === 'normal') return;
      signals.push({
        key: taskKey,
        label,
        value: formatNumber(numericValue),
        unit: cfg.units,
        status,
      });
      return;
    }

    const threshold = cfg.echoprime_threshold;
    if (threshold === null || threshold === undefined) return;
    if (numericValue < threshold) return;

    signals.push({
      key: taskKey,
      label,
      value: 'Present',
      unit: null,
      status: { status: 'abnormal', statusLabel: 'Abnormal' },
      confidenceText: formatConfidence(numericValue),
    });
  });

  return signals;
};

export const getLabelForKey = (key: string): string => LABEL_MAP[key] ?? toTitleCase(key);

const toTitleCase = (raw: string): string =>
  raw
    .replace(/_/g, ' ')
    .replace(/\b[a-z]/g, (match) => match.toUpperCase());

export const statusToSeverity = (status: MeasurementStatus | null | undefined): 'normal' | 'mild' | 'severe' | null => {
  if (!status) return null;
  if (status.status === 'normal') return 'normal';
  if (status.status === 'borderline') return 'mild';
  return 'severe';
};
