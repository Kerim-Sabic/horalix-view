/**
 * DICOM Viewer Page
 */

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  IconButton,
  Tooltip,
  Drawer,
  Typography,
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Slider,
  Paper,
  Chip,
  Button,
  Menu,
  MenuItem,
  ListItemIcon,
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  ZoomIn as ZoomIcon,
  PanTool as PanIcon,
  Straighten as MeasureIcon,
  Contrast as ContrastIcon,
  RotateRight as RotateIcon,
  ViewInAr as ThreeDIcon,
  Psychology as AIIcon,
  Layers as LayersIcon,
  GridView as GridIcon,
  Fullscreen as FullscreenIcon,
  Settings as SettingsIcon,
  Download as ExportIcon,
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
} from '@mui/icons-material';

const ViewerPage: React.FC = () => {
  const { studyUid, seriesUid } = useParams();
  const navigate = useNavigate();
  const viewportRef = useRef<HTMLDivElement>(null);

  const [currentSlice, setCurrentSlice] = useState(0);
  const [totalSlices, setTotalSlices] = useState(150);
  const [windowLevel, setWindowLevel] = useState({ center: 40, width: 400 });
  const [zoom, setZoom] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTool, setActiveTool] = useState('pan');
  const [showSeriesPanel, setShowSeriesPanel] = useState(true);
  const [aiMenuAnchor, setAIMenuAnchor] = useState<null | HTMLElement>(null);

  // Mock series data
  const series = [
    { uid: '1', description: 'Axial Soft Tissue', numImages: 150, modality: 'CT' },
    { uid: '2', description: 'Axial Lung Window', numImages: 150, modality: 'CT' },
    { uid: '3', description: 'Coronal Reformats', numImages: 80, modality: 'CT' },
  ];

  useEffect(() => {
    // Initialize Cornerstone viewport
    // In production, this would set up the actual DICOM viewer
  }, [studyUid, seriesUid]);

  const tools = [
    { id: 'pan', label: 'Pan', icon: <PanIcon /> },
    { id: 'zoom', label: 'Zoom', icon: <ZoomIcon /> },
    { id: 'wwwl', label: 'Window/Level', icon: <ContrastIcon /> },
    { id: 'measure', label: 'Measure', icon: <MeasureIcon /> },
    { id: 'rotate', label: 'Rotate', icon: <RotateIcon /> },
  ];

  const aiModels = [
    { id: 'nnunet', name: 'nnU-Net Segmentation' },
    { id: 'medsam', name: 'MedSAM Interactive' },
    { id: 'yolov8', name: 'YOLOv8 Detection' },
    { id: 'unimie', name: 'UniMIE Enhancement' },
  ];

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: '#000' }}>
      {/* Top Toolbar */}
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
        <Tooltip title="Back to Studies">
          <IconButton onClick={() => navigate('/studies')}>
            <BackIcon />
          </IconButton>
        </Tooltip>

        <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

        {/* Tools */}
        {tools.map((tool) => (
          <Tooltip key={tool.id} title={tool.label}>
            <IconButton
              onClick={() => setActiveTool(tool.id)}
              color={activeTool === tool.id ? 'primary' : 'default'}
            >
              {tool.icon}
            </IconButton>
          </Tooltip>
        ))}

        <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

        {/* View options */}
        <Tooltip title="3D Volume">
          <IconButton>
            <ThreeDIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Layout">
          <IconButton>
            <GridIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Series Panel">
          <IconButton onClick={() => setShowSeriesPanel(!showSeriesPanel)}>
            <LayersIcon />
          </IconButton>
        </Tooltip>

        <Box sx={{ flex: 1 }} />

        {/* AI Tools */}
        <Button
          variant="contained"
          color="secondary"
          startIcon={<AIIcon />}
          onClick={(e) => setAIMenuAnchor(e.currentTarget)}
          sx={{ mr: 1 }}
        >
          AI Tools
        </Button>
        <Menu
          anchorEl={aiMenuAnchor}
          open={Boolean(aiMenuAnchor)}
          onClose={() => setAIMenuAnchor(null)}
        >
          {aiModels.map((model) => (
            <MenuItem key={model.id} onClick={() => setAIMenuAnchor(null)}>
              <ListItemIcon>
                <AIIcon fontSize="small" />
              </ListItemIcon>
              {model.name}
            </MenuItem>
          ))}
        </Menu>

        <Tooltip title="Export">
          <IconButton>
            <ExportIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Fullscreen">
          <IconButton>
            <FullscreenIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Settings">
          <IconButton>
            <SettingsIcon />
          </IconButton>
        </Tooltip>
      </Paper>

      {/* Main Content */}
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Series Panel */}
        {showSeriesPanel && (
          <Paper
            sx={{
              width: 250,
              borderRadius: 0,
              overflow: 'auto',
            }}
            elevation={0}
          >
            <Box sx={{ p: 2 }}>
              <Typography variant="subtitle2" color="text.secondary">
                Series
              </Typography>
            </Box>
            <List disablePadding>
              {series.map((s, index) => (
                <ListItem key={s.uid} disablePadding>
                  <ListItemButton selected={index === 0}>
                    <Box sx={{ width: 60, height: 60, bgcolor: 'grey.800', borderRadius: 1, mr: 1 }} />
                    <ListItemText
                      primary={s.description}
                      secondary={`${s.numImages} images`}
                      primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                      secondaryTypographyProps={{ variant: 'caption' }}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Paper>
        )}

        {/* Viewport */}
        <Box
          ref={viewportRef}
          sx={{
            flex: 1,
            position: 'relative',
            bgcolor: '#000',
          }}
        >
          {/* DICOM Viewport would be rendered here */}
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
            <Typography>DICOM Viewport - Study: {studyUid}</Typography>
          </Box>

          {/* Overlay - Top Left */}
          <Box
            sx={{
              position: 'absolute',
              top: 16,
              left: 16,
              color: '#fff',
              fontFamily: 'monospace',
              fontSize: '12px',
              textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
            }}
          >
            <div>Patient: John Doe</div>
            <div>Study: CT CHEST WITH CONTRAST</div>
            <div>Series: Axial Soft Tissue</div>
          </Box>

          {/* Overlay - Top Right */}
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
            <div>W: {windowLevel.width} L: {windowLevel.center}</div>
            <div>Zoom: {(zoom * 100).toFixed(0)}%</div>
          </Box>

          {/* Overlay - Bottom Left */}
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
            <div>Image: {currentSlice + 1} / {totalSlices}</div>
            <div>Slice: -100.0 mm</div>
          </Box>
        </Box>
      </Box>

      {/* Bottom Controls */}
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
        <IconButton onClick={() => setIsPlaying(!isPlaying)}>
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </IconButton>

        <Typography variant="body2" sx={{ mx: 2, minWidth: 80 }}>
          {currentSlice + 1} / {totalSlices}
        </Typography>

        <Slider
          value={currentSlice}
          onChange={(_, value) => setCurrentSlice(value as number)}
          min={0}
          max={totalSlices - 1}
          sx={{ flex: 1, mx: 2 }}
        />

        <Chip label="CT" size="small" sx={{ mr: 1 }} />
        <Chip label="512 x 512" size="small" variant="outlined" />
      </Paper>
    </Box>
  );
};

export default ViewerPage;
