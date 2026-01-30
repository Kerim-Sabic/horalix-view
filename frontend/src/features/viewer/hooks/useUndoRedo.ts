/**
 * Generic Undo/Redo Hook
 *
 * Provides a reusable undo/redo stack implementation that can be used
 * for any state management scenario requiring history tracking.
 */

import { useCallback, useRef, useState } from 'react';

// ============================================================================
// Types
// ============================================================================

interface UndoRedoOptions<T> {
  /** Maximum number of states to keep in history */
  maxHistory?: number;
  /** Callback when undo is performed */
  onUndo?: (state: T) => void;
  /** Callback when redo is performed */
  onRedo?: (state: T) => void;
  /** Custom equality check for deduplication */
  isEqual?: (a: T, b: T) => boolean;
}

interface UndoRedoReturn<T> {
  /** Push a new state onto the history stack */
  pushState: (state: T) => void;
  /** Undo to previous state */
  undo: () => T | undefined;
  /** Redo to next state */
  redo: () => T | undefined;
  /** Check if undo is available */
  canUndo: boolean;
  /** Check if redo is available */
  canRedo: boolean;
  /** Clear all history */
  clear: () => void;
  /** Get current state */
  getCurrentState: () => T;
  /** Get undo stack length */
  undoCount: number;
  /** Get redo stack length */
  redoCount: number;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Generic undo/redo hook for managing state history
 *
 * @example
 * ```tsx
 * const { pushState, undo, redo, canUndo, canRedo } = useUndoRedo(initialState);
 *
 * // When user makes a change
 * pushState(newState);
 *
 * // Undo button
 * <button onClick={undo} disabled={!canUndo}>Undo</button>
 * ```
 */
export function useUndoRedo<T>(
  initialState: T,
  options: UndoRedoOptions<T> = {}
): UndoRedoReturn<T> {
  const {
    maxHistory = 50,
    onUndo,
    onRedo,
    isEqual = (a, b) => a === b,
  } = options;

  // Use refs to avoid unnecessary re-renders
  const undoStackRef = useRef<T[]>([]);
  const redoStackRef = useRef<T[]>([]);
  const currentStateRef = useRef<T>(initialState);

  // State for triggering re-renders when stack sizes change
  const [, forceUpdate] = useState({});

  const pushState = useCallback(
    (newState: T) => {
      // Skip if state hasn't changed
      if (isEqual(currentStateRef.current, newState)) {
        return;
      }

      // Push current state to undo stack
      undoStackRef.current.push(currentStateRef.current);

      // Limit stack size
      if (undoStackRef.current.length > maxHistory) {
        undoStackRef.current.shift();
      }

      // Clear redo stack on new action
      redoStackRef.current = [];

      // Update current state
      currentStateRef.current = newState;

      // Trigger re-render
      forceUpdate({});
    },
    [maxHistory, isEqual]
  );

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) {
      return undefined;
    }

    // Push current to redo
    redoStackRef.current.push(currentStateRef.current);

    // Pop from undo
    const previousState = undoStackRef.current.pop()!;
    currentStateRef.current = previousState;

    // Callback
    onUndo?.(previousState);

    // Trigger re-render
    forceUpdate({});

    return previousState;
  }, [onUndo]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) {
      return undefined;
    }

    // Push current to undo
    undoStackRef.current.push(currentStateRef.current);

    // Pop from redo
    const nextState = redoStackRef.current.pop()!;
    currentStateRef.current = nextState;

    // Callback
    onRedo?.(nextState);

    // Trigger re-render
    forceUpdate({});

    return nextState;
  }, [onRedo]);

  const clear = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    forceUpdate({});
  }, []);

  const getCurrentState = useCallback(() => currentStateRef.current, []);

  return {
    pushState,
    undo,
    redo,
    canUndo: undoStackRef.current.length > 0,
    canRedo: redoStackRef.current.length > 0,
    clear,
    getCurrentState,
    undoCount: undoStackRef.current.length,
    redoCount: redoStackRef.current.length,
  };
}

// ============================================================================
// Action-Based Undo/Redo
// ============================================================================

/**
 * Action type for command pattern undo/redo
 */
interface UndoableAction<T> {
  /** Execute the action (do/redo) */
  execute: () => T;
  /** Reverse the action (undo) */
  undo: () => T;
  /** Optional description for debugging */
  description?: string;
}

interface ActionUndoRedoOptions {
  maxHistory?: number;
  onExecute?: () => void;
  onUndo?: () => void;
}

interface ActionUndoRedoReturn<T> {
  /** Execute an action and add to history */
  execute: (action: UndoableAction<T>) => T;
  /** Undo last action */
  undo: () => T | undefined;
  /** Redo last undone action */
  redo: () => T | undefined;
  /** Check if undo available */
  canUndo: boolean;
  /** Check if redo available */
  canRedo: boolean;
  /** Clear history */
  clear: () => void;
}

/**
 * Action-based undo/redo using command pattern
 *
 * @example
 * ```tsx
 * const { execute, undo, redo, canUndo, canRedo } = useActionUndoRedo();
 *
 * // Execute an action
 * execute({
 *   execute: () => addItem(item),
 *   undo: () => removeItem(item.id),
 *   description: 'Add item',
 * });
 * ```
 */
export function useActionUndoRedo<T>(
  options: ActionUndoRedoOptions = {}
): ActionUndoRedoReturn<T> {
  const { maxHistory = 50, onExecute, onUndo } = options;

  const undoStackRef = useRef<UndoableAction<T>[]>([]);
  const redoStackRef = useRef<UndoableAction<T>[]>([]);
  const [, forceUpdate] = useState({});

  const execute = useCallback(
    (action: UndoableAction<T>) => {
      // Execute the action
      const result = action.execute();

      // Push to undo stack
      undoStackRef.current.push(action);

      // Limit stack size
      if (undoStackRef.current.length > maxHistory) {
        undoStackRef.current.shift();
      }

      // Clear redo stack
      redoStackRef.current = [];

      onExecute?.();
      forceUpdate({});

      return result;
    },
    [maxHistory, onExecute]
  );

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) {
      return undefined;
    }

    const action = undoStackRef.current.pop()!;
    const result = action.undo();

    redoStackRef.current.push(action);

    onUndo?.();
    forceUpdate({});

    return result;
  }, [onUndo]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) {
      return undefined;
    }

    const action = redoStackRef.current.pop()!;
    const result = action.execute();

    undoStackRef.current.push(action);

    onExecute?.();
    forceUpdate({});

    return result;
  }, [onExecute]);

  const clear = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    forceUpdate({});
  }, []);

  return {
    execute,
    undo,
    redo,
    canUndo: undoStackRef.current.length > 0,
    canRedo: redoStackRef.current.length > 0,
    clear,
  };
}

export type { UndoRedoOptions, UndoRedoReturn, UndoableAction };
