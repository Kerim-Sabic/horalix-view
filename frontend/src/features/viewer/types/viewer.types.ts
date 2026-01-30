/**
 * Viewer Types
 *
 * Core types for the DICOM viewer including viewport state,
 * frame indexing, image dimensions, and viewer context.
 */

import type { PixelSpacing } from './measurement.types';

// ============================================================================
// Viewport State
// ============================================================================

/**
 * Window/Level settings for image display
 */
export interface WindowLevel {
  center: number;
  width: number;
}

/**
 * Pan offset in screen pixels
 */
export interface PanOffset {
  x: number;
  y: number;
}

/**
 * Complete viewport state for a series
 */
export interface ViewportState {
  /** Zoom level (1 = fit to screen) */
  zoom: number;
  /** Pan offset from center */
  pan: PanOffset;
  /** Window/Level settings */
  windowLevel: WindowLevel;
  /** Rotation angle in degrees */
  rotation: number;
  /** Current slice/frame index */
  sliceIndex: number;
}

/**
 * Create default viewport state
 */
export function createDefaultViewportState(): ViewportState {
  return {
    zoom: 1,
    pan: { x: 0, y: 0 },
    windowLevel: { center: 40, width: 400 },
    rotation: 0,
    sliceIndex: 0,
  };
}

// ============================================================================
// Frame Indexing
// ============================================================================

/**
 * Frame index entry - maps slice index to DICOM instance/frame
 */
export interface FrameIndex {
  /** SOP Instance UID */
  instanceUid: string;
  /** Frame index within multi-frame instance (0-based) */
  frameIndex: number;
  /** Image rows (height) */
  rows: number | null;
  /** Image columns (width) */
  columns: number | null;
  /** DICOM Instance Number */
  instanceNumber: number | null;
  /** Total number of frames in the instance */
  numberOfFrames: number;
}

// ============================================================================
// Image Dimensions
// ============================================================================

/**
 * Image dimensions in pixels
 */
export interface ImageDimensions {
  rows: number;
  columns: number;
}

/**
 * Viewport size in screen pixels
 */
export interface ViewportSize {
  width: number;
  height: number;
}

// ============================================================================
// Coordinate Transform Context
// ============================================================================

/**
 * Context required for coordinate transformations
 */
export interface CoordinateTransformContext {
  /** Viewport size in screen pixels */
  viewportSize: ViewportSize;
  /** Image dimensions in pixels */
  imageDimensions: ImageDimensions;
  /** Current viewport state */
  viewportState: ViewportState;
  /** Base scale factor to fit image in viewport */
  baseScale: number;
}

// ============================================================================
// Viewer Context
// ============================================================================

/**
 * Current viewer context with all necessary information
 * for measurement operations
 */
export interface ViewerContext {
  /** Current series UID */
  seriesUid: string | null;
  /** Current frame key (instanceUid:frameIndex) */
  frameKey: string | null;
  /** Current slice index (0-based) */
  currentSlice: number;
  /** Total number of slices */
  totalSlices: number;
  /** Image dimensions */
  dimensions: ImageDimensions;
  /** Pixel spacing from DICOM metadata */
  pixelSpacing: PixelSpacing | null;
  /** Viewport size */
  viewportSize: ViewportSize;
  /** Effective scale (baseScale * zoom) */
  scale: number;
  /** Base scale to fit image */
  baseScale: number;
}

// ============================================================================
// Series & Study Types (mirrors API types for convenience)
// ============================================================================

/**
 * Series information for display
 */
export interface SeriesInfo {
  seriesInstanceUid: string;
  studyInstanceUid: string;
  seriesNumber: number | null;
  seriesDescription: string | null;
  modality: string;
  numInstances: number;
  sliceThickness: number | null;
  spacingBetweenSlices: number | null;
}

/**
 * Study information for display
 */
export interface StudyInfo {
  studyInstanceUid: string;
  patientName: string;
  patientId: string;
  studyDate: string | null;
  studyDescription: string | null;
  accessionNumber: string | null;
  modalities: string[];
  numSeries: number;
}

// ============================================================================
// Loading & Error States
// ============================================================================

/**
 * Loading state for async operations
 */
export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

/**
 * Error state with message
 */
export interface ErrorState {
  code: string;
  message: string;
  details?: unknown;
}

// ============================================================================
// Cine Playback
// ============================================================================

/**
 * Cine playback state
 */
export interface CinePlaybackState {
  /** Whether playback is active */
  isPlaying: boolean;
  /** Frames per second */
  fps: number;
  /** Loop playback */
  loop: boolean;
  /** Current direction (1 = forward, -1 = backward) */
  direction: 1 | -1;
}

/**
 * Create default cine playback state
 */
export function createDefaultCineState(): CinePlaybackState {
  return {
    isPlaying: false,
    fps: 15,
    loop: true,
    direction: 1,
  };
}

// ============================================================================
// Orientation Markers
// ============================================================================

/**
 * DICOM orientation markers (L/R, A/P, H/F)
 */
export interface OrientationMarkers {
  left: string;
  right: string;
  top: string;
  bottom: string;
}

/**
 * Get axis label from orientation vector
 */
export function getAxisLabel(vector: [number, number, number]): string {
  const abs = vector.map((v) => Math.abs(v));
  const maxIndex = abs.indexOf(Math.max(...abs));
  const value = vector[maxIndex];

  if (maxIndex === 0) return value >= 0 ? 'L' : 'R'; // Left/Right
  if (maxIndex === 1) return value >= 0 ? 'P' : 'A'; // Posterior/Anterior
  return value >= 0 ? 'H' : 'F'; // Head/Feet
}

/**
 * Get orientation markers from DICOM Image Orientation Patient
 */
export function getOrientationMarkers(
  orientation?: number[] | null
): OrientationMarkers | null {
  if (!orientation || orientation.length !== 6) return null;

  const row: [number, number, number] = [
    orientation[0],
    orientation[1],
    orientation[2],
  ];
  const col: [number, number, number] = [
    orientation[3],
    orientation[4],
    orientation[5],
  ];

  return {
    left: getAxisLabel([-row[0], -row[1], -row[2]]),
    right: getAxisLabel(row),
    top: getAxisLabel([-col[0], -col[1], -col[2]]),
    bottom: getAxisLabel(col),
  };
}

// ============================================================================
// UI State
// ============================================================================

/**
 * Panel visibility state
 */
export interface PanelVisibility {
  seriesPanel: boolean;
  infoPanel: boolean;
  measurementPanel: boolean;
}

/**
 * Create default panel visibility
 */
export function createDefaultPanelVisibility(): PanelVisibility {
  return {
    seriesPanel: true,
    infoPanel: false,
    measurementPanel: false,
  };
}
