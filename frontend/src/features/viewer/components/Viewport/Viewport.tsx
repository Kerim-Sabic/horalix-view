/**
 * Viewport Component
 *
 * Main image display area for the DICOM viewer:
 * - Renders the DICOM image with transforms (zoom, pan, rotation)
 * - Displays measurement overlay
 * - Shows AI segmentation/detection overlays
 * - Handles viewport interactions via hook
 * - Displays orientation markers and info overlays
 */

import React, { useRef, useMemo } from 'react';
import { Alert, Box, Typography } from '@mui/material';

import { MeasurementOverlay } from './MeasurementOverlay';
import { useViewportInteraction } from '../../hooks/useViewportInteraction';
import type {
  ViewerTool,
  ViewportState,
  Measurement,
  ImageDimensions,
  Point2D,
  OrientationMarkers,
} from '../../types';

// ============================================================================
// Types
// ============================================================================

interface AIOverlay {
  id: string;
  url: string;
}

interface DetectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

interface ViewportProps {
  // Image state
  imageUrl: string | null;
  imageDimensions: ImageDimensions;
  imageError: string | null;

  // Viewport state
  viewportState: ViewportState;
  activeTool: ViewerTool;

  // Measurements
  measurements: Measurement[];
  activeMeasurement: Measurement | null;
  selectedMeasurementId: string | null;
  hoveredMeasurementId: string | null;

  // AI overlays
  showAiOverlay: boolean;
  segmentationOverlays: AIOverlay[];
  detectionOverlays: DetectionBox[];

  // Orientation
  orientationMarkers: OrientationMarkers | null;

  // Slice info
  currentSlice: number;
  totalSlices: number;
  sliceThickness: number | null;

  // Callbacks - Viewport
  onPanChange: (pan: Point2D) => void;
  onZoomChange: (zoom: number, center?: Point2D) => void;
  onWindowLevelChange: (wl: { center: number; width: number }) => void;
  onSliceChange: (slice: number) => void;
  onRotate: () => void;
  onResetView: () => void;

  // Callbacks - Measurements
  onMeasurementStart?: (point: Point2D, tool: ViewerTool) => void;
  onMeasurementMove?: (point: Point2D) => void;
  onMeasurementEnd?: (point: Point2D) => void;
  onMeasurementClick?: (point: Point2D, tool: ViewerTool) => void;
  onMeasurementSelect?: (id: string, event: React.MouseEvent) => void;
  onMeasurementHover?: (id: string | null) => void;
  onHandleMouseDown?: (measurementId: string, pointIndex: number, event: React.MouseEvent) => void;

  // Callbacks - Selection
  onSelectionClick?: (point: Point2D) => void;
}

// ============================================================================
// Component
// ============================================================================

