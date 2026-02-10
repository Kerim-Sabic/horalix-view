/**
 * ViewerPage Type Definitions
 *
 * Extracted from ViewerPage.tsx to reduce monolith size and improve
 * readability. Contains all local types used by the viewer page.
 */

import type { Point2D } from '../features/viewer/types';
import type { InteractiveSegmentationResult as OverlayInteractiveSegmentationResult } from '../features/viewer/app/overlays/buildOverlays';

// ============================================================================
// Viewport Types
// ============================================================================

export type ViewportState = {
  zoom: number;
  pan: { x: number; y: number };
  windowLevel: { center: number; width: number };
  rotation: number;
  sliceIndex: number;
};

// ============================================================================
// Metadata Types
// ============================================================================

export type MetadataDraft = {
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

// ============================================================================
// Interaction Types
// ============================================================================

export type DragState = {
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
  measureInstanceUid?: string;
  measureScope?: 'frame' | 'cine';
};

export type SegmentPromptPoint = {
  x: number;
  y: number;
  label: 0 | 1;
};

export type InteractiveSegmentationResult = OverlayInteractiveSegmentationResult & {
  createdAt: number;
  primaryContour: Point2D[];
};

export type CineBookmark = {
  id: string;
  frameIndex: number;
  label: string;
  createdAt: number;
};

// ============================================================================
// API Types
// ============================================================================

export type ApiError = {
  response?: {
    data?: {
      detail?: string;
    };
  };
};

export type PathologyResults = {
  output?: {
    tile_count?: number | string;
  };
};
