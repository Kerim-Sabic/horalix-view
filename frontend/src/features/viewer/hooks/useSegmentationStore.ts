/**
 * Segmentation Editing Store
 *
 * Zustand store for managing AI segmentation editing including:
 * - Loading and displaying segmentation results
 * - Converting masks to editable contours
 * - Editing contour vertices
 * - Undo/redo support
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  AISegmentationResult,
  EditableContour,
  SegmentationClass,
  SegmentationEditAction,
  SegmentationEditTool,
} from '../types/aiSegmentation.types';
import {
  createEditableContour,
  simplifyPolygon,
  smoothPolygon,
  calculatePolygonAreaPx,
  areaPixelsToMm2,
} from '../types/aiSegmentation.types';
import type { Point2D, PixelSpacing } from '../types';

// ============================================================================
// Store Types
// ============================================================================

interface SegmentationState {
  /** Current segmentation result */
  segmentationResult: AISegmentationResult | null;

  /** Editable contours derived from segmentation */
  contours: Map<string, EditableContour>;

  /** Class definitions */
  classes: Map<number, SegmentationClass>;

  /** Selected contour ID */
  selectedContourId: string | null;

  /** Hovered contour ID */
  hoveredContourId: string | null;

  /** Current editing tool */
  editTool: SegmentationEditTool;

  /** Brush/eraser size */
  brushSize: number;

  /** Point being dragged */
  draggingPointIndex: number | null;

  /** Global visibility */
  overlayVisible: boolean;

  /** Global opacity (0-1) */
  overlayOpacity: number;

  /** Undo/redo stacks */
  undoStack: SegmentationEditAction[];
  redoStack: SegmentationEditAction[];

  /** Pixel spacing for area calculations */
  pixelSpacing: PixelSpacing | null;
}

interface SegmentationActions {
  // Loading
  loadSegmentation: (result: AISegmentationResult, pixelSpacing: PixelSpacing | null) => void;
  clearSegmentation: () => void;

  // Contour selection
  selectContour: (id: string | null) => void;
  setHoveredContour: (id: string | null) => void;

  // Visibility
  toggleOverlayVisible: () => void;
  setOverlayOpacity: (opacity: number) => void;
  toggleContourVisible: (id: string) => void;
  toggleClassVisible: (classId: number) => void;

  // Editing tool
  setEditTool: (tool: SegmentationEditTool) => void;
  setBrushSize: (size: number) => void;

  // Contour editing
  movePoint: (contourId: string, pointIndex: number, newPosition: Point2D) => void;
  addPoint: (contourId: string, position: Point2D, afterIndex: number) => void;
  removePoint: (contourId: string, pointIndex: number) => void;
  deleteContour: (id: string) => void;
  restoreContour: (id: string) => void;

  // Contour operations
  simplifyContour: (id: string, tolerance: number) => void;
  smoothContour: (id: string, iterations: number) => void;
  resetContour: (id: string) => void;

  // Undo/redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Queries
  getContour: (id: string) => EditableContour | undefined;
  getContoursForClass: (classId: number) => EditableContour[];
  getVisibleContours: () => EditableContour[];

  // Reset
  reset: () => void;
}

type SegmentationStore = SegmentationState & SegmentationActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: SegmentationState = {
  segmentationResult: null,
  contours: new Map(),
  classes: new Map(),
  selectedContourId: null,
  hoveredContourId: null,
  editTool: 'select',
  brushSize: 5,
  draggingPointIndex: null,
  overlayVisible: true,
  overlayOpacity: 0.6,
  undoStack: [],
  redoStack: [],
  pixelSpacing: null,
};

const MAX_UNDO_HISTORY = 50;

// ============================================================================
// Store Definition
// ============================================================================

