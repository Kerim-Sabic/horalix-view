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
  FormControl,
  FormControlLabel,
  FormHelperText,
  IconButton,
  InputLabel,
  LinearProgress,
  Stack,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Slider,
  Snackbar,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  ArrowBack as BackIcon,
  Contrast as ContrastIcon,
  Download as ExportIcon,
  Fullscreen as FullscreenIcon,
  GridView as GridIcon,
  InfoOutlined as InfoIcon,
  Layers as LayersIcon,
  Pause as PauseIcon,
  PlayArrow as PlayIcon,
  Psychology as AIIcon,
  RestartAlt as ResetIcon,
  Settings as SettingsIcon,
  Timeline as TimelineIcon,
  Link as LinkIcon,
  LinkOff as LinkOffIcon,
  ViewInAr as ThreeDIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  ZoomIn as ZoomIcon,
  ZoomOut as ZoomOutIcon,
  Favorite as FavoriteIcon,
  BookmarkAdd as BookmarkAddIcon,
  ViewModule as SmartLayoutIcon,
} from '@mui/icons-material';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import {
  api,
  AIModel,
  Instance,
  Patient,
  PatientUpdateRequest,
  Series,
  SeriesDetailResponse,
  SeriesUpdateRequest,
  Study,
  StudyUpdateRequest,
  VolumeInfo,
  InteractiveSegmentationResponse,
} from '../services/api';

// Extracted ViewerPage modules
import type {
  ViewportState,
  MetadataDraft,
  DragState,
  SegmentPromptPoint,
  InteractiveSegmentationResult,
  CineBookmark,
} from './viewerPage.types';
import {
  MAX_IMAGE_CACHE,
  DEFAULT_CINE_FPS,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_STEP,
  WHEEL_ZOOM_SPEED,
  DRAG_ZOOM_DENOMINATOR,
  WHEEL_SCROLL_THRESHOLD,
  WHEEL_MAX_SLICE_STEP,
  PREVIEW_SMOOTHING,
  AI_JOB_POLL_INTERVAL_MS,
  AI_JOB_TIMEOUT_MS,
  defaultPreset,
  defaultWindowLevel,
  modalityPresets,
} from './viewerPage.constants';
import {
  resolveInstanceUidFromFrameKey,
  getCopilotTemplateKey,
  getApiErrorDetail,
  getPathologyTileCount,
  rotatePoint,
  getOrientationMarkers,
  buildMprVolumeInfo,
} from './viewerPage.helpers';

// New modular viewer components
import { MeasurementPanel } from '../features/viewer/components/MeasurementPanel';
import { AIResultsPanel, type PatientContext } from '../features/viewer/components/AIResultsPanel';
import { MPRLayout } from '../features/viewer/components/MPR/MPRLayout';
import { buildFrameIndex, type FrameIndex } from '../features/viewer/app/cine/frameIndex';
import { preloadImage as preloadCachedImage, touchImageCache as touchCachedImage } from '../features/viewer/app/cine/imageCache';
import { startCinePlayback } from '../features/viewer/app/cine/playback';
import {
  buildCardiacOverlays,
  buildDetectionOverlays,
  buildInteractiveSegmentationOverlays,
  buildSegmentationOverlays,
  collectOverlayTargets,
  type OverlayTarget,
} from '../features/viewer/app/overlays/buildOverlays';
import { buildLegacyMeasurementMaps } from '../features/viewer/app/measurements/legacyMaps';
import {
  type LegacyLineMeasurement,
  type LegacyPolygonMeasurement,
} from '../features/viewer/app/measurements/legacyTypes';
import {
  applyMeasurementSelection,
  cancelMeasurementEdit,
  clearMeasurementSelection,
  resolveToolShortcut,
  startMeasurementEdit,
} from '../features/viewer/app/measurements/editingTransitions';
import { hitTestHandle, hitTestMeasurement } from '../features/viewer/app/measurements/hitTesting';
import { createMeasureDragStart, updateMeasureDrag, type MeasureDragState } from '../features/viewer/app/measurements/dragging';
import {
  buildEditedStoreUpdate,
  computeEditMovement,
  getEditCleanupState,
  recomputeLegacyLineLengths,
  recomputeLegacyPolygonMetrics,
} from '../features/viewer/app/measurements/editFinalize';
import { finalizeMeasureDrag } from '../features/viewer/app/measurements/finalize';
import { buildEditedPoints, type MeasurementEditState } from '../features/viewer/app/measurements/interaction';
import { buildBodyEditState, buildHandleEditState } from '../features/viewer/app/measurements/selection';
import { buildLineRenderModels, buildPolygonRenderModels } from '../features/viewer/app/measurements/renderModels';
import { buildTrackingMaps, type LineTrackResponse, type PolygonTrackResponse } from '../features/viewer/app/measurements/trackingMaps';
import {
  createMeasurementInstanceResolver,
  filterMeasurementsForInstance,
} from '../features/viewer/app/measurements/measurementSelectors';
import {
  interpolateTrackFrame,
  smoothLineTracks,
  smoothPolygonTracks,
} from '../features/viewer/app/tracking/trackSmoothing';
import { COPILOT_TEMPLATES, type CopilotRequirement } from '../features/viewer/domain/copilot';
import { clamp, lerp } from '../features/viewer/domain/math';
import { HORALIX_MEASUREMENT_OPTIONS } from '../features/viewer/domain/measurementOptions';
import type { ViewerToolId } from '../features/viewer/domain/tools';
import { inferEchoView, labelHasKeyword, normalizeLabel, normalizeText, parseOptionalNumber } from '../features/viewer/domain/text';
import { normalizeTrackingPoints, resampleClosedPolygon } from '../features/viewer/domain/tracking';
import { getFrameImageUrl as buildFrameImageUrl, getFrameUrlForIndex, type RenderOptions } from '../features/viewer/infra/dicom/frameUrls';
import { prefetchAdjacentFrames, prefetchFullSeries, prefetchWarmFrames } from '../features/viewer/infra/dicom/prefetch';
import { useMeasurementStore } from '../features/viewer/hooks/useMeasurementStore';
import { useMPRStore } from '../features/viewer/hooks/useMPRStore';
import { VIEWER_TOOL_CONFIGS } from '../features/viewer/ui/tools/toolConfig';
import type {
  LineMeasurement as NewLineMeasurement,
  PolygonMeasurement as NewPolygonMeasurement,
  Point2D,
} from '../features/viewer/types';
import { isLineMeasurement, isPolygonMeasurement, smoothPolygon } from '../features/viewer/types';
import { calculatePolygonAreaMm2, calculatePerimeterMm } from '../features/viewer/services/geometryService';
import { MEASUREMENT_COLORS } from '../features/viewer/constants';
import {
  downloadFile,
  generateCSVExport,
  type ExportFormat,
} from '../features/viewer/services/exportService';

