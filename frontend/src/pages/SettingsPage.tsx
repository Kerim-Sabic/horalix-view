/**
 * Settings Page
 */

import React, { useEffect, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Slider,
  Switch,
  Typography,
} from '@mui/material';
import { useTheme } from '@/themes/ThemeProvider';

const SettingsPage: React.FC = () => {
  const { setMode, isDarkMode } = useTheme();
  const readBoolean = (key: string, fallback: boolean) => {
    if (typeof localStorage === 'undefined') return fallback;
    const stored = localStorage.getItem(key);
    if (stored === null) return fallback;
    return stored === 'true';
  };
  const readNumber = (key: string, fallback: number) => {
    if (typeof localStorage === 'undefined') return fallback;
    const stored = localStorage.getItem(key);
    if (stored === null) return fallback;
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const readScope = (key: string, fallback: 'cine' | 'frame') => {
    if (typeof localStorage === 'undefined') return fallback;
    const stored = localStorage.getItem(key);
    return stored === 'frame' ? 'frame' : fallback;
  };

  const [autoTrackCine, setAutoTrackCine] = useState(readBoolean('viewer_auto_track_cine', true));
  const [preferJpegForCine, setPreferJpegForCine] = useState(readBoolean('viewer_prefer_jpeg_cine', true));
  const [cineFps, setCineFps] = useState(readNumber('viewer_cine_fps', 15));
  const [measurementScope, setMeasurementScope] = useState<'cine' | 'frame'>(
    readScope('viewer_measurement_scope', 'cine')
  );
  const [smoothContoursEnabled, setSmoothContoursEnabled] = useState(readBoolean('viewer_smooth_contours', true));
  const [smoothContoursIterations, setSmoothContoursIterations] = useState(readNumber('viewer_smooth_contours_iterations', 1));
  const [smoothTrackingEnabled, setSmoothTrackingEnabled] = useState(readBoolean('viewer_smooth_tracking', true));
  const [smoothTrackingWindow, setSmoothTrackingWindow] = useState(readNumber('viewer_smooth_tracking_window', 2));
  const [showTrackingTrails, setShowTrackingTrails] = useState(readBoolean('viewer_show_tracking_trails', true));
  const [trackingTrailLength, setTrackingTrailLength] = useState(readNumber('viewer_tracking_trail_length', 3));
  const [autoFitOnRotate, setAutoFitOnRotate] = useState(readBoolean('viewer_auto_fit_rotate', true));
  const [autoPromoteTracking, setAutoPromoteTracking] = useState(readBoolean('viewer_auto_promote_tracking', true));
  const [guidelineCopilotEnabled, setGuidelineCopilotEnabled] = useState(readBoolean('viewer_guideline_copilot', true));

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('viewer_auto_track_cine', String(autoTrackCine));
    localStorage.setItem('viewer_prefer_jpeg_cine', String(preferJpegForCine));
    localStorage.setItem('viewer_cine_fps', String(Math.round(cineFps)));
    localStorage.setItem('viewer_measurement_scope', measurementScope);
    localStorage.setItem('viewer_smooth_contours', String(smoothContoursEnabled));
    localStorage.setItem('viewer_smooth_contours_iterations', String(smoothContoursIterations));
    localStorage.setItem('viewer_smooth_tracking', String(smoothTrackingEnabled));
    localStorage.setItem('viewer_smooth_tracking_window', String(smoothTrackingWindow));
    localStorage.setItem('viewer_show_tracking_trails', String(showTrackingTrails));
    localStorage.setItem('viewer_tracking_trail_length', String(trackingTrailLength));
    localStorage.setItem('viewer_auto_fit_rotate', String(autoFitOnRotate));
    localStorage.setItem('viewer_auto_promote_tracking', String(autoPromoteTracking));
    localStorage.setItem('viewer_guideline_copilot', String(guidelineCopilotEnabled));
  }, [
    autoTrackCine,
    preferJpegForCine,
    cineFps,
    measurementScope,
    smoothContoursEnabled,
    smoothContoursIterations,
    smoothTrackingEnabled,
    smoothTrackingWindow,
    showTrackingTrails,
    trackingTrailLength,
    autoFitOnRotate,
    autoPromoteTracking,
    guidelineCopilotEnabled,
  ]);

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 700 }}>
        Settings
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Appearance
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={isDarkMode}
                onChange={() => setMode(isDarkMode ? 'light' : 'dark')}
              />
            }
            label="Dark Mode"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Viewer Settings
          </Typography>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Cine and Measurement Defaults
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={autoTrackCine}
                onChange={(event) => setAutoTrackCine(event.target.checked)}
              />
            }
            label="Auto-track cine measurements"
          />
          <FormControlLabel
            control={
              <Switch
                checked={preferJpegForCine}
                onChange={(event) => setPreferJpegForCine(event.target.checked)}
              />
            }
            label="Prefer JPEG for cine playback"
          />
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Default cine FPS
            </Typography>
            <Slider
              value={cineFps}
              onChange={(_, value) => setCineFps(value as number)}
              min={5}
              max={30}
              step={1}
              size="small"
              valueLabelDisplay="auto"
              sx={{ mt: 1, maxWidth: 240 }}
            />
          </Box>

          <Divider sx={{ my: 2 }} />

          <FormControl component="fieldset">
            <FormLabel component="legend">Default measurement scope</FormLabel>
            <RadioGroup
              row
              value={measurementScope}
              onChange={(event) => setMeasurementScope(event.target.value as 'cine' | 'frame')}
            >
              <FormControlLabel value="cine" control={<Radio />} label="Cine" />
              <FormControlLabel value="frame" control={<Radio />} label="Frame" />
            </RadioGroup>
          </FormControl>

          <Divider sx={{ my: 2 }} />

          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Smoothing and Tracking
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={smoothContoursEnabled}
                onChange={(event) => setSmoothContoursEnabled(event.target.checked)}
              />
            }
            label="Smooth polygon contours"
          />
          {smoothContoursEnabled && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Contour smoothing iterations
              </Typography>
              <Slider
                value={smoothContoursIterations}
                onChange={(_, value) => setSmoothContoursIterations(value as number)}
                min={0}
                max={3}
                step={1}
                size="small"
                valueLabelDisplay="auto"
                sx={{ mt: 1, maxWidth: 240 }}
              />
            </Box>
          )}
          <FormControlLabel
            control={
              <Switch
                checked={smoothTrackingEnabled}
                onChange={(event) => setSmoothTrackingEnabled(event.target.checked)}
              />
            }
            label="Smooth tracking across frames"
          />
          {smoothTrackingEnabled && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Temporal smoothing window
              </Typography>
              <Slider
                value={smoothTrackingWindow}
                onChange={(_, value) => setSmoothTrackingWindow(value as number)}
                min={0}
                max={4}
                step={1}
                size="small"
                valueLabelDisplay="auto"
                sx={{ mt: 1, maxWidth: 240 }}
              />
            </Box>
          )}
          <FormControlLabel
            control={
              <Switch
                checked={showTrackingTrails}
                onChange={(event) => setShowTrackingTrails(event.target.checked)}
              />
            }
            label="Show tracking motion trails"
          />
          {showTrackingTrails && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Trail length (frames)
              </Typography>
              <Slider
                value={trackingTrailLength}
                onChange={(_, value) => setTrackingTrailLength(value as number)}
                min={1}
                max={6}
                step={1}
                size="small"
                valueLabelDisplay="auto"
                sx={{ mt: 1, maxWidth: 240 }}
              />
            </Box>
          )}

          <Divider sx={{ my: 2 }} />

          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Workflow Enhancements
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={autoFitOnRotate}
                onChange={(event) => setAutoFitOnRotate(event.target.checked)}
              />
            }
            label="Auto-fit image on rotate"
          />
          <FormControlLabel
            control={
              <Switch
                checked={autoPromoteTracking}
                onChange={(event) => setAutoPromoteTracking(event.target.checked)}
              />
            }
            label="Auto-promote frame measurements when tracking"
          />
          <FormControlLabel
            control={
              <Switch
                checked={guidelineCopilotEnabled}
                onChange={(event) => setGuidelineCopilotEnabled(event.target.checked)}
              />
            }
            label="Enable Guideline Copilot"
          />
        </CardContent>
      </Card>
    </Box>
  );
};

export default SettingsPage;
