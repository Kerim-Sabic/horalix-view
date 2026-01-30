/**
 * MPR Store
 *
 * Zustand store for managing Multi-Planar Reconstruction state including:
 * - Synchronized crosshair position
 * - Individual view states (axial, coronal, sagittal)
 * - Volume information
 * - Linked navigation
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  MPRState,
  MPRPlane,
  MPRViewState,
  VolumeInfo,
  VolumeIndex,
} from '../types/mpr.types';
import {
  createDefaultMPRState,
  getSliceFromCrosshair,
  updateCrosshairFromSlice,
  clampCrosshairToVolume,
} from '../types/mpr.types';
import type { WindowLevel } from '../types';

// ============================================================================
// Store Types
// ============================================================================

interface MPRActions {
  // Volume
  setVolumeInfo: (info: VolumeInfo) => void;
  clearVolume: () => void;

  // Crosshair
  setCrosshairPosition: (position: VolumeIndex) => void;
  moveCrosshairBy: (delta: Partial<VolumeIndex>) => void;

  // View state
  setSliceIndex: (plane: MPRPlane, index: number) => void;
  setZoom: (plane: MPRPlane, zoom: number) => void;
  setPan: (plane: MPRPlane, pan: { x: number; y: number }) => void;
  setWindowLevel: (plane: MPRPlane, windowLevel: WindowLevel) => void;
  setThickness: (plane: MPRPlane, thickness: number) => void;
  setRenderMode: (plane: MPRPlane, mode: MPRViewState['renderMode']) => void;
  resetView: (plane: MPRPlane) => void;
  resetAllViews: () => void;

  // View settings
  setActiveView: (plane: MPRPlane | null) => void;
  toggleLinked: () => void;
  toggleCrosshairs: () => void;
  setShowCrosshair: (plane: MPRPlane, show: boolean) => void;

  // Window/Level sync
  syncWindowLevelToAll: (windowLevel: WindowLevel) => void;

  // Queries
  getViewState: (plane: MPRPlane) => MPRViewState;

  // Reset
  reset: () => void;
}

type MPRStore = MPRState & MPRActions;

// ============================================================================
// Store Definition
// ============================================================================

export const useMPRStore = create<MPRStore>()(
  subscribeWithSelector((set, get) => ({
    ...createDefaultMPRState(),

    // ====================================================================
    // Volume
    // ====================================================================

    setVolumeInfo: (info) => {
      // Initialize crosshair to center of volume
      const centerPosition: VolumeIndex = {
        i: Math.floor(info.dimensions[0] / 2),
        j: Math.floor(info.dimensions[1] / 2),
        k: Math.floor(info.dimensions[2] / 2),
      };

      set((state) => ({
        volumeInfo: info,
        crosshairPosition: centerPosition,
        views: {
          axial: {
            ...state.views.axial,
            sliceIndex: centerPosition.k,
            windowLevel: getDefaultWindowLevel(info.modality),
          },
          coronal: {
            ...state.views.coronal,
            sliceIndex: centerPosition.j,
            windowLevel: getDefaultWindowLevel(info.modality),
          },
          sagittal: {
            ...state.views.sagittal,
            sliceIndex: centerPosition.i,
            windowLevel: getDefaultWindowLevel(info.modality),
          },
        },
      }));
    },

    clearVolume: () => {
      set(createDefaultMPRState());
    },

    // ====================================================================
    // Crosshair
    // ====================================================================

    setCrosshairPosition: (position) => {
      const { volumeInfo, linked } = get();
      if (!volumeInfo) return;

      const clamped = clampCrosshairToVolume(position, volumeInfo.dimensions);

      set((state) => {
        const newState: Partial<MPRState> = {
          crosshairPosition: clamped,
        };

        // Update slice indices if linked
        if (linked) {
          newState.views = {
            axial: { ...state.views.axial, sliceIndex: clamped.k },
            coronal: { ...state.views.coronal, sliceIndex: clamped.j },
            sagittal: { ...state.views.sagittal, sliceIndex: clamped.i },
          };
        }

        return newState;
      });
    },

    moveCrosshairBy: (delta) => {
      const { crosshairPosition, volumeInfo } = get();
      if (!volumeInfo) return;

      const newPosition: VolumeIndex = {
        i: crosshairPosition.i + (delta.i || 0),
        j: crosshairPosition.j + (delta.j || 0),
        k: crosshairPosition.k + (delta.k || 0),
      };

      get().setCrosshairPosition(newPosition);
    },

    // ====================================================================
    // View State
    // ====================================================================

    setSliceIndex: (plane, index) => {
      const { volumeInfo, linked } = get();
      if (!volumeInfo) return;

      // Clamp to valid range
      let maxIndex: number;
      switch (plane) {
        case 'axial':
          maxIndex = volumeInfo.dimensions[2] - 1;
          break;
        case 'coronal':
          maxIndex = volumeInfo.dimensions[1] - 1;
          break;
        case 'sagittal':
          maxIndex = volumeInfo.dimensions[0] - 1;
          break;
      }

      const clampedIndex = Math.max(0, Math.min(maxIndex, index));

      set((state) => {
        const newViews = { ...state.views };
        newViews[plane] = { ...newViews[plane], sliceIndex: clampedIndex };

        // Update crosshair if linked
        let newCrosshair = state.crosshairPosition;
        if (linked) {
          newCrosshair = updateCrosshairFromSlice(newCrosshair, plane, clampedIndex);
        }

        return {
          views: newViews,
          crosshairPosition: newCrosshair,
        };
      });
    },

    setZoom: (plane, zoom) => {
      const clampedZoom = Math.max(0.25, Math.min(10, zoom));

      set((state) => ({
        views: {
          ...state.views,
          [plane]: { ...state.views[plane], zoom: clampedZoom },
        },
      }));
    },

    setPan: (plane, pan) => {
      set((state) => ({
        views: {
          ...state.views,
          [plane]: { ...state.views[plane], pan },
        },
      }));
    },

    setWindowLevel: (plane, windowLevel) => {
      set((state) => ({
        views: {
          ...state.views,
          [plane]: { ...state.views[plane], windowLevel },
        },
      }));
    },

    setThickness: (plane, thickness) => {
      const clampedThickness = Math.max(1, Math.min(50, thickness));

      set((state) => ({
        views: {
          ...state.views,
          [plane]: { ...state.views[plane], thickness: clampedThickness },
        },
      }));
    },

    setRenderMode: (plane, mode) => {
      set((state) => ({
        views: {
          ...state.views,
          [plane]: { ...state.views[plane], renderMode: mode },
        },
      }));
    },

    resetView: (plane) => {
      const { volumeInfo } = get();

      set((state) => ({
        views: {
          ...state.views,
          [plane]: {
            ...state.views[plane],
            zoom: 1,
            pan: { x: 0, y: 0 },
            sliceIndex: volumeInfo
              ? getSliceFromCrosshair(state.crosshairPosition, plane)
              : 0,
          },
        },
      }));
    },

    resetAllViews: () => {
      const { volumeInfo, crosshairPosition } = get();

      set((state) => ({
        views: {
          axial: {
            ...state.views.axial,
            zoom: 1,
            pan: { x: 0, y: 0 },
            sliceIndex: volumeInfo
              ? getSliceFromCrosshair(crosshairPosition, 'axial')
              : 0,
          },
          coronal: {
            ...state.views.coronal,
            zoom: 1,
            pan: { x: 0, y: 0 },
            sliceIndex: volumeInfo
              ? getSliceFromCrosshair(crosshairPosition, 'coronal')
              : 0,
          },
          sagittal: {
            ...state.views.sagittal,
            zoom: 1,
            pan: { x: 0, y: 0 },
            sliceIndex: volumeInfo
              ? getSliceFromCrosshair(crosshairPosition, 'sagittal')
              : 0,
          },
        },
      }));
    },

    // ====================================================================
    // View Settings
    // ====================================================================

    setActiveView: (plane) => {
      set({ activeView: plane });
    },

    toggleLinked: () => {
      set((state) => ({ linked: !state.linked }));
    },

    toggleCrosshairs: () => {
      set((state) => ({ showCrosshairs: !state.showCrosshairs }));
    },

    setShowCrosshair: (plane, show) => {
      set((state) => ({
        views: {
          ...state.views,
          [plane]: { ...state.views[plane], showCrosshair: show },
        },
      }));
    },

    // ====================================================================
    // Window/Level Sync
    // ====================================================================

    syncWindowLevelToAll: (windowLevel) => {
      set((state) => ({
        views: {
          axial: { ...state.views.axial, windowLevel },
          coronal: { ...state.views.coronal, windowLevel },
          sagittal: { ...state.views.sagittal, windowLevel },
        },
      }));
    },

    // ====================================================================
    // Queries
    // ====================================================================

    getViewState: (plane) => {
      return get().views[plane];
    },

    // ====================================================================
    // Reset
    // ====================================================================

    reset: () => {
      set(createDefaultMPRState());
    },
  }))
);

// ============================================================================
// Selectors
// ============================================================================

export const selectVolumeInfo = (state: MPRStore) => state.volumeInfo;
export const selectCrosshairPosition = (state: MPRStore) => state.crosshairPosition;
export const selectActiveView = (state: MPRStore) => state.activeView;
export const selectLinked = (state: MPRStore) => state.linked;
export const selectShowCrosshairs = (state: MPRStore) => state.showCrosshairs;

export const selectAxialView = (state: MPRStore) => state.views.axial;
export const selectCoronalView = (state: MPRStore) => state.views.coronal;
export const selectSagittalView = (state: MPRStore) => state.views.sagittal;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get default window level for modality
 */
function getDefaultWindowLevel(modality: string): WindowLevel {
  switch (modality.toUpperCase()) {
    case 'CT':
      return { center: 40, width: 400 };
    case 'MR':
      return { center: 400, width: 800 };
    default:
      return { center: 128, width: 256 };
  }
}
