/**
 * Measurement Panel
 *
 * Side panel for managing measurements:
 * - Lists all measurements for current series/frame
 * - Allows selection, deletion, visibility toggle
 * - Export/import controls
 * - Undo/redo buttons
 */

import React, { useMemo, useCallback } from 'react';
import {
  Box,
  Button,
  Chip,
  IconButton,
  List,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Download as ExportIcon,
  Redo as RedoIcon,
  Undo as UndoIcon,
  Upload as ImportIcon,
  VisibilityOff as HideAllIcon,
  Visibility as ShowAllIcon,
} from '@mui/icons-material';

import { MeasurementListItem } from './MeasurementListItem';
import type { Measurement, TrackingData } from '../../types';

// ============================================================================
// Types
// ============================================================================

interface MeasurementPanelProps {
  measurements: Measurement[];
  selectedId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  seriesUid: string | null;
  frameKey: string | null;
  instanceLabelByUid?: Record<string, string>;
  trackingDataMap?: Map<string, TrackingData>;
  currentFrameIndex?: number;
  onJumpToFrame?: (frameIndex: number) => void;

  onSelectMeasurement: (id: string | null) => void;
  onDeleteMeasurement: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onDeleteAll: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onExport: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onImport: () => void;
  onEditLabel?: (id: string) => void;
  onTrackMeasurement?: (id: string) => void;
}

// ============================================================================
// Component
// ============================================================================

export const MeasurementPanel: React.FC<MeasurementPanelProps> = React.memo(({
  measurements,
  selectedId,
  canUndo,
  canRedo,
  seriesUid,
  frameKey: _frameKey,
  instanceLabelByUid,
  trackingDataMap,
  currentFrameIndex,
  onJumpToFrame,
  onSelectMeasurement,
  onDeleteMeasurement,
  onToggleVisibility,
  onShowAll,
  onHideAll,
  onDeleteAll,
  onUndo,
  onRedo,
  onExport,
  onImport,
  onEditLabel,
  onTrackMeasurement,
}) => {
  const frameKey = _frameKey;
  const getCineLabel = useCallback(
    (measurement: Measurement) => {
      if (!instanceLabelByUid) return null;
      const instanceUid =
        measurement.instanceUid ??
        (measurement.frameKey ? measurement.frameKey.split(':')[0] : null);
      if (!instanceUid) return null;
      return instanceLabelByUid[instanceUid] ?? null;
    },
    [instanceLabelByUid]
  );
  const getFrameLabel = useCallback((measurement: Measurement) => {
    if (!measurement.frameKey) return null;
    const parts = measurement.frameKey.split(':');
    if (parts.length < 2) return null;
    const idx = Number(parts[1]);
    if (!Number.isFinite(idx)) return null;
    return `Frame ${idx + 1}`;
  }, []);
  // Group measurements by scope
  const { frameMeasurements, seriesMeasurements } = useMemo(() => {
    const frame: Measurement[] = [];
    const series: Measurement[] = [];

    for (const m of measurements) {
      if (m.scope === 'frame') {
        if (!frameKey || m.frameKey === frameKey) {
          frame.push(m);
        }
      } else {
        series.push(m);
      }
    }

    return { frameMeasurements: frame, seriesMeasurements: series };
  }, [measurements, frameKey]);

  const handleSelect = useCallback((id: string) => {
    onSelectMeasurement(selectedId === id ? null : id);
  }, [selectedId, onSelectMeasurement]);

  const totalCount = measurements.length;
  const visibleCount = useMemo(() => measurements.filter(m => m.visible).length, [measurements]);

  return (
    <Paper
      sx={{
        width: 300,
        borderRadius: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderLeft: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
      elevation={0}
    >
      {/* Header */}
      <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
        <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 700 }}>
          Measurements
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip
            size="small"
            label={`${visibleCount}/${totalCount} visible`}
            variant="outlined"
            sx={{ fontWeight: 600 }}
          />
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Undo">
            <span>
              <IconButton size="small" onClick={onUndo} disabled={!canUndo}>
                <UndoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Redo">
            <span>
              <IconButton size="small" onClick={onRedo} disabled={!canRedo}>
                <RedoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Box>

      {/* Measurement list */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {measurements.length === 0 ? (
          <Box
            sx={{
              p: 3,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
            }}
          >
            <Typography variant="body2" color="text.secondary" textAlign="center">
              No measurements yet.
              <br />
              Use the measurement tools to create annotations.
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
            {/* Frame measurements section */}
            {frameMeasurements.length > 0 && (
              <>
                <Box sx={{ px: 2, py: 1, bgcolor: 'background.default' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    This Frame ({frameMeasurements.length})
                  </Typography>
                </Box>
                {frameMeasurements.map((measurement) => (
                  <MeasurementListItem
                    key={measurement.id}
                    measurement={measurement}
                    isSelected={measurement.id === selectedId}
                    cineLabel={getCineLabel(measurement)}
                    frameLabel={getFrameLabel(measurement)}
                    trackingData={trackingDataMap?.get(measurement.id)}
                    currentFrameIndex={currentFrameIndex}
                    onJumpToFrame={onJumpToFrame}
                    onSelect={() => handleSelect(measurement.id)}
                    onDelete={() => onDeleteMeasurement(measurement.id)}
                    onToggleVisibility={() => onToggleVisibility(measurement.id)}
                    onEditLabel={onEditLabel ? () => onEditLabel(measurement.id) : undefined}
                    onTrack={onTrackMeasurement ? () => onTrackMeasurement(measurement.id) : undefined}
                  />
                ))}
              </>
            )}

            {/* Series measurements section */}
            {seriesMeasurements.length > 0 && (
              <>
                <Box sx={{ px: 2, py: 1, bgcolor: 'background.default' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    All Frames ({seriesMeasurements.length})
                  </Typography>
                </Box>
                {seriesMeasurements.map((measurement) => (
                  <MeasurementListItem
                    key={measurement.id}
                    measurement={measurement}
                    isSelected={measurement.id === selectedId}
                    cineLabel={getCineLabel(measurement)}
                    frameLabel={getFrameLabel(measurement)}
                    trackingData={trackingDataMap?.get(measurement.id)}
                    currentFrameIndex={currentFrameIndex}
                    onJumpToFrame={onJumpToFrame}
                    onSelect={() => handleSelect(measurement.id)}
                    onDelete={() => onDeleteMeasurement(measurement.id)}
                    onToggleVisibility={() => onToggleVisibility(measurement.id)}
                    onEditLabel={onEditLabel ? () => onEditLabel(measurement.id) : undefined}
                    onTrack={onTrackMeasurement ? () => onTrackMeasurement(measurement.id) : undefined}
                  />
                ))}
              </>
            )}
          </List>
        )}
      </Box>

      {/* Footer actions */}
      <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
        <Stack direction="row" spacing={1} justifyContent="space-between">
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Show all">
              <IconButton size="small" onClick={onShowAll} disabled={visibleCount === totalCount}>
                <ShowAllIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Hide all">
              <IconButton size="small" onClick={onHideAll} disabled={visibleCount === 0}>
                <HideAllIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete all">
              <IconButton
                size="small"
                onClick={onDeleteAll}
                disabled={totalCount === 0}
                color="error"
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              startIcon={<ImportIcon />}
              onClick={onImport}
              disabled={!seriesUid}
            >
              Import
            </Button>
            <Button
              size="small"
              startIcon={<ExportIcon />}
              onClick={onExport}
              disabled={totalCount === 0}
            >
              Export
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Paper>
  );
});

MeasurementPanel.displayName = 'MeasurementPanel';

export default MeasurementPanel;
