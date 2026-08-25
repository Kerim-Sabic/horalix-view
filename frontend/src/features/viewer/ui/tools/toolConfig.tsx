import {
  AutoFixHigh as SmartSegmentIcon,
  Contrast as ContrastIcon,
  Gesture as FreehandIcon,
  NearMe as PointerIcon,
  PanTool as PanIcon,
  RotateRight as RotateIcon,
  SquareFoot as AreaIcon,
  Straighten as MeasureIcon,
  ZoomIn as ZoomIcon,
} from '@mui/icons-material';
import React from 'react';

import { VIEWER_TOOLS, type ViewerToolId } from '../../domain/tools';

export type ViewerToolConfig = {
  id: ViewerToolId;
  label: string;
  icon: React.ReactElement;
  shortcut: string;
  tooltip: string;
};

const TOOL_ICONS: Record<ViewerToolId, React.ReactElement> = {
  pointer: <PointerIcon />,
  pan: <PanIcon />,
  zoom: <ZoomIcon />,
  wwwl: <ContrastIcon />,
  rotate: <RotateIcon />,
  measure: <MeasureIcon />,
  polygon: <AreaIcon />,
  freehand: <FreehandIcon />,
  segment: <SmartSegmentIcon />,
};

/**
 * Toolbar entries, derived from the canonical tool list so a tool can never be
 * declared without being reachable. Order here is the display order.
 */
export const VIEWER_TOOL_CONFIGS: ViewerToolConfig[] = VIEWER_TOOLS.map((tool) => ({
  id: tool.id,
  label: tool.label,
  icon: TOOL_ICONS[tool.id],
  shortcut: tool.shortcut,
  tooltip: `${tool.tooltip} (${tool.shortcut})`,
}));
