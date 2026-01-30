/**
 * Coordinate Service Tests
 *
 * Tests for coordinate transformations between screen and image space
 */

import { describe, it, expect } from 'vitest';
import {
  rotatePoint,
  rotatePointAround,
  calculateBaseScale,
  screenToImage,
  imageToScreen,
  screenDistanceToImage,
  imageDistanceToScreen,
  isPointInImageBounds,
  clampPointToImage,
  calculateZoomAtPoint,
} from '../services/coordinateService';
import type { CoordinateTransformContext } from '../types';

// ============================================================================
// Helper to create transform context
// ============================================================================

function createContext(overrides: Partial<CoordinateTransformContext> = {}): CoordinateTransformContext {
  return {
    viewportSize: { width: 800, height: 600 },
    imageDimensions: { rows: 512, columns: 512 },
    viewportState: {
      zoom: 1,
      pan: { x: 0, y: 0 },
      windowLevel: { center: 40, width: 400 },
      rotation: 0,
      sliceIndex: 0,
    },
    baseScale: 600 / 512, // height-constrained
    ...overrides,
  };
}

// ============================================================================
// Rotation Tests
// ============================================================================

describe('rotatePoint', () => {
  it('should not change point at 0 degrees', () => {
    const result = rotatePoint(100, 50, 0);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(50);
  });

  it('should rotate 90 degrees correctly', () => {
    const result = rotatePoint(100, 0, 90);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(-100);
  });

  it('should rotate 180 degrees correctly', () => {
    const result = rotatePoint(100, 50, 180);
    expect(result.x).toBeCloseTo(-100);
    expect(result.y).toBeCloseTo(-50);
  });

  it('should rotate 270 degrees correctly', () => {
    const result = rotatePoint(100, 0, 270);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(100);
  });

  it('should handle 45 degree rotation', () => {
    const result = rotatePoint(100, 0, 45);
    expect(result.x).toBeCloseTo(70.71, 1);
    expect(result.y).toBeCloseTo(70.71, 1);
  });

  it('should normalize negative angles', () => {
    const result = rotatePoint(100, 0, -90);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(100);
  });

  it('should normalize angles > 360', () => {
    const result = rotatePoint(100, 0, 450);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(-100);
  });
});

describe('rotatePointAround', () => {
  it('should rotate around center point', () => {
    const point = { x: 150, y: 100 };
    const center = { x: 100, y: 100 };
    const result = rotatePointAround(point, center, 90);

    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(50);
  });

  it('should not change point at center', () => {
    const point = { x: 100, y: 100 };
    const center = { x: 100, y: 100 };
    const result = rotatePointAround(point, center, 90);

    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(100);
  });
});

// ============================================================================
// Scale Calculation Tests
// ============================================================================

describe('calculateBaseScale', () => {
  it('should calculate scale for width-constrained viewport', () => {
    const scale = calculateBaseScale(
      { width: 400, height: 600 },
      { rows: 512, columns: 512 }
    );
    expect(scale).toBeCloseTo(400 / 512);
  });

  it('should calculate scale for height-constrained viewport', () => {
    const scale = calculateBaseScale(
      { width: 800, height: 400 },
      { rows: 512, columns: 512 }
    );
    expect(scale).toBeCloseTo(400 / 512);
  });

  it('should return 1 for zero viewport size', () => {
    const scale = calculateBaseScale(
      { width: 0, height: 0 },
      { rows: 512, columns: 512 }
    );
    expect(scale).toBe(1);
  });

  it('should return 1 for zero image dimensions', () => {
    const scale = calculateBaseScale(
      { width: 800, height: 600 },
      { rows: 0, columns: 0 }
    );
    expect(scale).toBe(1);
  });
});

// ============================================================================
// Screen to Image Transformation Tests
// ============================================================================

