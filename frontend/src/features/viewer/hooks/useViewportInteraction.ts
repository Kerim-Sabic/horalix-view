/**
 * Viewport Interaction Hook
 *
 * Handles all mouse/touch/wheel interactions for the viewport:
 * - Pan (drag with pan tool)
 * - Zoom (drag with zoom tool, or wheel)
 * - Window/Level (drag with wwwl tool)
 * - Measurement drawing
 * - Selection and editing
 */

import { useCallback, useRef, useState } from 'react';
import type { ViewerTool, ViewportState, Point2D, WindowLevel, PanOffset, CoordinateTransformContext } from '../types';
import { screenToImage, calculateBaseScale } from '../services/coordinateService';
import {
  WHEEL_ZOOM_SPEED,
  WHEEL_SCROLL_THRESHOLD,
  WHEEL_MAX_SLICE_STEP,
  MIN_ZOOM,
  MAX_ZOOM,
  DRAG_ZOOM_SPEED,
} from '../constants';

/**
 * Local drag state interface for viewport interactions
 */
interface LocalDragState {
  tool: ViewerTool;
  startX: number;
  startY: number;
  startImagePoint: Point2D | null;
  startPan: PanOffset;
  startZoom: number;
  startWindowLevel: WindowLevel;
}

// ============================================================================
// Types
// ============================================================================

interface ViewportInteractionConfig {
  activeTool: ViewerTool;
  viewportState: ViewportState;
  imageDimensions: { columns: number; rows: number };
  viewportSize: { width: number; height: number };
  totalSlices: number;
  currentSlice: number;
}

interface ViewportInteractionCallbacks {
  onPanChange: (pan: Point2D) => void;
  onZoomChange: (zoom: number, center?: Point2D) => void;
  onWindowLevelChange: (wl: { center: number; width: number }) => void;
  onSliceChange: (slice: number) => void;
  onRotate: () => void;

  // Measurement callbacks
  onMeasurementStart?: (point: Point2D, tool: ViewerTool) => void;
  onMeasurementMove?: (point: Point2D) => void;
  onMeasurementEnd?: (point: Point2D) => void;
  onMeasurementClick?: (point: Point2D, tool: ViewerTool) => void;

  // Selection callbacks
  onSelectionClick?: (point: Point2D) => void;
  onHandleDrag?: (point: Point2D) => void;
  onHandleDragEnd?: () => void;
}

interface UseViewportInteractionReturn {
  // Event handlers
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseMove: (e: React.MouseEvent) => void;
  handleMouseUp: (e: React.MouseEvent) => void;
  handleWheel: (e: React.WheelEvent) => void;
  handleDoubleClick: (e: React.MouseEvent) => void;
  handleContextMenu: (e: React.MouseEvent) => void;

