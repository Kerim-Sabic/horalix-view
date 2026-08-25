/**
 * Clip sheets
 *
 * A multi-frame cine served as one tiled image. Fetching it costs a single
 * request and a single decode, after which scrubbing and playback happen
 * entirely in the client -- where the per-frame route cost one round trip per
 * displayed frame, each one decoding the whole clip server-side to slice out
 * one frame.
 *
 * The grid geometry arrives in response headers rather than a JSON envelope so
 * the body stays a plain image the browser decodes natively.
 */

export interface ClipSheet {
  /** The decoded sheet, ready to draw sub-rectangles from. */
  image: HTMLImageElement;
  /** Frames present in the sheet. */
  frameCount: number;
  /** Frames in the source instance, before any cap. */
  sourceFrameCount: number;
  gridColumns: number;
  frameWidth: number;
  frameHeight: number;
  /** Tile size relative to the source frame; 1.0 means full resolution. */
  frameScale: number;
}

export interface ClipSheetRequest {
  instanceUid: string;
  format?: 'png' | 'jpeg';
  quality?: number;
  windowCenter?: number;
  windowWidth?: number;
  maxFrames?: number;
}

/** Source rectangle of one frame within the sheet. */
export interface FrameRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export const frameRect = (sheet: ClipSheet, frameIndex: number): FrameRect | null => {
  if (frameIndex < 0 || frameIndex >= sheet.frameCount) return null;
  return {
    sx: (frameIndex % sheet.gridColumns) * sheet.frameWidth,
    sy: Math.floor(frameIndex / sheet.gridColumns) * sheet.frameHeight,
    sw: sheet.frameWidth,
    sh: sheet.frameHeight,
  };
};

const buildUrl = (request: ClipSheetRequest): string => {
  const params = new URLSearchParams();
  params.set('format', request.format ?? 'jpeg');
  if (request.quality !== undefined) params.set('quality', String(request.quality));
  if (request.windowCenter !== undefined) {
    params.set('window_center', String(request.windowCenter));
  }
  if (request.windowWidth !== undefined) {
    params.set('window_width', String(request.windowWidth));
  }
  if (request.maxFrames !== undefined) params.set('max_frames', String(request.maxFrames));
  return `/api/v1/instances/${request.instanceUid}/clip?${params.toString()}`;
};

const header = (headers: Headers, name: string, fallback: number): number => {
  const raw = headers.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

/**
 * Fetch and decode a clip sheet.
 *
 * The request goes through `fetch` rather than an `<img>` src because the grid
 * geometry lives in the response headers; the blob is then decoded into an
 * image for drawing. Credentials are included so the media session cookie
 * authenticates the request.
 *
 * Rejects when the instance is single-frame (the per-frame route serves those)
 * or the fetch fails, so callers can fall back to per-frame rendering.
 */
export async function fetchClipSheet(
  request: ClipSheetRequest,
  signal?: AbortSignal
): Promise<ClipSheet> {
  const response = await fetch(buildUrl(request), {
    credentials: 'include',
    signal,
  });

  if (!response.ok) {
    throw new Error(`Clip request failed: ${response.status}`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.decoding = 'async';
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Clip sheet failed to decode'));
      element.src = objectUrl;
    });

    // Decode fully before the object URL is revoked, so the first draw does not
    // race the decode.
    if (typeof image.decode === 'function') {
      await image.decode().catch(() => undefined);
    }

    const { headers } = response;
    return {
      image,
      frameCount: header(headers, 'X-Frame-Count', 1),
      sourceFrameCount: header(headers, 'X-Source-Frames', 1),
      gridColumns: header(headers, 'X-Grid-Columns', 1),
      frameWidth: header(headers, 'X-Frame-Width', image.naturalWidth),
      frameHeight: header(headers, 'X-Frame-Height', image.naturalHeight),
      frameScale: header(headers, 'X-Frame-Scale', 1),
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Draw one frame of a sheet onto a canvas, filling it.
 *
 * Returns false when the frame index is out of range, so the caller can leave
 * the previous frame on screen rather than blanking the viewport.
 */
export function drawClipFrame(
  canvas: HTMLCanvasElement,
  sheet: ClipSheet,
  frameIndex: number
): boolean {
  const rect = frameRect(sheet, frameIndex);
  if (!rect) return false;

  const context = canvas.getContext('2d');
  if (!context) return false;

  if (canvas.width !== rect.sw || canvas.height !== rect.sh) {
    canvas.width = rect.sw;
    canvas.height = rect.sh;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    sheet.image,
    rect.sx,
    rect.sy,
    rect.sw,
    rect.sh,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return true;
}

/**
 * Whether a clip sheet is worth fetching for this instance.
 *
 * Single-frame instances have nothing to tile. Very long clips are left to the
 * per-frame path, where the prefetcher can prioritise the frames in view rather
 * than blocking on one large sheet.
 */
export function shouldUseClipSheet(frameCount: number, maxFrames = 240): boolean {
  return frameCount > 1 && frameCount <= maxFrames;
}