export const useSegmentationStore = create<SegmentationStore>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    // ====================================================================
    // Loading
    // ====================================================================

    loadSegmentation: (result, pixelSpacing) => {
      const classes = new Map<number, SegmentationClass>();
      const contours = new Map<string, EditableContour>();

      // Load classes
      for (const cls of result.classes) {
        classes.set(cls.id, cls);
      }

      // Convert instances to editable contours
      for (const instance of result.instances) {
        const cls = classes.get(instance.classId);
        if (cls) {
          const contour = createEditableContour(instance, result.id, cls, pixelSpacing);
          contours.set(contour.id, contour);
        }
      }

      set({
        segmentationResult: result,
        contours,
        classes,
        pixelSpacing,
        selectedContourId: null,
        hoveredContourId: null,
        undoStack: [],
        redoStack: [],
      });
    },

    clearSegmentation: () => {
      set(initialState);
    },

    // ====================================================================
    // Selection
    // ====================================================================

    selectContour: (id) => {
      set({ selectedContourId: id });
    },

    setHoveredContour: (id) => {
      set({ hoveredContourId: id });
    },

    // ====================================================================
    // Visibility
    // ====================================================================

    toggleOverlayVisible: () => {
      set((state) => ({ overlayVisible: !state.overlayVisible }));
    },

    setOverlayOpacity: (opacity) => {
      set({ overlayOpacity: Math.max(0, Math.min(1, opacity)) });
    },

    toggleContourVisible: (id) => {
      set((state) => {
        const contour = state.contours.get(id);
        if (!contour) return state;

        const newContours = new Map(state.contours);
        newContours.set(id, { ...contour, visible: !contour.visible });
        return { contours: newContours };
      });
    },

    toggleClassVisible: (classId) => {
      set((state) => {
        const cls = state.classes.get(classId);
        if (!cls) return state;

        // Update class visibility
        const newClasses = new Map(state.classes);
        newClasses.set(classId, { ...cls, visible: !cls.visible });

        // Update all contours of this class
        const newContours = new Map(state.contours);
        for (const [id, contour] of newContours) {
          if (contour.classId === classId) {
            newContours.set(id, { ...contour, visible: !cls.visible });
          }
        }

        return { classes: newClasses, contours: newContours };
      });
    },

    // ====================================================================
    // Editing Tool
    // ====================================================================

    setEditTool: (tool) => {
      set({ editTool: tool });
    },

    setBrushSize: (size) => {
      set({ brushSize: Math.max(1, Math.min(50, size)) });
    },

    // ====================================================================
    // Contour Editing
    // ====================================================================

    movePoint: (contourId, pointIndex, newPosition) => {
      const { contours, pixelSpacing } = get();
      const contour = contours.get(contourId);
      if (!contour || contour.locked) return;

      const beforePoints = [...contour.points];
      const newPoints = [...contour.points];
      newPoints[pointIndex] = newPosition;

      const areaPx = calculatePolygonAreaPx(newPoints);

      const action: SegmentationEditAction = {
        type: 'MODIFY_CONTOUR',
        contourId,
        before: beforePoints,
        after: newPoints,
      };

      set((state) => {
        const newContours = new Map(state.contours);
        newContours.set(contourId, {
          ...contour,
          points: newPoints,
          isModified: true,
          areaPx,
          areaMm2: areaPixelsToMm2(areaPx, pixelSpacing),
        });

        return {
          contours: newContours,
          undoStack: [...state.undoStack, action].slice(-MAX_UNDO_HISTORY),
          redoStack: [],
        };
      });
    },

    addPoint: (contourId, position, afterIndex) => {
      const { contours, pixelSpacing } = get();
      const contour = contours.get(contourId);
      if (!contour || contour.locked) return;

      const newPoints = [...contour.points];
      newPoints.splice(afterIndex + 1, 0, position);

      const areaPx = calculatePolygonAreaPx(newPoints);

      const action: SegmentationEditAction = {
        type: 'ADD_POINTS',
        contourId,
        points: [position],
        insertIndex: afterIndex + 1,
      };

      set((state) => {
        const newContours = new Map(state.contours);
        newContours.set(contourId, {
          ...contour,
          points: newPoints,
          isModified: true,
          areaPx,
          areaMm2: areaPixelsToMm2(areaPx, pixelSpacing),
        });

        return {
          contours: newContours,
          undoStack: [...state.undoStack, action].slice(-MAX_UNDO_HISTORY),
          redoStack: [],
        };
      });
    },

    removePoint: (contourId, pointIndex) => {
      const { contours, pixelSpacing } = get();
      const contour = contours.get(contourId);
      if (!contour || contour.locked || contour.points.length <= 3) return;

      const removedPoint = contour.points[pointIndex];
      const newPoints = contour.points.filter((_, i) => i !== pointIndex);

      const areaPx = calculatePolygonAreaPx(newPoints);

      const action: SegmentationEditAction = {
        type: 'REMOVE_POINTS',
        contourId,
        startIndex: pointIndex,
        count: 1,
        removed: [removedPoint],
      };

      set((state) => {
        const newContours = new Map(state.contours);
        newContours.set(contourId, {
          ...contour,
          points: newPoints,
          isModified: true,
          areaPx,
          areaMm2: areaPixelsToMm2(areaPx, pixelSpacing),
        });

        return {
          contours: newContours,
          undoStack: [...state.undoStack, action].slice(-MAX_UNDO_HISTORY),
          redoStack: [],
        };
      });
    },

    deleteContour: (id) => {
      const { contours } = get();
      const contour = contours.get(id);
      if (!contour) return;

      const action: SegmentationEditAction = {
        type: 'DELETE_CONTOUR',
        contour,
      };

      set((state) => {
        const newContours = new Map(state.contours);
        newContours.set(id, { ...contour, isDeleted: true, visible: false });

        return {
          contours: newContours,
          selectedContourId: state.selectedContourId === id ? null : state.selectedContourId,
          undoStack: [...state.undoStack, action].slice(-MAX_UNDO_HISTORY),
          redoStack: [],
        };
      });
    },

    restoreContour: (id) => {
      const { contours } = get();
      const contour = contours.get(id);
      if (!contour || !contour.isDeleted) return;

      const action: SegmentationEditAction = {
        type: 'RESTORE_CONTOUR',
        contourId: id,
      };

      set((state) => {
        const newContours = new Map(state.contours);
        newContours.set(id, { ...contour, isDeleted: false, visible: true });

        return {
          contours: newContours,
          undoStack: [...state.undoStack, action].slice(-MAX_UNDO_HISTORY),
          redoStack: [],
        };
      });
    },

    // ====================================================================
    // Contour Operations
    // ====================================================================

    simplifyContour: (id, tolerance) => {
      const { contours, pixelSpacing } = get();
      const contour = contours.get(id);
      if (!contour || contour.locked) return;

      const beforePoints = [...contour.points];
      const newPoints = simplifyPolygon(contour.points, tolerance);

      if (newPoints.length < 3) return;

      const areaPx = calculatePolygonAreaPx(newPoints);

      const action: SegmentationEditAction = {
        type: 'MODIFY_CONTOUR',
        contourId: id,
        before: beforePoints,
        after: newPoints,
      };

      set((state) => {
        const newContours = new Map(state.contours);
        newContours.set(id, {
          ...contour,
          points: newPoints,
          isModified: true,
          areaPx,
          areaMm2: areaPixelsToMm2(areaPx, pixelSpacing),
        });

        return {
          contours: newContours,
          undoStack: [...state.undoStack, action].slice(-MAX_UNDO_HISTORY),
          redoStack: [],
        };
      });
    },

    smoothContour: (id, iterations) => {
      const { contours, pixelSpacing } = get();
      const contour = contours.get(id);
      if (!contour || contour.locked) return;

      const beforePoints = [...contour.points];
      const newPoints = smoothPolygon(contour.points, iterations);

      const areaPx = calculatePolygonAreaPx(newPoints);

      const action: SegmentationEditAction = {
        type: 'MODIFY_CONTOUR',
        contourId: id,
        before: beforePoints,
        after: newPoints,
      };

      set((state) => {
        const newContours = new Map(state.contours);
        newContours.set(id, {
          ...contour,
          points: newPoints,
          isModified: true,
          areaPx,
          areaMm2: areaPixelsToMm2(areaPx, pixelSpacing),
        });

        return {
          contours: newContours,
          undoStack: [...state.undoStack, action].slice(-MAX_UNDO_HISTORY),
          redoStack: [],
        };
      });
    },

    resetContour: (id) => {
      const { contours, pixelSpacing } = get();
      const contour = contours.get(id);
      if (!contour) return;

      const beforePoints = [...contour.points];
      const areaPx = calculatePolygonAreaPx(contour.originalPoints);

      const action: SegmentationEditAction = {
        type: 'MODIFY_CONTOUR',
        contourId: id,
        before: beforePoints,
        after: contour.originalPoints,
      };

      set((state) => {
        const newContours = new Map(state.contours);
        newContours.set(id, {
          ...contour,
          points: [...contour.originalPoints],
          isModified: false,
          areaPx,
          areaMm2: areaPixelsToMm2(areaPx, pixelSpacing),
        });

        return {
          contours: newContours,
          undoStack: [...state.undoStack, action].slice(-MAX_UNDO_HISTORY),
          redoStack: [],
        };
      });
    },

    // ====================================================================
    // Undo/Redo
    // ====================================================================

    undo: () => {
      const { undoStack, contours, pixelSpacing } = get();
      if (undoStack.length === 0) return;

      const action = undoStack[undoStack.length - 1];
      const newUndoStack = undoStack.slice(0, -1);
      const newContours = new Map(contours);

      switch (action.type) {
        case 'MODIFY_CONTOUR': {
          const contour = newContours.get(action.contourId);
          if (contour) {
            const areaPx = calculatePolygonAreaPx(action.before);
            newContours.set(action.contourId, {
              ...contour,
              points: action.before,
              areaPx,
              areaMm2: areaPixelsToMm2(areaPx, pixelSpacing),
            });
          }
          break;
        }
        case 'DELETE_CONTOUR':
          newContours.set(action.contour.id, {
            ...action.contour,
            isDeleted: false,
            visible: true,
          });
          break;
        case 'RESTORE_CONTOUR': {
          const contour = newContours.get(action.contourId);
          if (contour) {
            newContours.set(action.contourId, {
              ...contour,
              isDeleted: true,
              visible: false,
            });
          }
          break;
        }
        case 'ADD_POINTS': {
          const contour = newContours.get(action.contourId);
          if (contour) {
            const newPoints = [...contour.points];
            newPoints.splice(action.insertIndex, action.points.length);
            const areaPx = calculatePolygonAreaPx(newPoints);
            newContours.set(action.contourId, {
              ...contour,
              points: newPoints,
              areaPx,
              areaMm2: areaPixelsToMm2(areaPx, pixelSpacing),
            });
          }
          break;
        }
        case 'REMOVE_POINTS': {
          const contour = newContours.get(action.contourId);
          if (contour) {
            const newPoints = [...contour.points];
            newPoints.splice(action.startIndex, 0, ...action.removed);
            const areaPx = calculatePolygonAreaPx(newPoints);
            newContours.set(action.contourId, {
              ...contour,
              points: newPoints,
              areaPx,
              areaMm2: areaPixelsToMm2(areaPx, pixelSpacing),
            });
          }
          break;
        }
      }

      set({
        contours: newContours,
        undoStack: newUndoStack,
        redoStack: [...get().redoStack, action],
      });
    },

    redo: () => {
      const { redoStack, contours, pixelSpacing } = get();
      if (redoStack.length === 0) return;

      const action = redoStack[redoStack.length - 1];
      const newRedoStack = redoStack.slice(0, -1);
      const newContours = new Map(contours);

      switch (action.type) {
        case 'MODIFY_CONTOUR': {
          const contour = newContours.get(action.contourId);
          if (contour) {
            const areaPx = calculatePolygonAreaPx(action.after);
            newContours.set(action.contourId, {
              ...contour,
              points: action.after,
              areaPx,
              areaMm2: areaPixelsToMm2(areaPx, pixelSpacing),
            });
          }
          break;
        }
        case 'DELETE_CONTOUR':
          newContours.set(action.contour.id, {
            ...action.contour,
            isDeleted: true,
            visible: false,
          });
          break;
        case 'RESTORE_CONTOUR': {
          const contour = newContours.get(action.contourId);
          if (contour) {
            newContours.set(action.contourId, {
              ...contour,
              isDeleted: false,
              visible: true,
            });
          }
          break;
        }
        case 'ADD_POINTS': {
          const contour = newContours.get(action.contourId);
          if (contour) {
            const newPoints = [...contour.points];
            newPoints.splice(action.insertIndex, 0, ...action.points);
            const areaPx = calculatePolygonAreaPx(newPoints);
            newContours.set(action.contourId, {
              ...contour,
              points: newPoints,
              areaPx,
              areaMm2: areaPixelsToMm2(areaPx, pixelSpacing),
            });
          }
          break;
        }
        case 'REMOVE_POINTS': {
          const contour = newContours.get(action.contourId);
          if (contour) {
            const newPoints = [...contour.points];
            newPoints.splice(action.startIndex, action.count);
            const areaPx = calculatePolygonAreaPx(newPoints);
            newContours.set(action.contourId, {
              ...contour,
              points: newPoints,
              areaPx,
              areaMm2: areaPixelsToMm2(areaPx, pixelSpacing),
            });
          }
          break;
        }
      }

      set({
        contours: newContours,
        redoStack: newRedoStack,
        undoStack: [...get().undoStack, action],
      });
    },

    canUndo: () => get().undoStack.length > 0,
    canRedo: () => get().redoStack.length > 0,

    // ====================================================================
    // Queries
    // ====================================================================

    getContour: (id) => get().contours.get(id),

    getContoursForClass: (classId) => {
      const result: EditableContour[] = [];
      for (const contour of get().contours.values()) {
        if (contour.classId === classId && !contour.isDeleted) {
          result.push(contour);
        }
      }
      return result;
    },

    getVisibleContours: () => {
      const { overlayVisible, contours } = get();
      if (!overlayVisible) return [];

      const result: EditableContour[] = [];
      for (const contour of contours.values()) {
        if (contour.visible && !contour.isDeleted) {
          result.push(contour);
        }
      }
      return result;
    },

    // ====================================================================
    // Reset
    // ====================================================================

    reset: () => {
      set(initialState);
    },
  }))
);

// ============================================================================
// Selectors
// ============================================================================

export const selectSegmentationResult = (state: SegmentationStore) => state.segmentationResult;
export const selectContours = (state: SegmentationStore) => state.contours;
export const selectClasses = (state: SegmentationStore) => state.classes;
export const selectSelectedContourId = (state: SegmentationStore) => state.selectedContourId;
export const selectEditTool = (state: SegmentationStore) => state.editTool;
export const selectOverlayVisible = (state: SegmentationStore) => state.overlayVisible;
export const selectOverlayOpacity = (state: SegmentationStore) => state.overlayOpacity;