  // State
  isDragging: boolean;
  dragState: LocalDragState | null;
  lastPointer: Point2D | null;
  cursor: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getCursorForTool(tool: ViewerTool, isDragging: boolean): string {
  if (isDragging) {
    switch (tool) {
      case 'pan':
        return 'grabbing';
      case 'zoom':
        return 'zoom-in';
      case 'wwwl':
        return 'crosshair';
      default:
        return 'default';
    }
  }

  switch (tool) {
    case 'pointer':
      return 'default';
    case 'pan':
      return 'grab';
    case 'zoom':
      return 'zoom-in';
    case 'wwwl':
      return 'crosshair';
    case 'rotate':
      return 'grab';
    case 'line':
    case 'polygon':
    case 'polyline':
    case 'freehand':
    case 'ellipse':
    case 'rectangle':
      return 'crosshair';
    default:
      return 'default';
  }
}

// ============================================================================
// Hook
// ============================================================================

export function useViewportInteraction(
  config: ViewportInteractionConfig,
  callbacks: ViewportInteractionCallbacks
): UseViewportInteractionReturn {
  const {
    activeTool,
    viewportState,
    totalSlices,
    currentSlice,
  } = config;

  const {
    onPanChange,
    onZoomChange,
    onWindowLevelChange,
    onSliceChange,
    onRotate,
    onMeasurementStart,
    onMeasurementMove,
    onMeasurementEnd,
    onMeasurementClick,
    onSelectionClick,
    onHandleDrag,
    onHandleDragEnd,
  } = callbacks;

  // State
  const [isDragging, setIsDragging] = useState(false);
  const [dragState, setDragState] = useState<LocalDragState | null>(null);
  const [lastPointer, setLastPointer] = useState<Point2D | null>(null);

  // Refs for avoiding stale closures
  const viewportStateRef = useRef(viewportState);
  viewportStateRef.current = viewportState;

  const wheelAccumulatorRef = useRef(0);

  // Convert screen coordinates to image coordinates
  const screenToImageCoords = useCallback(
    (screenX: number, screenY: number, viewportElement: HTMLElement): Point2D => {
      const rect = viewportElement.getBoundingClientRect();
      const viewportSize = { width: rect.width, height: rect.height };
      const baseScale = calculateBaseScale(viewportSize, config.imageDimensions);

      const context: CoordinateTransformContext = {
        viewportSize,
        imageDimensions: config.imageDimensions,
        viewportState: viewportStateRef.current,
        baseScale,
      };

      const result = screenToImage(
        screenX - rect.left,
        screenY - rect.top,
        context
      );

      // screenToImage can return null if outside bounds, but we always want a point
      return result || { x: 0, y: 0 };
    },
    [config.imageDimensions]
  );

  // Mouse down handler
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // Only handle left click

      const viewportElement = e.currentTarget as HTMLElement;
      const imagePoint = screenToImageCoords(e.clientX, e.clientY, viewportElement);

      setIsDragging(true);
      setLastPointer({ x: e.clientX, y: e.clientY });

      // Initialize drag state based on active tool
      const newDragState: LocalDragState = {
        tool: activeTool,
        startX: e.clientX,
        startY: e.clientY,
        startPan: { ...viewportState.pan },
        startZoom: viewportState.zoom,
        startWindowLevel: { ...viewportState.windowLevel },
        startImagePoint: imagePoint,
      };

      setDragState(newDragState);

      // Handle tool-specific start actions
      const isMeasurementTool = ['line', 'polygon', 'polyline', 'freehand', 'ellipse', 'rectangle'].includes(activeTool);

      if (activeTool === 'pointer') {
        onSelectionClick?.(imagePoint);
      } else if (isMeasurementTool) {
        onMeasurementStart?.(imagePoint, activeTool);
      } else if (activeTool === 'rotate') {
        onRotate();
      }

      e.preventDefault();
    },
    [
      activeTool,
      viewportState,
      screenToImageCoords,
      onSelectionClick,
      onMeasurementStart,
      onRotate,
    ]
  );

  // Mouse move handler
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const viewportElement = e.currentTarget as HTMLElement;
      const imagePoint = screenToImageCoords(e.clientX, e.clientY, viewportElement);

      setLastPointer({ x: e.clientX, y: e.clientY });

      if (!isDragging || !dragState) return;

      const deltaX = e.clientX - dragState.startX;
      const deltaY = e.clientY - dragState.startY;

      switch (dragState.tool) {
        case 'pan': {
          const newPan = {
            x: dragState.startPan.x + deltaX,
            y: dragState.startPan.y + deltaY,
          };
          onPanChange(newPan);
          break;
        }

        case 'zoom': {
          const zoomDelta = -deltaY * DRAG_ZOOM_SPEED;
          const newZoom = clamp(dragState.startZoom * (1 + zoomDelta), MIN_ZOOM, MAX_ZOOM);
          onZoomChange(newZoom);
          break;
        }

        case 'wwwl': {
          const widthDelta = deltaX * 2;
          const centerDelta = -deltaY * 2;
          const newWindow = {
            width: Math.max(1, dragState.startWindowLevel.width + widthDelta),
            center: dragState.startWindowLevel.center + centerDelta,
          };
          onWindowLevelChange(newWindow);
          break;
        }

        case 'line':
        case 'polyline':
        case 'freehand':
        case 'ellipse':
        case 'rectangle':
          onMeasurementMove?.(imagePoint);
          break;

        case 'pointer':
          onHandleDrag?.(imagePoint);
          break;

        default:
          break;
      }
    },
    [
      isDragging,
      dragState,
      screenToImageCoords,
      onPanChange,
      onZoomChange,
      onWindowLevelChange,
      onMeasurementMove,
      onHandleDrag,
    ]
  );

  // Mouse up handler
  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;

      const viewportElement = e.currentTarget as HTMLElement;
      const imagePoint = screenToImageCoords(e.clientX, e.clientY, viewportElement);

      const isMeasurementTool = dragState?.tool && ['line', 'polyline', 'freehand', 'ellipse', 'rectangle'].includes(dragState.tool);

      if (isMeasurementTool) {
        onMeasurementEnd?.(imagePoint);
      } else if (dragState?.tool === 'pointer') {
        onHandleDragEnd?.();
      }

      setIsDragging(false);
      setDragState(null);
    },
    [isDragging, dragState, screenToImageCoords, onMeasurementEnd, onHandleDragEnd]
  );

  // Wheel handler
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();

      // Check for modifier keys
      const isZooming = e.ctrlKey || e.metaKey;

      if (isZooming) {
        // Zoom at cursor position
        const viewportElement = e.currentTarget as HTMLElement;
        const rect = viewportElement.getBoundingClientRect();
        const cursorPoint = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };

        const zoomDelta = -e.deltaY * WHEEL_ZOOM_SPEED;
        const newZoom = clamp(
          viewportState.zoom * (1 + zoomDelta),
          MIN_ZOOM,
          MAX_ZOOM
        );

        onZoomChange(newZoom, cursorPoint);
      } else {
        // Scroll through slices
        if (totalSlices <= 1) return;

        wheelAccumulatorRef.current += e.deltaY;

        if (Math.abs(wheelAccumulatorRef.current) >= WHEEL_SCROLL_THRESHOLD) {
          const direction = wheelAccumulatorRef.current > 0 ? 1 : -1;
          const steps = Math.min(
            Math.floor(Math.abs(wheelAccumulatorRef.current) / WHEEL_SCROLL_THRESHOLD),
            WHEEL_MAX_SLICE_STEP
          );

          const newSlice = clamp(currentSlice + direction * steps, 0, totalSlices - 1);
          onSliceChange(newSlice);

          wheelAccumulatorRef.current = 0;
        }
      }
    },
    [viewportState.zoom, totalSlices, currentSlice, onZoomChange, onSliceChange]
  );

  // Double click handler
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const viewportElement = e.currentTarget as HTMLElement;
      const imagePoint = screenToImageCoords(e.clientX, e.clientY, viewportElement);

      // For polygon tool, double-click closes the polygon
      if (activeTool === 'polygon') {
        onMeasurementClick?.(imagePoint, activeTool);
      }
    },
    [activeTool, screenToImageCoords, onMeasurementClick]
  );

  // Context menu handler (prevent default)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // Cursor
  const cursor = getCursorForTool(activeTool, isDragging);

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    handleDoubleClick,
    handleContextMenu,
    isDragging,
    dragState,
    lastPointer,
    cursor,
  };
}

export default useViewportInteraction;
