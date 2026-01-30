/**
 * Line Measurement Renderer
 *
 * SVG component for rendering line measurements with:
 * - Line segment
 * - Endpoint handles
 * - Length label
 * - Selection/hover states
 */

import React, { useMemo } from 'react';
import type { LineMeasurement } from '../../../types';
import { MEASUREMENT_COLORS } from '../../../constants';

// ============================================================================
// Types
// ============================================================================

interface LineMeasurementRendererProps {
  measurement: LineMeasurement;
  isSelected: boolean;
  isHovered: boolean;
  showHandles?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onHandleMouseDown?: (pointIndex: number, e: React.MouseEvent) => void;
}

// ============================================================================
// Component
// ============================================================================

export const LineMeasurementRenderer: React.FC<LineMeasurementRendererProps> = ({
  measurement,
  isSelected,
  isHovered,
  showHandles = true,
  onClick,
  onHandleMouseDown,
}) => {
  const { points, lengthMm, color, label, trackingData } = measurement;
  const [start, end] = points;

  // Determine display color based on state
  const displayColor = useMemo(() => {
    if (isSelected) return MEASUREMENT_COLORS.selected;
    if (isHovered) return MEASUREMENT_COLORS.hovered;
    if (trackingData) return MEASUREMENT_COLORS.tracking;
    return color;
  }, [isSelected, isHovered, trackingData, color]);

  const strokeWidth = isSelected ? 3 : 2;
  const handleRadius = isSelected ? 6 : 4;

  // Calculate label position (midpoint, offset above line)
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;

  // Format display value
  const displayValue = useMemo(() => {
    if (lengthMm === null) return 'N/A';
    if (lengthMm < 1) return `${(lengthMm * 1000).toFixed(0)} um`;
    if (lengthMm < 10) return `${lengthMm.toFixed(2)} mm`;
    return `${lengthMm.toFixed(1)} mm`;
  }, [lengthMm]);

  // Tracking summary display
  const trackingSummary = useMemo(() => {
    if (!trackingData?.summary) return null;
    const { minMm, maxMm, meanMm } = trackingData.summary;
    if (minMm === null || maxMm === null || meanMm === null) return null;
    return `Mean: ${meanMm.toFixed(1)} (${minMm.toFixed(1)}-${maxMm.toFixed(1)})`;
  }, [trackingData]);

  const handleStartMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onHandleMouseDown?.(0, e);
  };

  const handleEndMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onHandleMouseDown?.(1, e);
  };

  return (
    <g
      className="measurement-line"
      onClick={onClick}
      style={{ cursor: 'pointer' }}
      data-measurement-id={measurement.id}
    >
      {/* Invisible wider hit area for easier selection */}
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        stroke="transparent"
        strokeWidth={16}
        strokeLinecap="round"
        style={{ pointerEvents: 'stroke' }}
      />

      {/* Main line */}
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        stroke={displayColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        style={{ pointerEvents: 'none' }}
      />

      {/* Dashed line for tracked measurements */}
      {trackingData && (
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke={displayColor}
          strokeWidth={1}
          strokeDasharray="4,4"
          strokeLinecap="round"
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Endpoint handles */}
      {showHandles && (
        <>
          {/* Start handle */}
          <circle
            cx={start.x}
            cy={start.y}
            r={handleRadius}
            fill={displayColor}
            stroke="#fff"
            strokeWidth={1}
            style={{
              cursor: isSelected ? 'move' : 'pointer',
              pointerEvents: isSelected ? 'all' : 'none',
            }}
            onMouseDown={handleStartMouseDown}
          />

          {/* End handle */}
          <circle
            cx={end.x}
            cy={end.y}
            r={handleRadius}
            fill={displayColor}
            stroke="#fff"
            strokeWidth={1}
            style={{
              cursor: isSelected ? 'move' : 'pointer',
              pointerEvents: isSelected ? 'all' : 'none',
            }}
            onMouseDown={handleEndMouseDown}
          />
        </>
      )}

      {/* Selection rings around handles */}
      {isSelected && showHandles && (
        <>
          <circle
            cx={start.x}
            cy={start.y}
            r={handleRadius + 4}
            fill="none"
            stroke={displayColor}
            strokeWidth={1}
            strokeDasharray="3,3"
            style={{ pointerEvents: 'none' }}
          />
          <circle
            cx={end.x}
            cy={end.y}
            r={handleRadius + 4}
            fill="none"
            stroke={displayColor}
            strokeWidth={1}
            strokeDasharray="3,3"
            style={{ pointerEvents: 'none' }}
          />
        </>
      )}

      {/* Label background */}
      <rect
        x={midX - 30}
        y={midY - 22}
        width={60}
        height={16}
        rx={3}
        fill="rgba(0, 0, 0, 0.7)"
        style={{ pointerEvents: 'none' }}
      />

      {/* Length label */}
      <text
        x={midX}
        y={midY - 10}
        fill="#fff"
        fontSize={11}
        fontFamily="monospace"
        fontWeight={isSelected ? 'bold' : 'normal'}
        textAnchor="middle"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {displayValue}
      </text>

      {/* Custom label (if set) */}
      {label && (
        <>
          <rect
            x={midX - 40}
            y={midY - 38}
            width={80}
            height={14}
            rx={2}
            fill="rgba(0, 0, 0, 0.5)"
            style={{ pointerEvents: 'none' }}
          />
          <text
            x={midX}
            y={midY - 28}
            fill="#fff"
            fontSize={10}
            textAnchor="middle"
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            {label}
          </text>
        </>
      )}

      {/* Tracking summary (if tracked) */}
      {trackingSummary && (
        <>
          <rect
            x={midX - 50}
            y={midY + 4}
            width={100}
            height={14}
            rx={2}
            fill="rgba(245, 158, 11, 0.8)"
            style={{ pointerEvents: 'none' }}
          />
          <text
            x={midX}
            y={midY + 14}
            fill="#000"
            fontSize={9}
            fontFamily="monospace"
            textAnchor="middle"
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            {trackingSummary}
          </text>
        </>
      )}
    </g>
  );
};

export default LineMeasurementRenderer;
