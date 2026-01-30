/**
 * MPR Crosshair Component
 *
 * Renders crosshair lines for MPR views with drag interaction
 */

import React, { useCallback, useRef, useState } from 'react';
import { Box } from '@mui/material';
import type { MPRPlane, CrosshairLine, VolumeIndex } from '../../types/mpr.types';
import { getCrosshairLinesForView, PLANE_CONFIGS } from '../../types/mpr.types';
import { useMPRStore } from '../../hooks/useMPRStore';

interface MPRCrosshairProps {
  plane: MPRPlane;
  width: number;
  height: number;
}

export const MPRCrosshair: React.FC<MPRCrosshairProps> = ({
  plane,
  width,
  height,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<CrosshairLine | null>(null);

  const crosshairPosition = useMPRStore((state) => state.crosshairPosition);
  const volumeInfo = useMPRStore((state) => state.volumeInfo);
  const showCrosshairs = useMPRStore((state) => state.showCrosshairs);
  const showCrosshair = useMPRStore((state) => state.views[plane].showCrosshair);
  const setCrosshairPosition = useMPRStore((state) => state.setCrosshairPosition);

  // Don't render if crosshairs are hidden
  if (!showCrosshairs || !showCrosshair || !volumeInfo) {
    return null;
  }

  const lines = getCrosshairLinesForView(plane, crosshairPosition, volumeInfo.dimensions);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, line: CrosshairLine) => {
      e.stopPropagation();
      setDragging(line);
    },
    []
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging || !containerRef.current || !volumeInfo) return;

      const rect = containerRef.current.getBoundingClientRect();
      let newPosition: VolumeIndex = { ...crosshairPosition };

      if (dragging.orientation === 'horizontal') {
        // Moving horizontal line changes the axis perpendicular to view
        const y = Math.max(0, Math.min(height, e.clientY - rect.top));
        const percentage = y / height;

        // Update appropriate coordinate based on source plane
        if (plane === 'axial' && dragging.sourcePlane === 'coronal') {
          newPosition.j = Math.round(percentage * (volumeInfo.dimensions[1] - 1));
        } else if (plane === 'coronal' && dragging.sourcePlane === 'axial') {
          newPosition.k = Math.round(percentage * (volumeInfo.dimensions[2] - 1));
        } else if (plane === 'sagittal' && dragging.sourcePlane === 'axial') {
          newPosition.k = Math.round(percentage * (volumeInfo.dimensions[2] - 1));
        }
      } else {
        // Moving vertical line
        const x = Math.max(0, Math.min(width, e.clientX - rect.left));
        const percentage = x / width;

        // Update appropriate coordinate
        if (plane === 'axial' && dragging.sourcePlane === 'sagittal') {
          newPosition.i = Math.round(percentage * (volumeInfo.dimensions[0] - 1));
        } else if (plane === 'coronal' && dragging.sourcePlane === 'sagittal') {
          newPosition.i = Math.round(percentage * (volumeInfo.dimensions[0] - 1));
        } else if (plane === 'sagittal' && dragging.sourcePlane === 'coronal') {
          newPosition.j = Math.round(percentage * (volumeInfo.dimensions[1] - 1));
        }
      }

      setCrosshairPosition(newPosition);
    },
    [dragging, crosshairPosition, volumeInfo, plane, width, height, setCrosshairPosition]
  );

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setDragging(null);
  }, []);

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: dragging ? 'auto' : 'none',
        zIndex: 10,
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        {lines.map((line) => {
          const isHorizontal = line.orientation === 'horizontal';
          const position = (line.position / 100) * (isHorizontal ? height : width);

          return (
            <g key={`${line.sourcePlane}-${line.orientation}`}>
              {/* Main line */}
              <line
                x1={isHorizontal ? 0 : position}
                y1={isHorizontal ? position : 0}
                x2={isHorizontal ? width : position}
                y2={isHorizontal ? position : height}
                stroke={line.color}
                strokeWidth={1}
                strokeDasharray="4,4"
                style={{ pointerEvents: 'none' }}
              />

              {/* Draggable hit area */}
              <line
                x1={isHorizontal ? 0 : position}
                y1={isHorizontal ? position : 0}
                x2={isHorizontal ? width : position}
                y2={isHorizontal ? position : height}
                stroke="transparent"
                strokeWidth={10}
                style={{
                  cursor: isHorizontal ? 'ns-resize' : 'ew-resize',
                  pointerEvents: 'stroke',
                }}
                onMouseDown={(e) => handleMouseDown(e, line)}
              />

              {/* Label */}
              <text
                x={isHorizontal ? 5 : position + 5}
                y={isHorizontal ? position - 5 : 15}
                fill={line.color}
                fontSize="10"
                fontFamily="monospace"
                style={{ pointerEvents: 'none' }}
              >
                {PLANE_CONFIGS[line.sourcePlane].label.charAt(0)}
              </text>
            </g>
          );
        })}
      </svg>
    </Box>
  );
};

export default MPRCrosshair;
