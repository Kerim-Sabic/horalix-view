/**
 * Viewer tools
 *
 * The single source of truth for which tools exist. Both the toolbar and the
 * viewport interaction code derive from this list, so a tool cannot be
 * declared in one place and be unreachable in the other.
 */

export type ViewerToolId =
  | 'pointer'
  | 'pan'
  | 'zoom'
  | 'wwwl'
  | 'rotate'
  | 'measure'
  | 'polygon'
  | 'freehand'
  | 'segment';

export type ViewerToolCategory = 'selection' | 'navigation' | 'measurement';

export interface ViewerToolMeta {
  id: ViewerToolId;
  label: string;
  category: ViewerToolCategory;
  /** CSS cursor while the tool is active and idle. */
  cursor: string;
  /** Single-key shortcut. */
  shortcut: string;
  tooltip: string;
}

export const VIEWER_TOOLS: readonly ViewerToolMeta[] = [
  {
    id: 'pointer',
    label: 'Select',
    category: 'selection',
    cursor: 'default',
    shortcut: 'V',
    tooltip: 'Select and edit measurements',
  },
  {
    id: 'pan',
    label: 'Pan',
    category: 'navigation',
    cursor: 'grab',
    shortcut: 'H',
    tooltip: 'Pan the image',
  },
  {
    id: 'zoom',
    label: 'Zoom',
    category: 'navigation',
    cursor: 'zoom-in',
    shortcut: 'Z',
    tooltip: 'Zoom in and out',
  },
  {
    id: 'wwwl',
    label: 'Window/Level',
    category: 'navigation',
    cursor: 'crosshair',
    shortcut: 'W',
    tooltip: 'Adjust brightness and contrast',
  },
  {
    id: 'rotate',
    label: 'Rotate',
    category: 'navigation',
    cursor: 'crosshair',
    shortcut: 'R',
    tooltip: 'Rotate the image',
  },
  {
    id: 'measure',
    label: 'Measure',
    category: 'measurement',
    cursor: 'crosshair',
    shortcut: 'M',
    tooltip: 'Measure a distance',
  },
  {
    id: 'polygon',
    label: 'Area',
    category: 'measurement',
    cursor: 'crosshair',
    shortcut: 'A',
    tooltip: 'Click points to trace an area',
  },
  {
    id: 'freehand',
    label: 'Freehand',
    category: 'measurement',
    cursor: 'crosshair',
    shortcut: 'F',
    tooltip: 'Drag to trace a border by hand',
  },
  {
    id: 'segment',
    label: 'Smart Segment',
    category: 'measurement',
    cursor: 'crosshair',
    shortcut: 'S',
    tooltip: 'Click inside a cavity to auto-contour',
  },
] as const;

const TOOL_BY_ID = new Map<ViewerToolId, ViewerToolMeta>(
  VIEWER_TOOLS.map((tool) => [tool.id, tool])
);

export const getToolMeta = (id: ViewerToolId): ViewerToolMeta =>
  TOOL_BY_ID.get(id) ?? VIEWER_TOOLS[0];

export const getToolsByCategory = (category: ViewerToolCategory): ViewerToolMeta[] =>
  VIEWER_TOOLS.filter((tool) => tool.category === category);

export const getDefaultTool = (): ViewerToolId => 'pointer';

export const isNavigationTool = (id: ViewerToolId): boolean =>
  getToolMeta(id).category === 'navigation';

export const isMeasurementTool = (id: ViewerToolId): boolean =>
  getToolMeta(id).category === 'measurement';

export const isSelectionTool = (id: ViewerToolId): boolean => id === 'pointer';

/** Tools that produce a closed contour with an area. */
export const isAreaTool = (id: ViewerToolId): boolean =>
  id === 'polygon' || id === 'freehand' || id === 'segment';

/**
 * Numeric aliases for the tool palette, matching the toolbar order.
 * These sit alongside the letter shortcut each tool declares.
 */
const NUMERIC_SHORTCUTS: Record<string, ViewerToolId> = {
  '1': 'pointer',
  '2': 'pan',
  '3': 'zoom',
  '4': 'wwwl',
  '5': 'measure',
  '6': 'polygon',
  '7': 'rotate',
  '8': 'segment',
  '9': 'freehand',
};

/** Resolve a shortcut key (case-insensitive) to a tool, if one is bound. */
export const toolForShortcut = (key: string): ViewerToolId | null => {
  const numeric = NUMERIC_SHORTCUTS[key];
  if (numeric) return numeric;
  const upper = key.toUpperCase();
  return VIEWER_TOOLS.find((tool) => tool.shortcut === upper)?.id ?? null;
};

export const getToolCursor = (
  id: ViewerToolId,
  isDragging: boolean,
  canInteract = true
): string => {
  if (!canInteract) return 'not-allowed';
  if (isDragging) {
    if (id === 'pan') return 'grabbing';
    if (id === 'zoom') return 'zoom-in';
    return 'crosshair';
  }
  return getToolMeta(id).cursor;
};
