/**
 * Viewer Constants
 *
 * Contains all configurable constants for the DICOM viewer including:
 * - Zoom limits and interaction settings
 * - Window/Level presets by modality
 * - Default colors and styles
 * - Cine playback settings
 */

import type { WindowLevel } from '../types';

// ============================================================================
// Zoom Settings
// ============================================================================

/** Minimum zoom level (25% of fit-to-screen) */
export const MIN_ZOOM = 0.25;

/** Maximum zoom level (20x fit-to-screen) */
export const MAX_ZOOM = 20;

/** Default zoom level (fit-to-screen) */
export const DEFAULT_ZOOM = 1;

/** Zoom step for zoom in/out buttons */
export const ZOOM_STEP = 0.25;

/** Wheel zoom speed multiplier */
export const WHEEL_ZOOM_SPEED = 0.0005;

/** Drag zoom denominator (higher = slower zoom) */
export const DRAG_ZOOM_DENOMINATOR = 1600;

/** Drag zoom speed multiplier */
export const DRAG_ZOOM_SPEED = 0.005;

// ============================================================================
// Scroll Settings
// ============================================================================

/** Wheel scroll threshold for slice navigation */
export const WHEEL_SCROLL_THRESHOLD = 60;

/** Maximum slices to skip per wheel event */
export const WHEEL_MAX_SLICE_STEP = 8;

// ============================================================================
// Cine Playback Settings
// ============================================================================

/** Default cine playback FPS */
export const DEFAULT_CINE_FPS = 15;

/** Minimum cine FPS */
export const MIN_CINE_FPS = 1;

/** Maximum cine FPS */
export const MAX_CINE_FPS = 60;

// ============================================================================
// Image Cache Settings
// ============================================================================

/** Maximum images to keep in memory cache */
export const MAX_IMAGE_CACHE = 160;

/** Number of frames to preload ahead during playback */
export const PRELOAD_AHEAD_PLAYING = 8;

/** Number of frames to preload ahead when paused */
export const PRELOAD_AHEAD_PAUSED = 4;

/** Number of frames to preload behind */
export const PRELOAD_BEHIND = 2;

/** Ultrasound preload multiplier (more frames due to higher FPS) */
export const US_PRELOAD_MULTIPLIER = 1.5;

// ============================================================================
// Window/Level Presets
// ============================================================================

/** Window/Level preset definition */
export interface WindowLevelPreset {
  name: string;
  center: number;
  width: number;
}

/** Window/Level presets by modality */
export const WINDOW_LEVEL_PRESETS: Record<string, WindowLevelPreset[]> = {
  CT: [
    { name: 'Soft Tissue', center: 40, width: 400 },
    { name: 'Lung', center: -600, width: 1500 },
    { name: 'Bone', center: 300, width: 1500 },
    { name: 'Brain', center: 40, width: 80 },
    { name: 'Stroke', center: 40, width: 40 },
    { name: 'Liver', center: 60, width: 150 },
    { name: 'Mediastinum', center: 50, width: 350 },
    { name: 'Abdomen', center: 40, width: 350 },
  ],
  MR: [
    { name: 'Default', center: 400, width: 800 },
    { name: 'T1', center: 500, width: 1000 },
    { name: 'T2', center: 300, width: 1200 },
    { name: 'FLAIR', center: 400, width: 800 },
    { name: 'Brain', center: 500, width: 1000 },
  ],
  XR: [
    { name: 'Default', center: 1500, width: 3000 },
    { name: 'Chest', center: 1024, width: 4096 },
    { name: 'Bone', center: 500, width: 2000 },
    { name: 'Soft Tissue', center: 400, width: 1000 },
  ],
  CR: [
    { name: 'Default', center: 1500, width: 3000 },
    { name: 'Chest', center: 1024, width: 4096 },
    { name: 'Bone', center: 500, width: 2000 },
  ],
  DX: [
    { name: 'Default', center: 1500, width: 3000 },
    { name: 'Chest', center: 1024, width: 4096 },
    { name: 'Bone', center: 500, width: 2000 },
  ],
  US: [
    { name: 'Default', center: 128, width: 256 },
  ],
  PT: [
    { name: 'Default', center: 50, width: 350 },
    { name: 'Hot', center: 10, width: 20 },
    { name: 'Bone', center: 100, width: 500 },
  ],
  NM: [
    { name: 'Default', center: 128, width: 256 },
  ],
  MG: [
    { name: 'Default', center: 2048, width: 4096 },
    { name: 'Dense', center: 2500, width: 3000 },
    { name: 'Fatty', center: 1500, width: 3000 },
  ],
  RF: [
    { name: 'Default', center: 128, width: 256 },
  ],
  XA: [
    { name: 'Default', center: 128, width: 256 },
  ],
};

