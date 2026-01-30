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
  Stack,
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
  TextField,
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
  NearMe as PointerIcon,
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
  SquareFoot as AreaIcon,
  Favorite as FavoriteIcon,
  BookmarkAdd as BookmarkAddIcon,
  AutoFixHigh as SmartSegmentIcon,
  ViewModule as SmartLayoutIcon,
} from '@mui/icons-material';
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
  TrackMeasurementResponse,
  InteractiveSegmentationResponse,
} from '../services/api';
import { clampMaskSliceIndex, scaleDetectionBox } from '../utils/overlayMapping';

// New modular viewer components
import { MeasurementPanel } from '../features/viewer/components/MeasurementPanel';
import { MPRLayout } from '../features/viewer/components/MPR/MPRLayout';
import { useMeasurementStore } from '../features/viewer/hooks/useMeasurementStore';
import { useMPRStore } from '../features/viewer/hooks/useMPRStore';
import type {
  LineMeasurement as NewLineMeasurement,
  PolygonMeasurement as NewPolygonMeasurement,
  Point2D,
  VolumeInfo as MprVolumeInfo,
} from '../features/viewer/types';
import { isLineMeasurement, isPolygonMeasurement, smoothPolygon } from '../features/viewer/types';
import { calculatePolygonAreaMm2, calculatePerimeterMm } from '../features/viewer/services/geometryService';
import { MEASUREMENT_COLORS } from '../features/viewer/constants';
import {
  downloadFile,
  generateCSVExport,
  type ExportFormat,
} from '../features/viewer/services/exportService';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';

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

type MetadataDraft = {
  patient: {
    patient_id: string;
    patient_name: string;
    birth_date: string;
    sex: string;
    issuer_of_patient_id: string;
    other_patient_ids: string;
    ethnic_group: string;
    comments: string;
  };
  study: {
    study_id: string;
    study_date: string;
    study_time: string;
    study_description: string;
    accession_number: string;
    referring_physician_name: string;
    institution_name: string;
  };
  series: {
    series_number: string;
    series_description: string;
    body_part_examined: string;
    patient_position: string;
    protocol_name: string;
    slice_thickness: string;
    spacing_between_slices: string;
    window_center: string;
    window_width: string;
  };
};

type DragState = {
  tool: 'pan' | 'zoom' | 'wwwl' | 'measure' | 'polygon' | 'rotate' | 'pointer';
  startX: number;
  startY: number;
  startPan: { x: number; y: number };
  startZoom: number;
  startWindow: { center: number; width: number };
  startRotation?: number;
  measureStart?: { x: number; y: number };
  measureId?: string;
  measureFrameKey?: string;
  measureSeriesKey?: string;
  measureScope?: 'frame' | 'cine';
};

type PolygonMeasurement = {
  id: string;
  points: { x: number; y: number }[];
  areaMm2: number | null;
  perimeterMm: number | null;
};

type SegmentPromptPoint = {
  x: number;
  y: number;
  label: 0 | 1;
};

type InteractiveSegmentationResult = {
  id: string;
  seriesUid: string;
  instanceUid: string;
  frameIndex: number;
  maskFilename: string;
  maskShape: number[];
  createdAt: number;
  primaryContour: Point2D[];
};

type CineBookmark = {
  id: string;
  frameIndex: number;
  label: string;
  createdAt: number;
};

type CopilotRequirement = {
  id: string;
  label: string;
  type: 'line' | 'polygon' | 'derived' | 'any';
  keywords: string[];
  optional?: boolean;
  description?: string;
};

type CopilotTemplate = {
  id: string;
  label: string;
  requirements: CopilotRequirement[];
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (start: number, end: number, t: number) => start + (end - start) * t;
const normalizeText = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};
const parseOptionalNumber = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (normalized === null) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};
const resampleClosedPolygon = (points: Point2D[], targetCount: number) => {
  if (points.length < 3 || targetCount <= 0 || points.length === targetCount) {
    return points;
  }

  const closed = [...points, points[0]];
  const distances: number[] = [0];
  let total = 0;
  for (let i = 1; i < closed.length; i += 1) {
    const dx = closed[i].x - closed[i - 1].x;
    const dy = closed[i].y - closed[i - 1].y;
    const segment = Math.sqrt(dx * dx + dy * dy);
    total += segment;
    distances.push(total);
  }

  if (total === 0) return points;
  const step = total / targetCount;
  const resampled: Point2D[] = [];
  let segIndex = 1;

  for (let i = 0; i < targetCount; i += 1) {
    const targetDist = i * step;
    while (segIndex < distances.length - 1 && distances[segIndex] < targetDist) {
      segIndex += 1;
    }
    const prevDist = distances[segIndex - 1];
    const nextDist = distances[segIndex];
    const ratio = nextDist - prevDist === 0 ? 0 : (targetDist - prevDist) / (nextDist - prevDist);
    const p1 = closed[segIndex - 1];
    const p2 = closed[segIndex];
    resampled.push({
      x: p1.x + (p2.x - p1.x) * ratio,
      y: p1.y + (p2.y - p1.y) * ratio,
    });
  }

  return resampled;
};
const TRACKING_POINT_LIMIT = 96;
const normalizeTrackingPoints = (points: Point2D[], targetCount = TRACKING_POINT_LIMIT) => {
  if (points.length <= 2) return points;
  const capped = Math.max(3, Math.min(points.length, targetCount));
  if (points.length > capped) {
    return resampleClosedPolygon(points, capped);
  }
  return points;
};
const normalizeLabel = (value?: string | null) => {
  if (!value) return '';
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
};
const labelHasKeyword = (label: string, keywords: string[]) =>
  keywords.some((keyword) => {
    const normalizedKeyword = keyword.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return normalizedKeyword ? label.includes(normalizedKeyword) : false;
  });

const MAX_IMAGE_CACHE = 160;
const DEFAULT_CINE_FPS = 15;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.02;
const WHEEL_ZOOM_SPEED = 0.0005;
const DRAG_ZOOM_DENOMINATOR = 1600;
const WHEEL_SCROLL_THRESHOLD = 60;
const WHEEL_MAX_SLICE_STEP = 8;
const PREVIEW_SMOOTHING = 0.35;

const COPILOT_TEMPLATES: Record<string, CopilotTemplate> = {
  echo: {
    id: 'echo',
    label: 'Echo Core Measurements',
    requirements: [
      {
        id: 'lvedd',
        label: 'LV end-diastolic diameter',
        type: 'line',
        keywords: ['lvedd', 'lv end diastolic', 'lv end-diastolic', 'lv diastolic'],
      },
      {
        id: 'lvesd',
        label: 'LV end-systolic diameter',
        type: 'line',
        keywords: ['lvesd', 'lv end systolic', 'lv end-systolic', 'lv systolic'],
      },
      {
        id: 'lv_mass_index',
        label: 'LV mass index',
        type: 'derived',
        keywords: ['lv mass', 'mass index'],
        optional: true,
      },
      {
        id: 'tr_vmax',
        label: 'TR Vmax',
        type: 'line',
        keywords: ['tr vmax', 'tr velocity', 'tr jet'],
        optional: true,
      },
      {
        id: 'rv_size',
        label: 'RV size',
        type: 'line',
        keywords: ['rv size', 'right ventricle', 'rv'],
      },
      {
        id: 'la_size',
        label: 'LA size',
        type: 'line',
        keywords: ['left atrium', 'la'],
      },
      {
        id: 'lvot',
        label: 'LVOT diameter',
        type: 'line',
        keywords: ['lvot', 'lv outflow'],
      },
      {
        id: 'ef',
        label: 'Ejection fraction',
        type: 'derived',
        keywords: ['ef', 'ejection fraction'],
      },
    ],
  },
  ct: {
    id: 'ct',
    label: 'CT Baseline Measurements',
    requirements: [
      {
        id: 'lesion_long',
        label: 'Target lesion long axis',
        type: 'line',
        keywords: ['long axis', 'long-axis', 'long diameter', 'lesion long'],
      },
      {
        id: 'lesion_short',
        label: 'Target lesion short axis',
        type: 'line',
        keywords: ['short axis', 'short-axis', 'short diameter', 'lesion short'],
      },
      {
        id: 'lesion_area',
        label: 'Target lesion area',
        type: 'polygon',
        keywords: ['lesion area', 'area'],
        optional: true,
      },
      {
        id: 'node_short',
        label: 'Lymph node short axis',
        type: 'line',
        keywords: ['node short', 'lymph node', 'node axis'],
        optional: true,
      },
    ],
  },
  mr: {
    id: 'mr',
    label: 'MR Baseline Measurements',
    requirements: [
      {
        id: 'volume_ed',
        label: 'End-diastolic volume',
        type: 'polygon',
        keywords: ['edv', 'end diastolic volume', 'end-diastolic volume'],
      },
      {
        id: 'volume_es',
        label: 'End-systolic volume',
        type: 'polygon',
        keywords: ['esv', 'end systolic volume', 'end-systolic volume'],
      },
      {
        id: 'ef',
        label: 'Ejection fraction',
        type: 'derived',
        keywords: ['ef', 'ejection fraction'],
      },
    ],
  },
  general: {
    id: 'general',
    label: 'Core Measurement Checklist',
    requirements: [
      {
        id: 'primary_length',
        label: 'Primary length',
        type: 'line',
        keywords: ['length', 'diameter', 'distance'],
      },
      {
        id: 'primary_area',
        label: 'Primary area',
        type: 'polygon',
        keywords: ['area', 'region'],
        optional: true,
      },
      {
        id: 'secondary_length',
        label: 'Secondary length',
        type: 'line',
        keywords: ['short', 'secondary'],
        optional: true,
      },
    ],
  },
};

