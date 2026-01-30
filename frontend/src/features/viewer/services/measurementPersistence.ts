/**
 * Measurement Persistence Service
 *
 * Handles saving and loading measurements from:
 * - localStorage (primary, immediate)
 * - Backend API (future DICOM SR support)
 */

import type { Measurement, TrackingData } from '../types';

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY_PREFIX = 'horalix-measurements-';
const STORAGE_VERSION = 1;

// ============================================================================
// Types
// ============================================================================

interface StoredMeasurements {
  version: number;
  measurements: Measurement[];
  trackingData: Record<string, TrackingData>;
  lastModified: number;
}

interface ExportOptions {
  includeTrackingData?: boolean;
  format?: 'json' | 'csv';
}

// ============================================================================
// localStorage Operations
// ============================================================================

/**
 * Get storage key for a series
 */
function getStorageKey(seriesUid: string): string {
  return `${STORAGE_KEY_PREFIX}${seriesUid}`;
}

/**
 * Save measurements to localStorage
 */
export function saveMeasurementsToStorage(
  seriesUid: string,
  measurements: Measurement[],
  trackingData: Map<string, TrackingData> = new Map()
): void {
  const key = getStorageKey(seriesUid);
  const data: StoredMeasurements = {
    version: STORAGE_VERSION,
    measurements,
    trackingData: Object.fromEntries(trackingData),
    lastModified: Date.now(),
  };

  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to save measurements to localStorage:', error);

    // Handle quota exceeded
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      // Try to clean up old data
      cleanupOldMeasurements();
      // Retry
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch {
        console.error('Failed to save measurements after cleanup');
      }
    }
  }
}

/**
 * Load measurements from localStorage
 */
export function loadMeasurementsFromStorage(seriesUid: string): {
  measurements: Measurement[];
  trackingData: Map<string, TrackingData>;
} {
  const key = getStorageKey(seriesUid);

  try {
    const stored = localStorage.getItem(key);
    if (!stored) {
      return { measurements: [], trackingData: new Map() };
    }

    const data: StoredMeasurements = JSON.parse(stored);

    // Version migration if needed
    if (data.version !== STORAGE_VERSION) {
      return migrateMeasurements(data);
    }

    return {
      measurements: data.measurements,
      trackingData: new Map(Object.entries(data.trackingData || {})),
    };
  } catch (error) {
    console.error('Failed to load measurements from localStorage:', error);
    return { measurements: [], trackingData: new Map() };
  }
}

/**
 * Clear measurements from localStorage
 */
export function clearMeasurementsFromStorage(seriesUid: string): void {
  const key = getStorageKey(seriesUid);
  localStorage.removeItem(key);
}

/**
 * List all series with stored measurements
 */
export function listStoredSeries(): string[] {
  const seriesUids: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_KEY_PREFIX)) {
      seriesUids.push(key.slice(STORAGE_KEY_PREFIX.length));
    }
  }

  return seriesUids;
}

/**
 * Get storage usage info
 */
export function getStorageInfo(): {
  totalKeys: number;
  totalSize: number;
  measurementKeys: number;
} {
  let totalSize = 0;
  let measurementKeys = 0;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      const value = localStorage.getItem(key) || '';
      totalSize += key.length + value.length;

      if (key.startsWith(STORAGE_KEY_PREFIX)) {
        measurementKeys++;
      }
    }
  }

  return {
    totalKeys: localStorage.length,
    totalSize,
    measurementKeys,
  };
}

/**
 * Clean up old measurement data to free storage space
 */
function cleanupOldMeasurements(): void {
  const entries: Array<{ key: string; lastModified: number }> = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_KEY_PREFIX)) {
      try {
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        entries.push({ key, lastModified: data.lastModified || 0 });
      } catch {
        // Invalid data, mark for removal
        entries.push({ key, lastModified: 0 });
      }
    }
  }

  // Sort by lastModified ascending (oldest first)
  entries.sort((a, b) => a.lastModified - b.lastModified);

  // Remove oldest 25%
  const removeCount = Math.ceil(entries.length * 0.25);
  for (let i = 0; i < removeCount; i++) {
    localStorage.removeItem(entries[i].key);
  }
}

/**
 * Migrate measurements from older storage versions
 */
