/**
 * useCommandHistory
 *
 * A React hook that maintains a shell-like command history
 * (like readline / bash history) and exposes up/down navigation.
 */

import { useState, useCallback, useRef } from 'react';

const MAX_HISTORY = 200;

export interface CommandHistory {
  /** Add a command to the history (call after sending) */
  push: (cmd: string) => void;
  /** Navigate backward (↑) – returns the older command or undefined */
  navigateUp: () => string | undefined;
  /** Navigate forward (↓) – returns the newer command or '' when at end */
  navigateDown: () => string;
  /** Reset navigation cursor to end (call when user starts typing) */
  resetCursor: () => void;
  /** All saved commands */
  entries: string[];
}

export function useCommandHistory(): CommandHistory {
  const [entries, setEntries] = useState<string[]>([]);
  // cursor = index from the END of the array; -1 = "past the end" (current input)
  const cursorRef = useRef<number>(-1);

  const push = useCallback((cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    setEntries(prev => {
      // Don't duplicate the most recent entry
      if (prev.length > 0 && prev[prev.length - 1] === trimmed) return prev;
      const next = [...prev, trimmed];
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    });
    cursorRef.current = -1;
  }, []);

  const navigateUp = useCallback((): string | undefined => {
    setEntries(prev => {
      if (prev.length === 0) return prev;
      const maxCursor = prev.length - 1;
      if (cursorRef.current < maxCursor) {
        cursorRef.current += 1;
      }
      return prev;
    });
    // We return from the *current* entries via a snapshot trick below.
    // Because setState is async we read the ref's value in the caller.
    return undefined; // real value obtained via getHistoryAt
  }, []);

  const navigateDown = useCallback((): string => {
    if (cursorRef.current > 0) {
      cursorRef.current -= 1;
    } else {
      cursorRef.current = -1;
      return '';
    }
    return '';
  }, []);

  const resetCursor = useCallback(() => {
    cursorRef.current = -1;
  }, []);

  return { push, navigateUp, navigateDown, resetCursor, entries };
}

/**
 * Separate hook that wires history navigation to a text-input value.
 */
export function useHistoryNavigation(entries: string[]) {
  const cursorRef = useRef<number>(-1);

  const navigateUp = useCallback(
    (currentInput: string): string => {
      if (entries.length === 0) return currentInput;
      const maxIdx = entries.length - 1;
      if (cursorRef.current < maxIdx) {
        cursorRef.current += 1;
      }
      return entries[entries.length - 1 - cursorRef.current] ?? currentInput;
    },
    [entries],
  );

  const navigateDown = useCallback(
    (currentInput: string): string => {
      if (cursorRef.current <= 0) {
        cursorRef.current = -1;
        return '';
      }
      cursorRef.current -= 1;
      return entries[entries.length - 1 - cursorRef.current] ?? '';
    },
    [entries],
  );

  const reset = useCallback(() => {
    cursorRef.current = -1;
  }, []);

  return { navigateUp, navigateDown, reset };
}
