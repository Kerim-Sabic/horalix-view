import type { Point2D } from '../../types';

/** Live state of a freehand stroke in progress. */
export interface FreehandStrokeState {
  /** Points sampled so far, in image coordinates. */
  points: Point2D[];
  /** True while the pointer is down. */
  active: boolean;
  /** Bumped on every mutation so the draw loop can skip idle frames. */
  version: number;
  /** True when the stroke will splice into an existing contour on release. */
  splicing: boolean;
}

export const createStrokeState = (): FreehandStrokeState => ({
  points: [],
  active: false,
  version: 0,
  splicing: false,
});
