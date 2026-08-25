import { toolForShortcut, type ViewerToolId } from '../../domain/tools';
import type { MeasurementEditState } from './interaction';

type SelectionActions = {
  setSelectedMeasurementId: (id: string | null) => void;
  selectMeasurement: (id: string | null) => void;
};

type EditActions = SelectionActions & {
  setEditingMeasurement: (state: MeasurementEditState | null) => void;
  setIsDragging: (isDragging: boolean) => void;
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

/**
 * Tool shortcuts are declared once, on the tools themselves.
 * Re-exported here so existing call sites keep working.
 */
export const resolveToolShortcut = (key: string): ViewerToolId | null =>
  toolForShortcut(key);
