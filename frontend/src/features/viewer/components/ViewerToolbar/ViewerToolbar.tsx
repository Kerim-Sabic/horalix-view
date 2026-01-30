/**
 * Viewer Toolbar
 *
 * Main toolbar component for the DICOM viewer containing:
 * - Navigation tools (pan, zoom, rotate, window/level)
 * - Measurement tools
 * - View controls (panels, fullscreen)
 * - AI tools menu
 */

import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Typography,
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Contrast as ContrastIcon,
  Download as ExportIcon,
  Fullscreen as FullscreenIcon,
  GridView as GridIcon,
  InfoOutlined as InfoIcon,
  Layers as LayersIcon,
  Link as LinkIcon,
  LinkOff as LinkOffIcon,
  MouseOutlined as PointerIcon,
  PanTool as PanIcon,
  Pentagon as PolygonIcon,
  Psychology as AIIcon,
  RestartAlt as ResetIcon,
  RotateRight as RotateIcon,
  Settings as SettingsIcon,
  Straighten as MeasureIcon,
  Timeline as TimelineIcon,
  ViewInAr as ThreeDIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  ZoomIn as ZoomIcon,
  ZoomOut as ZoomOutIcon,
} from '@mui/icons-material';

import { ToolButton } from './ToolButton';
import { WindowLevelMenu } from './WindowLevelMenu';
import type { ViewerTool } from '../../types';
import type { WindowLevelPreset } from '../../constants';

// ============================================================================
// Types
// ============================================================================

interface AIModel {
  name: string;
  available: boolean;
  details: {
    model_type: string;
  };
}

interface ViewerToolbarProps {
  // Current state
  activeTool: ViewerTool;
  measurementScope: 'frame' | 'cine';
  modality: string | null;

  // Panel visibility
  showSeriesPanel: boolean;
  showInfoPanel: boolean;
  showMeasurementPanel: boolean;

  // AI state
  aiModels: AIModel[];
  aiJobRunning: boolean;
  showAiOverlay: boolean;
  hasAiResults: boolean;

  // 3D state
  has3dData: boolean;

  // Labels
  patientLabel: string;
  studyLabel: string;
  seriesLabel: string;

  // Tracking state
  canTrackMeasurement: boolean;
  isTrackingMeasurement: boolean;

  // Callbacks
  onToolChange: (tool: ViewerTool) => void;
  onMeasurementScopeToggle: () => void;
  onTrackMeasurement: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onRotate: () => void;
  onWindowLevelChange: (preset: WindowLevelPreset) => void;
  onResetWindowLevel: () => void;
  onToggleSeriesPanel: () => void;
  onToggleInfoPanel: () => void;
  onToggleMeasurementPanel: () => void;
  onToggleAiOverlay: () => void;
  onRunAiModel: (model: AIModel) => void;
  onOpenVolumeViewer: () => void;
  onToggleLayout?: () => void;
  isLayoutActive?: boolean;
  onOpenSettings: () => void;
  onFullscreen: () => void;
  onExport?: () => void;
}

// ============================================================================
// Tool Configurations
// ============================================================================

interface ToolConfig {
  id: ViewerTool;
  label: string;
  icon: React.ReactNode;
  isNavigation?: boolean;
  isMeasurement?: boolean;
}

const NAVIGATION_TOOLS: ToolConfig[] = [
  { id: 'pointer', label: 'Select', icon: <PointerIcon />, isNavigation: true },
  { id: 'pan', label: 'Pan', icon: <PanIcon />, isNavigation: true },
  { id: 'zoom', label: 'Zoom', icon: <ZoomIcon />, isNavigation: true },
  { id: 'wwwl', label: 'Window/Level', icon: <ContrastIcon />, isNavigation: true },
  { id: 'rotate', label: 'Rotate 90 deg', icon: <RotateIcon />, isNavigation: true },
];

const MEASUREMENT_TOOLS: ToolConfig[] = [
  { id: 'line', label: 'Line Measurement', icon: <MeasureIcon />, isMeasurement: true },
  { id: 'polygon', label: 'Polygon/Area', icon: <PolygonIcon />, isMeasurement: true },
];

// ============================================================================
// Component
// ============================================================================

