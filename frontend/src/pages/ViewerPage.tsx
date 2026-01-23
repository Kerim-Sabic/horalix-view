/**
 * DICOM Viewer Page
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Skeleton,
  Slider,
  Snackbar,
  Switch,
  Tooltip,
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
  PanTool as PanIcon,
  Pause as PauseIcon,
  PlayArrow as PlayIcon,
  Psychology as AIIcon,
  RestartAlt as ResetIcon,
  RotateRight as RotateIcon,
  Settings as SettingsIcon,
  Straighten as MeasureIcon,
  Timeline as TimelineIcon,
  Link as LinkIcon,
  LinkOff as LinkOffIcon,
  ViewInAr as ThreeDIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  ZoomIn as ZoomIcon,
  ZoomOut as ZoomOutIcon,
} from '@mui/icons-material';
import {
  api,
  AIModel,
  Instance,
  Series,
  SeriesDetailResponse,
  Study,
  VolumeInfo,
  TrackMeasurementResponse,
} from '../services/api';
import { clampMaskSliceIndex, scaleDetectionBox } from '../utils/overlayMapping';

type FrameIndex = {
  instanceUid: string;
  frameIndex: number;
  rows: number | null;
  columns: number | null;
  instanceNumber: number | null;
  numberOfFrames: number;
};

type ViewportState = {
  zoom: number;
  pan: { x: number; y: number };
  windowLevel: { center: number; width: number };
  rotation: number;
  sliceIndex: number;
};

type Measurement = {
  id: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  lengthMm: number | null;
};

type DragState = {
  tool: 'pan' | 'zoom' | 'wwwl' | 'measure';
  startX: number;
  startY: number;
  startPan: { x: number; y: number };
  startZoom: number;
  startWindow: { center: number; width: number };
  measureStart?: { x: number; y: number };
  measureId?: string;
  measureFrameKey?: string;
  measureSeriesKey?: string;
  measureScope?: 'frame' | 'cine';
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const MAX_IMAGE_CACHE = 120;
const DEFAULT_CINE_FPS = 15;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.02;
const WHEEL_ZOOM_SPEED = 0.0008;
const DRAG_ZOOM_DENOMINATOR = 1200;

const rotatePoint = (x: number, y: number, angle: number) => {
  const normalized = ((angle % 360) + 360) % 360;
  switch (normalized) {
    case 0:
      return { x, y };
    case 90:
      return { x: y, y: -x };
    case 180:
      return { x: -x, y: -y };
    case 270:
      return { x: -y, y: x };
    default: {
      const radians = (normalized * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      return {
        x: x * cos - y * sin,
        y: x * sin + y * cos,
      };
    }
  }
};

const getAxisLabel = (vector: [number, number, number]) => {
  const abs = vector.map((v) => Math.abs(v));
  const maxIndex = abs.indexOf(Math.max(...abs));
  const value = vector[maxIndex];
  if (maxIndex === 0) return value >= 0 ? 'L' : 'R';
  if (maxIndex === 1) return value >= 0 ? 'P' : 'A';
  return value >= 0 ? 'H' : 'F';
};

const getOrientationMarkers = (orientation?: number[] | null) => {
  if (!orientation || orientation.length !== 6) return null;
  const row: [number, number, number] = [orientation[0], orientation[1], orientation[2]];
  const col: [number, number, number] = [orientation[3], orientation[4], orientation[5]];
  return {
    left: getAxisLabel([-row[0], -row[1], -row[2]]),
    right: getAxisLabel(row),
    top: getAxisLabel([-col[0], -col[1], -col[2]]),
    bottom: getAxisLabel(col),
  };
};

const defaultPreset = { name: 'Default', center: 40, width: 400 };

const modalityPresets: Record<string, Array<{ name: string; center: number; width: number }>> = {
  CT: [
    { name: 'Soft Tissue', center: 40, width: 400 },
    { name: 'Lung', center: -600, width: 1500 },
    { name: 'Bone', center: 300, width: 1500 },
    { name: 'Brain', center: 40, width: 80 },
  ],
  MR: [
    { name: 'Default', center: 40, width: 400 },
    { name: 'T1', center: 500, width: 1000 },
    { name: 'T2', center: 300, width: 1200 },
  ],
  XR: [{ name: 'Default', center: 1500, width: 3000 }],
  CR: [{ name: 'Default', center: 1500, width: 3000 }],
  DX: [{ name: 'Default', center: 1500, width: 3000 }],
  US: [{ name: 'Default', center: 40, width: 400 }],
  PT: [{ name: 'Default', center: 50, width: 350 }],
};

const defaultWindowLevel = { center: defaultPreset.center, width: defaultPreset.width };

const buildFrameIndex = (instances: Instance[]): FrameIndex[] => {
  const frames: FrameIndex[] = [];
  instances.forEach((instance) => {
    const count = Math.max(1, instance.number_of_frames ?? 1);
    for (let i = 0; i < count; i += 1) {
      frames.push({
        instanceUid: instance.sop_instance_uid,
        frameIndex: i,
        rows: instance.rows ?? null,
        columns: instance.columns ?? null,
        instanceNumber: instance.instance_number ?? null,
        numberOfFrames: count,
      });
    }
  });
  return frames;
};

const ViewerPage: React.FC = () => {
  const { studyUid } = useParams<{ studyUid: string }>();
  const navigate = useNavigate();
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);

  const seriesCacheRef = useRef(new Map<string, SeriesDetailResponse>());
  const instanceCacheRef = useRef(new Map<string, Instance>());
  const viewportStateRef = useRef(new Map<string, ViewportState>());
  const thumbnailCacheRef = useRef(new Map<string, string>());
  const activeSeriesUidRef = useRef<string | null>(null);
  const viewStateRef = useRef<ViewportState>({
    zoom: 1,
    pan: { x: 0, y: 0 },
    windowLevel: defaultWindowLevel,
    rotation: 0,
    sliceIndex: 0,
  });
  const imageCacheRef = useRef(new Map<string, HTMLImageElement>());
  const currentSliceRef = useRef(0);
  const frameIndexRef = useRef<FrameIndex[]>([]);
  const latestImageUrlRef = useRef<string | null>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  // Data state
  const [study, setStudy] = useState<Study | null>(null);
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<SeriesDetailResponse | null>(null);
  const [aiModels, setAIModels] = useState<AIModel[]>([]);
  const [aiResults, setAiResults] = useState<null | {
    study_uid: string;
    total_jobs: number;
    segmentations: Record<string, unknown>[];
    detections: Record<string, unknown>[];
    classifications: Record<string, unknown>[];
    pathology: Record<string, unknown>[];
    cardiac: Record<string, unknown>[];
    jobs: Array<{
      job_id: string;
      model_type: string;
      task_type: string;
      completed_at: string | null;
      inference_time_ms: number | null;
      results: Record<string, unknown> | null;
      result_files: Record<string, string> | null;
    }>;
  }>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Viewer state
  const [frameIndex, setFrameIndex] = useState<FrameIndex[]>([]);
  const [currentSlice, setCurrentSlice] = useState(0);
  const [totalSlices, setTotalSlices] = useState(1);
  const [windowLevel, setWindowLevel] = useState(defaultWindowLevel);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTool, setActiveTool] = useState<'pan' | 'zoom' | 'wwwl' | 'measure' | 'rotate'>('pan');
  const [showSeriesPanel, setShowSeriesPanel] = useState(true);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [showAiOverlay, setShowAiOverlay] = useState(true);
  const [aiMenuAnchor, setAIMenuAnchor] = useState<null | HTMLElement>(null);
  const [wlMenuAnchor, setWlMenuAnchor] = useState<null | HTMLElement>(null);
  const [seriesThumbnails, setSeriesThumbnails] = useState<Record<string, string>>({});
  const [currentInstanceMeta, setCurrentInstanceMeta] = useState<Instance | null>(null);
  const [activeMeasurement, setActiveMeasurement] = useState<Measurement | null>(null);
  const [measurementsByFrame, setMeasurementsByFrame] = useState<Record<string, Measurement[]>>(
    {}
  );
  const [measurementsBySeries, setMeasurementsBySeries] = useState<Record<string, Measurement[]>>(
    {}
  );
  const [measurementScope, setMeasurementScope] = useState<'frame' | 'cine'>('cine');
  const [measurementTracks, setMeasurementTracks] = useState<
    Record<string, TrackMeasurementResponse>
  >({});
  const [trackingMeasurementId, setTrackingMeasurementId] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // AI job state
  const [aiJobRunning, setAiJobRunning] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [displayedImageUrl, setDisplayedImageUrl] = useState<string | null>(null);
  const [cineFps, setCineFps] = useState(DEFAULT_CINE_FPS);
  const [patientStudies, setPatientStudies] = useState<Study[]>([]);
  const [patientStudiesLoading, setPatientStudiesLoading] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [volumeInfo, setVolumeInfo] = useState<VolumeInfo | null>(null);
  const [volumeLoading, setVolumeLoading] = useState(false);
  const [volumeError, setVolumeError] = useState<string | null>(null);
  const [volumeIndices, setVolumeIndices] = useState({
    axial: 0,
    coronal: 0,
    sagittal: 0,
  });
  const [viewerSettingsOpen, setViewerSettingsOpen] = useState(false);
  const [autoTrackCine, setAutoTrackCine] = useState(true);
  const [preferJpegForCine, setPreferJpegForCine] = useState(true);

  const currentFrame = frameIndex[currentSlice];
  const currentInstanceUid = currentFrame?.instanceUid;
  const currentFrameIndex = currentFrame?.frameIndex ?? 0;
  const patientLabel = study?.patient_name || study?.patient_id || 'Unknown';
  const studyLabel = study?.study_description || study?.study_date || '-';
  const seriesLabel =
    selectedSeries?.series.series_description ||
    `Series ${selectedSeries?.series.series_number ?? '-'}`;
  const seriesKey = selectedSeries?.series.series_instance_uid ?? null;
  const isUltrasound = selectedSeries?.series.modality === 'US';

  const imageDimensions = useMemo(() => {
    const rows = currentFrame?.rows ?? currentInstanceMeta?.rows ?? 512;
    const columns = currentFrame?.columns ?? currentInstanceMeta?.columns ?? 512;
    return {
      rows: rows || 512,
      columns: columns || 512,
    };
  }, [currentFrame, currentInstanceMeta]);

  const isColorImage = useMemo(() => {
    const photometric = currentInstanceMeta?.photometric_interpretation;
    if (!photometric) return false;
    return !photometric.toUpperCase().startsWith('MONOCHROME');
  }, [currentInstanceMeta?.photometric_interpretation]);

  const baseScale = useMemo(() => {
    if (!viewportSize.width || !viewportSize.height) return 1;
    return Math.min(
      viewportSize.width / imageDimensions.columns,
      viewportSize.height / imageDimensions.rows
    );
  }, [viewportSize, imageDimensions]);

  const scale = baseScale * zoom;

  const getPanBounds = useCallback(
    (scaleOverride?: number) => {
      const effectiveScale = scaleOverride ?? scale;
      const radians = (rotation * Math.PI) / 180;
      const cos = Math.abs(Math.cos(radians));
      const sin = Math.abs(Math.sin(radians));
      const bboxWidth =
        imageDimensions.columns * effectiveScale * cos +
        imageDimensions.rows * effectiveScale * sin;
      const bboxHeight =
        imageDimensions.columns * effectiveScale * sin +
        imageDimensions.rows * effectiveScale * cos;
      return {
        maxPanX: Math.max(0, (bboxWidth - viewportSize.width) / 2),
        maxPanY: Math.max(0, (bboxHeight - viewportSize.height) / 2),
      };
    },
    [imageDimensions, scale, viewportSize, rotation]
  );

  const clampPan = useCallback(
    (nextPan: { x: number; y: number }, scaleOverride?: number) => {
      const { maxPanX, maxPanY } = getPanBounds(scaleOverride);
      return {
        x: clamp(nextPan.x, -maxPanX, maxPanX),
        y: clamp(nextPan.y, -maxPanY, maxPanY),
      };
    },
    [getPanBounds]
  );

  const panBounds = useMemo(() => getPanBounds(), [getPanBounds]);
  const canPan =
    zoom > 1 &&
    viewportSize.width > 0 &&
    viewportSize.height > 0 &&
    (panBounds.maxPanX > 0 || panBounds.maxPanY > 0);

  const frameKey = useMemo(() => {
    if (!currentFrame?.instanceUid) return null;
    return `${currentFrame.instanceUid}:${currentFrame.frameIndex}`;
  }, [currentFrame]);

  const visibleMeasurements = useMemo(() => {
    const base =
      measurementScope === 'cine' && seriesKey
        ? measurementsBySeries[seriesKey] ?? []
        : frameKey
          ? measurementsByFrame[frameKey] ?? []
          : [];
    const withActive = activeMeasurement ? [...base, activeMeasurement] : base;
    return withActive.map((measurement) => {
      if (measurementScope !== 'cine') return measurement;
      const track = measurementTracks[measurement.id];
      if (!track) return measurement;
      const trackedFrame = track.frames.find((frame) => frame.frame_index === currentSlice);
      if (!trackedFrame) return measurement;
      return {
        ...measurement,
        start: trackedFrame.points[0],
        end: trackedFrame.points[1],
        lengthMm: trackedFrame.length_mm,
      };
    });
  }, [
    frameKey,
    seriesKey,
    measurementsByFrame,
    measurementsBySeries,
    activeMeasurement,
    measurementScope,
    measurementTracks,
    currentSlice,
  ]);

  const getWindowDefaults = useCallback((detail: SeriesDetailResponse) => {
    if (detail.window_center && detail.window_width) {
      return { center: detail.window_center, width: detail.window_width };
    }
    const presets = modalityPresets[detail.series.modality] || [defaultPreset];
    const preset = presets[0] || defaultPreset;
    return { center: preset.center, width: preset.width };
  }, []);

  const saveViewportState = useCallback(() => {
    const seriesUid = activeSeriesUidRef.current;
    if (!seriesUid) return;
    const state = viewStateRef.current;
    viewportStateRef.current.set(seriesUid, {
      zoom: state.zoom,
      pan: { ...state.pan },
      windowLevel: { ...state.windowLevel },
      rotation: state.rotation,
      sliceIndex: state.sliceIndex,
    });
  }, []);

  const applyViewportState = useCallback(
    (seriesUid: string, detail: SeriesDetailResponse, frames: FrameIndex[]) => {
      const saved = viewportStateRef.current.get(seriesUid);
      const defaultWl = getWindowDefaults(detail);
      setWindowLevel(saved?.windowLevel ?? defaultWl);
      setZoom(saved?.zoom ?? 1);
      setPan(saved?.pan ?? { x: 0, y: 0 });
      setRotation(saved?.rotation ?? 0);
      const safeSlice = Math.min(saved?.sliceIndex ?? 0, Math.max(0, frames.length - 1));
      setCurrentSlice(safeSlice);
    },
    [getWindowDefaults]
  );

  const refreshAiResults = useCallback(async () => {
    if (!studyUid) return;
    try {
      const result = await api.ai.getStudyResults(studyUid);
      setAiResults(result);
    } catch (err) {
      console.error('Failed to load AI results:', err);
    }
  }, [studyUid]);

  const selectSeries = useCallback(
    async (seriesUid: string) => {
      saveViewportState();
      activeSeriesUidRef.current = seriesUid;

      try {
        const cached = seriesCacheRef.current.get(seriesUid);
        const seriesDetail = cached || (await api.series.get(seriesUid));
        const safeInstances = Array.isArray(seriesDetail.instances) ? seriesDetail.instances : [];
        if (!Array.isArray(seriesDetail.instances)) {
          setSnackbarMessage('Series instances response invalid.');
        }
        const normalizedDetail = { ...seriesDetail, instances: safeInstances };
        seriesCacheRef.current.set(seriesUid, normalizedDetail);

        const frames = buildFrameIndex(normalizedDetail.instances);
        setSelectedSeries(normalizedDetail);
        setFrameIndex(frames);
        setTotalSlices(frames.length || 1);
        applyViewportState(seriesUid, normalizedDetail, frames);
        setImageError(null);
      } catch (err) {
        console.error('Failed to load series:', err);
        setSnackbarMessage('Failed to load series');
      }
    },
    [applyViewportState, saveViewportState]
  );

  // Fetch study and series data
  useEffect(() => {
    const fetchData = async () => {
      if (!studyUid) return;

      try {
        setLoading(true);
        setError(null);

        const [studyResult, seriesResult, modelsResult, aiResult] = await Promise.allSettled([
          api.studies.get(studyUid),
          api.series.list(studyUid),
          api.ai.getModels(),
          api.ai.getStudyResults(studyUid),
        ]);

        if (studyResult.status === 'fulfilled') {
          setStudy(studyResult.value);
        } else {
          throw new Error('Failed to load study');
        }

        if (seriesResult.status === 'fulfilled') {
          const safeSeries = Array.isArray(seriesResult.value.series) ? seriesResult.value.series : [];
          if (!Array.isArray(seriesResult.value.series)) {
            setSnackbarMessage('Series response invalid. Viewer may be limited.');
          }
          setSeriesList(safeSeries);
          if (safeSeries.length > 0) {
            await selectSeries(safeSeries[0].series_instance_uid);
          }
        }

        if (modelsResult.status === 'fulfilled') {
          if (modelsResult.value.shape_error) {
            setAIModels([]);
            setSnackbarMessage('AI models response invalid. AI tools disabled.');
          } else {
            setAIModels(modelsResult.value.models);
          }
        }

        if (aiResult.status === 'fulfilled') {
          setAiResults(aiResult.value);
        }
      } catch (err) {
        console.error('Failed to load viewer data:', err);
        setError('Failed to load study. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [studyUid, selectSeries]);

  // Track latest viewport state for cache persistence.
  useEffect(() => {
    viewStateRef.current = {
      zoom,
      pan,
      windowLevel,
      rotation,
      sliceIndex: currentSlice,
    };
  }, [zoom, pan, windowLevel, rotation, currentSlice]);

  useEffect(() => {
    if (!viewportSize.width || !viewportSize.height) return;
    const clamped = clampPan(pan);
    if (clamped.x !== pan.x || clamped.y !== pan.y) {
      setPan(clamped);
    }
  }, [pan, clampPan, viewportSize]);

  useEffect(() => {
    if (!canPan && (pan.x !== 0 || pan.y !== 0)) {
      setPan({ x: 0, y: 0 });
    }
  }, [canPan, pan]);

  useEffect(() => {
    currentSliceRef.current = currentSlice;
  }, [currentSlice]);

  useEffect(() => {
    frameIndexRef.current = frameIndex;
  }, [frameIndex]);

  // Persist viewport state for the active series.
  useEffect(() => {
    const seriesUid = activeSeriesUidRef.current;
    if (!seriesUid) return;
    const state = viewStateRef.current;
    viewportStateRef.current.set(seriesUid, {
      zoom: state.zoom,
      pan: { ...state.pan },
      windowLevel: { ...state.windowLevel },
      rotation: state.rotation,
      sliceIndex: state.sliceIndex,
    });
  }, [zoom, pan, windowLevel, rotation, currentSlice]);

  useEffect(() => {
    if (selectedSeries?.series.series_instance_uid) {
      activeSeriesUidRef.current = selectedSeries.series.series_instance_uid;
    }
  }, [selectedSeries?.series.series_instance_uid]);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    const storedAutoTrack = localStorage.getItem('viewer_auto_track_cine');
    if (storedAutoTrack !== null) {
      setAutoTrackCine(storedAutoTrack === 'true');
    }
    const storedPreferJpeg = localStorage.getItem('viewer_prefer_jpeg_cine');
    if (storedPreferJpeg !== null) {
      setPreferJpegForCine(storedPreferJpeg === 'true');
    }
  }, []);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('viewer_auto_track_cine', String(autoTrackCine));
  }, [autoTrackCine]);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('viewer_prefer_jpeg_cine', String(preferJpegForCine));
  }, [preferJpegForCine]);

  useEffect(() => {
    let active = true;
    if (!study?.patient_id) {
      setPatientStudies([]);
      return () => {
        active = false;
      };
    }

    setPatientStudiesLoading(true);
    api.studies
      .list({ patient_id: study.patient_id, page_size: 20 })
      .then((response) => {
        if (!active) return;
        const others = response.studies.filter(
          (item) => item.study_instance_uid !== study.study_instance_uid
        );
        setPatientStudies(others);
      })
      .catch((err) => {
        if (!active) return;
        console.warn('Failed to load patient studies', err);
        setPatientStudies([]);
      })
      .finally(() => {
        if (!active) return;
        setPatientStudiesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [study?.patient_id, study?.study_instance_uid]);

  // Load thumbnails for series list
  useEffect(() => {
    let active = true;
    const loadThumbnails = async () => {
      if (seriesList.length === 0) return;
      const updates: Record<string, string> = {};

      await Promise.allSettled(
        seriesList.map(async (series) => {
          if (thumbnailCacheRef.current.has(series.series_instance_uid)) {
            return;
          }
          try {
            const frames = await api.series.getFrames(series.series_instance_uid, 0, 1);
            const firstFrame = frames.frames?.[0];
            if (!firstFrame?.instance_uid) return;
            const url = api.instances.getThumbnailUrl(firstFrame.instance_uid, 96);
            thumbnailCacheRef.current.set(series.series_instance_uid, url);
            updates[series.series_instance_uid] = url;
          } catch (err) {
            console.warn('Failed to load series thumbnail', err);
          }
        })
      );

      if (active && Object.keys(updates).length > 0) {
        setSeriesThumbnails((prev) => ({ ...prev, ...updates }));
      }
    };

    loadThumbnails();

    return () => {
      active = false;
    };
  }, [seriesList]);

  // Viewport size observer
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setViewportSize({ width: rect.width, height: rect.height });
    };

    updateSize();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setViewportSize({ width, height });
    });

    observer.observe(element);
    window.addEventListener('resize', updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  // Fetch instance metadata
  useEffect(() => {
    let active = true;
    if (!currentInstanceUid) {
      setCurrentInstanceMeta(null);
      return undefined;
    }

    const cached = instanceCacheRef.current.get(currentInstanceUid);
    if (cached) {
      setCurrentInstanceMeta(cached);
      return undefined;
    }

    api.instances
      .get(currentInstanceUid)
      .then((instance) => {
        if (!active) return;
        instanceCacheRef.current.set(currentInstanceUid, instance);
        setCurrentInstanceMeta(instance);
      })
      .catch((err) => {
        console.error('Failed to load instance metadata:', err);
      });

    return () => {
      active = false;
    };
  }, [currentInstanceUid]);

  // Reset error when image changes
  useEffect(() => {
    setImageError(null);
    setActiveMeasurement(null);
  }, [currentInstanceUid, currentFrameIndex, windowLevel]);

  const renderFormat = useMemo(() => {
    if (isPlaying || isColorImage || (preferJpegForCine && isUltrasound)) return 'jpeg';
    return 'png';
  }, [isPlaying, isColorImage, preferJpegForCine, isUltrasound]);

  const renderQuality = useMemo(() => {
    if (!isPlaying) return 90;
    return isUltrasound ? 60 : 70;
  }, [isPlaying, isUltrasound]);

  const touchImageCache = useCallback((url: string, image: HTMLImageElement) => {
    const cache = imageCacheRef.current;
    if (cache.has(url)) {
      cache.delete(url);
    }
    cache.set(url, image);
    while (cache.size > MAX_IMAGE_CACHE) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cache.delete(oldest);
    }
  }, []);

  const preloadImage = useCallback(
    (url: string) => {
      if (!url) return;
      const cache = imageCacheRef.current;
      const existing = cache.get(url);
      if (existing) {
        touchImageCache(url, existing);
        return;
      }
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
      touchImageCache(url, image);
    },
    [touchImageCache]
  );

  // Cine playback
  useEffect(() => {
    if (!isPlaying || totalSlices <= 1 || !currentInstanceUid) return;
    let active = true;
    let lastTime = performance.now();
    const frameDuration = 1000 / Math.max(1, cineFps);

    const tick = (now: number) => {
      if (!active) return;
      const elapsed = now - lastTime;
      if (elapsed >= frameDuration) {
        lastTime = now - (elapsed % frameDuration);
        const nextSlice = (currentSliceRef.current + 1) % totalSlices;
        const frames = frameIndexRef.current;
        const nextFrame = frames[nextSlice];
        if (nextFrame) {
          const url = api.instances.getPixelDataUrl(nextFrame.instanceUid, {
            frame: nextFrame.frameIndex,
            windowCenter: viewStateRef.current.windowLevel.center,
            windowWidth: viewStateRef.current.windowLevel.width,
            format: renderFormat,
            quality: renderFormat === 'jpeg' ? renderQuality : undefined,
          });
          const cached = imageCacheRef.current.get(url);
          if (cached?.complete) {
            setCurrentSlice(nextSlice);
          } else {
            preloadImage(url);
          }
        }
      }
      requestAnimationFrame(tick);
    };

    const handle = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(handle);
    };
  }, [
    isPlaying,
    totalSlices,
    cineFps,
    currentInstanceUid,
    renderFormat,
    renderQuality,
    preloadImage,
  ]);

  const imageUrl = useMemo(() => {
    if (!currentInstanceUid) return null;
    return api.instances.getPixelDataUrl(currentInstanceUid, {
      frame: currentFrameIndex,
      windowCenter: windowLevel.center,
      windowWidth: windowLevel.width,
      format: renderFormat,
      quality: renderFormat === 'jpeg' ? renderQuality : undefined,
    });
  }, [
    currentInstanceUid,
    currentFrameIndex,
    windowLevel.center,
    windowLevel.width,
    renderFormat,
    renderQuality,
  ]);

  useEffect(() => {
    if (!imageUrl) {
      setDisplayedImageUrl(null);
      return;
    }

    let active = true;
    latestImageUrlRef.current = imageUrl;
    const cached = imageCacheRef.current.get(imageUrl);
    if (cached?.complete) {
      setDisplayedImageUrl(imageUrl);
      return;
    }

    const image = cached ?? new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (!active || latestImageUrlRef.current !== imageUrl) return;
      setDisplayedImageUrl(imageUrl);
    };
    image.onerror = () => {
      if (!active || latestImageUrlRef.current !== imageUrl) return;
      setImageError('Unable to render this image. Check transfer syntax support.');
    };
    if (!cached) {
      image.src = imageUrl;
      touchImageCache(imageUrl, image);
    }

    return () => {
      active = false;
    };
  }, [imageUrl, touchImageCache]);

  useEffect(() => {
    if (!currentInstanceUid || totalSlices <= 1) return;
    const ahead = isPlaying ? (isUltrasound ? 12 : 8) : isUltrasound ? 6 : 4;
    const behind = isPlaying ? 4 : 1;
    for (let offset = -behind; offset <= ahead; offset += 1) {
      if (offset === 0) continue;
      const rawIndex = currentSlice + offset;
      const nextIndex = isPlaying
        ? (rawIndex + totalSlices) % totalSlices
        : rawIndex < 0 || rawIndex >= totalSlices
          ? null
          : rawIndex;
      if (nextIndex === null) continue;
      const nextFrame = frameIndex[nextIndex];
      if (!nextFrame) continue;
      const url = api.instances.getPixelDataUrl(nextFrame.instanceUid, {
        frame: nextFrame.frameIndex,
        windowCenter: windowLevel.center,
        windowWidth: windowLevel.width,
        format: renderFormat,
        quality: renderFormat === 'jpeg' ? renderQuality : undefined,
      });
      preloadImage(url);
    }
  }, [
    currentSlice,
    totalSlices,
    frameIndex,
    windowLevel,
    currentInstanceUid,
    isPlaying,
    renderFormat,
    renderQuality,
    preloadImage,
    isUltrasound,
  ]);

  const screenToImage = useCallback(
    (clientX: number, clientY: number) => {
      const svg = overlayRef.current;
      if (svg && svg.getScreenCTM) {
        const ctm = svg.getScreenCTM();
        if (ctm) {
          if (typeof DOMPoint !== 'undefined') {
            const point = new DOMPoint(clientX, clientY);
            const transformed = point.matrixTransform(ctm.inverse());
            return { x: transformed.x, y: transformed.y };
          }
          if (svg.createSVGPoint) {
            const point = svg.createSVGPoint();
            point.x = clientX;
            point.y = clientY;
            const transformed = point.matrixTransform(ctm.inverse());
            return { x: transformed.x, y: transformed.y };
          }
        }
      }

      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const centerX = viewportSize.width / 2;
      const centerY = viewportSize.height / 2;
      const offsetX = x - (centerX + pan.x);
      const offsetY = y - (centerY + pan.y);
      const unscaledX = offsetX / scale;
      const unscaledY = offsetY / scale;
      const inverse = rotatePoint(unscaledX, unscaledY, -rotation);
      return {
        x: inverse.x + imageDimensions.columns / 2,
        y: inverse.y + imageDimensions.rows / 2,
      };
    },
    [viewportSize, pan, scale, rotation, imageDimensions]
  );

  const isPointInImage = useCallback(
    (clientX: number, clientY: number) => {
      const point = screenToImage(clientX, clientY);
      if (!point) return false;
      return (
        point.x >= 0 &&
        point.y >= 0 &&
        point.x <= imageDimensions.columns &&
        point.y <= imageDimensions.rows
      );
    },
    [screenToImage, imageDimensions]
  );

  const applyZoomAt = useCallback(
    (clientX: number, clientY: number, newZoom: number) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) {
        setZoom(newZoom);
        return;
      }
      const imagePoint = screenToImage(clientX, clientY);
      if (!imagePoint) {
        setZoom(newZoom);
        return;
      }

      const centerX = viewportSize.width / 2;
      const centerY = viewportSize.height / 2;
      const dx = imagePoint.x - imageDimensions.columns / 2;
      const dy = imagePoint.y - imageDimensions.rows / 2;
      const rotated = rotatePoint(dx, dy, rotation);
      const newScale = baseScale * newZoom;
      const screenX = clientX - rect.left;
      const screenY = clientY - rect.top;
      const nextPan = clampPan(
        {
          x: screenX - centerX - rotated.x * newScale,
          y: screenY - centerY - rotated.y * newScale,
        },
        newScale
      );
      setPan(nextPan);
      setZoom(newZoom);
    },
    [screenToImage, viewportSize, imageDimensions, rotation, baseScale, clampPan]
  );

  const getZoomAnchor = useCallback(() => {
    if (lastPointerRef.current) return lastPointerRef.current;
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, []);

  const handleZoomStep = useCallback(
    (direction: 'in' | 'out') => {
      const step = direction === 'in' ? ZOOM_STEP : -ZOOM_STEP;
      const nextZoom = clamp(zoom + step, MIN_ZOOM, MAX_ZOOM);
      const anchor = getZoomAnchor();
      if (!anchor) {
        setZoom(nextZoom);
        return;
      }
      applyZoomAt(anchor.x, anchor.y, nextZoom);
    },
    [zoom, getZoomAnchor, applyZoomAt]
  );

  const trackMeasurementFor = useCallback(
    async (seriesUid: string, measurement: Measurement, startIndex: number) => {
      if (!seriesUid) return;
      if (trackingMeasurementId) return;
      if (measurementTracks[measurement.id]) return;

      setTrackingMeasurementId(measurement.id);
      setSnackbarMessage('Tracking cine measurement...');
      try {
        const response = await api.series.trackMeasurement(seriesUid, {
          start_index: startIndex,
          track_full_loop: true,
          points: [measurement.start, measurement.end],
        });
        setMeasurementTracks((prev) => ({ ...prev, [measurement.id]: response }));
        if (response.summary.mean_mm != null) {
          setSnackbarMessage(
            `Cine measurement recorded. Mean ${response.summary.mean_mm.toFixed(1)} mm`
          );
        } else {
          setSnackbarMessage('Cine measurement recorded.');
        }
      } catch (err) {
        console.error('Failed to track cine measurement:', err);
        setSnackbarMessage('Failed to track cine measurement.');
      } finally {
        setTrackingMeasurementId(null);
      }
    },
    [trackingMeasurementId, measurementTracks]
  );

  const handleMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0 || !currentInstanceUid) return;
    event.preventDefault();
    event.stopPropagation();
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    if (isPlaying) {
      setIsPlaying(false);
    }
    if (activeTool === 'rotate') {
      setRotation((prev) => (prev + 90) % 360);
      return;
    }

    const dragTool = activeTool as DragState['tool'];
    if (dragTool === 'pan' && !canPan) {
      return;
    }
    if (
      (dragTool === 'pan' || dragTool === 'zoom' || dragTool === 'wwwl' || dragTool === 'measure') &&
      !isPointInImage(event.clientX, event.clientY)
    ) {
      return;
    }
    if (dragTool === 'measure') {
      if (measurementScope === 'frame' && !frameKey) return;
      if (measurementScope === 'cine' && !seriesKey) return;
    }
    dragStateRef.current = {
      tool: dragTool,
      startX: event.clientX,
      startY: event.clientY,
      startPan: { ...pan },
      startZoom: zoom,
      startWindow: { ...windowLevel },
    };
    setIsDragging(true);

    if (dragTool === 'measure') {
      const point = screenToImage(event.clientX, event.clientY);
      if (!point) return;
      const id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const start = {
        x: clamp(point.x, 0, imageDimensions.columns),
        y: clamp(point.y, 0, imageDimensions.rows),
      };
      dragStateRef.current.measureStart = start;
      dragStateRef.current.measureId = id;
      dragStateRef.current.measureFrameKey = frameKey || undefined;
      dragStateRef.current.measureSeriesKey = seriesKey || undefined;
      dragStateRef.current.measureScope = measurementScope;
      setActiveMeasurement({ id, start, end: start, lengthMm: 0 });
    }
  };

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      const dx = event.clientX - dragState.startX;
      const dy = event.clientY - dragState.startY;

      if (dragState.tool === 'pan') {
        if (!canPan) return;
        setPan(
          clampPan({
            x: dragState.startPan.x + dx,
            y: dragState.startPan.y + dy,
          })
        );
      }

      if (dragState.tool === 'zoom') {
        const zoomFactor = clamp(
          dragState.startZoom * Math.exp(-dy / DRAG_ZOOM_DENOMINATOR),
          MIN_ZOOM,
          MAX_ZOOM
        );
        applyZoomAt(dragState.startX, dragState.startY, zoomFactor);
      }

      if (dragState.tool === 'wwwl') {
        const newWidth = clamp(dragState.startWindow.width + dx, 1, 5000);
        const newCenter = dragState.startWindow.center + -dy;
        setWindowLevel({ center: newCenter, width: newWidth });
      }

      if (dragState.tool === 'measure' && dragState.measureStart) {
        const point = screenToImage(event.clientX, event.clientY);
        if (!point) return;
        const end = {
          x: clamp(point.x, 0, imageDimensions.columns),
          y: clamp(point.y, 0, imageDimensions.rows),
        };
        const spacing = currentInstanceMeta?.pixel_spacing ?? [1, 1];
        const dxMm = (end.x - dragState.measureStart.x) * spacing[1];
        const dyMm = (end.y - dragState.measureStart.y) * spacing[0];
        const lengthMm = Math.sqrt(dxMm * dxMm + dyMm * dyMm);
        setActiveMeasurement((prev) => {
          if (!prev) {
            return {
              id: dragState.measureId || `${Date.now()}`,
              start: dragState.measureStart!,
              end,
              lengthMm,
            };
          }
          return { ...prev, end, lengthMm };
        });
      }
    },
    [imageDimensions, screenToImage, currentInstanceMeta, clampPan, applyZoomAt, canPan, isPointInImage]
  );

  const handleMouseUp = useCallback(() => {
    const dragState = dragStateRef.current;
    if (dragState?.tool === 'measure' && activeMeasurement) {
      const measurement = activeMeasurement;
      if (dragState.measureScope === 'cine' && dragState.measureSeriesKey) {
        const key = dragState.measureSeriesKey;
        setMeasurementsBySeries((prev) => {
          const existing = prev[key] ?? [];
          return { ...prev, [key]: [...existing, measurement] };
        });
      } else if (dragState.measureFrameKey) {
        const key = dragState.measureFrameKey;
        setMeasurementsByFrame((prev) => {
          const existing = prev[key] ?? [];
          return { ...prev, [key]: [...existing, measurement] };
        });
      }
      setActiveMeasurement(null);
      if (
        dragState.measureScope === 'cine' &&
        dragState.measureSeriesKey &&
        autoTrackCine
      ) {
        trackMeasurementFor(
          dragState.measureSeriesKey,
          measurement,
          currentSliceRef.current
        );
      }
    }
    dragStateRef.current = null;
    setIsDragging(false);
  }, [activeMeasurement, autoTrackCine, trackMeasurementFor]);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const handleWheel = (event: React.WheelEvent) => {
    if (!currentInstanceUid) return;
    const shouldZoom = event.ctrlKey || activeTool === 'zoom' || totalSlices <= 1;
    if (shouldZoom) {
      if (!isPointInImage(event.clientX, event.clientY)) {
        return;
      }
      event.preventDefault();
      const delta = Math.sign(event.deltaY) * Math.min(200, Math.abs(event.deltaY));
      const factor = Math.exp(-delta * WHEEL_ZOOM_SPEED);
      const nextZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
      applyZoomAt(event.clientX, event.clientY, nextZoom);
      return;
    }

    event.preventDefault();
    if (isPlaying) {
      setIsPlaying(false);
    }
    const direction = event.deltaY > 0 ? 1 : -1;
    setCurrentSlice((prev) => clamp(prev + direction, 0, totalSlices - 1));
  };

  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
    if (selectedSeries) {
      setWindowLevel(getWindowDefaults(selectedSeries));
    }
  };

  const handleFullscreen = async () => {
    try {
      if (typeof document === 'undefined') return;
      const root = document.documentElement;
      if (!root.requestFullscreen) {
        setSnackbarMessage('Fullscreen is not supported in this browser.');
        return;
      }
      await root.requestFullscreen();
    } catch (err) {
      console.error('Failed to enter fullscreen:', err);
      setSnackbarMessage('Unable to enter fullscreen.');
    }
  };

  const openVolumeViewer = useCallback(async () => {
    if (!seriesKey) {
      setSnackbarMessage('Please select a series first');
      return;
    }
    setVolumeOpen(true);
    setVolumeLoading(true);
    setVolumeError(null);
    setVolumeInfo(null);
    try {
      const info = await api.series.getVolumeInfo(seriesKey);
      setVolumeInfo(info);
      setVolumeIndices({
        axial: Math.floor(info.dimensions.z / 2),
        coronal: Math.floor(info.dimensions.y / 2),
        sagittal: Math.floor(info.dimensions.x / 2),
      });
    } catch (err) {
      console.error('Failed to load volume info:', err);
      setVolumeError('Failed to load 3D volume data.');
    } finally {
      setVolumeLoading(false);
    }
  }, [seriesKey]);

  const closeVolumeViewer = () => {
    setVolumeOpen(false);
  };

  const getMprUrl = useCallback(
    (plane: 'axial' | 'coronal' | 'sagittal', index: number) => {
      if (!seriesKey) return '';
      return api.series.getMprUrl(seriesKey, {
        plane,
        index,
        windowCenter: windowLevel.center,
        windowWidth: windowLevel.width,
        format: 'png',
      });
    },
    [seriesKey, windowLevel.center, windowLevel.width]
  );

  const handleRunAIModel = async (model: AIModel) => {
    if (!studyUid || !selectedSeries) {
      setSnackbarMessage('Please select a series first');
      return;
    }

    const taskType = (model.details?.model_type || '').toLowerCase();
    const supportedTasks = ['segmentation', 'detection', 'classification', 'enhancement', 'pathology', 'cardiac'];
    if (!supportedTasks.includes(taskType)) {
      setSnackbarMessage('AI model has an unsupported task type');
      return;
    }

    try {
      setAiJobRunning(true);
      setAIMenuAnchor(null);

        const job = await api.ai.createJob({
          model_type: model.name,
          task_type: taskType,
          study_uid: studyUid,
          series_uid: selectedSeries.series.series_instance_uid,
        });

      setSnackbarMessage(`AI job started: ${model.name}`);

      const completedJob = await api.ai.waitForJob(job.job_id, 2000, 300000);

      if (completedJob.status === 'completed') {
        setSnackbarMessage(`AI analysis complete: ${model.name}`);
        await refreshAiResults();
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

  const latestCineMeasurement = useMemo(() => {
    if (!seriesKey) return null;
    const list = measurementsBySeries[seriesKey] ?? [];
    return list.length ? list[list.length - 1] : null;
  }, [seriesKey, measurementsBySeries]);

  const latestCineSummary = useMemo(() => {
    if (!latestCineMeasurement) return null;
    const track = measurementTracks[latestCineMeasurement.id];
    if (!track || !track.summary) return null;
    return track.summary;
  }, [latestCineMeasurement, measurementTracks]);

  const latestPathologyJob = useMemo(() => {
    if (!aiResults?.jobs?.length) return null;
    const jobs = aiResults.jobs.filter((job) => job.task_type === 'pathology');
    if (jobs.length === 0) return null;
    const sorted = [...jobs].sort((a, b) => {
      const aTime = a.completed_at ? Date.parse(a.completed_at) : 0;
      const bTime = b.completed_at ? Date.parse(b.completed_at) : 0;
      return aTime - bTime;
    });
    return sorted[sorted.length - 1];
  }, [aiResults]);

  const handleTrackMeasurement = useCallback(async () => {
    if (!seriesKey) {
      setSnackbarMessage('Please select a series first');
      return;
    }
    if (measurementScope !== 'cine') {
      setSnackbarMessage('Switch to cine measurements to track the full loop.');
      return;
    }
    const measurement = latestCineMeasurement;
    if (!measurement) {
      setSnackbarMessage('Draw a measurement first.');
      return;
    }
    await trackMeasurementFor(seriesKey, measurement, currentSlice);
  }, [seriesKey, measurementScope, latestCineMeasurement, currentSlice, trackMeasurementFor]);

  const orientationMarkers = getOrientationMarkers(currentInstanceMeta?.image_orientation_patient);

  const detectionOverlays = useMemo(() => {
    if (!aiResults || !selectedSeries) return [];
    const overlays: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
      label: string;
    }> = [];

    aiResults.detections.forEach((result) => {
      if (!result || typeof result !== 'object') return;
      const resultAny = result as Record<string, unknown>;
      const seriesUid = typeof resultAny.series_uid === 'string' ? resultAny.series_uid : null;
      if (seriesUid && seriesUid !== selectedSeries.series.series_instance_uid) return;
      const sliceIndex = typeof resultAny.slice_index === 'number' ? resultAny.slice_index : null;
      if (sliceIndex !== null && sliceIndex !== currentSlice) return;
      const inputShape = Array.isArray(resultAny.input_shape) ? resultAny.input_shape : null;
      const detections = Array.isArray(resultAny.detections) ? resultAny.detections : [];
      const safeInputShape =
        inputShape && inputShape.length >= 2
          ? ([inputShape[0], inputShape[1]] as [number, number])
          : ([imageDimensions.rows, imageDimensions.columns] as [number, number]);

      detections.forEach((det) => {
        if (!det || typeof det !== 'object') return;
        const detAny = det as Record<string, unknown>;
        if (
          typeof detAny.x !== 'number' ||
          typeof detAny.y !== 'number' ||
          typeof detAny.width !== 'number' ||
          typeof detAny.height !== 'number'
        ) {
          return;
        }
        const label =
          typeof detAny.class_name === 'string'
            ? detAny.class_name
            : `Class ${detAny.class_id ?? ''}`;
        const scaled = scaleDetectionBox(
          {
            x: detAny.x,
            y: detAny.y,
            width: detAny.width,
            height: detAny.height,
          },
          safeInputShape,
          [imageDimensions.rows, imageDimensions.columns]
        );
        overlays.push({ ...scaled, label });
      });
    });

    return overlays;
  }, [aiResults, selectedSeries, currentSlice, imageDimensions]);

  const segmentationOverlays = useMemo(() => {
    if (!aiResults || !studyUid || !selectedSeries) return [] as Array<{ id: string; url: string }>;
    const overlays: Array<{ id: string; url: string }> = [];

    aiResults.jobs.forEach((job) => {
      if (job.task_type !== 'segmentation') return;
      const results = job.results || {};
      const seriesUid = typeof results.series_uid === 'string' ? results.series_uid : null;
      if (seriesUid && seriesUid !== selectedSeries.series.series_instance_uid) return;
      const maskPath = job.result_files?.mask || (typeof results.mask === 'string' ? results.mask : null);
      if (!maskPath) return;
      const filename = maskPath.split('/').pop();
      if (!filename) return;
      const maskShape = Array.isArray(results.mask_shape) ? results.mask_shape : null;
      const sliceIndex = clampMaskSliceIndex(currentSlice, maskShape);
      overlays.push({
        id: job.job_id,
        url: api.ai.getMaskOverlayUrl(studyUid, filename, sliceIndex),
      });
    });

    return overlays;
  }, [aiResults, studyUid, selectedSeries, currentSlice]);

  const cursor = useMemo(() => {
    if (isDragging) return 'grabbing';
    switch (activeTool) {
      case 'pan':
        return canPan ? 'grab' : 'default';
      case 'zoom':
        return 'zoom-in';
      case 'wwwl':
        return 'crosshair';
      case 'measure':
        return 'crosshair';
      case 'rotate':
        return 'pointer';
      default:
        return 'default';
    }
  }, [activeTool, isDragging, canPan]);

  const tools = [
    { id: 'pan', label: 'Pan', icon: <PanIcon /> },
    { id: 'zoom', label: 'Zoom', icon: <ZoomIcon /> },
    { id: 'wwwl', label: 'Window/Level', icon: <ContrastIcon /> },
    { id: 'measure', label: 'Measure', icon: <MeasureIcon /> },
    { id: 'rotate', label: 'Rotate', icon: <RotateIcon /> },
  ] as const;

  if (loading) {
    return (
      <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: '#000' }}>
        <Paper sx={{ px: 2, py: 1, borderRadius: 0 }} elevation={0}>
          <Skeleton variant="rectangular" width="100%" height={48} />
        </Paper>

        <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <Paper sx={{ width: 250, borderRadius: 0, p: 2 }} elevation={0}>
            <Skeleton variant="text" width="60%" height={24} sx={{ mb: 2 }} />
            <Skeleton variant="rectangular" width="100%" height={80} sx={{ mb: 1 }} />
            <Skeleton variant="rectangular" width="100%" height={80} sx={{ mb: 1 }} />
            <Skeleton variant="rectangular" width="100%" height={80} />
          </Paper>

          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#000' }}>
            <Skeleton variant="rectangular" width="60%" height="60%" sx={{ bgcolor: 'grey.900' }} />
          </Box>
        </Box>

        <Paper sx={{ px: 2, py: 1, borderRadius: 0 }} elevation={0}>
          <Skeleton variant="rectangular" width="100%" height={40} />
        </Paper>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => navigate('/studies')}>
              Back to Studies
            </Button>
          }
        >
          {error}
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: '#000' }}>
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

        {tools.map((tool) => (
          <Tooltip key={tool.id} title={tool.label}>
            <IconButton
              onClick={() => {
                if (tool.id === 'rotate') {
                  setRotation((prev) => (prev + 90) % 360);
                }
                setActiveTool(tool.id);
              }}
              color={activeTool === tool.id ? 'primary' : 'default'}
              aria-label={tool.label}
            >
              {tool.icon}
            </IconButton>
          </Tooltip>
        ))}

        <Tooltip title={`Measurements: ${measurementScope === 'cine' ? 'Cine' : 'Frame'}`}>
          <span>
            <IconButton
              onClick={() =>
                setMeasurementScope((prev) => (prev === 'cine' ? 'frame' : 'cine'))
              }
              color={measurementScope === 'cine' ? 'primary' : 'default'}
              aria-label="Toggle measurement scope"
              disabled={activeTool !== 'measure'}
            >
              {measurementScope === 'cine' ? <LinkIcon /> : <LinkOffIcon />}
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title="Record cine measurement">
          <span>
            <IconButton
              onClick={handleTrackMeasurement}
              disabled={
                activeTool !== 'measure' ||
                measurementScope !== 'cine' ||
                !latestCineMeasurement ||
                !!trackingMeasurementId
              }
              aria-label="Record cine measurement"
            >
              {trackingMeasurementId ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                <TimelineIcon />
              )}
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title="Zoom In">
          <IconButton onClick={() => handleZoomStep('in')}>
            <ZoomIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Zoom Out">
          <IconButton onClick={() => handleZoomStep('out')}>
            <ZoomOutIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title="Reset View">
          <IconButton onClick={handleResetView}>
            <ResetIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title="Window/Level Presets">
          <IconButton onClick={(event) => setWlMenuAnchor(event.currentTarget)}>
            <ContrastIcon />
          </IconButton>
        </Tooltip>

        <Menu anchorEl={wlMenuAnchor} open={Boolean(wlMenuAnchor)} onClose={() => setWlMenuAnchor(null)}>
          {(modalityPresets[selectedSeries?.series.modality || ''] || [defaultPreset]).map((preset) => (
            <MenuItem
              key={preset.name}
              onClick={() => {
                setWindowLevel({ center: preset.center, width: preset.width });
                setWlMenuAnchor(null);
              }}
            >
              {preset.name} (W {preset.width} / L {preset.center})
            </MenuItem>
          ))}
          <Divider />
          <MenuItem
            onClick={() => {
              if (selectedSeries) {
                setWindowLevel(getWindowDefaults(selectedSeries));
              }
              setWlMenuAnchor(null);
            }}
          >
            Reset to Series Default
          </MenuItem>
        </Menu>

        <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

        <Tooltip title="3D Volume">
          <span>
            <IconButton onClick={openVolumeViewer} disabled={!selectedSeries?.has_3d_data}>
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
          <IconButton onClick={() => setShowSeriesPanel((prev) => !prev)}>
            <LayersIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Info Panel">
          <IconButton onClick={() => setShowInfoPanel((prev) => !prev)}>
            <InfoIcon />
          </IconButton>
        </Tooltip>

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

        <Tooltip title={showAiOverlay ? 'Hide AI overlay' : 'Show AI overlay'}>
          <span>
            <IconButton onClick={() => setShowAiOverlay((prev) => !prev)} disabled={!aiResults}>
              {showAiOverlay ? <VisibilityIcon /> : <VisibilityOffIcon />}
            </IconButton>
          </span>
        </Tooltip>

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
        <Menu anchorEl={aiMenuAnchor} open={Boolean(aiMenuAnchor)} onClose={() => setAIMenuAnchor(null)}>
          {aiModels.length === 0 ? (
            <MenuItem disabled>No AI models available</MenuItem>
          ) : (
            aiModels.map((model) => (
              <MenuItem
                key={model.name}
                onClick={() => handleRunAIModel(model)}
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

        <Tooltip title="Export">
          <IconButton>
            <ExportIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Fullscreen">
          <IconButton onClick={handleFullscreen}>
            <FullscreenIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Settings">
          <IconButton onClick={() => setViewerSettingsOpen(true)}>
            <SettingsIcon />
          </IconButton>
        </Tooltip>
      </Paper>

      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {showSeriesPanel && (
          <Paper sx={{ width: 260, borderRadius: 0, overflow: 'auto' }} elevation={0}>
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
                seriesList.map((s) => {
                  const thumbnail = seriesThumbnails[s.series_instance_uid];
                  return (
                    <ListItem key={s.series_instance_uid} disablePadding>
                      <ListItemButton
                        selected={selectedSeries?.series.series_instance_uid === s.series_instance_uid}
                        onClick={() => selectSeries(s.series_instance_uid)}
                      >
                        <Box
                          sx={{
                            width: 60,
                            height: 60,
                            bgcolor: 'grey.900',
                            borderRadius: 1,
                            mr: 1,
                            overflow: 'hidden',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {thumbnail ? (
                            <img
                              src={thumbnail}
                              alt={`${s.series_description || 'Series'} thumbnail`}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            <Typography variant="caption" color="grey.500">
                              {s.modality}
                            </Typography>
                          )}
                        </Box>
                        <ListItemText
                          primary={s.series_description || `Series ${s.series_number || '-'}`}
                          secondary={`${s.num_instances} images`}
                          primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                          secondaryTypographyProps={{ variant: 'caption' }}
                        />
                      </ListItemButton>
                    </ListItem>
                  );
                })
              )}
            </List>
          </Paper>
        )}

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
          onMouseMove={(event) => {
            lastPointerRef.current = { x: event.clientX, y: event.clientY };
          }}
          onWheel={handleWheel}
          onDoubleClick={() => {
            handleResetView();
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {currentInstanceUid ? (
            <Box sx={{ position: 'absolute', inset: 0 }}>
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
                <img
                  src={displayedImageUrl || imageUrl || ''}
                  alt={`Slice ${currentSlice + 1}`}
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'block',
                    userSelect: 'none',
                    pointerEvents: 'none',
                  }}
                  draggable={false}
                  onDragStart={(event) => event.preventDefault()}
                  onError={() => setImageError('Unable to render this image. Check transfer syntax support.')}
                />
                <svg
                  ref={overlayRef}
                  width="100%"
                  height="100%"
                  viewBox={`0 0 ${imageDimensions.columns} ${imageDimensions.rows}`}
                  style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
                >
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

                  {visibleMeasurements.map((measurement) => (
                    <g key={measurement.id}>
                      <line
                        x1={measurement.start.x}
                        y1={measurement.start.y}
                        x2={measurement.end.x}
                        y2={measurement.end.y}
                        stroke="#3b82f6"
                        strokeWidth={2}
                      />
                      <circle cx={measurement.start.x} cy={measurement.start.y} r={4} fill="#3b82f6" />
                      <circle cx={measurement.end.x} cy={measurement.end.y} r={4} fill="#3b82f6" />
                      {measurement.lengthMm !== null && (
                        <text
                          x={(measurement.start.x + measurement.end.x) / 2}
                          y={(measurement.start.y + measurement.end.y) / 2 - 6}
                          fill="#3b82f6"
                          fontSize={12}
                          fontFamily="monospace"
                        >
                          {measurement.lengthMm.toFixed(1)} mm
                        </text>
                      )}
                    </g>
                  ))}
                </svg>
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
            {selectedSeries?.series.slice_thickness && (
              <div>Slice Thickness: {selectedSeries.series.slice_thickness} mm</div>
            )}
          </Box>

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

        {showInfoPanel && (
          <Paper sx={{ width: 280, borderRadius: 0, overflow: 'auto' }} elevation={0}>
            <Box sx={{ p: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Study Information
              </Typography>
              <Typography variant="body2">Patient: {patientLabel}</Typography>
              <Typography variant="body2">Patient ID: {study?.patient_id || '-'}</Typography>
              <Typography variant="body2">Study Date: {study?.study_date || '-'}</Typography>
              <Typography variant="body2">Accession: {study?.accession_number || '-'}</Typography>

              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Other Studies For Patient
              </Typography>
              {patientStudiesLoading ? (
                <Typography variant="body2" color="text.secondary">
                  Loading patient studies...
                </Typography>
              ) : patientStudies.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No other studies found.
                </Typography>
              ) : (
                <List dense disablePadding>
                  {patientStudies.map((patientStudy) => (
                    <ListItem key={patientStudy.study_instance_uid} disablePadding>
                      <ListItemButton
                        onClick={() => navigate(`/viewer/${patientStudy.study_instance_uid}`)}
                      >
                        <ListItemText
                          primary={patientStudy.study_description || patientStudy.study_instance_uid}
                          secondary={patientStudy.study_date || '-'}
                          primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                          secondaryTypographyProps={{ variant: 'caption' }}
                        />
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
              )}

              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Cine Measurement Summary
              </Typography>
              {latestCineSummary ? (
                <>
                  <Typography variant="body2">
                    Mean: {latestCineSummary.mean_mm?.toFixed(1) ?? '-'} mm
                  </Typography>
                  <Typography variant="body2">
                    Min: {latestCineSummary.min_mm?.toFixed(1) ?? '-'} mm
                  </Typography>
                  <Typography variant="body2">
                    Max: {latestCineSummary.max_mm?.toFixed(1) ?? '-'} mm
                  </Typography>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No tracked cine measurement.
                </Typography>
              )}

              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Pathology AI
              </Typography>
              {latestPathologyJob ? (
                <>
                  <Typography variant="body2">
                    Model: {latestPathologyJob.model_type || '-'}
                  </Typography>
                  <Typography variant="body2">
                    Status: {latestPathologyJob.completed_at ? 'Completed' : 'Pending'}
                  </Typography>
                  {latestPathologyJob.results &&
                    typeof latestPathologyJob.results === 'object' &&
                    typeof (latestPathologyJob.results as Record<string, any>).output === 'object' && (
                      <Typography variant="body2">
                        Tiles: {(latestPathologyJob.results as Record<string, any>).output
                          ?.tile_count ?? '-'}
                      </Typography>
                    )}
                  {latestPathologyJob.result_files &&
                    Object.keys(latestPathologyJob.result_files).length > 0 && (
                      <Typography variant="body2" color="text.secondary">
                        Results saved under /app/results/{study?.study_instance_uid || studyUid || '-'}
                      </Typography>
                    )}
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No pathology results yet.
                </Typography>
              )}

              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Series Information
              </Typography>
              <Typography variant="body2">
                Modality: {selectedSeries?.series.modality || '-'}
              </Typography>
              <Typography variant="body2">
                Description: {selectedSeries?.series.series_description || '-'}
              </Typography>
              <Typography variant="body2">
                Instances: {selectedSeries?.series.num_instances ?? '-'}
              </Typography>

              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Instance Information
              </Typography>
              <Typography variant="body2">SOP UID: {currentInstanceUid || '-'}</Typography>
              <Typography variant="body2">
                Instance #: {currentFrame?.instanceNumber ?? '-'}
              </Typography>
              <Typography variant="body2">
                Dimensions: {imageDimensions.columns} x {imageDimensions.rows}
              </Typography>
              <Typography variant="body2">
                Pixel Spacing:{' '}
                {currentInstanceMeta?.pixel_spacing
                  ? `${currentInstanceMeta.pixel_spacing[0]} x ${currentInstanceMeta.pixel_spacing[1]} mm`
                  : '-'}
              </Typography>
              <Typography variant="body2">Frames: {currentFrame?.numberOfFrames ?? 1}</Typography>
            </Box>
          </Paper>
        )}
      </Box>

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

        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 140, mr: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
            FPS
          </Typography>
          <Slider
            value={cineFps}
            onChange={(_, value) => setCineFps(value as number)}
            min={5}
            max={30}
            step={1}
            size="small"
            sx={{ width: 90 }}
            disabled={totalSlices <= 1}
          />
        </Box>

        <Typography variant="body2" sx={{ mx: 2, minWidth: 80 }}>
          {currentSlice + 1} / {totalSlices}
        </Typography>

        <Slider
          value={currentSlice}
          onChange={(_, value) => {
            if (isPlaying) {
              setIsPlaying(false);
            }
            setCurrentSlice(value as number);
          }}
          min={0}
          max={Math.max(0, totalSlices - 1)}
          sx={{ flex: 1, mx: 2 }}
          disabled={totalSlices <= 1}
        />

        <Chip label={selectedSeries?.series.modality || '-'} size="small" sx={{ mr: 1 }} />
        <Chip
          label={`Zoom ${Math.round(zoom * 100)}%`}
          size="small"
          variant="outlined"
          sx={{ mr: 1 }}
        />
        <Chip
          label={`${imageDimensions.columns} x ${imageDimensions.rows}`}
          size="small"
          variant="outlined"
        />
      </Paper>

      <Dialog open={volumeOpen} onClose={closeVolumeViewer} maxWidth="lg" fullWidth>
        <DialogTitle>3D Volume: {seriesLabel}</DialogTitle>
        <DialogContent dividers>
          {volumeLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress />
            </Box>
          ) : volumeError ? (
            <Alert severity="error">{volumeError}</Alert>
          ) : volumeInfo ? (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 2,
              }}
            >
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Axial
                </Typography>
                <Box
                  sx={{
                    bgcolor: '#000',
                    borderRadius: 1,
                    overflow: 'hidden',
                    display: 'flex',
                    justifyContent: 'center',
                  }}
                >
                  <img
                    src={getMprUrl('axial', volumeIndices.axial)}
                    alt="Axial MPR"
                    style={{ width: '100%', height: 'auto', display: 'block' }}
                  />
                </Box>
                <Slider
                  value={volumeIndices.axial}
                  onChange={(_, value) =>
                    setVolumeIndices((prev) => ({ ...prev, axial: value as number }))
                  }
                  min={0}
                  max={Math.max(0, volumeInfo.dimensions.z - 1)}
                  size="small"
                />
              </Box>

              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Coronal
                </Typography>
                <Box
                  sx={{
                    bgcolor: '#000',
                    borderRadius: 1,
                    overflow: 'hidden',
                    display: 'flex',
                    justifyContent: 'center',
                  }}
                >
                  <img
                    src={getMprUrl('coronal', volumeIndices.coronal)}
                    alt="Coronal MPR"
                    style={{ width: '100%', height: 'auto', display: 'block' }}
                  />
                </Box>
                <Slider
                  value={volumeIndices.coronal}
                  onChange={(_, value) =>
                    setVolumeIndices((prev) => ({ ...prev, coronal: value as number }))
                  }
                  min={0}
                  max={Math.max(0, volumeInfo.dimensions.y - 1)}
                  size="small"
                />
              </Box>

              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Sagittal
                </Typography>
                <Box
                  sx={{
                    bgcolor: '#000',
                    borderRadius: 1,
                    overflow: 'hidden',
                    display: 'flex',
                    justifyContent: 'center',
                  }}
                >
                  <img
                    src={getMprUrl('sagittal', volumeIndices.sagittal)}
                    alt="Sagittal MPR"
                    style={{ width: '100%', height: 'auto', display: 'block' }}
                  />
                </Box>
                <Slider
                  value={volumeIndices.sagittal}
                  onChange={(_, value) =>
                    setVolumeIndices((prev) => ({ ...prev, sagittal: value as number }))
                  }
                  min={0}
                  max={Math.max(0, volumeInfo.dimensions.x - 1)}
                  size="small"
                />
              </Box>
            </Box>
          ) : (
            <Typography color="text.secondary">No volume data available.</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeVolumeViewer}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={viewerSettingsOpen}
        onClose={() => setViewerSettingsOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Viewer Settings</DialogTitle>
        <DialogContent dividers>
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
            label="Prefer JPEG for ultrasound cine (faster playback)"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewerSettingsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

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
