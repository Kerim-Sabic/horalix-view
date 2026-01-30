/**
 * AI Segmentation Types
 *
 * Types for AI-generated segmentation masks and their conversion
 * to editable polygon annotations
 */

import type { Point2D, PixelSpacing } from './measurement.types';

// ============================================================================
// Segmentation Mask Types
// ============================================================================

/** Supported segmentation mask formats */
export type SegmentationFormat = 'rle' | 'bitmap' | 'polygon' | 'dicom-seg';

/** Segmentation class/label definition */
export interface SegmentationClass {
  id: number;
  name: string;
  color: string;
  visible: boolean;
  opacity: number;
}

/** Run-length encoded mask */
export interface RLEMask {
  format: 'rle';
  width: number;
  height: number;
  counts: number[];
}

/** Bitmap mask (raw pixel data) */
export interface BitmapMask {
  format: 'bitmap';
  width: number;
  height: number;
  data: Uint8Array;
}

/** Polygon-based mask */
export interface PolygonMask {
  format: 'polygon';
  width: number;
  height: number;
  polygons: Point2D[][];
}

/** Union of supported mask formats */
export type SegmentationMask = RLEMask | BitmapMask | PolygonMask;

// ============================================================================
// AI Segmentation Result
// ============================================================================

/** Single segmentation instance */
export interface SegmentationInstance {
  id: string;
  classId: number;
  className: string;
  confidence: number;
  mask: SegmentationMask;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  areaPx: number;
  areaMm2: number | null;
}

/** Complete AI segmentation result for a frame */
export interface AISegmentationResult {
  id: string;
  seriesUid: string;
  frameKey: string;
  modelName: string;
  modelVersion: string;
  timestamp: number;
  classes: SegmentationClass[];
  instances: SegmentationInstance[];
  processingTimeMs: number;
}

// ============================================================================
// Editable Contour Types
// ============================================================================

/** Editable contour derived from segmentation */
export interface EditableContour {
  id: string;
  segmentationId: string;
  instanceId: string;
  classId: number;
  className: string;
  color: string;
  points: Point2D[];
  originalPoints: Point2D[];
  isModified: boolean;
  isDeleted: boolean;
  visible: boolean;
  locked: boolean;
  areaPx: number;
  areaMm2: number | null;
  perimeterMm: number | null;
}

/** State for editing segmentation contours */
export interface SegmentationEditState {
  /** Active contour being edited */
  activeContourId: string | null;

  /** Point being dragged */
  draggingPointIndex: number | null;

  /** Mode for brush/eraser tools */
  brushSize: number;

  /** Current edit tool */
  editTool: SegmentationEditTool;

  /** Points added during current edit session (for undo) */
  pendingPoints: Point2D[];
}

/** Tools for editing segmentation */
export type SegmentationEditTool =
  | 'select'      // Select and move contours
  | 'edit-points' // Edit individual vertices
  | 'brush'       // Add to contour with brush
  | 'eraser'      // Remove from contour with eraser
  | 'scissors'    // Split contour
  | 'smooth'      // Smooth contour edges
  | 'simplify';   // Reduce number of points

// ============================================================================
// Segmentation Edit Actions (for undo/redo)
// ============================================================================

export type SegmentationEditAction =
  | { type: 'MODIFY_CONTOUR'; contourId: string; before: Point2D[]; after: Point2D[] }
  | { type: 'DELETE_CONTOUR'; contour: EditableContour }
  | { type: 'RESTORE_CONTOUR'; contourId: string }
  | { type: 'ADD_POINTS'; contourId: string; points: Point2D[]; insertIndex: number }
  | { type: 'REMOVE_POINTS'; contourId: string; startIndex: number; count: number; removed: Point2D[] }
  | { type: 'SPLIT_CONTOUR'; originalId: string; newContours: EditableContour[] }
  | { type: 'MERGE_CONTOURS'; sourceIds: string[]; mergedContour: EditableContour };

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert RLE mask to polygon contours using marching squares
 */
export function rleToPolygons(mask: RLEMask): Point2D[][] {
  // Decode RLE to bitmap first
  const bitmap = new Uint8Array(mask.width * mask.height);
  let pos = 0;
  let val = 0;

  for (const count of mask.counts) {
    for (let i = 0; i < count && pos < bitmap.length; i++) {
      bitmap[pos++] = val;
    }
    val = 1 - val;
  }

  // Simple contour finding (basic implementation)
  // In production, use a proper marching squares library
  return findContours(bitmap, mask.width, mask.height);
}

/**
 * Convert bitmap mask to polygon contours
 */
export function bitmapToPolygons(mask: BitmapMask): Point2D[][] {
  return findContours(mask.data, mask.width, mask.height);
}

/**
 * Simple contour finding (basic flood-fill based)
 */
function findContours(data: Uint8Array, width: number, height: number): Point2D[][] {
  const visited = new Uint8Array(width * height);
  const contours: Point2D[][] = [];

  // Find boundary pixels using simple edge detection
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;

      if (data[idx] && !visited[idx]) {
        // Check if this is a boundary pixel
        const isBoundary =
          !data[idx - 1] || !data[idx + 1] ||
          !data[idx - width] || !data[idx + width];

        if (isBoundary) {
          const contour = traceContour(data, visited, width, height, x, y);
          if (contour.length >= 3) {
            contours.push(contour);
          }
        }
      }
    }
  }

  return contours;
}

