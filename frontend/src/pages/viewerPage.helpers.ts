/**
 * ViewerPage Helper Functions
 *
 * Extracted from ViewerPage.tsx to reduce monolith size.
 * Contains pure utility functions used by the viewer page.
 */

import type { VolumeInfo } from '../services/api';
import type { VolumeInfo as MprVolumeInfo } from '../features/viewer/types';
import type { ApiError, PathologyResults } from './viewerPage.types';

// ============================================================================
// Instance / Frame Helpers
// ============================================================================

/**
 * Extract SOP Instance UID from a frame key string (format: "instanceUid:frameIndex")
 */
export const resolveInstanceUidFromFrameKey = (frameKey?: string | null): string | null => {
  if (!frameKey) return null;
  const parts = frameKey.split(':');
  if (!parts.length) return null;
  return parts[0] || null;
};

// ============================================================================
// Copilot Template Helpers
// ============================================================================

/**
 * Determine which copilot measurement template to use based on modality and description.
 */
export const getCopilotTemplateKey = (modality: string | undefined, description: string): string => {
  const normalized = `${modality ?? ''} ${description}`.toLowerCase();
  if (
    normalized.includes('echo') ||
    normalized.includes('echocardiogram') ||
    normalized.includes('cardiac') ||
    modality === 'US'
  ) {
    return 'echo';
  }
  if (modality === 'CT') return 'ct';
  if (modality === 'MR') return 'mr';
  return 'general';
};

// ============================================================================
// API Error Helpers
// ============================================================================

/**
 * Extract a detail message from an API error response.
 */
export const getApiErrorDetail = (err: unknown): string | null => {
  if (!err || typeof err !== 'object') return null;
  const detail = (err as ApiError).response?.data?.detail;
  return typeof detail === 'string' ? detail : null;
};

/**
 * Extract tile count from pathology results.
 */
export const getPathologyTileCount = (results: unknown): number | null => {
  if (!results || typeof results !== 'object') return null;
  const output = (results as PathologyResults).output;
  if (!output || typeof output !== 'object') return null;
  const tileCount = output.tile_count;
  if (typeof tileCount === 'number' && Number.isFinite(tileCount)) {
    return tileCount;
  }
  if (typeof tileCount === 'string') {
    const parsed = Number(tileCount);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

// ============================================================================
// Geometry / Orientation Helpers
// ============================================================================

/**
 * Rotate a point by a given angle (handles 90-degree increments efficiently).
 */
export const rotatePoint = (x: number, y: number, angle: number): { x: number; y: number } => {
  const normalized = ((angle % 360) + 360) % 360;
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
};

/**
 * Get anatomical axis label from a direction vector.
 */
export const getAxisLabel = (vector: [number, number, number]): string => {
  const abs = vector.map((v) => Math.abs(v));
  const maxIndex = abs.indexOf(Math.max(...abs));
  const value = vector[maxIndex];
  if (maxIndex === 0) return value >= 0 ? 'L' : 'R';
  if (maxIndex === 1) return value >= 0 ? 'P' : 'A';
  return value >= 0 ? 'H' : 'F';
};

/**
 * Compute DICOM orientation markers (left/right/top/bottom labels)
 * from image orientation patient cosines.
 */
export const getOrientationMarkers = (
  orientation?: number[] | null
): { left: string; right: string; top: string; bottom: string } | null => {
  if (!orientation || orientation.length !== 6) return null;
  const row: [number, number, number] = [orientation[0], orientation[1], orientation[2]];
  const col: [number, number, number] = [orientation[3], orientation[4], orientation[5]];
  return {
    left: getAxisLabel([-row[0], -row[1], -row[2]]),
    right: getAxisLabel(row),
    top: getAxisLabel([-col[0], -col[1], -col[2]]),
    bottom: getAxisLabel(col),
  };
};

/**
 * Build a 3x3 orientation matrix from DICOM image orientation cosines.
 */
export const buildOrientationMatrix = (orientation?: number[] | null): number[][] => {
  if (!orientation || orientation.length < 6) {
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  }

  const row = orientation.slice(0, 3);
  const col = orientation.slice(3, 6);
  const normal = [
    row[1] * col[2] - row[2] * col[1],
    row[2] * col[0] - row[0] * col[2],
    row[0] * col[1] - row[1] * col[0],
  ];

  return [row, col, normal];
};

/**
 * Convert API VolumeInfo to MPR-compatible VolumeInfo.
 */
export const buildMprVolumeInfo = (
  info: VolumeInfo,
  windowLevel: { center: number; width: number }
): MprVolumeInfo => ({
  dimensions: [info.dimensions.x, info.dimensions.y, info.dimensions.z],
  spacing: [info.spacing.x, info.spacing.y, info.spacing.z],
  origin: info.origin,
  orientation: buildOrientationMatrix(info.orientation),
  modality: info.modality,
  seriesUid: info.series_uid,
  pixelRange: {
    min: windowLevel.center - windowLevel.width / 2,
    max: windowLevel.center + windowLevel.width / 2,
  },
});
