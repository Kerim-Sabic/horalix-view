/**
 * Hooks Index
 *
 * Re-exports all viewer hooks
 */

export {
  useMeasurementStore,
  selectMeasurements,
  selectSelectedId,
  selectHoveredId,
  selectActiveMeasurement,
  selectIsDrawing,
  selectCanUndo,
  selectCanRedo,
} from './useMeasurementStore';

export {
  useUndoRedo,
  useActionUndoRedo,
  type UndoRedoOptions,
  type UndoRedoReturn,
  type UndoableAction,
} from './useUndoRedo';

export {
  useViewerStore,
  selectCurrentFrameKey,
  selectCurrentInstance,
  selectPixelSpacing,
} from './useViewerStore';

export { useViewportInteraction } from './useViewportInteraction';

export {
  useMPRStore,
  selectVolumeInfo,
  selectCrosshairPosition,
  selectActiveView,
  selectLinked,
  selectShowCrosshairs,
  selectAxialView,
  selectCoronalView,
  selectSagittalView,
} from './useMPRStore';

export {
  useSegmentationStore,
  selectSegmentationResult,
  selectContours,
  selectClasses,
  selectSelectedContourId,
  selectEditTool,
  selectOverlayVisible,
  selectOverlayOpacity,
} from './useSegmentationStore';
