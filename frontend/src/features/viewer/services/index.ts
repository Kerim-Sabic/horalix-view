/**
 * Services Index
 *
 * Re-exports all viewer services
 */

// Geometry service
export {
  distancePixels,
  calculateDistanceMm,
  midpoint,
  centroid,
  calculatePolygonAreaMm2,
  calculatePolygonAreaPixels,
  calculateEllipseAreaMm2,
  calculateRectangleAreaMm2,
  calculatePerimeterMm,
  calculateSegmentLengths,
  calculateVolumeFromContours,
  calculateVolumeSimpsons,
  distanceToLineSegment,
  isPointInPolygon,
  isPointInEllipse,
  hitTestMeasurements,
  getBoundingBox,
  getMeasurementBoundingBox,
  type BoundingBox,
} from './geometryService';

// Coordinate service
export {
  rotatePoint,
  rotatePointAround,
  calculateBaseScale,
  calculateEffectiveScale,
  screenToImage,
  imageToScreen,
  screenDistanceToImage,
  imageDistanceToScreen,
  isPointInImageBounds,
  isScreenPointInImage,
  clampPointToImage,
  calculatePanBounds,
  clampPan,
  calculateZoomAtPoint,
  createTransformContext,
  getViewportTransform,
  getSvgViewBox,
} from './coordinateService';

// Measurement persistence service
export {
  saveMeasurementsToStorage,
  loadMeasurementsFromStorage,
  clearMeasurementsFromStorage,
  listStoredSeries,
  getStorageInfo,
  exportMeasurementsAsJson,
  exportMeasurementsAsCsv,
  downloadMeasurements,
  importMeasurementsFromJson,
  importMeasurementsFromFile,
  syncMeasurementsToBackend,
  loadMeasurementsFromBackend,
} from './measurementPersistence';

// Export service (DICOM SR, PDF, JSON, CSV)
export {
  type ExportFormat,
  type ExportOptions,
  type PDFReportData,
  type PDFMeasurementEntry,
  type PDFTrackingChart,
  type PDFImageEntry,
  type JSONExportData,
  DEFAULT_EXPORT_OPTIONS,
  generateDicomSRContent,
  generatePDFReportData,
  generatePDFHTML,
  generateJSONExport,
  generateCSVExport,
  downloadFile,
  exportMeasurements,
} from './exportService';
