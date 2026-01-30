/**
 * Coordinate Service
 *
 * Provides coordinate transformation between:
 * - Screen coordinates (browser viewport)
 * - Viewport coordinates (relative to viewer container)
 * - Image coordinates (DICOM image pixel space)
 *
 * Handles transformations with zoom, pan, and rotation.
 */

import type {
  Point2D,
  CoordinateTransformContext,
  ImageDimensions,
  ViewportSize,
  ViewportState,
} from '../types';

// ============================================================================
// Rotation Helpers
// ============================================================================

/**
 * Rotate a point around the origin by specified degrees
 */
export function rotatePoint(
  x: number,
  y: number,
  angleDegrees: number
): Point2D {
  // Normalize angle to [0, 360)
  const normalized = ((angleDegrees % 360) + 360) % 360;

  // Fast path for common angles
  switch (normalized) {
    case 0:
      return { x, y };
    case 90:
      return { x: y, y: -x };
    case 180:
      return { x: -x, y: -y };
    case 270:
      return { x: -y, y: x };
    default: {
      const radians = (normalized * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      return {
        x: x * cos - y * sin,
        y: x * sin + y * cos,
      };
    }
  }
}

/**
 * Rotate a point around a specified center point
 */
export function rotatePointAround(
  point: Point2D,
  center: Point2D,
  angleDegrees: number
): Point2D {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const rotated = rotatePoint(dx, dy, angleDegrees);
  return {
    x: rotated.x + center.x,
    y: rotated.y + center.y,
  };
}

// ============================================================================
// Scale Calculations
// ============================================================================

/**
 * Calculate the base scale factor to fit image in viewport (fit-to-screen)
 */
export function calculateBaseScale(
  viewportSize: ViewportSize,
  imageDimensions: ImageDimensions
): number {
  if (!viewportSize.width || !viewportSize.height) return 1;
  if (!imageDimensions.columns || !imageDimensions.rows) return 1;

  return Math.min(
    viewportSize.width / imageDimensions.columns,
    viewportSize.height / imageDimensions.rows
  );
}

/**
 * Calculate effective scale (baseScale * zoom)
 */
export function calculateEffectiveScale(
  baseScale: number,
  zoom: number
): number {
  return baseScale * zoom;
}

// ============================================================================
// Coordinate Transformations
// ============================================================================

/**
 * Transform screen coordinates to image coordinates
 *
 * @param screenX - X coordinate in screen/client space
 * @param screenY - Y coordinate in screen/client space
 * @param context - Transform context with viewport state
 * @returns Point in image coordinates or null if outside bounds
 */
export function screenToImage(
  screenX: number,
  screenY: number,
  context: CoordinateTransformContext
): Point2D | null {
  const { viewportSize, imageDimensions, viewportState, baseScale } = context;
  const { zoom, pan, rotation } = viewportState;

  const scale = baseScale * zoom;
  const centerX = viewportSize.width / 2;
  const centerY = viewportSize.height / 2;

  // Step 1: Remove pan offset and center origin
  const offsetX = screenX - (centerX + pan.x);
  const offsetY = screenY - (centerY + pan.y);

  // Step 2: Remove scale
  const unscaledX = offsetX / scale;
  const unscaledY = offsetY / scale;

  // Step 3: Remove rotation (rotate by negative angle)
  const { x: imageOffsetX, y: imageOffsetY } = rotatePoint(
    unscaledX,
    unscaledY,
    -rotation
  );

  // Step 4: Translate from center to top-left origin
  const imageX = imageOffsetX + imageDimensions.columns / 2;
  const imageY = imageOffsetY + imageDimensions.rows / 2;

  return { x: imageX, y: imageY };
}

/**
 * Transform image coordinates to screen coordinates
 *
 * @param imageX - X coordinate in image pixel space
 * @param imageY - Y coordinate in image pixel space
 * @param context - Transform context with viewport state
 * @returns Point in screen coordinates
 */
export function imageToScreen(
  imageX: number,
  imageY: number,
  context: CoordinateTransformContext
): Point2D {
  const { viewportSize, imageDimensions, viewportState, baseScale } = context;
  const { zoom, pan, rotation } = viewportState;

  const scale = baseScale * zoom;
  const centerX = viewportSize.width / 2;
  const centerY = viewportSize.height / 2;

  // Step 1: Translate from top-left to center origin
  const centeredX = imageX - imageDimensions.columns / 2;
  const centeredY = imageY - imageDimensions.rows / 2;

  // Step 2: Apply rotation
  const { x: rotatedX, y: rotatedY } = rotatePoint(centeredX, centeredY, rotation);

  // Step 3: Apply scale
  const scaledX = rotatedX * scale;
  const scaledY = rotatedY * scale;

  // Step 4: Apply pan and center
  const screenX = scaledX + centerX + pan.x;
  const screenY = scaledY + centerY + pan.y;

  return { x: screenX, y: screenY };
}

/**
 * Transform a screen distance to image distance
 * (Useful for tolerance values that should be constant in screen space)
 */
export function screenDistanceToImage(
  distance: number,
  context: CoordinateTransformContext
): number {
  const scale = context.baseScale * context.viewportState.zoom;
  return distance / scale;
}

/**
 * Transform an image distance to screen distance
 */
export function imageDistanceToScreen(
  distance: number,
  context: CoordinateTransformContext
): number {
  const scale = context.baseScale * context.viewportState.zoom;
  return distance * scale;
}

// ============================================================================
// Bounds Checking
// ============================================================================

/**
 * Check if a point (in image coordinates) is within image bounds
 */
export function isPointInImageBounds(
  point: Point2D,
  imageDimensions: ImageDimensions
): boolean {
  return (
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= imageDimensions.columns &&
    point.y <= imageDimensions.rows
  );
}

/**
 * Check if a screen point is within the image bounds
 */
export function isScreenPointInImage(
  screenX: number,
  screenY: number,
  context: CoordinateTransformContext
): boolean {
  const imagePoint = screenToImage(screenX, screenY, context);
  if (!imagePoint) return false;
  return isPointInImageBounds(imagePoint, context.imageDimensions);
}

/**
 * Clamp a point to image bounds
 */
export function clampPointToImage(
  point: Point2D,
  imageDimensions: ImageDimensions
): Point2D {
  return {
    x: Math.max(0, Math.min(point.x, imageDimensions.columns)),
    y: Math.max(0, Math.min(point.y, imageDimensions.rows)),
  };
}

// ============================================================================
// Pan Bounds
// ============================================================================

/**
 * Calculate maximum pan bounds to prevent image from leaving viewport
 */
export function calculatePanBounds(
  viewportSize: ViewportSize,
  imageDimensions: ImageDimensions,
  scale: number,
  rotation: number
): { maxPanX: number; maxPanY: number } {
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));

  // Calculate rotated bounding box dimensions
  const bboxWidth =
    imageDimensions.columns * scale * cos + imageDimensions.rows * scale * sin;
  const bboxHeight =
    imageDimensions.columns * scale * sin + imageDimensions.rows * scale * cos;

  // Allow panning such that at least half the image is visible
  const maxPanX = Math.max(0, (bboxWidth - viewportSize.width / 2) / 2);
  const maxPanY = Math.max(0, (bboxHeight - viewportSize.height / 2) / 2);

  return { maxPanX, maxPanY };
}