describe('screenToImage', () => {
  it('should transform center point correctly with no transforms', () => {
    const context = createContext();
    const result = screenToImage(400, 300, context);

    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(256);
    expect(result!.y).toBeCloseTo(256);
  });

  it('should account for pan offset', () => {
    const context = createContext({
      viewportState: {
        zoom: 1,
        pan: { x: 100, y: 50 },
        windowLevel: { center: 40, width: 400 },
        rotation: 0,
        sliceIndex: 0,
      },
    });

    const result = screenToImage(400, 300, context);

    expect(result).not.toBeNull();
    // Pan moves image, so screen center maps to different image point
    expect(result!.x).toBeLessThan(256);
    expect(result!.y).toBeLessThan(256);
  });

  it('should account for zoom', () => {
    const context = createContext({
      viewportState: {
        zoom: 2,
        pan: { x: 0, y: 0 },
        windowLevel: { center: 40, width: 400 },
        rotation: 0,
        sliceIndex: 0,
      },
    });

    // At 2x zoom, moving 100 screen pixels = 50 image pixels
    const center = screenToImage(400, 300, context);
    const offset = screenToImage(500, 300, context);

    expect(center).not.toBeNull();
    expect(offset).not.toBeNull();

    const screenDelta = 100;
    const imageDelta = offset!.x - center!.x;
    expect(imageDelta).toBeCloseTo(screenDelta / (context.baseScale * 2));
  });

  it('should handle 90 degree rotation', () => {
    const context = createContext({
      viewportState: {
        zoom: 1,
        pan: { x: 0, y: 0 },
        windowLevel: { center: 40, width: 400 },
        rotation: 90,
        sliceIndex: 0,
      },
    });

    const result = screenToImage(400, 300, context);
    expect(result).not.toBeNull();
  });
});

// ============================================================================
// Image to Screen Transformation Tests
// ============================================================================

describe('imageToScreen', () => {
  it('should transform center point correctly with no transforms', () => {
    const context = createContext();
    const result = imageToScreen(256, 256, context);

    expect(result.x).toBeCloseTo(400);
    expect(result.y).toBeCloseTo(300);
  });

  it('should be inverse of screenToImage', () => {
    const context = createContext({
      viewportState: {
        zoom: 1.5,
        pan: { x: 50, y: -30 },
        windowLevel: { center: 40, width: 400 },
        rotation: 45,
        sliceIndex: 0,
      },
    });

    const screenX = 450;
    const screenY = 320;

    const imagePoint = screenToImage(screenX, screenY, context);
    expect(imagePoint).not.toBeNull();

    const backToScreen = imageToScreen(imagePoint!.x, imagePoint!.y, context);

    expect(backToScreen.x).toBeCloseTo(screenX, 1);
    expect(backToScreen.y).toBeCloseTo(screenY, 1);
  });

  it('should account for pan', () => {
    const context = createContext({
      viewportState: {
        zoom: 1,
        pan: { x: 100, y: 0 },
        windowLevel: { center: 40, width: 400 },
        rotation: 0,
        sliceIndex: 0,
      },
    });

    const result = imageToScreen(256, 256, context);

    // Pan shifts the screen position
    expect(result.x).toBeCloseTo(500);
    expect(result.y).toBeCloseTo(300);
  });
});

// ============================================================================
// Distance Transformation Tests
// ============================================================================

describe('screenDistanceToImage', () => {
  it('should convert screen distance at zoom 1', () => {
    const context = createContext();
    const imageDist = screenDistanceToImage(100, context);

    expect(imageDist).toBeCloseTo(100 / context.baseScale);
  });

  it('should account for zoom', () => {
    const context = createContext({
      viewportState: {
        zoom: 2,
        pan: { x: 0, y: 0 },
        windowLevel: { center: 40, width: 400 },
        rotation: 0,
        sliceIndex: 0,
      },
    });

    const imageDist = screenDistanceToImage(100, context);

    expect(imageDist).toBeCloseTo(100 / (context.baseScale * 2));
  });
});