function migrateMeasurements(data: StoredMeasurements): {
  measurements: Measurement[];
  trackingData: Map<string, TrackingData>;
} {
  // Currently only version 1, add migration logic as needed
  console.warn('Unknown measurement storage version:', data.version);
  return {
    measurements: data.measurements || [],
    trackingData: new Map(Object.entries(data.trackingData || {})),
  };
}

// ============================================================================
// Export Functions
// ============================================================================

/**
 * Export measurements as JSON string
 */
export function exportMeasurementsAsJson(
  measurements: Measurement[],
  options: ExportOptions = {}
): string {
  const { includeTrackingData = true } = options;

  const exportData = measurements.map((m) => {
    if (!includeTrackingData && 'trackingData' in m) {
      const { trackingData, ...rest } = m as Measurement & { trackingData?: unknown };
      return rest;
    }
    return m;
  });

  return JSON.stringify(exportData, null, 2);
}

/**
 * Export measurements as CSV
 */
export function exportMeasurementsAsCsv(measurements: Measurement[]): string {
  const headers = [
    'ID',
    'Type',
    'Scope',
    'Label',
    'Value',
    'Unit',
    'Created',
    'Series UID',
    'Frame Key',
  ];

  const rows = measurements.map((m) => {
    let value = '';
    let unit = '';

    switch (m.type) {
      case 'line':
        value = m.lengthMm?.toFixed(2) || '';
        unit = 'mm';
        break;
      case 'polygon':
        value = m.areaMm2?.toFixed(2) || '';
        unit = 'mm^2';
        break;
      case 'polyline':
        value = m.totalLengthMm?.toFixed(2) || '';
        unit = 'mm';
        break;
      case 'ellipse':
      case 'rectangle':
        value = m.areaMm2?.toFixed(2) || '';
        unit = 'mm^2';
        break;
    }

    return [
      m.id,
      m.type,
      m.scope,
      m.label || '',
      value,
      unit,
      new Date(m.createdAt).toISOString(),
      m.seriesUid,
      m.frameKey || '',
    ]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Export measurements as downloadable file
 */
export function downloadMeasurements(
  measurements: Measurement[],
  filename: string,
  format: 'json' | 'csv' = 'json'
): void {
  const content =
    format === 'json'
      ? exportMeasurementsAsJson(measurements)
      : exportMeasurementsAsCsv(measurements);

  const mimeType = format === 'json' ? 'application/json' : 'text/csv';
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.${format}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

// ============================================================================
// Import Functions
// ============================================================================

/**
 * Import measurements from JSON string
 */
export function importMeasurementsFromJson(json: string): Measurement[] {
  try {
    const parsed = JSON.parse(json);

    if (!Array.isArray(parsed)) {
      throw new Error('Invalid measurements format: expected array');
    }

    // Validate and regenerate IDs to avoid conflicts
    return parsed.map((m) => ({
      ...m,
      id: crypto.randomUUID(),
      createdAt: m.createdAt || Date.now(),
      modifiedAt: Date.now(),
    }));
  } catch (error) {
    console.error('Failed to import measurements:', error);
    throw new Error('Invalid measurements file format');
  }
}

/**
 * Import measurements from file
 */
export async function importMeasurementsFromFile(file: File): Promise<Measurement[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const measurements = importMeasurementsFromJson(content);
        resolve(measurements);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };

    reader.readAsText(file);
  });
}

// ============================================================================
// Backend Sync (Future Implementation)
// ============================================================================

/**
 * Sync measurements to backend (DICOM SR)
 * Currently a placeholder for future implementation
 */
export async function syncMeasurementsToBackend(
  studyUid: string,
  seriesUid: string,
  measurements: Measurement[]
): Promise<void> {
  // TODO: Implement DICOM SR creation
  console.log('Backend sync not yet implemented', {
    studyUid,
    seriesUid,
    measurementCount: measurements.length,
  });
}

/**
 * Load measurements from backend (DICOM SR)
 * Currently a placeholder for future implementation
 */
export async function loadMeasurementsFromBackend(
  studyUid: string,
  seriesUid: string
): Promise<Measurement[]> {
  // TODO: Implement DICOM SR loading
  console.log('Backend load not yet implemented', { studyUid, seriesUid });
  return [];
}
