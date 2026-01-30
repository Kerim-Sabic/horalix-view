/**
 * Unified Measurement Type System
 *
 * Provides a comprehensive type hierarchy for all measurement types
 * in the DICOM viewer, supporting line, polyline, polygon, freehand,
 * ellipse, and rectangle measurements.
 */

// ============================================================================
// Base Types
// ============================================================================

/**
 * 2D point in image coordinates (pixels)
 */
export interface Point2D {
  x: number;
  y: number;
}

/**
 * Pixel spacing from DICOM metadata (mm per pixel)
 */
export interface PixelSpacing {
  rowSpacing: number; // mm per pixel in row direction (Y)
  columnSpacing: number; // mm per pixel in column direction (X)
}

/**
 * Measurement type discriminator
 */
export type MeasurementType =
  | 'line'
  | 'polyline'
  | 'polygon'
  | 'freehand'
  | 'ellipse'
  | 'rectangle';

/**
 * Scope determines where measurement persists and is visible
 * - frame: Only visible on specific frame
 * - series: Visible on all frames in series (can be tracked)
 * - volume: Spans multiple slices for 3D measurements
 */
export type MeasurementScope = 'frame' | 'series' | 'volume';

/**
 * Result of hit-testing a point against measurements
 */
export interface HitTestResult {
  measurementId: string;
  pointIndex: number | null; // null = hit on edge/body, number = control point
  distance: number; // Distance from hit point to measurement
}

// ============================================================================
// Tracking Data (Cine Measurement Tracking)
// ============================================================================

/**
 * Per-frame tracking data from cine measurement tracking
 */
export interface TrackedFrame {
  frameIndex: number;
  points: Point2D[];
  lengthMm: number | null;
  areaMm2?: number | null;
  valid: boolean;
}

/**
 * Summary statistics for tracked measurement
 */
export interface TrackingSummary {
  minMm: number | null;
  maxMm: number | null;
  meanMm: number | null;
  minAreaMm2?: number | null;
  maxAreaMm2?: number | null;
  meanAreaMm2?: number | null;
}

/**
 * Complete tracking data for a measurement across frames
 */
export interface TrackingData {
  seriesUid: string;
  totalFrames: number;
  startFrameIndex: number;
  frames: TrackedFrame[];
  summary: TrackingSummary;
}

// ============================================================================
// Volume Data (3D Measurements)
// ============================================================================

/**
 * Volume contour data for 3D volume calculation
 */
export interface VolumeContourData {
  sliceContours: Map<number, Point2D[]>;
  volumeMm3: number | null;
  sliceThicknessMm: number;
  calculationMethod: 'trapezoidal' | 'simpson';
}

// ============================================================================
// Base Measurement Interface
// ============================================================================

/**
 * Base measurement with common properties shared by all measurement types
 */
export interface BaseMeasurement {
  /** Unique identifier (UUID) */
  id: string;

  /** Discriminator for measurement type */
  type: MeasurementType;

  /** Scope determines visibility and persistence */
  scope: MeasurementScope;

  /** User-defined label (optional) */
  label: string | null;

  /** Display color (hex string) */
  color: string;

  /** Whether measurement is visible in overlay */
  visible: boolean;

  /** Whether measurement is locked from editing */
  locked: boolean;

  /** Creation timestamp (Unix ms) */
  createdAt: number;

  /** Last modification timestamp (Unix ms) */
  modifiedAt: number;

  /** Series this measurement belongs to */
  seriesUid: string;

  /** Frame key for frame-scoped measurements (null for series scope) */
  frameKey: string | null;
}

// ============================================================================
// Specific Measurement Types
// ============================================================================

/**
 * Line measurement - two endpoints with calculated length
 */
export interface LineMeasurement extends BaseMeasurement {
  type: 'line';
  /** Two points defining the line [start, end] */
  points: [Point2D, Point2D];
  /** Calculated length in mm (null if pixel spacing unavailable) */
  lengthMm: number | null;
  /** Cine tracking data (null if not tracked) */
  trackingData: TrackingData | null;
}

/**
 * Polyline measurement - multiple connected segments (open path)
 */
export interface PolylineMeasurement extends BaseMeasurement {
  type: 'polyline';
  /** Ordered points defining the polyline */
  points: Point2D[];
  /** Total length in mm */
  totalLengthMm: number | null;
  /** Individual segment lengths in mm */
  segmentLengths: (number | null)[];
  /** Always false for polyline (open path) */
  closed: false;
}

/**
 * Polygon measurement - closed shape with calculated area
 */
export interface PolygonMeasurement extends BaseMeasurement {
  type: 'polygon';
  /** Ordered points defining the polygon vertices */
  points: Point2D[];
  /** Perimeter in mm */
  perimeterMm: number | null;
  /** Area in mm^2 (calculated via Shoelace formula) */
  areaMm2: number | null;
  /** Volume data for 3D measurements (stacked across slices) */
  volumeData: VolumeContourData | null;
  /** Cine tracking data (null if not tracked) */
  trackingData: TrackingData | null;
}

