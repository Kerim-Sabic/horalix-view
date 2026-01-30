/**
 * Measurement List Item
 *
 * Displays a single measurement in the panel with:
 * - Type icon
 * - Label/value
 * - Action buttons (select, delete, track)
 * - Visual indicator for tracked measurements
 * - Expandable tracking graph
 */

import React, { useState, useCallback } from 'react';
import {
  Box,
  Collapse,
  IconButton,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Edit as EditIcon,
  ExpandLess as CollapseIcon,
  ExpandMore as ExpandIcon,
  Pentagon as PolygonIcon,
  Straighten as LineIcon,
  Timeline as TrackingIcon,
  Visibility as VisibleIcon,
  VisibilityOff as HiddenIcon,
} from '@mui/icons-material';

import type { Measurement, TrackingData } from '../../types';
import { isLineMeasurement, isPolygonMeasurement } from '../../types';

// =========================================================
// Types
// =========================================================

interface MeasurementListItemProps {
  measurement: Measurement;
  isSelected: boolean;
  trackingData?: TrackingData | null;
  currentFrameIndex?: number;
  onJumpToFrame?: (frameIndex: number) => void;
  onSelect: () => void;
  onDelete: () => void;
  onToggleVisibility: () => void;
  onEditLabel?: () => void;
  onTrack?: () => void;
}

// =========================================================
// Helper Functions
// =========================================================

function getMeasurementIcon(measurement: Measurement): React.ReactNode {
  if (isLineMeasurement(measurement)) {
    return <LineIcon fontSize="small" />;
  }
  if (isPolygonMeasurement(measurement)) {
    return <PolygonIcon fontSize="small" />;
  }
  return <LineIcon fontSize="small" />;
}

function getMeasurementValue(measurement: Measurement): string {
  if (isLineMeasurement(measurement)) {
    if (measurement.lengthMm === null) return 'N/A';
    if (measurement.lengthMm < 1) return `${(measurement.lengthMm * 1000).toFixed(0)} um`;
    if (measurement.lengthMm < 10) return `${measurement.lengthMm.toFixed(2)} mm`;
    return `${measurement.lengthMm.toFixed(1)} mm`;
  }

  if (isPolygonMeasurement(measurement)) {
    const area = measurement.areaMm2;
    if (area === null) return 'N/A';
    if (area < 1) return `${(area * 1000000).toFixed(0)} um^2`;
    if (area < 100) return `${area.toFixed(2)} mm^2`;
    if (area < 10000) return `${area.toFixed(1)} mm^2`;
    return `${(area / 100).toFixed(1)} cm^2`;
  }

  return 'N/A';
}

function getMeasurementTypeLabel(measurement: Measurement): string {
  if (isLineMeasurement(measurement)) return 'Line';
  if (isPolygonMeasurement(measurement)) return 'Polygon';
  return 'Measurement';
}

// =========================================================
// Component
// =========================================================

