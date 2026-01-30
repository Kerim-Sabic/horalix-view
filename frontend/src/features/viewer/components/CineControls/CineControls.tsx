/**
 * Cine Controls
 *
 * Bottom bar component for controlling cine playback:
 * - Play/pause toggle
 * - FPS control
 * - Slice slider
 * - Current position indicator
 * - Status chips (modality, zoom, dimensions)
 */

import React, { useCallback } from 'react';
import {
  Box,
  Chip,
  IconButton,
  Paper,
  Slider,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Pause as PauseIcon,
  PlayArrow as PlayIcon,
  SkipNext as NextIcon,
  SkipPrevious as PrevIcon,
} from '@mui/icons-material';

import { MIN_CINE_FPS, MAX_CINE_FPS } from '../../constants';

// ============================================================================
// Types
// ============================================================================

interface CineControlsProps {
  // Playback state
  isPlaying: boolean;
  fps: number;
  currentSlice: number;
  totalSlices: number;

  // Display info
  modality: string | null;
  zoom: number;
  imageWidth: number;
  imageHeight: number;

  // Callbacks
  onPlayPause: () => void;
  onFpsChange: (fps: number) => void;
  onSliceChange: (slice: number) => void;
  onNextSlice?: () => void;
  onPrevSlice?: () => void;
}

// ============================================================================
// Component
// ============================================================================

export const CineControls: React.FC<CineControlsProps> = ({
  isPlaying,
  fps,
  currentSlice,
  totalSlices,
  modality,
  zoom,
  imageWidth,
  imageHeight,
  onPlayPause,
  onFpsChange,
  onSliceChange,
  onNextSlice,
  onPrevSlice,
}) => {
  const hasMultipleSlices = totalSlices > 1;

  const handleSliderChange = useCallback((_: Event, value: number | number[]) => {
    onSliceChange(value as number);
  }, [onSliceChange]);

  const handleFpsChange = useCallback((_: Event, value: number | number[]) => {
    onFpsChange(value as number);
  }, [onFpsChange]);

  const handlePrevSlice = useCallback(() => {
    if (onPrevSlice) {
      onPrevSlice();
    } else {
      onSliceChange(Math.max(0, currentSlice - 1));
    }
  }, [onPrevSlice, onSliceChange, currentSlice]);

  const handleNextSlice = useCallback(() => {
    if (onNextSlice) {
      onNextSlice();
    } else {
      onSliceChange(Math.min(totalSlices - 1, currentSlice + 1));
    }
  }, [onNextSlice, onSliceChange, currentSlice, totalSlices]);

  return (
    <Paper
      sx={{
        display: 'flex',
        alignItems: 'center',
        px: 2,
        py: 1,
        borderRadius: 0,
      }}
      elevation={0}
    >
      {/* Playback controls */}
      <Box sx={{ display: 'flex', alignItems: 'center', mr: 2 }}>
        <Tooltip title="Previous slice">
          <span>
            <IconButton
              onClick={handlePrevSlice}
              disabled={!hasMultipleSlices || currentSlice === 0}
              size="small"
            >
              <PrevIcon />
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title={isPlaying ? 'Pause' : 'Play'}>
          <span>
            <IconButton
              onClick={onPlayPause}
              disabled={!hasMultipleSlices}
              color={isPlaying ? 'primary' : 'default'}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title="Next slice">
          <span>
            <IconButton
              onClick={handleNextSlice}
              disabled={!hasMultipleSlices || currentSlice === totalSlices - 1}
              size="small"
            >
              <NextIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* FPS control */}
      <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 140, mr: 2 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ mr: 1, minWidth: 28 }}
        >
          FPS
        </Typography>
        <Slider
          value={fps}
          onChange={handleFpsChange}
          min={MIN_CINE_FPS}
          max={MAX_CINE_FPS}
          step={1}
          size="small"
          sx={{ width: 90 }}
          disabled={!hasMultipleSlices}
          valueLabelDisplay="auto"
        />
      </Box>

      {/* Slice indicator */}
      <Typography
        variant="body2"
        sx={{
          mx: 2,
          minWidth: 80,
          fontFamily: 'monospace',
          textAlign: 'center',
        }}
      >
        {currentSlice + 1} / {totalSlices}
      </Typography>

      {/* Main slice slider */}
      <Slider
        value={currentSlice}
        onChange={handleSliderChange}
        min={0}
        max={Math.max(0, totalSlices - 1)}
        step={1}
        sx={{ flex: 1, mx: 2 }}
        disabled={!hasMultipleSlices}
        marks={totalSlices <= 20 ? true : undefined}
      />

      {/* Status chips */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Chip
          label={modality || '-'}
          size="small"
          color="primary"
          variant="outlined"
        />
        <Chip
          label={`${Math.round(zoom * 100)}%`}
          size="small"
          variant="outlined"
        />
        <Chip
          label={`${imageWidth} x ${imageHeight}`}
          size="small"
          variant="outlined"
        />
      </Box>
    </Paper>
  );
};

export default CineControls;
