import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
} from '../hooks/useViewerPreferences';
import type { ViewerPreferences } from '../hooks/useViewerPreferences';

/** An in-memory Storage, so tests never touch the real one. */
function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

/** Storage that refuses every operation, like a browser blocking site data. */
const hostileStorage = (): Storage =>
  ({
    get length(): number {
      throw new Error('blocked');
    },
    clear: () => {
      throw new Error('blocked');
    },
    getItem: () => {
      throw new Error('blocked');
    },
    key: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  }) as unknown as Storage;

describe('loadPreferences', () => {
  it('returns the defaults for empty storage', () => {
    expect(loadPreferences(memoryStorage())).toEqual(DEFAULT_PREFERENCES);
  });

  it('reads a stored boolean', () => {
    const prefs = loadPreferences(memoryStorage({ viewer_edge_snap: 'true' }));
    expect(prefs.edgeSnapEnabled).toBe(true);
  });

  it('reads a stored false, rather than treating it as absent', () => {
    const prefs = loadPreferences(memoryStorage({ viewer_auto_track_cine: 'false' }));
    expect(prefs.autoTrackCine).toBe(false);
  });

  it('reads a stored enum', () => {
    const prefs = loadPreferences(memoryStorage({ viewer_polygon_sampling: 'dense' }));
    expect(prefs.polygonSamplingPreset).toBe('dense');
  });

  it('falls back on an unrecognised enum value', () => {
    const prefs = loadPreferences(memoryStorage({ viewer_polygon_sampling: 'chunky' }));
    expect(prefs.polygonSamplingPreset).toBe(DEFAULT_PREFERENCES.polygonSamplingPreset);
  });

  it('falls back on a non-numeric number', () => {
    const prefs = loadPreferences(memoryStorage({ viewer_cine_fps: 'fast' }));
    expect(prefs.cineFps).toBe(DEFAULT_PREFERENCES.cineFps);
  });

  it('clamps a number outside its range', () => {
    expect(loadPreferences(memoryStorage({ viewer_cine_fps: '9999' })).cineFps).toBe(60);
    expect(loadPreferences(memoryStorage({ viewer_cine_fps: '-5' })).cineFps).toBe(1);
  });

  it('falls back per key rather than discarding the whole set', () => {
    const prefs = loadPreferences(
      memoryStorage({
        viewer_polygon_sampling: 'nonsense',
        viewer_edge_snap: 'true',
      })
    );
    expect(prefs.polygonSamplingPreset).toBe(DEFAULT_PREFERENCES.polygonSamplingPreset);
    expect(prefs.edgeSnapEnabled).toBe(true);
  });

  it('returns defaults when storage throws', () => {
    expect(loadPreferences(hostileStorage())).toEqual(DEFAULT_PREFERENCES);
  });

  it('returns defaults when there is no storage at all', () => {
    expect(loadPreferences(null)).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('savePreferences', () => {
  it('writes every declared preference', () => {
    const storage = memoryStorage();
    savePreferences(DEFAULT_PREFERENCES, storage);
    // The regression this guards: a preference added to state but missing from
    // the persistence list, which silently forgets itself between sessions.
    expect(storage.length).toBe(Object.keys(DEFAULT_PREFERENCES).length);
  });

  it('round-trips every preference unchanged', () => {
    const storage = memoryStorage();
    const custom: ViewerPreferences = {
      ...DEFAULT_PREFERENCES,
      autoTrackCine: false,
      preferJpegForCine: false,
      clipSheetEnabled: false,
      smoothContoursEnabled: false,
      smoothContoursIterations: 3,
      edgeSnapEnabled: true,
      smoothTrackingEnabled: false,
      smoothTrackingWindow: 5,
      showTrackingTrails: false,
      trackingTrailLength: 9,
      autoFitOnRotate: false,
      autoPromoteTracking: false,
      guidelineCopilotEnabled: false,
      polygonSamplingPreset: 'sparse',
      cineFps: 24,
      measurementScope: 'frame',
    };

    savePreferences(custom, storage);
    expect(loadPreferences(storage)).toEqual(custom);
  });

  it('rounds a fractional frame rate', () => {
    const storage = memoryStorage();
    savePreferences({ ...DEFAULT_PREFERENCES, cineFps: 23.7 }, storage);
    expect(storage.getItem('viewer_cine_fps')).toBe('24');
  });

  it('does not throw when storage refuses writes', () => {
    expect(() => savePreferences(DEFAULT_PREFERENCES, hostileStorage())).not.toThrow();
  });

  it('does nothing when there is no storage', () => {
    expect(() => savePreferences(DEFAULT_PREFERENCES, null)).not.toThrow();
  });
});

describe('preference schema', () => {
  it('uses a distinct storage key per preference', () => {
    const storage = memoryStorage();
    savePreferences(DEFAULT_PREFERENCES, storage);
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('namespaces every key under viewer_', () => {
    const storage = memoryStorage();
    savePreferences(DEFAULT_PREFERENCES, storage);
    for (let i = 0; i < storage.length; i += 1) {
      expect(storage.key(i)).toMatch(/^viewer_/);
    }
  });
});