/**
 * Clamp pan values to bounds
 */
export function clampPan(
  pan: { x: number; y: number },
  bounds: { maxPanX: number; maxPanY: number }
): { x: number; y: number } {
  return {
    x: Math.max(-bounds.maxPanX, Math.min(bounds.maxPanX, pan.x)),
    y: Math.max(-bounds.maxPanY, Math.min(bounds.maxPanY, pan.y)),
  };
}

// ============================================================================
// Zoom at Point
// ============================================================================

/**
 * Calculate new pan to zoom centered on a specific screen point
 *
 * This keeps the point under the cursor stationary during zoom.
 */
export function calculateZoomAtPoint(
  screenX: number,
  screenY: number,
  currentZoom: number,
  newZoom: number,
  currentPan: { x: number; y: number },
  viewportSize: ViewportSize,
  imageDimensions: ImageDimensions,
  baseScale: number,
  rotation: number
): { x: number; y: number } {
  const centerX = viewportSize.width / 2;
  const centerY = viewportSize.height / 2;

  // Calculate current image point under cursor
  const currentScale = baseScale * currentZoom;
  const newScale = baseScale * newZoom;

  // Screen offset from center
  const screenOffsetX = screenX - centerX - currentPan.x;
  const screenOffsetY = screenY - centerY - currentPan.y;

  // Image point (in scaled, rotated space)
  const imageOffsetX = screenOffsetX / currentScale;
  const imageOffsetY = screenOffsetY / currentScale;

  // New screen offset to keep same image point under cursor
  const newScreenOffsetX = imageOffsetX * newScale;
  const newScreenOffsetY = imageOffsetY * newScale;

  // Calculate pan adjustment
  const newPan = {
    x: screenX - centerX - newScreenOffsetX,
    y: screenY - centerY - newScreenOffsetY,
  };

  // Clamp to bounds
  const bounds = calculatePanBounds(
    viewportSize,
    imageDimensions,
    newScale,
    rotation
  );

  return clampPan(newPan, bounds);
}

// ============================================================================
// Context Creation
// ============================================================================

/**
 * Create coordinate transform context from viewer state
 */
export function createTransformContext(
  viewportSize: ViewportSize,
  imageDimensions: ImageDimensions,
  viewportState: ViewportState
): CoordinateTransformContext {
  const baseScale = calculateBaseScale(viewportSize, imageDimensions);
  return {
    viewportSize,
    imageDimensions,
    viewportState,
    baseScale,
  };
}

// ============================================================================
// SVG Transform String
// ============================================================================

/**
 * Generate CSS transform string for viewport overlay
 * This applies the same transformations to the SVG overlay as the image
 */
export function getViewportTransform(
  viewportState: ViewportState,
  baseScale: number
): string {
  const { zoom, pan, rotation } = viewportState;
  const scale = baseScale * zoom;

  // Transform order: translate(pan) → rotate → scale → translate(-center)
  // This matches the rendering order in the viewer
  return `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${scale})`;
}

/**
 * Generate SVG viewBox string based on image dimensions
 */
export function getSvgViewBox(imageDimensions: ImageDimensions): string {
  return `0 0 ${imageDimensions.columns} ${imageDimensions.rows}`;
}
