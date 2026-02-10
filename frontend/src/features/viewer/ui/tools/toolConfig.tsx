import {
  AutoFixHigh as SmartSegmentIcon,
  Contrast as ContrastIcon,
  NearMe as PointerIcon,
  PanTool as PanIcon,
  RotateRight as RotateIcon,
  SquareFoot as AreaIcon,
  Straighten as MeasureIcon,
  ZoomIn as ZoomIcon,
} from '@mui/icons-material';
import React from 'react';

import type { ViewerToolId } from '../../domain/tools';

export type ViewerToolConfig = {
  id: ViewerToolId;
  label: string;
  icon: React.ReactElement;
};

export const VIEWER_TOOL_CONFIGS: ViewerToolConfig[] = [
  { id: 'pointer', label: 'Select', icon: <PointerIcon /> },
  { id: 'pan', label: 'Pan', icon: <PanIcon /> },
  { id: 'zoom', label: 'Zoom', icon: <ZoomIcon /> },
  { id: 'wwwl', label: 'Window/Level', icon: <ContrastIcon /> },
  { id: 'measure', label: 'Measure', icon: <MeasureIcon /> },
  { id: 'polygon', label: 'Area', icon: <AreaIcon /> },
  { id: 'segment', label: 'Smart Segment', icon: <SmartSegmentIcon /> },
  { id: 'rotate', label: 'Rotate', icon: <RotateIcon /> },
];