export const Viewport: React.FC<ViewportProps> = ({
  imageUrl,
  imageDimensions,
  imageError,
  viewportState,
  activeTool,
  measurements,
  activeMeasurement,
  selectedMeasurementId,
  hoveredMeasurementId,
  showAiOverlay,
  segmentationOverlays,
  detectionOverlays,
  orientationMarkers,
  currentSlice,
  totalSlices,
  sliceThickness,
  onPanChange,
  onZoomChange,
  onWindowLevelChange,
  onSliceChange,
  onRotate,
  onResetView,
  onMeasurementStart,
  onMeasurementMove,
  onMeasurementEnd,
  onMeasurementClick,
  onMeasurementSelect,
  onMeasurementHover,
  onHandleMouseDown,
  onSelectionClick,
}) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);

  const { zoom, pan, rotation, windowLevel } = viewportState;

  // Calculate effective scale for display
  const scale = useMemo(() => {
    if (!viewportRef.current) return zoom;
    const rect = viewportRef.current.getBoundingClientRect();
    const baseScale = Math.min(
      rect.width / imageDimensions.columns,
      rect.height / imageDimensions.rows
    );
    return baseScale * zoom;
  }, [zoom, imageDimensions]);

  // Get viewport size for interaction calculations
  const viewportSize = useMemo(() => {
    if (!viewportRef.current) return { width: 800, height: 600 };
    const rect = viewportRef.current.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }, []);

  // Viewport interaction hook
  const {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    handleDoubleClick,
    handleContextMenu,
    cursor,
  } = useViewportInteraction(
    {
      activeTool,
      viewportState,
      imageDimensions,
      viewportSize,
      totalSlices,
      currentSlice,
    },
    {
      onPanChange,
      onZoomChange,
      onWindowLevelChange,
      onSliceChange,
      onRotate,
      onMeasurementStart,
      onMeasurementMove,
      onMeasurementEnd,
      onMeasurementClick,
      onSelectionClick,
    }
  );

  const hasImage = imageUrl !== null;

  return (
    <Box
      ref={viewportRef}
      sx={{
        flex: 1,
        position: 'relative',
        bgcolor: '#000',
        cursor,
        userSelect: 'none',
        touchAction: 'none',
        overflow: 'hidden',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onDoubleClick={(e) => {
        handleDoubleClick(e);
        if (activeTool !== 'polygon') {
          onResetView();
        }
      }}
      onContextMenu={handleContextMenu}
    >
      {hasImage ? (
        <Box sx={{ position: 'absolute', inset: 0 }}>
          {/* Image container with transforms */}
          <Box
            sx={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: imageDimensions.columns,
              height: imageDimensions.rows,
              transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${scale}) translate(-50%, -50%)`,
              transformOrigin: 'center',
              willChange: 'transform',
            }}
          >
            {/* Main image */}
            <img
              src={imageUrl}
              alt={`Slice ${currentSlice + 1}`}
              style={{
                width: '100%',
                height: '100%',
                display: 'block',
                userSelect: 'none',
                pointerEvents: 'none',
              }}
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
            />

            {/* SVG overlay for AI and measurements */}
            <svg
              ref={overlayRef}
              width="100%"
              height="100%"
              viewBox={`0 0 ${imageDimensions.columns} ${imageDimensions.rows}`}
              style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
            >
              {/* AI Segmentation overlays */}
              {showAiOverlay &&
                segmentationOverlays.map((overlay) => (
                  <image
                    key={overlay.id}
                    href={overlay.url}
                    x={0}
                    y={0}
                    width={imageDimensions.columns}
                    height={imageDimensions.rows}
                    opacity={0.6}
                  />
                ))}

              {/* AI Detection boxes */}
              {showAiOverlay &&
                detectionOverlays.map((box, idx) => (
                  <g key={`det-${idx}`}>
                    <rect
                      x={box.x}
                      y={box.y}
                      width={box.width}
                      height={box.height}
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth={2}
                    />
                    <text
                      x={box.x}
                      y={Math.max(12, box.y - 4)}
                      fill="#f59e0b"
                      fontSize={12}
                      fontFamily="monospace"
                    >
                      {box.label}
                    </text>
                  </g>
                ))}
            </svg>

            {/* Measurement overlay */}
            <MeasurementOverlay
              measurements={measurements}
              selectedId={selectedMeasurementId}
              hoveredId={hoveredMeasurementId}
              activeMeasurement={activeMeasurement}
              imageDimensions={imageDimensions}
              onMeasurementClick={onMeasurementSelect}
              onHandleMouseDown={onHandleMouseDown}
              onMeasurementHover={onMeasurementHover}
            />
          </Box>
        </Box>
      ) : (
        <Box
          sx={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'grey.500',
          }}
        >
          <Typography>Select a series to view</Typography>
        </Box>
      )}

      {/* Error overlay */}
      {imageError && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'rgba(0, 0, 0, 0.7)',
          }}
        >
          <Alert severity="error">{imageError}</Alert>
        </Box>
      )}

      {/* Window/Level info overlay (top right) */}
      <Box
        sx={{
          position: 'absolute',
          top: 16,
          right: 16,
          color: '#fff',
          fontFamily: 'monospace',
          fontSize: '12px',
          textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
          textAlign: 'right',
        }}
      >
        <div>W: {Math.round(windowLevel.width)} L: {Math.round(windowLevel.center)}</div>
        <div>Zoom: {(zoom * 100).toFixed(0)}%</div>
      </Box>

      {/* Slice info overlay (bottom left) */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 16,
          left: 16,
          color: '#fff',
          fontFamily: 'monospace',
          fontSize: '12px',
          textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
        }}
      >
        <div>
          Image: {currentSlice + 1} / {totalSlices}
        </div>
        {sliceThickness && <div>Slice Thickness: {sliceThickness} mm</div>}
      </Box>

      {/* Orientation markers */}
      {orientationMarkers && (
        <>
          <Box
            sx={{
              position: 'absolute',
              top: 10,
              left: '50%',
              transform: 'translateX(-50%)',
              color: '#fff',
              fontFamily: 'monospace',
              textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
            }}
          >
            {orientationMarkers.top}
          </Box>
          <Box
            sx={{
              position: 'absolute',
              bottom: 10,
              left: '50%',
              transform: 'translateX(-50%)',
              color: '#fff',
              fontFamily: 'monospace',
              textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
            }}
          >
            {orientationMarkers.bottom}
          </Box>
          <Box
            sx={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#fff',
              fontFamily: 'monospace',
              textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
            }}
          >
            {orientationMarkers.left}
          </Box>
          <Box
            sx={{
              position: 'absolute',
              right: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#fff',
              fontFamily: 'monospace',
              textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
            }}
          >
            {orientationMarkers.right}
          </Box>
        </>
      )}
    </Box>
  );
};

export default Viewport;
