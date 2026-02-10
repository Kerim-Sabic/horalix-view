/**
 * ViewerPage Constants
 *
 * Extracted from ViewerPage.tsx to reduce monolith size.
 * Contains all magic numbers, presets, and configuration constants.
 */

// ============================================================================
// Cache & Performance
// ============================================================================

export const MAX_IMAGE_CACHE = 300;
export const AI_JOB_POLL_INTERVAL_MS = 2000;
export const AI_JOB_TIMEOUT_MS = 900000;

// ============================================================================
// Zoom & Pan
// ============================================================================

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const ZOOM_STEP = 0.02;
export const WHEEL_ZOOM_SPEED = 0.0005;
export const DRAG_ZOOM_DENOMINATOR = 1600;

// ============================================================================
// Cine Playback
// ============================================================================

export const DEFAULT_CINE_FPS = 15;
export const WHEEL_SCROLL_THRESHOLD = 60;
export const WHEEL_MAX_SLICE_STEP = 8;

// ============================================================================
// Smoothing
// ============================================================================

export const PREVIEW_SMOOTHING = 0.35;

// ============================================================================
// Window/Level Presets
// ============================================================================

export const defaultPreset = { name: 'Default', center: 40, width: 400 };

export const defaultWindowLevel = { center: defaultPreset.center, width: defaultPreset.width };

export const modalityPresets: Record<string, Array<{ name: string; center: number; width: number }>> = {
  CT: [
    { name: 'Soft Tissue', center: 40, width: 400 },
    { name: 'Lung', center: -600, width: 1500 },
    { name: 'Bone', center: 300, width: 1500 },
    { name: 'Brain', center: 40, width: 80 },
  ],
  MR: [
    { name: 'Default', center: 40, width: 400 },
    { name: 'T1', center: 500, width: 1000 },
    { name: 'T2', center: 300, width: 1200 },
  ],
  XR: [{ name: 'Default', center: 1500, width: 3000 }],
  CR: [{ name: 'Default', center: 1500, width: 3000 }],
  DX: [{ name: 'Default', center: 1500, width: 3000 }],
  US: [{ name: 'Default', center: 40, width: 400 }],
  PT: [{ name: 'Default', center: 50, width: 350 }],
};
