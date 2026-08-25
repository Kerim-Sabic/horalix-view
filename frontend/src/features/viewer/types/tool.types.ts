/**
 * Tool Types
 *
 * Defines all viewer tools including navigation tools,
 * measurement tools, and annotation tools.
 */

import type { Point2D, MeasurementScope, Measurement } from './measurement.types';
import type { WindowLevel, PanOffset } from './viewer.types';

// ============================================================================
// Tool Type Definitions
// ============================================================================

/**
 * Tools are defined once in domain/tools.ts. This module re-exports them so
 * existing imports keep working, and adds the drag-state types that only the
 * interaction layer needs.
 */
export type {
  ViewerToolId,
  ViewerToolCategory,
  ViewerToolMeta,
} from '../domain/tools';

export {
  VIEWER_TOOLS,
  getToolMeta,
  getToolsByCategory,
  getDefaultTool,
  isNavigationTool,
  isMeasurementTool,
  isSelectionTool,
  isAreaTool,
  toolForShortcut,
  getToolCursor,
} from '../domain/tools';

import type { ViewerToolId } from '../domain/tools';

/** Canonical viewer tool union. Alias kept for existing call sites. */
export type ViewerTool = ViewerToolId;

// ============================================================================
// Pointer Tool Modes
// ============================================================================

/**
 * Pointer tool operation modes
 */
export type PointerMode = 'select' | 'move' | 'resize';

// ============================================================================
// Drag State
// ============================================================================

/**
 * State tracked during drag operations
 */
export interface DragState {
  /** Active tool during drag */
  tool: ViewerTool;
  /** Screen X coordinate at drag start */
  startX: number;
  /** Screen Y coordinate at drag start */
  startY: number;
  /** Image point at drag start (for measurements) */
  startImagePoint: Point2D | null;

  // Navigation tool state
  /** Pan offset at drag start */
  startPan?: PanOffset;
  /** Zoom level at drag start */
  startZoom?: number;
  /** Window/Level at drag start */
  startWindowLevel?: WindowLevel;
  /** Rotation at drag start */
  startRotation?: number;

  // Pointer tool state
  /** Selected measurement ID */
  selectedMeasurementId?: string;
  /** Pointer mode (select/move/resize) */
  pointerMode?: PointerMode;
  /** Index of control point being dragged */
  pointIndex?: number;

  // Measurement tool state
  /** Measurement being drawn */
  activeMeasurement?: Measurement;
  /** Frame key for frame-scoped measurements */
  frameKey?: string;
  /** Series key for series-scoped measurements */
  seriesKey?: string;
  /** Measurement scope */
  measurementScope?: MeasurementScope;
}

/**
 * Create initial drag state for a tool
 */
export function createDragState(
  tool: ViewerTool,
  startX: number,
  startY: number
): DragState {
  return {
    tool,
    startX,
    startY,
    startImagePoint: null,
  };
}
