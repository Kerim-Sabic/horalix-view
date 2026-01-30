/**
 * Measurement Store Integration Tests
 *
 * Tests for the Zustand measurement store including:
 * - CRUD operations
 * - Selection state
 * - Undo/redo
 * - Drawing workflow
 * - Persistence
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useMeasurementStore } from '../hooks/useMeasurementStore';
import type { LineMeasurement, PolygonMeasurement, MeasurementScope } from '../types';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Helper to get fresh store state
function getStore() {
  return useMeasurementStore.getState();
}

// Helper to create a line measurement
function createLineMeasurementData(overrides: Partial<{
  seriesUid: string;
  frameKey: string | null;
  scope: MeasurementScope;
  points: [{ x: number; y: number }, { x: number; y: number }];
  label: string | null;
  visible: boolean;
  locked: boolean;
  color: string;
}> = {}) {
  return {
    type: 'line' as const,
    seriesUid: overrides.seriesUid ?? 'series-1',
    frameKey: overrides.frameKey ?? 'instance-1:0',
    scope: overrides.scope ?? 'frame' as MeasurementScope,
    points: overrides.points ?? [{ x: 0, y: 0 }, { x: 100, y: 100 }],
    label: overrides.label ?? null,
    visible: overrides.visible ?? true,
    locked: overrides.locked ?? false,
    color: overrides.color ?? '#00FF00',
    lengthMm: null,
    trackingData: null,
  };
}

// Helper to create a polygon measurement
function createPolygonMeasurementData(overrides: Partial<{
  seriesUid: string;
  frameKey: string | null;
  scope: MeasurementScope;
  points: { x: number; y: number }[];
  label: string | null;
  visible: boolean;
  locked: boolean;
  color: string;
}> = {}) {
  return {
    type: 'polygon' as const,
    seriesUid: overrides.seriesUid ?? 'series-1',
    frameKey: overrides.frameKey ?? 'instance-1:0',
    scope: overrides.scope ?? 'frame' as MeasurementScope,
    points: overrides.points ?? [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    label: overrides.label ?? null,
    visible: overrides.visible ?? true,
    locked: overrides.locked ?? false,
    color: overrides.color ?? '#00FF00',
    perimeterMm: null,
    areaMm2: null,
    volumeData: null,
    trackingData: null,
  };
}

describe('useMeasurementStore', () => {
  beforeEach(() => {
    // Reset the store before each test
    getStore().reset();
    localStorageMock.clear();
  });

  // ============================================================================
  // CRUD Operations
  // ============================================================================

  describe('CRUD Operations', () => {
    it('should create a line measurement', () => {
      const id = getStore().createMeasurement(createLineMeasurementData());

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');

      const measurement = getStore().measurements.get(id);
      expect(measurement).toBeDefined();
      expect(measurement?.type).toBe('line');
      expect(measurement?.seriesUid).toBe('series-1');
      expect(getStore().measurements.size).toBe(1);
    });

    it('should create a polygon measurement', () => {
      const id = getStore().createMeasurement(createPolygonMeasurementData());

      expect(id).toBeDefined();
      const measurement = getStore().measurements.get(id) as PolygonMeasurement;
      expect(measurement?.type).toBe('polygon');
      expect(measurement?.points.length).toBe(4);
    });

    it('should update a measurement', () => {
      const id = getStore().createMeasurement(createLineMeasurementData());

      getStore().updateMeasurement(id, { label: 'Test Label' });

      const updated = getStore().measurements.get(id);
      expect(updated?.label).toBe('Test Label');
    });

    it('should delete a measurement', () => {
      const id = getStore().createMeasurement(createLineMeasurementData());

      expect(getStore().measurements.size).toBe(1);

      getStore().deleteMeasurement(id);

      expect(getStore().measurements.size).toBe(0);
    });

    it('should clear all measurements for a series', () => {
      getStore().createMeasurement(createLineMeasurementData({ seriesUid: 'series-1' }));
      getStore().createMeasurement(createLineMeasurementData({ seriesUid: 'series-1' }));
      getStore().createMeasurement(createLineMeasurementData({ seriesUid: 'series-2' }));

      expect(getStore().measurements.size).toBe(3);

      getStore().clearMeasurements('series-1');

      expect(getStore().measurements.size).toBe(1);
      const remaining = Array.from(getStore().measurements.values())[0];
      expect(remaining.seriesUid).toBe('series-2');
    });
  });

  // ============================================================================
  // Selection
  // ============================================================================

  describe('Selection', () => {
    it('should select a measurement', () => {
      const id = getStore().createMeasurement(createLineMeasurementData());

      // createMeasurement auto-selects, so we need to deselect first
      getStore().selectMeasurement(null);
      expect(getStore().selectedMeasurementId).toBeNull();

      getStore().selectMeasurement(id);

      expect(getStore().selectedMeasurementId).toBe(id);
    });

    it('should deselect when selecting null', () => {
      const id = getStore().createMeasurement(createLineMeasurementData());

      expect(getStore().selectedMeasurementId).toBe(id);

      getStore().selectMeasurement(null);
      expect(getStore().selectedMeasurementId).toBeNull();
    });

    it('should set hovered measurement', () => {
      const id = getStore().createMeasurement(createLineMeasurementData());

      getStore().setHoveredMeasurement(id);
      expect(getStore().hoveredMeasurementId).toBe(id);

      getStore().setHoveredMeasurement(null);
      expect(getStore().hoveredMeasurementId).toBeNull();
    });
  });

  // ============================================================================
  // Undo/Redo
  // ============================================================================

  describe('Undo/Redo', () => {
    it('should undo measurement creation', () => {
      getStore().createMeasurement(createLineMeasurementData());

      expect(getStore().measurements.size).toBe(1);
      expect(getStore().canUndo()).toBe(true);

      getStore().undo();

      expect(getStore().measurements.size).toBe(0);
      expect(getStore().canRedo()).toBe(true);
    });

    it('should redo measurement creation', () => {
      getStore().createMeasurement(createLineMeasurementData());

      getStore().undo();
      expect(getStore().measurements.size).toBe(0);

      getStore().redo();
      expect(getStore().measurements.size).toBe(1);
    });

    it('should undo measurement deletion', () => {
      const id = getStore().createMeasurement(createLineMeasurementData());

      getStore().deleteMeasurement(id);
      expect(getStore().measurements.size).toBe(0);

      getStore().undo();
      expect(getStore().measurements.size).toBe(1);
    });

    it('should undo measurement update', () => {
      const id = getStore().createMeasurement(createLineMeasurementData());

      getStore().updateMeasurement(id, { label: 'New Label' });
      expect(getStore().measurements.get(id)?.label).toBe('New Label');

      getStore().undo();
      expect(getStore().measurements.get(id)?.label).toBeNull();
    });

    it('should clear redo stack on new action', () => {
      getStore().createMeasurement(createLineMeasurementData());

      getStore().undo();
      expect(getStore().canRedo()).toBe(true);

      getStore().createMeasurement(createLineMeasurementData({
        points: [{ x: 50, y: 50 }, { x: 150, y: 150 }],
      }));

      expect(getStore().canRedo()).toBe(false);
    });
  });

  // ============================================================================
  // Drawing Workflow
  // ============================================================================

  describe('Drawing Workflow', () => {
    const drawingContext = {
      seriesUid: 'series-1',
      frameKey: 'instance-1:0',
      scope: 'frame' as MeasurementScope,
    };

    it('should start drawing a line', () => {
      getStore().startDrawing('line', { x: 0, y: 0 }, drawingContext);

      expect(getStore().activeMeasurement).not.toBeNull();
      expect(getStore().activeMeasurement?.type).toBe('line');
      expect(getStore().isDrawing).toBe(true);
    });

    it('should continue drawing a line', () => {
      getStore().startDrawing('line', { x: 0, y: 0 }, drawingContext);
      getStore().continueDrawing({ x: 100, y: 100 }, null);

      const activeLine = getStore().activeMeasurement as LineMeasurement;
      expect(activeLine.points[1]).toEqual({ x: 100, y: 100 });
    });

    it('should finish drawing a line', () => {
      getStore().startDrawing('line', { x: 0, y: 0 }, drawingContext);
      getStore().continueDrawing({ x: 100, y: 100 }, null);
      getStore().finishDrawing({ rowSpacing: 0.5, columnSpacing: 0.5 });

      expect(getStore().activeMeasurement).toBeNull();
      expect(getStore().isDrawing).toBe(false);
      expect(getStore().measurements.size).toBe(1);
    });

    it('should cancel drawing', () => {
      getStore().startDrawing('line', { x: 0, y: 0 }, drawingContext);
      getStore().cancelDrawing();

      expect(getStore().activeMeasurement).toBeNull();
      expect(getStore().isDrawing).toBe(false);
      expect(getStore().measurements.size).toBe(0);
    });

    it('should add polygon points', () => {
      getStore().startDrawing('polygon', { x: 0, y: 0 }, drawingContext);
      getStore().addPolygonPoint({ x: 100, y: 0 }, null);
      getStore().addPolygonPoint({ x: 100, y: 100 }, null);
      getStore().addPolygonPoint({ x: 0, y: 100 }, null);

      const activePolygon = getStore().activeMeasurement as PolygonMeasurement;
      expect(activePolygon.points.length).toBe(4);
    });

    it('should finish polygon with minimum points', () => {
      getStore().startDrawing('polygon', { x: 0, y: 0 }, drawingContext);
      getStore().addPolygonPoint({ x: 100, y: 0 }, null);
      getStore().addPolygonPoint({ x: 50, y: 100 }, null);
      getStore().finishDrawing({ rowSpacing: 0.5, columnSpacing: 0.5 });

      expect(getStore().measurements.size).toBe(1);
      const polygon = Array.from(getStore().measurements.values())[0] as PolygonMeasurement;
      expect(polygon.points.length).toBe(3);
    });

    it('should not finish polygon with less than 3 points', () => {
      getStore().startDrawing('polygon', { x: 0, y: 0 }, drawingContext);
      getStore().addPolygonPoint({ x: 100, y: 0 }, null);
      getStore().finishDrawing({ rowSpacing: 0.5, columnSpacing: 0.5 });

      // Should not complete since not enough points
      expect(getStore().measurements.size).toBe(0);
    });
  });

  // ============================================================================
  // Point Editing
  // ============================================================================

  describe('Point Editing', () => {
    it('should move a point on a line measurement', () => {
      const id = getStore().createMeasurement(createLineMeasurementData());

      getStore().movePoint(id, 1, { x: 200, y: 200 }, { rowSpacing: 0.5, columnSpacing: 0.5 });

      const updated = getStore().measurements.get(id) as LineMeasurement;
      expect(updated.points[1]).toEqual({ x: 200, y: 200 });
    });

    it('should move entire measurement', () => {
      const id = getStore().createMeasurement(createLineMeasurementData());

      getStore().moveMeasurement(id, { x: 50, y: 50 }, { rowSpacing: 0.5, columnSpacing: 0.5 });

      const updated = getStore().measurements.get(id) as LineMeasurement;
      expect(updated.points[0]).toEqual({ x: 50, y: 50 });
      expect(updated.points[1]).toEqual({ x: 150, y: 150 });
    });
  });

  // ============================================================================
  // Queries
  // ============================================================================

  describe('Queries', () => {
    it('should get measurements for series', () => {
      getStore().createMeasurement(createLineMeasurementData({ seriesUid: 'series-1' }));
      getStore().createMeasurement(createLineMeasurementData({ seriesUid: 'series-2' }));

      const series1Measurements = getStore().getMeasurementsForSeries('series-1');
      expect(series1Measurements.length).toBe(1);

      const series2Measurements = getStore().getMeasurementsForSeries('series-2');
      expect(series2Measurements.length).toBe(1);
    });

    it('should get measurements for frame', () => {
      getStore().createMeasurement(createLineMeasurementData({
        seriesUid: 'series-1',
        frameKey: 'instance-1:0',
      }));
      getStore().createMeasurement(createLineMeasurementData({
        seriesUid: 'series-1',
        frameKey: 'instance-1:1',
      }));

      const frame0Measurements = getStore().getMeasurementsForFrame('series-1', 'instance-1:0');
      expect(frame0Measurements.length).toBe(1);
    });

    it('should get visible measurements', () => {
      const id1 = getStore().createMeasurement(createLineMeasurementData({
        seriesUid: 'series-1',
        frameKey: 'instance-1:0',
      }));

      getStore().createMeasurement(createLineMeasurementData({
        seriesUid: 'series-1',
        frameKey: 'instance-1:0',
      }));

      // Hide the first measurement
      getStore().updateMeasurement(id1, { visible: false });

      const visible = getStore().getVisibleMeasurements('series-1', 'instance-1:0', 'frame');
      expect(visible.length).toBe(1);
    });
  });

  // ============================================================================
  // Visibility Toggle
  // ============================================================================

  describe('Visibility', () => {
    it('should toggle measurement visibility via update', () => {
      const id = getStore().createMeasurement(createLineMeasurementData());

      expect(getStore().measurements.get(id)?.visible).toBe(true);

      getStore().updateMeasurement(id, { visible: false });
      expect(getStore().measurements.get(id)?.visible).toBe(false);

      getStore().updateMeasurement(id, { visible: true });
      expect(getStore().measurements.get(id)?.visible).toBe(true);
    });

    it('should show all measurements via bulk update', () => {
      const id1 = getStore().createMeasurement(createLineMeasurementData({ seriesUid: 'series-1' }));
      const id2 = getStore().createMeasurement(createLineMeasurementData({ seriesUid: 'series-1' }));

      getStore().updateMeasurement(id1, { visible: false });
      getStore().updateMeasurement(id2, { visible: false });

      // Show all by updating each
      for (const [id, m] of getStore().measurements) {
        if (m.seriesUid === 'series-1') {
          getStore().updateMeasurement(id, { visible: true });
        }
      }

      expect(getStore().measurements.get(id1)?.visible).toBe(true);
      expect(getStore().measurements.get(id2)?.visible).toBe(true);
    });

    it('should hide all measurements via bulk update', () => {
      const id1 = getStore().createMeasurement(createLineMeasurementData({ seriesUid: 'series-1' }));
      const id2 = getStore().createMeasurement(createLineMeasurementData({ seriesUid: 'series-1' }));

      // Hide all by updating each
      for (const [id, m] of getStore().measurements) {
        if (m.seriesUid === 'series-1') {
          getStore().updateMeasurement(id, { visible: false });
        }
      }

      expect(getStore().measurements.get(id1)?.visible).toBe(false);
      expect(getStore().measurements.get(id2)?.visible).toBe(false);
    });
  });

  // ============================================================================
  // Import/Export
  // ============================================================================

  describe('Import/Export', () => {
    it('should export measurements', () => {
      getStore().createMeasurement(createLineMeasurementData({ seriesUid: 'series-1' }));
      getStore().createMeasurement(createLineMeasurementData({ seriesUid: 'series-2' }));

      const allExported = getStore().exportMeasurements();
      expect(allExported.length).toBe(2);

      const series1Exported = getStore().exportMeasurements('series-1');
      expect(series1Exported.length).toBe(1);
    });

    it('should import measurements', () => {
      const measurements = [
        {
          id: 'imported-1',
          type: 'line' as const,
          seriesUid: 'series-1',
          frameKey: 'instance-1:0',
          scope: 'frame' as MeasurementScope,
          label: null,
          color: '#00FF00',
          visible: true,
          locked: false,
          createdAt: Date.now(),
          modifiedAt: Date.now(),
          points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] as [{ x: number; y: number }, { x: number; y: number }],
          lengthMm: 141.42,
          trackingData: null,
        },
      ];

      getStore().importMeasurements(measurements);

      expect(getStore().measurements.size).toBe(1);
      expect(getStore().measurements.get('imported-1')).toBeDefined();
    });
  });

  // ============================================================================
  // Tracking
  // ============================================================================

  describe('Tracking', () => {
    // Helper to create valid tracking data
    function createTrackingData() {
      return {
        seriesUid: 'series-1',
        totalFrames: 10,
        startFrameIndex: 0,
        frames: [
          { frameIndex: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], lengthMm: 100, valid: true },
          { frameIndex: 1, points: [{ x: 0, y: 0 }, { x: 105, y: 105 }], lengthMm: 105, valid: true },
          { frameIndex: 2, points: [{ x: 0, y: 0 }, { x: 110, y: 110 }], lengthMm: 110, valid: true },
        ],
        summary: {
          minMm: 100,
          maxMm: 110,
          meanMm: 105,
        },
      };
    }

    it('should set tracking data for a measurement', () => {
      const id = getStore().createMeasurement(createLineMeasurementData());

      const trackingData = createTrackingData();

      getStore().setTrackingData(id, trackingData);

      expect(getStore().trackingData.get(id)).toEqual(trackingData);
    });

    it('should set tracking in progress', () => {
      const id = getStore().createMeasurement(createLineMeasurementData());

      getStore().setTrackingInProgress(id);
      expect(getStore().trackingInProgress).toBe(id);

      getStore().setTrackingInProgress(null);
      expect(getStore().trackingInProgress).toBeNull();
    });

    it('should clear tracking data', () => {
      const id = getStore().createMeasurement(createLineMeasurementData());

      const trackingData = createTrackingData();

      getStore().setTrackingData(id, trackingData);
      expect(getStore().trackingData.get(id)).toBeDefined();

      getStore().clearTrackingData(id);
      expect(getStore().trackingData.get(id)).toBeUndefined();
    });
  });
});
