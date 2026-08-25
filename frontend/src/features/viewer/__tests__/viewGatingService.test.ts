import { describe, expect, it } from 'vitest';

import {
  VIEW_CONFIDENCE_THRESHOLD,
  findBiplanePartner,
  gateVolumeTools,
  getViewCapability,
  normalizeView,
} from '../services/viewGatingService';

describe('normalizeView', () => {
  it('passes canonical labels through', () => {
    expect(normalizeView('A4C')).toBe('A4C');
    expect(normalizeView('Parasternal_Long')).toBe('Parasternal_Long');
  });

  it('maps legacy aliases onto canonical labels', () => {
    expect(normalizeView('PLAX')).toBe('Parasternal_Long');
    expect(normalizeView('psax')).toBe('Parasternal_Short');
    expect(normalizeView('a4c')).toBe('A4C');
    expect(normalizeView('RV_Inflow')).toBe('A4C');
  });

  it('returns Unknown for anything unrecognised', () => {
    expect(normalizeView('something else')).toBe('Unknown');
    expect(normalizeView(null)).toBe('Unknown');
    expect(normalizeView(undefined)).toBe('Unknown');
    expect(normalizeView('')).toBe('Unknown');
  });
});

describe('getViewCapability', () => {
  it('pairs the two apical views with each other', () => {
    expect(getViewCapability('A4C').pairsWith).toBe('A2C');
    expect(getViewCapability('A2C').pairsWith).toBe('A4C');
  });

  it('offers no biplane partner for non-apical views', () => {
    expect(getViewCapability('Parasternal_Long').pairsWith).toBeNull();
    expect(getViewCapability('A3C').pairsWith).toBeNull();
  });

  it('discourages A3C rather than forbidding it', () => {
    const capability = getViewCapability('A3C');
    expect(capability.singlePlane).toBe('discouraged');
    expect(capability.note).toMatch(/foreshorten/i);
  });
});

describe('gateVolumeTools', () => {
  it('offers biplane on a confident A4C', () => {
    const gate = gateVolumeTools({ view: 'A4C', confidence: 0.95, calibrated: true });
    expect(gate.allowed).toBe(true);
    expect(gate.confident).toBe(true);
    expect(gate.capability.biplane).toBe('preferred');
  });

  it('refuses without spatial calibration, whatever the view', () => {
    const gate = gateVolumeTools({ view: 'A4C', confidence: 0.99, calibrated: false });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/calibration/i);
  });

  it('refuses on a parasternal view', () => {
    const gate = gateVolumeTools({
      view: 'Parasternal_Long',
      confidence: 0.9,
      calibrated: true,
    });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/linear measurements/i);
  });

  it('refuses on A5C', () => {
    expect(gateVolumeTools({ view: 'A5C', confidence: 0.9, calibrated: true }).allowed).toBe(
      false
    );
  });

  it('allows but cautions below the confidence threshold', () => {
    const gate = gateVolumeTools({
      view: 'A4C',
      confidence: VIEW_CONFIDENCE_THRESHOLD - 0.01,
      calibrated: true,
    });
    expect(gate.allowed).toBe(true);
    expect(gate.confident).toBe(false);
    expect(gate.reason).toMatch(/confidence threshold/i);
  });

  it('leaves an unclassified view to the operator', () => {
    const gate = gateVolumeTools({ view: null, confidence: null, calibrated: true });
    expect(gate.view).toBe('Unknown');
    expect(gate.allowed).toBe(true);
    expect(gate.confident).toBe(false);
    expect(gate.reason).toMatch(/Confirm the view/i);
  });

  it('treats the threshold as inclusive', () => {
    const gate = gateVolumeTools({
      view: 'A4C',
      confidence: VIEW_CONFIDENCE_THRESHOLD,
      calibrated: true,
    });
    expect(gate.confident).toBe(true);
  });
});

describe('findBiplanePartner', () => {
  it('finds the A2C that completes an A4C', () => {
    const partner = findBiplanePartner('A4C', [
      { instanceUid: 'plax', view: 'Parasternal_Long', confidence: 0.99 },
      { instanceUid: 'a2c', view: 'A2C', confidence: 0.91 },
    ]);
    expect(partner?.instanceUid).toBe('a2c');
  });

  it('prefers the highest-confidence candidate', () => {
    const partner = findBiplanePartner('A4C', [
      { instanceUid: 'weak', view: 'A2C', confidence: 0.72 },
      { instanceUid: 'strong', view: 'A2C', confidence: 0.94 },
    ]);
    expect(partner?.instanceUid).toBe('strong');
  });

  it('ignores candidates below the confidence threshold', () => {
    const partner = findBiplanePartner('A4C', [
      { instanceUid: 'unsure', view: 'A2C', confidence: 0.4 },
    ]);
    expect(partner).toBeNull();
  });

  it('returns null when no complementary view exists', () => {
    const partner = findBiplanePartner('A4C', [
      { instanceUid: 'plax', view: 'Parasternal_Long', confidence: 0.99 },
    ]);
    expect(partner).toBeNull();
  });

  it('returns null for a view that cannot be paired', () => {
    expect(
      findBiplanePartner('Parasternal_Short', [
        { instanceUid: 'a2c', view: 'A2C', confidence: 0.99 },
      ])
    ).toBeNull();
  });
});