export const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
  activeTool,
  measurementScope,
  modality,
  showSeriesPanel,
  showInfoPanel,
  showMeasurementPanel,
  aiModels,
  aiJobRunning,
  showAiOverlay,
  hasAiResults,
  has3dData,
  patientLabel,
  studyLabel,
  seriesLabel,
  canTrackMeasurement,
  isTrackingMeasurement,
  onToolChange,
  onMeasurementScopeToggle,
  onTrackMeasurement,
  onZoomIn,
  onZoomOut,
  onResetView,
  onRotate,
  onWindowLevelChange,
  onResetWindowLevel,
  onToggleSeriesPanel,
  onToggleInfoPanel,
  onToggleMeasurementPanel,
  onToggleAiOverlay,
  onRunAiModel,
  onOpenVolumeViewer,
  onToggleLayout,
  isLayoutActive = false,
  onOpenSettings,
  onFullscreen,
  onExport,
}) => {
  const navigate = useNavigate();

  // Menu anchors
  const [wlMenuAnchor, setWlMenuAnchor] = useState<HTMLElement | null>(null);
  const [aiMenuAnchor, setAiMenuAnchor] = useState<HTMLElement | null>(null);

  const isMeasurementTool = activeTool === 'line' || activeTool === 'polygon';

  const handleToolClick = useCallback((tool: ViewerTool) => {
    if (tool === 'rotate') {
      onRotate();
    }
    onToolChange(tool);
  }, [onToolChange, onRotate]);

  const handleAiModelClick = useCallback((model: AIModel) => {
    onRunAiModel(model);
    setAiMenuAnchor(null);
  }, [onRunAiModel]);

  return (
    <Paper
      sx={{
        display: 'flex',
        alignItems: 'center',
        px: 2,
        py: 1,
        borderRadius: 0,
        bgcolor: 'background.paper',
      }}
      elevation={0}
    >
      {/* Back button */}
      <ToolButton
        label="Back to Studies"
        icon={<BackIcon />}
        onClick={() => navigate('/studies')}
      />

      <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

      {/* Navigation tools */}
      {NAVIGATION_TOOLS.map((tool) => (
        <ToolButton
          key={tool.id}
          label={tool.label}
          icon={tool.icon}
          onClick={() => handleToolClick(tool.id)}
          isActive={activeTool === tool.id}
        />
      ))}

      <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

      {/* Measurement tools */}
      {MEASUREMENT_TOOLS.map((tool) => (
        <ToolButton
          key={tool.id}
          label={tool.label}
          icon={tool.icon}
          onClick={() => handleToolClick(tool.id)}
          isActive={activeTool === tool.id}
        />
      ))}

      {/* Measurement scope toggle */}
      <ToolButton
        label={`Measurements: ${measurementScope === 'cine' ? 'Cine' : 'Frame'}`}
        icon={measurementScope === 'cine' ? <LinkIcon /> : <LinkOffIcon />}
        onClick={onMeasurementScopeToggle}
        isActive={measurementScope === 'cine'}
        disabled={!isMeasurementTool}
      />

      {/* Track measurement */}
      <ToolButton
        label="Track measurement across frames"
        icon={isTrackingMeasurement ? <CircularProgress size={18} color="inherit" /> : <TimelineIcon />}
        onClick={onTrackMeasurement}
        disabled={!canTrackMeasurement || isTrackingMeasurement}
      />

      <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

      {/* Zoom controls */}
      <ToolButton label="Zoom In" icon={<ZoomIcon />} onClick={onZoomIn} />
      <ToolButton label="Zoom Out" icon={<ZoomOutIcon />} onClick={onZoomOut} />
      <ToolButton label="Reset View" icon={<ResetIcon />} onClick={onResetView} />

      {/* Window/Level menu */}
      <ToolButton
        label="Window/Level Presets"
        icon={<ContrastIcon />}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => setWlMenuAnchor(e.currentTarget as HTMLElement)}
      />
      <WindowLevelMenu
        anchorEl={wlMenuAnchor}
        open={Boolean(wlMenuAnchor)}
        onClose={() => setWlMenuAnchor(null)}
        modality={modality}
        onSelectPreset={onWindowLevelChange}
        onResetToDefault={onResetWindowLevel}
      />

      <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

      {/* View controls */}
      <ToolButton
        label="3D Volume"
        icon={<ThreeDIcon />}
        onClick={onOpenVolumeViewer}
        disabled={!has3dData}
      />
      <ToolButton
        label="Layout"
        icon={<GridIcon />}
        onClick={onToggleLayout || (() => {})}
        isActive={isLayoutActive}
        disabled={!onToggleLayout}
      />
      <ToolButton
        label="Series Panel"
        icon={<LayersIcon />}
        onClick={onToggleSeriesPanel}
        isActive={showSeriesPanel}
      />
      <ToolButton
        label="Info Panel"
        icon={<InfoIcon />}
        onClick={onToggleInfoPanel}
        isActive={showInfoPanel}
      />
      <ToolButton
        label="Measurements Panel"
        icon={<MeasureIcon />}
        onClick={onToggleMeasurementPanel}
        isActive={showMeasurementPanel}
      />

      {/* Spacer with info */}
      <Box sx={{ flex: 1, minWidth: 0, mx: 2 }}>
        <Typography
          variant="body2"
          sx={{
            color: 'text.secondary',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          Patient: {patientLabel} | Study: {studyLabel} | Series: {seriesLabel}
        </Typography>
      </Box>

      {/* AI controls */}
      <ToolButton
        label={showAiOverlay ? 'Hide AI overlay' : 'Show AI overlay'}
        icon={showAiOverlay ? <VisibilityIcon /> : <VisibilityOffIcon />}
        onClick={onToggleAiOverlay}
        disabled={!hasAiResults}
      />

      <Button
        variant="contained"
        color="secondary"
        startIcon={aiJobRunning ? <CircularProgress size={16} color="inherit" /> : <AIIcon />}
        onClick={(e) => setAiMenuAnchor(e.currentTarget)}
        disabled={aiJobRunning}
        sx={{ mr: 1 }}
      >
        {aiJobRunning ? 'Processing...' : 'AI Tools'}
      </Button>
      <Menu
        anchorEl={aiMenuAnchor}
        open={Boolean(aiMenuAnchor)}
        onClose={() => setAiMenuAnchor(null)}
      >
        {aiModels.length === 0 ? (
          <MenuItem disabled>No AI models available</MenuItem>
        ) : (
          aiModels.map((model) => (
            <MenuItem
              key={model.name}
              onClick={() => handleAiModelClick(model)}
              disabled={!model.available}
            >
              <ListItemIcon>
                <AIIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={model.name}
                secondary={model.available ? model.details.model_type : 'Not available'}
              />
            </MenuItem>
          ))
        )}
      </Menu>

      {/* Export and settings */}
      <ToolButton
        label="Export"
        icon={<ExportIcon />}
        onClick={onExport || (() => {})}
        disabled={!onExport}
      />
      <ToolButton label="Fullscreen" icon={<FullscreenIcon />} onClick={onFullscreen} />
      <ToolButton label="Settings" icon={<SettingsIcon />} onClick={onOpenSettings} />
    </Paper>
  );
};

export default ViewerToolbar;