const ViewerPage: React.FC = () => {
  const theme = useTheme();
  const { studyUid: studyUidParam } = useParams<{ studyUid: string }>();
  const studyUid = studyUidParam ?? null;
  const patientContextKey = useMemo(
    () => (studyUid ? `horalix_patient_context_${studyUid}` : null),
    [studyUid]
  );
  const navigate = useNavigate();
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);

  const seriesCacheRef = useRef(new Map<string, SeriesDetailResponse>());
  const instanceCacheRef = useRef(new Map<string, Instance>());
  const viewportStateRef = useRef(new Map<string, ViewportState>());
  const thumbnailCacheRef = useRef(new Map<string, string>());
  const prefetchedSeriesRef = useRef(new Set<string>());
  const prefetchedFullSeriesRef = useRef(new Set<string>());
  const fullPrefetchTokenRef = useRef(0);
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
  const wheelAccumulatorRef = useRef(0);
  const lastWheelTimeRef = useRef(0);
  const frameRenderStatsRef = useRef({ count: 0, totalMs: 0, lastLog: 0 });
  const cinePerfRef = useRef({ frames: 0, slowFrames: 0, lastLog: 0 });

  // Data state
  const [study, setStudy] = useState<Study | null>(null);
  const [patientDetails, setPatientDetails] = useState<Patient | null>(null);
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<SeriesDetailResponse | null>(null);
  const [aiModels, setAIModels] = useState<AIModel[]>([]);
  const [patientContextOverride, setPatientContextOverride] = useState<PatientContext | null>(null);
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
  const [activeTool, setActiveTool] = useState<ViewerToolId>('pointer');
  const [showSeriesPanel, setShowSeriesPanel] = useState(true);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [showMeasurementPanel, setShowMeasurementPanel] = useState(false);
  const [showAiResultsPanel, setShowAiResultsPanel] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState<null | HTMLElement>(null);

  useEffect(() => {
    if (!patientContextKey) return;
    const raw = localStorage.getItem(patientContextKey);
    if (!raw) {
      setPatientContextOverride(null);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as PatientContext;
      setPatientContextOverride(parsed);
    } catch {
      setPatientContextOverride(null);
    }
  }, [patientContextKey]);

  const persistPatientContext = useCallback(
    (context: PatientContext | null) => {
      if (!patientContextKey) return;
      if (context) {
        localStorage.setItem(patientContextKey, JSON.stringify(context));
      } else {
        localStorage.removeItem(patientContextKey);
      }
    },
    [patientContextKey]
  );
  const [showAiOverlay, setShowAiOverlay] = useState(false);
  const [showMeasurementOverlay, setShowMeasurementOverlay] = useState(true);
  const [showContourOverlay, setShowContourOverlay] = useState(true);
  const [aiMenuAnchor, setAIMenuAnchor] = useState<null | HTMLElement>(null);
  const [wlMenuAnchor, setWlMenuAnchor] = useState<null | HTMLElement>(null);
  const [seriesThumbnails, setSeriesThumbnails] = useState<Record<string, string>>({});
  const [smartHangDetails, setSmartHangDetails] = useState<Record<string, SeriesDetailResponse>>({});
  const [currentInstanceMeta, setCurrentInstanceMeta] = useState<Instance | null>(null);
  const [activeInstanceUid, setActiveInstanceUid] = useState<string | null>(null);
  const [instanceMenuAnchor, setInstanceMenuAnchor] = useState<null | HTMLElement>(null);
  const [activeMeasurement, setActiveMeasurement] = useState<LegacyLineMeasurement | null>(null);
  const [layoutMode, setLayoutMode] = useState<'single' | 'mpr' | 'smart'>('single');
  const [polygonPreviewPoint, setPolygonPreviewPoint] = useState<Point2D | null>(null);
  const [smoothContoursEnabled, setSmoothContoursEnabled] = useState(true);
  const [smoothContoursIterations, setSmoothContoursIterations] = useState(1);
  const [smoothTrackingEnabled, setSmoothTrackingEnabled] = useState(true);
  const [smoothTrackingWindow, setSmoothTrackingWindow] = useState(2);
  const [showTrackingTrails, setShowTrackingTrails] = useState(true);
  const [trackingTrailLength, setTrackingTrailLength] = useState(3);
  const [autoFitOnRotate, setAutoFitOnRotate] = useState(true);
  const [autoPromoteTracking, setAutoPromoteTracking] = useState(true);
  const [guidelineCopilotEnabled, setGuidelineCopilotEnabled] = useState(true);
  const [copilotShowPhases, setCopilotShowPhases] = useState(false);
  const [segmentPromptPoints, setSegmentPromptPoints] = useState<SegmentPromptPoint[]>([]);
  const [segmentContourPoints, setSegmentContourPoints] = useState(64);
  const [segmentPointMode, setSegmentPointMode] = useState<0 | 1>(1);
  const [segmentAutoRun, setSegmentAutoRun] = useState(true);
  const [segmentAutoSeed, setSegmentAutoSeed] = useState(true);
  const [segmentAutoPointCount, setSegmentAutoPointCount] = useState(5);
  const [segmentAutoPointRadius, setSegmentAutoPointRadius] = useState(10);
  const [segmentAutoNegativePoints, setSegmentAutoNegativePoints] = useState(true);
  const [segmentAutoBox, setSegmentAutoBox] = useState(true);
  const [segmentAutoBoxScale, setSegmentAutoBoxScale] = useState(0.35);
  const [segmentRunning, setSegmentRunning] = useState(false);
  const [lastSegmentContour, setLastSegmentContour] = useState<Point2D[] | null>(null);
  const [lastSegmentMeasurementId, setLastSegmentMeasurementId] = useState<string | null>(null);
  const [polygonSamplingPreset, setPolygonSamplingPreset] = useState<'sparse' | 'balanced' | 'dense'>('balanced');
  const [medsamPreloading, setMedsamPreloading] = useState(false);
  const [interactiveSegmentations, setInteractiveSegmentations] = useState<InteractiveSegmentationResult[]>([]);
  const [measurementsModelDialogOpen, setMeasurementsModelDialogOpen] = useState(false);
  const [measurementsModelSelection, setMeasurementsModelSelection] = useState('lvid');
  const [pendingAiModel, setPendingAiModel] = useState<AIModel | null>(null);
  // Polygon drawing state
  const [activePolygon, setActivePolygon] = useState<LegacyPolygonMeasurement | null>(null);
  const activePolygonRef = useRef<LegacyPolygonMeasurement | null>(null);
  const freehandPolygonRef = useRef<{ active: boolean; lastPoint: Point2D | null }>({
    active: false,
    lastPoint: null,
  });
  const [polygonsByFrame, setPolygonsByFrame] = useState<Record<string, LegacyPolygonMeasurement[]>>({});
  const [polygonsBySeries, setPolygonsBySeries] = useState<Record<string, LegacyPolygonMeasurement[]>>({});
  const [selectedMeasurementIdLocal, setSelectedMeasurementIdLocal] = useState<string | null>(null);
  // Editing state for pointer tool - tracks dragging of measurement points
  const [editingMeasurement, setEditingMeasurement] = useState<MeasurementEditState | null>(null);
  const [measurementsByFrame, setMeasurementsByFrame] = useState<Record<string, LegacyLineMeasurement[]>>(
    {}
  );
  const [measurementsBySeries, setMeasurementsBySeries] = useState<Record<string, LegacyLineMeasurement[]>>(
    {}
  );
  const [measurementScope, setMeasurementScope] = useState<'frame' | 'cine'>(() => {
    if (typeof localStorage === 'undefined') return 'cine';
    const storedScope = localStorage.getItem('viewer_measurement_scope');
    return storedScope === 'frame' ? 'frame' : 'cine';
  });
  const [measurementTracks, setMeasurementTracks] = useState<Record<string, LineTrackResponse>>({});
  const [polygonTracks, setPolygonTracks] = useState<Record<string, PolygonTrackResponse>>({});
  const [trackingMeasurementId, setTrackingMeasurementId] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // AI job state
  const [aiJobRunning, setAiJobRunning] = useState(false);
  const [aiJobProgress, setAiJobProgress] = useState<number | null>(null);
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [displayedImageUrl, setDisplayedImageUrl] = useState<string | null>(null);
  const [cineFps, setCineFps] = useState(DEFAULT_CINE_FPS);
  const [cineBookmarks, setCineBookmarks] = useState<CineBookmark[]>([]);
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
  const [metadataDialogOpen, setMetadataDialogOpen] = useState(false);
  const [metadataDraft, setMetadataDraft] = useState<MetadataDraft | null>(null);
  const [metadataSaving, setMetadataSaving] = useState(false);

  // Label edit dialog state
  const [labelEditDialogOpen, setLabelEditDialogOpen] = useState(false);
  const [labelEditMeasurementId, setLabelEditMeasurementId] = useState<string | null>(null);
  const [labelEditValue, setLabelEditValue] = useState('');

  // EF Calculator dialog state
  const [efCalculatorOpen, setEfCalculatorOpen] = useState(false);

  useEffect(() => {
    activePolygonRef.current = activePolygon;
  }, [activePolygon]);

  useEffect(() => {
    if (activeTool !== 'polygon') {
      freehandPolygonRef.current.active = false;
      freehandPolygonRef.current.lastPoint = null;
    }
  }, [activeTool]);

  const freehandPointSpacing = useMemo(() => {
    if (polygonSamplingPreset === 'dense') return 3;
    if (polygonSamplingPreset === 'sparse') return 10;
    return 6;
  }, [polygonSamplingPreset]);
  const [efEdvMeasurementId, setEfEdvMeasurementId] = useState<string | null>(null);
  const [efEsvMeasurementId, setEfEsvMeasurementId] = useState<string | null>(null);

  // New measurement store integration
  const measurementStore = useMeasurementStore();
  const setMprVolumeInfo = useMPRStore((state) => state.setVolumeInfo);
  const clearMprVolume = useMPRStore((state) => state.clearVolume);
  const newMeasurements = measurementStore.measurements;
  const selectedMeasurementId = measurementStore.selectedMeasurementId;

  const currentFrame = frameIndex[currentSlice];
  const currentInstanceUid = currentFrame?.instanceUid;
  const currentFrameIndex = currentFrame?.frameIndex ?? 0;
  const patientLabel =
    patientDetails?.patient_name || study?.patient_name || study?.patient_id || 'Unknown';
  const studyLabel = study?.study_description || study?.study_date || '-';
  const seriesLabel =
    selectedSeries?.series.series_description ||
    `Series ${selectedSeries?.series.series_number ?? '-'}`;
  const seriesKey = selectedSeries?.series.series_instance_uid ?? null;
  const isUltrasound = selectedSeries?.series.modality === 'US';
  const has3dData =
    !!selectedSeries?.has_3d_data &&
    (selectedSeries?.series.num_instances ?? 0) > 1;
  const seriesInstances = useMemo(() => selectedSeries?.instances ?? [], [selectedSeries]);
  const shouldGroupByInstance = useMemo(() => {
    if (has3dData) return false;
    if (isUltrasound && seriesInstances.length > 1) return true;
    return seriesInstances.some((instance) => (instance.number_of_frames ?? 1) > 1);
  }, [has3dData, isUltrasound, seriesInstances]);
  const cineGrouping: 'instance' | 'series' = shouldGroupByInstance ? 'instance' : 'series';
  const activeInstance = useMemo(() => {
    if (!activeInstanceUid) return null;
    return (
      seriesInstances.find((instance) => instance.sop_instance_uid === activeInstanceUid) ?? null
    );
  }, [seriesInstances, activeInstanceUid]);
  const activeInstanceIndex = useMemo(() => {
    if (cineGrouping !== 'instance') return -1;
    if (!activeInstanceUid || seriesInstances.length === 0) return -1;
    return seriesInstances.findIndex(
      (instance) => instance.sop_instance_uid === activeInstanceUid
    );
  }, [seriesInstances, activeInstanceUid, cineGrouping]);
  const instanceLabelByUid = useMemo(() => {
    if (cineGrouping !== 'instance') return {};
    const map: Record<string, string> = {};
    seriesInstances.forEach((instance, index) => {
      const base = `Cine ${index + 1}`;
      const suffix = instance.instance_number != null ? ` (#${instance.instance_number})` : '';
      map[instance.sop_instance_uid] = `${base}${suffix}`;
    });
    return map;
  }, [seriesInstances, cineGrouping]);
  const activeInstanceFrameCount = useMemo(() => {
    const fromSeries = activeInstance?.number_of_frames ?? null;
    const fromMeta = currentInstanceMeta?.number_of_frames ?? null;
    const fallback = frameIndex.length || 1;
    const candidate = fromSeries ?? fromMeta ?? fallback;
    return Math.max(1, candidate ?? 1);
  }, [activeInstance, currentInstanceMeta, frameIndex.length]);
  const canUseCineMeasurements =
    cineGrouping === 'instance' ? activeInstanceFrameCount > 1 : totalSlices > 1;
  const effectiveMeasurementScope = useMemo<'frame' | 'cine'>(
    () => (canUseCineMeasurements ? measurementScope : 'frame'),
    [canUseCineMeasurements, measurementScope]
  );
  const medsamModel = useMemo(() => aiModels.find((model) => model.name === 'medsam'), [aiModels]);
  const medsamStatus = medsamModel?.status ?? 'unknown';
  const medsamStatusLabel = useMemo(() => {
    switch (medsamStatus) {
      case 'loaded':
        return 'Ready';
      case 'available':
        return 'Not loaded';
      case 'missing_weights':
        return 'Missing weights';
      case 'disabled':
        return 'Disabled';
      default:
        return 'Unknown';
    }
  }, [medsamStatus]);
  const medsamStatusColor: 'default' | 'success' | 'warning' | 'error' = useMemo(() => {
    switch (medsamStatus) {
      case 'loaded':
        return 'success';
      case 'available':
        return 'warning';
      case 'missing_weights':
        return 'error';
      default:
        return 'default';
    }
  }, [medsamStatus]);
  const formatAiModelLabel = useCallback((name: string) => {
    if (name === 'horalix_ai') return 'Horalix AI Echo';
    if (!name.startsWith('horalix_ai_')) return name;
    const suffix = name.replace('horalix_ai_', '').replace(/_/g, ' ');
    const label = suffix.replace(/\b\w/g, (char) => char.toUpperCase());
    return `Horalix AI - ${label}`;
  }, []);
  const getSeriesViewLabel = useCallback((series: Series) => {
    if (series.modality !== 'US') return null;
    const text = `${series.series_description ?? ''} ${series.protocol_name ?? ''} ${
      series.body_part_examined ?? ''
    }`;
    return inferEchoView(text);
  }, []);
  const selectedSeriesViewLabel = useMemo(
    () => (selectedSeries ? getSeriesViewLabel(selectedSeries.series) : null),
    [selectedSeries, getSeriesViewLabel]
  );
  const getCineGrouping = useCallback(
    (instances: Instance[], series?: Series | null, has3d?: boolean) => {
      if (has3d) return 'series';
      const isUs = series?.modality === 'US';
      if (isUs && instances.length > 1) return 'instance';
      return instances.some((instance) => (instance.number_of_frames ?? 1) > 1)
        ? 'instance'
        : 'series';
    },
    []
  );
  const buildFramesForSelection = useCallback(
    (instances: Instance[], instanceUid: string | null, grouping?: 'instance' | 'series') => {
      if (instances.length === 0) return [];
      const mode = grouping ?? 'series';
      if (mode === 'instance' && instanceUid) {
        const selected = instances.find(
          (instance) => instance.sop_instance_uid === instanceUid
        );
        if (selected) {
          return buildFrameIndex([selected]);
        }
      }
      return buildFrameIndex(instances);
    },
    []
  );

  const smartHangSeries = useMemo(() => {
    if (seriesList.length === 0) return [];
    const modality = selectedSeries?.series.modality ?? seriesList[0]?.modality;
    const candidates = seriesList.filter((series) => series.modality === modality);
    const pool = candidates.length > 0 ? candidates : seriesList;

    const descriptionFor = (series: Series) =>
      `${series.series_description ?? ''} ${series.protocol_name ?? ''} ${series.body_part_examined ?? ''}`.toLowerCase();

    const priorityGroups: string[][] =
      modality === 'US'
        ? [
            ['a4c', 'apical 4', 'apical four'],
            ['a2c', 'apical 2', 'apical two'],
            ['plax', 'parasternal long'],
            ['psax', 'parasternal short'],
            ['lvot', 'lv outflow'],
            ['rv', 'right ventricle'],
            ['doppler'],
          ]
        : [
            ['axial'],
            ['coronal'],
            ['sagittal'],
            ['mpr'],
            ['localizer'],
          ];

    const scored = pool.map((series) => {
      const text = descriptionFor(series);
      let score = 0;
      priorityGroups.forEach((group, index) => {
        if (group.some((keyword) => text.includes(keyword))) {
          score += (priorityGroups.length - index) * 10;
        }
      });
      if (series.series_number != null) {
        score += Math.max(0, 10 - series.series_number);
      }
      return { series, score };
    });

    scored.sort((a, b) => b.score - a.score);

    const ordered: Series[] = [];
    const selectedUid = selectedSeries?.series.series_instance_uid;
    if (selectedUid) {
      const selected = pool.find((series) => series.series_instance_uid === selectedUid);
      if (selected) ordered.push(selected);
    }
    for (const item of scored) {
      if (ordered.length >= 4) break;
      if (ordered.some((series) => series.series_instance_uid === item.series.series_instance_uid)) {
        continue;
      }
      ordered.push(item.series);
    }

    return ordered.slice(0, 4);
  }, [seriesList, selectedSeries]);

  const cineSeriesList = useMemo(() => {
    if (seriesList.length === 0) return [];
    return seriesList.filter((series) => {
      if (series.modality !== 'US') return false;
      if ((series.num_instances ?? 0) > 1) return true;
      const cached = seriesCacheRef.current.get(series.series_instance_uid);
      if (cached?.instances?.some((instance) => (instance.number_of_frames ?? 1) > 1)) {
        return true;
      }
      const text = `${series.series_description ?? ''} ${series.protocol_name ?? ''}`.toLowerCase();
      return text.includes('cine') || text.includes('loop');
    });
  }, [seriesList]);

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
    const appliedRotation = autoFitOnRotate ? rotation : 0;
    const radians = (appliedRotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const rotatedWidth =
      imageDimensions.columns * cos + imageDimensions.rows * sin;
    const rotatedHeight =
      imageDimensions.columns * sin + imageDimensions.rows * cos;
    return Math.min(
      viewportSize.width / rotatedWidth,
      viewportSize.height / rotatedHeight
    );
  }, [viewportSize, imageDimensions, rotation, autoFitOnRotate]);

  const scale = baseScale * zoom;

  // Frame key for measurement association
  const currentFrameKey = useMemo(() => {
    if (!currentInstanceUid) return null;
    return `${currentInstanceUid}:${currentFrameIndex}`;
  }, [currentInstanceUid, currentFrameIndex]);

  // Get measurements for current series from new store
  const newStoreMeasurements = useMemo(() => {
    void newMeasurements;
    if (!seriesKey) return [];
    return measurementStore.getMeasurementsForSeries(seriesKey);
  }, [seriesKey, measurementStore, newMeasurements]);
  const resolveMeasurementInstanceUid = useMemo(
    () =>
      createMeasurementInstanceResolver(
        measurementStore.getMeasurement,
        resolveInstanceUidFromFrameKey,
      ),
    [measurementStore],
  );
  const contextMeasurements = useMemo(() => {
    if (!seriesKey) return [];
    return filterMeasurementsForInstance(
      newStoreMeasurements,
      activeInstanceUid,
      cineGrouping,
      resolveMeasurementInstanceUid,
    );
  }, [
    seriesKey,
    activeInstanceUid,
    cineGrouping,
    newStoreMeasurements,
    resolveMeasurementInstanceUid,
  ]);

  const displayMeasurementTracks = useMemo(() => {
    if (!smoothTrackingEnabled || smoothTrackingWindow <= 0) return measurementTracks;
    return smoothLineTracks(measurementTracks, smoothTrackingWindow);
  }, [measurementTracks, smoothTrackingEnabled, smoothTrackingWindow]);

  const displayPolygonTracks = useMemo(() => {
    if (!smoothTrackingEnabled || smoothTrackingWindow <= 0) return polygonTracks;
    return smoothPolygonTracks(polygonTracks, smoothTrackingWindow);
  }, [polygonTracks, smoothTrackingEnabled, smoothTrackingWindow]);

  useEffect(() => {
    if (editingMeasurement || activeMeasurement || activePolygon) return;
    const allMeasurements = Array.from(measurementStore.measurements.values()).sort(
      (a, b) => a.createdAt - b.createdAt,
    );
    const {
      measurementsByFrame: nextMeasurementsByFrame,
      measurementsBySeries: nextMeasurementsBySeries,
      polygonsByFrame: nextPolygonsByFrame,
      polygonsBySeries: nextPolygonsBySeries,
    } = buildLegacyMeasurementMaps(allMeasurements);

    setMeasurementsByFrame(nextMeasurementsByFrame);
    setMeasurementsBySeries(nextMeasurementsBySeries);
    setPolygonsByFrame(nextPolygonsByFrame);
    setPolygonsBySeries(nextPolygonsBySeries);
  }, [measurementStore, newMeasurements, editingMeasurement, activeMeasurement, activePolygon]);

  useEffect(() => {
    if (!seriesKey || cineGrouping !== 'instance') return;
    const pendingUpdates: Array<{ id: string; instanceUid: string }> = [];
    for (const measurement of measurementStore.measurements.values()) {
      if (measurement.seriesUid !== seriesKey) continue;
      if (measurement.instanceUid) continue;
      const trackingInstanceUid =
        'trackingData' in measurement && measurement.trackingData
          ? measurement.trackingData.instanceUid
          : null;
      const inferred =
        trackingInstanceUid ?? resolveInstanceUidFromFrameKey(measurement.frameKey);
      if (inferred) {
        pendingUpdates.push({ id: measurement.id, instanceUid: inferred });
      }
    }
    if (pendingUpdates.length === 0) return;
    pendingUpdates.forEach((update) => {
      measurementStore.updateMeasurement(update.id, { instanceUid: update.instanceUid });
    });
  }, [cineGrouping, seriesKey, measurementStore, newMeasurements]);

  useEffect(() => {
    const { lineTracks, polygonTracks } = buildTrackingMaps(
      measurementStore.trackingData,
      measurementStore.measurements,
    );
    setMeasurementTracks(lineTracks);
    setPolygonTracks(polygonTracks);
  }, [measurementStore.trackingData, measurementStore.measurements]);

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
      // Allow generous panning even when not zoomed in (use viewport size as limit)
      const effectiveMaxX = Math.max(maxPanX, viewportSize.width / 2);
      const effectiveMaxY = Math.max(maxPanY, viewportSize.height / 2);
      return {
        x: clamp(nextPan.x, -effectiveMaxX, effectiveMaxX),
        y: clamp(nextPan.y, -effectiveMaxY, effectiveMaxY),
      };
    },
    [getPanBounds, viewportSize]
  );

  // Pan is always available when viewport is ready
  const canPan = viewportSize.width > 0 && viewportSize.height > 0;

  useEffect(() => {
    if (!canPan) return;
    setPan((prev) => clampPan(prev));
  }, [canPan, clampPan, rotation, zoom, viewportSize.width, viewportSize.height]);

  useEffect(() => {
    if (!autoFitOnRotate) return;
    setPan((prev) => (prev.x === 0 && prev.y === 0 ? prev : { x: 0, y: 0 }));
  }, [rotation, autoFitOnRotate]);

  const frameKey = useMemo(() => {
    if (!currentFrame?.instanceUid) return null;
    return `${currentFrame.instanceUid}:${currentFrame.frameIndex}`;
  }, [currentFrame]);

  const visibleMeasurements = useMemo(() => {
    void newMeasurements;
    const base =
      effectiveMeasurementScope === 'cine' && seriesKey
        ? measurementsBySeries[seriesKey] ?? []
        : frameKey
          ? measurementsByFrame[frameKey] ?? []
          : [];
    const instanceFiltered =
      effectiveMeasurementScope === 'cine' && cineGrouping === 'instance' && activeInstanceUid
        ? base.filter((measurement) => {
            const instanceUid = resolveMeasurementInstanceUid(measurement);
            return instanceUid ? instanceUid === activeInstanceUid : false;
          })
        : base;
    const withActive = activeMeasurement ? [...instanceFiltered, activeMeasurement] : instanceFiltered;

    // Filter out hidden measurements (check visibility in new store)
    const filtered = withActive.filter((measurement) => {
      // Active measurement is always visible
      if (activeMeasurement && measurement.id === activeMeasurement.id) return true;
      // Check visibility in new store
      const storeMeasurement = measurementStore.getMeasurement(measurement.id);
      return storeMeasurement ? storeMeasurement.visible : false;
    });

    return filtered.map((measurement) => {
      if (effectiveMeasurementScope !== 'cine') return measurement;
      const track = displayMeasurementTracks[measurement.id];
      if (!track) return measurement;
      const trackedFrame = interpolateTrackFrame(track.frames, currentSlice);
      if (!trackedFrame) return measurement;
      return {
        ...measurement,
        start: trackedFrame.points[0],
        end: trackedFrame.points[1],
        lengthMm: trackedFrame.length_mm ?? null,
      };
    });
  }, [
    frameKey,
    seriesKey,
    measurementsByFrame,
    measurementsBySeries,
    activeMeasurement,
    effectiveMeasurementScope,
    activeInstanceUid,
    cineGrouping,
    displayMeasurementTracks,
    currentSlice,
    measurementStore,
    newMeasurements, // Include this to re-compute when visibility changes
    resolveMeasurementInstanceUid,
  ]);

  // Compute visible polygons based on scope
  const visiblePolygons = useMemo(() => {
    void newMeasurements;
    const base =
      effectiveMeasurementScope === 'cine' && seriesKey
        ? polygonsBySeries[seriesKey] ?? []
        : frameKey
          ? polygonsByFrame[frameKey] ?? []
          : [];
    const instanceFiltered =
      effectiveMeasurementScope === 'cine' && cineGrouping === 'instance' && activeInstanceUid
        ? base.filter((polygon) => {
            const instanceUid = resolveMeasurementInstanceUid(polygon);
            return instanceUid ? instanceUid === activeInstanceUid : false;
          })
        : base;
    const withActive = activePolygon ? [...instanceFiltered, activePolygon] : instanceFiltered;

    // Filter out hidden polygons (check visibility in new store)
    const filtered = withActive.filter((polygon) => {
      // Active polygon is always visible
      if (activePolygon && polygon.id === activePolygon.id) return true;
      // Check visibility in new store
      const storeMeasurement = measurementStore.getMeasurement(polygon.id);
      return storeMeasurement ? storeMeasurement.visible : false;
    });

    // Apply polygon tracking for cine mode
    return filtered.map((polygon) => {
      if (effectiveMeasurementScope !== 'cine') return polygon;
      const track = displayPolygonTracks[polygon.id];
      if (!track) return polygon;
      const trackedFrame = interpolateTrackFrame(track.frames, currentSlice);
      if (!trackedFrame) return polygon;
      return {
        ...polygon,
        points: trackedFrame.points,
        areaMm2: trackedFrame.area_mm2,
      };
    });
  }, [
    frameKey,
    seriesKey,
    polygonsByFrame,
    polygonsBySeries,
    activePolygon,
    effectiveMeasurementScope,
    activeInstanceUid,
    cineGrouping,
    displayPolygonTracks,
    currentSlice,
    measurementStore,
    newMeasurements,
    resolveMeasurementInstanceUid,
  ]);

  const lineRenderModels = useMemo(
    () =>
      buildLineRenderModels({
        measurements: visibleMeasurements,
        selectedMeasurementId: selectedMeasurementIdLocal,
        displayTracks: displayMeasurementTracks,
        showTrackingTrails,
        trackingTrailLength,
        currentSlice,
        effectiveScope: effectiveMeasurementScope,
      }),
    [
      visibleMeasurements,
      selectedMeasurementIdLocal,
      displayMeasurementTracks,
      showTrackingTrails,
      trackingTrailLength,
      currentSlice,
      effectiveMeasurementScope,
    ],
  );

  const polygonRenderModels = useMemo(
    () =>
      buildPolygonRenderModels({
        polygons: visiblePolygons,
        activePolygon,
        selectedMeasurementId: selectedMeasurementIdLocal,
        displayTracks: displayPolygonTracks,
        showTrackingTrails,
        trackingTrailLength,
        currentSlice,
        polygonPreviewPoint,
        smoothContoursEnabled,
        smoothContoursIterations,
        effectiveScope: effectiveMeasurementScope,
      }),
    [
      visiblePolygons,
      activePolygon,
      selectedMeasurementIdLocal,
      displayPolygonTracks,
      showTrackingTrails,
      trackingTrailLength,
      currentSlice,
      polygonPreviewPoint,
      smoothContoursEnabled,
      smoothContoursIterations,
      effectiveMeasurementScope,
    ],
  );

  // Convert measurement tracks to TrackingData map for MeasurementPanel
  const trackingDataMap = useMemo(() => {
    void newMeasurements;
    const map = new Map<string, import('../features/viewer/types').TrackingData>();

    // Convert line measurement tracks
    for (const [measurementId, track] of Object.entries(displayMeasurementTracks)) {
      const storeMeasurement = measurementStore.getMeasurement(measurementId);
      map.set(measurementId, {
        seriesUid: track.series_uid,
        instanceUid: track.instance_uid ?? storeMeasurement?.instanceUid ?? null,
        totalFrames: track.total_frames,
        startFrameIndex: 0,
        frames: track.frames.map((f) => ({
          frameIndex: f.frame_index,
          points: f.points,
          lengthMm: f.length_mm ?? null,
          valid: f.valid ?? true,
        })),
        summary: {
          minMm: track.summary.min_mm ?? null,
          maxMm: track.summary.max_mm ?? null,
          meanMm: track.summary.mean_mm ?? null,
        },
      });
    }

    // Convert polygon tracks
    for (const [polygonId, track] of Object.entries(displayPolygonTracks)) {
      const storeMeasurement = measurementStore.getMeasurement(polygonId);
      const areaValues = track.frames
        .map((frame) => frame.area_mm2)
        .filter((value): value is number => typeof value === 'number');
      const minArea = areaValues.length ? Math.min(...areaValues) : null;
      const maxArea = areaValues.length ? Math.max(...areaValues) : null;
      const meanArea = areaValues.length
        ? areaValues.reduce((sum, value) => sum + value, 0) / areaValues.length
        : null;

      map.set(polygonId, {
        seriesUid: seriesKey || '',
        instanceUid: storeMeasurement?.instanceUid ?? null,
        totalFrames: track.frames.length,
        startFrameIndex: 0,
        frames: track.frames.map((f) => ({
          frameIndex: f.frame_index,
          points: f.points,
          lengthMm: null,
          areaMm2: f.area_mm2,
          valid: true,
        })),
        summary: {
          minMm: null,
          maxMm: null,
          meanMm: null,
          minAreaMm2: minArea ?? undefined,
          maxAreaMm2: maxArea ?? undefined,
          meanAreaMm2: meanArea ?? undefined,
        },
      });
    }

    return map;
  }, [displayMeasurementTracks, displayPolygonTracks, seriesKey, measurementStore, newMeasurements]);

  const copilotTemplate = useMemo(() => {
    const modality = selectedSeries?.series.modality;
    const description = `${study?.study_description ?? ''} ${selectedSeries?.series.series_description ?? ''}`.trim();
    const key = getCopilotTemplateKey(modality, description);
    return COPILOT_TEMPLATES[key] || COPILOT_TEMPLATES.general;
  }, [selectedSeries?.series.modality, selectedSeries?.series.series_description, study?.study_description]);

  const normalizedMeasurements = useMemo(
    () =>
      contextMeasurements.map((measurement) => ({
        measurement,
        normalizedLabel: normalizeLabel(measurement.label),
      })),
    [contextMeasurements]
  );

  const lineMeasurements = useMemo(
    () => contextMeasurements.filter((measurement) => isLineMeasurement(measurement)),
    [contextMeasurements]
  );
  const polygonMeasurements = useMemo(
    () => contextMeasurements.filter((measurement) => isPolygonMeasurement(measurement)),
    [contextMeasurements]
  );

  const findMeasurementByKeywords = useCallback(
    (keywords: string[], type: 'line' | 'polygon' | 'any') => {
      const match = normalizedMeasurements.find(({ measurement, normalizedLabel }) => {
        if (!normalizedLabel) return false;
        if (type === 'line' && !isLineMeasurement(measurement)) return false;
        if (type === 'polygon' && !isPolygonMeasurement(measurement)) return false;
        return labelHasKeyword(normalizedLabel, keywords);
      });
      if (match?.measurement) return match.measurement;

      if (type === 'line' && lineMeasurements.length === 1) {
        return lineMeasurements[0];
      }
      if (type === 'polygon' && polygonMeasurements.length === 1) {
        return polygonMeasurements[0];
      }
      if (type === 'any' && contextMeasurements.length === 1) {
        return contextMeasurements[0];
      }

      return null;
    },
    [normalizedMeasurements, lineMeasurements, polygonMeasurements, contextMeasurements]
  );

  const derivedMetrics = useMemo(() => {
    const lvedd = findMeasurementByKeywords(
      ['lvedd', 'lv end diastolic', 'lv end-diastolic', 'lv diastolic'],
      'line'
    );
    const lvesd = findMeasurementByKeywords(
      ['lvesd', 'lv end systolic', 'lv end-systolic', 'lv systolic'],
      'line'
    );
    const edv = findMeasurementByKeywords(
      ['edv', 'end diastolic volume', 'end-diastolic volume'],
      'polygon'
    );
    const esv = findMeasurementByKeywords(
      ['esv', 'end systolic volume', 'end-systolic volume'],
      'polygon'
    );

    const efPercent =
      edv && esv && isPolygonMeasurement(edv) && isPolygonMeasurement(esv) && edv.areaMm2 && esv.areaMm2 && edv.areaMm2 > 0
        ? ((edv.areaMm2 - esv.areaMm2) / edv.areaMm2) * 100
        : null;
    const fsPercent =
      lvedd && lvesd && isLineMeasurement(lvedd) && isLineMeasurement(lvesd) && lvedd.lengthMm && lvesd.lengthMm && lvedd.lengthMm > 0
        ? ((lvedd.lengthMm - lvesd.lengthMm) / lvedd.lengthMm) * 100
        : null;

    return {
      lvedd,
      lvesd,
      edv,
      esv,
      efPercent,
      fsPercent,
    };
  }, [findMeasurementByKeywords]);

  const copilotMatches = useMemo(() => {
    const derivedLookup: Record<string, number | null> = {
      ef: derivedMetrics.efPercent ?? null,
      fs: derivedMetrics.fsPercent ?? null,
    };

    return copilotTemplate.requirements.map((requirement) => {
      if (requirement.type === 'derived') {
        const derivedValue = derivedLookup[requirement.id] ?? null;
        return {
          requirement,
          measurement: null,
          derivedValue,
        };
      }

      const measurement = findMeasurementByKeywords(
        requirement.keywords,
        requirement.type === 'any' ? 'any' : requirement.type
      );
      return {
        requirement,
        measurement,
        derivedValue: null,
      };
    });
  }, [copilotTemplate, derivedMetrics, findMeasurementByKeywords]);

  const copilotMissing = useMemo(
    () =>
      copilotMatches.filter(
        (item) =>
          !item.requirement.optional &&
          !item.measurement &&
          item.derivedValue === null
      ),
    [copilotMatches]
  );

  const copilotCompletion = useMemo(() => {
    const requiredCount = copilotTemplate.requirements.filter((req) => !req.optional).length;
    if (requiredCount === 0) return 100;
    const completedCount = requiredCount - copilotMissing.length;
    return Math.max(0, Math.min(100, Math.round((completedCount / requiredCount) * 100)));
  }, [copilotTemplate, copilotMissing.length]);

  const copilotNextRequirement = useMemo(
    () => copilotMissing.find((item) => item.requirement.type !== 'derived') || null,
    [copilotMissing]
  );

  const copilotNarrative = useMemo(() => {
    const lines: string[] = [];
    const modalityLabel = selectedSeries?.series.modality || 'Imaging';
    const studyLabelText = study?.study_description || 'Imaging study';
    lines.push(`Study: ${studyLabelText} (${modalityLabel}).`);

    if (derivedMetrics.lvedd && isLineMeasurement(derivedMetrics.lvedd) && derivedMetrics.lvedd.lengthMm) {
      lines.push(`LVEDD ${derivedMetrics.lvedd.lengthMm.toFixed(1)} mm.`);
    }
    if (derivedMetrics.lvesd && isLineMeasurement(derivedMetrics.lvesd) && derivedMetrics.lvesd.lengthMm) {
      lines.push(`LVESD ${derivedMetrics.lvesd.lengthMm.toFixed(1)} mm.`);
    }
    if (derivedMetrics.efPercent !== null) {
      lines.push(`Estimated EF ${derivedMetrics.efPercent.toFixed(1)}%.`);
    }
    if (derivedMetrics.fsPercent !== null) {
      lines.push(`Fractional shortening ${derivedMetrics.fsPercent.toFixed(1)}%.`);
    }

    if (copilotMissing.length > 0) {
      const missingLabels = copilotMissing.map((item) => item.requirement.label).join(', ');
      lines.push(`Missing recommended elements: ${missingLabels}.`);
    } else {
      lines.push('All required elements captured.');
    }

    return lines.join('\n');
  }, [copilotMissing, derivedMetrics, selectedSeries?.series.modality, study?.study_description]);

  const copilotIntegrityAlerts = useMemo(() => {
    const alerts: string[] = [];
    for (const [measurementId, data] of trackingDataMap.entries()) {
      if (!data.frames.length) continue;
      const measurement = contextMeasurements.find((m) => m.id === measurementId);
      const label = measurement?.label || measurement?.type || 'Measurement';
      const values = data.frames
        .map((frame) => frame.lengthMm ?? frame.areaMm2 ?? null)
        .filter((value): value is number => typeof value === 'number');
      if (values.length < 2) continue;
      const minValue = Math.min(...values);
      const maxValue = Math.max(...values);
      if (maxValue > 0) {
        const changePercent = ((maxValue - minValue) / maxValue) * 100;
        if (changePercent > 35) {
          alerts.push(`Large cine variation in ${label} (${changePercent.toFixed(1)}%).`);
        }
      }
      const invalidCount = data.frames.filter((frame) => frame.valid === false).length;
      if (invalidCount > 0) {
        alerts.push(`${label} has ${invalidCount} invalid tracking frames.`);
      }
    }
    return alerts;
  }, [trackingDataMap, contextMeasurements]);

  const cinePhaseFrames = useMemo(() => {
    if (trackingDataMap.size === 0) return null;
    const candidateId =
      (selectedMeasurementIdLocal && trackingDataMap.has(selectedMeasurementIdLocal))
        ? selectedMeasurementIdLocal
        : trackingDataMap.keys().next().value;
    if (!candidateId) return null;
    const data = trackingDataMap.get(candidateId);
    if (!data || data.frames.length === 0) return null;
    const values = data.frames
      .map((frame) => ({
        frameIndex: frame.frameIndex,
        value: frame.lengthMm ?? frame.areaMm2 ?? null,
      }))
      .filter((item): item is { frameIndex: number; value: number } => typeof item.value === 'number');
    if (!values.length) return null;
    let max = values[0];
    let min = values[0];
    for (const item of values) {
      if (item.value > max.value) max = item;
      if (item.value < min.value) min = item;
    }
    const measurement = contextMeasurements.find((m) => m.id === candidateId);
    return {
      measurementId: candidateId,
      label: measurement?.label || measurement?.type || 'Measurement',
      edFrame: max.frameIndex,
      esFrame: min.frameIndex,
    };
  }, [trackingDataMap, selectedMeasurementIdLocal, contextMeasurements]);

  const cinePhaseMarks = useMemo(() => {
    if (!cinePhaseFrames) return [];
    return [
      { value: cinePhaseFrames.edFrame, label: 'ED' },
      { value: cinePhaseFrames.esFrame, label: 'ES' },
    ];
  }, [cinePhaseFrames]);

  const getWindowDefaults = useCallback((detail: SeriesDetailResponse) => {
    if (detail.window_center && detail.window_width) {
      return { center: detail.window_center, width: detail.window_width };
    }
    const presets = modalityPresets[detail.series.modality] || [defaultPreset];
    const preset = presets[0] || defaultPreset;
    return { center: preset.center, width: preset.width };
  }, []);

  const buildMetadataDraft = useCallback((): MetadataDraft | null => {
    if (!study) return null;
    const patient = patientDetails;
    const series = selectedSeries?.series;
    return {
      patient: {
        patient_id: patient?.patient_id ?? study.patient_id ?? '',
        patient_name: patient?.patient_name ?? study.patient_name ?? '',
        birth_date: patient?.birth_date ?? '',
        sex: patient?.sex ?? '',
        issuer_of_patient_id: patient?.issuer_of_patient_id ?? '',
        other_patient_ids: patient?.other_patient_ids ?? '',
        ethnic_group: patient?.ethnic_group ?? '',
        comments: patient?.comments ?? '',
      },
      study: {
        study_id: study.study_id ?? '',
        study_date: study.study_date ?? '',
        study_time: study.study_time ?? '',
        study_description: study.study_description ?? '',
        accession_number: study.accession_number ?? '',
        referring_physician_name: study.referring_physician ?? '',
        institution_name: study.institution_name ?? '',
      },
      series: {
        series_number: series?.series_number?.toString() ?? '',
        series_description: series?.series_description ?? '',
        body_part_examined: series?.body_part_examined ?? '',
        patient_position: series?.patient_position ?? '',
        protocol_name: series?.protocol_name ?? '',
        slice_thickness: series?.slice_thickness?.toString() ?? '',
        spacing_between_slices: series?.spacing_between_slices?.toString() ?? '',
        window_center: selectedSeries?.window_center?.toString() ?? '',
        window_width: selectedSeries?.window_width?.toString() ?? '',
      },
    };
  }, [study, patientDetails, selectedSeries]);

  const openMetadataEditor = useCallback(() => {
    const draft = buildMetadataDraft();
    if (!draft) {
      setSnackbarMessage('Metadata not available yet.');
      return;
    }
    setMetadataDraft(draft);
    setMetadataDialogOpen(true);
  }, [buildMetadataDraft]);

  const updateMetadataDraft = useCallback(
    (section: keyof MetadataDraft, field: string, value: string) => {
      setMetadataDraft((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [section]: {
            ...prev[section],
            [field]: value,
          },
        } as MetadataDraft;
      });
    },
    []
  );

  const handleSaveMetadata = useCallback(async () => {
    if (!metadataDraft || !studyUid || !study) return;
    setMetadataSaving(true);
    try {
      let updatedPatient: Patient | null = null;
      let updatedSeries: SeriesDetailResponse | null = null;
      let studyChanged = false;

      const baselinePatientId = patientDetails?.patient_id ?? study.patient_id ?? '';
      const patientPayload: PatientUpdateRequest = {};
      const nextPatientId = normalizeText(metadataDraft.patient.patient_id);
      if (nextPatientId !== normalizeText(baselinePatientId)) {
        patientPayload.patient_id = nextPatientId;
      }
      const nextPatientName = normalizeText(metadataDraft.patient.patient_name);
      if (
        nextPatientName !==
        normalizeText(patientDetails?.patient_name ?? study.patient_name ?? '')
      ) {
        patientPayload.patient_name = nextPatientName;
      }
      const nextBirthDate = normalizeText(metadataDraft.patient.birth_date);
      if (nextBirthDate !== normalizeText(patientDetails?.birth_date ?? '')) {
        patientPayload.birth_date = nextBirthDate;
      }
      const nextSex = normalizeText(metadataDraft.patient.sex);
      if (nextSex !== normalizeText(patientDetails?.sex ?? '')) {
        patientPayload.sex = nextSex;
      }
      const nextIssuer = normalizeText(metadataDraft.patient.issuer_of_patient_id);
      if (nextIssuer !== normalizeText(patientDetails?.issuer_of_patient_id ?? '')) {
        patientPayload.issuer_of_patient_id = nextIssuer;
      }
      const nextOtherIds = normalizeText(metadataDraft.patient.other_patient_ids);
      if (nextOtherIds !== normalizeText(patientDetails?.other_patient_ids ?? '')) {
        patientPayload.other_patient_ids = nextOtherIds;
      }
      const nextEthnicGroup = normalizeText(metadataDraft.patient.ethnic_group);
      if (nextEthnicGroup !== normalizeText(patientDetails?.ethnic_group ?? '')) {
        patientPayload.ethnic_group = nextEthnicGroup;
      }
      const nextComments = normalizeText(metadataDraft.patient.comments);
      if (nextComments !== normalizeText(patientDetails?.comments ?? '')) {
        patientPayload.comments = nextComments;
      }

      if (baselinePatientId && Object.keys(patientPayload).length > 0) {
        updatedPatient = await api.patients.update(baselinePatientId, patientPayload);
        setPatientDetails(updatedPatient);
        studyChanged = true;
      }

      const studyPayload: StudyUpdateRequest = {};
      const nextStudyId = normalizeText(metadataDraft.study.study_id);
      if (nextStudyId !== normalizeText(study.study_id ?? '')) {
        studyPayload.study_id = nextStudyId;
      }
      const nextStudyDate = normalizeText(metadataDraft.study.study_date);
      if (nextStudyDate !== normalizeText(study.study_date ?? '')) {
        studyPayload.study_date = nextStudyDate;
      }
      const nextStudyTime = normalizeText(metadataDraft.study.study_time);
      if (nextStudyTime !== normalizeText(study.study_time ?? '')) {
        studyPayload.study_time = nextStudyTime;
      }
      const nextStudyDesc = normalizeText(metadataDraft.study.study_description);
      if (nextStudyDesc !== normalizeText(study.study_description ?? '')) {
        studyPayload.study_description = nextStudyDesc;
      }
      const nextAccession = normalizeText(metadataDraft.study.accession_number);
      if (nextAccession !== normalizeText(study.accession_number ?? '')) {
        studyPayload.accession_number = nextAccession;
      }
      const nextReferring = normalizeText(metadataDraft.study.referring_physician_name);
      if (nextReferring !== normalizeText(study.referring_physician ?? '')) {
        studyPayload.referring_physician_name = nextReferring;
      }
      const nextInstitution = normalizeText(metadataDraft.study.institution_name);
      if (nextInstitution !== normalizeText(study.institution_name ?? '')) {
        studyPayload.institution_name = nextInstitution;
      }

      if (Object.keys(studyPayload).length > 0) {
        await api.studies.update(studyUid, studyPayload);
        studyChanged = true;
      }

      const seriesPayload: SeriesUpdateRequest = {};
      if (selectedSeries && seriesKey) {
        const series = selectedSeries.series;
        const nextSeriesNumber = parseOptionalNumber(metadataDraft.series.series_number);
        if (nextSeriesNumber !== (series.series_number ?? null)) {
          seriesPayload.series_number = nextSeriesNumber;
        }
        const nextSeriesDesc = normalizeText(metadataDraft.series.series_description);
        if (nextSeriesDesc !== normalizeText(series.series_description ?? '')) {
          seriesPayload.series_description = nextSeriesDesc;
        }
        const nextBodyPart = normalizeText(metadataDraft.series.body_part_examined);
        if (nextBodyPart !== normalizeText(series.body_part_examined ?? '')) {
          seriesPayload.body_part_examined = nextBodyPart;
        }
        const nextPatientPosition = normalizeText(metadataDraft.series.patient_position);
        if (nextPatientPosition !== normalizeText(series.patient_position ?? '')) {
          seriesPayload.patient_position = nextPatientPosition;
        }
        const nextProtocol = normalizeText(metadataDraft.series.protocol_name);
        if (nextProtocol !== normalizeText(series.protocol_name ?? '')) {
          seriesPayload.protocol_name = nextProtocol;
        }
        const nextSliceThickness = parseOptionalNumber(metadataDraft.series.slice_thickness);
        if (nextSliceThickness !== (series.slice_thickness ?? null)) {
          seriesPayload.slice_thickness = nextSliceThickness;
        }
        const nextSpacing = parseOptionalNumber(metadataDraft.series.spacing_between_slices);
        if (nextSpacing !== (series.spacing_between_slices ?? null)) {
          seriesPayload.spacing_between_slices = nextSpacing;
        }
        const nextWindowCenter = parseOptionalNumber(metadataDraft.series.window_center);
        if (nextWindowCenter !== (selectedSeries.window_center ?? null)) {
          seriesPayload.window_center = nextWindowCenter;
        }
        const nextWindowWidth = parseOptionalNumber(metadataDraft.series.window_width);
        if (nextWindowWidth !== (selectedSeries.window_width ?? null)) {
          seriesPayload.window_width = nextWindowWidth;
        }
      }

      if (seriesKey && Object.keys(seriesPayload).length > 0) {
        updatedSeries = await api.series.update(seriesKey, seriesPayload);
        seriesCacheRef.current.set(seriesKey, updatedSeries);
        setSelectedSeries(updatedSeries);
        setSeriesList((prev) =>
          prev.map((item) =>
            item.series_instance_uid === updatedSeries!.series.series_instance_uid
              ? { ...item, ...updatedSeries!.series }
              : item
          )
        );
      }

      if (studyChanged) {
        const refreshedStudy = await api.studies.get(studyUid);
        setStudy(refreshedStudy);
      }

      if (!studyChanged && !updatedSeries && !updatedPatient) {
        setSnackbarMessage('No metadata changes detected.');
      } else {
        setSnackbarMessage('Metadata updated.');
      }
      setMetadataDialogOpen(false);
    } catch (err) {
      console.error('Failed to update metadata', err);
      setSnackbarMessage('Failed to update metadata.');
    } finally {
      setMetadataSaving(false);
    }
  }, [
    metadataDraft,
    studyUid,
    study,
    patientDetails,
    selectedSeries,
    seriesKey,
  ]);

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

        const grouping = getCineGrouping(
          normalizedDetail.instances,
          normalizedDetail.series,
          normalizedDetail.has_3d_data
        );
        const defaultInstanceUid = normalizedDetail.instances[0]?.sop_instance_uid ?? null;
        const frames = buildFramesForSelection(
          normalizedDetail.instances,
          defaultInstanceUid,
          grouping
        );
        setSelectedSeries(normalizedDetail);
        setActiveInstanceUid(defaultInstanceUid);
        setFrameIndex(frames);
        setTotalSlices(frames.length || 1);
        applyViewportState(seriesUid, normalizedDetail, frames);
        setImageError(null);
      } catch (err) {
        console.error('Failed to load series:', err);
        setSnackbarMessage('Failed to load series');
      }
    },
    [applyViewportState, saveViewportState, buildFramesForSelection, getCineGrouping]
  );

  const findSeriesDetailForInstance = useCallback(
    async (instanceUid: string) => {
      for (const detail of seriesCacheRef.current.values()) {
        if (detail.instances?.some((instance) => instance.sop_instance_uid === instanceUid)) {
          return detail;
        }
      }

      for (const series of seriesList) {
        const seriesUid = series.series_instance_uid;
        const cached = seriesCacheRef.current.get(seriesUid);
        if (cached && cached.instances?.length) continue;
        try {
          const seriesDetail = await api.series.get(seriesUid);
          const safeInstances = Array.isArray(seriesDetail.instances) ? seriesDetail.instances : [];
          const normalizedDetail = { ...seriesDetail, instances: safeInstances };
          seriesCacheRef.current.set(seriesUid, normalizedDetail);
          if (safeInstances.some((instance) => instance.sop_instance_uid === instanceUid)) {
            return normalizedDetail;
          }
        } catch (err) {
          console.warn('Failed to load series detail for view jump', err);
        }
      }

      return null;
    },
    [seriesList]
  );

  const applySeriesSelection = useCallback(
    (detail: SeriesDetailResponse, instanceUid: string | null, frameIndex: number | null) => {
      const seriesUid = detail.series.series_instance_uid;
      activeSeriesUidRef.current = seriesUid;

      const grouping = getCineGrouping(
        detail.instances,
        detail.series,
        detail.has_3d_data
      );
      const effectiveInstanceUid =
        instanceUid && detail.instances.some((instance) => instance.sop_instance_uid === instanceUid)
          ? instanceUid
          : detail.instances[0]?.sop_instance_uid ?? null;
      const frames = buildFramesForSelection(detail.instances, effectiveInstanceUid, grouping);

      setSelectedSeries(detail);
      setActiveInstanceUid(effectiveInstanceUid);
      setFrameIndex(frames);
      setTotalSlices(frames.length || 1);
      applyViewportState(seriesUid, detail, frames);

      if (frameIndex != null && effectiveInstanceUid) {
        const targetIndex = frames.findIndex(
          (frame) => frame.instanceUid === effectiveInstanceUid && frame.frameIndex === frameIndex
        );
        setCurrentSlice(targetIndex >= 0 ? targetIndex : 0);
      } else {
        setCurrentSlice(0);
      }
      setImageError(null);
    },
    [applyViewportState, buildFramesForSelection, getCineGrouping]
  );

  const jumpToInstanceFrame = useCallback(
    async (instanceUid: string | null, frameIndex: number | null) => {
      if (!instanceUid) return;
      saveViewportState();
      let detail: SeriesDetailResponse | null = selectedSeries ?? null;
      if (!detail || !detail.instances?.some((instance) => instance.sop_instance_uid === instanceUid)) {
        detail = await findSeriesDetailForInstance(instanceUid);
      }
      if (!detail) {
        setSnackbarMessage('Unable to locate cine for the selected view.');
        return;
      }
      seriesCacheRef.current.set(detail.series.series_instance_uid, detail);
      applySeriesSelection(detail, instanceUid, frameIndex);
    },
    [selectedSeries, findSeriesDetailForInstance, applySeriesSelection, saveViewportState]
  );

  const handleSelectViewCine = useCallback(
    async (_view: string, instanceUids: string[]) => {
      if (instanceUids.length === 0) return;
      const currentIdx = currentInstanceUid ? instanceUids.indexOf(currentInstanceUid) : -1;
      const nextInstanceUid = instanceUids[(currentIdx + 1) % instanceUids.length];
      await jumpToInstanceFrame(nextInstanceUid, 0);
    },
    [currentInstanceUid, jumpToInstanceFrame]
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

          // Pre-populate series cache from inline details (avoids extra API round-trip)
          const inlineDetails = seriesResult.value.details;
          if (Array.isArray(inlineDetails)) {
            for (const detail of inlineDetails) {
              const uid = detail.series.series_instance_uid;
              seriesCacheRef.current.set(uid, {
                series: detail.series,
                instances: detail.instances,
                window_center: detail.window_center,
                window_width: detail.window_width,
                has_3d_data: detail.has_3d_data,
              });
            }
          }

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
          // Auto-open AI results panel if cardiac results exist from previous run
          if (aiResult.value.cardiac && aiResult.value.cardiac.length > 0) {
            setShowAiResultsPanel(true);
          }
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

  useEffect(() => {
    if (!selectedSeries) {
      setActiveInstanceUid(null);
      return;
    }
    const instances = selectedSeries.instances ?? [];
    if (instances.length === 0) {
      setActiveInstanceUid(null);
      return;
    }
    if (
      activeInstanceUid &&
      instances.some((instance) => instance.sop_instance_uid === activeInstanceUid)
    ) {
      return;
    }
    setActiveInstanceUid(instances[0].sop_instance_uid);
  }, [selectedSeries, activeInstanceUid]);

  useEffect(() => {
    if (!selectedSeries) return;
    const instances = selectedSeries.instances ?? [];
    if (instances.length === 0) return;
    if (!activeInstanceUid) return;
    const grouping = getCineGrouping(instances, selectedSeries.series, selectedSeries.has_3d_data);
    const frames = buildFramesForSelection(instances, activeInstanceUid, grouping);
    setFrameIndex(frames);
    setTotalSlices(frames.length || 1);
    setCurrentSlice(0);
    setImageError(null);
  }, [selectedSeries, activeInstanceUid, buildFramesForSelection, getCineGrouping]);

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
    setSegmentPromptPoints([]);
  }, [seriesKey]);

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
    const storedSmoothContours = localStorage.getItem('viewer_smooth_contours');
    if (storedSmoothContours !== null) {
      setSmoothContoursEnabled(storedSmoothContours === 'true');
    }
    const storedSmoothIterations = localStorage.getItem('viewer_smooth_contours_iterations');
    if (storedSmoothIterations !== null) {
      const parsed = Number(storedSmoothIterations);
      if (Number.isFinite(parsed)) {
        setSmoothContoursIterations(parsed);
      }
    }
    const storedSmoothTracking = localStorage.getItem('viewer_smooth_tracking');
    if (storedSmoothTracking !== null) {
      setSmoothTrackingEnabled(storedSmoothTracking === 'true');
    }
    const storedSmoothWindow = localStorage.getItem('viewer_smooth_tracking_window');
    if (storedSmoothWindow !== null) {
      const parsed = Number(storedSmoothWindow);
      if (Number.isFinite(parsed)) {
        setSmoothTrackingWindow(parsed);
      }
    }
    const storedTrails = localStorage.getItem('viewer_show_tracking_trails');
    if (storedTrails !== null) {
      setShowTrackingTrails(storedTrails === 'true');
    }
    const storedTrailLength = localStorage.getItem('viewer_tracking_trail_length');
    if (storedTrailLength !== null) {
      const parsed = Number(storedTrailLength);
      if (Number.isFinite(parsed)) {
        setTrackingTrailLength(parsed);
      }
    }
    const storedFitRotate = localStorage.getItem('viewer_auto_fit_rotate');
    if (storedFitRotate !== null) {
      setAutoFitOnRotate(storedFitRotate === 'true');
    }
    const storedPromoteTracking = localStorage.getItem('viewer_auto_promote_tracking');
    if (storedPromoteTracking !== null) {
      setAutoPromoteTracking(storedPromoteTracking === 'true');
    }
    const storedCopilot = localStorage.getItem('viewer_guideline_copilot');
    if (storedCopilot !== null) {
      setGuidelineCopilotEnabled(storedCopilot === 'true');
    }
    const storedPolygonSampling = localStorage.getItem('viewer_polygon_sampling');
    if (storedPolygonSampling === 'sparse' || storedPolygonSampling === 'balanced' || storedPolygonSampling === 'dense') {
      setPolygonSamplingPreset(storedPolygonSampling);
    }
    const storedCineFps = localStorage.getItem('viewer_cine_fps');
    if (storedCineFps !== null) {
      const parsed = Number(storedCineFps);
      if (Number.isFinite(parsed)) {
        setCineFps(clamp(parsed, 5, 30));
      }
    }
    const storedScope = localStorage.getItem('viewer_measurement_scope');
    if (storedScope === 'frame' || storedScope === 'cine') {
      setMeasurementScope(storedScope);
    }
  }, []);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('viewer_auto_track_cine', String(autoTrackCine));
    localStorage.setItem('viewer_prefer_jpeg_cine', String(preferJpegForCine));
    localStorage.setItem('viewer_smooth_contours', String(smoothContoursEnabled));
    localStorage.setItem('viewer_smooth_contours_iterations', String(smoothContoursIterations));
    localStorage.setItem('viewer_smooth_tracking', String(smoothTrackingEnabled));
    localStorage.setItem('viewer_smooth_tracking_window', String(smoothTrackingWindow));
    localStorage.setItem('viewer_show_tracking_trails', String(showTrackingTrails));
    localStorage.setItem('viewer_tracking_trail_length', String(trackingTrailLength));
    localStorage.setItem('viewer_auto_fit_rotate', String(autoFitOnRotate));
    localStorage.setItem('viewer_auto_promote_tracking', String(autoPromoteTracking));
    localStorage.setItem('viewer_guideline_copilot', String(guidelineCopilotEnabled));
    localStorage.setItem('viewer_polygon_sampling', polygonSamplingPreset);
    localStorage.setItem('viewer_cine_fps', String(Math.round(cineFps)));
    localStorage.setItem('viewer_measurement_scope', measurementScope);
  }, [
    autoTrackCine,
    preferJpegForCine,
    smoothContoursEnabled,
    smoothContoursIterations,
    smoothTrackingEnabled,
    smoothTrackingWindow,
    showTrackingTrails,
    trackingTrailLength,
    autoFitOnRotate,
    autoPromoteTracking,
    guidelineCopilotEnabled,
    polygonSamplingPreset,
    cineFps,
    measurementScope,
  ]);

  const bookmarkKey = useMemo(() => {
    if (!seriesKey) return null;
    if (cineGrouping === 'instance' && activeInstanceUid) {
      return `${seriesKey}_${activeInstanceUid}`;
    }
    return seriesKey;
  }, [seriesKey, activeInstanceUid, cineGrouping]);

  useEffect(() => {
    if (!bookmarkKey) {
      setCineBookmarks([]);
      return;
    }
    if (typeof localStorage === 'undefined') return;
    const stored = localStorage.getItem(`viewer_bookmarks_${bookmarkKey}`);
    if (!stored) {
      setCineBookmarks([]);
      return;
    }
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        setCineBookmarks(
          parsed
            .filter((item) => item && typeof item.frameIndex === 'number')
            .map((item) => ({
              id: String(item.id ?? `${Date.now()}`),
              frameIndex: item.frameIndex,
              label: typeof item.label === 'string' ? item.label : 'Bookmark',
              createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
            }))
        );
      } else {
        setCineBookmarks([]);
      }
    } catch (err) {
      console.warn('Failed to parse cine bookmarks', err);
      setCineBookmarks([]);
    }
  }, [bookmarkKey]);

  useEffect(() => {
    if (!bookmarkKey) return;
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(`viewer_bookmarks_${bookmarkKey}`, JSON.stringify(cineBookmarks));
  }, [bookmarkKey, cineBookmarks]);

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

  useEffect(() => {
    let active = true;
    if (!study?.patient_id) {
      setPatientDetails(null);
      return () => {
        active = false;
      };
    }

    api.patients
      .get(study.patient_id)
      .then((patient) => {
        if (!active) return;
        setPatientDetails(patient);
      })
      .catch((err) => {
        if (!active) return;
        console.warn('Failed to load patient details', err);
        setPatientDetails(null);
      });

    return () => {
      active = false;
    };
  }, [study?.patient_id]);

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

  useEffect(() => {
    if (!currentInstanceMeta) return;
    const instanceUid = currentInstanceMeta.sop_instance_uid;
    if (!instanceUid) return;
    setSelectedSeries((prev) => {
      if (!prev) return prev;
      const instances = prev.instances ?? [];
      const index = instances.findIndex((inst) => inst.sop_instance_uid === instanceUid);
      if (index < 0) return prev;
      const currentCount = instances[index].number_of_frames ?? null;
      const nextCount = currentInstanceMeta.number_of_frames ?? currentCount;
      if (nextCount == null || currentCount === nextCount) return prev;
      const nextInstances = instances.map((inst) =>
        inst.sop_instance_uid === instanceUid
          ? { ...inst, number_of_frames: nextCount }
          : inst
      );
      const updated = { ...prev, instances: nextInstances };
      const seriesUid = updated.series.series_instance_uid;
      if (seriesUid) {
        seriesCacheRef.current.set(seriesUid, updated);
      }
      return updated;
    });
  }, [currentInstanceMeta]);

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
  const renderOptions = useMemo<RenderOptions>(
    () => ({
      windowCenter: isColorImage ? undefined : windowLevel.center,
      windowWidth: isColorImage ? undefined : windowLevel.width,
      format: renderFormat,
      quality: renderFormat === 'jpeg' ? renderQuality : undefined,
    }),
    [isColorImage, windowLevel.center, windowLevel.width, renderFormat, renderQuality]
  );

  const touchImageCache = useCallback((url: string, image: HTMLImageElement) => {
    touchCachedImage(imageCacheRef.current, url, image, MAX_IMAGE_CACHE);
  }, []);

  const inflightRef = useRef(new Set<string>());

  const preloadImage = useCallback(
    (url: string) => {
      preloadCachedImage(imageCacheRef.current, inflightRef.current, url, MAX_IMAGE_CACHE);
    },
    []
  );

  const getPlaybackFrameUrl = useCallback(
    (instanceUid: string, frameIndex: number) => {
      const viewState = viewStateRef.current;
      return buildFrameImageUrl(instanceUid, frameIndex, {
        windowCenter: isColorImage ? undefined : viewState.windowLevel.center,
        windowWidth: isColorImage ? undefined : viewState.windowLevel.width,
        format: renderFormat,
        quality: renderFormat === 'jpeg' ? renderQuality : undefined,
      });
    },
    [isColorImage, renderFormat, renderQuality]
  );

  // Cine playback
  useEffect(() => {
    const cleanup = startCinePlayback({
      isPlaying,
      totalSlices,
      cineFps,
      instanceUid: currentInstanceUid,
      currentSliceRef,
      frameIndexRef,
      imageCacheRef,
      perfRef: cinePerfRef,
      getFrameUrl: getPlaybackFrameUrl,
      preloadImage,
      setCurrentSlice,
    });
    return cleanup ?? undefined;
  }, [
    isPlaying,
    totalSlices,
    cineFps,
    currentInstanceUid,
    currentSliceRef,
    frameIndexRef,
    imageCacheRef,
    cinePerfRef,
    getPlaybackFrameUrl,
    preloadImage,
    setCurrentSlice,
  ]);

  const imageUrl = useMemo(() => {
    if (!currentInstanceUid) return null;
    return buildFrameImageUrl(currentInstanceUid, currentFrameIndex, renderOptions);
  }, [currentInstanceUid, currentFrameIndex, renderOptions]);

  const colorFilter = useMemo(() => {
    if (!isColorImage) return undefined;
    const base = selectedSeries ? getWindowDefaults(selectedSeries) : defaultWindowLevel;
    const baseWidth = Math.max(1, base.width);
    const widthRatio = baseWidth / Math.max(1, windowLevel.width);
    const contrast = clamp(widthRatio, 0.5, 3);
    const centerDelta = windowLevel.center - base.center;
    const brightness = clamp(1 + (centerDelta / baseWidth) * 0.5, 0.5, 2);
    return `brightness(${brightness}) contrast(${contrast})`;
  }, [isColorImage, selectedSeries, windowLevel.center, windowLevel.width, getWindowDefaults]);

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
    const decodeStart = performance.now();
    image.onload = () => {
      if (!active || latestImageUrlRef.current !== imageUrl) return;
      const decodeMs = performance.now() - decodeStart;
      const stats = frameRenderStatsRef.current;
      stats.count += 1;
      stats.totalMs += decodeMs;
      if (stats.count % 30 === 0) {
        const avg = stats.totalMs / stats.count;
        console.info(`viewer_frame_decode_avg_ms=${avg.toFixed(1)}`);
      }
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
    prefetchAdjacentFrames({
      frameIndex,
      currentSlice,
      totalSlices,
      isPlaying,
      isUltrasound,
      renderOptions,
      preloadImage,
    });
  }, [
    currentSlice,
    totalSlices,
    frameIndex,
    currentInstanceUid,
    isPlaying,
    preloadImage,
    isUltrasound,
    renderOptions,
  ]);

  useEffect(() => {
    if (!seriesKey || frameIndex.length === 0) return;
    if (prefetchedSeriesRef.current.has(seriesKey)) return;
    const warmCount = Math.min(frameIndex.length, isUltrasound ? Math.max(24, Math.ceil(cineFps * 1.5)) : 6);
    prefetchWarmFrames({
      frameIndex,
      warmCount,
      renderOptions,
      preloadImage,
    });
    prefetchedSeriesRef.current.add(seriesKey);
  }, [
    seriesKey,
    frameIndex,
    preloadImage,
    isUltrasound,
    cineFps,
    renderOptions,
  ]);

  useEffect(() => {
    if (!seriesKey || frameIndex.length === 0) return;
    const cacheKey = `${seriesKey}:${renderFormat}:${renderQuality}:${windowLevel.center}:${windowLevel.width}`;
    if (prefetchedFullSeriesRef.current.has(cacheKey)) return;

    const token = fullPrefetchTokenRef.current + 1;
    fullPrefetchTokenRef.current = token;

    const maxFrames = isUltrasound ? Math.min(frameIndex.length, 120) : Math.min(frameIndex.length, 60);
    const concurrency = 4;

    void prefetchFullSeries({
      frameIndex,
      maxFrames,
      concurrency,
      renderOptions,
      preloadImage,
      shouldCancel: () => fullPrefetchTokenRef.current !== token,
      onComplete: () => {
        prefetchedFullSeriesRef.current.add(cacheKey);
      },
    });

    return () => {
      // Cancel outstanding prefetch work for this series.
      fullPrefetchTokenRef.current += 1;
    };
  }, [
    seriesKey,
    frameIndex,
    preloadImage,
    isUltrasound,
    renderFormat,
    renderQuality,
    windowLevel.center,
    windowLevel.width,
    renderOptions,
  ]);

  const screenToImage = useCallback(
    (clientX: number, clientY: number) => {
      const svg = overlayRef.current;
      if (svg && typeof svg.createSVGPoint === 'function') {
        const ctm = svg.getScreenCTM();
        if (ctm) {
          const point = svg.createSVGPoint();
          point.x = clientX;
          point.y = clientY;
          const local = point.matrixTransform(ctm.inverse());
          return { x: local.x, y: local.y };
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
    async (
      seriesUid: string,
      measurement: LegacyLineMeasurement,
      startIndex: number,
      instanceUid?: string | null
    ) => {
      if (!seriesUid) return;
      if (trackingMeasurementId) return;
      if (measurementTracks[measurement.id]) return;

      setTrackingMeasurementId(measurement.id);
      setSnackbarMessage('Tracking cine measurement...');
      try {
        const resolvedMeasurementInstanceUid = resolveMeasurementInstanceUid(measurement);
        const targetInstanceUid =
          cineGrouping === 'instance'
            ? instanceUid ??
              resolvedMeasurementInstanceUid ??
              currentInstanceUid ??
              activeInstanceUid ??
              null
            : null;
        const safeStartIndex = Math.max(0, Math.floor(startIndex));
        const response = await api.series.trackMeasurement(seriesUid, {
          start_index: safeStartIndex,
          track_full_loop: true,
          points: [measurement.start, measurement.end],
          instance_uid: targetInstanceUid ?? undefined,
        });
        setMeasurementTracks((prev) => ({ ...prev, [measurement.id]: response }));
        measurementStore.setTrackingData(measurement.id, {
          seriesUid: response.series_uid,
          instanceUid: response.instance_uid ?? targetInstanceUid ?? null,
          totalFrames: response.total_frames,
          startFrameIndex: response.frames[0]?.frame_index ?? 0,
          frames: response.frames.map((frame) => ({
            frameIndex: frame.frame_index,
            points: frame.points,
            lengthMm: frame.length_mm ?? null,
            areaMm2: frame.area_mm2 ?? null,
            valid: frame.valid ?? true,
          })),
          summary: {
            minMm: response.summary.min_mm ?? null,
            maxMm: response.summary.max_mm ?? null,
            meanMm: response.summary.mean_mm ?? null,
            minAreaMm2: response.summary.min_area_mm2 ?? undefined,
            maxAreaMm2: response.summary.max_area_mm2 ?? undefined,
            meanAreaMm2: response.summary.mean_area_mm2 ?? undefined,
          },
        });
        if (response.summary.mean_mm != null) {
          setSnackbarMessage(
            `Cine measurement recorded. Mean ${response.summary.mean_mm.toFixed(1)} mm`
          );
        } else {
          setSnackbarMessage('Cine measurement recorded.');
        }
      } catch (err) {
        const detail = getApiErrorDetail(err);
        console.error('Failed to track cine measurement:', err);
        setSnackbarMessage(detail ? `Failed to track cine measurement: ${detail}` : 'Failed to track cine measurement.');
      } finally {
        setTrackingMeasurementId(null);
      }
    },
    [
      trackingMeasurementId,
      measurementTracks,
      measurementStore,
      currentInstanceUid,
      activeInstanceUid,
      cineGrouping,
      resolveMeasurementInstanceUid,
    ]
  );

  const promoteLineToSeries = useCallback(
    (measurementId: string, line: LegacyLineMeasurement) => {
      if (!seriesKey) return;
      // Remove from frame buckets
      setMeasurementsByFrame((prev) => {
        const nextState: Record<string, LegacyLineMeasurement[]> = {};
        for (const [key, list] of Object.entries(prev)) {
          const filtered = list.filter((item) => item.id !== measurementId);
          if (filtered.length) {
            nextState[key] = filtered;
          }
        }
        return nextState;
      });
      // Add to series list if missing
      setMeasurementsBySeries((prev) => {
        const currentList = prev[seriesKey] ?? [];
        if (currentList.some((item) => item.id === measurementId)) {
          return prev;
        }
        return {
          ...prev,
          [seriesKey]: [...currentList, line],
        };
      });
      measurementStore.updateMeasurement(measurementId, {
        scope: 'series',
        frameKey: null,
      });
    },
    [seriesKey, measurementStore]
  );

  const promotePolygonToSeries = useCallback(
    (measurementId: string, polygon: LegacyPolygonMeasurement) => {
      if (!seriesKey) return;
      setPolygonsByFrame((prev) => {
        const nextState: Record<string, LegacyPolygonMeasurement[]> = {};
        for (const [key, list] of Object.entries(prev)) {
          const filtered = list.filter((item) => item.id !== measurementId);
          if (filtered.length) {
            nextState[key] = filtered;
          }
        }
        return nextState;
      });
      setPolygonsBySeries((prev) => {
        const currentList = prev[seriesKey] ?? [];
        if (currentList.some((item) => item.id === measurementId)) {
          return prev;
        }
        return {
          ...prev,
          [seriesKey]: [...currentList, polygon],
        };
      });
      measurementStore.updateMeasurement(measurementId, {
        scope: 'series',
        frameKey: null,
      });
    },
    [seriesKey, measurementStore]
  );

  const buildMedsamPromptPayload = useCallback(
    (
      promptPoints?: SegmentPromptPoint[],
      promptBox?: [number, number, number, number] | null
    ) => {
      if (!promptPoints || promptPoints.length === 0) return null;
      const positives = promptPoints.filter((p) => p.label === 1).map((p) => ({
        x: p.x,
        y: p.y,
      }));
      const negatives = promptPoints.filter((p) => p.label === 0).map((p) => ({
        x: p.x,
        y: p.y,
      }));
      const points = positives.length ? positives : promptPoints.map((p) => ({ x: p.x, y: p.y }));
      return {
        points,
        negative_points: negatives.length ? negatives : undefined,
        box: promptBox ?? undefined,
      };
    },
    []
  );

  // Track a measurement from the panel by ID
  const trackMeasurementById = useCallback(
    async (
      measurementId: string,
      options?: {
        method?: 'optical_flow' | 'medsam_hybrid';
        promptPoints?: SegmentPromptPoint[];
        promptBox?: [number, number, number, number] | null;
        keyframeStride?: number;
      }
    ) => {
      if (!seriesKey) {
        setSnackbarMessage('Please select a series first');
        return;
      }
      if (!canUseCineMeasurements) {
        setSnackbarMessage('Current cine has only one frame. Tracking is not available.');
        return;
      }
      if (trackingMeasurementId) {
        setSnackbarMessage('Already tracking a measurement');
        return;
      }

      // Check if already tracked
      if (measurementTracks[measurementId] || polygonTracks[measurementId]) {
        setSnackbarMessage('Measurement already tracked');
        return;
      }

      const storeMeasurement = measurementStore.getMeasurement(measurementId);
      if (storeMeasurement && storeMeasurement.seriesUid !== seriesKey) {
        setSnackbarMessage('Measurement belongs to a different series.');
        return;
      }
      if (
        cineGrouping === 'instance' &&
        activeInstanceUid &&
        resolveMeasurementInstanceUid(storeMeasurement ?? { id: measurementId }) !== activeInstanceUid
      ) {
        setSnackbarMessage('Switch to the cine where this measurement was created.');
        return;
      }

      if (storeMeasurement && isLineMeasurement(storeMeasurement)) {
        const lineMeasurement: LegacyLineMeasurement = {
          id: storeMeasurement.id,
          start: storeMeasurement.points[0],
          end: storeMeasurement.points[1],
          lengthMm: storeMeasurement.lengthMm ?? 0,
        };
        if (storeMeasurement.scope === 'frame') {
          if (!autoPromoteTracking) {
            setSnackbarMessage('Enable auto-promote or switch to cine scope before tracking.');
            return;
          }
          promoteLineToSeries(measurementId, lineMeasurement);
        }
        if (measurementScope !== 'cine') {
          setMeasurementScope('cine');
        }
        if (cineGrouping === 'instance' && activeInstanceUid) {
          const resolvedInstanceUid = resolveMeasurementInstanceUid(storeMeasurement);
          if (!resolvedInstanceUid) {
            measurementStore.updateMeasurement(storeMeasurement.id, { instanceUid: activeInstanceUid });
          }
        }
        await trackMeasurementFor(
          seriesKey,
          lineMeasurement,
          currentSlice,
          cineGrouping === 'instance'
            ? storeMeasurement?.instanceUid ?? currentInstanceUid ?? activeInstanceUid ?? null
            : null
        );
        return;
      }

      if (storeMeasurement && isPolygonMeasurement(storeMeasurement)) {
        const polygonMeasurement: LegacyPolygonMeasurement = {
          id: storeMeasurement.id,
          points: storeMeasurement.points,
          areaMm2: storeMeasurement.areaMm2 ?? null,
          perimeterMm: storeMeasurement.perimeterMm ?? null,
        };
        if (storeMeasurement.scope === 'frame') {
          if (!autoPromoteTracking) {
            setSnackbarMessage('Enable auto-promote or switch to cine scope before tracking.');
            return;
          }
          promotePolygonToSeries(measurementId, polygonMeasurement);
        }
        if (measurementScope !== 'cine') {
          setMeasurementScope('cine');
        }
        if (cineGrouping === 'instance' && activeInstanceUid) {
          const resolvedInstanceUid = resolveMeasurementInstanceUid(storeMeasurement);
          if (!resolvedInstanceUid) {
            measurementStore.updateMeasurement(storeMeasurement.id, { instanceUid: activeInstanceUid });
          }
        }
        setTrackingMeasurementId(polygonMeasurement.id);
        const promptPayload = options?.method === 'medsam_hybrid'
          ? buildMedsamPromptPayload(options?.promptPoints, options?.promptBox ?? null)
          : null;
        const useMedsamHybrid = options?.method === 'medsam_hybrid' && promptPayload !== null;
        setSnackbarMessage(
          useMedsamHybrid ? 'Tracking polygon with MedSAM hybrid...' : 'Tracking polygon with optical flow...'
        );
        try {
          const trackingPoints = normalizeTrackingPoints(polygonMeasurement.points);
          const response = await api.series.trackMeasurement(seriesKey, {
            start_index: currentSlice,
            track_full_loop: true,
            points: useMedsamHybrid ? promptPayload!.points : trackingPoints,
            negative_points: useMedsamHybrid ? promptPayload!.negative_points : undefined,
            box: useMedsamHybrid ? promptPayload!.box : undefined,
            keyframe_stride: useMedsamHybrid ? (options?.keyframeStride ?? 5) : undefined,
            tracking_method: useMedsamHybrid ? 'medsam_hybrid' : undefined,
            instance_uid:
              cineGrouping === 'instance'
                ? currentInstanceUid ?? activeInstanceUid ?? undefined
                : undefined,
          });

          const framesWithArea = response.frames.map((frame) => ({
            frame_index: frame.frame_index,
            points: frame.points,
            area_mm2: frame.area_mm2,
            valid: frame.valid ?? true,
          }));

          setPolygonTracks((prev) => ({
            ...prev,
            [polygonMeasurement.id]: {
              frames: framesWithArea.map((frame) => ({
                frame_index: frame.frame_index,
                points: frame.points,
                area_mm2: frame.area_mm2,
              })),
            },
          }));
          measurementStore.setTrackingData(polygonMeasurement.id, {
            seriesUid: response.series_uid,
            instanceUid:
              response.instance_uid ??
              (cineGrouping === 'instance'
                ? currentInstanceUid ?? activeInstanceUid ?? null
                : null),
            totalFrames: response.total_frames,
            startFrameIndex: response.frames[0]?.frame_index ?? 0,
            frames: framesWithArea.map((frame) => ({
              frameIndex: frame.frame_index,
              points: frame.points,
              lengthMm: null,
              areaMm2: frame.area_mm2 ?? null,
              valid: frame.valid ?? true,
            })),
            summary: {
              minMm: null,
              maxMm: null,
              meanMm: null,
              minAreaMm2: response.summary.min_area_mm2 ?? undefined,
              maxAreaMm2: response.summary.max_area_mm2 ?? undefined,
              meanAreaMm2: response.summary.mean_area_mm2 ?? undefined,
            },
          });

          const summary = response.summary;
          if (summary.min_area_mm2 !== null && summary.max_area_mm2 !== null) {
            const change = summary.max_area_mm2 > 0
              ? ((summary.max_area_mm2 - summary.min_area_mm2) / summary.max_area_mm2 * 100).toFixed(1)
              : '0';
            setSnackbarMessage(
              useMedsamHybrid
                ? `Polygon tracked with MedSAM hybrid. Area: ${summary.min_area_mm2.toFixed(1)} - ${summary.max_area_mm2.toFixed(1)} mm^2 (Delta ${change}%)`
                : `Polygon tracked with optical flow. Area: ${summary.min_area_mm2.toFixed(1)} - ${summary.max_area_mm2.toFixed(1)} mm^2 (Delta ${change}%)`
            );
          } else {
            setSnackbarMessage(
              useMedsamHybrid
                ? 'Polygon tracked across cine loop with MedSAM hybrid.'
                : 'Polygon tracked across cine loop with optical flow.'
            );
          }
        } catch (err) {
          console.error('Failed to track polygon with optical flow:', err);
          setSnackbarMessage(
            useMedsamHybrid
              ? 'MedSAM hybrid tracking failed. Using static mode.'
              : 'Optical flow tracking failed. Using static mode.'
          );
          const frames = Array.from({ length: totalSlices }, (_, i) => ({
            frame_index: i,
            points: polygonMeasurement.points,
            area_mm2: polygonMeasurement.areaMm2,
          }));
          setPolygonTracks((prev) => ({
            ...prev,
            [polygonMeasurement.id]: { frames },
          }));
          measurementStore.setTrackingData(polygonMeasurement.id, {
            seriesUid: seriesKey,
            instanceUid:
              cineGrouping === 'instance' ? currentInstanceUid ?? activeInstanceUid ?? null : null,
            totalFrames: totalSlices,
            startFrameIndex: 0,
            frames: frames.map((frame) => ({
              frameIndex: frame.frame_index,
              points: frame.points,
              lengthMm: null,
              areaMm2: frame.area_mm2 ?? null,
              valid: true,
            })),
            summary: {
              minMm: null,
              maxMm: null,
              meanMm: null,
              minAreaMm2: polygonMeasurement.areaMm2 ?? null,
              maxAreaMm2: polygonMeasurement.areaMm2 ?? null,
              meanAreaMm2: polygonMeasurement.areaMm2 ?? null,
            },
          });
        } finally {
          setTrackingMeasurementId(null);
        }
        return;
      }

      // Find line measurement in visibleMeasurements or measurementsBySeries
      const lineMeasurement =
        visibleMeasurements.find((m) => m.id === measurementId) ||
        (seriesKey ? measurementsBySeries[seriesKey]?.find((m) => m.id === measurementId) : null);

      if (lineMeasurement) {
        const storeMeasurement = measurementStore.getMeasurement(measurementId);
        if (storeMeasurement?.scope === 'frame') {
          if (!autoPromoteTracking) {
            setSnackbarMessage('Enable auto-promote or switch to cine scope before tracking.');
            return;
          }
          promoteLineToSeries(measurementId, lineMeasurement);
        }
        if (measurementScope !== 'cine') {
          setMeasurementScope('cine');
        }
        if (cineGrouping === 'instance' && activeInstanceUid) {
          const resolvedInstanceUid = resolveMeasurementInstanceUid(storeMeasurement ?? lineMeasurement);
          if (!resolvedInstanceUid) {
            measurementStore.updateMeasurement(measurementId, { instanceUid: activeInstanceUid });
          }
        }
        // Track line measurement using existing API
        await trackMeasurementFor(
          seriesKey,
          lineMeasurement,
          currentSlice,
          cineGrouping === 'instance'
            ? storeMeasurement?.instanceUid ?? currentInstanceUid ?? activeInstanceUid ?? null
            : null
        );
        return;
      }

      // Find polygon measurement
      const polygonMeasurement =
        visiblePolygons.find((p) => p.id === measurementId) ||
        (seriesKey ? polygonsBySeries[seriesKey]?.find((p) => p.id === measurementId) : null);

      if (polygonMeasurement) {
        const storeMeasurement = measurementStore.getMeasurement(measurementId);
        if (storeMeasurement?.scope === 'frame') {
          if (!autoPromoteTracking) {
            setSnackbarMessage('Enable auto-promote or switch to cine scope before tracking.');
            return;
          }
          promotePolygonToSeries(measurementId, polygonMeasurement);
        }
        if (measurementScope !== 'cine') {
          setMeasurementScope('cine');
        }
        if (cineGrouping === 'instance' && activeInstanceUid) {
          const resolvedInstanceUid = resolveMeasurementInstanceUid(storeMeasurement ?? polygonMeasurement);
          if (!resolvedInstanceUid) {
            measurementStore.updateMeasurement(measurementId, { instanceUid: activeInstanceUid });
          }
        }
        // Track polygon using optical flow API (real tracking with motion detection)
        setTrackingMeasurementId(polygonMeasurement.id);
        setSnackbarMessage('Tracking polygon with optical flow...');
        try {
          const trackingPoints = normalizeTrackingPoints(polygonMeasurement.points);
          const response = await api.series.trackMeasurement(seriesKey, {
            start_index: currentSlice,
            track_full_loop: true,
            points: trackingPoints,
            instance_uid:
              cineGrouping === 'instance'
                ? currentInstanceUid ?? activeInstanceUid ?? undefined
                : undefined,
          });

          // Use backend-calculated areas directly
          const framesWithArea = response.frames.map((frame) => ({
            frame_index: frame.frame_index,
            points: frame.points,
            area_mm2: frame.area_mm2, // Backend now calculates area
            valid: frame.valid ?? true,
          }));

          setPolygonTracks((prev) => ({
            ...prev,
            [polygonMeasurement.id]: {
              frames: framesWithArea.map((frame) => ({
                frame_index: frame.frame_index,
                points: frame.points,
                area_mm2: frame.area_mm2,
              })),
            },
          }));
          measurementStore.setTrackingData(polygonMeasurement.id, {
            seriesUid: response.series_uid,
            instanceUid:
              response.instance_uid ??
              (cineGrouping === 'instance'
                ? currentInstanceUid ?? activeInstanceUid ?? null
                : null),
            totalFrames: response.total_frames,
            startFrameIndex: response.frames[0]?.frame_index ?? 0,
            frames: framesWithArea.map((frame) => ({
              frameIndex: frame.frame_index,
              points: frame.points,
              lengthMm: null,
              areaMm2: frame.area_mm2 ?? null,
              valid: frame.valid ?? true,
            })),
            summary: {
              minMm: null,
              maxMm: null,
              meanMm: null,
              minAreaMm2: response.summary.min_area_mm2 ?? undefined,
              maxAreaMm2: response.summary.max_area_mm2 ?? undefined,
              meanAreaMm2: response.summary.mean_area_mm2 ?? undefined,
            },
          });

          // Use summary from backend if available
          const summary = response.summary;
          if (summary.min_area_mm2 !== null && summary.max_area_mm2 !== null) {
            const change = summary.max_area_mm2 > 0
              ? ((summary.max_area_mm2 - summary.min_area_mm2) / summary.max_area_mm2 * 100).toFixed(1)
              : '0';
            setSnackbarMessage(
              `Polygon tracked with optical flow. Area: ${summary.min_area_mm2.toFixed(1)} - ${summary.max_area_mm2.toFixed(1)} mm^2 (Delta ${change}%)`
            );
          } else {
            setSnackbarMessage('Polygon tracked across cine loop with optical flow.');
          }
        } catch (err) {
          console.error('Failed to track polygon with optical flow:', err);
          setSnackbarMessage('Optical flow tracking failed. Using static mode.');
          // Fallback to static tracking (same shape all frames)
          const frames = Array.from({ length: totalSlices }, (_, i) => ({
            frame_index: i,
            points: polygonMeasurement.points,
            area_mm2: polygonMeasurement.areaMm2,
          }));
          setPolygonTracks((prev) => ({
            ...prev,
            [polygonMeasurement.id]: { frames },
          }));
          measurementStore.setTrackingData(polygonMeasurement.id, {
            seriesUid: seriesKey,
            instanceUid:
              cineGrouping === 'instance' ? currentInstanceUid ?? activeInstanceUid ?? null : null,
            totalFrames: totalSlices,
            startFrameIndex: 0,
            frames: frames.map((frame) => ({
              frameIndex: frame.frame_index,
              points: frame.points,
              lengthMm: null,
              areaMm2: frame.area_mm2 ?? null,
              valid: true,
            })),
            summary: {
              minMm: null,
              maxMm: null,
              meanMm: null,
              minAreaMm2: polygonMeasurement.areaMm2 ?? null,
              maxAreaMm2: polygonMeasurement.areaMm2 ?? null,
              meanAreaMm2: polygonMeasurement.areaMm2 ?? null,
            },
          });
        } finally {
          setTrackingMeasurementId(null);
        }
        return;
      }

      setSnackbarMessage('Measurement not found');
    },
    [
      seriesKey,
      trackingMeasurementId,
      measurementTracks,
      polygonTracks,
      visibleMeasurements,
      measurementsBySeries,
      visiblePolygons,
      polygonsBySeries,
      promoteLineToSeries,
      promotePolygonToSeries,
      currentSlice,
      totalSlices,
      trackMeasurementFor,
      buildMedsamPromptPayload,
      measurementStore,
      measurementScope,
      canUseCineMeasurements,
      autoPromoteTracking,
      currentInstanceUid,
      activeInstanceUid,
      cineGrouping,
      resolveMeasurementInstanceUid,
    ]
  );

  const buildSegmentPolygon = useCallback(
    (contour: Point2D[]) => {
      const target = clamp(segmentContourPoints, 3, 256);
      const resampled = resampleClosedPolygon(contour, target);
      return smoothContoursEnabled ? smoothPolygon(resampled, smoothContoursIterations) : resampled;
    },
    [segmentContourPoints, smoothContoursEnabled, smoothContoursIterations]
  );

  const buildAutoSegmentPoints = useCallback(
    (base: Point2D, label: 0 | 1) => {
      const points: SegmentPromptPoint[] = [];
      const boundedBase = {
        x: clamp(base.x, 0, imageDimensions.columns),
        y: clamp(base.y, 0, imageDimensions.rows),
      };
      points.push({ ...boundedBase, label });

      if (segmentAutoSeed && label === 1 && segmentAutoPointCount > 1) {
        const ringCount = Math.max(1, Math.min(12, Math.round(segmentAutoPointCount - 1)));
        const radius = Math.max(1, Math.round(segmentAutoPointRadius));
        for (let i = 0; i < ringCount; i += 1) {
          const angle = (Math.PI * 2 * i) / ringCount;
          const x = clamp(boundedBase.x + Math.cos(angle) * radius, 0, imageDimensions.columns);
          const y = clamp(boundedBase.y + Math.sin(angle) * radius, 0, imageDimensions.rows);
          points.push({ x, y, label: 1 });
        }
      }

      if (segmentAutoNegativePoints && label === 1) {
        const margin = Math.max(2, Math.round(Math.min(imageDimensions.columns, imageDimensions.rows) * 0.05));
        const negatives: SegmentPromptPoint[] = [
          { x: margin, y: margin, label: 0 },
          { x: imageDimensions.columns - margin, y: margin, label: 0 },
          { x: margin, y: imageDimensions.rows - margin, label: 0 },
          { x: imageDimensions.columns - margin, y: imageDimensions.rows - margin, label: 0 },
        ];
        negatives.forEach((pt) => points.push(pt));
      }

      return points;
    },
    [
      segmentAutoSeed,
      segmentAutoPointCount,
      segmentAutoPointRadius,
      segmentAutoNegativePoints,
      imageDimensions,
    ]
  );

  const buildAutoSegmentBox = useCallback(
    (points: SegmentPromptPoint[]) => {
      if (!segmentAutoBox || points.length === 0) return null;
      const anchor = points.find((pt) => pt.label === 1) ?? points[0];
      const size = Math.min(imageDimensions.columns, imageDimensions.rows) * clamp(segmentAutoBoxScale, 0.15, 0.75);
      const half = size / 2;
      const x1 = clamp(anchor.x - half, 0, imageDimensions.columns);
      const y1 = clamp(anchor.y - half, 0, imageDimensions.rows);
      const x2 = clamp(anchor.x + half, 0, imageDimensions.columns);
      const y2 = clamp(anchor.y + half, 0, imageDimensions.rows);
      if (x2 <= x1 || y2 <= y1) return null;
      return [Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)] as [number, number, number, number];
    },
    [segmentAutoBox, segmentAutoBoxScale, imageDimensions]
  );

  const updatePolygonMeasurementLocal = useCallback(
    (measurementId: string, points: Point2D[], areaMm2: number | null, perimeterMm: number | null) => {
      measurementStore.updateMeasurement(measurementId, {
        points,
        areaMm2,
        perimeterMm,
      });

      setPolygonsBySeries((prev) => {
        const next: Record<string, LegacyPolygonMeasurement[]> = { ...prev };
        Object.entries(prev).forEach(([key, list]) => {
          const idx = list.findIndex((item) => item.id === measurementId);
          if (idx >= 0) {
            const updated = { ...list[idx], points, areaMm2, perimeterMm };
            const copy = [...list];
            copy[idx] = updated;
            next[key] = copy;
          }
        });
        return next;
      });

      setPolygonsByFrame((prev) => {
        const next: Record<string, LegacyPolygonMeasurement[]> = { ...prev };
        Object.entries(prev).forEach(([key, list]) => {
          const idx = list.findIndex((item) => item.id === measurementId);
          if (idx >= 0) {
            const updated = { ...list[idx], points, areaMm2, perimeterMm };
            const copy = [...list];
            copy[idx] = updated;
            next[key] = copy;
          }
        });
        return next;
      });
    },
    [measurementStore]
  );

  useEffect(() => {
    if (!lastSegmentContour || !lastSegmentMeasurementId) return;
    const measurement = measurementStore.getMeasurement(lastSegmentMeasurementId);
    if (!measurement || measurementStore.trackingData.has(lastSegmentMeasurementId)) return;

    const polygonPoints = buildSegmentPolygon(lastSegmentContour);
    const spacing = currentInstanceMeta?.pixel_spacing ?? [1, 1];
    const pixelSpacing = { rowSpacing: spacing[0], columnSpacing: spacing[1] };
    const areaMm2 = calculatePolygonAreaMm2(polygonPoints, pixelSpacing);
    const perimeterMm = calculatePerimeterMm(polygonPoints, pixelSpacing, true);

    updatePolygonMeasurementLocal(lastSegmentMeasurementId, polygonPoints, areaMm2, perimeterMm);
  }, [
    lastSegmentContour,
    lastSegmentMeasurementId,
    measurementStore,
    buildSegmentPolygon,
    currentInstanceMeta,
    updatePolygonMeasurementLocal,
  ]);

  const runInteractiveSegmentation = useCallback(
    async (pointsOverride?: SegmentPromptPoint[], boxOverride?: [number, number, number, number] | null) => {
      if (segmentRunning) return;
      if (!studyUid || !seriesKey || !currentInstanceUid) {
        setSnackbarMessage('Select a study series before running smart segmentation.');
        return;
      }

      const points = pointsOverride ?? segmentPromptPoints;
      if (points.length === 0) {
        setSnackbarMessage('Add at least one point for smart segmentation.');
        return;
      }

      setSegmentRunning(true);
      try {
        const safeFrameIndex = Math.max(0, Math.floor(currentFrameIndex));
        const box = boxOverride ?? buildAutoSegmentBox(points);
        const response: InteractiveSegmentationResponse = await api.ai.interactiveMedsam({
          studyUid,
          seriesUid: seriesKey,
          instanceUid: currentInstanceUid,
          frameIndex: safeFrameIndex,
          prompt: {
            points: points.map((point) => [Math.round(point.x), Math.round(point.y)]),
            pointLabels: points.map((point) => point.label),
            box: box ?? undefined,
          },
        });

        const filename = response.mask_url.split('/').pop();
        if (filename) {
          setInteractiveSegmentations((prev) => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
              seriesUid: seriesKey,
              instanceUid: currentInstanceUid,
              frameIndex: safeFrameIndex,
              maskFilename: filename,
              maskShape: response.mask_shape,
              createdAt: Date.now(),
              primaryContour: response.primary_contour ?? [],
            },
          ]);
        }

        const contour = response.primary_contour?.length
          ? response.primary_contour
          : response.contours?.[0] ?? [];
        if (contour.length >= 3) {
          setLastSegmentContour(contour);
          const polygonPoints = buildSegmentPolygon(contour);
          const spacing = currentInstanceMeta?.pixel_spacing ?? [1, 1];
          const pixelSpacing = { rowSpacing: spacing[0], columnSpacing: spacing[1] };
          const areaMm2 = calculatePolygonAreaMm2(polygonPoints, pixelSpacing);
          const perimeterMm = calculatePerimeterMm(polygonPoints, pixelSpacing, true);
          const scope = autoTrackCine ? 'series' : effectiveMeasurementScope === 'cine' ? 'series' : 'frame';
          const frameKeyForScope = scope === 'frame' ? frameKey : null;
          const instanceUidForScope =
            scope === 'frame'
              ? currentInstanceUid ?? null
              : cineGrouping === 'instance'
                ? currentInstanceUid ?? null
                : null;

          const measurementId = measurementStore.createMeasurement({
            type: 'polygon',
            scope,
            label: 'Smart Segment',
            color: MEASUREMENT_COLORS.default,
            visible: true,
            locked: false,
            seriesUid: seriesKey,
            frameKey: frameKeyForScope,
            instanceUid: instanceUidForScope,
            points: polygonPoints,
            perimeterMm,
            areaMm2,
            volumeData: null,
            trackingData: null,
          } as Omit<NewPolygonMeasurement, 'id' | 'createdAt' | 'modifiedAt'>);
          setLastSegmentMeasurementId(measurementId);

          const legacyPolygon = {
            id: measurementId,
            points: polygonPoints,
            areaMm2,
            perimeterMm,
            instanceUid: instanceUidForScope,
          };
          if (scope === 'series') {
            setPolygonsBySeries((prev) => ({
              ...prev,
              [seriesKey]: [...(prev[seriesKey] ?? []), legacyPolygon],
            }));
          } else if (frameKeyForScope) {
            setPolygonsByFrame((prev) => ({
              ...prev,
              [frameKeyForScope]: [...(prev[frameKeyForScope] ?? []), legacyPolygon],
            }));
          }

          if (autoTrackCine && scope === 'series') {
            setTimeout(() => {
              trackMeasurementById(measurementId, {
                method: 'medsam_hybrid',
                promptPoints: points,
                promptBox: box ?? null,
                keyframeStride: 5,
              });
            }, 0);
          }
        }

        setSegmentPromptPoints([]);
        setSnackbarMessage('Smart segmentation complete.');
      } catch (err) {
        const detail = getApiErrorDetail(err);
        console.error('Smart segmentation failed:', err);
        setSnackbarMessage(detail ? detail : 'Smart segmentation failed.');
      } finally {
        setSegmentRunning(false);
      }
    },
    [
      segmentRunning,
      studyUid,
      seriesKey,
      currentInstanceUid,
      segmentPromptPoints,
      buildAutoSegmentBox,
      currentFrameIndex,
      buildSegmentPolygon,
      currentInstanceMeta,
      effectiveMeasurementScope,
      autoTrackCine,
      frameKey,
      measurementStore,
      trackMeasurementById,
      cineGrouping,
    ]
  );

  const handleSegmentClick = useCallback(
    (event: React.MouseEvent) => {
      if (segmentRunning) {
        setSnackbarMessage('Segmentation in progress. Please wait.');
        return;
      }
      const point = screenToImage(event.clientX, event.clientY);
      if (!point || !isPointInImage(event.clientX, event.clientY)) return;
      const label: 0 | 1 =
        event.shiftKey || event.altKey ? (segmentPointMode === 1 ? 0 : 1) : segmentPointMode;
      const bounded = {
        x: clamp(point.x, 0, imageDimensions.columns),
        y: clamp(point.y, 0, imageDimensions.rows),
      };

      let nextPoints: SegmentPromptPoint[] = [];
      setSegmentPromptPoints((prev) => {
        if (segmentAutoSeed && prev.length === 0 && label === 1) {
          nextPoints = buildAutoSegmentPoints(bounded, label);
          return nextPoints;
        }
        nextPoints = [...prev, { ...bounded, label }];
        return nextPoints;
      });

      if (segmentAutoRun && !segmentRunning) {
        const box = buildAutoSegmentBox(nextPoints);
        runInteractiveSegmentation(nextPoints, box);
      }
    },
    [
      screenToImage,
      isPointInImage,
      segmentPointMode,
      imageDimensions,
      segmentAutoRun,
      segmentAutoSeed,
      buildAutoSegmentPoints,
      buildAutoSegmentBox,
      segmentRunning,
      runInteractiveSegmentation,
    ]
  );

  const handlePreloadMedsam = useCallback(async () => {
    if (medsamPreloading) return;
    if (!medsamModel) {
      setSnackbarMessage('MedSAM model not registered.');
      return;
    }
    if (!medsamModel.available) {
      const firstError = medsamModel.errors?.[0];
      setSnackbarMessage(firstError || 'MedSAM weights not available.');
      return;
    }
    if (medsamStatus === 'loaded') {
      setSnackbarMessage('MedSAM already loaded.');
      return;
    }
    setMedsamPreloading(true);
    try {
      await api.ai.loadModel('medsam');
      const modelsResult = await api.ai.getModels();
      if (modelsResult.shape_error) {
        setAIModels([]);
        setSnackbarMessage('AI models response invalid. AI tools disabled.');
      } else {
        setAIModels(modelsResult.models);
      }
      setSnackbarMessage('MedSAM preloaded. Smart Segment is ready.');
    } catch (err) {
      const detail = getApiErrorDetail(err);
      console.error('MedSAM preload failed:', err);
      setSnackbarMessage(detail ? detail : 'MedSAM preload failed.');
    } finally {
      setMedsamPreloading(false);
    }
  }, [medsamPreloading, medsamModel, medsamStatus]);

  const handlePolygonFreehandStart = useCallback(
    (event: React.MouseEvent) => {
      if (!currentInstanceUid || activeTool !== 'polygon') return;
      if (!isPointInImage(event.clientX, event.clientY)) return;
      if (effectiveMeasurementScope === 'frame' && !frameKey) return;
      if (effectiveMeasurementScope === 'cine' && !seriesKey) return;

      event.preventDefault();
      event.stopPropagation();
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      if (isPlaying) {
        setIsPlaying(false);
      }

      const point = screenToImage(event.clientX, event.clientY);
      if (!point) return;
      const clampedPoint = {
        x: clamp(point.x, 0, imageDimensions.columns),
        y: clamp(point.y, 0, imageDimensions.rows),
      };

      if (!activePolygonRef.current) {
        const id =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        setActivePolygon({
          id,
          points: [clampedPoint],
          areaMm2: null,
          perimeterMm: null,
          instanceUid: currentInstanceUid ?? null,
        });
      } else {
        setActivePolygon((prev) =>
          prev
            ? {
                ...prev,
                points: [...prev.points, clampedPoint],
              }
            : prev
        );
      }

      freehandPolygonRef.current.active = true;
      freehandPolygonRef.current.lastPoint = clampedPoint;
    },
    [
      currentInstanceUid,
      activeTool,
      isPointInImage,
      effectiveMeasurementScope,
      frameKey,
      seriesKey,
      screenToImage,
      imageDimensions,
      isPlaying,
    ]
  );

  const handleMouseDown = (event: React.MouseEvent) => {
    if (!currentInstanceUid) return;
    if (event.button === 2 && activeTool === 'polygon') {
      handlePolygonFreehandStart(event);
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    if (isPlaying) {
      setIsPlaying(false);
    }
    // Handle pointer tool (selection and editing)
    if (activeTool === 'pointer') {
      handlePointerMouseDown(event);
      return;
    }

    // Handle polygon tool clicks (click-based, not drag-based)
    if (activeTool === 'polygon') {
      handlePolygonClick(event);
      return;
    }

    if (activeTool === 'segment') {
      handleSegmentClick(event);
      return;
    }

    const dragTool = activeTool as DragState['tool'];
    if (dragTool === 'pan' && !canPan) {
      return;
    }
    if (
      (dragTool === 'pan' || dragTool === 'zoom' || dragTool === 'wwwl' || dragTool === 'measure' || dragTool === 'rotate') &&
      !isPointInImage(event.clientX, event.clientY)
    ) {
      return;
    }
    if (dragTool === 'measure') {
      if (effectiveMeasurementScope === 'frame' && !frameKey) return;
      if (effectiveMeasurementScope === 'cine' && !seriesKey) return;
    }
    dragStateRef.current = {
      tool: dragTool,
      startX: event.clientX,
      startY: event.clientY,
      startPan: { ...pan },
      startZoom: zoom,
      startWindow: { ...windowLevel },
      startRotation: rotation,
    };
    setIsDragging(true);

    if (dragTool === 'measure') {
      const point = screenToImage(event.clientX, event.clientY);
      if (!point) return;
      const id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const { dragState, measurement } = createMeasureDragStart({
        point,
        imageDimensions,
        frameKey,
        seriesKey,
        instanceUid: currentInstanceUid,
        scope: effectiveMeasurementScope,
        id,
      });
      Object.assign(dragStateRef.current, dragState);
      setActiveMeasurement(measurement);
    }
  };

  const clearTrackingStateFor = useCallback((ids: string[]) => {
    if (ids.length === 0) return;

    setMeasurementTracks((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of ids) {
        if (id in next) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    setPolygonTracks((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of ids) {
        if (id in next) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const clearTrackingForEdit = useCallback(
    (measurementId: string) => {
      const hasTracking =
        measurementId in measurementTracks ||
        measurementId in polygonTracks ||
        measurementStore.trackingData.has(measurementId);
      if (!hasTracking) return;

      clearTrackingStateFor([measurementId]);
      measurementStore.clearTrackingData(measurementId);
      measurementStore.updateMeasurement(measurementId, { trackingData: null });
      setSnackbarMessage('Tracking cleared to allow manual editing.');
    },
    [measurementTracks, polygonTracks, measurementStore, clearTrackingStateFor]
  );

  const findMeasurementHit = useCallback(
    (imagePoint: Point2D, screenTolerance?: number) =>
      hitTestMeasurement({
        imagePoint,
        scale,
        screenTolerance,
        measurements: visibleMeasurements,
        polygons: visiblePolygons,
      }),
    [scale, visibleMeasurements, visiblePolygons]
  );

  const findHandleHit = useCallback(
    (imagePoint: Point2D, screenTolerance?: number) =>
      hitTestHandle({
        imagePoint,
        scale,
        screenTolerance,
        measurements: visibleMeasurements,
        polygons: visiblePolygons,
      }),
    [scale, visibleMeasurements, visiblePolygons]
  );

  // Handle pointer tool mouse down for selection and editing
  const handlePointerMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (activeTool !== 'pointer') return;

      const selectionActions = {
        setSelectedMeasurementId: setSelectedMeasurementIdLocal,
        selectMeasurement: (id: string | null) => measurementStore.selectMeasurement(id),
      };
      const editActions = {
        ...selectionActions,
        setEditingMeasurement,
        setIsDragging,
      };

      const point = screenToImage(event.clientX, event.clientY);
      if (!point) {
        clearMeasurementSelection(selectionActions);
        return;
      }

      // First check if clicking on a handle
      const handleHit = findHandleHit(point);
      if (handleHit) {
        clearTrackingForEdit(handleHit.id);
        const editState = buildHandleEditState(handleHit, point, visibleMeasurements, visiblePolygons);
        if (!editState) return;
        startMeasurementEdit(editActions, editState);
        return;
      }

      // Check if clicking on measurement body for moving
      const hitId = findMeasurementHit(point);
      if (hitId) {
        clearTrackingForEdit(hitId);
        const editState = buildBodyEditState(hitId, point, visibleMeasurements, visiblePolygons);
        if (!editState) return;
        startMeasurementEdit(editActions, editState);
        return;
      }

      // Click on empty space - deselect
      clearMeasurementSelection(selectionActions);
    },
    [
      activeTool,
      screenToImage,
      findHandleHit,
      findMeasurementHit,
      measurementStore,
      visibleMeasurements,
      visiblePolygons,
      clearTrackingForEdit,
    ]
  );

  // Finish polygon drawing
  const finishPolygon = useCallback(() => {
    const polygon = activePolygonRef.current ?? activePolygon;
    if (!polygon || polygon.points.length < 3) {
      setActivePolygon(null);
      setPolygonPreviewPoint(null);
      return;
    }

    // Calculate area and perimeter
    const pixelSpacingData = currentInstanceMeta?.pixel_spacing;
    const pixelSpacing = pixelSpacingData
      ? { rowSpacing: pixelSpacingData[0], columnSpacing: pixelSpacingData[1] }
      : null;

    const areaMm2 = pixelSpacing
      ? calculatePolygonAreaMm2(polygon.points, pixelSpacing)
      : null;
    const perimeterMm = pixelSpacing
      ? calculatePerimeterMm(polygon.points, pixelSpacing, true)
      : null;

    const finishedPolygon: LegacyPolygonMeasurement = {
      ...polygon,
      areaMm2,
      perimeterMm,
    };

    // Add to old state
    if (effectiveMeasurementScope === 'cine' && seriesKey) {
      setPolygonsBySeries((prev) => ({
        ...prev,
        [seriesKey]: [...(prev[seriesKey] ?? []), finishedPolygon],
      }));
    } else if (frameKey) {
      setPolygonsByFrame((prev) => ({
        ...prev,
        [frameKey]: [...(prev[frameKey] ?? []), finishedPolygon],
      }));
    }

    // Add to new measurement store
    if (seriesKey) {
      const isCineScope = effectiveMeasurementScope === 'cine';
      const instanceUidForScope =
        !isCineScope
          ? polygon.instanceUid ?? currentInstanceUid ?? null
          : cineGrouping === 'instance'
            ? polygon.instanceUid ?? currentInstanceUid ?? null
            : null;

      measurementStore.createMeasurement({
        type: 'polygon',
        seriesUid: seriesKey,
        frameKey: isCineScope ? null : frameKey,
        scope: isCineScope ? 'series' : 'frame',
        instanceUid: instanceUidForScope,
        points: finishedPolygon.points,
        label: null,
        visible: true,
        locked: false,
        color: '#22c55e',
        areaMm2: finishedPolygon.areaMm2,
        perimeterMm: finishedPolygon.perimeterMm,
        volumeData: null,
        trackingData: null,
      } as Omit<NewPolygonMeasurement, 'id' | 'createdAt' | 'modifiedAt'>, finishedPolygon.id);
    }

    // Note: Polygon tracking is now on-demand (user clicks Track button)
    // No automatic static tracking - allows user to choose when to track
    if (effectiveMeasurementScope === 'cine' && totalSlices > 1) {
      setSnackbarMessage('Polygon created. Click Track button for optical flow tracking across frames.');
    } else {
      setSnackbarMessage('Polygon measurement added.');
    }

    setSelectedMeasurementIdLocal(finishedPolygon.id);
    setActivePolygon(null);
    setPolygonPreviewPoint(null);
  }, [
    activePolygon,
    currentInstanceMeta,
    effectiveMeasurementScope,
    seriesKey,
    frameKey,
    measurementStore,
    totalSlices,
    cineGrouping,
    currentInstanceUid,
  ]);

  // Handle polygon click (adding points)
  const handlePolygonClick = useCallback(
    (event: React.MouseEvent) => {
      if (activeTool !== 'polygon') return;
      if (!isPointInImage(event.clientX, event.clientY)) return;
      if (effectiveMeasurementScope === 'frame' && !frameKey) return;
      if (effectiveMeasurementScope === 'cine' && !seriesKey) return;

      setPolygonPreviewPoint(null);
      const point = screenToImage(event.clientX, event.clientY);
      if (!point) return;

      const clampedPoint = {
        x: clamp(point.x, 0, imageDimensions.columns),
        y: clamp(point.y, 0, imageDimensions.rows),
      };

      if (!activePolygon) {
        // Start new polygon
        const id =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        setActivePolygon({
          id,
          points: [clampedPoint],
          areaMm2: null,
          perimeterMm: null,
          instanceUid: currentInstanceUid ?? null,
        });
      } else {
        // Check if clicking near first point to close polygon (within 10 pixels)
        const firstPoint = activePolygon.points[0];
        const distToFirst = Math.sqrt(
          Math.pow(clampedPoint.x - firstPoint.x, 2) + Math.pow(clampedPoint.y - firstPoint.y, 2)
        );

        if (activePolygon.points.length >= 3 && distToFirst < 15) {
          // Close polygon - finish drawing
          finishPolygon();
        } else {
          // Add point to polygon
          setActivePolygon({
            ...activePolygon,
            points: [...activePolygon.points, clampedPoint],
          });
        }
      }
    },
    [
      activeTool,
      activePolygon,
      isPointInImage,
      screenToImage,
      imageDimensions,
      effectiveMeasurementScope,
      frameKey,
      seriesKey,
      currentInstanceUid,
      finishPolygon,
    ]
  );

  // Handle double-click to finish polygon
  const handlePolygonDoubleClick = useCallback(() => {
    if (activeTool === 'polygon' && activePolygon && activePolygon.points.length >= 3) {
      finishPolygon();
    }
  }, [activeTool, activePolygon, finishPolygon]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't handle shortcuts when typing in an input
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Cancel measurement editing with Escape
      if (event.key === 'Escape' && editingMeasurement) {
        cancelMeasurementEdit(setEditingMeasurement);
        return;
      }

      // Cancel polygon drawing with Escape
      if (event.key === 'Escape' && activePolygon) {
        setActivePolygon(null);
        setPolygonPreviewPoint(null);
        freehandPolygonRef.current.active = false;
        freehandPolygonRef.current.lastPoint = null;
        return;
      }

      // Deselect with Escape
      if (event.key === 'Escape' && selectedMeasurementIdLocal) {
        clearMeasurementSelection({
          setSelectedMeasurementId: setSelectedMeasurementIdLocal,
          selectMeasurement: (id: string | null) => measurementStore.selectMeasurement(id),
        });
        return;
      }

      // Delete selected measurement with Delete or Backspace
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedMeasurementIdLocal) {
        event.preventDefault();
        measurementStore.deleteMeasurement(selectedMeasurementIdLocal);
        clearTrackingStateFor([selectedMeasurementIdLocal]);
        // Also delete from old state
        setMeasurementsByFrame((prev) => {
          const newState: Record<string, LegacyLineMeasurement[]> = {};
          for (const [key, measurements] of Object.entries(prev)) {
            newState[key] = measurements.filter((m) => m.id !== selectedMeasurementIdLocal);
          }
          return newState;
        });
        setMeasurementsBySeries((prev) => {
          const newState: Record<string, LegacyLineMeasurement[]> = {};
          for (const [key, measurements] of Object.entries(prev)) {
            newState[key] = measurements.filter((m) => m.id !== selectedMeasurementIdLocal);
          }
          return newState;
        });
        setPolygonsByFrame((prev) => {
          const newState: Record<string, LegacyPolygonMeasurement[]> = {};
          for (const [key, polygons] of Object.entries(prev)) {
            newState[key] = polygons.filter((p) => p.id !== selectedMeasurementIdLocal);
          }
          return newState;
        });
        setPolygonsBySeries((prev) => {
          const newState: Record<string, LegacyPolygonMeasurement[]> = {};
          for (const [key, polygons] of Object.entries(prev)) {
            newState[key] = polygons.filter((p) => p.id !== selectedMeasurementIdLocal);
          }
          return newState;
        });
        setSelectedMeasurementIdLocal(null);
        setSnackbarMessage('Measurement deleted.');
        return;
      }

      // Tool shortcuts (only when no modifier keys)
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const shortcutTool = resolveToolShortcut(event.key);
        if (shortcutTool) {
          setActiveTool(shortcutTool);
        } else if (event.key === ' ') {
          event.preventDefault();
          setIsPlaying((prev) => !prev);
        }
      }

      // Undo/Redo
      if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          measurementStore.redo();
        } else {
          measurementStore.undo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePolygon, editingMeasurement, selectedMeasurementIdLocal, measurementStore, clearTrackingStateFor]);

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      lastPointerRef.current = { x: event.clientX, y: event.clientY };

      // Handle pointer tool editing (moving measurements/handles)
      if (editingMeasurement) {
        const currentPoint = screenToImage(event.clientX, event.clientY);
        if (!currentPoint) return;
        const newPoints = buildEditedPoints(editingMeasurement, currentPoint, imageDimensions);

        if (editingMeasurement.type === 'line') {
          const updateMeasurement = (measurements: LegacyLineMeasurement[]) =>
            measurements.map((m) =>
              m.id === editingMeasurement.id
                ? { ...m, start: newPoints[0], end: newPoints[1] }
                : m
            );
          setMeasurementsByFrame((prev) => {
            const newState: Record<string, LegacyLineMeasurement[]> = {};
            for (const [key, ms] of Object.entries(prev)) {
              newState[key] = updateMeasurement(ms);
            }
            return newState;
          });
          setMeasurementsBySeries((prev) => {
            const newState: Record<string, LegacyLineMeasurement[]> = {};
            for (const [key, ms] of Object.entries(prev)) {
              newState[key] = updateMeasurement(ms);
            }
            return newState;
          });
        } else if (editingMeasurement.type === 'polygon') {
          const updatePolygon = (polygons: LegacyPolygonMeasurement[]) =>
            polygons.map((p) =>
              p.id === editingMeasurement.id ? { ...p, points: newPoints } : p
            );
          setPolygonsByFrame((prev) => {
            const newState: Record<string, LegacyPolygonMeasurement[]> = {};
            for (const [key, ps] of Object.entries(prev)) {
              newState[key] = updatePolygon(ps);
            }
            return newState;
          });
          setPolygonsBySeries((prev) => {
            const newState: Record<string, LegacyPolygonMeasurement[]> = {};
            for (const [key, ps] of Object.entries(prev)) {
              newState[key] = updatePolygon(ps);
            }
            return newState;
          });
        }
        return;
      }

      if (freehandPolygonRef.current.active && activeTool === 'polygon') {
        if ((event.buttons & 2) !== 2) {
          return;
        }
        const currentPoint = screenToImage(event.clientX, event.clientY);
        if (!currentPoint || !isPointInImage(event.clientX, event.clientY)) {
          return;
        }
        const clampedPoint = {
          x: clamp(currentPoint.x, 0, imageDimensions.columns),
          y: clamp(currentPoint.y, 0, imageDimensions.rows),
        };
        const lastPoint = freehandPolygonRef.current.lastPoint;
        const dist = lastPoint
          ? Math.hypot(clampedPoint.x - lastPoint.x, clampedPoint.y - lastPoint.y)
          : Infinity;
        if (!lastPoint || dist >= freehandPointSpacing) {
          setActivePolygon((prev) =>
            prev
              ? {
                  ...prev,
                  points: [...prev.points, clampedPoint],
                }
              : prev
          );
          freehandPolygonRef.current.lastPoint = clampedPoint;
        }
        return;
      }

      if (activeTool === 'polygon' && activePolygon) {
        const currentPoint = screenToImage(event.clientX, event.clientY);
        if (!currentPoint || !isPointInImage(event.clientX, event.clientY)) {
          setPolygonPreviewPoint(null);
        } else {
          const targetPoint = {
            x: clamp(currentPoint.x, 0, imageDimensions.columns),
            y: clamp(currentPoint.y, 0, imageDimensions.rows),
          };
          setPolygonPreviewPoint((prev) => {
            if (!prev) return targetPoint;
            return {
              x: lerp(prev.x, targetPoint.x, PREVIEW_SMOOTHING),
              y: lerp(prev.y, targetPoint.y, PREVIEW_SMOOTHING),
            };
          });
        }
      }

      const dragState = dragStateRef.current;
      if (!dragState) return;
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

      if (dragState.tool === 'rotate') {
        // Drag horizontally to rotate (1 degree per pixel)
        const newRotation = ((dragState.startRotation ?? 0) + dx * 0.5) % 360;
        setRotation(newRotation < 0 ? newRotation + 360 : newRotation);
      }

      if (dragState.tool === 'measure' && dragState.measureStart) {
        const point = screenToImage(event.clientX, event.clientY);
        if (!point) return;
        const spacing = currentInstanceMeta?.pixel_spacing ?? [1, 1];
        const measureDrag = dragState as MeasureDragState;
        const updated = updateMeasureDrag({
          dragState: measureDrag,
          currentPoint: point,
          imageDimensions,
          pixelSpacing: [spacing[0], spacing[1]],
        });
        setActiveMeasurement((prev) => (prev ? { ...prev, end: updated.end, lengthMm: updated.lengthMm } : updated));
      }
    },
    [
      imageDimensions,
      screenToImage,
      currentInstanceMeta,
      clampPan,
      applyZoomAt,
      canPan,
      isPointInImage,
      editingMeasurement,
      activeTool,
      activePolygon,
      freehandPointSpacing,
    ]
  );

  const handleMouseUp = useCallback(() => {
    if (freehandPolygonRef.current.active) {
      freehandPolygonRef.current.active = false;
      freehandPolygonRef.current.lastPoint = null;
      finishPolygon();
      return;
    }
    // Handle pointer tool editing completion
    if (editingMeasurement) {
      // Recalculate measurement values after editing
      const spacing = currentInstanceMeta?.pixel_spacing ?? [1, 1];
      const pixelSpacing = { rowSpacing: spacing[0], columnSpacing: spacing[1] };

      if (editingMeasurement.type === 'line') {
        setMeasurementsByFrame((prev) =>
          recomputeLegacyLineLengths(prev, editingMeasurement, spacing)
        );
        setMeasurementsBySeries((prev) =>
          recomputeLegacyLineLengths(prev, editingMeasurement, spacing)
        );
      } else if (editingMeasurement.type === 'polygon') {
        setPolygonsByFrame((prev) =>
          recomputeLegacyPolygonMetrics(prev, editingMeasurement, pixelSpacing)
        );
        setPolygonsBySeries((prev) =>
          recomputeLegacyPolygonMetrics(prev, editingMeasurement, pixelSpacing)
        );
      }

      const pointer = lastPointerRef.current;
      const currentPoint = pointer ? screenToImage(pointer.x, pointer.y) : null;
      const { hasMovement } = computeEditMovement(editingMeasurement, currentPoint);

      if (hasMovement && currentPoint) {
        const newPoints = buildEditedPoints(editingMeasurement, currentPoint, imageDimensions);
        const updates = buildEditedStoreUpdate(editingMeasurement, newPoints, spacing, pixelSpacing);
        if (updates) {
          measurementStore.updateMeasurement(editingMeasurement.id, updates);
        }
      }

      const cleanup = getEditCleanupState();
      setEditingMeasurement(cleanup.editingMeasurement);
      setIsDragging(cleanup.isDragging);
      setSnackbarMessage('Measurement updated.');
      return;
    }

    const dragState = dragStateRef.current;
    if (dragState?.tool === 'measure' && activeMeasurement) {
      const measurement = activeMeasurement;
      const finalizeResult = finalizeMeasureDrag({
        dragState: dragState as MeasureDragState,
        measurement,
        cineGrouping,
        currentInstanceUid,
        seriesKey,
      });

      if (finalizeResult.legacyInsert) {
        if (finalizeResult.legacyInsert.scope === 'series') {
          setMeasurementsBySeries((prev) => {
            const existing = prev[finalizeResult.legacyInsert!.key] ?? [];
            return {
              ...prev,
              [finalizeResult.legacyInsert!.key]: [...existing, measurement],
            };
          });
        } else {
          setMeasurementsByFrame((prev) => {
            const existing = prev[finalizeResult.legacyInsert!.key] ?? [];
            return {
              ...prev,
              [finalizeResult.legacyInsert!.key]: [...existing, measurement],
            };
          });
        }
      }

      if (finalizeResult.storeInsert) {
        measurementStore.createMeasurement(
          finalizeResult.storeInsert.payload as Omit<NewLineMeasurement, 'id' | 'createdAt' | 'modifiedAt'>,
          finalizeResult.storeInsert.id
        );
      }

      if (finalizeResult.selectedId) {
        setSelectedMeasurementIdLocal(finalizeResult.selectedId);
      }
      setActiveMeasurement(null);
      if (
        finalizeResult.autoTrack &&
        autoTrackCine
      ) {
        trackMeasurementFor(
          finalizeResult.autoTrack.seriesKey,
          finalizeResult.autoTrack.measurement,
          currentSliceRef.current,
          finalizeResult.autoTrack.instanceUid
        );
      }
    }
    dragStateRef.current = null;
    setIsDragging(false);
  }, [
    activeMeasurement,
    autoTrackCine,
    trackMeasurementFor,
    measurementStore,
    seriesKey,
    editingMeasurement,
    currentInstanceMeta,
    currentInstanceUid,
    screenToImage,
    imageDimensions,
    cineGrouping,
  ]);

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
    let delta = event.deltaY;
    if (event.deltaMode === 1) {
      delta *= 16;
    } else if (event.deltaMode === 2) {
      delta *= viewportSize.height || 1;
    }
    if (delta === 0) return;

    const shouldZoom = event.ctrlKey || activeTool === 'zoom' || totalSlices <= 1;
    if (shouldZoom) {
      event.preventDefault();
      const clamped = Math.sign(delta) * Math.min(200, Math.abs(delta));
      const factor = Math.exp(-clamped * WHEEL_ZOOM_SPEED);
      const nextZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
      if (isPointInImage(event.clientX, event.clientY)) {
        applyZoomAt(event.clientX, event.clientY, nextZoom);
      } else {
        const anchor = getZoomAnchor();
        if (anchor) {
          applyZoomAt(anchor.x, anchor.y, nextZoom);
        } else {
          setZoom(nextZoom);
        }
      }
      return;
    }

    event.preventDefault();
    if (isPlaying) {
      setIsPlaying(false);
    }
    const now = performance.now();
    if (now - lastWheelTimeRef.current > 400) {
      wheelAccumulatorRef.current = 0;
    }
    lastWheelTimeRef.current = now;
    wheelAccumulatorRef.current += delta;
    const steps = Math.trunc(wheelAccumulatorRef.current / WHEEL_SCROLL_THRESHOLD);
    if (steps === 0) return;
    const clampedSteps = clamp(steps, -WHEEL_MAX_SLICE_STEP, WHEEL_MAX_SLICE_STEP);
    wheelAccumulatorRef.current -= clampedSteps * WHEEL_SCROLL_THRESHOLD;
    setCurrentSlice((prev) => clamp(prev + clampedSteps, 0, totalSlices - 1));
  };

  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
    if (selectedSeries) {
      setWindowLevel(getWindowDefaults(selectedSeries));
    }
  };

  const patientExportDetails = useMemo(
    () => ({
      patientId: patientDetails?.patient_id ?? study?.patient_id ?? undefined,
      patientName: patientDetails?.patient_name ?? study?.patient_name ?? undefined,
      patientBirthDate: patientDetails?.birth_date ?? undefined,
      patientSex: patientDetails?.sex ?? undefined,
      issuerOfPatientId: patientDetails?.issuer_of_patient_id ?? undefined,
      otherPatientIds: patientDetails?.other_patient_ids ?? undefined,
      ethnicGroup: patientDetails?.ethnic_group ?? undefined,
      patientComments: patientDetails?.comments ?? undefined,
    }),
    [patientDetails, study?.patient_id, study?.patient_name]
  );

  // Export measurements handler
  const handleExportMeasurements = useCallback(async (format: ExportFormat) => {
    const measurements = measurementStore.exportMeasurements(seriesKey || undefined);
    if (measurements.length === 0) {
      setSnackbarMessage('No measurements to export.');
      return;
    }

    const measurementById = new Map(measurements.map((measurement) => [measurement.id, measurement]));
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `measurements_${timestamp}`;

    try {
      switch (format) {
        case 'json': {
          const jsonData = {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            studyUid: study?.study_instance_uid || '',
            seriesUid: seriesKey || '',
            measurements,
          };
          downloadFile(JSON.stringify(jsonData, null, 2), `${filename}.json`, 'application/json');
          break;
        }
        case 'csv': {
          const csvContent = generateCSVExport(measurements);
          downloadFile(csvContent, `${filename}.csv`, 'text/csv');
          break;
        }
        case 'pdf': {
          // Generate simple HTML report and open for printing
          const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Measurement Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; }
    h1 { color: #1976d2; border-bottom: 2px solid #1976d2; padding-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
    th { background: #f0f0f0; }
    .footer { margin-top: 40px; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <h1>DICOM Measurement Report</h1>
  <p><strong>Series:</strong> ${selectedSeries?.series.series_description || 'Unknown'}</p>
  <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
  <table>
    <tr><th>Type</th><th>Label</th><th>Value</th><th>Created</th></tr>
    ${measurements.map(m => `
      <tr>
        <td>${m.type}</td>
        <td>${m.label || '-'}</td>
        <td>${m.type === 'line' && 'lengthMm' in m ? `${(m.lengthMm as number)?.toFixed(2) || '-'} mm` :
             m.type === 'polygon' && 'areaMm2' in m ? `${(m.areaMm2 as number)?.toFixed(2) || '-'} mm^2` : '-'}</td>
        <td>${new Date(m.createdAt).toLocaleString()}</td>
      </tr>
    `).join('')}
  </table>
  <div class="footer">Generated by Horalix DICOM Viewer</div>
</body>
</html>`;
          const printWindow = window.open('', '_blank');
          if (printWindow) {
            printWindow.document.write(html);
            printWindow.document.close();
            printWindow.print();
          }
          break;
        }
        case 'dicom-sr': {
          // Export as DICOM SR JSON structure
          const srData = {
            sopClassUid: '1.2.840.10008.5.1.4.1.1.88.33', // Comprehensive SR
            measurements: measurements.map(m => ({
              type: m.type,
              coordinates: 'points' in m ? m.points : [],
              value: m.type === 'line' && 'lengthMm' in m ? m.lengthMm :
                     m.type === 'polygon' && 'areaMm2' in m ? m.areaMm2 : null,
              unit: m.type === 'line' ? 'mm' : 'mm^2',
            })),
          };
          downloadFile(JSON.stringify(srData, null, 2), `${filename}_sr.json`, 'application/json');
          break;
        }
        case 'dicom-files': {
          // Export as REAL DICOM files via backend API
          setSnackbarMessage('Creating DICOM export package...');

          if (!study?.study_instance_uid || !seriesKey) {
            setSnackbarMessage('Select a study and series before exporting.');
            break;
          }

          // Prepare tracking data for export
          const trackingExport = Array.from(trackingDataMap.entries()).map(([measurementId, data]) => {
            const m = measurementById.get(measurementId);
            const isPolygon = m ? isPolygonMeasurement(m) : false;
            return {
              measurementId,
              label: m?.label || undefined,
              frames: data.frames.map((f) => ({
                frameIndex: f.frameIndex,
                value: f.lengthMm ?? f.areaMm2 ?? 0,
              })),
              minMm: isPolygon ? data.summary.minAreaMm2 ?? null : data.summary.minMm,
              maxMm: isPolygon ? data.summary.maxAreaMm2 ?? null : data.summary.maxMm,
              meanMm: isPolygon ? data.summary.meanAreaMm2 ?? null : data.summary.meanMm,
              unit: isPolygon ? 'mm2' : 'mm',
            };
          });

          // Call backend API
          try {
            const blob = await api.export.exportDicomWithMeasurements({
              studyUid: study?.study_instance_uid || '',
              seriesUid: seriesKey || '',
              patientId: patientExportDetails.patientId,
              patientName: patientExportDetails.patientName,
              patientBirthDate: patientExportDetails.patientBirthDate,
              patientSex: patientExportDetails.patientSex,
              issuerOfPatientId: patientExportDetails.issuerOfPatientId,
              otherPatientIds: patientExportDetails.otherPatientIds,
              ethnicGroup: patientExportDetails.ethnicGroup,
              patientComments: patientExportDetails.patientComments,
              studyId: study?.study_id ?? undefined,
              studyDate: study?.study_date || undefined,
              studyTime: study?.study_time ?? undefined,
              studyDescription: study?.study_description || undefined,
              accessionNumber: study?.accession_number ?? undefined,
              referringPhysicianName: study?.referring_physician ?? undefined,
              seriesDescription: selectedSeries?.series.series_description || undefined,
              seriesNumber: selectedSeries?.series.series_number ?? undefined,
              bodyPartExamined: selectedSeries?.series.body_part_examined ?? undefined,
              patientPosition: selectedSeries?.series.patient_position ?? undefined,
              protocolName: selectedSeries?.series.protocol_name ?? undefined,
              sliceThickness: selectedSeries?.series.slice_thickness ?? undefined,
              spacingBetweenSlices: selectedSeries?.series.spacing_between_slices ?? undefined,
              windowCenter: selectedSeries?.window_center ?? undefined,
              windowWidth: selectedSeries?.window_width ?? undefined,
              modality: selectedSeries?.series.modality || 'US',
              measurements: measurements.map(m => ({
                id: m.id,
                type: m.type,
                label: m.label || undefined,
                points: 'points' in m ? m.points : [],
                lengthMm: m.type === 'line' && 'lengthMm' in m ? (m.lengthMm as number) : undefined,
                areaMm2: m.type === 'polygon' && 'areaMm2' in m ? (m.areaMm2 as number) : undefined,
                perimeterMm: m.type === 'polygon' && 'perimeterMm' in m ? (m.perimeterMm as number) : undefined,
                frameIndex: m.frameKey ? parseInt(m.frameKey.split(':')[1] || '0', 10) : undefined,
                instanceUid: m.instanceUid ?? undefined,
                seriesUid: m.seriesUid,
              })),
              trackingData: trackingExport,
              includeSr: true,
              includeSeg: false,
              includeOriginal: true,
              authorName: 'Horalix User',
              institutionName: study?.institution_name ?? 'Horalix Medical Imaging',
            });

            // Download the ZIP file
            api.export.downloadBlob(blob, `dicom_export_${timestamp}.zip`);
            setSnackbarMessage('DICOM export package downloaded successfully!');
          } catch (exportErr) {
            console.error('DICOM export failed:', exportErr);
            setSnackbarMessage('Failed to create DICOM export. Check console for details.');
          }
          break;
        }
      }
      if (format !== 'dicom-files') {
        setSnackbarMessage(`Measurements exported as ${format.toUpperCase()}.`);
      }
    } catch (err) {
      console.error('Export failed:', err);
      setSnackbarMessage('Failed to export measurements.');
    }

    setShowExportMenu(null);
  }, [measurementStore, study, selectedSeries, seriesKey, trackingDataMap, patientExportDetails]);

  // Import measurements handler
  const handleImportMeasurements = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data.measurements || !Array.isArray(data.measurements)) {
          setSnackbarMessage('Invalid measurement file format.');
          return;
        }

        // Import each measurement
        let importedCount = 0;
        for (const m of data.measurements) {
          if (m.type && m.seriesUid) {
            const inferredInstanceUid =
              m.instanceUid ?? resolveInstanceUidFromFrameKey(m.frameKey ?? null) ?? null;
            const normalized = {
              ...m,
              instanceUid: inferredInstanceUid,
            };
            measurementStore.createMeasurement(normalized, m.id);
            importedCount++;
          }
        }

        setSnackbarMessage(`Imported ${importedCount} measurements.`);
      } catch (err) {
        console.error('Import failed:', err);
        setSnackbarMessage('Failed to import measurements. Check file format.');
      }
    };
    input.click();
  }, [measurementStore]);

  const handleJumpToFrame = useCallback(
    (frameIndex: number) => {
      if (totalSlices <= 0) return;
      if (isPlaying) {
        setIsPlaying(false);
      }
      setCurrentSlice(clamp(frameIndex, 0, totalSlices - 1));
    },
    [totalSlices, isPlaying]
  );

  const handleAddBookmark = useCallback(() => {
    if (!seriesKey) {
      setSnackbarMessage('Select a series first.');
      return;
    }
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const label = `Frame ${currentSlice + 1}`;
    setCineBookmarks((prev) => [
      ...prev,
      { id, frameIndex: currentSlice, label, createdAt: Date.now() },
    ]);
    setSnackbarMessage('Cine bookmark added.');
  }, [seriesKey, currentSlice]);

  const handleRemoveBookmark = useCallback((bookmarkId: string) => {
    setCineBookmarks((prev) => prev.filter((bookmark) => bookmark.id !== bookmarkId));
    setSnackbarMessage('Bookmark removed.');
  }, []);

  const getFrameImageUrl = useCallback(
    (frameIdx: number) => {
      const frame = frameIndex[frameIdx];
      if (!frame) return null;
      return getFrameUrlForIndex(frame, renderOptions);
    },
    [frameIndex, renderOptions]
  );

  const copilotPhaseUrls = useMemo(() => {
    if (!cinePhaseFrames) return null;
    return {
      ed: getFrameImageUrl(cinePhaseFrames.edFrame),
      es: getFrameImageUrl(cinePhaseFrames.esFrame),
    };
  }, [cinePhaseFrames, getFrameImageUrl]);

  const handleCopilotCopyNarrative = useCallback(async () => {
    if (!copilotNarrative) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(copilotNarrative);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = copilotNarrative;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setSnackbarMessage('Guideline Copilot narrative copied.');
    } catch (err) {
      console.error('Failed to copy narrative', err);
      setSnackbarMessage('Unable to copy narrative.');
    }
  }, [copilotNarrative]);

  const handleCopilotExportFhir = useCallback(() => {
    const toIsoDate = (value?: string | null) => {
      if (!value) return undefined;
      if (/^\d{8}$/.test(value)) {
        return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
      }
      return value;
    };

    const subjectDisplay = patientDetails?.patient_name || study?.patient_name || 'Unknown Patient';
    const reportId = study?.study_instance_uid ? `report-${study.study_instance_uid}` : `report-${Date.now()}`;

    const observationEntries = contextMeasurements
      .map((measurement) => {
        const valueQuantity = isLineMeasurement(measurement)
          ? measurement.lengthMm
          : isPolygonMeasurement(measurement)
            ? measurement.areaMm2
            : null;
        if (valueQuantity === null || valueQuantity === undefined) return null;

        const unit = isLineMeasurement(measurement) ? 'mm' : 'mm^2';
        return {
          fullUrl: `urn:uuid:${measurement.id}`,
          resource: {
            resourceType: 'Observation',
            id: measurement.id,
            status: 'final',
            code: {
              text: measurement.label || `${measurement.type} measurement`,
            },
            subject: {
              display: subjectDisplay,
            },
            effectiveDateTime: toIsoDate(study?.study_date),
            valueQuantity: {
              value: Number(valueQuantity.toFixed(2)),
              unit,
            },
          },
        };
      })
      .filter(Boolean) as Array<{ fullUrl: string; resource: Record<string, unknown> }>;

    if (derivedMetrics.efPercent !== null) {
      observationEntries.push({
        fullUrl: 'urn:uuid:derived-ef',
        resource: {
          resourceType: 'Observation',
          id: 'derived-ef',
          status: 'final',
          code: { text: 'Ejection fraction' },
          subject: { display: subjectDisplay },
          effectiveDateTime: toIsoDate(study?.study_date),
          valueQuantity: {
            value: Number(derivedMetrics.efPercent.toFixed(1)),
            unit: '%',
          },
        },
      });
    }

    if (derivedMetrics.fsPercent !== null) {
      observationEntries.push({
        fullUrl: 'urn:uuid:derived-fs',
        resource: {
          resourceType: 'Observation',
          id: 'derived-fs',
          status: 'final',
          code: { text: 'Fractional shortening' },
          subject: { display: subjectDisplay },
          effectiveDateTime: toIsoDate(study?.study_date),
          valueQuantity: {
            value: Number(derivedMetrics.fsPercent.toFixed(1)),
            unit: '%',
          },
        },
      });
    }

    const reportResource = {
      resourceType: 'DiagnosticReport',
      id: reportId,
      status: 'final',
      code: { text: copilotTemplate.label },
      subject: { display: subjectDisplay },
      effectiveDateTime: toIsoDate(study?.study_date),
      result: observationEntries.map((entry) => ({ reference: entry.fullUrl })),
    };

    const bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        { resource: reportResource },
        ...observationEntries.map((entry) => ({ resource: entry.resource })),
      ],
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadFile(
      JSON.stringify(bundle, null, 2),
      `guideline_copilot_${timestamp}.fhir.json`,
      'application/json'
    );
    setSnackbarMessage('Guideline Copilot FHIR export created.');
  }, [
    contextMeasurements,
    derivedMetrics.efPercent,
    derivedMetrics.fsPercent,
    patientDetails?.patient_name,
    study?.patient_name,
    study?.study_date,
    study?.study_instance_uid,
    copilotTemplate.label,
  ]);

  const handleCopilotStartRequirement = useCallback(
    (requirement: CopilotRequirement) => {
      if (!seriesKey) {
        setSnackbarMessage('Select a series before adding measurements.');
        return;
      }
      if (requirement.type === 'polygon') {
        setActiveTool('polygon');
      } else {
        setActiveTool('measure');
      }
      setShowMeasurementPanel(true);
      if (canUseCineMeasurements) {
        setMeasurementScope('cine');
        setSnackbarMessage(`Draw ${requirement.label} on the cine loop.`);
      } else {
        setSnackbarMessage(`Draw ${requirement.label} on the current frame.`);
      }
    },
    [
      seriesKey,
      canUseCineMeasurements,
      setActiveTool,
      setMeasurementScope,
      setShowMeasurementPanel,
      setSnackbarMessage,
    ]
  );

  // Label edit handlers
  const handleOpenLabelEdit = useCallback((measurementId: string) => {
    const measurement = measurementStore.getMeasurement(measurementId);
    setLabelEditMeasurementId(measurementId);
    setLabelEditValue(measurement?.label || '');
    setLabelEditDialogOpen(true);
  }, [measurementStore]);

  const handleSaveLabelEdit = useCallback(() => {
    if (labelEditMeasurementId) {
      measurementStore.updateMeasurement(labelEditMeasurementId, { label: labelEditValue || null });
      setSnackbarMessage('Measurement label updated.');
    }
    setLabelEditDialogOpen(false);
    setLabelEditMeasurementId(null);
    setLabelEditValue('');
  }, [labelEditMeasurementId, labelEditValue, measurementStore]);

  const handleCancelLabelEdit = useCallback(() => {
    setLabelEditDialogOpen(false);
    setLabelEditMeasurementId(null);
    setLabelEditValue('');
  }, []);

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

  const ensureVolumeInfo = useCallback(async () => {
    if (!seriesKey) {
      setSnackbarMessage('Please select a series first');
      return null;
    }
    if (!has3dData) {
      setVolumeError('3D volume data is not available for this series.');
      setSnackbarMessage('3D volume tools are only available for CT/MR/PT series.');
      return null;
    }

    if (volumeInfo && volumeInfo.series_uid === seriesKey) {
      return volumeInfo;
    }

    setVolumeLoading(true);
    setVolumeError(null);
    try {
      const info = await api.series.getVolumeInfo(seriesKey);
      setVolumeInfo(info);
      setMprVolumeInfo(buildMprVolumeInfo(info, windowLevel));
      return info;
    } catch (err) {
      console.error('Failed to load volume info:', err);
      setVolumeError('Failed to load 3D volume data.');
      return null;
    } finally {
      setVolumeLoading(false);
    }
  }, [
    seriesKey,
    has3dData,
    volumeInfo,
    setMprVolumeInfo,
    windowLevel,
  ]);

  const openVolumeViewer = useCallback(async () => {
    if (!has3dData) {
      setSnackbarMessage('3D volume tools are only available for CT/MR/PT series.');
      return;
    }
    setVolumeOpen(true);
    const info = await ensureVolumeInfo();
    if (!info) return;
    if (!info.supports_mpr) {
      setSnackbarMessage('3D preview is not supported for this series.');
      setVolumeOpen(false);
      return;
    }
    setVolumeIndices({
      axial: Math.floor(info.dimensions.z / 2),
      coronal: Math.floor(info.dimensions.y / 2),
      sagittal: Math.floor(info.dimensions.x / 2),
    });
  }, [ensureVolumeInfo, has3dData]);

  const handleToggleLayout = useCallback(async () => {
    if (layoutMode === 'mpr') {
      setLayoutMode('single');
      clearMprVolume();
      return;
    }
    if (layoutMode === 'smart') {
      setLayoutMode('single');
      return;
    }
    if (!has3dData) {
      setSnackbarMessage('MPR layout is only available for CT/MR/PT series.');
      return;
    }

    const info = await ensureVolumeInfo();
    if (!info) return;
    if (!info.supports_mpr) {
      setSnackbarMessage('MPR layout is not supported for this series.');
      return;
    }
    setActiveMeasurement(null);
    setActivePolygon(null);
    setPolygonPreviewPoint(null);
    dragStateRef.current = null;
    setIsDragging(false);
    setLayoutMode('mpr');
  }, [layoutMode, ensureVolumeInfo, clearMprVolume, has3dData]);

  const handleToggleSmartLayout = useCallback(() => {
    setActiveMeasurement(null);
    setActivePolygon(null);
    setPolygonPreviewPoint(null);
    dragStateRef.current = null;
    setIsDragging(false);
    setLayoutMode((prev) => {
      if (prev === 'smart') return 'single';
      if (prev === 'mpr') {
        clearMprVolume();
      }
      return 'smart';
    });
  }, [clearMprVolume]);

  useEffect(() => {
    if (layoutMode !== 'mpr' || !seriesKey || !has3dData) return;
    ensureVolumeInfo();
  }, [layoutMode, seriesKey, has3dData, ensureVolumeInfo]);

  useEffect(() => {
    if (layoutMode !== 'mpr') return;
    if (has3dData) return;
    setLayoutMode('single');
    clearMprVolume();
  }, [layoutMode, has3dData, clearMprVolume]);

  useEffect(() => {
    if (layoutMode !== 'smart') return;
    let active = true;

    const loadDetails = async () => {
      const targets = smartHangSeries.filter(
        (series) => !smartHangDetails[series.series_instance_uid]
      );
      await Promise.all(
        targets.map(async (series) => {
          try {
            const detail = await api.series.get(series.series_instance_uid);
            if (!active) return;
            setSmartHangDetails((prev) => ({
              ...prev,
              [series.series_instance_uid]: detail,
            }));
          } catch (err) {
            console.error('Failed to load smart hang series', err);
          }
        })
      );
    };

    loadDetails();
    return () => {
      active = false;
    };
  }, [layoutMode, smartHangSeries, smartHangDetails]);

  useEffect(() => {
    if (activeTool !== 'polygon') {
      setPolygonPreviewPoint(null);
    }
  }, [activeTool]);

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

  const waitForJobWithProgress = useCallback(async (jobId: string) => {
    const startTime = Date.now();
    while (Date.now() - startTime < AI_JOB_TIMEOUT_MS) {
      const job = await api.ai.getJob(jobId);
      if (typeof job.progress === 'number') {
        setAiJobProgress(job.progress);
      }
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        return job;
      }
      await new Promise((resolve) => setTimeout(resolve, AI_JOB_POLL_INTERVAL_MS));
    }
    throw new Error(`Job ${jobId} timed out after ${AI_JOB_TIMEOUT_MS}ms`);
  }, []);

  const runAiModel = useCallback(
    async (model: AIModel, extraParameters?: Record<string, unknown>) => {
      if (!studyUid || !selectedSeries) {
        setSnackbarMessage('Please select a series first');
        return;
      }

      const displayModelName = formatAiModelLabel(model.name);
      const taskType = (model.details?.model_type || '').toLowerCase();
      const supportedTasks = ['segmentation', 'detection', 'classification', 'enhancement', 'pathology', 'cardiac'];
      if (!supportedTasks.includes(taskType)) {
        setSnackbarMessage('AI model has an unsupported task type');
        return;
      }

      try {
        setAiJobRunning(true);
        setAiJobProgress(0);
        setAIMenuAnchor(null);

        const parameters = {
          instance_uid: currentInstanceUid ?? undefined,
          ...(extraParameters ?? {}),
        } as Record<string, unknown>;
        if (patientContextOverride && model.name === 'horalix_ai' && parameters.patient_context === undefined) {
          parameters.patient_context = patientContextOverride;
        }

        const job = await api.ai.createJob({
          model_type: model.name,
          task_type: taskType,
          study_uid: studyUid,
          series_uid: selectedSeries.series.series_instance_uid,
          parameters,
        });

        const suffix = extraParameters?.model_weights
          ? ` (${String(extraParameters.model_weights).toUpperCase()})`
          : '';
        setSnackbarMessage(`AI job started: ${displayModelName}${suffix}`);

        const completedJob = await waitForJobWithProgress(job.job_id);

        if (completedJob.status === 'completed') {
          setSnackbarMessage(`AI analysis complete: ${displayModelName}`);
          await refreshAiResults();
          // Auto-open AI results panel for cardiac results
          if (taskType === 'cardiac') {
            setShowAiResultsPanel(true);
          }
        } else if (completedJob.status === 'failed') {
          setSnackbarMessage(`AI analysis failed: ${completedJob.error_message || 'Unknown error'}`);
        }
      } catch (err) {
        const detail = getApiErrorDetail(err);
        const message = err instanceof Error ? err.message : '';
        if (message.includes('timed out')) {
          setSnackbarMessage('AI job is still running. Results will appear when it finishes.');
          return;
        }
        console.error('AI job failed:', err);
        setSnackbarMessage(detail ? `AI analysis failed: ${detail}` : 'AI analysis failed');
      } finally {
        setAiJobProgress(null);
        setAiJobRunning(false);
      }
    },
    [
      studyUid,
      selectedSeries,
      currentInstanceUid,
      patientContextOverride,
      formatAiModelLabel,
      refreshAiResults,
      waitForJobWithProgress,
    ]
  );

  const handleRunAIModel = useCallback(
    (model: AIModel) => {
      setAIMenuAnchor(null);
      if (model.name === 'horalix_ai_measurements') {
        setPendingAiModel(model);
        setMeasurementsModelDialogOpen(true);
        return;
      }
      runAiModel(model);
    },
    [runAiModel]
  );

  const handleMeasurementsDialogClose = useCallback(() => {
    setMeasurementsModelDialogOpen(false);
    setPendingAiModel(null);
  }, []);

  const handleMeasurementsDialogRun = useCallback(() => {
    if (!pendingAiModel) {
      setMeasurementsModelDialogOpen(false);
      return;
    }
    const model = pendingAiModel;
    setPendingAiModel(null);
    setMeasurementsModelDialogOpen(false);
    runAiModel(model, { model_weights: measurementsModelSelection });
  }, [pendingAiModel, runAiModel, measurementsModelSelection]);

  const handleRerunAIWithContext = useCallback(
    (context: PatientContext | null) => {
      setPatientContextOverride(context);
      persistPatientContext(context);
      const cardiacModel = aiModels.find((m) => m.name === 'horalix_ai')
        ?? aiModels.find((m) => (m.details?.model_type || '').toLowerCase() === 'cardiac');
      if (cardiacModel) {
        runAiModel(cardiacModel, { patient_context: context });
      } else {
        setSnackbarMessage('No cardiac AI model available');
      }
    },
    [aiModels, runAiModel, persistPatientContext]
  );

  const latestCineMeasurement = useMemo(() => {
    if (!seriesKey) return null;
    const list = measurementsBySeries[seriesKey] ?? [];
    const filtered =
      cineGrouping === 'instance' && activeInstanceUid
        ? list.filter((measurement) => {
            const instanceUid = resolveMeasurementInstanceUid(measurement);
            return instanceUid ? instanceUid === activeInstanceUid : false;
          })
        : list;
    return filtered.length ? filtered[filtered.length - 1] : null;
  }, [seriesKey, measurementsBySeries, activeInstanceUid, cineGrouping, resolveMeasurementInstanceUid]);

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

  const pathologyTileCount = useMemo(
    () => getPathologyTileCount(latestPathologyJob?.results),
    [latestPathologyJob?.results]
  );

  const latestCardiacJob = useMemo(() => {
    if (!aiResults?.jobs?.length) return null;
    const jobs = aiResults.jobs.filter((job) => job.task_type === 'cardiac');
    if (jobs.length === 0) return null;
    const sorted = [...jobs].sort((a, b) => {
      const aTime = a.completed_at ? Date.parse(a.completed_at) : 0;
      const bTime = b.completed_at ? Date.parse(b.completed_at) : 0;
      return aTime - bTime;
    });
    return sorted[sorted.length - 1];
  }, [aiResults]);

  const aiViewPredictions = useMemo(() => {
    const output = latestCardiacJob?.results?.output as { view_predictions?: Record<string, string> } | undefined;
    if (!output || typeof output !== 'object') return {} as Record<string, string>;
    const predictions = output.view_predictions;
    if (!predictions || typeof predictions !== 'object') return {} as Record<string, string>;
    return predictions as Record<string, string>;
  }, [latestCardiacJob]);

  const getAiViewLabelForInstance = useCallback(
    (instanceUid?: string | null) => {
      if (!instanceUid) return null;
      const label = aiViewPredictions[instanceUid];
      return typeof label === 'string' && label.trim().length > 0 ? label : null;
    },
    [aiViewPredictions]
  );

  const getAiViewLabelForSeries = useCallback(
    (seriesUid: string) => {
      const detail = seriesCacheRef.current.get(seriesUid);
      if (!detail?.instances?.length) return null;
      const counts = new Map<string, number>();
      detail.instances.forEach((inst) => {
        const label = getAiViewLabelForInstance(inst.sop_instance_uid);
        if (!label) return;
        counts.set(label, (counts.get(label) ?? 0) + 1);
      });
      if (!counts.size) return null;
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    },
    [getAiViewLabelForInstance]
  );

  const activeAiViewLabel = useMemo(
    () => getAiViewLabelForInstance(activeInstanceUid),
    [activeInstanceUid, getAiViewLabelForInstance]
  );
  const handleTrackMeasurement = useCallback(async () => {
    if (!seriesKey) {
      setSnackbarMessage('Please select a series first');
      return;
    }
    if (!canUseCineMeasurements || effectiveMeasurementScope !== 'cine') {
      setSnackbarMessage('Switch to cine measurements to track the full loop.');
      return;
    }
    const measurement = latestCineMeasurement;
    if (!measurement) {
      setSnackbarMessage('Draw a measurement first.');
      return;
    }
    await trackMeasurementFor(
      seriesKey,
      measurement,
      currentSlice,
      cineGrouping === 'instance'
        ? resolveMeasurementInstanceUid(measurement) ?? currentInstanceUid ?? activeInstanceUid ?? null
        : null
    );
  }, [
    seriesKey,
    canUseCineMeasurements,
    effectiveMeasurementScope,
    latestCineMeasurement,
    currentSlice,
    trackMeasurementFor,
    currentInstanceUid,
    activeInstanceUid,
    cineGrouping,
    resolveMeasurementInstanceUid,
  ]);

  const orientationMarkers = getOrientationMarkers(currentInstanceMeta?.image_orientation_patient);

  const showLegacyAiOverlays = false;

  const detectionOverlays = useMemo(
    () =>
      showLegacyAiOverlays
        ? buildDetectionOverlays({
          aiResults,
          seriesUid: selectedSeries?.series.series_instance_uid ?? null,
          currentSlice,
          imageDimensions,
        })
        : [],
    [showLegacyAiOverlays, aiResults, selectedSeries, currentSlice, imageDimensions]
  );

  const segmentationOverlays = useMemo(
    () =>
      showLegacyAiOverlays
        ? buildSegmentationOverlays({
          aiResults,
          studyUid,
          seriesUid: selectedSeries?.series.series_instance_uid ?? null,
          currentSlice,
        })
        : [],
    [showLegacyAiOverlays, aiResults, studyUid, selectedSeries, currentSlice]
  );

  const cardiacOverlays = useMemo(
    () =>
      buildCardiacOverlays({
        aiResults,
        seriesUid: selectedSeries?.series.series_instance_uid ?? null,
        currentInstanceUid,
        currentFrameIndex,
      }),
    [aiResults, selectedSeries, currentInstanceUid, currentFrameIndex]
  );

  const overlayPalette = useMemo(() => {
    const isDark = theme.palette.mode === 'dark';
    return {
      measurement: theme.palette.info.main,
      measurementGlow: alpha(theme.palette.info.main, isDark ? 0.45 : 0.35),
      measurementLabelBg: isDark ? 'rgba(6, 10, 18, 0.75)' : 'rgba(240, 246, 255, 0.92)',
      measurementLabelText: isDark ? '#f8fafc' : '#0f172a',
      contour: theme.palette.error.main,
      contourFill: alpha(theme.palette.error.main, isDark ? 0.22 : 0.14),
      contourShadow: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.35)',
      shadow: isDark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.45)',
    };
  }, [theme]);

  const overlayTargets = useMemo<OverlayTarget[]>(() => collectOverlayTargets(aiResults), [aiResults]);

  const visibleCardiacOverlayCount =
    (showMeasurementOverlay ? cardiacOverlays.lines.length : 0) +
    (showContourOverlay ? cardiacOverlays.polylines.length : 0);

  const handleJumpToNextOverlay = useCallback(async () => {
    if (overlayTargets.length === 0) return;
    const currentKeyMatch = overlayTargets.findIndex(
      (target) =>
        target.instanceUid === currentInstanceUid &&
        (target.frameIndex ?? 0) === currentFrameIndex
    );
    const nextIndex = currentKeyMatch >= 0 ? (currentKeyMatch + 1) % overlayTargets.length : 0;
    const next = overlayTargets[nextIndex];
    await jumpToInstanceFrame(next.instanceUid, next.frameIndex ?? 0);
  }, [overlayTargets, currentInstanceUid, currentFrameIndex, jumpToInstanceFrame]);

  const interactiveSegmentationOverlays = useMemo(
    () =>
      buildInteractiveSegmentationOverlays({
        interactiveSegmentations,
        studyUid,
        seriesKey,
        currentInstanceUid,
        currentFrameIndex,
      }),
    [interactiveSegmentations, studyUid, seriesKey, currentInstanceUid, currentFrameIndex]
  );

  const cursor = useMemo(() => {
    if (layoutMode !== 'single') return 'default';
    if (isDragging) return 'grabbing';
    switch (activeTool) {
      case 'pointer':
        return 'default';
      case 'pan':
        return canPan ? 'grab' : 'default';
      case 'zoom':
        return 'zoom-in';
      case 'wwwl':
        return 'crosshair';
      case 'measure':
        return 'crosshair';
      case 'polygon':
        return 'crosshair';
      case 'segment':
        return 'crosshair';
      case 'rotate':
        return 'ew-resize';
      default:
        return 'default';
    }
  }, [activeTool, isDragging, canPan, layoutMode]);

  const tools = VIEWER_TOOL_CONFIGS;

  if (loading) {
    return (
      <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
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
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <Paper
        sx={{
          display: 'flex',
          alignItems: 'center',
          px: 1.5,
          py: 0.75,
          borderRadius: 0,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
          boxShadow: '0 1px 0 rgba(0,0,0,0.08)',
          gap: 0.25,
          '& .MuiIconButton-root': {
            borderRadius: 1,
            padding: 0.75,
            color: 'text.secondary',
            transition: 'all 0.15s ease',
            '&:hover': {
              bgcolor: 'action.hover',
              color: 'text.primary',
            },
          },
          '& .MuiIconButton-colorPrimary': {
            color: 'primary.main',
            bgcolor: 'action.selected',
            '&:hover': {
              bgcolor: 'action.selected',
            },
          },
          '& .MuiButton-root': {
            borderRadius: 1.4,
            textTransform: 'none',
            fontWeight: 600,
          },
        }}
        elevation={0}
      >
        <Tooltip title="Back to Studies">
          <IconButton onClick={() => navigate('/studies')}>
            <BackIcon />
          </IconButton>
        </Tooltip>

        <Divider orientation="vertical" flexItem sx={{ mx: 1, borderColor: 'divider', opacity: 0.6 }} />

        {tools.map((tool) => (
          <Tooltip key={tool.id} title={tool.label}>
            <IconButton
              onClick={() => {
                if (tool.id === 'rotate') {
                  setRotation((prev) => (prev + 90) % 360);
                  if (autoFitOnRotate) {
                    setPan({ x: 0, y: 0 });
                  }
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

        <Tooltip
          title={
            canUseCineMeasurements
              ? `Measurements: ${effectiveMeasurementScope === 'cine' ? 'Cine' : 'Frame'}`
              : 'Measurements: Frame (locked)'
          }
        >
          <span>
            <IconButton
              onClick={() => {
                if (!canUseCineMeasurements) {
                  setSnackbarMessage('Cine measurements are disabled for this series.');
                  return;
                }
                setMeasurementScope((prev) => (prev === 'cine' ? 'frame' : 'cine'));
              }}
              color={effectiveMeasurementScope === 'cine' ? 'primary' : 'default'}
              aria-label="Toggle measurement scope"
              disabled={(activeTool !== 'measure' && activeTool !== 'polygon') || !canUseCineMeasurements}
            >
              {effectiveMeasurementScope === 'cine' ? <LinkIcon /> : <LinkOffIcon />}
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title="Record cine measurement">
          <span>
            <IconButton
              onClick={handleTrackMeasurement}
              disabled={
                activeTool !== 'measure' ||
                effectiveMeasurementScope !== 'cine' ||
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

        <Tooltip title="Cardiac Function Calculator (EF/FS)">
          <IconButton
            onClick={() => setEfCalculatorOpen(true)}
            color={contextMeasurements.length > 0 ? 'primary' : 'default'}
          >
            <FavoriteIcon />
          </IconButton>
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

        <Divider orientation="vertical" flexItem sx={{ mx: 1, borderColor: 'divider', opacity: 0.6 }} />

        <Tooltip title="3D Volume">
          <span>
            <IconButton onClick={openVolumeViewer} disabled={!has3dData}>
              <ThreeDIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Layout">
          <IconButton
            onClick={handleToggleLayout}
            color={layoutMode === 'mpr' ? 'primary' : 'default'}
            disabled={!has3dData}
          >
            <GridIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Smart Hanging Layout">
          <IconButton
            onClick={handleToggleSmartLayout}
            color={layoutMode === 'smart' ? 'primary' : 'default'}
          >
            <SmartLayoutIcon />
          </IconButton>
        </Tooltip>
        {cineGrouping === 'instance' && seriesInstances.length > 1 && (
          <>
            <Tooltip title="Select cine instance">
              <Button
                size="small"
                variant="outlined"
                onClick={(event) => setInstanceMenuAnchor(event.currentTarget)}
                sx={{ ml: 1 }}
              >
                {activeInstanceIndex >= 0
                  ? `Cine ${activeInstanceIndex + 1}/${seriesInstances.length}`
                  : 'Cine'}
              </Button>
            </Tooltip>
            <Menu
              anchorEl={instanceMenuAnchor}
              open={Boolean(instanceMenuAnchor)}
              onClose={() => setInstanceMenuAnchor(null)}
            >
              {seriesInstances.map((instance, idx) => (
                <MenuItem
                  key={instance.sop_instance_uid}
                  selected={instance.sop_instance_uid === activeInstanceUid}
                  onClick={() => {
                    setActiveInstanceUid(instance.sop_instance_uid);
                    setInstanceMenuAnchor(null);
                  }}
                >
                  Cine {idx + 1}
                  {instance.instance_number != null ? ` · #${instance.instance_number}` : ''}
                  {instance.number_of_frames != null ? ` · ${instance.number_of_frames} frames` : ''}
                </MenuItem>
              ))}
            </Menu>
          </>
        )}
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
        <Tooltip title="Measurements Panel">
          <IconButton
            onClick={() => setShowMeasurementPanel((prev) => !prev)}
            color={showMeasurementPanel ? 'primary' : 'default'}
          >
            <FormatListBulletedIcon />
          </IconButton>
        </Tooltip>

        <Box sx={{ flex: 1, minWidth: 0, mx: 2 }}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
            sx={{ minWidth: 0 }}
          >
            <Chip
              size="small"
              label={`Patient ${patientLabel}`}
              variant="outlined"
              sx={{ fontWeight: 600 }}
            />
            <Chip
              size="small"
              label={`Study ${studyLabel}`}
              variant="outlined"
              sx={{ fontWeight: 600 }}
            />
            <Chip
              size="small"
              label={`Series ${seriesLabel}`}
              variant="outlined"
              sx={{ fontWeight: 600 }}
            />
          </Stack>
        </Box>

        <Tooltip title="AI Results Panel">
          <IconButton
            onClick={() => setShowAiResultsPanel((prev) => !prev)}
            color={showAiResultsPanel ? 'primary' : 'default'}
          >
            <FavoriteIcon />
          </IconButton>
        </Tooltip>

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
                  primary={formatAiModelLabel(model.name)}
                  secondary={model.available ? model.details.model_type : 'Not available'}
                />
              </MenuItem>
            ))
          )}
        </Menu>

        <Tooltip title="Export">
          <IconButton onClick={(event) => setShowExportMenu(event.currentTarget)}>
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

      {(aiJobRunning || segmentRunning) && (
        <Box sx={{ px: 2, pb: 1 }}>
          <LinearProgress
            variant={aiJobRunning && aiJobProgress != null ? 'determinate' : 'indeterminate'}
            value={aiJobRunning && aiJobProgress != null ? aiJobProgress : undefined}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            {segmentRunning
              ? 'Smart segmentation in progress...'
              : aiJobProgress != null
                ? `AI job progress: ${Math.round(aiJobProgress)}%`
                : 'AI job running...'}
          </Typography>
        </Box>
      )}

      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {showSeriesPanel && (
          <Paper
            sx={{
              width: 280,
              borderRadius: 0,
              overflow: 'auto',
              borderRight: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
            }}
            elevation={0}
          >
            <Box sx={{ p: 2 }}>
              <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, color: 'text.secondary' }}>
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
                  const aiViewLabel = getAiViewLabelForSeries(s.series_instance_uid);
                  const viewLabel = s.modality === 'US'
                    ? (aiViewLabel ?? getSeriesViewLabel(s) ?? 'Unknown')
                    : null;
                  return (
                    <ListItem key={s.series_instance_uid} disablePadding>
                      <ListItemButton
                        selected={selectedSeries?.series.series_instance_uid === s.series_instance_uid}
                        onClick={() => selectSeries(s.series_instance_uid)}
                        sx={{
                          mx: 1,
                          my: 0.5,
                          borderRadius: 2,
                          border: '1px solid transparent',
                          '&.Mui-selected': {
                            bgcolor: 'action.selected',
                            borderColor: 'primary.main',
                          },
                        }}
                      >
                        <Box
                          sx={{
                            width: 60,
                            height: 60,
                            bgcolor: 'action.hover',
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
                          secondary={(
                            <Stack direction="row" spacing={0.6} alignItems="center">
                              <Typography variant="caption" color="text.secondary">
                                {s.num_instances} images
                              </Typography>
                              {viewLabel && (
                                <Chip
                                  size="small"
                                  label={viewLabel}
                                  sx={{
                                    height: 18,
                                    fontSize: '0.55rem',
                                    fontWeight: 700,
                                    bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.2 : 0.12),
                                    color: theme.palette.primary.main,
                                  }}
                                />
                              )}
                            </Stack>
                          )}
                          primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                          secondaryTypographyProps={{ component: 'div' }}
                        />
                      </ListItemButton>
                    </ListItem>
                  );
                })
              )}
            </List>
            {cineSeriesList.length > 0 && (
              <>
                <Divider sx={{ my: 1 }} />
                <Box sx={{ px: 2, pb: 1 }}>
                  <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, color: 'text.secondary' }}>
                    Cines ({cineSeriesList.length})
                  </Typography>
                </Box>
                <List disablePadding>
                  {cineSeriesList.map((cineSeries) => {
                    const thumbnail = seriesThumbnails[cineSeries.series_instance_uid];
                    const aiViewLabel = getAiViewLabelForSeries(cineSeries.series_instance_uid);
                    const viewLabel = cineSeries.modality === 'US'
                      ? (aiViewLabel ?? getSeriesViewLabel(cineSeries) ?? 'Unknown')
                      : null;
                    const detail = seriesCacheRef.current.get(cineSeries.series_instance_uid);
                    const cineFrames = detail?.instances?.reduce(
                      (sum, instance) => sum + (instance.number_of_frames ?? 1),
                      0
                    );
                    const frameLabel = cineFrames ?? cineSeries.num_instances ?? 1;
                    return (
                      <ListItem key={cineSeries.series_instance_uid} disablePadding>
                      <ListItemButton
                        selected={
                          selectedSeries?.series.series_instance_uid === cineSeries.series_instance_uid
                        }
                        onClick={() => selectSeries(cineSeries.series_instance_uid)}
                        sx={{
                          mx: 1,
                          my: 0.5,
                          borderRadius: 2,
                          border: '1px solid transparent',
                          '&.Mui-selected': {
                            bgcolor: 'action.selected',
                            borderColor: 'primary.main',
                          },
                        }}
                      >
                        <Box
                          sx={{
                            width: 48,
                            height: 48,
                            bgcolor: 'action.hover',
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
                                alt={`${cineSeries.series_description || 'Cine'} thumbnail`}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            ) : (
                              <Typography variant="caption" color="grey.500">
                                {cineSeries.modality}
                              </Typography>
                            )}
                          </Box>
                          <ListItemText
                            primary={cineSeries.series_description || `Series ${cineSeries.series_number || '-'}`}
                            secondary={(
                              <Stack direction="row" spacing={0.6} alignItems="center">
                                <Typography variant="caption" color="text.secondary">
                                  {frameLabel} frames
                                </Typography>
                                {viewLabel && (
                                  <Chip
                                    size="small"
                                    label={viewLabel}
                                    sx={{
                                      height: 18,
                                      fontSize: '0.55rem',
                                      fontWeight: 700,
                                      bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.2 : 0.12),
                                      color: theme.palette.primary.main,
                                    }}
                                  />
                                )}
                              </Stack>
                            )}
                            primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                            secondaryTypographyProps={{ component: 'div' }}
                          />
                        </ListItemButton>
                      </ListItem>
                    );
                  })}
                </List>
              </>
            )}
            {selectedSeries && cineGrouping === 'instance' && seriesInstances.length > 1 && (
              <>
                <Divider sx={{ my: 1 }} />
                <Box sx={{ px: 2, pb: 1 }}>
                  <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, color: 'text.secondary' }}>
                    Cines ({seriesInstances.length})
                  </Typography>
                </Box>
                <List disablePadding>
                  {seriesInstances.map((instance, index) => {
                    const thumb = api.instances.getThumbnailUrl(instance.sop_instance_uid, 64);
                    const isActive = instance.sop_instance_uid === activeInstanceUid;
                    const frames = instance.number_of_frames ?? 1;
                    const aiViewLabel = getAiViewLabelForInstance(instance.sop_instance_uid);
                    const cineViewLabel = selectedSeries?.series.modality === 'US'
                      ? (aiViewLabel ?? selectedSeriesViewLabel ?? 'Unknown')
                      : null;
                    return (
                      <ListItem key={instance.sop_instance_uid} disablePadding>
                        <ListItemButton
                          selected={isActive}
                          onClick={() => setActiveInstanceUid(instance.sop_instance_uid)}
                          sx={{
                            mx: 1,
                            my: 0.5,
                            borderRadius: 2,
                            border: '1px solid transparent',
                            '&.Mui-selected': {
                              bgcolor: 'action.selected',
                              borderColor: 'primary.main',
                            },
                          }}
                        >
                          <Box
                            sx={{
                              width: 48,
                              height: 48,
                              bgcolor: 'action.hover',
                              borderRadius: 1,
                              mr: 1,
                              overflow: 'hidden',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <img
                              src={thumb}
                              alt={`Cine ${index + 1}`}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          </Box>
                          <ListItemText
                            primary={`Cine ${index + 1}`}
                            secondary={(
                              <Stack direction="row" spacing={0.6} alignItems="center">
                                <Typography variant="caption" color="text.secondary">
                                  {frames} frames
                                </Typography>
                                {cineViewLabel && (
                                  <Chip
                                    size="small"
                                    label={cineViewLabel}
                                    sx={{
                                      height: 18,
                                      fontSize: '0.55rem',
                                      fontWeight: 700,
                                      bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.2 : 0.12),
                                      color: theme.palette.primary.main,
                                    }}
                                  />
                                )}
                              </Stack>
                            )}
                            primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                            secondaryTypographyProps={{ component: 'div' }}
                          />
                        </ListItemButton>
                      </ListItem>
                    );
                  })}
                </List>
              </>
            )}
          </Paper>
        )}

        <Box
          ref={viewportRef}
          sx={{
            flex: 1,
            position: 'relative',
            bgcolor: '#000',
            cursor: layoutMode !== 'single' ? 'default' : cursor,
            userSelect: 'none',
            touchAction: 'none',
            overflow: 'hidden',
          }}
          onMouseDown={layoutMode === 'single' ? handleMouseDown : undefined}
          onMouseMove={
            layoutMode === 'single'
              ? (event) => {
                  lastPointerRef.current = { x: event.clientX, y: event.clientY };
                }
              : undefined
          }
          onWheel={layoutMode === 'single' ? handleWheel : undefined}
          onDoubleClick={
            layoutMode === 'single'
              ? () => {
                  if (activeTool === 'polygon' && activePolygon && activePolygon.points.length >= 3) {
                    handlePolygonDoubleClick();
                  } else {
                    handleResetView();
                  }
                }
              : undefined
          }
          onContextMenu={layoutMode === 'single' ? (event) => event.preventDefault() : undefined}
        >
          {layoutMode === 'mpr' && seriesKey ? (
            <Box sx={{ position: 'absolute', inset: 0 }}>
              <MPRLayout
                seriesUid={seriesKey}
                getMPRImageUrl={(plane, index) => getMprUrl(plane, index)}
              />
            </Box>
          ) : layoutMode === 'smart' ? (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                p: 2,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 2,
                overflow: 'auto',
              }}
            >
              {smartHangSeries.length === 0 ? (
                <Box
                  sx={{
                    gridColumn: '1 / -1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'text.secondary',
                  }}
                >
                  <Typography variant="body2">No series available for smart layout.</Typography>
                </Box>
              ) : (
                smartHangSeries.map((series) => {
                  const detail = smartHangDetails[series.series_instance_uid];
                  const firstInstance = detail?.instances?.[0];
                  const instanceUid = firstInstance?.sop_instance_uid ?? null;
                  const previewWindow = detail ? getWindowDefaults(detail) : null;
                  const thumbnail = instanceUid
                    ? api.instances.getPixelDataUrl(instanceUid, {
                        frame: 0,
                        windowCenter: previewWindow?.center,
                        windowWidth: previewWindow?.width,
                        format: 'jpeg',
                        quality: 80,
                      })
                    : null;
                  const frameCount =
                    firstInstance?.number_of_frames ??
                    detail?.instances?.length ??
                    series.num_instances;
                  const isSelected = series.series_instance_uid === seriesKey;
                  return (
                    <Paper
                      key={series.series_instance_uid}
                      sx={{
                        p: 1.5,
                        borderRadius: 2,
                        border: '1px solid',
                        borderColor: isSelected ? 'primary.main' : 'divider',
                        bgcolor: isSelected ? 'action.selected' : 'background.paper',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        '&:hover': {
                          borderColor: 'primary.main',
                          boxShadow: 2,
                        },
                      }}
                      onClick={() => {
                        setLayoutMode('single');
                        selectSeries(series.series_instance_uid);
                      }}
                    >
                      <Box
                        sx={{
                          width: '100%',
                          aspectRatio: '4 / 3',
                          bgcolor: 'grey.900',
                          borderRadius: 1,
                          overflow: 'hidden',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {thumbnail ? (
                          <img
                            src={thumbnail}
                            alt={series.series_description || 'Series preview'}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <Typography variant="caption" color="grey.400">
                            {series.modality}
                          </Typography>
                        )}
                      </Box>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        <Typography variant="body2" fontWeight={600} noWrap>
                          {series.series_description || `Series ${series.series_number ?? '-'}`}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {series.protocol_name || series.body_part_examined || 'Smart hang pick'}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                          <Chip label={series.modality} size="small" />
                          <Typography variant="caption" color="text.secondary">
                            {frameCount ?? '-'} frames
                          </Typography>
                          <Box sx={{ flex: 1 }} />
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={(event) => {
                              event.stopPropagation();
                              setLayoutMode('single');
                              selectSeries(series.series_instance_uid);
                            }}
                          >
                            Open
                          </Button>
                        </Box>
                      </Box>
                    </Paper>
                  );
                })
              )}
            </Box>
          ) : currentInstanceUid ? (
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
                    filter: colorFilter,
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
                  {showLegacyAiOverlays && showAiOverlay &&
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

                  {showLegacyAiOverlays && showAiOverlay &&
                    interactiveSegmentationOverlays.map((overlay) => (
                      <image
                        key={`interactive-${overlay.id}`}
                        href={overlay.url}
                        x={0}
                        y={0}
                        width={imageDimensions.columns}
                        height={imageDimensions.rows}
                        opacity={0.55}
                      />
                    ))}

                  {showLegacyAiOverlays && showAiOverlay &&
                    detectionOverlays.map((box, idx) => (
                      <g key={`det-${idx}`}>
                        <rect
                          x={box.x}
                          y={box.y}
                          width={box.width}
                          height={box.height}
                          fill="none"
                          stroke={theme.palette.warning.main}
                          strokeWidth={2}
                        />
                        <text
                          x={box.x}
                          y={Math.max(12, box.y - 4)}
                          fill={theme.palette.warning.main}
                          fontSize={12}
                          fontFamily="monospace"
                        >
                          {box.label}
                        </text>
                      </g>
                    ))}

                  {/* Cardiac line overlays (measurements from horalix_ai) */}
                  {showAiOverlay && showMeasurementOverlay &&
                    cardiacOverlays.lines.map((line) => {
                      const measurementValue =
                        typeof line.measurementValue === 'number' && Number.isFinite(line.measurementValue)
                          ? line.measurementValue
                          : null;
                      const labelText = measurementValue !== null
                        ? `${line.label} ${measurementValue.toFixed(2)} ${line.measurementUnit || ''}`
                        : line.label;
                      const labelX = (line.x1 + line.x2) / 2;
                      const labelY = Math.max(12, Math.min(line.y1, line.y2) - 12);
                      const labelWidth = Math.max(36, labelText.length * 6.2 + 8);
                      const labelHeight = 14;
                      const lineColor = overlayPalette.measurement;
                      return (
                        <g key={`cardiac-line-${line.id}`}>
                          {/* Shadow line for contrast */}
                          <line
                            x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
                            stroke={overlayPalette.shadow} strokeWidth={4} strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                          />
                          {/* Measurement line */}
                          <line
                            x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
                            stroke={lineColor} strokeWidth={2.2} strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                          />
                          {/* Endpoint markers */}
                          <circle cx={line.x1} cy={line.y1} r={4} fill={lineColor} stroke="#0b1220" strokeWidth={1} />
                          <circle cx={line.x2} cy={line.y2} r={4} fill={lineColor} stroke="#0b1220" strokeWidth={1} />
                          {/* Label with background */}
                          {labelText && (
                            <>
                              <rect
                                x={labelX - labelWidth / 2}
                                y={labelY - labelHeight}
                                width={labelWidth}
                                height={labelHeight}
                                fill={overlayPalette.measurementLabelBg}
                                rx={3}
                              />
                              <text
                                x={labelX}
                                y={labelY - 3}
                                fill={overlayPalette.measurementLabelText}
                                fontSize={10}
                                fontFamily="monospace"
                                fontWeight="bold"
                                textAnchor="middle"
                              >
                                {labelText}
                              </text>
                            </>
                          )}
                        </g>
                      );
                    })}

                  {/* Cardiac polyline overlays (contours from horalix_ai) */}
                  {showAiOverlay && showContourOverlay &&
                    cardiacOverlays.polylines.map((poly) => (
                      <g key={`cardiac-poly-${poly.id}`}>
                        {/* Shadow for contrast */}
                        {poly.closed ? (
                          <polygon
                            points={poly.points}
                            fill="none"
                            stroke={overlayPalette.contourShadow}
                            strokeWidth={4}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                          />
                        ) : (
                          <polyline
                            points={poly.points}
                            fill="none"
                            stroke={overlayPalette.contourShadow}
                            strokeWidth={4}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                          />
                        )}
                        {/* Contour */}
                        {poly.closed ? (
                          <polygon
                            points={poly.points}
                            fill={overlayPalette.contourFill}
                            stroke={overlayPalette.contour}
                            strokeWidth={2.2}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                          />
                        ) : (
                          <polyline
                            points={poly.points}
                            fill="none"
                            stroke={overlayPalette.contour}
                            strokeWidth={2.2}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                          />
                        )}
                      </g>
                    ))}

                  {(activeTool === 'segment' || segmentPromptPoints.length > 0) && (
                    <g>
                      {segmentPromptPoints.map((point, index) => (
                        <g key={`segment-point-${index}`}>
                          <circle
                            cx={point.x}
                            cy={point.y}
                            r={5}
                            fill={point.label === 1 ? '#10b981' : '#ef4444'}
                            stroke="#fff"
                            strokeWidth={1.5}
                          />
                          <text
                            x={point.x + 8}
                            y={point.y - 6}
                            fill={point.label === 1 ? '#10b981' : '#ef4444'}
                            fontSize={10}
                            fontFamily="monospace"
                          >
                            {point.label === 1 ? 'FG' : 'BG'}
                          </text>
                        </g>
                      ))}
                    </g>
                  )}

                  {/* Measurements */}
                  {lineRenderModels.map((model) => (
                    <g
                      key={model.id}
                      style={{ cursor: activeTool === 'pointer' ? 'pointer' : 'default' }}
                    >
                      {model.trailSegments.map((segment) => (
                        <line
                          key={segment.id}
                          x1={segment.x1}
                          y1={segment.y1}
                          x2={segment.x2}
                          y2={segment.y2}
                          stroke={model.strokeColor}
                          strokeWidth={segment.strokeWidth}
                          opacity={segment.opacity}
                        />
                      ))}
                      {model.isSelected && (
                        <line
                          x1={model.start.x}
                          y1={model.start.y}
                          x2={model.end.x}
                          y2={model.end.y}
                          stroke="#fff"
                          strokeWidth={model.strokeWidth + 2}
                          opacity={0.5}
                        />
                      )}
                      <line
                        x1={model.start.x}
                        y1={model.start.y}
                        x2={model.end.x}
                        y2={model.end.y}
                        stroke={model.strokeColor}
                        strokeWidth={model.strokeWidth}
                      />
                      <circle
                        cx={model.start.x}
                        cy={model.start.y}
                        r={model.handleRadius}
                        fill={model.strokeColor}
                        stroke={model.isSelected ? '#fff' : 'none'}
                        strokeWidth={2}
                      />
                      <circle
                        cx={model.end.x}
                        cy={model.end.y}
                        r={model.handleRadius}
                        fill={model.strokeColor}
                        stroke={model.isSelected ? '#fff' : 'none'}
                        strokeWidth={2}
                      />
                      {model.label && (
                        <text
                          x={model.label.x}
                          y={model.label.y}
                          fill={model.strokeColor}
                          fontSize={12}
                          fontFamily="monospace"
                          fontWeight={model.label.emphasized ? 'bold' : 'normal'}
                        >
                          {model.label.text}
                        </text>
                      )}
                    </g>
                  ))}

                  {polygonRenderModels.map((model) => (
                    <g
                      key={model.id}
                      style={{ cursor: activeTool === 'pointer' ? 'pointer' : 'default' }}
                    >
                      {model.trailPaths.map((trail) => (
                        <path
                          key={trail.id}
                          d={trail.d}
                          fill="none"
                          stroke={model.strokeColor}
                          strokeWidth={trail.strokeWidth}
                          opacity={trail.opacity}
                        />
                      ))}
                      {model.previewPath && (
                        <path
                          d={model.previewPath}
                          fill="none"
                          stroke={model.strokeColor}
                          strokeWidth={model.isSelected ? 2 : 1.5}
                          opacity={0.35}
                          strokeLinejoin="round"
                        />
                      )}
                      <path
                        d={model.pathD}
                        fill={model.isActive ? 'none' : model.fillColor}
                        stroke={model.strokeColor}
                        strokeWidth={model.strokeWidth}
                        strokeDasharray={model.isActive ? '5,5' : 'none'}
                        strokeLinejoin="round"
                      />
                      {model.vertexHandles.map((handle) => (
                        <circle
                          key={handle.id}
                          cx={handle.x}
                          cy={handle.y}
                          r={handle.radius}
                          fill={handle.fill}
                          stroke={handle.stroke}
                          strokeWidth={2}
                        />
                      ))}
                      {model.areaLabel && (
                        <text
                          x={model.areaLabel.x}
                          y={model.areaLabel.y}
                          fill={model.strokeColor}
                          fontSize={12}
                          fontFamily="monospace"
                          fontWeight={model.areaLabel.emphasized ? 'bold' : 'normal'}
                          textAnchor="middle"
                          dominantBaseline="middle"
                        >
                          {model.areaLabel.text}
                        </text>
                      )}
                      {model.instructionLabel && (
                        <text
                          x={model.instructionLabel.x}
                          y={model.instructionLabel.y}
                          fill="#10b981"
                          fontSize={10}
                          fontFamily="sans-serif"
                          textAnchor="middle"
                          dominantBaseline="middle"
                          opacity={0.8}
                        >
                          {model.instructionLabel.text}
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

          {layoutMode === 'single' && imageError && (
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

          {layoutMode === 'single' && (
            <>
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
              <Typography variant="body2">
                Patient ID: {patientDetails?.patient_id || study?.patient_id || '-'}
              </Typography>
              <Typography variant="body2">Study Date: {study?.study_date || '-'}</Typography>
              <Typography variant="body2">Accession: {study?.accession_number || '-'}</Typography>
              <Button
                variant="outlined"
                size="small"
                onClick={openMetadataEditor}
                sx={{ mt: 1 }}
                disabled={!study}
              >
                Edit Metadata
              </Button>

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
                Cine Bookmarks
              </Typography>
              {cineBookmarks.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No bookmarks yet. Use the bookmark button during cine playback.
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {cineBookmarks
                    .sort((a, b) => a.frameIndex - b.frameIndex)
                    .map((bookmark) => (
                      <Chip
                        key={bookmark.id}
                        size="small"
                        label={`${bookmark.label}`}
                        onClick={() => handleJumpToFrame(bookmark.frameIndex)}
                        onDelete={() => handleRemoveBookmark(bookmark.id)}
                      />
                    ))}
                </Box>
              )}

              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Smart Segment
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Click inside a cavity to auto-contour. Shift/Alt-click adds a background point.
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Chip size="small" color={medsamStatusColor} label={`MedSAM: ${medsamStatusLabel}`} />
                <Button
                  size="small"
                  variant="outlined"
                  onClick={handlePreloadMedsam}
                  disabled={medsamPreloading || medsamStatus === 'loaded' || !medsamModel?.available}
                  startIcon={medsamPreloading ? <CircularProgress size={14} /> : undefined}
                >
                  {medsamPreloading ? 'Loading MedSAM...' : 'Preload MedSAM'}
                </Button>
              </Stack>
              {medsamModel && !medsamModel.available && medsamModel.requirements?.weights_path && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  Weights path: {medsamModel.requirements.weights_path}
                </Typography>
              )}
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Button
                  size="small"
                  variant={activeTool === 'segment' ? 'contained' : 'outlined'}
                  onClick={() => setActiveTool('segment')}
                >
                  Activate
                </Button>
                <Button size="small" variant="outlined" onClick={() => setSegmentPromptPoints([])}>
                  Clear
                </Button>
              </Stack>
              <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'center' }}>
                <Button
                  size="small"
                  variant={segmentPointMode === 1 ? 'contained' : 'outlined'}
                  onClick={() => setSegmentPointMode(1)}
                >
                  FG
                </Button>
                <Button
                  size="small"
                  variant={segmentPointMode === 0 ? 'contained' : 'outlined'}
                  onClick={() => setSegmentPointMode(0)}
                >
                  BG
                </Button>
                <Chip size="small" label={`${segmentPromptPoints.length} pts`} />
              </Stack>
              <FormControlLabel
                control={
                  <Switch
                    checked={segmentAutoRun}
                    onChange={(event) => setSegmentAutoRun(event.target.checked)}
                  />
                }
                label="Auto-run after click"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={segmentAutoSeed}
                    onChange={(event) => setSegmentAutoSeed(event.target.checked)}
                  />
                }
                label="Auto-seed around click"
              />
              {segmentAutoSeed && (
                <Box sx={{ pl: 3, pr: 1, mb: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Auto points per click
                  </Typography>
                  <Slider
                    value={segmentAutoPointCount}
                    onChange={(_, value) => setSegmentAutoPointCount(value as number)}
                    min={1}
                    max={9}
                    step={1}
                    size="small"
                    sx={{ mt: 0.5 }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Auto point radius (px)
                  </Typography>
                  <Slider
                    value={segmentAutoPointRadius}
                    onChange={(_, value) => setSegmentAutoPointRadius(value as number)}
                    min={4}
                    max={30}
                    step={2}
                    size="small"
                    sx={{ mt: 0.5 }}
                  />
                </Box>
              )}
              <FormControlLabel
                control={
                  <Switch
                    checked={segmentAutoNegativePoints}
                    onChange={(event) => setSegmentAutoNegativePoints(event.target.checked)}
                  />
                }
                label="Add background points"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={segmentAutoBox}
                    onChange={(event) => setSegmentAutoBox(event.target.checked)}
                  />
                }
                label="Auto box focus"
              />
              {segmentAutoBox && (
                <Box sx={{ pl: 3, pr: 1, mb: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Box size
                  </Typography>
                  <Slider
                    value={segmentAutoBoxScale}
                    onChange={(_, value) => setSegmentAutoBoxScale(value as number)}
                    min={0.2}
                    max={0.6}
                    step={0.05}
                    size="small"
                    sx={{ mt: 0.5 }}
                  />
                </Box>
              )}
              <Typography variant="caption" color="text.secondary">
                Contour points
              </Typography>
              <Slider
                value={segmentContourPoints}
                onChange={(_, value) => setSegmentContourPoints(value as number)}
                min={16}
                max={128}
                step={4}
                size="small"
                sx={{ mt: 0.5 }}
              />
              <Button
                size="small"
                variant="contained"
                onClick={() => runInteractiveSegmentation()}
                disabled={segmentRunning || segmentPromptPoints.length === 0}
              >
                {segmentRunning ? 'Segmenting...' : 'Run Segment'}
              </Button>
              {segmentRunning && <LinearProgress sx={{ mt: 1 }} />}

              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Guideline Copilot
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={guidelineCopilotEnabled}
                    onChange={(event) => setGuidelineCopilotEnabled(event.target.checked)}
                  />
                }
                label="Enable copilot"
              />
              {!guidelineCopilotEnabled ? (
                <Typography variant="body2" color="text.secondary">
                  Enable to auto-build the report and checklist.
                </Typography>
              ) : (
                <Box sx={{ mt: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2">{copilotTemplate.label}</Typography>
                    <Chip
                      size="small"
                      label={`${copilotCompletion}% complete`}
                      color={copilotCompletion === 100 ? 'success' : copilotCompletion >= 60 ? 'warning' : 'error'}
                    />
                  </Box>

                  {copilotMissing.length > 0 ? (
                    <>
                      <Typography variant="caption" color="text.secondary">
                        Missing required items
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                        {copilotMissing.slice(0, 4).map((item) => (
                          <Chip
                            key={item.requirement.id}
                            size="small"
                            variant="outlined"
                            label={item.requirement.label}
                          />
                        ))}
                      </Box>
                      {copilotMissing.length > 4 && (
                        <Typography variant="caption" color="text.secondary">
                          +{copilotMissing.length - 4} more
                        </Typography>
                      )}
                      {copilotNextRequirement && (
                        <Button
                          size="small"
                          variant="outlined"
                          sx={{ mt: 1 }}
                          onClick={() => handleCopilotStartRequirement(copilotNextRequirement.requirement)}
                        >
                          Start next measurement
                        </Button>
                      )}
                    </>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      All required elements captured.
                    </Typography>
                  )}

                  {copilotIntegrityAlerts.length > 0 && (
                    <>
                      <Divider sx={{ my: 1.5 }} />
                      <Typography variant="caption" color="text.secondary">
                        Integrity alerts
                      </Typography>
                      <List dense disablePadding>
                        {copilotIntegrityAlerts.slice(0, 3).map((alert, index) => (
                          <ListItem key={`copilot-alert-${index}`} disablePadding>
                            <ListItemText
                              primary={alert}
                              primaryTypographyProps={{ variant: 'caption' }}
                            />
                          </ListItem>
                        ))}
                      </List>
                    </>
                  )}

                  <Divider sx={{ my: 1.5 }} />
                  <Typography variant="caption" color="text.secondary">
                    Draft report
                  </Typography>
                  <Paper
                    variant="outlined"
                    sx={{ p: 1, mt: 0.5, bgcolor: 'background.default' }}
                  >
                    <Typography variant="caption" sx={{ whiteSpace: 'pre-line' }}>
                      {copilotNarrative}
                    </Typography>
                  </Paper>
                  <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                    <Button size="small" variant="outlined" onClick={handleCopilotCopyNarrative}>
                      Copy narrative
                    </Button>
                    <Button size="small" variant="outlined" onClick={handleCopilotExportFhir}>
                      Export FHIR
                    </Button>
                    <Button size="small" variant="outlined" onClick={() => handleExportMeasurements('pdf')}>
                      Export PDF
                    </Button>
                  </Box>
                  <Button
                    size="small"
                    variant="contained"
                    sx={{ mt: 1 }}
                    onClick={() => handleExportMeasurements('dicom-files')}
                  >
                    Export DICOM SR
                  </Button>

                  {cinePhaseFrames && (
                    <>
                      <Divider sx={{ my: 1.5 }} />
                      <FormControlLabel
                        control={
                          <Switch
                            checked={copilotShowPhases}
                            onChange={(event) => setCopilotShowPhases(event.target.checked)}
                          />
                        }
                        label="Show ED/ES snapshots"
                      />
                      {copilotShowPhases && copilotPhaseUrls && (
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mt: 1 }}>
                          <Box>
                            <Typography variant="caption" color="text.secondary">
                              ED
                            </Typography>
                            {copilotPhaseUrls.ed ? (
                              <img
                                src={copilotPhaseUrls.ed}
                                alt="ED frame"
                                style={{ width: '100%', borderRadius: 4 }}
                              />
                            ) : (
                              <Typography variant="caption" color="text.secondary">
                                Not available
                              </Typography>
                            )}
                          </Box>
                          <Box>
                            <Typography variant="caption" color="text.secondary">
                              ES
                            </Typography>
                            {copilotPhaseUrls.es ? (
                              <img
                                src={copilotPhaseUrls.es}
                                alt="ES frame"
                                style={{ width: '100%', borderRadius: 4 }}
                              />
                            ) : (
                              <Typography variant="caption" color="text.secondary">
                                Not available
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      )}
                    </>
                  )}
                </Box>
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
                  {pathologyTileCount != null && (
                    <Typography variant="body2">Tiles: {pathologyTileCount}</Typography>
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
                Horalix AI (Cardiac)
              </Typography>
              {latestCardiacJob ? (
                <>
                  <Typography variant="body2">
                    Model: {formatAiModelLabel(latestCardiacJob.model_type || '-')}
                  </Typography>
                  <Typography variant="body2">
                    Status: {latestCardiacJob.completed_at ? 'Completed' : 'Pending'}
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    sx={{ mt: 1 }}
                    onClick={() => setShowAiResultsPanel(true)}
                    startIcon={<FavoriteIcon />}
                  >
                    Open AI Results Panel
                  </Button>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No cardiac AI results yet.
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
              {(activeAiViewLabel || selectedSeriesViewLabel) && (
                <Typography variant="body2">
                  Echo View: {activeAiViewLabel ?? selectedSeriesViewLabel}
                </Typography>
              )}
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

        {/* New Measurement Panel */}
        {showMeasurementPanel && seriesKey && (
          <MeasurementPanel
            measurements={contextMeasurements}
            selectedId={selectedMeasurementId}
            canUndo={measurementStore.canUndo()}
            canRedo={measurementStore.canRedo()}
            seriesUid={seriesKey}
            frameKey={currentFrameKey}
            instanceLabelByUid={instanceLabelByUid}
            onSelectMeasurement={(id) => {
              applyMeasurementSelection(
                {
                  setSelectedMeasurementId: setSelectedMeasurementIdLocal,
                  selectMeasurement: (selectedId: string | null) => measurementStore.selectMeasurement(selectedId),
                },
                id
              );
            }}
            onDeleteMeasurement={(id) => {
              // Delete from new store
              measurementStore.deleteMeasurement(id);
              clearTrackingStateFor([id]);
              if (selectedMeasurementIdLocal === id) {
                setSelectedMeasurementIdLocal(null);
              }
              // Also delete from old state (sync both systems)
              setMeasurementsByFrame((prev) => {
                const newState: Record<string, LegacyLineMeasurement[]> = {};
                for (const [key, measurements] of Object.entries(prev)) {
                  newState[key] = measurements.filter((m) => m.id !== id);
                }
                return newState;
              });
              setMeasurementsBySeries((prev) => {
                const newState: Record<string, LegacyLineMeasurement[]> = {};
                for (const [key, measurements] of Object.entries(prev)) {
                  newState[key] = measurements.filter((m) => m.id !== id);
                }
                return newState;
              });
              // Also delete polygons from old state
              setPolygonsByFrame((prev) => {
                const newState: Record<string, LegacyPolygonMeasurement[]> = {};
                for (const [key, polygons] of Object.entries(prev)) {
                  newState[key] = polygons.filter((p) => p.id !== id);
                }
                return newState;
              });
              setPolygonsBySeries((prev) => {
                const newState: Record<string, LegacyPolygonMeasurement[]> = {};
                for (const [key, polygons] of Object.entries(prev)) {
                  newState[key] = polygons.filter((p) => p.id !== id);
                }
                return newState;
              });
            }}
            onToggleVisibility={(id) => measurementStore.toggleVisibility(id)}
            onShowAll={() => measurementStore.showAll(seriesKey)}
            onHideAll={() => measurementStore.hideAll(seriesKey)}
            onDeleteAll={() => {
              measurementStore.clearMeasurements(seriesKey);
              const idsToClear = newStoreMeasurements
                .filter((measurement) => measurement.seriesUid === seriesKey)
                .map((measurement) => measurement.id);
              clearTrackingStateFor(idsToClear);
              setSelectedMeasurementIdLocal(null);
              // Also clear from old state
              setMeasurementsBySeries((prev) => ({ ...prev, [seriesKey]: [] }));
              // Clear all frame measurements for this series
              setMeasurementsByFrame((prev) => {
                const newState: Record<string, LegacyLineMeasurement[]> = {};
                for (const key of Object.keys(prev)) {
                  // Clear all frame measurements
                  newState[key] = [];
                }
                return newState;
              });
              // Also clear polygons from old state
              setPolygonsBySeries((prev) => ({ ...prev, [seriesKey]: [] }));
              setPolygonsByFrame((prev) => {
                const newState: Record<string, LegacyPolygonMeasurement[]> = {};
                for (const key of Object.keys(prev)) {
                  newState[key] = [];
                }
                return newState;
              });
            }}
            onUndo={() => measurementStore.undo()}
            onRedo={() => measurementStore.redo()}
            onExport={(e) => setShowExportMenu(e.currentTarget)}
            onImport={handleImportMeasurements}
            onEditLabel={handleOpenLabelEdit}
            trackingDataMap={trackingDataMap}
            onTrackMeasurement={trackMeasurementById}
            currentFrameIndex={currentSlice}
            onJumpToFrame={handleJumpToFrame}
          />
        )}

        {/* AI Results Panel */}
        {showAiResultsPanel && (
          <AIResultsPanel
            cardiacResults={aiResults?.cardiac ?? []}
            latestCardiacJob={latestCardiacJob}
            showOverlay={showAiOverlay}
            onToggleOverlay={() => setShowAiOverlay((prev) => !prev)}
            showMeasurementOverlay={showMeasurementOverlay}
            onToggleMeasurementOverlay={() => setShowMeasurementOverlay((prev) => !prev)}
            showContourOverlay={showContourOverlay}
            onToggleContourOverlay={() => setShowContourOverlay((prev) => !prev)}
            activeInstanceUid={currentInstanceUid ?? activeInstanceUid}
            overlayVisibleCount={visibleCardiacOverlayCount}
            lineOverlayCount={cardiacOverlays.lines.length}
            contourOverlayCount={cardiacOverlays.polylines.length}
            onJumpToNextOverlay={handleJumpToNextOverlay}
            onSelectView={handleSelectViewCine}
            patientContextOverride={patientContextOverride}
            onRerunAI={() => {
              // Always use the composite horalix_ai model (runs PanEcho + EchoPrime + Measurements + EchoNet)
              const cardiacModel = aiModels.find((m) => m.name === 'horalix_ai')
                ?? aiModels.find((m) => (m.details?.model_type || '').toLowerCase() === 'cardiac');
              if (cardiacModel) {
                runAiModel(cardiacModel);
              } else {
                setSnackbarMessage('No cardiac AI model available');
              }
            }}
            onRerunAIWithContext={handleRerunAIWithContext}
            isRunning={aiJobRunning}
            progress={aiJobProgress}
          />
        )}

        {/* Export Format Menu */}
        <Menu
          anchorEl={showExportMenu}
          open={Boolean(showExportMenu)}
          onClose={() => setShowExportMenu(null)}
        >
          <MenuItem onClick={() => handleExportMeasurements('json')}>
            Export as JSON
          </MenuItem>
          <MenuItem onClick={() => handleExportMeasurements('csv')}>
            Export as CSV
          </MenuItem>
          <MenuItem onClick={() => handleExportMeasurements('pdf')}>
            Export as PDF Report
          </MenuItem>
          <MenuItem onClick={() => handleExportMeasurements('dicom-sr')}>
            Export as DICOM SR (JSON)
          </MenuItem>
          <MenuItem
            onClick={() => handleExportMeasurements('dicom-files')}
            sx={{ fontWeight: 'bold', color: 'primary.main' }}
          >
            Export as DICOM Files (ZIP)
          </MenuItem>
        </Menu>
      </Box>

      <Paper
        sx={{
          display: 'flex',
          alignItems: 'center',
          px: 1.5,
          py: 0.75,
          borderRadius: 0,
          borderTop: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          boxShadow: '0 -1px 0 rgba(0,0,0,0.08)',
          gap: 0.5,
          '& .MuiIconButton-root': {
            borderRadius: 1,
            padding: 0.75,
            color: 'text.secondary',
            transition: 'all 0.15s ease',
            '&:hover': {
              bgcolor: 'action.hover',
              color: 'text.primary',
            },
          },
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

        {cinePhaseFrames && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 2 }}>
            <Tooltip title={`Jump to ED (${cinePhaseFrames.label})`}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => handleJumpToFrame(cinePhaseFrames.edFrame)}
              >
                ED
              </Button>
            </Tooltip>
            <Tooltip title={`Jump to ES (${cinePhaseFrames.label})`}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => handleJumpToFrame(cinePhaseFrames.esFrame)}
              >
                ES
              </Button>
            </Tooltip>
          </Box>
        )}

        <Tooltip title="Add cine bookmark">
          <span>
            <IconButton onClick={handleAddBookmark} disabled={totalSlices <= 1}>
              <BookmarkAddIcon />
            </IconButton>
          </span>
        </Tooltip>

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
          step={1}
          marks={cinePhaseMarks}
          sx={{
            flex: 1,
            mx: 2,
            '& .MuiSlider-markLabel': {
              fontSize: 10,
              color: 'text.secondary',
            },
          }}
          disabled={totalSlices <= 1}
        />

        <Chip
          label={selectedSeries?.series.modality || '-'}
          size="small"
          color="primary"
          variant="outlined"
          sx={{ mr: 1, fontWeight: 600 }}
        />
        <Chip
          label={`Zoom ${Math.round(zoom * 100)}%`}
          size="small"
          variant="outlined"
          sx={{ mr: 1, fontWeight: 600 }}
        />
        <Chip
          label={`${imageDimensions.columns} x ${imageDimensions.rows}`}
          size="small"
          variant="outlined"
          sx={{ fontWeight: 600 }}
        />
      </Paper>

      <Dialog
        open={measurementsModelDialogOpen}
        onClose={handleMeasurementsDialogClose}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Horalix AI Measurements</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary">
            Select a measurement model to run on the active cine. Run once per measurement type.
          </Typography>
          <FormControl fullWidth size="small" sx={{ mt: 2 }}>
            <InputLabel id="horalix-measurement-label">Measurement type</InputLabel>
            <Select
              labelId="horalix-measurement-label"
              value={measurementsModelSelection}
              label="Measurement type"
              onChange={(event) => setMeasurementsModelSelection(event.target.value)}
            >
              {HORALIX_MEASUREMENT_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
            <FormHelperText>
              For best results, use a matching view (e.g., PLAX for LVID/IVS/LVPW).
            </FormHelperText>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleMeasurementsDialogClose}>Cancel</Button>
          <Button variant="contained" onClick={handleMeasurementsDialogRun}>
            Run
          </Button>
        </DialogActions>
      </Dialog>

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
        open={metadataDialogOpen}
        onClose={() => setMetadataDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Edit Metadata</DialogTitle>
        <DialogContent dividers>
          {!metadataDraft ? (
            <Typography color="text.secondary">Metadata not available.</Typography>
          ) : (
            <>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Patient
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gap: 2,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                }}
              >
                <TextField
                  label="Patient ID"
                  value={metadataDraft.patient.patient_id}
                  onChange={(event) =>
                    updateMetadataDraft('patient', 'patient_id', event.target.value)
                  }
                />
                <TextField
                  label="Patient Name"
                  value={metadataDraft.patient.patient_name}
                  onChange={(event) =>
                    updateMetadataDraft('patient', 'patient_name', event.target.value)
                  }
                />
                <TextField
                  label="Birth Date"
                  type="date"
                  value={metadataDraft.patient.birth_date}
                  onChange={(event) =>
                    updateMetadataDraft('patient', 'birth_date', event.target.value)
                  }
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label="Sex"
                  value={metadataDraft.patient.sex}
                  onChange={(event) => updateMetadataDraft('patient', 'sex', event.target.value)}
                />
                <TextField
                  label="Issuer of Patient ID"
                  value={metadataDraft.patient.issuer_of_patient_id}
                  onChange={(event) =>
                    updateMetadataDraft('patient', 'issuer_of_patient_id', event.target.value)
                  }
                />
                <TextField
                  label="Other Patient IDs"
                  value={metadataDraft.patient.other_patient_ids}
                  onChange={(event) =>
                    updateMetadataDraft('patient', 'other_patient_ids', event.target.value)
                  }
                />
                <TextField
                  label="Ethnic Group"
                  value={metadataDraft.patient.ethnic_group}
                  onChange={(event) =>
                    updateMetadataDraft('patient', 'ethnic_group', event.target.value)
                  }
                />
                <TextField
                  label="Comments"
                  value={metadataDraft.patient.comments}
                  onChange={(event) =>
                    updateMetadataDraft('patient', 'comments', event.target.value)
                  }
                  multiline
                  minRows={2}
                />
              </Box>

              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Study
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gap: 2,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                }}
              >
                <TextField
                  label="Study ID"
                  value={metadataDraft.study.study_id}
                  onChange={(event) => updateMetadataDraft('study', 'study_id', event.target.value)}
                />
                <TextField
                  label="Study Date"
                  type="date"
                  value={metadataDraft.study.study_date}
                  onChange={(event) =>
                    updateMetadataDraft('study', 'study_date', event.target.value)
                  }
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label="Study Time"
                  value={metadataDraft.study.study_time}
                  onChange={(event) =>
                    updateMetadataDraft('study', 'study_time', event.target.value)
                  }
                  placeholder="HH:MM:SS"
                />
                <TextField
                  label="Study Description"
                  value={metadataDraft.study.study_description}
                  onChange={(event) =>
                    updateMetadataDraft('study', 'study_description', event.target.value)
                  }
                />
                <TextField
                  label="Accession Number"
                  value={metadataDraft.study.accession_number}
                  onChange={(event) =>
                    updateMetadataDraft('study', 'accession_number', event.target.value)
                  }
                />
                <TextField
                  label="Referring Physician"
                  value={metadataDraft.study.referring_physician_name}
                  onChange={(event) =>
                    updateMetadataDraft('study', 'referring_physician_name', event.target.value)
                  }
                />
                <TextField
                  label="Institution"
                  value={metadataDraft.study.institution_name}
                  onChange={(event) =>
                    updateMetadataDraft('study', 'institution_name', event.target.value)
                  }
                />
              </Box>

              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Series
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gap: 2,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                }}
              >
                <TextField
                  label="Series Number"
                  type="number"
                  value={metadataDraft.series.series_number}
                  onChange={(event) =>
                    updateMetadataDraft('series', 'series_number', event.target.value)
                  }
                  disabled={!selectedSeries}
                />
                <TextField
                  label="Series Description"
                  value={metadataDraft.series.series_description}
                  onChange={(event) =>
                    updateMetadataDraft('series', 'series_description', event.target.value)
                  }
                  disabled={!selectedSeries}
                />
                <TextField
                  label="Body Part Examined"
                  value={metadataDraft.series.body_part_examined}
                  onChange={(event) =>
                    updateMetadataDraft('series', 'body_part_examined', event.target.value)
                  }
                  disabled={!selectedSeries}
                />
                <TextField
                  label="Patient Position"
                  value={metadataDraft.series.patient_position}
                  onChange={(event) =>
                    updateMetadataDraft('series', 'patient_position', event.target.value)
                  }
                  disabled={!selectedSeries}
                />
                <TextField
                  label="Protocol Name"
                  value={metadataDraft.series.protocol_name}
                  onChange={(event) =>
                    updateMetadataDraft('series', 'protocol_name', event.target.value)
                  }
                  disabled={!selectedSeries}
                />
                <TextField
                  label="Slice Thickness (mm)"
                  type="number"
                  value={metadataDraft.series.slice_thickness}
                  onChange={(event) =>
                    updateMetadataDraft('series', 'slice_thickness', event.target.value)
                  }
                  inputProps={{ step: 'any' }}
                  disabled={!selectedSeries}
                />
                <TextField
                  label="Spacing Between Slices (mm)"
                  type="number"
                  value={metadataDraft.series.spacing_between_slices}
                  onChange={(event) =>
                    updateMetadataDraft('series', 'spacing_between_slices', event.target.value)
                  }
                  inputProps={{ step: 'any' }}
                  disabled={!selectedSeries}
                />
                <TextField
                  label="Window Center"
                  type="number"
                  value={metadataDraft.series.window_center}
                  onChange={(event) =>
                    updateMetadataDraft('series', 'window_center', event.target.value)
                  }
                  inputProps={{ step: 'any' }}
                  disabled={!selectedSeries}
                />
                <TextField
                  label="Window Width"
                  type="number"
                  value={metadataDraft.series.window_width}
                  onChange={(event) =>
                    updateMetadataDraft('series', 'window_width', event.target.value)
                  }
                  inputProps={{ step: 'any' }}
                  disabled={!selectedSeries}
                />
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMetadataDialogOpen(false)} disabled={metadataSaving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSaveMetadata}
            disabled={metadataSaving || !metadataDraft}
          >
            Save
          </Button>
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
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Tracking & Contours
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
            <Box sx={{ pl: 3, pr: 1, mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Contour smoothness
              </Typography>
              <Slider
                value={smoothContoursIterations}
                onChange={(_, value) => setSmoothContoursIterations(value as number)}
                min={0}
                max={3}
                step={1}
                size="small"
                sx={{ mt: 1 }}
              />
            </Box>
          )}
          <Box sx={{ pl: 0.5, pr: 0.5, mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.8 }}>
              Freehand polygon sampling
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={polygonSamplingPreset}
              onChange={(_, value) => {
                if (value === null) return;
                if (value === 'sparse' || value === 'balanced' || value === 'dense') {
                  setPolygonSamplingPreset(value);
                }
              }}
            >
              <ToggleButton value="sparse">Sparse</ToggleButton>
              <ToggleButton value="balanced">Balanced</ToggleButton>
              <ToggleButton value="dense">Dense</ToggleButton>
            </ToggleButtonGroup>
          </Box>
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
            <Box sx={{ pl: 3, pr: 1, mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Temporal smoothing (frames)
              </Typography>
              <Slider
                value={smoothTrackingWindow}
                onChange={(_, value) => setSmoothTrackingWindow(value as number)}
                min={0}
                max={4}
                step={1}
                size="small"
                sx={{ mt: 1 }}
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
            label="Show motion trails for tracked measurements"
          />
          {showTrackingTrails && (
            <Box sx={{ pl: 3, pr: 1 }}>
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
                sx={{ mt: 1 }}
              />
            </Box>
          )}
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Workflow
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
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewerSettingsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Label Edit Dialog */}
      <Dialog open={labelEditDialogOpen} onClose={handleCancelLabelEdit} maxWidth="sm" fullWidth>
        <DialogTitle>Rename Measurement</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Label"
            fullWidth
            variant="outlined"
            value={labelEditValue}
            onChange={(e) => setLabelEditValue(e.target.value)}
            placeholder="e.g., LV End-Diastolic, LVOT Diameter"
            helperText="Enter a descriptive name or select from presets below"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSaveLabelEdit();
              }
            }}
            sx={{ mb: 2 }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Echocardiography Presets:
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
            {/* LV Dimensions */}
            <Chip label="LVEDD" size="small" onClick={() => setLabelEditValue('LV End-Diastolic Diameter')} />
            <Chip label="LVESD" size="small" onClick={() => setLabelEditValue('LV End-Systolic Diameter')} />
            <Chip label="LVEDV" size="small" onClick={() => setLabelEditValue('LV End-Diastolic Volume')} />
            <Chip label="LVESV" size="small" onClick={() => setLabelEditValue('LV End-Systolic Volume')} />
            <Chip label="IVSd" size="small" onClick={() => setLabelEditValue('Interventricular Septum (Diastole)')} />
            <Chip label="PWd" size="small" onClick={() => setLabelEditValue('Posterior Wall (Diastole)')} />
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
            {/* Other chambers */}
            <Chip label="LA" size="small" onClick={() => setLabelEditValue('Left Atrium Diameter')} />
            <Chip label="RA" size="small" onClick={() => setLabelEditValue('Right Atrium')} />
            <Chip label="RV" size="small" onClick={() => setLabelEditValue('Right Ventricle')} />
            <Chip label="Ao Root" size="small" onClick={() => setLabelEditValue('Aortic Root')} />
            <Chip label="LVOT" size="small" onClick={() => setLabelEditValue('LVOT Diameter')} />
            <Chip label="TAPSE" size="small" onClick={() => setLabelEditValue('TAPSE')} />
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {/* Valves */}
            <Chip label="MV" size="small" onClick={() => setLabelEditValue('Mitral Valve')} />
            <Chip label="AV" size="small" onClick={() => setLabelEditValue('Aortic Valve')} />
            <Chip label="TV" size="small" onClick={() => setLabelEditValue('Tricuspid Valve')} />
            <Chip label="PV" size="small" onClick={() => setLabelEditValue('Pulmonary Valve')} />
            <Chip label="MVA" size="small" onClick={() => setLabelEditValue('Mitral Valve Area')} />
            <Chip label="AVA" size="small" onClick={() => setLabelEditValue('Aortic Valve Area')} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelLabelEdit}>Cancel</Button>
          <Button onClick={handleSaveLabelEdit} variant="contained">
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* EF Calculator Dialog */}
      <Dialog open={efCalculatorOpen} onClose={() => setEfCalculatorOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FavoriteIcon color="error" />
            Cardiac Function Calculator
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            {/* EF Calculator Section */}
            <Box sx={{ flex: 1, minWidth: 280 }}>
              <Typography variant="h6" gutterBottom>
                Ejection Fraction (EF)
              </Typography>
              <Alert severity="info" sx={{ mb: 2 }}>
                <strong>EF = (EDV - ESV) / EDV x 100%</strong>
                <br />
                Select area measurements (polygons)
              </Alert>

              <Typography variant="subtitle2" gutterBottom>
                End-Diastolic (EDV):
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
                {contextMeasurements
                  .filter((m) => m.type === 'polygon')
                  .map((m) => (
                    <Chip
                      key={m.id}
                      label={`${m.label || 'Area'} (${('areaMm2' in m && m.areaMm2) ? m.areaMm2.toFixed(0) : 'N/A'} mm^2)`}
                      size="small"
                      color={efEdvMeasurementId === m.id ? 'primary' : 'default'}
                      onClick={() => setEfEdvMeasurementId(m.id)}
                    />
                  ))}
                {contextMeasurements.filter((m) => m.type === 'polygon').length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    Draw polygon areas first
                  </Typography>
                )}
              </Box>

              <Typography variant="subtitle2" gutterBottom>
                End-Systolic (ESV):
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
                {contextMeasurements
                  .filter((m) => m.type === 'polygon')
                  .map((m) => (
                    <Chip
                      key={m.id}
                      label={`${m.label || 'Area'} (${('areaMm2' in m && m.areaMm2) ? m.areaMm2.toFixed(0) : 'N/A'} mm^2)`}
                      size="small"
                      color={efEsvMeasurementId === m.id ? 'secondary' : 'default'}
                      onClick={() => setEfEsvMeasurementId(m.id)}
                    />
                  ))}
              </Box>

              {/* EF Result */}
              {efEdvMeasurementId && efEsvMeasurementId && (() => {
                const edvMeasurement = contextMeasurements.find((m) => m.id === efEdvMeasurementId);
                const esvMeasurement = contextMeasurements.find((m) => m.id === efEsvMeasurementId);
                const edv = edvMeasurement && 'areaMm2' in edvMeasurement ? edvMeasurement.areaMm2 : null;
                const esv = esvMeasurement && 'areaMm2' in esvMeasurement ? esvMeasurement.areaMm2 : null;
                if (edv && esv && edv > 0) {
                  const ef = ((edv - esv) / edv) * 100;
                  return (
                    <Paper sx={{ p: 2, bgcolor: ef >= 55 ? 'success.dark' : ef >= 35 ? 'warning.dark' : 'error.dark', color: 'white' }}>
                      <Typography variant="h4" align="center">
                        EF: {ef.toFixed(1)}%
                      </Typography>
                      <Typography variant="body2" align="center" sx={{ mt: 1 }}>
                        EDV: {edv.toFixed(0)} mm^2 | ESV: {esv.toFixed(0)} mm^2
                      </Typography>
                      <Typography variant="caption" align="center" sx={{ display: 'block', mt: 1 }}>
                        {ef >= 55 ? 'OK Normal (>=55%)' :
                         ef >= 45 ? 'WARN Mildly Reduced (45-54%)' :
                         ef >= 35 ? 'WARN Moderately Reduced (35-44%)' :
                         'WARN Severely Reduced (<35%)'}
                      </Typography>
                    </Paper>
                  );
                }
                return null;
              })()}
            </Box>

            <Divider orientation="vertical" flexItem />

            {/* FS Calculator Section */}
            <Box sx={{ flex: 1, minWidth: 280 }}>
              <Typography variant="h6" gutterBottom>
                Fractional Shortening (FS)
              </Typography>
              <Alert severity="info" sx={{ mb: 2 }}>
                <strong>FS = (LVEDD - LVESD) / LVEDD x 100%</strong>
                <br />
                Select line measurements
              </Alert>

              <Typography variant="subtitle2" gutterBottom>
                LV End-Diastolic (LVEDD):
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
                {contextMeasurements
                  .filter((m) => m.type === 'line')
                  .map((m) => (
                    <Chip
                      key={m.id}
                      label={`${m.label || 'Line'} (${('lengthMm' in m && m.lengthMm) ? m.lengthMm.toFixed(1) : 'N/A'} mm)`}
                      size="small"
                      color={efEdvMeasurementId === `fs_ed_${m.id}` ? 'primary' : 'default'}
                      onClick={() => setEfEdvMeasurementId(`fs_ed_${m.id}`)}
                    />
                  ))}
                {contextMeasurements.filter((m) => m.type === 'line').length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    Draw line measurements first
                  </Typography>
                )}
              </Box>

              <Typography variant="subtitle2" gutterBottom>
                LV End-Systolic (LVESD):
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
                {contextMeasurements
                  .filter((m) => m.type === 'line')
                  .map((m) => (
                    <Chip
                      key={m.id}
                      label={`${m.label || 'Line'} (${('lengthMm' in m && m.lengthMm) ? m.lengthMm.toFixed(1) : 'N/A'} mm)`}
                      size="small"
                      color={efEsvMeasurementId === `fs_es_${m.id}` ? 'secondary' : 'default'}
                      onClick={() => setEfEsvMeasurementId(`fs_es_${m.id}`)}
                    />
                  ))}
              </Box>

              {/* FS Result */}
              {efEdvMeasurementId?.startsWith('fs_ed_') && efEsvMeasurementId?.startsWith('fs_es_') && (() => {
                const edId = efEdvMeasurementId.replace('fs_ed_', '');
                const esId = efEsvMeasurementId.replace('fs_es_', '');
                const lvedd = contextMeasurements.find((m) => m.id === edId);
                const lvesd = contextMeasurements.find((m) => m.id === esId);
                const edd = lvedd && 'lengthMm' in lvedd ? lvedd.lengthMm : null;
                const esd = lvesd && 'lengthMm' in lvesd ? lvesd.lengthMm : null;
                if (edd && esd && edd > 0) {
                  const fs = ((edd - esd) / edd) * 100;
                  return (
                    <Paper sx={{ p: 2, bgcolor: fs >= 25 ? 'success.dark' : fs >= 15 ? 'warning.dark' : 'error.dark', color: 'white' }}>
                      <Typography variant="h4" align="center">
                        FS: {fs.toFixed(1)}%
                      </Typography>
                      <Typography variant="body2" align="center" sx={{ mt: 1 }}>
                        LVEDD: {edd.toFixed(1)} mm | LVESD: {esd.toFixed(1)} mm
                      </Typography>
                      <Typography variant="caption" align="center" sx={{ display: 'block', mt: 1 }}>
                        {fs >= 25 ? 'OK Normal (>=25%)' :
                         fs >= 15 ? 'WARN Mildly Reduced (15-24%)' :
                         'WARN Severely Reduced (<15%)'}
                      </Typography>
                    </Paper>
                  );
                }
                return null;
              })()}
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setEfEdvMeasurementId(null);
              setEfEsvMeasurementId(null);
            }}
          >
            Clear All
          </Button>
          <Button onClick={() => setEfCalculatorOpen(false)} variant="contained">
            Close
          </Button>
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
