import type { ViewerToolId } from '../../domain/tools';
import type { MeasurementEditState } from './interaction';

type SelectionActions = {
  setSelectedMeasurementId: (id: string | null) => void;
  selectMeasurement: (id: string | null) => void;
};

type EditActions = SelectionActions & {
  setEditingMeasurement: (state: MeasurementEditState | null) => void;
  setIsDragging: (isDragging: boolean) => void;
};

const TOOL_SHORTCUTS: Record<string, ViewerToolId> = {
  v: 'pointer',
  '1': 'pointer',
  h: 'pan',
  '2': 'pan',
  z: 'zoom',
  '3': 'zoom',
  w: 'wwwl',
  '4': 'wwwl',
  m: 'measure',
  '5': 'measure',
  a: 'polygon',
  '6': 'polygon',
  s: 'segment',
  '8': 'segment',
  r: 'rotate',
  '7': 'rotate',
};

export const applyMeasurementSelection = (actions: SelectionActions, id: string | null) => {
  actions.setSelectedMeasurementId(id);
  actions.selectMeasurement(id);
};

export const clearMeasurementSelection = (actions: SelectionActions) => {
  applyMeasurementSelection(actions, null);
};

export const startMeasurementEdit = (actions: EditActions, editState: MeasurementEditState) => {
  actions.setEditingMeasurement(editState);
  applyMeasurementSelection(actions, editState.id);
  actions.setIsDragging(true);
};

export const cancelMeasurementEdit = (
  setEditingMeasurement: (state: MeasurementEditState | null) => void
) => {
  setEditingMeasurement(null);
};

export const resolveToolShortcut = (key: string): ViewerToolId | null => {
  const normalized = key.toLowerCase();
  return TOOL_SHORTCUTS[normalized] ?? null;
};