describe('imageDistanceToScreen', () => {
  it('should convert image distance at zoom 1', () => {
    const context = createContext();
    const screenDist = imageDistanceToScreen(100, context);

    expect(screenDist).toBeCloseTo(100 * context.baseScale);
  });

  it('should be inverse of screenDistanceToImage', () => {
    const context = createContext({
      viewportState: {
        zoom: 1.5,
        pan: { x: 0, y: 0 },
        windowLevel: { center: 40, width: 400 },
        rotation: 0,
        sliceIndex: 0,
      },
    });

    const screenDist = 150;
    const imageDist = screenDistanceToImage(screenDist, context);
    const backToScreen = imageDistanceToScreen(imageDist, context);

    expect(backToScreen).toBeCloseTo(screenDist);
  });
});

// ============================================================================
// Bounds Checking Tests
// ============================================================================

describe('isPointInImageBounds', () => {
  const dimensions = { rows: 512, columns: 512 };

  it('should return true for point inside bounds', () => {
    expect(isPointInImageBounds({ x: 256, y: 256 }, dimensions)).toBe(true);
    expect(isPointInImageBounds({ x: 0, y: 0 }, dimensions)).toBe(true);
    expect(isPointInImageBounds({ x: 512, y: 512 }, dimensions)).toBe(true); // Edge is inclusive
  });

  it('should return false for point outside bounds', () => {
    expect(isPointInImageBounds({ x: -1, y: 256 }, dimensions)).toBe(false);
    expect(isPointInImageBounds({ x: 256, y: -1 }, dimensions)).toBe(false);
    expect(isPointInImageBounds({ x: 513, y: 256 }, dimensions)).toBe(false);
    expect(isPointInImageBounds({ x: 256, y: 513 }, dimensions)).toBe(false);
  });
});

describe('clampPointToImage', () => {
  const dimensions = { rows: 512, columns: 512 };

  it('should not change point inside bounds', () => {
    const point = { x: 256, y: 256 };
    const clamped = clampPointToImage(point, dimensions);

    expect(clamped.x).toBe(256);
    expect(clamped.y).toBe(256);
  });

  it('should clamp point to bounds', () => {
    expect(clampPointToImage({ x: -50, y: 256 }, dimensions)).toEqual({ x: 0, y: 256 });
    expect(clampPointToImage({ x: 600, y: 256 }, dimensions)).toEqual({ x: 512, y: 256 });
    expect(clampPointToImage({ x: 256, y: -50 }, dimensions)).toEqual({ x: 256, y: 0 });
    expect(clampPointToImage({ x: 256, y: 600 }, dimensions)).toEqual({ x: 256, y: 512 });
  });

  it('should clamp corners', () => {
    expect(clampPointToImage({ x: -10, y: -10 }, dimensions)).toEqual({ x: 0, y: 0 });
    expect(clampPointToImage({ x: 600, y: 600 }, dimensions)).toEqual({ x: 512, y: 512 });
  });
});

// ============================================================================
// Zoom at Point Tests
// ============================================================================

describe('calculateZoomAtPoint', () => {
  it('should calculate new pan for zoom at center', () => {
    const context = createContext();
    const { viewportSize, imageDimensions, viewportState, baseScale } = context;
    const cursorX = viewportSize.width / 2;
    const cursorY = viewportSize.height / 2;
    const newZoom = 2;

    const result = calculateZoomAtPoint(
      cursorX, cursorY,
      viewportState.zoom, newZoom,
      viewportState.pan,
      viewportSize,
      imageDimensions,
      baseScale,
      viewportState.rotation
    );

    // Zooming at center should not change pan much
    expect(result.x).toBeCloseTo(0, 1);
    expect(result.y).toBeCloseTo(0, 1);
  });

  it('should adjust pan when zooming at off-center point', () => {
    const context = createContext();
    const { viewportSize, imageDimensions, viewportState, baseScale } = context;
    const cursorX = 500;
    const cursorY = 400;
    const newZoom = 2;

    const result = calculateZoomAtPoint(
      cursorX, cursorY,
      viewportState.zoom, newZoom,
      viewportState.pan,
      viewportSize,
      imageDimensions,
      baseScale,
      viewportState.rotation
    );

    // Pan should adjust to keep cursor position stable
    expect(Math.abs(result.x) + Math.abs(result.y)).toBeGreaterThan(0);
  });
});