/** Default window/level for unknown modalities */
export const DEFAULT_WINDOW_LEVEL: WindowLevel = {
  center: 128,
  width: 256,
};

/**
 * Get window/level presets for a modality
 */
export function getWindowLevelPresets(modality: string): WindowLevelPreset[] {
  return WINDOW_LEVEL_PRESETS[modality.toUpperCase()] || [
    { name: 'Default', ...DEFAULT_WINDOW_LEVEL },
  ];
}

/**
 * Get default window/level for a modality
 */
export function getDefaultWindowLevel(modality: string): WindowLevel {
  const presets = getWindowLevelPresets(modality);
  return presets.length > 0
    ? { center: presets[0].center, width: presets[0].width }
    : DEFAULT_WINDOW_LEVEL;
}

// ============================================================================
// Measurement Settings
// ============================================================================

/** Hit test tolerance in screen pixels */
export const HIT_TEST_TOLERANCE = 8;

/** Close polygon threshold in pixels */
export const POLYGON_CLOSE_THRESHOLD = 10;

/** Minimum distance between polygon vertices */
export const MIN_VERTEX_DISTANCE = 3;

/** Freehand sampling interval in pixels */
export const FREEHAND_SAMPLE_INTERVAL = 2;

/** Maximum undo history size */
export const MAX_UNDO_HISTORY = 50;

// ============================================================================
// Measurement Colors
// ============================================================================

/** Default measurement colors */
export const MEASUREMENT_COLORS = {
  default: '#3b82f6', // blue-500
  selected: '#10b981', // emerald-500
  hovered: '#60a5fa', // blue-400
  tracking: '#f59e0b', // amber-500
  error: '#ef4444', // red-500
};

/** Available measurement color palette */
export const COLOR_PALETTE = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
];

// ============================================================================
// UI Settings
// ============================================================================

/** Snackbar auto-hide duration in ms */
export const SNACKBAR_DURATION = 4000;

/** Tooltip delay in ms */
export const TOOLTIP_DELAY = 500;

/** Panel default widths */
export const PANEL_WIDTHS = {
  series: 200,
  info: 280,
  measurement: 280,
};

/** Animation durations in ms */
export const ANIMATION_DURATIONS = {
  fast: 150,
  normal: 300,
  slow: 500,
};

// ============================================================================
// AI Overlay Settings
// ============================================================================

/** Default AI overlay opacity */
export const AI_OVERLAY_OPACITY = 0.6;

/** Detection box stroke width */
export const DETECTION_STROKE_WIDTH = 2;

/** Detection label font size */
export const DETECTION_LABEL_FONT_SIZE = 12;

// ============================================================================
// 3D Volume Settings
// ============================================================================

/** Default MPR crosshair color */
export const MPR_CROSSHAIR_COLOR = '#00ff00';

/** Default MPR slice thickness */
export const MPR_DEFAULT_THICKNESS = 1;

// ============================================================================
// Keyboard Shortcuts
// ============================================================================

/** Keyboard shortcut definitions */
export const KEYBOARD_SHORTCUTS: Record<string, string> = {
  // Tools
  pointer: 'v',
  pan: 'h',
  zoom: 'z',
  wwwl: 'w',
  rotate: 'r',
  line: 'l',
  polygon: 'g',
  polyline: 'p',
  freehand: 'f',
  ellipse: 'e',
  rectangle: 'b',

  // Actions
  undo: 'ctrl+z',
  redo: 'ctrl+shift+z',
  delete: 'delete',
  escape: 'escape',
  playPause: 'space',
  nextSlice: 'arrowdown',
  prevSlice: 'arrowup',
  firstSlice: 'home',
  lastSlice: 'end',
  resetView: '0',
  fitToScreen: '1',
  actualSize: '2',
};
