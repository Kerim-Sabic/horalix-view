import { describe, it, expect } from 'vitest';
import { buildIntegratedMeasurements } from '../components/AIResultsPanel/integratedMeasurements';

const buildTasks = () => ({
  ejection_fraction: {
    panecho_value_or_prob: 60,
    echoprime_value_or_prob: 52,
    integrated_value: 56,
    integrated_label: null,
    units: '%',
    sources: ['PanEcho', 'EchoPrime'],
  },
  pulmonary_artery_pressure: {
    panecho_value_or_prob: 35,
    echoprime_value_or_prob: 45,
    integrated_value: 40,
    integrated_label: null,
    units: 'mmHg',
    sources: ['PanEcho', 'EchoPrime'],
  },
  aortic_stenosis: {
    panecho_value_or_prob: { None: 0.1, Mild: 0.08, Severe: 0.02 },
    echoprime_value_or_prob: 0.0,
    integrated_value: 0.1,
    integrated_label: 'Mild',
    units: null,
    sources: ['PanEcho'],
  },
});

describe('buildIntegratedMeasurements', () => {
  it('builds ranges and statuses for main measurements', () => {
    const { mainMeasurements } = buildIntegratedMeasurements(buildTasks(), null);
    const ef = mainMeasurements.find((item) => item.key === 'ejection_fraction');
    const pap = mainMeasurements.find((item) => item.key === 'pulmonary_artery_pressure');

    expect(ef?.value).toBe('52-60');
    expect(ef?.status?.statusLabel).toBe('Normal');

    expect(pap?.value).toBe('35-45');
    expect(pap?.status?.statusLabel).toBe('Borderline');
  });

  it('classifies categorical tasks and includes confidence', () => {
    const { sections } = buildIntegratedMeasurements(buildTasks(), null);
    const valves = sections.find((section) => section.section === 'Valves');
    const avStenosis = valves?.items.find((item) => item.key === 'aortic_stenosis');

    expect(avStenosis?.value).toBe('Mild');
    expect(avStenosis?.status?.statusLabel).toBe('Borderline');
    expect(avStenosis?.confidenceText).toBe('8%');
  });
});