const getCopilotTemplateKey = (modality: string | undefined, description: string) => {
  const normalized = `${modality ?? ''} ${description}`.toLowerCase();
  if (normalized.includes('echo') || normalized.includes('echocardiogram') || normalized.includes('cardiac') || modality === 'US') {
    return 'echo';
  }
  if (modality === 'CT') return 'ct';
  if (modality === 'MR') return 'mr';
  return 'general';
};

type TrackFramePoints = {
  frame_index: number;
  points: Point2D[];
  length_mm?: number | null;
  area_mm2?: number | null;
  valid?: boolean;
};

type PolygonTrackFrame = {
  frame_index: number;
  points: Point2D[];
  area_mm2: number | null;
};

const sortTrackFrames = <T extends TrackFramePoints>(frames: T[]) =>
  [...frames].sort((a, b) => a.frame_index - b.frame_index);

const smoothTrackFramesTemporal = <T extends TrackFramePoints>(frames: T[], window: number): T[] => {
  const safeWindow = Math.max(0, Math.floor(window));
  if (safeWindow <= 0 || frames.length <= 1) return frames;

  const sorted = sortTrackFrames(frames);
  const pointCount = sorted[0]?.points.length ?? 0;
  if (pointCount === 0) return sorted;

  const consistent = sorted.every((frame) => frame.points.length === pointCount);
  if (!consistent) return sorted;

  return sorted.map((frame, index) => {
    const start = Math.max(0, index - safeWindow);
    const end = Math.min(sorted.length - 1, index + safeWindow);
    const sampleCount = end - start + 1;

    const points = Array.from({ length: pointCount }, (_, pointIndex) => {
      let sumX = 0;
      let sumY = 0;
      for (let i = start; i <= end; i += 1) {
        const p = sorted[i].points[pointIndex];
        sumX += p.x;
        sumY += p.y;
      }
      return { x: sumX / sampleCount, y: sumY / sampleCount };
    });

    return { ...frame, points } as T;
  });
};

const interpolateTrackFrame = <T extends TrackFramePoints>(
  frames: T[],
  frameIndex: number
): T | null => {
  if (!frames.length) return null;
  const sorted = sortTrackFrames(frames);
  const exact = sorted.find((frame) => frame.frame_index === frameIndex);
  if (exact) return exact;

  let prev: T | null = null;
  let next: T | null = null;
  for (const frame of sorted) {
    if (frame.frame_index < frameIndex) {
      prev = frame;
      continue;
    }
    if (frame.frame_index > frameIndex) {
      next = frame;
      break;
    }
  }

  if (!prev && !next) return null;
  if (!prev) return next;
  if (!next) return prev;

  const delta = next.frame_index - prev.frame_index;
  if (delta <= 0) return prev;
  if (prev.points.length !== next.points.length) return prev;

  const t = (frameIndex - prev.frame_index) / delta;
  const points = prev.points.map((point, index) => ({
    x: lerp(point.x, next.points[index].x, t),
    y: lerp(point.y, next.points[index].y, t),
  }));

  const lengthMm =
    prev.length_mm != null && next.length_mm != null
      ? lerp(prev.length_mm, next.length_mm, t)
      : prev.length_mm ?? next.length_mm;
  const areaMm2 =
    prev.area_mm2 != null && next.area_mm2 != null
      ? lerp(prev.area_mm2, next.area_mm2, t)
      : prev.area_mm2 ?? next.area_mm2 ?? null;

  return {
    ...prev,
    frame_index: frameIndex,
    points,
    length_mm: lengthMm ?? null,
    area_mm2: areaMm2 ?? null,
    valid: prev.valid ?? next.valid,
  } as T;
};

const smoothLineTracks = (
  tracks: Record<string, TrackMeasurementResponse>,
  window: number
): Record<string, TrackMeasurementResponse> => {
  if (window <= 0) return tracks;
  const smoothed: Record<string, TrackMeasurementResponse> = {};
  for (const [id, track] of Object.entries(tracks)) {
    smoothed[id] = {
      ...track,
      frames: smoothTrackFramesTemporal(track.frames, window),
    };
  }
  return smoothed;
};

const smoothPolygonTracks = (
  tracks: Record<string, { frames: PolygonTrackFrame[] }>,
  window: number
): Record<string, { frames: PolygonTrackFrame[] }> => {
  if (window <= 0) return tracks;
  const smoothed: Record<string, { frames: PolygonTrackFrame[] }> = {};
  for (const [id, track] of Object.entries(tracks)) {
    smoothed[id] = {
      ...track,
      frames: smoothTrackFramesTemporal(track.frames, window),
    };
  }
  return smoothed;
};

const buildPathFromPoints = (points: Point2D[], closed: boolean = true): string => {
  if (points.length === 0) return '';
  const commands = points.map((p, index) => `${index === 0 ? 'M' : 'L'} ${p.x} ${p.y}`);
  if (closed && points.length > 2) {
    commands.push('Z');
  }
  return commands.join(' ');
};

const getTrailFrames = <T extends TrackFramePoints>(
  frames: T[],
  currentIndex: number,
  trailLength: number
): Array<{ frame: T; distance: number }> => {
  if (trailLength <= 0) return [];
  return frames
    .map((frame) => ({
      frame,
      distance: Math.abs(frame.frame_index - currentIndex),
    }))
    .filter((entry) => entry.distance > 0 && entry.distance <= trailLength)
    .sort((a, b) => a.distance - b.distance);
};

const getTrailOpacity = (distance: number, trailLength: number): number => {
  if (trailLength <= 0) return 0;
  const normalized = (trailLength - distance + 1) / (trailLength + 1);
  return Math.max(0.05, Math.min(0.35, 0.05 + normalized * 0.25));
};

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

const buildOrientationMatrix = (orientation?: number[] | null): number[][] => {
  if (!orientation || orientation.length < 6) {
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  }

  const row = orientation.slice(0, 3);
  const col = orientation.slice(3, 6);
  const normal = [
    row[1] * col[2] - row[2] * col[1],
    row[2] * col[0] - row[0] * col[2],
    row[0] * col[1] - row[1] * col[0],
  ];

  return [row, col, normal];
};

const buildMprVolumeInfo = (
  info: VolumeInfo,
  windowLevel: { center: number; width: number }
): MprVolumeInfo => ({
  dimensions: [info.dimensions.x, info.dimensions.y, info.dimensions.z],
  spacing: [info.spacing.x, info.spacing.y, info.spacing.z],
  origin: info.origin,
  orientation: buildOrientationMatrix(info.orientation),
  modality: info.modality,
  seriesUid: info.series_uid,
  pixelRange: {
    min: windowLevel.center - windowLevel.width / 2,
    max: windowLevel.center + windowLevel.width / 2,
  },
});

