/**
 * Multi-Planar Reconstruction (MPR) Types
 *
 * Types for MPR views including axial, coronal, and sagittal planes
 * with synchronized crosshair navigation
 */

import type { WindowLevel } from './viewer.types';

// ============================================================================
// Plane Types
// ============================================================================

/** Available MPR plane orientations */
export type MPRPlane = 'axial' | 'coronal' | 'sagittal';

/** Plane-specific configuration */
export interface PlaneConfig {
  plane: MPRPlane;
  label: string;
  color: string;
  primaryAxis: 'x' | 'y' | 'z';
  secondaryAxis: 'x' | 'y' | 'z';
  normalAxis: 'x' | 'y' | 'z';
}

/** Default plane configurations */
export const PLANE_CONFIGS: Record<MPRPlane, PlaneConfig> = {
  axial: {
    plane: 'axial',
    label: 'Axial',
    color: '#00ff00', // Green
    primaryAxis: 'x',
    secondaryAxis: 'y',
    normalAxis: 'z',
  },
  coronal: {
    plane: 'coronal',
    label: 'Coronal',
    color: '#0000ff', // Blue
    primaryAxis: 'x',
    secondaryAxis: 'z',
    normalAxis: 'y',
  },
  sagittal: {
    plane: 'sagittal',
    label: 'Sagittal',
    color: '#ff0000', // Red
    primaryAxis: 'y',
    secondaryAxis: 'z',
    normalAxis: 'x',
  },
};

// ============================================================================
// Position Types
// ============================================================================

/** 3D position in volume coordinates (0-1 normalized) */
export interface VolumePosition {
  x: number;
  y: number;
  z: number;
}

/** 3D position in image indices */
export interface VolumeIndex {
  i: number;
  j: number;
  k: number;
}

/** 3D position in patient coordinates (mm) */
export interface PatientPosition {
  x: number;
  y: number;
  z: number;
}

// ============================================================================
// Volume Info
// ============================================================================

/** Volume dimensions and spacing */
export interface VolumeInfo {
  /** Volume dimensions in voxels [width, height, depth] */
  dimensions: [number, number, number];

  /** Voxel spacing in mm [x, y, z] */
  spacing: [number, number, number];

  /** Volume origin in patient coordinates */
  origin: PatientPosition;

  /** Image orientation (direction cosines) */
  orientation: number[][];

  /** Modality (CT, MR, etc.) */
  modality: string;

  /** Series UID */
  seriesUid: string;

  /** Min/max pixel values for windowing */
  pixelRange: {
    min: number;
    max: number;
  };
}

// ============================================================================
// MPR View State
// ============================================================================

/** State for a single MPR viewport */
export interface MPRViewState {
  /** Plane orientation */
  plane: MPRPlane;

  /** Current slice position (0 to dimensions[normalAxis] - 1) */
  sliceIndex: number;

  /** Zoom level (1 = fit to view) */
  zoom: number;

  /** Pan offset in screen pixels */
  pan: { x: number; y: number };

  /** Window/Level settings */
  windowLevel: WindowLevel;

  /** Crosshair visibility */
  showCrosshair: boolean;

  /** Slice thickness (MIP/slab rendering) */
  thickness: number;

  /** Rendering mode */
  renderMode: 'slice' | 'mip' | 'minip' | 'average';
}

/** Complete MPR state with all three views */
export interface MPRState {
  /** Crosshair position (shared across views) */
  crosshairPosition: VolumeIndex;

  /** Individual view states */
  views: {
    axial: MPRViewState;
    coronal: MPRViewState;
    sagittal: MPRViewState;
  };

  /** Volume information */
  volumeInfo: VolumeInfo | null;

  /** Active/focused view */
  activeView: MPRPlane | null;

  /** Whether views are linked (synchronized) */
  linked: boolean;

  /** Whether crosshairs are shown globally */
  showCrosshairs: boolean;
}

// ============================================================================
// Crosshair Types
// ============================================================================

/** Crosshair line for rendering */
export interface CrosshairLine {
  /** Source plane that this line represents */
  sourcePlane: MPRPlane;

  /** Color of the crosshair line */
  color: string;

  /** Line orientation: 'horizontal' or 'vertical' */
  orientation: 'horizontal' | 'vertical';

  /** Position in screen coordinates (percentage 0-100) */
  position: number;
}

/** Crosshair event for interaction */
export interface CrosshairDragEvent {
  /** View being interacted with */
  view: MPRPlane;

  /** New position in screen coordinates */
  screenPosition: { x: number; y: number };

  /** New position in volume coordinates */
  volumePosition: VolumeIndex;
}

// ============================================================================
// MPR Actions
// ============================================================================

/** MPR action types for undo/redo */
export type MPRAction =
  | { type: 'SET_CROSSHAIR'; before: VolumeIndex; after: VolumeIndex }
  | { type: 'SET_SLICE'; plane: MPRPlane; before: number; after: number }
  | { type: 'SET_WINDOW_LEVEL'; plane: MPRPlane; before: WindowLevel; after: WindowLevel }
  | { type: 'SET_ZOOM'; plane: MPRPlane; before: number; after: number };

// ============================================================================
// MPR API Types
// ============================================================================

