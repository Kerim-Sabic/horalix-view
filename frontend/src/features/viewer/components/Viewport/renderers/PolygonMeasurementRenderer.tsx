/**
 * Polygon Measurement Renderer
 *
 * SVG component for rendering polygon measurements with:
 * - Filled polygon shape
 * - Vertex handles
 * - Area label
 * - Selection/hover states
 */

import React, { useMemo } from 'react';
import type { PolygonMeasurement, Point2D } from '../../../types';
import { MEASUREMENT_COLORS } from '../../../constants';
import { centroid } from '../../../services/geometryService';

// ============================================================================
// Types
// ============================================================================

interface PolygonMeasurementRendererProps {
  measurement: PolygonMeasurement;
  isSelected: boolean;
  isHovered: boolean;
  showHandles?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onHandleMouseDown?: (pointIndex: number, e: React.MouseEvent) => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

function pointsToPath(points: Point2D[], closed: boolean = true): string {
  if (points.length === 0) return '';

  const pathParts = points.map((p, i) => {
    const command = i === 0 ? 'M' : 'L';
    return `${command} ${p.x} ${p.y}`;
  });

  if (closed && points.length > 2) {
    pathParts.push('Z');
  }

  return pathParts.join(' ');
}

function formatArea(areaMm2: number | null): string {
  if (areaMm2 === null) return 'N/A';
  if (areaMm2 < 1) return `${(areaMm2 * 1000000).toFixed(0)} um^2`;
  if (areaMm2 < 100) return `${areaMm2.toFixed(2)} mm^2`;
  if (areaMm2 < 10000) return `${areaMm2.toFixed(1)} mm^2`;
  return `${(areaMm2 / 100).toFixed(1)} cm^2`;
}

// ============================================================================
// Component
// ============================================================================

export const PolygonMeasurementRenderer: React.FC<PolygonMeasurementRendererProps> = ({
  measurement,
  isSelected,
  isHovered,
  showHandles = true,
  onClick,
  onHandleMouseDown,
}) => {
  const { points, areaMm2, perimeterMm, color, label, trackingData } = measurement;

  // Determine display color based on state
  const displayColor = useMemo(() => {
    if (isSelected) return MEASUREMENT_COLORS.selected;
    if (isHovered) return MEASUREMENT_COLORS.hovered;
    if (trackingData) return MEASUREMENT_COLORS.tracking;
    return color;
  }, [isSelected, isHovered, trackingData, color]);

  const strokeWidth = isSelected ? 3 : 2;
  const handleRadius = isSelected ? 5 : 3;
  const fillOpacity = isSelected ? 0.3 : isHovered ? 0.2 : 0.15;

  // Calculate centroid for label placement
  const center = useMemo(() => centroid(points), [points]);

  // Generate SVG path
  const pathD = useMemo(() => pointsToPath(points, true), [points]);

  // Format display values
  const areaDisplay = useMemo(() => formatArea(areaMm2), [areaMm2]);

  const perimeterDisplay = useMemo(() => {
    if (perimeterMm === null) return null;
    if (perimeterMm < 10) return `${perimeterMm.toFixed(2)} mm`;
    return `${perimeterMm.toFixed(1)} mm`;
  }, [perimeterMm]);

  // Tracking summary
  const trackingSummary = useMemo(() => {
    if (!trackingData?.summary) return null;
    const { meanAreaMm2 } = trackingData.summary;
    if (meanAreaMm2 === undefined) return null;
    return `Mean: ${formatArea(meanAreaMm2 ?? null)}`;
  }, [trackingData]);

  // Handle vertex mousedown
  const createHandleMouseDown = (index: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onHandleMouseDown?.(index, e);
  };

  if (points.length < 2) return null;

  return (
    <g
      className="measurement-polygon"
      onClick={onClick}
      style={{ cursor: 'pointer' }}
      data-measurement-id={measurement.id}
    >
      {/* Invisible wider hit area for edges */}
      <path
        d={pathD}
        fill="transparent"
        stroke="transparent"
        strokeWidth={16}
        style={{ pointerEvents: 'stroke' }}
      />

      {/* Filled polygon */}
      <path
        d={pathD}
        fill={displayColor}
        fillOpacity={fillOpacity}
        stroke={displayColor}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        style={{ pointerEvents: 'fill' }}
      />

      {/* Vertex handles */}
      {showHandles &&
        points.map((point, index) => (
          <g key={index}>
            {/* Handle */}
            <circle
              cx={point.x}
              cy={point.y}
              r={handleRadius}
              fill={displayColor}
              stroke="#fff"
              strokeWidth={1}
              style={{
                cursor: isSelected ? 'move' : 'pointer',
                pointerEvents: isSelected ? 'all' : 'none',
              }}
              onMouseDown={createHandleMouseDown(index)}
            />

            {/* Selection ring */}
            {isSelected && (
              <circle
                cx={point.x}
                cy={point.y}
                r={handleRadius + 3}
                fill="none"
                stroke={displayColor}
                strokeWidth={1}
                strokeDasharray="2,2"
                style={{ pointerEvents: 'none' }}
              />
            )}

            {/* Vertex number (shown when selected) */}
            {isSelected && points.length > 3 && (
              <text
                x={point.x}
                y={point.y - 10}
                fill={displayColor}
                fontSize={8}
                textAnchor="middle"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {index + 1}
              </text>
            )}
          </g>
        ))}

      {/* Center label background */}
      <rect
        x={center.x - 35}
        y={center.y - 10}
        width={70}
        height={20}
        rx={4}
        fill="rgba(0, 0, 0, 0.75)"
        style={{ pointerEvents: 'none' }}
      />

      {/* Area label */}
      <text
        x={center.x}
        y={center.y + 4}
        fill="#fff"
        fontSize={11}
        fontFamily="monospace"
        fontWeight={isSelected ? 'bold' : 'normal'}
        textAnchor="middle"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {areaDisplay}
      </text>

      {/* Custom label (if set) */}
      {label && (
        <>
          <rect
            x={center.x - 40}
            y={center.y - 28}
            width={80}
            height={14}
            rx={2}
            fill="rgba(0, 0, 0, 0.5)"
            style={{ pointerEvents: 'none' }}
          />
          <text
            x={center.x}
            y={center.y - 18}
            fill="#fff"
            fontSize={10}
            textAnchor="middle"
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            {label}
          </text>
        </>
      )}

      {/* Perimeter (shown below area when selected) */}
      {isSelected && perimeterDisplay && (
        <>
          <rect
            x={center.x - 30}
            y={center.y + 12}
            width={60}
            height={12}
            rx={2}
            fill="rgba(0, 0, 0, 0.5)"
            style={{ pointerEvents: 'none' }}
          />
          <text
            x={center.x}
            y={center.y + 22}
            fill="#ccc"
            fontSize={9}
            fontFamily="monospace"
            textAnchor="middle"
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            P: {perimeterDisplay}
          </text>
        </>
      )}

      {/* Tracking summary */}
      {trackingSummary && (
        <>
          <rect
            x={center.x - 40}
            y={center.y + 26}
            width={80}
            height={14}
            rx={2}
            fill="rgba(245, 158, 11, 0.8)"
            style={{ pointerEvents: 'none' }}
          />
          <text
            x={center.x}
            y={center.y + 36}
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

export default PolygonMeasurementRenderer;