const ViewerPage: React.FC = () => {
  const { studyUid } = useParams<{ studyUid: string }>();
  const navigate = useNavigate();
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);

  const seriesCacheRef = useRef(new Map<string, SeriesDetailResponse>());
  const instanceCacheRef = useRef(new Map<string, Instance>());
  const viewportStateRef = useRef(new Map<string, ViewportState>());
  const thumbnailCacheRef = useRef(new Map<string, string>());
  const prefetchedSeriesRef = useRef(new Set<string>());
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

  // Data state
  const [study, setStudy] = useState<Study | null>(null);
  const [patientDetails, setPatientDetails] = useState<Patient | null>(null);
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
  const [activeTool, setActiveTool] = useState<
    'pointer' | 'pan' | 'zoom' | 'wwwl' | 'measure' | 'rotate' | 'polygon' | 'segment'
  >('pointer');
  const [showSeriesPanel, setShowSeriesPanel] = useState(true);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [showMeasurementPanel, setShowMeasurementPanel] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState<null | HTMLElement>(null);
  const [showAiOverlay, setShowAiOverlay] = useState(true);
  const [aiMenuAnchor, setAIMenuAnchor] = useState<null | HTMLElement>(null);
  const [wlMenuAnchor, setWlMenuAnchor] = useState<null | HTMLElement>(null);
  const [seriesThumbnails, setSeriesThumbnails] = useState<Record<string, string>>({});
  const [smartHangDetails, setSmartHangDetails] = useState<Record<string, SeriesDetailResponse>>({});
  const [currentInstanceMeta, setCurrentInstanceMeta] = useState<Instance | null>(null);
  const [activeMeasurement, setActiveMeasurement] = useState<Measurement | null>(null);
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
  const [segmentContourPoints, setSegmentContourPoints] = useState(32);
  const [segmentPointMode, setSegmentPointMode] = useState<0 | 1>(1);
  const [segmentAutoRun, setSegmentAutoRun] = useState(true);
  const [segmentRunning, setSegmentRunning] = useState(false);
  const [medsamPreloading, setMedsamPreloading] = useState(false);
  const [interactiveSegmentations, setInteractiveSegmentations] = useState<InteractiveSegmentationResult[]>([]);
  // Polygon drawing state
  const [activePolygon, setActivePolygon] = useState<PolygonMeasurement | null>(null);
  const [polygonsByFrame, setPolygonsByFrame] = useState<Record<string, PolygonMeasurement[]>>({});
  const [polygonsBySeries, setPolygonsBySeries] = useState<Record<string, PolygonMeasurement[]>>({});
  const [selectedMeasurementIdLocal, setSelectedMeasurementIdLocal] = useState<string | null>(null);
  // Editing state for pointer tool - tracks dragging of measurement points
  const [editingMeasurement, setEditingMeasurement] = useState<{
    id: string;
    type: 'line' | 'polygon';
    mode: 'move' | 'handle';
    handleIndex?: number;
    startImagePoint: { x: number; y: number };
    originalPoints: Array<{ x: number; y: number }>;
  } | null>(null);
  const [measurementsByFrame, setMeasurementsByFrame] = useState<Record<string, Measurement[]>>(
    {}
  );
  const [measurementsBySeries, setMeasurementsBySeries] = useState<Record<string, Measurement[]>>(
    {}
  );
  const [measurementScope, setMeasurementScope] = useState<'frame' | 'cine'>(() => {
    if (typeof localStorage === 'undefined') return 'cine';
    const storedScope = localStorage.getItem('viewer_measurement_scope');
    return storedScope === 'frame' ? 'frame' : 'cine';
  });
  const [measurementTracks, setMeasurementTracks] = useState<
    Record<string, TrackMeasurementResponse>
  >({});
  const [polygonTracks, setPolygonTracks] = useState<
    Record<string, { frames: Array<{ frame_index: number; points: Array<{ x: number; y: number }>; area_mm2: number | null }> }>
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
    if (!seriesKey) return [];
    return measurementStore.getMeasurementsForSeries(seriesKey);
  }, [seriesKey, measurementStore, newMeasurements]);

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
      (a, b) => a.createdAt - b.createdAt
    );
    const nextMeasurementsByFrame: Record<string, Measurement[]> = {};
    const nextMeasurementsBySeries: Record<string, Measurement[]> = {};
    const nextPolygonsByFrame: Record<string, PolygonMeasurement[]> = {};
    const nextPolygonsBySeries: Record<string, PolygonMeasurement[]> = {};

    for (const measurement of allMeasurements) {
      if (isLineMeasurement(measurement)) {
        const mapped: Measurement = {
          id: measurement.id,
          start: measurement.points[0],
          end: measurement.points[1],
          lengthMm: measurement.lengthMm ?? null,
        };
        if (measurement.scope === 'frame' && measurement.frameKey) {
          if (!nextMeasurementsByFrame[measurement.frameKey]) {
            nextMeasurementsByFrame[measurement.frameKey] = [];
          }
          nextMeasurementsByFrame[measurement.frameKey].push(mapped);
        } else {
          if (!nextMeasurementsBySeries[measurement.seriesUid]) {
            nextMeasurementsBySeries[measurement.seriesUid] = [];
          }
          nextMeasurementsBySeries[measurement.seriesUid].push(mapped);
        }
      } else if (isPolygonMeasurement(measurement)) {
        const mapped: PolygonMeasurement = {
          id: measurement.id,
          points: measurement.points,
          areaMm2: measurement.areaMm2 ?? null,
          perimeterMm: measurement.perimeterMm ?? null,
        };
        if (measurement.scope === 'frame' && measurement.frameKey) {
          if (!nextPolygonsByFrame[measurement.frameKey]) {
            nextPolygonsByFrame[measurement.frameKey] = [];
          }
          nextPolygonsByFrame[measurement.frameKey].push(mapped);
        } else {
          if (!nextPolygonsBySeries[measurement.seriesUid]) {
            nextPolygonsBySeries[measurement.seriesUid] = [];
          }
          nextPolygonsBySeries[measurement.seriesUid].push(mapped);
        }
      }
    }

    setMeasurementsByFrame(nextMeasurementsByFrame);
    setMeasurementsBySeries(nextMeasurementsBySeries);
    setPolygonsByFrame(nextPolygonsByFrame);
    setPolygonsBySeries(nextPolygonsBySeries);
  }, [measurementStore, newMeasurements, editingMeasurement, activeMeasurement, activePolygon]);

  useEffect(() => {
    const nextMeasurementTracks: Record<string, TrackMeasurementResponse> = {};
    const nextPolygonTracks: Record<string, { frames: PolygonTrackFrame[] }> = {};

    for (const [id, tracking] of measurementStore.trackingData.entries()) {
      const measurement = measurementStore.measurements.get(id);
      if (!measurement) continue;

      if (measurement.type === 'line') {
        nextMeasurementTracks[id] = {
          series_uid: tracking.seriesUid,
          total_frames: tracking.totalFrames,
          frames: tracking.frames.map((frame) => ({
            frame_index: frame.frameIndex,
            points: frame.points,
            length_mm: frame.lengthMm,
            area_mm2: frame.areaMm2 ?? null,
            valid: frame.valid,
          })),
          summary: {
            min_mm: tracking.summary.minMm ?? null,
            max_mm: tracking.summary.maxMm ?? null,
            mean_mm: tracking.summary.meanMm ?? null,
            min_area_mm2: tracking.summary.minAreaMm2 ?? null,
            max_area_mm2: tracking.summary.maxAreaMm2 ?? null,
            mean_area_mm2: tracking.summary.meanAreaMm2 ?? null,
          },
        };
      } else if (measurement.type === 'polygon') {
        nextPolygonTracks[id] = {
          frames: tracking.frames.map((frame) => ({
            frame_index: frame.frameIndex,
            points: frame.points,
            area_mm2: frame.areaMm2 ?? null,
          })),
        };
      }
    }

    setMeasurementTracks(nextMeasurementTracks);
    setPolygonTracks(nextPolygonTracks);
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
    const base =
      measurementScope === 'cine' && seriesKey
        ? measurementsBySeries[seriesKey] ?? []
        : frameKey
          ? measurementsByFrame[frameKey] ?? []
          : [];
    const withActive = activeMeasurement ? [...base, activeMeasurement] : base;

    // Filter out hidden measurements (check visibility in new store)
    const filtered = withActive.filter((measurement) => {
      // Active measurement is always visible
      if (activeMeasurement && measurement.id === activeMeasurement.id) return true;
      // Check visibility in new store
      const storeMeasurement = measurementStore.getMeasurement(measurement.id);
      return storeMeasurement ? storeMeasurement.visible : false;
    });

    return filtered.map((measurement) => {
      if (measurementScope !== 'cine') return measurement;
      const track = displayMeasurementTracks[measurement.id];
      if (!track) return measurement;
      const trackedFrame = interpolateTrackFrame(track.frames, currentSlice);
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
    displayMeasurementTracks,
    currentSlice,
    measurementStore,
    newMeasurements, // Include this to re-compute when visibility changes
  ]);

  // Compute visible polygons based on scope
  const visiblePolygons = useMemo(() => {
    const base =
      measurementScope === 'cine' && seriesKey
        ? polygonsBySeries[seriesKey] ?? []
        : frameKey
          ? polygonsByFrame[frameKey] ?? []
          : [];
    const withActive = activePolygon ? [...base, activePolygon] : base;

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
      if (measurementScope !== 'cine') return polygon;
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
    measurementScope,
    displayPolygonTracks,
    currentSlice,
    measurementStore,
    newMeasurements,
  ]);

  // Convert measurement tracks to TrackingData map for MeasurementPanel
  const trackingDataMap = useMemo(() => {
    const map = new Map<string, import('../features/viewer/types').TrackingData>();

    // Convert line measurement tracks
    for (const [measurementId, track] of Object.entries(displayMeasurementTracks)) {
      map.set(measurementId, {
        seriesUid: track.series_uid,
        totalFrames: track.total_frames,
        startFrameIndex: 0,
        frames: track.frames.map((f) => ({
          frameIndex: f.frame_index,
          points: f.points,
          lengthMm: f.length_mm,
          valid: f.valid,
        })),
        summary: {
          minMm: track.summary.min_mm,
          maxMm: track.summary.max_mm,
          meanMm: track.summary.mean_mm,
        },
      });
    }

    // Convert polygon tracks
    for (const [polygonId, track] of Object.entries(displayPolygonTracks)) {
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
  }, [displayMeasurementTracks, displayPolygonTracks, seriesKey]);

  const copilotTemplate = useMemo(() => {
    const modality = selectedSeries?.series.modality;
    const description = `${study?.study_description ?? ''} ${selectedSeries?.series.series_description ?? ''}`.trim();
    const key = getCopilotTemplateKey(modality, description);
    return COPILOT_TEMPLATES[key] || COPILOT_TEMPLATES.general;
  }, [selectedSeries?.series.modality, selectedSeries?.series.series_description, study?.study_description]);

  const normalizedMeasurements = useMemo(
    () =>
      newStoreMeasurements.map((measurement) => ({
        measurement,
        normalizedLabel: normalizeLabel(measurement.label),
      })),
    [newStoreMeasurements]
  );

  const lineMeasurements = useMemo(
    () => newStoreMeasurements.filter((measurement) => isLineMeasurement(measurement)),
    [newStoreMeasurements]
  );
  const polygonMeasurements = useMemo(
    () => newStoreMeasurements.filter((measurement) => isPolygonMeasurement(measurement)),
    [newStoreMeasurements]
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
      if (type === 'any' && newStoreMeasurements.length === 1) {
        return newStoreMeasurements[0];
      }

      return null;
    },
    [normalizedMeasurements, lineMeasurements, polygonMeasurements, newStoreMeasurements]
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
      const measurement = newStoreMeasurements.find((m) => m.id === measurementId);
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
  }, [trackingDataMap, newStoreMeasurements]);

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
    const measurement = newStoreMeasurements.find((m) => m.id === candidateId);
    return {
      measurementId: candidateId,
      label: measurement?.label || measurement?.type || 'Measurement',
      edFrame: max.frameIndex,
      esFrame: min.frameIndex,
    };
  }, [trackingDataMap, selectedMeasurementIdLocal, newStoreMeasurements]);

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
    cineFps,
    measurementScope,
  ]);

  useEffect(() => {
    if (!seriesKey) {
      setCineBookmarks([]);
      return;
    }
    if (typeof localStorage === 'undefined') return;
    const stored = localStorage.getItem(`viewer_bookmarks_${seriesKey}`);
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
  }, [seriesKey]);

  useEffect(() => {
    if (!seriesKey) return;
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(`viewer_bookmarks_${seriesKey}`, JSON.stringify(cineBookmarks));
  }, [seriesKey, cineBookmarks]);

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
            windowCenter: isColorImage ? undefined : viewStateRef.current.windowLevel.center,
            windowWidth: isColorImage ? undefined : viewStateRef.current.windowLevel.width,
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
    isColorImage,
  ]);

  const imageUrl = useMemo(() => {
    if (!currentInstanceUid) return null;
    return api.instances.getPixelDataUrl(currentInstanceUid, {
      frame: currentFrameIndex,
      windowCenter: isColorImage ? undefined : windowLevel.center,
      windowWidth: isColorImage ? undefined : windowLevel.width,
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
    isColorImage,
  ]);

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

  useEffect(() => {
    if (!seriesKey || frameIndex.length === 0) return;
    if (prefetchedSeriesRef.current.has(seriesKey)) return;
    const warmCount = Math.min(frameIndex.length, isUltrasound ? 12 : 6);
    for (let i = 0; i < warmCount; i += 1) {
      const nextFrame = frameIndex[i];
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
    prefetchedSeriesRef.current.add(seriesKey);
  }, [
    seriesKey,
    frameIndex,
    windowLevel.center,
    windowLevel.width,
    renderFormat,
    renderQuality,
    preloadImage,
    isUltrasound,
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
        measurementStore.setTrackingData(measurement.id, {
          seriesUid: response.series_uid,
          totalFrames: response.total_frames,
          startFrameIndex: response.frames[0]?.frame_index ?? 0,
          frames: response.frames.map((frame) => ({
            frameIndex: frame.frame_index,
            points: frame.points,
            lengthMm: frame.length_mm,
            areaMm2: frame.area_mm2 ?? null,
            valid: frame.valid,
          })),
          summary: {
            minMm: response.summary.min_mm,
            maxMm: response.summary.max_mm,
            meanMm: response.summary.mean_mm,
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
        const detail =
          typeof (err as any)?.response?.data?.detail === 'string'
            ? (err as any).response.data.detail
            : null;
        console.error('Failed to track cine measurement:', err);
        setSnackbarMessage(detail ? `Failed to track cine measurement: ${detail}` : 'Failed to track cine measurement.');
      } finally {
        setTrackingMeasurementId(null);
      }
    },
    [trackingMeasurementId, measurementTracks, measurementStore]
  );

  const promoteLineToSeries = useCallback(
    (measurementId: string, line: Measurement) => {
      if (!seriesKey) return;
      // Remove from frame buckets
      setMeasurementsByFrame((prev) => {
        const nextState: Record<string, Measurement[]> = {};
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
    (measurementId: string, polygon: PolygonMeasurement) => {
      if (!seriesKey) return;
      setPolygonsByFrame((prev) => {
        const nextState: Record<string, PolygonMeasurement[]> = {};
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

  // Track a measurement from the panel by ID
  const trackMeasurementById = useCallback(
    async (measurementId: string) => {
      if (!seriesKey) {
        setSnackbarMessage('Please select a series first');
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

      if (storeMeasurement && isLineMeasurement(storeMeasurement)) {
        const lineMeasurement: Measurement = {
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
        await trackMeasurementFor(seriesKey, lineMeasurement, currentSlice);
        return;
      }

      if (storeMeasurement && isPolygonMeasurement(storeMeasurement)) {
        const polygonMeasurement: PolygonMeasurement = {
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
        setTrackingMeasurementId(polygonMeasurement.id);
        setSnackbarMessage('Tracking polygon with optical flow...');
        try {
          const trackingPoints = normalizeTrackingPoints(polygonMeasurement.points);
          const response = await api.series.trackMeasurement(seriesKey, {
            start_index: currentSlice,
            track_full_loop: true,
            points: trackingPoints,
          });

          const framesWithArea = response.frames.map((frame) => ({
            frame_index: frame.frame_index,
            points: frame.points,
            area_mm2: frame.area_mm2,
            valid: frame.valid,
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
            totalFrames: response.total_frames,
            startFrameIndex: response.frames[0]?.frame_index ?? 0,
            frames: framesWithArea.map((frame) => ({
              frameIndex: frame.frame_index,
              points: frame.points,
              lengthMm: null,
              areaMm2: frame.area_mm2 ?? null,
              valid: frame.valid,
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
              `Polygon tracked with optical flow. Area: ${summary.min_area_mm2.toFixed(1)} - ${summary.max_area_mm2.toFixed(1)} mm^2 (Delta ${change}%)`
            );
          } else {
            setSnackbarMessage('Polygon tracked across cine loop with optical flow.');
          }
        } catch (err) {
          console.error('Failed to track polygon with optical flow:', err);
          setSnackbarMessage('Optical flow tracking failed. Using static mode.');
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
        // Track line measurement using existing API
        await trackMeasurementFor(seriesKey, lineMeasurement, currentSlice);
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
        // Track polygon using optical flow API (real tracking with motion detection)
        setTrackingMeasurementId(polygonMeasurement.id);
        setSnackbarMessage('Tracking polygon with optical flow...');
        try {
          const trackingPoints = normalizeTrackingPoints(polygonMeasurement.points);
          const response = await api.series.trackMeasurement(seriesKey, {
            start_index: currentSlice,
            track_full_loop: true,
            points: trackingPoints,
          });

          // Use backend-calculated areas directly
          const framesWithArea = response.frames.map((frame) => ({
            frame_index: frame.frame_index,
            points: frame.points,
            area_mm2: frame.area_mm2, // Backend now calculates area
            valid: frame.valid,
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
            totalFrames: response.total_frames,
            startFrameIndex: response.frames[0]?.frame_index ?? 0,
            frames: framesWithArea.map((frame) => ({
              frameIndex: frame.frame_index,
              points: frame.points,
              lengthMm: null,
              areaMm2: frame.area_mm2 ?? null,
              valid: frame.valid,
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
      measurementStore,
      measurementScope,
      autoPromoteTracking,
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

  const runInteractiveSegmentation = useCallback(
    async (pointsOverride?: SegmentPromptPoint[]) => {
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
        const response: InteractiveSegmentationResponse = await api.ai.interactiveMedsam({
          studyUid,
          seriesUid: seriesKey,
          instanceUid: currentInstanceUid,
          frameIndex: currentSlice,
          prompt: {
            points: points.map((point) => [Math.round(point.x), Math.round(point.y)]),
            pointLabels: points.map((point) => point.label),
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
              frameIndex: currentSlice,
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
          const polygonPoints = buildSegmentPolygon(contour);
          const spacing = currentInstanceMeta?.pixel_spacing ?? [1, 1];
          const pixelSpacing = { rowSpacing: spacing[0], columnSpacing: spacing[1] };
          const areaMm2 = calculatePolygonAreaMm2(polygonPoints, pixelSpacing);
          const perimeterMm = calculatePerimeterMm(polygonPoints, pixelSpacing, true);
          const scope = measurementScope === 'cine' ? 'series' : 'frame';
          const frameKeyForScope = scope === 'frame' ? frameKey : null;

          const measurementId = measurementStore.createMeasurement({
            type: 'polygon',
            scope,
            label: 'Smart Segment',
            color: MEASUREMENT_COLORS.default,
            visible: true,
            locked: false,
            seriesUid: seriesKey,
            frameKey: frameKeyForScope,
            points: polygonPoints,
            perimeterMm,
            areaMm2,
            volumeData: null,
            trackingData: null,
          } as Omit<NewPolygonMeasurement, 'id' | 'createdAt' | 'modifiedAt'>);

          const legacyPolygon = {
            id: measurementId,
            points: polygonPoints,
            areaMm2,
            perimeterMm,
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
              trackMeasurementById(measurementId);
            }, 0);
          }
        }

        setSegmentPromptPoints([]);
        setSnackbarMessage('Smart segmentation complete.');
      } catch (err) {
        const detail =
          typeof (err as any)?.response?.data?.detail === 'string'
            ? (err as any).response.data.detail
            : null;
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
      currentSlice,
      buildSegmentPolygon,
      currentInstanceMeta,
      measurementScope,
      frameKey,
      measurementStore,
      autoTrackCine,
      trackMeasurementById,
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
        nextPoints = [...prev, { ...bounded, label }];
        return nextPoints;
      });

      if (segmentAutoRun && !segmentRunning) {
        runInteractiveSegmentation(nextPoints);
      }
    },
    [
      screenToImage,
      isPointInImage,
      segmentPointMode,
      imageDimensions,
      segmentAutoRun,
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
      const detail =
        typeof (err as any)?.response?.data?.detail === 'string'
          ? (err as any).response.data.detail
          : null;
      console.error('MedSAM preload failed:', err);
      setSnackbarMessage(detail ? detail : 'MedSAM preload failed.');
    } finally {
      setMedsamPreloading(false);
    }
  }, [medsamPreloading, medsamModel, medsamStatus]);

  const handleMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0 || !currentInstanceUid) return;
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

  // Hit test function to find measurement at a point
  const hitTestMeasurement = useCallback(
    (imagePoint: { x: number; y: number }, screenTolerance: number = 8): string | null => {
      const tolerance = screenTolerance / Math.max(scale, 0.0001);
      // Check line measurements
      for (const measurement of visibleMeasurements) {
        // Distance from point to line segment
        const { start, end } = measurement;
        const lineLengthSq = Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2);
        if (lineLengthSq === 0) {
          // Line is a point
          const dist = Math.sqrt(Math.pow(imagePoint.x - start.x, 2) + Math.pow(imagePoint.y - start.y, 2));
          if (dist <= tolerance) return measurement.id;
        } else {
          // Project point onto line
          const t = Math.max(0, Math.min(1,
            ((imagePoint.x - start.x) * (end.x - start.x) + (imagePoint.y - start.y) * (end.y - start.y)) / lineLengthSq
          ));
          const projX = start.x + t * (end.x - start.x);
          const projY = start.y + t * (end.y - start.y);
          const dist = Math.sqrt(Math.pow(imagePoint.x - projX, 2) + Math.pow(imagePoint.y - projY, 2));
          if (dist <= tolerance) return measurement.id;
        }
      }

      // Check polygon measurements
      for (const polygon of visiblePolygons) {
        // Check if point is near any edge or inside polygon
        const { points } = polygon;
        if (points.length < 3) continue;

        // Check edges
        for (let i = 0; i < points.length; i++) {
          const p1 = points[i];
          const p2 = points[(i + 1) % points.length];
          const lineLengthSq = Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2);
          if (lineLengthSq === 0) continue;
          const t = Math.max(0, Math.min(1,
            ((imagePoint.x - p1.x) * (p2.x - p1.x) + (imagePoint.y - p1.y) * (p2.y - p1.y)) / lineLengthSq
          ));
          const projX = p1.x + t * (p2.x - p1.x);
          const projY = p1.y + t * (p2.y - p1.y);
          const dist = Math.sqrt(Math.pow(imagePoint.x - projX, 2) + Math.pow(imagePoint.y - projY, 2));
          if (dist <= tolerance) return polygon.id;
        }

        // Check if point is inside polygon (ray casting)
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const xi = points[i].x, yi = points[i].y;
          const xj = points[j].x, yj = points[j].y;
          if (((yi > imagePoint.y) !== (yj > imagePoint.y)) &&
              (imagePoint.x < (xj - xi) * (imagePoint.y - yi) / (yj - yi) + xi)) {
            inside = !inside;
          }
        }
        if (inside) return polygon.id;
      }

      return null;
    },
    [visibleMeasurements, visiblePolygons, scale]
  );

  // Hit test for measurement handles (endpoints/vertices)
  const hitTestHandle = useCallback(
    (imagePoint: { x: number; y: number }, screenTolerance: number = 10): { id: string; type: 'line' | 'polygon'; handleIndex: number } | null => {
      const tolerance = screenTolerance / Math.max(scale, 0.0001);
      // Check line measurement endpoints
      for (const measurement of visibleMeasurements) {
        const distStart = Math.sqrt(Math.pow(imagePoint.x - measurement.start.x, 2) + Math.pow(imagePoint.y - measurement.start.y, 2));
        if (distStart <= tolerance) return { id: measurement.id, type: 'line', handleIndex: 0 };
        const distEnd = Math.sqrt(Math.pow(imagePoint.x - measurement.end.x, 2) + Math.pow(imagePoint.y - measurement.end.y, 2));
        if (distEnd <= tolerance) return { id: measurement.id, type: 'line', handleIndex: 1 };
      }

      // Check polygon vertices
      for (const polygon of visiblePolygons) {
        for (let i = 0; i < polygon.points.length; i++) {
          const p = polygon.points[i];
          const dist = Math.sqrt(Math.pow(imagePoint.x - p.x, 2) + Math.pow(imagePoint.y - p.y, 2));
          if (dist <= tolerance) return { id: polygon.id, type: 'polygon', handleIndex: i };
        }
      }

      return null;
    },
    [visibleMeasurements, visiblePolygons, scale]
  );

  // Handle pointer tool mouse down for selection and editing
  const handlePointerMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (activeTool !== 'pointer') return;

      const point = screenToImage(event.clientX, event.clientY);
      if (!point) {
        setSelectedMeasurementIdLocal(null);
        measurementStore.selectMeasurement(null);
        return;
      }

      // First check if clicking on a handle
      const handleHit = hitTestHandle(point);
      if (handleHit) {
        clearTrackingForEdit(handleHit.id);
        // Start handle drag
        let originalPoints: Array<{ x: number; y: number }> = [];
        if (handleHit.type === 'line') {
          const m = visibleMeasurements.find(m => m.id === handleHit.id);
          if (m) originalPoints = [m.start, m.end];
        } else {
          const p = visiblePolygons.find(p => p.id === handleHit.id);
          if (p) originalPoints = [...p.points];
        }

        setEditingMeasurement({
          id: handleHit.id,
          type: handleHit.type,
          mode: 'handle',
          handleIndex: handleHit.handleIndex,
          startImagePoint: point,
          originalPoints,
        });
        setSelectedMeasurementIdLocal(handleHit.id);
        measurementStore.selectMeasurement(handleHit.id);
        setIsDragging(true);
        return;
      }

      // Check if clicking on measurement body for moving
      const hitId = hitTestMeasurement(point);
      if (hitId) {
        clearTrackingForEdit(hitId);
        // Start move drag
        let type: 'line' | 'polygon' = 'line';
        let originalPoints: Array<{ x: number; y: number }> = [];

        const lineMeasurement = visibleMeasurements.find(m => m.id === hitId);
        if (lineMeasurement) {
          originalPoints = [lineMeasurement.start, lineMeasurement.end];
        } else {
          const polygonMeasurement = visiblePolygons.find(p => p.id === hitId);
          if (polygonMeasurement) {
            type = 'polygon';
            originalPoints = [...polygonMeasurement.points];
          }
        }

        setEditingMeasurement({
          id: hitId,
          type,
          mode: 'move',
          startImagePoint: point,
          originalPoints,
        });
        setSelectedMeasurementIdLocal(hitId);
        measurementStore.selectMeasurement(hitId);
        setIsDragging(true);
        return;
      }

      // Click on empty space - deselect
      setSelectedMeasurementIdLocal(null);
      measurementStore.selectMeasurement(null);
    },
    [
      activeTool,
      screenToImage,
      hitTestHandle,
      hitTestMeasurement,
      measurementStore,
      visibleMeasurements,
      visiblePolygons,
      clearTrackingForEdit,
    ]
  );

  // Handle polygon click (adding points)
  const handlePolygonClick = useCallback(
    (event: React.MouseEvent) => {
      if (activeTool !== 'polygon') return;
      if (!isPointInImage(event.clientX, event.clientY)) return;
      if (measurementScope === 'frame' && !frameKey) return;
      if (measurementScope === 'cine' && !seriesKey) return;

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
    [activeTool, activePolygon, isPointInImage, screenToImage, imageDimensions, measurementScope, frameKey, seriesKey]
  );

  // Finish polygon drawing
  const finishPolygon = useCallback(() => {
    if (!activePolygon || activePolygon.points.length < 3) {
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
      ? calculatePolygonAreaMm2(activePolygon.points, pixelSpacing)
      : null;
    const perimeterMm = pixelSpacing
      ? calculatePerimeterMm(activePolygon.points, pixelSpacing, true)
      : null;

    const finishedPolygon: PolygonMeasurement = {
      ...activePolygon,
      areaMm2,
      perimeterMm,
    };

    // Add to old state
    if (measurementScope === 'cine' && seriesKey) {
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
      measurementStore.createMeasurement({
        type: 'polygon',
        seriesUid: seriesKey,
        frameKey: measurementScope === 'cine' ? null : frameKey,
        scope: measurementScope === 'cine' ? 'series' : 'frame',
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
    if (measurementScope === 'cine' && totalSlices > 1) {
      setSnackbarMessage('Polygon created. Click Track button for optical flow tracking across frames.');
    } else {
      setSnackbarMessage('Polygon measurement added.');
    }

    setSelectedMeasurementIdLocal(finishedPolygon.id);
    setActivePolygon(null);
    setPolygonPreviewPoint(null);
  }, [activePolygon, currentInstanceMeta, measurementScope, seriesKey, frameKey, measurementStore, totalSlices]);

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
        setEditingMeasurement(null);
        return;
      }

      // Cancel polygon drawing with Escape
      if (event.key === 'Escape' && activePolygon) {
        setActivePolygon(null);
        setPolygonPreviewPoint(null);
        return;
      }

      // Deselect with Escape
      if (event.key === 'Escape' && selectedMeasurementIdLocal) {
        setSelectedMeasurementIdLocal(null);
        measurementStore.selectMeasurement(null);
        return;
      }

      // Delete selected measurement with Delete or Backspace
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedMeasurementIdLocal) {
        event.preventDefault();
        measurementStore.deleteMeasurement(selectedMeasurementIdLocal);
        clearTrackingStateFor([selectedMeasurementIdLocal]);
        // Also delete from old state
        setMeasurementsByFrame((prev) => {
          const newState: Record<string, Measurement[]> = {};
          for (const [key, measurements] of Object.entries(prev)) {
            newState[key] = measurements.filter((m) => m.id !== selectedMeasurementIdLocal);
          }
          return newState;
        });
        setMeasurementsBySeries((prev) => {
          const newState: Record<string, Measurement[]> = {};
          for (const [key, measurements] of Object.entries(prev)) {
            newState[key] = measurements.filter((m) => m.id !== selectedMeasurementIdLocal);
          }
          return newState;
        });
        setPolygonsByFrame((prev) => {
          const newState: Record<string, PolygonMeasurement[]> = {};
          for (const [key, polygons] of Object.entries(prev)) {
            newState[key] = polygons.filter((p) => p.id !== selectedMeasurementIdLocal);
          }
          return newState;
        });
        setPolygonsBySeries((prev) => {
          const newState: Record<string, PolygonMeasurement[]> = {};
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
        switch (event.key.toLowerCase()) {
          case 'v':
          case '1':
            setActiveTool('pointer');
            break;
          case 'h':
          case '2':
            setActiveTool('pan');
            break;
          case 'z':
          case '3':
            setActiveTool('zoom');
            break;
          case 'w':
          case '4':
            setActiveTool('wwwl');
            break;
          case 'm':
          case '5':
            setActiveTool('measure');
            break;
          case 'a':
          case '6':
            setActiveTool('polygon');
            break;
          case 's':
          case '8':
            setActiveTool('segment');
            break;
          case 'r':
          case '7':
            setActiveTool('rotate');
            break;
          case ' ': // Spacebar to play/pause cine
            event.preventDefault();
            setIsPlaying((prev) => !prev);
            break;
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
  }, [activePolygon, selectedMeasurementIdLocal, measurementStore, clearTrackingStateFor]);

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      lastPointerRef.current = { x: event.clientX, y: event.clientY };

      // Handle pointer tool editing (moving measurements/handles)
      if (editingMeasurement) {
        const currentPoint = screenToImage(event.clientX, event.clientY);
        if (!currentPoint) return;

        const dx = currentPoint.x - editingMeasurement.startImagePoint.x;
        const dy = currentPoint.y - editingMeasurement.startImagePoint.y;

        if (editingMeasurement.type === 'line') {
          if (editingMeasurement.mode === 'handle' && editingMeasurement.handleIndex !== undefined) {
            // Move single endpoint
            const newPoints = [...editingMeasurement.originalPoints];
            newPoints[editingMeasurement.handleIndex] = {
              x: clamp(editingMeasurement.originalPoints[editingMeasurement.handleIndex].x + dx, 0, imageDimensions.columns),
              y: clamp(editingMeasurement.originalPoints[editingMeasurement.handleIndex].y + dy, 0, imageDimensions.rows),
            };
            // Update in old state
            const updateMeasurement = (measurements: Measurement[]) =>
              measurements.map((m) =>
                m.id === editingMeasurement.id
                  ? { ...m, start: newPoints[0], end: newPoints[1] }
                  : m
              );
            setMeasurementsByFrame((prev) => {
              const newState: Record<string, Measurement[]> = {};
              for (const [key, ms] of Object.entries(prev)) {
                newState[key] = updateMeasurement(ms);
              }
              return newState;
            });
            setMeasurementsBySeries((prev) => {
              const newState: Record<string, Measurement[]> = {};
              for (const [key, ms] of Object.entries(prev)) {
                newState[key] = updateMeasurement(ms);
              }
              return newState;
            });
          } else {
            // Move entire measurement
            const newPoints = editingMeasurement.originalPoints.map((p) => ({
              x: clamp(p.x + dx, 0, imageDimensions.columns),
              y: clamp(p.y + dy, 0, imageDimensions.rows),
            }));
            const updateMeasurement = (measurements: Measurement[]) =>
              measurements.map((m) =>
                m.id === editingMeasurement.id
                  ? { ...m, start: newPoints[0], end: newPoints[1] }
                  : m
              );
            setMeasurementsByFrame((prev) => {
              const newState: Record<string, Measurement[]> = {};
              for (const [key, ms] of Object.entries(prev)) {
                newState[key] = updateMeasurement(ms);
              }
              return newState;
            });
            setMeasurementsBySeries((prev) => {
              const newState: Record<string, Measurement[]> = {};
              for (const [key, ms] of Object.entries(prev)) {
                newState[key] = updateMeasurement(ms);
              }
              return newState;
            });
          }
        } else if (editingMeasurement.type === 'polygon') {
          if (editingMeasurement.mode === 'handle' && editingMeasurement.handleIndex !== undefined) {
            // Move single vertex
            const newPoints = [...editingMeasurement.originalPoints];
            newPoints[editingMeasurement.handleIndex] = {
              x: clamp(editingMeasurement.originalPoints[editingMeasurement.handleIndex].x + dx, 0, imageDimensions.columns),
              y: clamp(editingMeasurement.originalPoints[editingMeasurement.handleIndex].y + dy, 0, imageDimensions.rows),
            };
            const updatePolygon = (polygons: PolygonMeasurement[]) =>
              polygons.map((p) =>
                p.id === editingMeasurement.id ? { ...p, points: newPoints } : p
              );
            setPolygonsByFrame((prev) => {
              const newState: Record<string, PolygonMeasurement[]> = {};
              for (const [key, ps] of Object.entries(prev)) {
                newState[key] = updatePolygon(ps);
              }
              return newState;
            });
            setPolygonsBySeries((prev) => {
              const newState: Record<string, PolygonMeasurement[]> = {};
              for (const [key, ps] of Object.entries(prev)) {
                newState[key] = updatePolygon(ps);
              }
              return newState;
            });
          } else {
            // Move entire polygon
            const newPoints = editingMeasurement.originalPoints.map((p) => ({
              x: clamp(p.x + dx, 0, imageDimensions.columns),
              y: clamp(p.y + dy, 0, imageDimensions.rows),
            }));
            const updatePolygon = (polygons: PolygonMeasurement[]) =>
              polygons.map((p) =>
                p.id === editingMeasurement.id ? { ...p, points: newPoints } : p
              );
            setPolygonsByFrame((prev) => {
              const newState: Record<string, PolygonMeasurement[]> = {};
              for (const [key, ps] of Object.entries(prev)) {
                newState[key] = updatePolygon(ps);
              }
              return newState;
            });
            setPolygonsBySeries((prev) => {
              const newState: Record<string, PolygonMeasurement[]> = {};
              for (const [key, ps] of Object.entries(prev)) {
                newState[key] = updatePolygon(ps);
              }
              return newState;
            });
          }
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
    ]
  );

  const handleMouseUp = useCallback(() => {
    // Handle pointer tool editing completion
    if (editingMeasurement) {
      // Recalculate measurement values after editing
      const spacing = currentInstanceMeta?.pixel_spacing ?? [1, 1];
      const pixelSpacing = { rowSpacing: spacing[0], columnSpacing: spacing[1] };

      if (editingMeasurement.type === 'line') {
        // Recalculate line length
        const updateMeasurement = (measurements: Measurement[]) =>
          measurements.map((m) => {
            if (m.id !== editingMeasurement.id) return m;
            const dxMm = (m.end.x - m.start.x) * spacing[1];
            const dyMm = (m.end.y - m.start.y) * spacing[0];
            const lengthMm = Math.sqrt(dxMm * dxMm + dyMm * dyMm);
            return { ...m, lengthMm };
          });
        setMeasurementsByFrame((prev) => {
          const newState: Record<string, Measurement[]> = {};
          for (const [key, ms] of Object.entries(prev)) {
            newState[key] = updateMeasurement(ms);
          }
          return newState;
        });
        setMeasurementsBySeries((prev) => {
          const newState: Record<string, Measurement[]> = {};
          for (const [key, ms] of Object.entries(prev)) {
            newState[key] = updateMeasurement(ms);
          }
          return newState;
        });
      } else if (editingMeasurement.type === 'polygon') {
        // Recalculate polygon area and perimeter
        const updatePolygon = (polygons: PolygonMeasurement[]) =>
          polygons.map((p) => {
            if (p.id !== editingMeasurement.id) return p;
            const areaMm2 = calculatePolygonAreaMm2(p.points, pixelSpacing);
            const perimeterMm = calculatePerimeterMm(p.points, pixelSpacing, true);
            return { ...p, areaMm2, perimeterMm };
          });
        setPolygonsByFrame((prev) => {
          const newState: Record<string, PolygonMeasurement[]> = {};
          for (const [key, ps] of Object.entries(prev)) {
            newState[key] = updatePolygon(ps);
          }
          return newState;
        });
        setPolygonsBySeries((prev) => {
          const newState: Record<string, PolygonMeasurement[]> = {};
          for (const [key, ps] of Object.entries(prev)) {
            newState[key] = updatePolygon(ps);
          }
          return newState;
        });
      }

      const pointer = lastPointerRef.current;
      const currentPoint = pointer ? screenToImage(pointer.x, pointer.y) : null;
      const dx = currentPoint ? currentPoint.x - editingMeasurement.startImagePoint.x : 0;
      const dy = currentPoint ? currentPoint.y - editingMeasurement.startImagePoint.y : 0;
      const hasMovement = Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01;

      if (hasMovement) {
        const clampPoint = (point: { x: number; y: number }) => ({
          x: clamp(point.x + dx, 0, imageDimensions.columns),
          y: clamp(point.y + dy, 0, imageDimensions.rows),
        });

        if (editingMeasurement.type === 'line') {
          const newPoints = [...editingMeasurement.originalPoints];
          if (editingMeasurement.mode === 'handle' && editingMeasurement.handleIndex !== undefined) {
            newPoints[editingMeasurement.handleIndex] = clampPoint(
              editingMeasurement.originalPoints[editingMeasurement.handleIndex]
            );
          } else {
            for (let i = 0; i < newPoints.length; i += 1) {
              newPoints[i] = clampPoint(newPoints[i]);
            }
          }

          const dxMm = (newPoints[1].x - newPoints[0].x) * spacing[1];
          const dyMm = (newPoints[1].y - newPoints[0].y) * spacing[0];
          const lengthMm = Math.sqrt(dxMm * dxMm + dyMm * dyMm);

          measurementStore.updateMeasurement(editingMeasurement.id, {
            points: [newPoints[0], newPoints[1]],
            lengthMm,
          });
        } else if (editingMeasurement.type === 'polygon') {
          const newPoints = editingMeasurement.originalPoints.map(clampPoint);
          const areaMm2 = calculatePolygonAreaMm2(newPoints, pixelSpacing);
          const perimeterMm = calculatePerimeterMm(newPoints, pixelSpacing, true);

          measurementStore.updateMeasurement(editingMeasurement.id, {
            points: newPoints,
            areaMm2,
            perimeterMm,
          });
        }
      }

      setEditingMeasurement(null);
      setIsDragging(false);
      setSnackbarMessage('Measurement updated.');
      return;
    }

    const dragState = dragStateRef.current;
    if (dragState?.tool === 'measure' && activeMeasurement) {
      const measurement = activeMeasurement;
      if (dragState.measureScope === 'cine' && dragState.measureSeriesKey) {
        const key = dragState.measureSeriesKey;
        setMeasurementsBySeries((prev) => {
          const existing = prev[key] ?? [];
          return { ...prev, [key]: [...existing, measurement] };
        });

        // Also add to new measurement store for panel display (use same ID for sync)
        measurementStore.createMeasurement({
          type: 'line',
          seriesUid: dragState.measureSeriesKey,
          frameKey: dragState.measureFrameKey || null,
          scope: 'series',
          points: [measurement.start, measurement.end] as [{ x: number; y: number }, { x: number; y: number }],
          label: null,
          visible: true,
          locked: false,
          color: '#3b82f6',
          lengthMm: measurement.lengthMm,
          trackingData: null,
        } as Omit<NewLineMeasurement, 'id' | 'createdAt' | 'modifiedAt'>, measurement.id);
        setSelectedMeasurementIdLocal(measurement.id);
      } else if (dragState.measureFrameKey) {
        const key = dragState.measureFrameKey;
        setMeasurementsByFrame((prev) => {
          const existing = prev[key] ?? [];
          return { ...prev, [key]: [...existing, measurement] };
        });

        // Also add to new measurement store for panel display (use same ID for sync)
        if (seriesKey) {
          measurementStore.createMeasurement({
            type: 'line',
            seriesUid: seriesKey,
            frameKey: dragState.measureFrameKey,
            scope: 'frame',
            points: [measurement.start, measurement.end] as [{ x: number; y: number }, { x: number; y: number }],
            label: null,
            visible: true,
            locked: false,
            color: '#3b82f6',
            lengthMm: measurement.lengthMm,
            trackingData: null,
          } as Omit<NewLineMeasurement, 'id' | 'createdAt' | 'modifiedAt'>, measurement.id);
        }
        setSelectedMeasurementIdLocal(measurement.id);
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
  }, [
    activeMeasurement,
    autoTrackCine,
    trackMeasurementFor,
    measurementStore,
    seriesKey,
    editingMeasurement,
    currentInstanceMeta,
    screenToImage,
    imageDimensions,
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
              patientId: patientDetails?.patient_id ?? study?.patient_id ?? undefined,
              patientName: patientDetails?.patient_name ?? study?.patient_name ?? undefined,
              patientBirthDate: patientDetails?.birth_date ?? undefined,
              patientSex: patientDetails?.sex ?? undefined,
              issuerOfPatientId: patientDetails?.issuer_of_patient_id ?? undefined,
              otherPatientIds: patientDetails?.other_patient_ids ?? undefined,
              ethnicGroup: patientDetails?.ethnic_group ?? undefined,
              patientComments: patientDetails?.comments ?? undefined,
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
  }, [measurementStore, study, selectedSeries, seriesKey, trackingDataMap]);

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
            measurementStore.createMeasurement(m);
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
      return api.instances.getPixelDataUrl(frame.instanceUid, {
        frame: frame.frameIndex,
        windowCenter: isColorImage ? undefined : windowLevel.center,
        windowWidth: isColorImage ? undefined : windowLevel.width,
        format: renderFormat,
        quality: renderFormat === 'jpeg' ? renderQuality : undefined,
      });
    },
    [frameIndex, windowLevel.center, windowLevel.width, renderFormat, renderQuality, isColorImage]
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

    const observationEntries = newStoreMeasurements
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
    newStoreMeasurements,
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
      setMeasurementScope('cine');
      setShowMeasurementPanel(true);
      setSnackbarMessage(`Draw ${requirement.label} on the cine loop.`);
    },
    [seriesKey, setActiveTool, setMeasurementScope, setShowMeasurementPanel, setSnackbarMessage]
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
  }, [seriesKey, volumeInfo, setMprVolumeInfo, windowLevel.center, windowLevel.width]);

  const openVolumeViewer = useCallback(async () => {
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
  }, [ensureVolumeInfo]);

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
  }, [layoutMode, ensureVolumeInfo, clearMprVolume]);

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
    if (layoutMode !== 'mpr' || !seriesKey) return;
    ensureVolumeInfo();
  }, [layoutMode, seriesKey, ensureVolumeInfo]);

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
      const detail =
        typeof (err as any)?.response?.data?.detail === 'string'
          ? (err as any).response.data.detail
          : null;
      console.error('AI job failed:', err);
      setSnackbarMessage(detail ? `AI analysis failed: ${detail}` : 'AI analysis failed');
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

  const interactiveSegmentationOverlays = useMemo(() => {
    if (!studyUid || !seriesKey) return [] as Array<{ id: string; url: string }>;
    return interactiveSegmentations
      .filter((result) => result.seriesUid === seriesKey)
      .filter((result) => {
        if (!result.maskShape) return false;
        if (result.maskShape.length === 2) {
          return result.frameIndex === currentSlice;
        }
        return true;
      })
      .map((result) => {
        const sliceIndex = clampMaskSliceIndex(currentSlice, result.maskShape);
        return {
          id: result.id,
          url: api.ai.getMaskOverlayUrl(studyUid, result.maskFilename, sliceIndex),
        };
      });
  }, [interactiveSegmentations, studyUid, seriesKey, currentSlice]);

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

  const tools = [
    { id: 'pointer', label: 'Select', icon: <PointerIcon /> },
    { id: 'pan', label: 'Pan', icon: <PanIcon /> },
    { id: 'zoom', label: 'Zoom', icon: <ZoomIcon /> },
    { id: 'wwwl', label: 'Window/Level', icon: <ContrastIcon /> },
    { id: 'measure', label: 'Measure', icon: <MeasureIcon /> },
    { id: 'polygon', label: 'Area', icon: <AreaIcon /> },
    { id: 'segment', label: 'Smart Segment', icon: <SmartSegmentIcon /> },
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

        <Tooltip title={`Measurements: ${measurementScope === 'cine' ? 'Cine' : 'Frame'}`}>
          <span>
            <IconButton
              onClick={() =>
                setMeasurementScope((prev) => (prev === 'cine' ? 'frame' : 'cine'))
              }
              color={measurementScope === 'cine' ? 'primary' : 'default'}
              aria-label="Toggle measurement scope"
              disabled={activeTool !== 'measure' && activeTool !== 'polygon'}
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

        <Tooltip title="Cardiac Function Calculator (EF/FS)">
          <IconButton
            onClick={() => setEfCalculatorOpen(true)}
            color={newStoreMeasurements.length > 0 ? 'primary' : 'default'}
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

        <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

        <Tooltip title="3D Volume">
          <span>
            <IconButton onClick={openVolumeViewer} disabled={!selectedSeries?.has_3d_data}>
              <ThreeDIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Layout">
          <IconButton
            onClick={handleToggleLayout}
            color={layoutMode === 'mpr' ? 'primary' : 'default'}
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
                  const instanceUid = detail?.instances?.[0]?.sop_instance_uid;
                  const thumbnail = instanceUid ? api.instances.getThumbnailUrl(instanceUid, 256) : null;
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
                            {detail?.instances?.length ?? series.num_instances} frames
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

                  {/* Legacy measurements (old system) */}
                  {visibleMeasurements.map((measurement) => {
                    const isSelected = selectedMeasurementIdLocal === measurement.id;
                    const strokeColor = isSelected ? '#f59e0b' : '#3b82f6';
                    const strokeWidth = isSelected ? 3 : 2;
                    const handleRadius = isSelected ? 6 : 4;
                    const track =
                      measurementScope === 'cine'
                        ? displayMeasurementTracks[measurement.id]
                        : null;
                    const trailFrames =
                      showTrackingTrails && track
                        ? getTrailFrames(track.frames, currentSlice, trackingTrailLength)
                        : [];

                    return (
                      <g key={measurement.id} style={{ cursor: activeTool === 'pointer' ? 'pointer' : 'default' }}>
                        {/* Motion trail */}
                        {trailFrames.map(({ frame, distance }) => (
                          <line
                            key={`trail-${measurement.id}-${frame.frame_index}`}
                            x1={frame.points[0]?.x ?? measurement.start.x}
                            y1={frame.points[0]?.y ?? measurement.start.y}
                            x2={frame.points[1]?.x ?? measurement.end.x}
                            y2={frame.points[1]?.y ?? measurement.end.y}
                            stroke={strokeColor}
                            strokeWidth={Math.max(1, strokeWidth - 1)}
                            opacity={getTrailOpacity(distance, trackingTrailLength)}
                          />
                        ))}
                        {/* Selection highlight */}
                        {isSelected && (
                          <line
                            x1={measurement.start.x}
                            y1={measurement.start.y}
                            x2={measurement.end.x}
                            y2={measurement.end.y}
                            stroke="#fff"
                            strokeWidth={strokeWidth + 2}
                            opacity={0.5}
                          />
                        )}
                        <line
                          x1={measurement.start.x}
                          y1={measurement.start.y}
                          x2={measurement.end.x}
                          y2={measurement.end.y}
                          stroke={strokeColor}
                          strokeWidth={strokeWidth}
                        />
                        <circle cx={measurement.start.x} cy={measurement.start.y} r={handleRadius} fill={strokeColor} stroke={isSelected ? '#fff' : 'none'} strokeWidth={2} />
                        <circle cx={measurement.end.x} cy={measurement.end.y} r={handleRadius} fill={strokeColor} stroke={isSelected ? '#fff' : 'none'} strokeWidth={2} />
                        {measurement.lengthMm !== null && (
                          <text
                            x={(measurement.start.x + measurement.end.x) / 2}
                            y={(measurement.start.y + measurement.end.y) / 2 - 8}
                            fill={strokeColor}
                            fontSize={12}
                            fontFamily="monospace"
                            fontWeight={isSelected ? 'bold' : 'normal'}
                          >
                            {measurement.lengthMm.toFixed(1)} mm
                          </text>
                        )}
                      </g>
                    );
                  })}

                  {/* Polygon/Area measurements */}
                  {visiblePolygons.map((polygon) => {
                    const isActive = activePolygon && polygon.id === activePolygon.id;
                    const isSelected = selectedMeasurementIdLocal === polygon.id;
                    const track =
                      measurementScope === 'cine'
                        ? displayPolygonTracks[polygon.id]
                        : null;
                    const trailFrames =
                      showTrackingTrails && track && !isActive
                        ? getTrailFrames(track.frames, currentSlice, trackingTrailLength)
                        : [];
                    const basePoints =
                      isActive && polygonPreviewPoint
                        ? [...polygon.points, polygonPreviewPoint]
                        : polygon.points;
                    const renderPoints =
                      !isActive && smoothContoursEnabled && basePoints.length >= 3
                        ? smoothPolygon(basePoints, smoothContoursIterations)
                        : basePoints;
                    const previewSmoothPoints =
                      isActive && smoothContoursEnabled && basePoints.length >= 3
                        ? smoothPolygon(basePoints, smoothContoursIterations)
                        : null;
                    const pathD = buildPathFromPoints(renderPoints, !isActive);
                    const previewPath = previewSmoothPoints
                      ? buildPathFromPoints(previewSmoothPoints, false)
                      : '';
                    const centroidX = polygon.points.length
                      ? polygon.points.reduce((sum, p) => sum + p.x, 0) / polygon.points.length
                      : 0;
                    const centroidY = polygon.points.length
                      ? polygon.points.reduce((sum, p) => sum + p.y, 0) / polygon.points.length
                      : 0;
                    const strokeColor = isSelected ? '#f59e0b' : '#10b981';
                    const fillColor = isActive ? 'rgba(16, 185, 129, 0.2)' : isSelected ? 'rgba(245, 158, 11, 0.2)' : 'rgba(16, 185, 129, 0.15)';

                    return (
                      <g key={polygon.id} style={{ cursor: activeTool === 'pointer' ? 'pointer' : 'default' }}>
                        {/* Motion trail */}
                        {trailFrames.map(({ frame, distance }) => {
                          const trailPoints =
                            smoothContoursEnabled && frame.points.length >= 3
                              ? smoothPolygon(frame.points, smoothContoursIterations)
                              : frame.points;
                          const trailPath = buildPathFromPoints(trailPoints, true);
                          return (
                            <path
                              key={`trail-${polygon.id}-${frame.frame_index}`}
                              d={trailPath}
                              fill="none"
                              stroke={strokeColor}
                              strokeWidth={Math.max(1, (isSelected ? 3 : 2) - 1)}
                              opacity={getTrailOpacity(distance, trackingTrailLength)}
                            />
                          );
                        })}
                        {/* Smooth preview path while drawing */}
                        {previewSmoothPoints && (
                          <path
                            d={previewPath}
                            fill="none"
                            stroke={strokeColor}
                            strokeWidth={isSelected ? 2 : 1.5}
                            opacity={0.35}
                            strokeLinejoin="round"
                          />
                        )}
                        {/* Polygon fill and stroke */}
                        <path
                          d={pathD}
                          fill={isActive ? 'none' : fillColor}
                          stroke={strokeColor}
                          strokeWidth={isSelected ? 3 : 2}
                          strokeDasharray={isActive ? '5,5' : 'none'}
                          strokeLinejoin="round"
                        />
                        {/* Vertex handles */}
                        {polygon.points.map((point, idx) => (
                          <circle
                            key={idx}
                            cx={point.x}
                            cy={point.y}
                            r={isActive && idx === 0 ? 6 : isSelected ? 5 : 4}
                            fill={isActive && idx === 0 ? '#22c55e' : strokeColor}
                            stroke={(isActive && idx === 0) || isSelected ? '#fff' : 'none'}
                            strokeWidth={2}
                          />
                        ))}
                        {/* Area label (only for finished polygons) */}
                        {!isActive && polygon.areaMm2 !== null && (
                          <text
                            x={centroidX}
                            y={centroidY}
                            fill={strokeColor}
                            fontSize={12}
                            fontFamily="monospace"
                            fontWeight={isSelected ? 'bold' : 'normal'}
                            textAnchor="middle"
                            dominantBaseline="middle"
                          >
                            {polygon.areaMm2.toFixed(1)} mm^2
                          </text>
                        )}
                        {/* Active polygon instruction */}
                        {isActive && polygon.points.length >= 3 && (
                          <text
                            x={centroidX}
                            y={centroidY}
                            fill="#10b981"
                            fontSize={10}
                            fontFamily="sans-serif"
                            textAnchor="middle"
                            dominantBaseline="middle"
                            opacity={0.8}
                          >
                            Double-click to close
                          </text>
                        )}
                      </g>
                    );
                  })}
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
              <Typography variant="caption" color="text.secondary">
                Contour points
              </Typography>
              <Slider
                value={segmentContourPoints}
                onChange={(_, value) => setSegmentContourPoints(value as number)}
                min={8}
                max={64}
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

        {/* New Measurement Panel */}
        {showMeasurementPanel && seriesKey && (
          <MeasurementPanel
            measurements={newStoreMeasurements}
            selectedId={selectedMeasurementId}
            canUndo={measurementStore.canUndo()}
            canRedo={measurementStore.canRedo()}
            seriesUid={seriesKey}
            frameKey={currentFrameKey}
            onSelectMeasurement={(id) => {
              measurementStore.selectMeasurement(id);
              setSelectedMeasurementIdLocal(id);
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
                const newState: Record<string, Measurement[]> = {};
                for (const [key, measurements] of Object.entries(prev)) {
                  newState[key] = measurements.filter((m) => m.id !== id);
                }
                return newState;
              });
              setMeasurementsBySeries((prev) => {
                const newState: Record<string, Measurement[]> = {};
                for (const [key, measurements] of Object.entries(prev)) {
                  newState[key] = measurements.filter((m) => m.id !== id);
                }
                return newState;
              });
              // Also delete polygons from old state
              setPolygonsByFrame((prev) => {
                const newState: Record<string, PolygonMeasurement[]> = {};
                for (const [key, polygons] of Object.entries(prev)) {
                  newState[key] = polygons.filter((p) => p.id !== id);
                }
                return newState;
              });
              setPolygonsBySeries((prev) => {
                const newState: Record<string, PolygonMeasurement[]> = {};
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
                const newState: Record<string, Measurement[]> = {};
                for (const key of Object.keys(prev)) {
                  // Clear all frame measurements
                  newState[key] = [];
                }
                return newState;
              });
              // Also clear polygons from old state
              setPolygonsBySeries((prev) => ({ ...prev, [seriesKey]: [] }));
              setPolygonsByFrame((prev) => {
                const newState: Record<string, PolygonMeasurement[]> = {};
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
                {newStoreMeasurements
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
                {newStoreMeasurements.filter((m) => m.type === 'polygon').length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    Draw polygon areas first
                  </Typography>
                )}
              </Box>

              <Typography variant="subtitle2" gutterBottom>
                End-Systolic (ESV):
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
                {newStoreMeasurements
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
                const edvMeasurement = newStoreMeasurements.find((m) => m.id === efEdvMeasurementId);
                const esvMeasurement = newStoreMeasurements.find((m) => m.id === efEsvMeasurementId);
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
                {newStoreMeasurements
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
                {newStoreMeasurements.filter((m) => m.type === 'line').length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    Draw line measurements first
                  </Typography>
                )}
              </Box>

              <Typography variant="subtitle2" gutterBottom>
                LV End-Systolic (LVESD):
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
                {newStoreMeasurements
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
                const lvedd = newStoreMeasurements.find((m) => m.id === edId);
                const lvesd = newStoreMeasurements.find((m) => m.id === esId);
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
