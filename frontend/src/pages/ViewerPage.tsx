/**
 * DICOM Viewer Page
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  IconButton,
  Tooltip,
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
  CircularProgress,
  Alert,
  Snackbar,
  Skeleton,
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
import { api, Study, Series, SeriesDetailResponse, AIModel } from '../services/api';

const ViewerPage: React.FC = () => {
  const { studyUid } = useParams<{ studyUid: string }>();
  const navigate = useNavigate();
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Data state
  const [study, setStudy] = useState<Study | null>(null);
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<SeriesDetailResponse | null>(null);
  const [aiModels, setAIModels] = useState<AIModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Viewer state
  const [currentSlice, setCurrentSlice] = useState(0);
  const [totalSlices, setTotalSlices] = useState(1);
  const [windowLevel, setWindowLevel] = useState({ center: 40, width: 400 });
  const [zoom, setZoom] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTool, setActiveTool] = useState('pan');
  const [showSeriesPanel, setShowSeriesPanel] = useState(true);
  const [aiMenuAnchor, setAIMenuAnchor] = useState<null | HTMLElement>(null);

  // AI job state
  const [aiJobRunning, setAiJobRunning] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);

  // Fetch study and series data
  useEffect(() => {
    const fetchData = async () => {
      if (!studyUid) return;

      try {
        setLoading(true);
        setError(null);

        // Fetch study and series in parallel
        const [studyResult, seriesResult, modelsResult] = await Promise.allSettled([
          api.studies.get(studyUid),
          api.series.list(studyUid),
          api.ai.getModels(),
        ]);

        if (studyResult.status === 'fulfilled') {
          setStudy(studyResult.value);
        } else {
          throw new Error('Failed to load study');
        }

        if (seriesResult.status === 'fulfilled') {
          setSeriesList(seriesResult.value.series);
          // Select first series by default
          if (seriesResult.value.series.length > 0) {
            await selectSeries(seriesResult.value.series[0].series_instance_uid);
          }
        }

        if (modelsResult.status === 'fulfilled') {
          setAIModels(modelsResult.value.models);
        }
      } catch (err) {
        console.error('Failed to load viewer data:', err);
        setError('Failed to load study. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [studyUid]);

  // Select a series and load its details
  const selectSeries = async (seriesUid: string) => {
    try {
      const seriesDetail = await api.series.get(seriesUid);
      setSelectedSeries(seriesDetail);
      setTotalSlices(seriesDetail.instances.length || 1);
      setCurrentSlice(0);

      // Set initial window/level if available
      if (seriesDetail.window_center && seriesDetail.window_width) {
        setWindowLevel({
          center: seriesDetail.window_center,
          width: seriesDetail.window_width,
        });
      }
    } catch (err) {
      console.error('Failed to load series:', err);
      setSnackbarMessage('Failed to load series');
    }
  };

  // Get current instance UID
  const currentInstanceUid = selectedSeries?.instances[currentSlice]?.sop_instance_uid;

  // Get image URL for current slice
  const getImageUrl = useCallback(() => {
    if (!currentInstanceUid) return null;
    return api.instances.getPixelDataUrl(currentInstanceUid, {
      windowCenter: windowLevel.center,
      windowWidth: windowLevel.width,
      format: 'png',
    });
  }, [currentInstanceUid, windowLevel.center, windowLevel.width]);

  // Cine playback
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setCurrentSlice((prev) => (prev + 1) % totalSlices);
    }, 100); // 10 fps

    return () => clearInterval(interval);
  }, [isPlaying, totalSlices]);

  // Run AI model
  const handleRunAIModel = async (model: AIModel) => {
    if (!studyUid || !selectedSeries) {
      setSnackbarMessage('Please select a series first');
      return;
    }

    try {
      setAiJobRunning(true);
      setAIMenuAnchor(null);

      const job = await api.ai.createJob({
        model_type: model.model_id,
        task_type: model.model_type.toLowerCase(),
        study_instance_uid: studyUid,
        series_instance_uid: selectedSeries.series.series_instance_uid,
      });

      setSnackbarMessage(`AI job started: ${model.name}`);

      // Poll for completion
      const completedJob = await api.ai.waitForJob(job.job_id, 2000, 300000);

      if (completedJob.status === 'completed') {
        setSnackbarMessage(`AI analysis complete: ${model.name}`);
      } else if (completedJob.status === 'failed') {
        setSnackbarMessage(`AI analysis failed: ${completedJob.error_message || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('AI job failed:', err);
      setSnackbarMessage('AI analysis failed');
    } finally {
      setAiJobRunning(false);
    }
  };

  const tools = [
    { id: 'pan', label: 'Pan', icon: <PanIcon /> },
    { id: 'zoom', label: 'Zoom', icon: <ZoomIcon /> },
    { id: 'wwwl', label: 'Window/Level', icon: <ContrastIcon /> },
    { id: 'measure', label: 'Measure', icon: <MeasureIcon /> },
    { id: 'rotate', label: 'Rotate', icon: <RotateIcon /> },
  ];

  if (loading) {
    return (
      <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: '#000' }}>
        {/* Toolbar skeleton */}
        <Paper sx={{ px: 2, py: 1, borderRadius: 0 }} elevation={0}>
          <Skeleton variant="rectangular" width="100%" height={48} />
        </Paper>

        {/* Main content skeleton */}
        <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Series panel skeleton */}
          <Paper sx={{ width: 250, borderRadius: 0, p: 2 }} elevation={0}>
            <Skeleton variant="text" width="60%" height={24} sx={{ mb: 2 }} />
            <Skeleton variant="rectangular" width="100%" height={80} sx={{ mb: 1 }} />
            <Skeleton variant="rectangular" width="100%" height={80} sx={{ mb: 1 }} />
            <Skeleton variant="rectangular" width="100%" height={80} />
          </Paper>

          {/* Viewport skeleton */}
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#000' }}>
            <Skeleton variant="rectangular" width="60%" height="60%" sx={{ bgcolor: 'grey.900' }} />
          </Box>
        </Box>

        {/* Bottom controls skeleton */}
        <Paper sx={{ px: 2, py: 1, borderRadius: 0 }} elevation={0}>
          <Skeleton variant="rectangular" width="100%" height={40} />
        </Paper>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Alert severity="error" action={
          <Button color="inherit" size="small" onClick={() => navigate('/studies')}>
            Back to Studies
          </Button>
        }>
          {error}
        </Alert>
      </Box>
    );
  }

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
              onClick={() => {
                setActiveTool(tool.id);
                // Reset zoom when switching away from zoom tool
                if (tool.id === 'zoom' && activeTool !== 'zoom') {
                  setZoom(1);
                }
              }}
              color={activeTool === tool.id ? 'primary' : 'default'}
            >
              {tool.icon}
            </IconButton>
          </Tooltip>
        ))}

        <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

        {/* View options */}
        <Tooltip title="3D Volume">
          <span>
            <IconButton disabled={!selectedSeries?.has_3d_data}>
              <ThreeDIcon />
            </IconButton>
          </span>
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
          startIcon={aiJobRunning ? <CircularProgress size={16} color="inherit" /> : <AIIcon />}
          onClick={(e) => setAIMenuAnchor(e.currentTarget)}
          disabled={aiJobRunning || !selectedSeries}
          sx={{ mr: 1 }}
        >
          {aiJobRunning ? 'Processing...' : 'AI Tools'}
        </Button>
        <Menu
          anchorEl={aiMenuAnchor}
          open={Boolean(aiMenuAnchor)}
          onClose={() => setAIMenuAnchor(null)}
        >
          {aiModels.length === 0 ? (
            <MenuItem disabled>No AI models available</MenuItem>
          ) : (
            aiModels.map((model) => (
              <MenuItem
                key={model.model_id}
                onClick={() => handleRunAIModel(model)}
                disabled={!model.is_loaded}
              >
                <ListItemIcon>
                  <AIIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={model.name}
                  secondary={model.is_loaded ? model.model_type : 'Not loaded'}
                />
              </MenuItem>
            ))
          )}
        </Menu>

        <Tooltip title="Export">
          <IconButton>
            <ExportIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Fullscreen">
          <IconButton onClick={() => document.documentElement.requestFullscreen()}>
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
                Series ({seriesList.length})
              </Typography>
            </Box>
            <List disablePadding>
              {seriesList.length === 0 ? (
                <ListItem>
                  <ListItemText
                    primary="No series found"
                    primaryTypographyProps={{ color: 'text.secondary', variant: 'body2' }}
                  />
                </ListItem>
              ) : (
                seriesList.map((s) => (
                  <ListItem key={s.series_instance_uid} disablePadding>
                    <ListItemButton
                      selected={selectedSeries?.series.series_instance_uid === s.series_instance_uid}
                      onClick={() => selectSeries(s.series_instance_uid)}
                    >
                      <Box
                        sx={{
                          width: 60,
                          height: 60,
                          bgcolor: 'grey.800',
                          borderRadius: 1,
                          mr: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Typography variant="caption" color="grey.500">
                          {s.modality}
                        </Typography>
                      </Box>
                      <ListItemText
                        primary={s.series_description || `Series ${s.series_number || '-'}`}
                        secondary={`${s.num_instances} images`}
                        primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                        secondaryTypographyProps={{ variant: 'caption' }}
                      />
                    </ListItemButton>
                  </ListItem>
                ))
              )}
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
          {/* DICOM Image */}
          {currentInstanceUid ? (
            <Box
              sx={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              <img
                ref={imageRef}
                src={getImageUrl() || ''}
                alt={`Slice ${currentSlice + 1}`}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  transform: `scale(${zoom})`,
                  transition: 'transform 0.1s ease',
                }}
                onError={() => setSnackbarMessage('Failed to load image')}
              />
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
            <div>Patient: {study?.patient_name || 'Unknown'}</div>
            <div>Study: {study?.study_description || '-'}</div>
            <div>Series: {selectedSeries?.series.series_description || '-'}</div>
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
            {selectedSeries?.series.slice_thickness && (
              <div>Slice Thickness: {selectedSeries.series.slice_thickness} mm</div>
            )}
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
        <IconButton onClick={() => setIsPlaying(!isPlaying)} disabled={totalSlices <= 1}>
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </IconButton>

        <Typography variant="body2" sx={{ mx: 2, minWidth: 80 }}>
          {currentSlice + 1} / {totalSlices}
        </Typography>

        <Slider
          value={currentSlice}
          onChange={(_, value) => setCurrentSlice(value as number)}
          min={0}
          max={Math.max(0, totalSlices - 1)}
          sx={{ flex: 1, mx: 2 }}
          disabled={totalSlices <= 1}
        />

        <Chip
          label={selectedSeries?.series.modality || '-'}
          size="small"
          sx={{ mr: 1 }}
        />
        <Chip
          label={
            selectedSeries?.instances[0]
              ? `${selectedSeries.instances[0].rows || '-'} x ${selectedSeries.instances[0].columns || '-'}`
              : '-'
          }
          size="small"
          variant="outlined"
        />
      </Paper>

      {/* Snackbar for notifications */}
      <Snackbar
        open={!!snackbarMessage}
        autoHideDuration={4000}
        onClose={() => setSnackbarMessage(null)}
        message={snackbarMessage}
      />
    </Box>
  );
};

export default ViewerPage;