/**
 * Trace a contour starting from a boundary pixel
 */
function traceContour(
  data: Uint8Array,
  visited: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number
): Point2D[] {
  const contour: Point2D[] = [];
  const directions = [
    { dx: 1, dy: 0 },
    { dx: 1, dy: 1 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: -1, dy: -1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: -1 },
  ];

  let x = startX;
  let y = startY;
  let dir = 0;
  let maxSteps = width * height;

  do {
    const idx = y * width + x;
    if (!visited[idx]) {
      contour.push({ x, y });
      visited[idx] = 1;
    }

    // Find next boundary pixel
    let found = false;
    for (let i = 0; i < 8; i++) {
      const tryDir = (dir + i) % 8;
      const nx = x + directions[tryDir].dx;
      const ny = y + directions[tryDir].dy;

      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nidx = ny * width + nx;
        if (data[nidx] && !visited[nidx]) {
          // Check if it's a boundary
          const isBoundary =
            (nx > 0 && !data[nidx - 1]) ||
            (nx < width - 1 && !data[nidx + 1]) ||
            (ny > 0 && !data[nidx - width]) ||
            (ny < height - 1 && !data[nidx + width]);

          if (isBoundary) {
            x = nx;
            y = ny;
            dir = (tryDir + 5) % 8; // Reverse direction
            found = true;
            break;
          }
        }
      }
    }

    if (!found) break;
    maxSteps--;
  } while (maxSteps > 0 && (x !== startX || y !== startY));

  return contour;
}

/**
 * Simplify polygon using Douglas-Peucker algorithm
 */
export function simplifyPolygon(points: Point2D[], tolerance: number): Point2D[] {
  if (points.length <= 2) return points;

  // Find point with maximum distance
  let maxDist = 0;
  let maxIndex = 0;

  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  // If max distance exceeds tolerance, recursively simplify
  if (maxDist > tolerance) {
    const left = simplifyPolygon(points.slice(0, maxIndex + 1), tolerance);
    const right = simplifyPolygon(points.slice(maxIndex), tolerance);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

/**
 * Calculate perpendicular distance from point to line
 */
function perpendicularDistance(point: Point2D, lineStart: Point2D, lineEnd: Point2D): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;

  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    return Math.sqrt(
      Math.pow(point.x - lineStart.x, 2) + Math.pow(point.y - lineStart.y, 2)
    );
  }

  const t = Math.max(0, Math.min(1, (
    (point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy
  ) / lengthSq));

  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;

  return Math.sqrt(Math.pow(point.x - projX, 2) + Math.pow(point.y - projY, 2));
}

/**
 * Smooth polygon using Chaikin's algorithm
 */
export function smoothPolygon(points: Point2D[], iterations: number = 1): Point2D[] {
  if (points.length < 3 || iterations <= 0) return points;

  let result = [...points];

  for (let iter = 0; iter < iterations; iter++) {
    const smoothed: Point2D[] = [];

    for (let i = 0; i < result.length; i++) {
      const p0 = result[i];
      const p1 = result[(i + 1) % result.length];

      // Add two new points at 1/4 and 3/4 along the edge
      smoothed.push({
        x: p0.x * 0.75 + p1.x * 0.25,
        y: p0.y * 0.75 + p1.y * 0.25,
      });
      smoothed.push({
        x: p0.x * 0.25 + p1.x * 0.75,
        y: p0.y * 0.25 + p1.y * 0.75,
      });
    }

    result = smoothed;
  }

  return result;
}

/**
 * Calculate polygon area in pixels
 */
export function calculatePolygonAreaPx(points: Point2D[]): number {
  if (points.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }

  return Math.abs(area / 2);
}

/**
 * Convert area from pixels to mm²
 */
export function areaPixelsToMm2(areaPx: number, pixelSpacing: PixelSpacing | null): number | null {
  if (!pixelSpacing) return null;
  return areaPx * pixelSpacing.rowSpacing * pixelSpacing.columnSpacing;
}

/**
 * Create editable contour from segmentation instance
 */
export function createEditableContour(
  instance: SegmentationInstance,
  segmentationId: string,
  segClass: SegmentationClass,
  pixelSpacing: PixelSpacing | null
): EditableContour {
  // Get polygon points
  let points: Point2D[];

  if (instance.mask.format === 'polygon') {
    points = instance.mask.polygons[0] || [];
  } else if (instance.mask.format === 'rle') {
    const polygons = rleToPolygons(instance.mask);
    points = polygons[0] || [];
  } else {
    const polygons = bitmapToPolygons(instance.mask);
    points = polygons[0] || [];
  }

  // Simplify and smooth for easier editing
  const simplified = simplifyPolygon(points, 2);

  return {
    id: `contour-${instance.id}`,
    segmentationId,
    instanceId: instance.id,
    classId: instance.classId,
    className: instance.className,
    color: segClass.color,
    points: simplified,
    originalPoints: [...points],
    isModified: false,
    isDeleted: false,
    visible: true,
    locked: false,
    areaPx: calculatePolygonAreaPx(simplified),
    areaMm2: areaPixelsToMm2(calculatePolygonAreaPx(simplified), pixelSpacing),
    perimeterMm: null, // Calculate if needed
  };
}
