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
 * Navigation tools - modify viewport state
 */
export type NavigationTool = 'pan' | 'zoom' | 'wwwl' | 'rotate';

/**
 * Measurement tools - create measurements
 */
export type MeasurementTool =
  | 'line'
  | 'polyline'
  | 'polygon'
  | 'freehand'
  | 'ellipse'
  | 'rectangle';

/**
 * Selection tool - select and edit measurements
 */
export type SelectionTool = 'pointer';

/**
 * All viewer tools
 */
export type ViewerTool = SelectionTool | NavigationTool | MeasurementTool;

/**
 * Tool category for grouping in UI
 */
export type ToolCategory = 'selection' | 'navigation' | 'measurement';

// ============================================================================
// Tool Configuration
// ============================================================================

/**
 * Tool configuration for UI display
 */
export interface ToolConfig {
  /** Tool identifier */
  id: ViewerTool;
  /** Display label */
  label: string;
  /** MUI icon name or custom icon identifier */
  icon: string;
  /** CSS cursor style */
  cursor: string;
  /** Tool category */
  category: ToolCategory;
  /** Keyboard shortcut (optional) */
  shortcut?: string;
  /** Tooltip description */
  tooltip?: string;
}

/**
 * All tool configurations
 */
export const TOOL_CONFIGS: Record<ViewerTool, ToolConfig> = {
  // Selection tool
  pointer: {
    id: 'pointer',
    label: 'Select',
    icon: 'NearMe',
    cursor: 'default',
    category: 'selection',
    shortcut: 'V',
    tooltip: 'Select and edit measurements',
  },

  // Navigation tools
  pan: {
    id: 'pan',
    label: 'Pan',
    icon: 'PanTool',
    cursor: 'grab',
    category: 'navigation',
    shortcut: 'H',
    tooltip: 'Pan the image',
  },
  zoom: {
    id: 'zoom',
    label: 'Zoom',
    icon: 'ZoomIn',
    cursor: 'zoom-in',
    category: 'navigation',
    shortcut: 'Z',
    tooltip: 'Zoom in/out',
  },
  wwwl: {
    id: 'wwwl',
    label: 'Window/Level',
    icon: 'Contrast',
    cursor: 'crosshair',
    category: 'navigation',
    shortcut: 'W',
    tooltip: 'Adjust window/level',
  },
  rotate: {
    id: 'rotate',
    label: 'Rotate',
    icon: 'RotateRight',
    cursor: 'crosshair',
    category: 'navigation',
    shortcut: 'R',
    tooltip: 'Rotate the image',
  },

  // Measurement tools
  line: {
    id: 'line',
    label: 'Line',
    icon: 'Straighten',
    cursor: 'crosshair',
    category: 'measurement',
    shortcut: 'L',
    tooltip: 'Measure distance',
  },
  polyline: {
    id: 'polyline',
    label: 'Polyline',
    icon: 'Timeline',
    cursor: 'crosshair',
    category: 'measurement',
    shortcut: 'P',
    tooltip: 'Measure path length',
  },
  polygon: {
    id: 'polygon',
    label: 'Polygon',
    icon: 'Pentagon',
    cursor: 'crosshair',
    category: 'measurement',
    shortcut: 'G',
    tooltip: 'Measure area',
  },
  freehand: {
    id: 'freehand',
    label: 'Freehand',
    icon: 'Gesture',
    cursor: 'crosshair',
    category: 'measurement',
    shortcut: 'F',
    tooltip: 'Draw freehand region',
  },
  ellipse: {
    id: 'ellipse',
    label: 'Ellipse',
    icon: 'CircleOutlined',
    cursor: 'crosshair',
    category: 'measurement',
    shortcut: 'E',
    tooltip: 'Measure elliptical area',
  },
  rectangle: {
    id: 'rectangle',
    label: 'Rectangle',
    icon: 'CropSquare',
    cursor: 'crosshair',
    category: 'measurement',
    shortcut: 'B',
    tooltip: 'Measure rectangular area',
  },
};

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if tool is a navigation tool
 */
export function isNavigationTool(tool: ViewerTool): tool is NavigationTool {
  return ['pan', 'zoom', 'wwwl', 'rotate'].includes(tool);
}

/**
 * Check if tool is a measurement tool
 */
export function isMeasurementTool(tool: ViewerTool): tool is MeasurementTool {
  return ['line', 'polyline', 'polygon', 'freehand', 'ellipse', 'rectangle'].includes(
    tool
  );
}

/**
 * Check if tool is the selection tool
 */
export function isSelectionTool(tool: ViewerTool): tool is SelectionTool {
  return tool === 'pointer';
}

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

// ============================================================================
// Tool Helper Functions
// ============================================================================

/**
 * Get cursor style for tool and state
 */
export function getToolCursor(
  tool: ViewerTool,
  isDragging: boolean,
  canInteract: boolean = true
): string {
  if (!canInteract) return 'not-allowed';

  if (isDragging) {
    if (tool === 'pan') return 'grabbing';
    if (tool === 'zoom') return 'zoom-in';
    return 'crosshair';
  }

  return TOOL_CONFIGS[tool].cursor;
}

/**
 * Get tools by category
 */
export function getToolsByCategory(category: ToolCategory): ViewerTool[] {
  return (Object.values(TOOL_CONFIGS) as ToolConfig[])
    .filter((config) => config.category === category)
    .map((config) => config.id);
}

/**
 * Get default tool
 */
export function getDefaultTool(): ViewerTool {
  return 'pointer';
}
