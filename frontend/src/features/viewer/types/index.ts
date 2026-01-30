/**
 * Viewer Types Index
 *
 * Re-exports all types for convenient importing
 */

// Measurement types
export type {
  Point2D,
  PixelSpacing,
  MeasurementType,
  MeasurementScope,
  HitTestResult,
  TrackedFrame,
  TrackingSummary,
  TrackingData,
  VolumeContourData,
  BaseMeasurement,
  LineMeasurement,
  PolylineMeasurement,
  PolygonMeasurement,
  FreehandMeasurement,
  EllipseMeasurement,
  RectangleMeasurement,
  Measurement,
  MeasurementAction,
} from './measurement.types';

export {
  isLineMeasurement,
  isPolygonMeasurement,
  isPolylineMeasurement,
  isFreehandMeasurement,
  isEllipseMeasurement,
  isRectangleMeasurement,
  hasArea,
  supportsTracking,
  createMeasurementId,
  createBaseMeasurementProps,
} from './measurement.types';

// Viewer types
export type {
  WindowLevel,
  PanOffset,
  ViewportState,
  FrameIndex,
  ImageDimensions,
  ViewportSize,
  CoordinateTransformContext,
  ViewerContext,
  SeriesInfo,
  StudyInfo,
  LoadingState,
  ErrorState,
  CinePlaybackState,
  OrientationMarkers,
  PanelVisibility,
} from './viewer.types';

export {
  createDefaultViewportState,
  createDefaultCineState,
  getAxisLabel,
  getOrientationMarkers,
  createDefaultPanelVisibility,
} from './viewer.types';

// Tool types
export type {
  NavigationTool,
  MeasurementTool,
  SelectionTool,
  ViewerTool,
  ToolCategory,
  ToolConfig,
  PointerMode,
  DragState,
} from './tool.types';

export {
  TOOL_CONFIGS,
  isNavigationTool,
  isMeasurementTool,
  isSelectionTool,
  createDragState,
  getToolCursor,
  getToolsByCategory,
  getDefaultTool,
} from './tool.types';

// MPR types
export type {
  MPRPlane,
  PlaneConfig,
  VolumePosition,
  VolumeIndex,
  PatientPosition,
  VolumeInfo,
  MPRViewState,
  MPRState,
  CrosshairLine,
  CrosshairDragEvent,
  MPRAction,
  MPRSliceRequest,
  MPRSliceResponse,
} from './mpr.types';

export {
  PLANE_CONFIGS,
  createDefaultMPRViewState,
  createDefaultMPRState,
  getSliceFromCrosshair,
  updateCrosshairFromSlice,
  clampCrosshairToVolume,
  volumeIndexToPatient,
  patientToVolumeIndex,
  getCrosshairLinesForView,
} from './mpr.types';

// AI Segmentation types
export type {
  SegmentationFormat,
  SegmentationClass,
  RLEMask,
  BitmapMask,
  PolygonMask,
  SegmentationMask,
  SegmentationInstance,
  AISegmentationResult,
  EditableContour,
  SegmentationEditState,
  SegmentationEditTool,
  SegmentationEditAction,
} from './aiSegmentation.types';

export {
  rleToPolygons,
  bitmapToPolygons,
  simplifyPolygon,
  smoothPolygon,
  calculatePolygonAreaPx,
  areaPixelsToMm2,
  createEditableContour,
} from './aiSegmentation.types';
