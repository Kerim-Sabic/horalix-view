/**
 * Measurement Overlay
 *
 * SVG overlay component that renders all visible measurements
 * on top of the DICOM image. Handles:
 * - Rendering different measurement types
 * - Selection/hover state management
 * - Active drawing preview
 * - Click handling for selection
 */

import React, { useCallback, useMemo } from 'react';
import type {
  Measurement,
  ImageDimensions,
} from '../../types';
import {
  isLineMeasurement,
  isPolygonMeasurement,
} from '../../types';
import { LineMeasurementRenderer } from './renderers/LineMeasurementRenderer';
import { PolygonMeasurementRenderer } from './renderers/PolygonMeasurementRenderer';

// ============================================================================
// Types
// ============================================================================

interface MeasurementOverlayProps {
  /** Array of measurements to render */
  measurements: Measurement[];
  /** Currently selected measurement ID */
  selectedId: string | null;
  /** Currently hovered measurement ID */
  hoveredId: string | null;
  /** Active measurement being drawn (preview) */
  activeMeasurement: Measurement | null;
  /** Image dimensions for viewBox */
  imageDimensions: ImageDimensions;
  /** Callback when a measurement is clicked */
  onMeasurementClick?: (id: string, event: React.MouseEvent) => void;
  /** Callback when measurement handle is dragged */
  onHandleMouseDown?: (measurementId: string, pointIndex: number, event: React.MouseEvent) => void;
  /** Callback when hovering over measurement */
  onMeasurementHover?: (id: string | null) => void;
}

// ============================================================================
// Measurement Renderer Dispatch
// ============================================================================

interface MeasurementRendererProps {
  measurement: Measurement;
  isSelected: boolean;
  isHovered: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onHandleMouseDown?: (pointIndex: number, e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const MeasurementRenderer: React.FC<MeasurementRendererProps> = ({
  measurement,
  isSelected,
  isHovered,
  onClick,
  onHandleMouseDown,
  onMouseEnter,
  onMouseLeave,
}) => {
  // Wrap with hover handlers
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.(e);
  };

  const content = useMemo(() => {
    if (isLineMeasurement(measurement)) {
      return (
        <LineMeasurementRenderer
          measurement={measurement}
          isSelected={isSelected}
          isHovered={isHovered}
          showHandles={isSelected || isHovered}
          onClick={handleClick}
          onHandleMouseDown={onHandleMouseDown}
        />
      );
    }

    if (isPolygonMeasurement(measurement)) {
      return (
        <PolygonMeasurementRenderer
          measurement={measurement}
          isSelected={isSelected}
          isHovered={isHovered}
          showHandles={isSelected || isHovered}
          onClick={handleClick}
          onHandleMouseDown={onHandleMouseDown}
        />
      );
    }

    // TODO: Add other measurement type renderers
    return null;
  }, [measurement, isSelected, isHovered, onHandleMouseDown]);

  return (
    <g
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {content}
    </g>
  );
};

// ============================================================================
// Active Drawing Preview
// ============================================================================

interface DrawingPreviewProps {
  measurement: Measurement;
}

const DrawingPreview: React.FC<DrawingPreviewProps> = ({ measurement }) => {
  if (isLineMeasurement(measurement)) {
    return (
      <LineMeasurementRenderer
        measurement={measurement}
        isSelected={true}
        isHovered={false}
        showHandles={true}
      />
    );
  }

  if (isPolygonMeasurement(measurement)) {
    // For polygon, show open path during drawing
    const { points, color } = measurement;
    if (points.length < 2) return null;

    const pathD = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
      .join(' ');

    return (
      <g className="drawing-preview">
        {/* Drawing path */}
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeDasharray="5,5"
          strokeLinejoin="round"
        />

        {/* Vertices */}
        {points.map((point, index) => (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={index === 0 ? 6 : 4}
            fill={index === 0 ? '#10b981' : color}
            stroke="#fff"
            strokeWidth={1}
          />
        ))}

        {/* Close indicator on first point */}
        {points.length >= 3 && (
          <circle
            cx={points[0].x}
            cy={points[0].y}
            r={10}
            fill="none"
            stroke="#10b981"
            strokeWidth={2}
            strokeDasharray="3,3"
          />
        )}
      </g>
    );
  }

  return null;
};

// ============================================================================
// Main Component
// ============================================================================

export const MeasurementOverlay: React.FC<MeasurementOverlayProps> = ({
  measurements,
  selectedId,
  hoveredId,
  activeMeasurement,
  imageDimensions,
  onMeasurementClick,
  onHandleMouseDown,
  onMeasurementHover,
}) => {
  // Sort measurements: selected on top, then hovered, then rest
  const sortedMeasurements = useMemo(() => {
    return [...measurements].sort((a, b) => {
      // Selected measurement always on top
      if (a.id === selectedId) return 1;
      if (b.id === selectedId) return -1;
      // Hovered measurement next
      if (a.id === hoveredId) return 1;
      if (b.id === hoveredId) return -1;
      // Otherwise by creation time
      return a.createdAt - b.createdAt;
    });
  }, [measurements, selectedId, hoveredId]);

  const handleMeasurementClick = useCallback(
    (id: string) => (e: React.MouseEvent) => {
      onMeasurementClick?.(id, e);
    },
    [onMeasurementClick]
  );

  const handleHandleMouseDown = useCallback(
    (measurementId: string) => (pointIndex: number, e: React.MouseEvent) => {
      onHandleMouseDown?.(measurementId, pointIndex, e);
    },
    [onHandleMouseDown]
  );

  const handleMouseEnter = useCallback(
    (id: string) => () => {
      onMeasurementHover?.(id);
    },
    [onMeasurementHover]
  );

  const handleMouseLeave = useCallback(() => {
    onMeasurementHover?.(null);
  }, [onMeasurementHover]);

  return (
    <svg
      className="measurement-overlay"
      viewBox={`0 0 ${imageDimensions.columns} ${imageDimensions.rows}`}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      preserveAspectRatio="none"
    >
      {/* Enable pointer events only for measurement elements */}
      <g style={{ pointerEvents: 'all' }}>
        {/* Render completed measurements */}
        {sortedMeasurements.map((measurement) => (
          <MeasurementRenderer
            key={measurement.id}
            measurement={measurement}
            isSelected={measurement.id === selectedId}
            isHovered={measurement.id === hoveredId}
            onClick={handleMeasurementClick(measurement.id)}
            onHandleMouseDown={handleHandleMouseDown(measurement.id)}
            onMouseEnter={handleMouseEnter(measurement.id)}
            onMouseLeave={handleMouseLeave}
          />
        ))}

        {/* Render active drawing */}
        {activeMeasurement && <DrawingPreview measurement={activeMeasurement} />}
      </g>
    </svg>
  );
};

export default MeasurementOverlay;
