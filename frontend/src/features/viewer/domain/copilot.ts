export type CopilotRequirement = {
  id: string;
  label: string;
  type: 'line' | 'polygon' | 'derived' | 'any';
  keywords: string[];
  optional?: boolean;
  description?: string;
};

type CopilotTemplate = {
  id: string;
  label: string;
  requirements: CopilotRequirement[];
};

export const COPILOT_TEMPLATES: Record<string, CopilotTemplate> = {
  echo: {
    id: 'echo',
    label: 'Echo Core Measurements',
    requirements: [
      {
        id: 'lvedd',
        label: 'LV end-diastolic diameter',
        type: 'line',
        keywords: ['lvedd', 'lv end diastolic', 'lv end-diastolic', 'lv diastolic'],
      },
      {
        id: 'lvesd',
        label: 'LV end-systolic diameter',
        type: 'line',
        keywords: ['lvesd', 'lv end systolic', 'lv end-systolic', 'lv systolic'],
      },
      {
        id: 'lv_mass_index',
        label: 'LV mass index',
        type: 'derived',
        keywords: ['lv mass', 'mass index'],
        optional: true,
      },
      {
        id: 'tr_vmax',
        label: 'TR Vmax',
        type: 'line',
        keywords: ['tr vmax', 'tr velocity', 'tr jet'],
        optional: true,
      },
      {
        id: 'rv_size',
        label: 'RV size',
        type: 'line',
        keywords: ['rv size', 'right ventricle', 'rv'],
      },
      {
        id: 'la_size',
        label: 'LA size',
        type: 'line',
        keywords: ['left atrium', 'la'],
      },
      {
        id: 'lvot',
        label: 'LVOT diameter',
        type: 'line',
        keywords: ['lvot', 'lv outflow'],
      },
      {
        id: 'ef',
        label: 'Ejection fraction',
        type: 'derived',
        keywords: ['ef', 'ejection fraction'],
      },
    ],
  },
  ct: {
    id: 'ct',
    label: 'CT Baseline Measurements',
    requirements: [
      {
        id: 'lesion_long',
        label: 'Target lesion long axis',
        type: 'line',
        keywords: ['long axis', 'long-axis', 'long diameter', 'lesion long'],
      },
      {
        id: 'lesion_short',
        label: 'Target lesion short axis',
        type: 'line',
        keywords: ['short axis', 'short-axis', 'short diameter', 'lesion short'],
      },
      {
        id: 'lesion_area',
        label: 'Target lesion area',
        type: 'polygon',
        keywords: ['lesion area', 'area'],
        optional: true,
      },
      {
        id: 'node_short',
        label: 'Lymph node short axis',
        type: 'line',
        keywords: ['node short', 'lymph node', 'node axis'],
        optional: true,
      },
    ],
  },
  mr: {
    id: 'mr',
    label: 'MR Baseline Measurements',
    requirements: [
      {
        id: 'volume_ed',
        label: 'End-diastolic volume',
        type: 'polygon',
        keywords: ['edv', 'end diastolic volume', 'end-diastolic volume'],
      },
      {
        id: 'volume_es',
        label: 'End-systolic volume',
        type: 'polygon',
        keywords: ['esv', 'end systolic volume', 'end-systolic volume'],
      },
      {
        id: 'ef',
        label: 'Ejection fraction',
        type: 'derived',
        keywords: ['ef', 'ejection fraction'],
      },
    ],
  },
  general: {
    id: 'general',
    label: 'Core Measurement Checklist',
    requirements: [
      {
        id: 'primary_length',
        label: 'Primary length',
        type: 'line',
        keywords: ['length', 'diameter', 'distance'],
      },
      {
        id: 'primary_area',
        label: 'Primary area',
        type: 'polygon',
        keywords: ['area', 'region'],
        optional: true,
      },
      {
        id: 'secondary_length',
        label: 'Secondary length',
        type: 'line',
        keywords: ['short', 'secondary'],
        optional: true,
      },
    ],
  },
};