/** Request for MPR slice image */
export interface MPRSliceRequest {
  seriesUid: string;
  plane: MPRPlane;
  sliceIndex: number;
  windowLevel: WindowLevel;
  thickness?: number;
  renderMode?: 'slice' | 'mip' | 'minip' | 'average';
}

/** Response with MPR slice image data */
export interface MPRSliceResponse {
  /** Base64 encoded image data */
  imageData: string;

  /** Image dimensions */
  width: number;
  height: number;

  /** Pixel spacing for measurements */
  pixelSpacing: { row: number; column: number };
}

// ============================================================================
// Initial States
// ============================================================================

/** Default MPR view state */
export function createDefaultMPRViewState(plane: MPRPlane): MPRViewState {
  return {
    plane,
    sliceIndex: 0,
    zoom: 1,
    pan: { x: 0, y: 0 },
    windowLevel: { center: 40, width: 400 },
    showCrosshair: true,
    thickness: 1,
    renderMode: 'slice',
  };
}

/** Default MPR state */
export function createDefaultMPRState(): MPRState {
  return {
    crosshairPosition: { i: 0, j: 0, k: 0 },
    views: {
      axial: createDefaultMPRViewState('axial'),
      coronal: createDefaultMPRViewState('coronal'),
      sagittal: createDefaultMPRViewState('sagittal'),
    },
    volumeInfo: null,
    activeView: null,
    linked: true,
    showCrosshairs: true,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the slice index for a plane from crosshair position
 */
export function getSliceFromCrosshair(position: VolumeIndex, plane: MPRPlane): number {
  switch (plane) {
    case 'axial':
      return position.k;
    case 'coronal':
      return position.j;
    case 'sagittal':
      return position.i;
  }
}

/**
 * Update crosshair position from a slice change
 */
export function updateCrosshairFromSlice(
  current: VolumeIndex,
  plane: MPRPlane,
  sliceIndex: number
): VolumeIndex {
  switch (plane) {
    case 'axial':
      return { ...current, k: sliceIndex };
    case 'coronal':
      return { ...current, j: sliceIndex };
    case 'sagittal':
      return { ...current, i: sliceIndex };
  }
}

/**
 * Clamp crosshair to volume bounds
 */
export function clampCrosshairToVolume(
  position: VolumeIndex,
  dimensions: [number, number, number]
): VolumeIndex {
  return {
    i: Math.max(0, Math.min(dimensions[0] - 1, position.i)),
    j: Math.max(0, Math.min(dimensions[1] - 1, position.j)),
    k: Math.max(0, Math.min(dimensions[2] - 1, position.k)),
  };
}

/**
 * Convert volume index to patient position
 */
export function volumeIndexToPatient(
  index: VolumeIndex,
  info: VolumeInfo
): PatientPosition {
  return {
    x: info.origin.x + index.i * info.spacing[0],
    y: info.origin.y + index.j * info.spacing[1],
    z: info.origin.z + index.k * info.spacing[2],
  };
}

/**
 * Convert patient position to volume index
 */
export function patientToVolumeIndex(
  position: PatientPosition,
  info: VolumeInfo
): VolumeIndex {
  return {
    i: Math.round((position.x - info.origin.x) / info.spacing[0]),
    j: Math.round((position.y - info.origin.y) / info.spacing[1]),
    k: Math.round((position.z - info.origin.z) / info.spacing[2]),
  };
}

/**
 * Get crosshair lines for a given view
 */
export function getCrosshairLinesForView(
  plane: MPRPlane,
  crosshair: VolumeIndex,
  dimensions: [number, number, number]
): CrosshairLine[] {
  const lines: CrosshairLine[] = [];

  switch (plane) {
    case 'axial':
      // Sagittal plane shown as vertical line
      lines.push({
        sourcePlane: 'sagittal',
        color: PLANE_CONFIGS.sagittal.color,
        orientation: 'vertical',
        position: (crosshair.i / (dimensions[0] - 1)) * 100,
      });
      // Coronal plane shown as horizontal line
      lines.push({
        sourcePlane: 'coronal',
        color: PLANE_CONFIGS.coronal.color,
        orientation: 'horizontal',
        position: (crosshair.j / (dimensions[1] - 1)) * 100,
      });
      break;

    case 'coronal':
      // Sagittal plane shown as vertical line
      lines.push({
        sourcePlane: 'sagittal',
        color: PLANE_CONFIGS.sagittal.color,
        orientation: 'vertical',
        position: (crosshair.i / (dimensions[0] - 1)) * 100,
      });
      // Axial plane shown as horizontal line
      lines.push({
        sourcePlane: 'axial',
        color: PLANE_CONFIGS.axial.color,
        orientation: 'horizontal',
        position: (crosshair.k / (dimensions[2] - 1)) * 100,
      });
      break;

    case 'sagittal':
      // Coronal plane shown as vertical line
      lines.push({
        sourcePlane: 'coronal',
        color: PLANE_CONFIGS.coronal.color,
        orientation: 'vertical',
        position: (crosshair.j / (dimensions[1] - 1)) * 100,
      });
      // Axial plane shown as horizontal line
      lines.push({
        sourcePlane: 'axial',
        color: PLANE_CONFIGS.axial.color,
        orientation: 'horizontal',
        position: (crosshair.k / (dimensions[2] - 1)) * 100,
      });
      break;
  }

  return lines;
}
