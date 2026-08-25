import { describe, expect, it } from 'vitest';

import { frameRect, shouldUseClipSheet } from '../infra/dicom/clipSheet';
import type { ClipSheet } from '../infra/dicom/clipSheet';

/** A 3-column sheet of 7 frames, each 100x80 -- the endpoint's own layout. */
const sheet = (overrides: Partial<ClipSheet> = {}): ClipSheet => ({
  image: {} as HTMLImageElement,
  frameCount: 7,
  sourceFrameCount: 7,
  gridColumns: 3,
  frameWidth: 100,
  frameHeight: 80,
  frameScale: 1,
  ...overrides,
});

describe('frameRect', () => {
  it('places the first frame at the origin', () => {
    expect(frameRect(sheet(), 0)).toEqual({ sx: 0, sy: 0, sw: 100, sh: 80 });
  });

  it('walks left to right along a row', () => {
    expect(frameRect(sheet(), 1)).toEqual({ sx: 100, sy: 0, sw: 100, sh: 80 });
    expect(frameRect(sheet(), 2)).toEqual({ sx: 200, sy: 0, sw: 100, sh: 80 });
  });

  it('wraps to the next row', () => {
    expect(frameRect(sheet(), 3)).toEqual({ sx: 0, sy: 80, sw: 100, sh: 80 });
    expect(frameRect(sheet(), 4)).toEqual({ sx: 100, sy: 80, sw: 100, sh: 80 });
  });

  it('handles a partial final row', () => {
    expect(frameRect(sheet(), 6)).toEqual({ sx: 0, sy: 160, sw: 100, sh: 80 });
  });

  it('rejects an index past the end', () => {
    expect(frameRect(sheet(), 7)).toBeNull();
    expect(frameRect(sheet(), 99)).toBeNull();
  });

  it('rejects a negative index', () => {
    expect(frameRect(sheet(), -1)).toBeNull();
  });

  it('never overlaps two frames', () => {
    const s = sheet();
    const rects = Array.from({ length: s.frameCount }, (_, i) => frameRect(s, i)!);
    const seen = new Set(rects.map((r) => `${r.sx},${r.sy}`));
    expect(seen.size).toBe(s.frameCount);
  });

  it('keeps every frame inside the grid the headers describe', () => {
    const s = sheet();
    const rows = Math.ceil(s.frameCount / s.gridColumns);
    const sheetWidth = s.gridColumns * s.frameWidth;
    const sheetHeight = rows * s.frameHeight;
    for (let i = 0; i < s.frameCount; i += 1) {
      const rect = frameRect(s, i)!;
      expect(rect.sx + rect.sw).toBeLessThanOrEqual(sheetWidth);
      expect(rect.sy + rect.sh).toBeLessThanOrEqual(sheetHeight);
    }
  });

  it('handles a single-column sheet', () => {
    const s = sheet({ gridColumns: 1, frameCount: 3 });
    expect(frameRect(s, 2)).toEqual({ sx: 0, sy: 160, sw: 100, sh: 80 });
  });
});

describe('shouldUseClipSheet', () => {
  it('accepts a normal cine', () => {
    expect(shouldUseClipSheet(60)).toBe(true);
  });

  it('rejects a single-frame instance', () => {
    expect(shouldUseClipSheet(1)).toBe(false);
    expect(shouldUseClipSheet(0)).toBe(false);
  });

  it('rejects a clip longer than the cap', () => {
    // Past the cap the per-frame path prioritises frames in view instead of
    // blocking on one large sheet.
    expect(shouldUseClipSheet(500)).toBe(false);
  });

  it('accepts exactly the cap', () => {
    expect(shouldUseClipSheet(240)).toBe(true);
  });

  it('honours a custom cap', () => {
    expect(shouldUseClipSheet(50, 40)).toBe(false);
    expect(shouldUseClipSheet(30, 40)).toBe(true);
  });
});
