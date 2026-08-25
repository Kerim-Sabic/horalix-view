/**
 * Clip sheet loading for the active cine.
 *
 * Fetches the whole clip as one tiled image, so scrubbing and playback cost no
 * network at all. Falls back silently to the per-frame path whenever the sheet
 * is unavailable — an unsupported transfer syntax, a single-frame instance, a
 * clip past the size cap — so the viewer degrades rather than breaking.
 */

import { useEffect, useRef, useState } from 'react';

import {
  fetchClipSheet,
  shouldUseClipSheet,
  type ClipSheet,
} from '../infra/dicom/clipSheet';

export interface UseClipSheetParams {
  instanceUid: string | null;
  frameCount: number;
  /** Window centre for grayscale clips; omit for colour. */
  windowCenter?: number;
  windowWidth?: number;
  format?: 'png' | 'jpeg';
  quality?: number;
  /** Set false to stay on the per-frame path. */
  enabled?: boolean;
}

export interface UseClipSheetResult {
  sheet: ClipSheet | null;
  loading: boolean;
  /** True once a fetch has failed for this instance, so callers stop waiting. */
  unavailable: boolean;
}

export function useClipSheet({
  instanceUid,
  frameCount,
  windowCenter,
  windowWidth,
  format = 'jpeg',
  quality = 85,
  enabled = true,
}: UseClipSheetParams): UseClipSheetResult {
  const [sheet, setSheet] = useState<ClipSheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  // Instances whose clip fetch has already failed. Retrying on every render
  // would turn one unsupported clip into a request loop.
  const failedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || !instanceUid || !shouldUseClipSheet(frameCount)) {
      setSheet(null);
      setUnavailable(!enabled ? false : true);
      return undefined;
    }

    if (failedRef.current.has(instanceUid)) {
      setSheet(null);
      setUnavailable(true);
      return undefined;
    }

    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setUnavailable(false);

    fetchClipSheet(
      { instanceUid, format, quality, windowCenter, windowWidth },
      controller.signal
    )
      .then((loaded) => {
        if (!active) return;
        setSheet(loaded);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        failedRef.current.add(instanceUid);
        setSheet(null);
        setUnavailable(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled, instanceUid, frameCount, windowCenter, windowWidth, format, quality]);

  return { sheet, loading, unavailable };
}
