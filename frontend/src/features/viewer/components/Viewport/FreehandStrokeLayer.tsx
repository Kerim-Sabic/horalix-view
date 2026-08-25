import React, { useEffect, useRef } from 'react';

import type { Point2D } from '../../types';

export type { FreehandStrokeState } from './freehandStrokeState';
import type { FreehandStrokeState } from './freehandStrokeState';

export interface FreehandStrokeLayerProps {
  /**
   * Live stroke state, read through a ref rather than props.
   *
   * The stroke is drawn by mutating path attributes inside a
   * requestAnimationFrame loop, so appending a point never re-renders the
   * viewer. Routing each sampled point through React state meant a full
   * re-render of the page for every few pixels of mouse travel.
   */
  strokeRef: React.MutableRefObject<FreehandStrokeState>;
  color?: string;
  spliceColor?: string;
  /** Stroke width in image units; scale with zoom so it stays ~2 screen px. */
  strokeWidth?: number;
}

const toPath = (points: Point2D[]): string => {
  if (points.length < 2) return '';
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
  }
  return d;
};

/**
 * The in-progress freehand stroke.
 *
 * Renders inside the viewer's existing overlay `<svg>`, so it shares the
 * viewBox and needs no coordinate maths of its own.
 */
export const FreehandStrokeLayer: React.FC<FreehandStrokeLayerProps> = ({
  strokeRef,
  color = '#22c55e',
  spliceColor = '#f59e0b',
  strokeWidth = 2,
}) => {
  const pathRef = useRef<SVGPathElement | null>(null);
  const closingRef = useRef<SVGPathElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastVersionRef = useRef(-1);

  useEffect(() => {
    const draw = () => {
      frameRef.current = requestAnimationFrame(draw);

      const stroke = strokeRef.current;
      if (stroke.version === lastVersionRef.current) return;
      lastVersionRef.current = stroke.version;

      const path = pathRef.current;
      const closing = closingRef.current;
      if (!path || !closing) return;

      if (!stroke.active && stroke.points.length === 0) {
        path.setAttribute('d', '');
        closing.setAttribute('d', '');
        return;
      }

      path.setAttribute('d', toPath(stroke.points));
      path.setAttribute('stroke', stroke.splicing ? spliceColor : color);

      // Show where the stroke would close, so the shape being committed is
      // visible rather than guessed at.
      if (!stroke.splicing && stroke.points.length > 2) {
        const first = stroke.points[0];
        const last = stroke.points[stroke.points.length - 1];
        closing.setAttribute(
          'd',
          `M ${last.x.toFixed(2)} ${last.y.toFixed(2)} L ${first.x.toFixed(2)} ${first.y.toFixed(2)}`
        );
        closing.setAttribute('stroke', color);
      } else {
        closing.setAttribute('d', '');
      }
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      lastVersionRef.current = -1;
    };
  }, [strokeRef, color, spliceColor]);

  return (
    <g data-testid="freehand-stroke-layer" pointerEvents="none">
      <path
        ref={closingRef}
        d=""
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={`${strokeWidth * 2} ${strokeWidth * 2}`}
        opacity={0.5}
      />
      <path
        ref={pathRef}
        d=""
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </g>
  );
};

export default FreehandStrokeLayer;
