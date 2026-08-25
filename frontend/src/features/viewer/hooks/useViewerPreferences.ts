/**
 * Viewer preferences
 *
 * Every setting the viewer remembers between sessions, declared once.
 *
 * These used to be sixteen `useState` calls in the page alongside a
 * load-from-localStorage effect and a save-to-localStorage effect, each with its
 * own hand-maintained list. Adding a preference meant editing three places, and
 * missing one of them produced a setting that silently forgot itself. Here the
 * schema below is the only list: reading, writing, parsing and clamping all
 * derive from it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DEFAULT_CINE_FPS, MIN_CINE_FPS, MAX_CINE_FPS } from '../constants';

export type PolygonSamplingPreset = 'sparse' | 'balanced' | 'dense';
export type MeasurementScope = 'frame' | 'cine';

export interface ViewerPreferences {
  /** Track a measurement across the cine as soon as it is drawn. */
  autoTrackCine: boolean;
  /** JPEG rather than PNG for ultrasound cines; smaller, slightly lossy. */
  preferJpegForCine: boolean;
  /** Fetch a whole cine as one tiled image instead of frame by frame. */
  clipSheetEnabled: boolean;
  /** Corner-cut traced contours when they are committed. */
  smoothContoursEnabled: boolean;
  smoothContoursIterations: number;
  /** Nudge traced points onto the nearest intensity edge. */
  edgeSnapEnabled: boolean;
  /** Average tracked contours across neighbouring frames. */
  smoothTrackingEnabled: boolean;
  smoothTrackingWindow: number;
  showTrackingTrails: boolean;
  trackingTrailLength: number;
  autoFitOnRotate: boolean;
  autoPromoteTracking: boolean;
  guidelineCopilotEnabled: boolean;
  polygonSamplingPreset: PolygonSamplingPreset;
  cineFps: number;
  measurementScope: MeasurementScope;
}

type Parser<T> = (raw: string) => T | null;

/**
 * Compile-time check that SPECS stays exhaustive: this fails if a field is
 * added to ViewerPreferences without a matching spec, which is the drift the
 * hook exists to prevent.
 */
type SpecCoverage = (typeof SPECS)[number]['key'];

const boolean: Parser<boolean> = (raw) =>
  raw === 'true' ? true : raw === 'false' ? false : null;

const integer =
  (min: number, max: number): Parser<number> =>
  (raw) => {
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value)) return null;
    return Math.min(max, Math.max(min, value));
  };

const oneOf =
  <T extends string>(allowed: readonly T[]): Parser<T> =>
  (raw) =>
    (allowed as readonly string[]).includes(raw) ? (raw as T) : null;

/**
 * The single source of truth. Order is irrelevant; membership is not.
 */
const SPECS = [
  { key: 'autoTrackCine', storageKey: 'viewer_auto_track_cine', fallback: true, parse: boolean },
  { key: 'preferJpegForCine', storageKey: 'viewer_prefer_jpeg_cine', fallback: true, parse: boolean },
  { key: 'clipSheetEnabled', storageKey: 'viewer_clip_sheet', fallback: true, parse: boolean },
  { key: 'smoothContoursEnabled', storageKey: 'viewer_smooth_contours', fallback: true, parse: boolean },
  {
    key: 'smoothContoursIterations',
    storageKey: 'viewer_smooth_contours_iterations',
    fallback: 1,
    parse: integer(0, 4),
  },
  { key: 'edgeSnapEnabled', storageKey: 'viewer_edge_snap', fallback: false, parse: boolean },
  { key: 'smoothTrackingEnabled', storageKey: 'viewer_smooth_tracking', fallback: true, parse: boolean },
  {
    key: 'smoothTrackingWindow',
    storageKey: 'viewer_smooth_tracking_window',
    fallback: 2,
    parse: integer(0, 10),
  },
  { key: 'showTrackingTrails', storageKey: 'viewer_show_tracking_trails', fallback: true, parse: boolean },
  {
    key: 'trackingTrailLength',
    storageKey: 'viewer_tracking_trail_length',
    fallback: 3,
    parse: integer(0, 20),
  },
  { key: 'autoFitOnRotate', storageKey: 'viewer_auto_fit_rotate', fallback: true, parse: boolean },
  { key: 'autoPromoteTracking', storageKey: 'viewer_auto_promote_tracking', fallback: true, parse: boolean },
  { key: 'guidelineCopilotEnabled', storageKey: 'viewer_guideline_copilot', fallback: true, parse: boolean },
  {
    key: 'polygonSamplingPreset',
    storageKey: 'viewer_polygon_sampling',
    fallback: 'balanced' as PolygonSamplingPreset,
    parse: oneOf(['sparse', 'balanced', 'dense'] as const),
  },
  {
    key: 'cineFps',
    storageKey: 'viewer_cine_fps',
    fallback: DEFAULT_CINE_FPS,
    parse: integer(MIN_CINE_FPS, MAX_CINE_FPS),
    serialize: (value: number) => String(Math.round(value)),
  },
  {
    key: 'measurementScope',
    storageKey: 'viewer_measurement_scope',
    fallback: 'cine' as MeasurementScope,
    parse: oneOf(['frame', 'cine'] as const),
  },
] as const;