/**
 * Freehand measurement - smooth drawn path with calculated area
 */
export interface FreehandMeasurement extends BaseMeasurement {
  type: 'freehand';
  /** Points sampled during freehand drawing */
  points: Point2D[];
  /** Perimeter in mm */
  perimeterMm: number | null;
  /** Area in mm^2 (if closed) */
  areaMm2: number | null;
  /** Whether the freehand drawing is closed */
  closed: boolean;
}

/**
 * Ellipse measurement - center, radii, rotation with calculated area
 */
export interface EllipseMeasurement extends BaseMeasurement {
  type: 'ellipse';
  /** Center point */
  center: Point2D;
  /** Horizontal radius in pixels */
  radiusX: number;
  /** Vertical radius in pixels */
  radiusY: number;
  /** Rotation angle in degrees */
  rotation: number;
  /** Area in mm^2 (pi * radiusX * radiusY) */
  areaMm2: number | null;
}

/**
 * Rectangle measurement - axis-aligned bounding box with area
 */
export interface RectangleMeasurement extends BaseMeasurement {
  type: 'rectangle';
  /** Top-left corner */
  topLeft: Point2D;
  /** Bottom-right corner */
  bottomRight: Point2D;
  /** Width in mm */
  widthMm: number | null;
  /** Height in mm */
  heightMm: number | null;
  /** Area in mm^2 */
  areaMm2: number | null;
}

// ============================================================================
// Union Type
// ============================================================================

/**
 * Union type for all measurement types
 */
export type Measurement =
  | LineMeasurement
  | PolylineMeasurement
  | PolygonMeasurement
  | FreehandMeasurement
  | EllipseMeasurement
  | RectangleMeasurement;

// ============================================================================
// Measurement Actions (for Undo/Redo)
// ============================================================================

/**
 * Actions that can be undone/redone
 */
export type MeasurementAction =
  | { type: 'CREATE'; measurement: Measurement }
  | {
      type: 'UPDATE';
      measurementId: string;
      before: Measurement;
      after: Measurement;
    }
  | { type: 'DELETE'; measurement: Measurement }
  | {
      type: 'MOVE_POINT';
      measurementId: string;
      pointIndex: number;
      before: Point2D;
      after: Point2D;
    }
  | {
      type: 'MOVE_MEASUREMENT';
      measurementId: string;
      delta: Point2D;
    }
  | { type: 'BATCH'; actions: MeasurementAction[] };

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for LineMeasurement
 */
export function isLineMeasurement(m: Measurement): m is LineMeasurement {
  return m.type === 'line';
}

/**
 * Type guard for PolygonMeasurement
 */
export function isPolygonMeasurement(m: Measurement): m is PolygonMeasurement {
  return m.type === 'polygon';
}

/**
 * Type guard for PolylineMeasurement
 */
export function isPolylineMeasurement(
  m: Measurement
): m is PolylineMeasurement {
  return m.type === 'polyline';
}

/**
 * Type guard for FreehandMeasurement
 */
export function isFreehandMeasurement(
  m: Measurement
): m is FreehandMeasurement {
  return m.type === 'freehand';
}

/**
 * Type guard for EllipseMeasurement
 */
export function isEllipseMeasurement(m: Measurement): m is EllipseMeasurement {
  return m.type === 'ellipse';
}

/**
 * Type guard for RectangleMeasurement
 */
export function isRectangleMeasurement(
  m: Measurement
): m is RectangleMeasurement {
  return m.type === 'rectangle';
}

/**
 * Check if measurement has area (polygon, freehand, ellipse, rectangle)
 */
export function hasArea(
  m: Measurement
): m is PolygonMeasurement | FreehandMeasurement | EllipseMeasurement | RectangleMeasurement {
  return (
    m.type === 'polygon' ||
    m.type === 'freehand' ||
    m.type === 'ellipse' ||
    m.type === 'rectangle'
  );
}

/**
 * Check if measurement supports cine tracking
 */
export function supportsTracking(
  m: Measurement
): m is LineMeasurement | PolygonMeasurement {
  return m.type === 'line' || m.type === 'polygon';
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new measurement ID
 */
export function createMeasurementId(): string {
  return crypto.randomUUID();
}

/**
 * Create default measurement properties
 */
export function createBaseMeasurementProps(
  type: MeasurementType,
  seriesUid: string,
  scope: MeasurementScope = 'series',
  frameKey: string | null = null
): Omit<BaseMeasurement, 'id'> {
  const now = Date.now();
  return {
    type,
    scope,
    label: null,
    color: '#3b82f6', // Blue-500
    visible: true,
    locked: false,
    createdAt: now,
    modifiedAt: now,
    seriesUid,
    frameKey: scope === 'frame' ? frameKey : null,
  };
}