// Professional SVG line chart for tracking data with cardiac markers
const TrackingGraph: React.FC<{
  data: TrackingData;
  unit: string;
  currentFrameIndex?: number;
  onFrameSelect?: (frameIndex: number) => void;
}> = ({ data, unit, currentFrameIndex, onFrameSelect }) => {
  const [isScrubbing, setIsScrubbing] = useState(false);
  const sortedFrames = [...data.frames].sort((a, b) => a.frameIndex - b.frameIndex);
  const values = sortedFrames.map((frame) => frame.lengthMm ?? frame.areaMm2 ?? 0);
  if (values.length === 0) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  // Find ED (max) and ES (min) frames for cardiac measurements
  const maxIdx = values.indexOf(max);
  const minIdx = values.indexOf(min);
  const minFrame = sortedFrames[0]?.frameIndex ?? 0;
  const maxFrame = sortedFrames[sortedFrames.length - 1]?.frameIndex ?? minFrame;
  const frameRange = maxFrame - minFrame || 1;
  const clampValue = (value: number, minValue: number, maxValue: number) =>
    Math.min(maxValue, Math.max(minValue, value));
  const canScrub = Boolean(onFrameSelect);
  const currentIndex =
    typeof currentFrameIndex === 'number'
      ? clampValue(currentFrameIndex, minFrame, maxFrame)
      : null;

  const width = 260;
  const height = 100;
  const paddingLeft = 40;
  const paddingRight = 12;
  const paddingTop = 12;
  const paddingBottom = 24;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  // Generate smooth path with area fill
  const pathPoints = values.map((value, index) => {
    const frameIndex = sortedFrames[index]?.frameIndex ?? minFrame;
    const x = paddingLeft + ((frameIndex - minFrame) / frameRange) * chartWidth;
    const y = paddingTop + chartHeight - ((value - min) / range) * chartHeight;
    return { x, y, value, frameIndex };
  });

  const buildSmoothPath = (points: typeof pathPoints) => {
    if (points.length < 3) {
      return points
        .map((point, index) =>
          `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)},${point.y.toFixed(1)}`
        )
        .join(' ');
    }

    const segments: string[] = [
      `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`,
    ];
    for (let i = 0; i < points.length - 1; i += 1) {
      const p0 = points[i - 1] ?? points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] ?? p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      segments.push(
        `C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
      );
    }
    return segments.join(' ');
  };

  const linePath = buildSmoothPath(pathPoints);
  const areaPath = `${linePath} L ${pathPoints[pathPoints.length - 1].x.toFixed(1)},${
    paddingTop + chartHeight
  } L ${paddingLeft},${paddingTop + chartHeight} Z`;

  // Calculate change percentage
  const changePercent = max > 0 ? ((max - min) / max * 100).toFixed(1) : '0';
  const summaryMean = data.summary.meanMm ?? data.summary.meanAreaMm2;
  const currentX =
    currentIndex !== null
      ? paddingLeft + ((currentIndex - minFrame) / frameRange) * chartWidth
      : null;
  const currentPoint =
    currentIndex !== null
      ? pathPoints.reduce((closest, point) => {
        if (!closest) return point;
        const currentDistance = Math.abs(point.frameIndex - currentIndex);
        const bestDistance = Math.abs(closest.frameIndex - currentIndex);
        return currentDistance < bestDistance ? point : closest;
      }, null as (typeof pathPoints[number] | null))
      : null;

  const handlePointerAt = useCallback(
    (event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) => {
      if (!onFrameSelect) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const scaleX = rect.width ? width / rect.width : 1;
      const x = clampValue((event.clientX - rect.left) * scaleX, paddingLeft, width - paddingRight);
      const ratio = chartWidth === 0 ? 0 : (x - paddingLeft) / chartWidth;
      const frameIndex = Math.round(minFrame + ratio * frameRange);
      onFrameSelect(frameIndex);
    },
    [chartWidth, frameRange, minFrame, onFrameSelect, paddingLeft, paddingRight, width]
  );

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!canScrub) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsScrubbing(true);
    handlePointerAt(event);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!canScrub || !isScrubbing) return;
    handlePointerAt(event);
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!canScrub) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setIsScrubbing(false);
  };

  return (
    <Box
      sx={{
        p: 1.5,
        bgcolor: 'background.paper',
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      {/* Header with title and change */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="caption" fontWeight="bold" color="text.secondary">
          Cine Tracking ({data.totalFrames} frames)
        </Typography>
        <Typography
          variant="caption"
          sx={{
            color: 'success.main',
            bgcolor: 'rgba(16, 185, 129, 0.1)',
            px: 0.75,
            py: 0.25,
            borderRadius: 1,
            fontWeight: 500,
          }}
        >
          Delta {changePercent}%
        </Typography>
      </Box>

      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', cursor: canScrub ? 'ew-resize' : 'default' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={canScrub ? handlePointerAt : undefined}
        onPointerLeave={() => setIsScrubbing(false)}
      >
        <defs>
          {/* Gradient fill for area */}
          <linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05" />
          </linearGradient>
          {/* Glow filter for line */}
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Horizontal grid lines */}
        {[0, 0.5, 1].map((ratio, index) => (
          <g key={index}>
            <line
              x1={paddingLeft}
              y1={paddingTop + chartHeight * (1 - ratio)}
              x2={width - paddingRight}
              y2={paddingTop + chartHeight * (1 - ratio)}
              stroke="#e5e7eb"
              strokeWidth={1}
              strokeDasharray={ratio === 0 ? 'none' : '2,2'}
            />
            <text
              x={paddingLeft - 4}
              y={paddingTop + chartHeight * (1 - ratio) + 4}
              textAnchor="end"
              fontSize="9"
              fill="#9ca3af"
            >
              {(min + range * ratio).toFixed(0)}
            </text>
          </g>
        ))}

        {/* Area fill */}
        <path d={areaPath} fill="url(#areaGradient)" />

        {/* Main line */}
        <path
          d={linePath}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#glow)"
        />

        {/* Data points */}
        {pathPoints.map((point) => (
          <circle
            key={`pt-${point.frameIndex}`}
            cx={point.x}
            cy={point.y}
            r={2.2}
            fill="#60a5fa"
            opacity={0.75}
            style={{ cursor: canScrub ? 'pointer' : 'default' }}
            onClick={canScrub ? () => onFrameSelect?.(point.frameIndex) : undefined}
          />
        ))}

        {/* Current frame indicator */}
        {currentX !== null && (
          <line
            x1={currentX}
            y1={paddingTop}
            x2={currentX}
            y2={paddingTop + chartHeight}
            stroke="#f59e0b"
            strokeWidth={1.5}
            strokeDasharray="4,3"
            opacity={0.9}
          />
        )}
        {currentPoint && (
          <g>
            <circle
              cx={currentPoint.x}
              cy={currentPoint.y}
              r={4}
              fill="#f59e0b"
              stroke="#fff"
              strokeWidth={1.5}
            />
            <text
              x={currentPoint.x}
              y={currentPoint.y - 8}
              textAnchor="middle"
              fontSize="9"
              fill="#f59e0b"
              fontWeight="bold"
            >
              {currentPoint.value.toFixed(1)}
            </text>
          </g>
        )}

        {/* ED marker (max value - end diastole) */}
        <g
          style={{ cursor: canScrub ? 'pointer' : 'default' }}
          onClick={canScrub ? () => onFrameSelect?.(pathPoints[maxIdx]?.frameIndex ?? maxFrame) : undefined}
        >
          <circle
            cx={pathPoints[maxIdx].x}
            cy={pathPoints[maxIdx].y}
            r={5}
            fill="#10b981"
            stroke="white"
            strokeWidth={2}
          />
          <text
            x={pathPoints[maxIdx].x}
            y={pathPoints[maxIdx].y - 10}
            textAnchor="middle"
            fontSize="9"
            fontWeight="bold"
            fill="#10b981"
          >
            ED
          </text>
        </g>

        {/* ES marker (min value - end systole) */}
        <g
          style={{ cursor: canScrub ? 'pointer' : 'default' }}
          onClick={canScrub ? () => onFrameSelect?.(pathPoints[minIdx]?.frameIndex ?? minFrame) : undefined}
        >
          <circle
            cx={pathPoints[minIdx].x}
            cy={pathPoints[minIdx].y}
            r={5}
            fill="#ef4444"
            stroke="white"
            strokeWidth={2}
          />
          <text
            x={pathPoints[minIdx].x}
            y={pathPoints[minIdx].y + 16}
            textAnchor="middle"
            fontSize="9"
            fontWeight="bold"
            fill="#ef4444"
          >
            ES
          </text>
        </g>

        {/* X-axis label */}
        <text
          x={width / 2}
          y={height - 4}
          textAnchor="middle"
          fontSize="9"
          fill="#9ca3af"
        >
          Frame
        </text>
      </svg>

      {/* Stats row */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          mt: 1,
          pt: 1,
          borderTop: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="caption" color="success.main" fontWeight="bold" display="block">
            {max.toFixed(1)}
          </Typography>
          <Typography variant="caption" color="text.secondary" fontSize="10px">
            ED ({unit})
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="caption" color="error.main" fontWeight="bold" display="block">
            {min.toFixed(1)}
          </Typography>
          <Typography variant="caption" color="text.secondary" fontSize="10px">
            ES ({unit})
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="caption" color="primary.main" fontWeight="bold" display="block">
            {summaryMean !== null && summaryMean !== undefined
              ? summaryMean.toFixed(1)
              : (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)}
          </Typography>
          <Typography variant="caption" color="text.secondary" fontSize="10px">
            Mean ({unit})
          </Typography>
        </Box>
      </Box>
    </Box>
  );
};


export const MeasurementListItem: React.FC<MeasurementListItemProps> = ({
  measurement,
  isSelected,
  trackingData,
  currentFrameIndex,
  onJumpToFrame,
  onSelect,
  onDelete,
  onToggleVisibility,
  onEditLabel,
  onTrack,
}) => {
  const [expanded, setExpanded] = useState(false);

  // Check if tracking data is available
  const hasTracking = trackingData && trackingData.frames.length > 0;
  const displayLabel = measurement.label || getMeasurementTypeLabel(measurement);
  const displayValue = getMeasurementValue(measurement);
  const unit = isLineMeasurement(measurement) ? 'mm' : 'mm^2';

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  };

  const handleToggleVisibility = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleVisibility();
  };

  const handleEditLabel = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEditLabel?.();
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  const handleTrack = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTrack?.();
  };

  return (
    <>
      <ListItem
        disablePadding
        secondaryAction={
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {hasTracking && (
              <Tooltip title={expanded ? 'Hide graph' : 'Show graph'}>
                <IconButton size="small" onClick={handleToggleExpand}>
                  {expanded ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            )}
            {!hasTracking && onTrack && (
              <Tooltip title="Track across frames">
                <IconButton size="small" onClick={handleTrack}>
                  <TrackingIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {onEditLabel && (
              <Tooltip title="Edit label">
                <IconButton size="small" onClick={handleEditLabel}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={measurement.visible ? 'Hide' : 'Show'}>
              <IconButton size="small" onClick={handleToggleVisibility}>
                {measurement.visible ? (
                  <VisibleIcon fontSize="small" />
                ) : (
                  <HiddenIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton size="small" onClick={handleDelete} disabled={measurement.locked}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        }
      >
        <ListItemButton
          selected={isSelected}
          onClick={onSelect}
          sx={{
            borderLeft: isSelected ? 3 : 0,
            borderColor: 'primary.main',
            opacity: measurement.visible ? 1 : 0.5,
          }}
        >
          <ListItemIcon sx={{ minWidth: 36 }}>
            {getMeasurementIcon(measurement)}
          </ListItemIcon>
          <ListItemText
            primary={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" noWrap>
                  {displayLabel}
                </Typography>
                {hasTracking && (
                  <Tooltip title="Has tracking data">
                    <TrackingIcon
                      fontSize="small"
                      sx={{ color: 'success.main', fontSize: 14 }}
                    />
                  </Tooltip>
                )}
              </Box>
            }
            secondary={
              <Typography
                variant="caption"
                color="text.secondary"
                component="span"
                sx={{ fontFamily: 'monospace' }}
              >
                {displayValue}
              </Typography>
            }
          />
        </ListItemButton>
      </ListItem>

      {/* Expandable tracking graph */}
      <Collapse in={expanded && !!hasTracking}>
        <Box sx={{ pl: 2, pr: 1, pb: 1 }}>
          {hasTracking && trackingData && (
            <TrackingGraph
              data={trackingData}
              unit={unit}
              currentFrameIndex={currentFrameIndex}
              onFrameSelect={onJumpToFrame}
            />
          )}
        </Box>
      </Collapse>
    </>
  );
};

export default MeasurementListItem;