const _specsAreExhaustive: Record<keyof ViewerPreferences, true> = Object.fromEntries(
  SPECS.map((spec) => [spec.key, true])
) as Record<SpecCoverage, true>;
void _specsAreExhaustive;

export const DEFAULT_PREFERENCES: ViewerPreferences = SPECS.reduce(
  (acc, spec) => ({ ...acc, [spec.key]: spec.fallback }),
  {} as ViewerPreferences
);

/**
 * Read preferences from storage, falling back per-key.
 *
 * A single corrupt value falls back on its own rather than discarding the whole
 * set, and storage being unavailable (private browsing, blocked site data)
 * yields the defaults rather than throwing during render.
 */
export function loadPreferences(storage: Storage | null = safeStorage()): ViewerPreferences {
  if (!storage) return { ...DEFAULT_PREFERENCES };

  const result = { ...DEFAULT_PREFERENCES };
  for (const spec of SPECS) {
    let raw: string | null = null;
    try {
      raw = storage.getItem(spec.storageKey);
    } catch {
      continue;
    }
    if (raw === null) continue;
    const parsed = (spec.parse as Parser<unknown>)(raw);
    if (parsed !== null) {
      (result as Record<string, unknown>)[spec.key] = parsed;
    }
  }
  return result;
}

/** Write every preference. Failures are ignored; persistence is a convenience. */
export function savePreferences(
  preferences: ViewerPreferences,
  storage: Storage | null = safeStorage()
): void {
  if (!storage) return;
  for (const spec of SPECS) {
    const value = preferences[spec.key];
    const serialized =
      'serialize' in spec && spec.serialize
        ? (spec.serialize as (v: unknown) => string)(value)
        : String(value);
    try {
      storage.setItem(spec.storageKey, serialized);
    } catch {
      // Quota or blocked storage; the session still works, it just forgets.
      return;
    }
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export interface UseViewerPreferencesResult {
  preferences: ViewerPreferences;
  /** Update one preference. */
  setPreference: <K extends keyof ViewerPreferences>(
    key: K,
    value: ViewerPreferences[K]
  ) => void;
  /** Restore every preference to its default. */
  resetPreferences: () => void;
}

/**
 * Viewer preferences, loaded once and persisted on change.
 *
 * Initialised lazily from storage so the first render already has the user's
 * settings — a load-in-an-effect would render the defaults first and then
 * visibly correct itself.
 */
export function useViewerPreferences(): UseViewerPreferencesResult {
  const [preferences, setPreferences] = useState<ViewerPreferences>(() => loadPreferences());

  // Skip the write that would otherwise fire immediately after the initial
  // load, rewriting storage with what it already contains.
  const hydrated = useRef(false);

  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    savePreferences(preferences);
  }, [preferences]);

  const setPreference = useCallback(
    <K extends keyof ViewerPreferences>(key: K, value: ViewerPreferences[K]) => {
      setPreferences((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
    },
    []
  );

  const resetPreferences = useCallback(() => {
    setPreferences({ ...DEFAULT_PREFERENCES });
  }, []);

  return useMemo(
    () => ({ preferences, setPreference, resetPreferences }),
    [preferences, setPreference, resetPreferences]
  );
}
