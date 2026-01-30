/**
 * Viewer Store
 *
 * Main Zustand store for viewer state management including:
 * - Study/Series/Instance data
 * - Viewport state (zoom, pan, window/level, rotation)
 * - Tool selection
 * - UI panel visibility
 * - Cine playback state
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  ViewportState,
  FrameIndex,
  ImageDimensions,
  ViewportSize,
  CinePlaybackState,
  PanelVisibility,
  MeasurementScope,
  ViewerTool,
  WindowLevel,
} from '../types';
import {
  createDefaultViewportState,
  createDefaultCineState,
  createDefaultPanelVisibility,
  getDefaultTool,
} from '../types';
import {
  MIN_ZOOM,
  MAX_ZOOM,
  getDefaultWindowLevel,
} from '../constants';
import { calculateBaseScale, clampPan, calculatePanBounds } from '../services';

// ============================================================================
// Types
// ============================================================================

interface StudyData {
  studyInstanceUid: string;
  patientName: string;
  patientId: string;
  studyDate: string | null;
  studyDescription: string | null;
  accessionNumber: string | null;
  modalities: string[];
}

interface SeriesData {
  seriesInstanceUid: string;
  seriesNumber: number | null;
  seriesDescription: string | null;
  modality: string;
  numInstances: number;
}

interface SeriesDetail {
  series: SeriesData;
  instances: InstanceData[];
  windowCenter: number | null;
  windowWidth: number | null;
  has3dData: boolean;
}

interface InstanceData {
  sopInstanceUid: string;
  instanceNumber: number | null;
  rows: number | null;
  columns: number | null;
  pixelSpacing: [number, number] | null;
  windowCenter: number | null;
  windowWidth: number | null;
  numberOfFrames: number | null;
  imageOrientationPatient: number[] | null;
}

// ============================================================================
// Store State
// ============================================================================

interface ViewerState {
  // Data
  studyUid: string | null;
  study: StudyData | null;
  seriesList: SeriesData[];
  selectedSeriesUid: string | null;
  selectedSeries: SeriesDetail | null;

  // Frame navigation
  frameIndex: FrameIndex[];
  currentSlice: number;
  totalSlices: number;

  // Viewport
  viewportState: ViewportState;
  viewportSize: ViewportSize;
  imageDimensions: ImageDimensions;
  baseScale: number;

  // Tools
  activeTool: ViewerTool;
  measurementScope: MeasurementScope;

  // UI
  panels: PanelVisibility;
  showAiOverlay: boolean;

  // Cine
  cine: CinePlaybackState;

  // Loading states
  loading: boolean;
  error: string | null;

  // Dialogs
  volumeDialogOpen: boolean;
  metadataDialogOpen: boolean;
  settingsDialogOpen: boolean;

  // Snackbar
  snackbarMessage: string | null;
}

interface ViewerActions {
  // Data actions
  setStudyUid: (uid: string | null) => void;
  setStudy: (study: StudyData | null) => void;
  setSeriesList: (series: SeriesData[]) => void;
  selectSeries: (seriesUid: string | null, detail?: SeriesDetail) => void;

  // Frame navigation
  setFrameIndex: (frames: FrameIndex[]) => void;
  setCurrentSlice: (slice: number) => void;
  goToNextSlice: () => void;
  goToPrevSlice: () => void;
  goToFirstSlice: () => void;
  goToLastSlice: () => void;

  // Viewport actions
  setViewportSize: (size: ViewportSize) => void;
  setImageDimensions: (dimensions: ImageDimensions) => void;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setPan: (pan: { x: number; y: number }) => void;
  setWindowLevel: (wl: WindowLevel) => void;
  setRotation: (rotation: number) => void;
  rotate90: () => void;
  resetView: () => void;

  // Tool actions
  setActiveTool: (tool: ViewerTool) => void;
  setMeasurementScope: (scope: MeasurementScope) => void;

  // UI actions
  togglePanel: (panel: keyof PanelVisibility) => void;
  setShowAiOverlay: (show: boolean) => void;

  // Cine actions
  togglePlayback: () => void;
  setPlaying: (playing: boolean) => void;
  setCineFps: (fps: number) => void;

  // Loading
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Dialogs
  openVolumeDialog: () => void;
  closeVolumeDialog: () => void;
  openMetadataDialog: () => void;
  closeMetadataDialog: () => void;
  openSettingsDialog: () => void;
  closeSettingsDialog: () => void;

  // Snackbar
  showSnackbar: (message: string) => void;
  hideSnackbar: () => void;

  // Reset
  reset: () => void;
}

type ViewerStore = ViewerState & ViewerActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: ViewerState = {
  studyUid: null,
  study: null,
  seriesList: [],
  selectedSeriesUid: null,
  selectedSeries: null,

  frameIndex: [],
  currentSlice: 0,
  totalSlices: 1,

  viewportState: createDefaultViewportState(),
  viewportSize: { width: 0, height: 0 },
  imageDimensions: { rows: 512, columns: 512 },
  baseScale: 1,

  activeTool: getDefaultTool(),
  measurementScope: 'series',

  panels: createDefaultPanelVisibility(),
  showAiOverlay: true,

  cine: createDefaultCineState(),

  loading: true,
  error: null,

  volumeDialogOpen: false,
  metadataDialogOpen: false,
  settingsDialogOpen: false,

  snackbarMessage: null,
};

// ============================================================================
// Store
// ============================================================================

export const useViewerStore = create<ViewerStore>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    // ========================================================================
    // Data Actions
    // ========================================================================

    setStudyUid: (uid) => set({ studyUid: uid }),

    setStudy: (study) => set({ study }),

    setSeriesList: (seriesList) => set({ seriesList }),

    selectSeries: (seriesUid, detail) => {
      if (!seriesUid) {
        set({
          selectedSeriesUid: null,
          selectedSeries: null,
          frameIndex: [],
          currentSlice: 0,
          totalSlices: 1,
        });
        return;
      }

      const updates: Partial<ViewerState> = {
        selectedSeriesUid: seriesUid,
      };

      if (detail) {
        updates.selectedSeries = detail;

        // Build frame index from instances
        const frames = buildFrameIndex(detail.instances);
        updates.frameIndex = frames;
        updates.totalSlices = frames.length || 1;
        updates.currentSlice = 0;

        // Set image dimensions from first instance
        if (frames.length > 0) {
          const firstFrame = frames[0];
          if (firstFrame.rows && firstFrame.columns) {
            updates.imageDimensions = {
              rows: firstFrame.rows,
              columns: firstFrame.columns,
            };
          }
        }

        // Set default window level from series or modality
        if (detail.windowCenter !== null && detail.windowWidth !== null) {
          updates.viewportState = {
            ...get().viewportState,
            windowLevel: {
              center: detail.windowCenter,
              width: detail.windowWidth,
            },
          };
        } else {
          const defaultWL = getDefaultWindowLevel(detail.series.modality);
          updates.viewportState = {
            ...get().viewportState,
            windowLevel: defaultWL,
          };
        }
      }

      set(updates);
    },

    // ========================================================================
    // Frame Navigation
    // ========================================================================

    setFrameIndex: (frameIndex) => {
      set({
        frameIndex,
        totalSlices: frameIndex.length || 1,
      });
    },

    setCurrentSlice: (slice) => {
      const { totalSlices, cine } = get();
      const clampedSlice = Math.max(0, Math.min(slice, totalSlices - 1));

      // Stop playback when manually changing slice
      if (cine.isPlaying) {
        set({
          currentSlice: clampedSlice,
          cine: { ...cine, isPlaying: false },
        });
      } else {
        set({ currentSlice: clampedSlice });
      }
    },

    goToNextSlice: () => {
      const { currentSlice, totalSlices, cine } = get();
      const nextSlice = cine.loop
        ? (currentSlice + 1) % totalSlices
        : Math.min(currentSlice + 1, totalSlices - 1);
      set({ currentSlice: nextSlice });
    },

    goToPrevSlice: () => {
      const { currentSlice, totalSlices, cine } = get();
      const prevSlice = cine.loop
        ? (currentSlice - 1 + totalSlices) % totalSlices
        : Math.max(currentSlice - 1, 0);
      set({ currentSlice: prevSlice });
    },

    goToFirstSlice: () => set({ currentSlice: 0 }),

    goToLastSlice: () => {
      const { totalSlices } = get();
      set({ currentSlice: totalSlices - 1 });
    },

    // ========================================================================
    // Viewport Actions
    // ========================================================================

    setViewportSize: (viewportSize) => {
      const { imageDimensions } = get();
      const baseScale = calculateBaseScale(viewportSize, imageDimensions);
      set({ viewportSize, baseScale });
    },

    setImageDimensions: (imageDimensions) => {
      const { viewportSize } = get();
      const baseScale = calculateBaseScale(viewportSize, imageDimensions);
      set({ imageDimensions, baseScale });
    },

    setZoom: (zoom) => {
      const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
      const { viewportState, viewportSize, imageDimensions, baseScale } = get();

      // Clamp pan to new bounds
      const scale = baseScale * clampedZoom;
      const bounds = calculatePanBounds(
        viewportSize,
        imageDimensions,
        scale,
        viewportState.rotation
      );
      const clampedPan = clampPan(viewportState.pan, bounds);

      set({
        viewportState: {
          ...viewportState,
          zoom: clampedZoom,
          pan: clampedPan,
        },
      });
    },

    zoomIn: () => {
      const { viewportState } = get();
      get().setZoom(viewportState.zoom * 1.25);
    },

    zoomOut: () => {
      const { viewportState } = get();
      get().setZoom(viewportState.zoom / 1.25);
    },

    resetZoom: () => {
      set((state) => ({
        viewportState: {
          ...state.viewportState,
          zoom: 1,
          pan: { x: 0, y: 0 },
        },
      }));
    },

    setPan: (pan) => {
      const { viewportState, viewportSize, imageDimensions, baseScale } = get();
      const scale = baseScale * viewportState.zoom;
      const bounds = calculatePanBounds(
        viewportSize,
        imageDimensions,
        scale,
        viewportState.rotation
      );
      const clampedPan = clampPan(pan, bounds);

      set({
        viewportState: {
          ...viewportState,
          pan: clampedPan,
        },
      });
    },

    setWindowLevel: (windowLevel) => {
      set((state) => ({
        viewportState: {
          ...state.viewportState,
          windowLevel,
        },
      }));
    },

    setRotation: (rotation) => {
      const normalized = ((rotation % 360) + 360) % 360;
      set((state) => ({
        viewportState: {
          ...state.viewportState,
          rotation: normalized,
        },
      }));
    },

    rotate90: () => {
      const { viewportState } = get();
      get().setRotation(viewportState.rotation + 90);
    },

    resetView: () => {
      set((state) => ({
        viewportState: {
          ...state.viewportState,
          zoom: 1,
          pan: { x: 0, y: 0 },
          rotation: 0,
        },
      }));
    },

    // ========================================================================
    // Tool Actions
    // ========================================================================

    setActiveTool: (activeTool) => set({ activeTool }),

    setMeasurementScope: (measurementScope) => set({ measurementScope }),

    // ========================================================================
    // UI Actions
    // ========================================================================

    togglePanel: (panel) => {
      set((state) => ({
        panels: {
          ...state.panels,
          [panel]: !state.panels[panel],
        },
      }));
    },

    setShowAiOverlay: (showAiOverlay) => set({ showAiOverlay }),

    // ========================================================================
    // Cine Actions
    // ========================================================================

    togglePlayback: () => {
      const { cine, totalSlices } = get();
      if (totalSlices <= 1) return;
      set({ cine: { ...cine, isPlaying: !cine.isPlaying } });
    },

    setPlaying: (isPlaying) => {
      const { cine, totalSlices } = get();
      if (totalSlices <= 1 && isPlaying) return;
      set({ cine: { ...cine, isPlaying } });
    },

    setCineFps: (fps) => {
      const clampedFps = Math.max(1, Math.min(60, fps));
      set((state) => ({
        cine: { ...state.cine, fps: clampedFps },
      }));
    },

    // ========================================================================
    // Loading
    // ========================================================================

    setLoading: (loading) => set({ loading }),

    setError: (error) => set({ error, loading: false }),

    // ========================================================================
    // Dialogs
    // ========================================================================

    openVolumeDialog: () => set({ volumeDialogOpen: true }),
    closeVolumeDialog: () => set({ volumeDialogOpen: false }),

    openMetadataDialog: () => set({ metadataDialogOpen: true }),
    closeMetadataDialog: () => set({ metadataDialogOpen: false }),

    openSettingsDialog: () => set({ settingsDialogOpen: true }),
    closeSettingsDialog: () => set({ settingsDialogOpen: false }),

    // ========================================================================
    // Snackbar
    // ========================================================================

    showSnackbar: (message) => set({ snackbarMessage: message }),
    hideSnackbar: () => set({ snackbarMessage: null }),

    // ========================================================================
    // Reset
    // ========================================================================

    reset: () => set(initialState),
  }))
);

// ============================================================================
// Helper Functions
// ============================================================================

function buildFrameIndex(instances: InstanceData[]): FrameIndex[] {
  const frames: FrameIndex[] = [];

  // Sort instances by instance number
  const sorted = [...instances].sort((a, b) => {
    const numA = a.instanceNumber ?? 0;
    const numB = b.instanceNumber ?? 0;
    return numA - numB;
  });

  for (const instance of sorted) {
    const numFrames = instance.numberOfFrames ?? 1;

    for (let i = 0; i < numFrames; i++) {
      frames.push({
        instanceUid: instance.sopInstanceUid,
        frameIndex: i,
        rows: instance.rows,
        columns: instance.columns,
        instanceNumber: instance.instanceNumber,
        numberOfFrames: numFrames,
      });
    }
  }

  return frames;
}

// ============================================================================
// Selectors
// ============================================================================

export const selectStudy = (state: ViewerStore) => state.study;
export const selectSeriesList = (state: ViewerStore) => state.seriesList;
export const selectSelectedSeries = (state: ViewerStore) => state.selectedSeries;
export const selectCurrentSlice = (state: ViewerStore) => state.currentSlice;
export const selectTotalSlices = (state: ViewerStore) => state.totalSlices;
export const selectViewportState = (state: ViewerStore) => state.viewportState;
export const selectActiveTool = (state: ViewerStore) => state.activeTool;
export const selectPanels = (state: ViewerStore) => state.panels;
export const selectCine = (state: ViewerStore) => state.cine;
export const selectIsPlaying = (state: ViewerStore) => state.cine.isPlaying;
export const selectLoading = (state: ViewerStore) => state.loading;
export const selectError = (state: ViewerStore) => state.error;

// Computed selectors
export const selectCurrentFrameKey = (state: ViewerStore): string | null => {
  const { frameIndex, currentSlice } = state;
  if (frameIndex.length === 0) return null;
  const frame = frameIndex[currentSlice];
  if (!frame) return null;
  return `${frame.instanceUid}:${frame.frameIndex}`;
};

export const selectCurrentInstance = (state: ViewerStore): InstanceData | null => {
  const { selectedSeries, frameIndex, currentSlice } = state;
  if (!selectedSeries || frameIndex.length === 0) return null;

  const frame = frameIndex[currentSlice];
  if (!frame) return null;

  return (
    selectedSeries.instances.find(
      (i) => i.sopInstanceUid === frame.instanceUid
    ) ?? null
  );
};

export const selectPixelSpacing = (state: ViewerStore) => {
  const instance = selectCurrentInstance(state);
  if (!instance?.pixelSpacing) return null;
  return {
    rowSpacing: instance.pixelSpacing[0],
    columnSpacing: instance.pixelSpacing[1],
  };
};
