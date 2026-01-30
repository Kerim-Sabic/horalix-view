/**
 * Measurement Store
 *
 * Zustand store for managing all measurement state including:
 * - CRUD operations for measurements
 * - Selection and hover state
 * - Active drawing state
 * - Undo/redo history
 * - Persistence to localStorage
 * - Cine tracking data
 */

import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import type {
  Measurement,
  LineMeasurement,
  PolygonMeasurement,
  MeasurementType,
  MeasurementScope,
  MeasurementAction,
  Point2D,
  PixelSpacing,
  TrackingData,
} from '../types';
import {
  createMeasurementId,
  createBaseMeasurementProps,
  isLineMeasurement,
  isPolygonMeasurement,
} from '../types';
import {
  calculateDistanceMm,
  calculatePolygonAreaMm2,
  calculatePerimeterMm,
} from '../services/geometryService';
import { MAX_UNDO_HISTORY } from '../constants';

// ============================================================================
// Store Types
// ============================================================================

interface MeasurementState {
  // Core measurement data
  measurements: Map<string, Measurement>;

  // Selection state
  selectedMeasurementId: string | null;
  hoveredMeasurementId: string | null;

  // Active drawing state
  activeMeasurement: Measurement | null;
  isDrawing: boolean;

  // Undo/redo
  undoStack: MeasurementAction[];
  redoStack: MeasurementAction[];

  // Tracking data (separate from measurements for performance)
  trackingData: Map<string, TrackingData>;
  trackingInProgress: string | null;
}

interface MeasurementActions {
  // CRUD operations
  createMeasurement: (measurement: Omit<Measurement, 'id' | 'createdAt' | 'modifiedAt'>, customId?: string) => string;
  updateMeasurement: (id: string, updates: Partial<Measurement>) => void;
  deleteMeasurement: (id: string) => void;
  clearMeasurements: (seriesUid?: string) => void;

  // Selection
  selectMeasurement: (id: string | null) => void;
  setHoveredMeasurement: (id: string | null) => void;

  // Drawing lifecycle
  startDrawing: (type: MeasurementType, startPoint: Point2D, context: DrawingContext) => void;
  continueDrawing: (point: Point2D, pixelSpacing: PixelSpacing | null) => void;
  addPolygonPoint: (point: Point2D, pixelSpacing: PixelSpacing | null) => void;
  finishDrawing: (pixelSpacing: PixelSpacing | null) => Measurement | null;
  cancelDrawing: () => void;

  // Point editing
  movePoint: (measurementId: string, pointIndex: number, newPosition: Point2D, pixelSpacing: PixelSpacing | null) => void;
  moveMeasurement: (measurementId: string, delta: Point2D, pixelSpacing: PixelSpacing | null) => void;

  // Undo/redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;

  // Tracking
  setTrackingData: (measurementId: string, data: TrackingData) => void;
  setTrackingInProgress: (measurementId: string | null) => void;
  clearTrackingData: (measurementId: string) => void;

  // Queries
  getMeasurement: (id: string) => Measurement | undefined;
  getMeasurementsForSeries: (seriesUid: string) => Measurement[];
  getMeasurementsForFrame: (seriesUid: string, frameKey: string) => Measurement[];
  getVisibleMeasurements: (seriesUid: string, frameKey: string, scope: MeasurementScope) => Measurement[];

  // Bulk operations
  importMeasurements: (measurements: Measurement[]) => void;
  exportMeasurements: (seriesUid?: string) => Measurement[];

  // Visibility
  toggleVisibility: (id: string) => void;
  showAll: (seriesUid?: string) => void;
  hideAll: (seriesUid?: string) => void;

  // Reset
  reset: () => void;
}

interface DrawingContext {
  seriesUid: string;
  frameKey: string | null;
  scope: MeasurementScope;
}

