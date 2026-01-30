/**
 * MPR Viewport Component
 *
 * Individual viewport for MPR views (axial, coronal, sagittal)
 * with slice rendering, crosshairs, and user interaction
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Box, Typography, IconButton, Slider } from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import type { MPRPlane } from '../../types/mpr.types';
import { PLANE_CONFIGS } from '../../types/mpr.types';
import { useMPRStore } from '../../hooks/useMPRStore';
import { MPRCrosshair } from './MPRCrosshair';

interface MPRViewportProps {
  plane: MPRPlane;
  imageUrl?: string | null;
  isLoading?: boolean;
}

export const MPRViewport: React.FC<MPRViewportProps> = ({
  plane,
  imageUrl,
  isLoading = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragMode, setDragMode] = useState<'pan' | 'zoom' | 'wwwl' | null>(null);

  // Store state
  const viewState = useMPRStore((state) => state.views[plane]);
  const volumeInfo = useMPRStore((state) => state.volumeInfo);
  const activeView = useMPRStore((state) => state.activeView);
  const setActiveView = useMPRStore((state) => state.setActiveView);
  const setSliceIndex = useMPRStore((state) => state.setSliceIndex);
  const setZoom = useMPRStore((state) => state.setZoom);
  const setPan = useMPRStore((state) => state.setPan);
  const setWindowLevel = useMPRStore((state) => state.setWindowLevel);
  const resetView = useMPRStore((state) => state.resetView);
  const setShowCrosshair = useMPRStore((state) => state.setShowCrosshair);

  const config = PLANE_CONFIGS[plane];
  const isActive = activeView === plane;

  // Measure container size
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, []);

  // Get max slice index
  const getMaxSlice = useCallback(() => {
    if (!volumeInfo) return 0;
    switch (plane) {
      case 'axial':
        return volumeInfo.dimensions[2] - 1;
      case 'coronal':
        return volumeInfo.dimensions[1] - 1;
      case 'sagittal':
        return volumeInfo.dimensions[0] - 1;
    }
  }, [volumeInfo, plane]);

  // Mouse handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setActiveView(plane);
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });

      // Determine drag mode based on button/modifiers
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        setDragMode('pan');
      } else if (e.button === 2 || (e.button === 0 && e.ctrlKey)) {
        setDragMode('zoom');
      } else if (e.button === 0 && e.altKey) {
        setDragMode('wwwl');
      } else {
        setDragMode('pan');
      }
    },
    [plane, setActiveView]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || !dragMode) return;

      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;

      switch (dragMode) {
        case 'pan':
          setPan(plane, {
            x: viewState.pan.x + dx,
            y: viewState.pan.y + dy,
          });
          break;

        case 'zoom':
          const zoomDelta = -dy * 0.01;
          setZoom(plane, viewState.zoom + zoomDelta);
          break;

        case 'wwwl':
          setWindowLevel(plane, {
            center: viewState.windowLevel.center - dy,
            width: viewState.windowLevel.width + dx * 2,
          });
          break;
      }

      setDragStart({ x: e.clientX, y: e.clientY });
    },
    [isDragging, dragMode, dragStart, viewState, plane, setPan, setZoom, setWindowLevel]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragMode(null);
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();

      if (e.ctrlKey) {
        // Zoom with ctrl+wheel
        const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom(plane, viewState.zoom + zoomDelta);
      } else {
        // Scroll through slices
        const sliceDelta = e.deltaY > 0 ? 1 : -1;
        const newIndex = Math.max(0, Math.min(getMaxSlice(), viewState.sliceIndex + sliceDelta));
        setSliceIndex(plane, newIndex);
      }
    },
    [plane, viewState.zoom, viewState.sliceIndex, setZoom, setSliceIndex, getMaxSlice]
  );

  const handleSliderChange = useCallback(
    (_: Event, value: number | number[]) => {
      setSliceIndex(plane, value as number);
    },
    [plane, setSliceIndex]
  );

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        bgcolor: '#000',
        overflow: 'hidden',
        border: 2,
        borderColor: isActive ? config.color : 'grey.800',
        borderRadius: 1,
      }}
      onClick={() => setActiveView(plane)}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Header */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1,
          py: 0.5,
          bgcolor: 'rgba(0,0,0,0.6)',
          zIndex: 20,
        }}
      >
        <Typography
          variant="caption"
          sx={{ color: config.color, fontWeight: 'bold' }}
        >
          {config.label}
        </Typography>

        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              setShowCrosshair(plane, !viewState.showCrosshair);
            }}
            sx={{ color: viewState.showCrosshair ? 'white' : 'grey.500', p: 0.5 }}
          >
            {viewState.showCrosshair ? (
              <VisibilityIcon fontSize="small" />
            ) : (
              <VisibilityOffIcon fontSize="small" />
            )}
          </IconButton>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              resetView(plane);
            }}
            sx={{ color: 'white', p: 0.5 }}
          >
            <RestartAltIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      {/* Image */}
      {imageUrl ? (
        <Box
          component="img"
          src={imageUrl}
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: `translate(-50%, -50%) translate(${viewState.pan.x}px, ${viewState.pan.y}px) scale(${viewState.zoom})`,
            maxWidth: '100%',
            maxHeight: '100%',
            imageRendering: viewState.zoom > 1 ? 'pixelated' : 'auto',
            pointerEvents: 'none',
          }}
          alt={`${config.label} view`}
        />
      ) : (
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: 'grey.500',
            textAlign: 'center',
          }}
        >
          {isLoading ? (
            <Typography>Loading...</Typography>
          ) : (
            <Typography>No image</Typography>
          )}
        </Box>
      )}

      {/* Crosshairs */}
      <MPRCrosshair
        plane={plane}
        width={containerSize.width}
        height={containerSize.height}
      />

      {/* Slice info */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 40,
          left: 8,
          color: 'white',
          fontSize: 12,
          fontFamily: 'monospace',
          textShadow: '0 0 4px black',
          zIndex: 15,
        }}
      >
        <div>Slice: {viewState.sliceIndex + 1}/{getMaxSlice() + 1}</div>
        <div>W: {Math.round(viewState.windowLevel.width)} L: {Math.round(viewState.windowLevel.center)}</div>
        <div>Zoom: {(viewState.zoom * 100).toFixed(0)}%</div>
      </Box>

      {/* Slice slider */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 8,
          left: 8,
          right: 8,
          zIndex: 20,
        }}
      >
        <Slider
          size="small"
          min={0}
          max={getMaxSlice()}
          value={viewState.sliceIndex}
          onChange={handleSliderChange}
          sx={{
            color: config.color,
            '& .MuiSlider-thumb': {
              width: 12,
              height: 12,
            },
          }}
        />
      </Box>
    </Box>
  );
};

export default MPRViewport;
