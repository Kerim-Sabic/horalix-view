type EchoViewPattern = { label: string; keywords: string[] };

export const normalizeText = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const parseOptionalNumber = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (normalized === null) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

export const normalizeLabel = (value?: string | null) => {
  if (!value) return '';
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
};

export const labelHasKeyword = (label: string, keywords: string[]) =>
  keywords.some((keyword) => {
    const normalizedKeyword = keyword.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return normalizedKeyword ? label.includes(normalizedKeyword) : false;
  });

const ECHO_VIEW_PATTERNS: EchoViewPattern[] = [
  { label: 'A4C', keywords: ['a4c', 'apical 4', 'apical four', 'apical 4ch', '4ch'] },
  { label: 'A2C', keywords: ['a2c', 'apical 2', 'apical two', 'apical 2ch', '2ch'] },
  { label: 'A3C', keywords: ['a3c', 'apical 3', 'apical three', 'apical long', 'alax'] },
  { label: 'PLAX', keywords: ['plax', 'parasternal long', 'pslax'] },
  { label: 'PSAX', keywords: ['psax', 'parasternal short'] },
  { label: 'Subcostal', keywords: ['subcostal', 'sub xiphoid', 'subxiphoid'] },
  { label: 'Suprasternal', keywords: ['suprasternal', 'ssn'] },
  { label: 'RVOT', keywords: ['rvot', 'rv outflow'] },
  { label: 'LVOT', keywords: ['lvot', 'lv outflow'] },
  { label: 'Doppler', keywords: ['doppler', 'pw', 'cw', 'tissue doppler'] },
];

export const inferEchoView = (text: string) => {
  const normalized = normalizeLabel(text);
  if (!normalized) return null;
  for (const pattern of ECHO_VIEW_PATTERNS) {
    if (labelHasKeyword(normalized, pattern.keywords)) {
      return pattern.label;
    }
  }
  return null;
};