type MeasurementStore = MeasurementState & MeasurementActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: MeasurementState = {
  measurements: new Map(),
  selectedMeasurementId: null,
  hoveredMeasurementId: null,
  activeMeasurement: null,
  isDrawing: false,
  undoStack: [],
  redoStack: [],
  trackingData: new Map(),
  trackingInProgress: null,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Recalculate measurement values (length, area, etc.)
 */
function recalculateMeasurement(
  measurement: Measurement,
  pixelSpacing: PixelSpacing | null
): Measurement {
  const now = Date.now();

  switch (measurement.type) {
    case 'line': {
      const [start, end] = measurement.points;
      const lengthMm = calculateDistanceMm(start, end, pixelSpacing);
      return { ...measurement, lengthMm, modifiedAt: now };
    }
    case 'polygon': {
      const areaMm2 = calculatePolygonAreaMm2(measurement.points, pixelSpacing);
      const perimeterMm = calculatePerimeterMm(measurement.points, pixelSpacing, true);
      return { ...measurement, areaMm2, perimeterMm, modifiedAt: now };
    }
    case 'polyline': {
      const totalLengthMm = calculatePerimeterMm(measurement.points, pixelSpacing, false);
      return { ...measurement, totalLengthMm, modifiedAt: now };
    }
    default:
      return { ...measurement, modifiedAt: now };
  }
}

/**
 * Create initial line measurement
 */
function createLineMeasurement(
  startPoint: Point2D,
  context: DrawingContext
): LineMeasurement {
  return {
    ...createBaseMeasurementProps('line', context.seriesUid, context.scope, context.frameKey),
    id: createMeasurementId(),
    type: 'line',
    points: [startPoint, startPoint],
    lengthMm: 0,
    trackingData: null,
  } as LineMeasurement;
}

/**
 * Create initial polygon measurement
 */
function createPolygonMeasurement(
  startPoint: Point2D,
  context: DrawingContext
): PolygonMeasurement {
  return {
    ...createBaseMeasurementProps('polygon', context.seriesUid, context.scope, context.frameKey),
    id: createMeasurementId(),
    type: 'polygon',
    points: [startPoint],
    perimeterMm: null,
    areaMm2: null,
    volumeData: null,
    trackingData: null,
  } as PolygonMeasurement;
}

// ============================================================================
// Store Definition
// ============================================================================

export const useMeasurementStore = create<MeasurementStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        ...initialState,

        // ====================================================================
        // CRUD Operations
        // ====================================================================

        createMeasurement: (measurementData, customId) => {
          const id = customId || createMeasurementId();
          const now = Date.now();
          const measurement = {
            ...measurementData,
            id,
            createdAt: now,
            modifiedAt: now,
          } as Measurement;

          set((state) => {
            const newMeasurements = new Map(state.measurements);
            newMeasurements.set(id, measurement);

            // Add to undo stack
            const action: MeasurementAction = { type: 'CREATE', measurement };
            const newUndoStack = [...state.undoStack, action].slice(-MAX_UNDO_HISTORY);

            return {
              measurements: newMeasurements,
              undoStack: newUndoStack,
              redoStack: [], // Clear redo on new action
              selectedMeasurementId: id,
            };
          });

          return id;
        },

        updateMeasurement: (id, updates) => {
          const current = get().measurements.get(id);
          if (!current) return;

          const updated = {
            ...current,
            ...updates,
            modifiedAt: Date.now(),
          } as Measurement;

          set((state) => {
            const newMeasurements = new Map(state.measurements);
            newMeasurements.set(id, updated);

            // Add to undo stack
            const action: MeasurementAction = {
              type: 'UPDATE',
              measurementId: id,
              before: current,
              after: updated,
            };
            const newUndoStack = [...state.undoStack, action].slice(-MAX_UNDO_HISTORY);

            return {
              measurements: newMeasurements,
              undoStack: newUndoStack,
              redoStack: [],
            };
          });
        },

        deleteMeasurement: (id) => {
          const measurement = get().measurements.get(id);
          if (!measurement) return;

          set((state) => {
            const newMeasurements = new Map(state.measurements);
            newMeasurements.delete(id);

            // Remove tracking data
            const newTrackingData = new Map(state.trackingData);
            newTrackingData.delete(id);

            // Add to undo stack
            const action: MeasurementAction = { type: 'DELETE', measurement };
            const newUndoStack = [...state.undoStack, action].slice(-MAX_UNDO_HISTORY);

            return {
              measurements: newMeasurements,
              trackingData: newTrackingData,
              undoStack: newUndoStack,
              redoStack: [],
              selectedMeasurementId:
                state.selectedMeasurementId === id ? null : state.selectedMeasurementId,
            };
          });
        },

        clearMeasurements: (seriesUid) => {
          set((state) => {
            if (!seriesUid) {
              return {
                measurements: new Map(),
                trackingData: new Map(),
                selectedMeasurementId: null,
                undoStack: [],
                redoStack: [],
              };
            }

            const newMeasurements = new Map(state.measurements);
            const newTrackingData = new Map(state.trackingData);

            for (const [id, m] of state.measurements) {
              if (m.seriesUid === seriesUid) {
                newMeasurements.delete(id);
                newTrackingData.delete(id);
              }
            }

            return {
              measurements: newMeasurements,
              trackingData: newTrackingData,
              selectedMeasurementId:
                state.selectedMeasurementId &&
                state.measurements.get(state.selectedMeasurementId)?.seriesUid === seriesUid
                  ? null
                  : state.selectedMeasurementId,
            };
          });
        },

        // ====================================================================
        // Selection
        // ====================================================================

        selectMeasurement: (id) => {
          set({ selectedMeasurementId: id });
        },

        setHoveredMeasurement: (id) => {
          set({ hoveredMeasurementId: id });
        },

        // ====================================================================
        // Drawing Lifecycle
        // ====================================================================

        startDrawing: (type, startPoint, context) => {
          let activeMeasurement: Measurement;

          switch (type) {
            case 'line':
              activeMeasurement = createLineMeasurement(startPoint, context);
              break;
            case 'polygon':
              activeMeasurement = createPolygonMeasurement(startPoint, context);
              break;
            default:
              // For other types, create line as fallback (TODO: implement others)
              activeMeasurement = createLineMeasurement(startPoint, context);
          }

          set({
            activeMeasurement,
            isDrawing: true,
            selectedMeasurementId: null,
          });
        },

        continueDrawing: (point, pixelSpacing) => {
          const { activeMeasurement } = get();
          if (!activeMeasurement) return;

          if (isLineMeasurement(activeMeasurement)) {
            const lengthMm = calculateDistanceMm(
              activeMeasurement.points[0],
              point,
              pixelSpacing
            );
            set({
              activeMeasurement: {
                ...activeMeasurement,
                points: [activeMeasurement.points[0], point],
                lengthMm,
              },
            });
          } else if (isPolygonMeasurement(activeMeasurement)) {
            // For polygon, update preview point (last point in array)
            const points = [...activeMeasurement.points];
            if (points.length === 1) {
              points.push(point);
            } else {
              points[points.length - 1] = point;
            }
            set({
              activeMeasurement: {
                ...activeMeasurement,
                points,
              },
            });
          }
        },

        addPolygonPoint: (point, pixelSpacing) => {
          const { activeMeasurement } = get();
          if (!activeMeasurement || !isPolygonMeasurement(activeMeasurement)) return;

          const points = [...activeMeasurement.points, point];
          const areaMm2 = points.length >= 3
            ? calculatePolygonAreaMm2(points, pixelSpacing)
            : null;
          const perimeterMm = calculatePerimeterMm(points, pixelSpacing, true);

          set({
            activeMeasurement: {
              ...activeMeasurement,
              points,
              areaMm2,
              perimeterMm,
            },
          });
        },

        finishDrawing: (pixelSpacing) => {
          const { activeMeasurement } = get();
          if (!activeMeasurement) return null;

          // Validate measurement
          if (isLineMeasurement(activeMeasurement)) {
            const [start, end] = activeMeasurement.points;
            const distance = Math.sqrt(
              Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2)
            );
            if (distance < 3) {
              // Too short, cancel
              set({ activeMeasurement: null, isDrawing: false });
              return null;
            }
          } else if (isPolygonMeasurement(activeMeasurement)) {
            if (activeMeasurement.points.length < 3) {
              // Not enough points, cancel
              set({ activeMeasurement: null, isDrawing: false });
              return null;
            }
          }

          // Recalculate final values
          const finalMeasurement = recalculateMeasurement(activeMeasurement, pixelSpacing);

          // Add to store
          set((state) => {
            const newMeasurements = new Map(state.measurements);
            newMeasurements.set(finalMeasurement.id, finalMeasurement);

            const action: MeasurementAction = { type: 'CREATE', measurement: finalMeasurement };
            const newUndoStack = [...state.undoStack, action].slice(-MAX_UNDO_HISTORY);

            return {
              measurements: newMeasurements,
              activeMeasurement: null,
              isDrawing: false,
              undoStack: newUndoStack,
              redoStack: [],
              selectedMeasurementId: finalMeasurement.id,
            };
          });

          return finalMeasurement;
        },

        cancelDrawing: () => {
          set({ activeMeasurement: null, isDrawing: false });
        },

        // ====================================================================
        // Point Editing
        // ====================================================================

        movePoint: (measurementId, pointIndex, newPosition, pixelSpacing) => {
          const measurement = get().measurements.get(measurementId);
          if (!measurement) return;

          let updated: Measurement;

          if (isLineMeasurement(measurement)) {
            const points = [...measurement.points] as [Point2D, Point2D];
            const oldPosition = points[pointIndex];
            points[pointIndex] = newPosition;
            const lengthMm = calculateDistanceMm(points[0], points[1], pixelSpacing);
            updated = { ...measurement, points, lengthMm, modifiedAt: Date.now() };

            // Record action for undo
            const action: MeasurementAction = {
              type: 'MOVE_POINT',
              measurementId,
              pointIndex,
              before: oldPosition,
              after: newPosition,
            };

            set((state) => {
              const newMeasurements = new Map(state.measurements);
              newMeasurements.set(measurementId, updated);
              return {
                measurements: newMeasurements,
                undoStack: [...state.undoStack, action].slice(-MAX_UNDO_HISTORY),
                redoStack: [],
              };
            });
          } else if (isPolygonMeasurement(measurement)) {
            const points = [...measurement.points];
            const oldPosition = points[pointIndex];
            points[pointIndex] = newPosition;
            const areaMm2 = calculatePolygonAreaMm2(points, pixelSpacing);
            const perimeterMm = calculatePerimeterMm(points, pixelSpacing, true);
            updated = { ...measurement, points, areaMm2, perimeterMm, modifiedAt: Date.now() };

            const action: MeasurementAction = {
              type: 'MOVE_POINT',
              measurementId,
              pointIndex,
              before: oldPosition,
              after: newPosition,
            };

            set((state) => {
              const newMeasurements = new Map(state.measurements);
              newMeasurements.set(measurementId, updated);
              return {
                measurements: newMeasurements,
                undoStack: [...state.undoStack, action].slice(-MAX_UNDO_HISTORY),
                redoStack: [],
              };
            });
          }
        },

        moveMeasurement: (measurementId, delta, _pixelSpacing) => {
          const measurement = get().measurements.get(measurementId);
          if (!measurement) return;

          let updated: Measurement;

          if (isLineMeasurement(measurement)) {
            const points: [Point2D, Point2D] = [
              { x: measurement.points[0].x + delta.x, y: measurement.points[0].y + delta.y },
              { x: measurement.points[1].x + delta.x, y: measurement.points[1].y + delta.y },
            ];
            updated = { ...measurement, points, modifiedAt: Date.now() };
          } else if (isPolygonMeasurement(measurement)) {
            const points = measurement.points.map((p) => ({
              x: p.x + delta.x,
              y: p.y + delta.y,
            }));
            updated = { ...measurement, points, modifiedAt: Date.now() };
          } else {
            return;
          }

          const action: MeasurementAction = {
            type: 'MOVE_MEASUREMENT',
            measurementId,
            delta,
          };

          set((state) => {
            const newMeasurements = new Map(state.measurements);
            newMeasurements.set(measurementId, updated);
            return {
              measurements: newMeasurements,
              undoStack: [...state.undoStack, action].slice(-MAX_UNDO_HISTORY),
              redoStack: [],
            };
          });
        },

        // ====================================================================
        // Undo/Redo
        // ====================================================================

        undo: () => {
          const { undoStack, measurements, trackingData } = get();
          if (undoStack.length === 0) return;

          const action = undoStack[undoStack.length - 1];
          const newUndoStack = undoStack.slice(0, -1);
          const newMeasurements = new Map(measurements);
          const newTrackingData = new Map(trackingData);

          switch (action.type) {
            case 'CREATE':
              newMeasurements.delete(action.measurement.id);
              newTrackingData.delete(action.measurement.id);
              break;
            case 'DELETE':
              newMeasurements.set(action.measurement.id, action.measurement);
              break;
            case 'UPDATE':
              newMeasurements.set(action.measurementId, action.before);
              break;
            case 'MOVE_POINT': {
              const m = newMeasurements.get(action.measurementId);
              if (m && (isLineMeasurement(m) || isPolygonMeasurement(m))) {
                const points = [...(m as LineMeasurement | PolygonMeasurement).points];
                points[action.pointIndex] = action.before;
                newMeasurements.set(action.measurementId, { ...m, points } as Measurement);
              }
              break;
            }
            case 'MOVE_MEASUREMENT': {
              const m = newMeasurements.get(action.measurementId);
              if (m && (isLineMeasurement(m) || isPolygonMeasurement(m))) {
                const points = (m as LineMeasurement | PolygonMeasurement).points.map((p) => ({
                  x: p.x - action.delta.x,
                  y: p.y - action.delta.y,
                }));
                newMeasurements.set(action.measurementId, { ...m, points } as Measurement);
              }
              break;
            }
          }

          set({
            measurements: newMeasurements,
            trackingData: newTrackingData,
            undoStack: newUndoStack,
            redoStack: [...get().redoStack, action],
          });
        },

        redo: () => {
          const { redoStack, measurements } = get();
          if (redoStack.length === 0) return;

          const action = redoStack[redoStack.length - 1];
          const newRedoStack = redoStack.slice(0, -1);
          const newMeasurements = new Map(measurements);

          switch (action.type) {
            case 'CREATE':
              newMeasurements.set(action.measurement.id, action.measurement);
              break;
            case 'DELETE':
              newMeasurements.delete(action.measurement.id);
              break;
            case 'UPDATE':
              newMeasurements.set(action.measurementId, action.after);
              break;
            case 'MOVE_POINT': {
              const m = newMeasurements.get(action.measurementId);
              if (m && (isLineMeasurement(m) || isPolygonMeasurement(m))) {
                const points = [...(m as LineMeasurement | PolygonMeasurement).points];
                points[action.pointIndex] = action.after;
                newMeasurements.set(action.measurementId, { ...m, points } as Measurement);
              }
              break;
            }
            case 'MOVE_MEASUREMENT': {
              const m = newMeasurements.get(action.measurementId);
              if (m && (isLineMeasurement(m) || isPolygonMeasurement(m))) {
                const points = (m as LineMeasurement | PolygonMeasurement).points.map((p) => ({
                  x: p.x + action.delta.x,
                  y: p.y + action.delta.y,
                }));
                newMeasurements.set(action.measurementId, { ...m, points } as Measurement);
              }
              break;
            }
          }

          set({
            measurements: newMeasurements,
            redoStack: newRedoStack,
            undoStack: [...get().undoStack, action],
          });
        },

        canUndo: () => get().undoStack.length > 0,
        canRedo: () => get().redoStack.length > 0,

        clearHistory: () => {
          set({ undoStack: [], redoStack: [] });
        },

        // ====================================================================
        // Tracking
        // ====================================================================

        setTrackingData: (measurementId, data) => {
          set((state) => {
            const newTrackingData = new Map(state.trackingData);
            newTrackingData.set(measurementId, data);

            // Also update measurement with tracking data
            const measurement = state.measurements.get(measurementId);
            if (measurement && (isLineMeasurement(measurement) || isPolygonMeasurement(measurement))) {
              const newMeasurements = new Map(state.measurements);
              newMeasurements.set(measurementId, {
                ...measurement,
                trackingData: data,
              } as Measurement);
              return { trackingData: newTrackingData, measurements: newMeasurements };
            }

            return { trackingData: newTrackingData };
          });
        },

        setTrackingInProgress: (measurementId) => {
          set({ trackingInProgress: measurementId });
        },

        clearTrackingData: (measurementId) => {
          set((state) => {
            const newTrackingData = new Map(state.trackingData);
            newTrackingData.delete(measurementId);
            const measurement = state.measurements.get(measurementId);
            if (measurement && (isLineMeasurement(measurement) || isPolygonMeasurement(measurement))) {
              const newMeasurements = new Map(state.measurements);
              newMeasurements.set(measurementId, {
                ...measurement,
                trackingData: null,
              } as Measurement);
              return { trackingData: newTrackingData, measurements: newMeasurements };
            }
            return { trackingData: newTrackingData };
          });
        },

        // ====================================================================
        // Queries
        // ====================================================================

        getMeasurement: (id) => get().measurements.get(id),

        getMeasurementsForSeries: (seriesUid) => {
          const result: Measurement[] = [];
          for (const m of get().measurements.values()) {
            if (m.seriesUid === seriesUid) {
              result.push(m);
            }
          }
          return result.sort((a, b) => a.createdAt - b.createdAt);
        },

        getMeasurementsForFrame: (seriesUid, frameKey) => {
          const result: Measurement[] = [];
          for (const m of get().measurements.values()) {
            if (m.seriesUid === seriesUid && m.frameKey === frameKey) {
              result.push(m);
            }
          }
          return result.sort((a, b) => a.createdAt - b.createdAt);
        },

        getVisibleMeasurements: (seriesUid, frameKey, _scope) => {
          const result: Measurement[] = [];
          for (const m of get().measurements.values()) {
            if (m.seriesUid !== seriesUid) continue;
            if (!m.visible) continue;

            // Series-scoped measurements are always visible
            if (m.scope === 'series') {
              result.push(m);
            }
            // Frame-scoped measurements only visible on their frame
            else if (m.scope === 'frame' && m.frameKey === frameKey) {
              result.push(m);
            }
          }
          return result.sort((a, b) => a.createdAt - b.createdAt);
        },

        // ====================================================================
        // Bulk Operations
        // ====================================================================

        importMeasurements: (measurements) => {
          set((state) => {
            const newMeasurements = new Map(state.measurements);
            for (const m of measurements) {
              newMeasurements.set(m.id, m);
            }
            return { measurements: newMeasurements };
          });
        },

        exportMeasurements: (seriesUid) => {
          const { measurements } = get();
          const result: Measurement[] = [];
          for (const m of measurements.values()) {
            if (!seriesUid || m.seriesUid === seriesUid) {
              result.push(m);
            }
          }
          return result;
        },

        // ====================================================================
        // Visibility
        // ====================================================================

        toggleVisibility: (id) => {
          const { measurements } = get();
          const measurement = measurements.get(id);
          if (!measurement) return;

          const newMeasurements = new Map(measurements);
          newMeasurements.set(id, {
            ...measurement,
            visible: !measurement.visible,
            modifiedAt: Date.now(),
          });

          set({ measurements: newMeasurements });
        },

        showAll: (seriesUid) => {
          const { measurements } = get();
          const newMeasurements = new Map(measurements);

          for (const [id, m] of newMeasurements) {
            if (!seriesUid || m.seriesUid === seriesUid) {
              newMeasurements.set(id, { ...m, visible: true, modifiedAt: Date.now() });
            }
          }

          set({ measurements: newMeasurements });
        },

        hideAll: (seriesUid) => {
          const { measurements } = get();
          const newMeasurements = new Map(measurements);

          for (const [id, m] of newMeasurements) {
            if (!seriesUid || m.seriesUid === seriesUid) {
              newMeasurements.set(id, { ...m, visible: false, modifiedAt: Date.now() });
            }
          }

          set({ measurements: newMeasurements });
        },

        // ====================================================================
        // Reset
        // ====================================================================

        reset: () => {
          set(initialState);
        },
      }),
      {
        name: 'horalix-measurements',
        // Custom serialization for Map objects
        storage: {
          getItem: (name) => {
            const str = localStorage.getItem(name);
            if (!str) return null;
            const parsed = JSON.parse(str);
            return {
              state: {
                ...parsed.state,
                measurements: new Map(parsed.state.measurements || []),
                trackingData: new Map(parsed.state.trackingData || []),
                // Don't persist UI state
                selectedMeasurementId: null,
                hoveredMeasurementId: null,
                activeMeasurement: null,
                isDrawing: false,
                undoStack: [],
                redoStack: [],
                trackingInProgress: null,
              },
            };
          },
          setItem: (name, value) => {
            const serialized = {
              state: {
                ...value.state,
                measurements: Array.from(value.state.measurements.entries()),
                trackingData: Array.from(value.state.trackingData.entries()),
                // Don't persist UI state
                selectedMeasurementId: null,
                hoveredMeasurementId: null,
                activeMeasurement: null,
                isDrawing: false,
                undoStack: [],
                redoStack: [],
                trackingInProgress: null,
              },
            };
            localStorage.setItem(name, JSON.stringify(serialized));
          },
          removeItem: (name) => localStorage.removeItem(name),
        },
        // Only persist measurements and tracking data
        partialize: (state) => ({
          measurements: state.measurements,
          trackingData: state.trackingData,
        }),
      }
    )
  )
);

// ============================================================================
// Selectors (for performance optimization)
// ============================================================================

export const selectMeasurements = (state: MeasurementStore) => state.measurements;
export const selectSelectedId = (state: MeasurementStore) => state.selectedMeasurementId;
export const selectHoveredId = (state: MeasurementStore) => state.hoveredMeasurementId;
export const selectActiveMeasurement = (state: MeasurementStore) => state.activeMeasurement;
export const selectIsDrawing = (state: MeasurementStore) => state.isDrawing;
export const selectCanUndo = (state: MeasurementStore) => state.undoStack.length > 0;
export const selectCanRedo = (state: MeasurementStore) => state.redoStack.length > 0;
