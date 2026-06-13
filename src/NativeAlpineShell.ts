/**
 * NativeAlpineShell.ts
 *
 * Typed wrapper around the AlpineShellModule NativeModule.
 * Provides a clean, promise-based API and event subscription
 * for the React Native frontend.
 */

import {
  NativeModules,
  NativeEventEmitter,
  Platform,
  EmitterSubscription,
} from 'react-native';

const { AlpineShell } = NativeModules;

if (!AlpineShell) {
  console.warn(
    '[AlpineShell] NativeModule not found. ' +
      'Make sure you are running on Android and the module is linked.',
  );
}

const emitter = AlpineShell ? new NativeEventEmitter(AlpineShell) : null;

export const EVENT_SHELL_OUTPUT = 'AlpineShellOutput';

// ─── Module API ────────────────────────────────────────────────────────────

/** Start the background service and boot the Alpine shell. */
export function startAlpineSession(): void {
  AlpineShell?.startAlpineSession();
}

/** Stop the shell and the background service. */
export function stopAlpineSession(): void {
  AlpineShell?.stopAlpineSession();
}

/**
 * Send a raw string to the shell's stdin.
 * Do NOT add a newline — the caller is responsible for newlines where needed.
 */
export function sendShellCommand(command: string): void {
  AlpineShell?.sendShellCommand(command);
}

/** Returns true if the PRoot shell process is currently alive. */
export async function isSessionRunning(): Promise<boolean> {
  if (!AlpineShell) return false;
  return AlpineShell.isSessionRunning();
}

/** Returns true if battery optimisations are already disabled for this app. */
export async function isIgnoringBatteryOptimizations(): Promise<boolean> {
  if (!AlpineShell || Platform.OS !== 'android') return true;
  return AlpineShell.isIgnoringBatteryOptimizations();
}

/**
 * Opens the system dialog asking the user to exempt this app from
 * battery optimisation (the most reliable method on Android 6+).
 */
export function requestIgnoreBatteryOptimizations(): void {
  AlpineShell?.requestIgnoreBatteryOptimizations();
}

/** Fallback: open the global battery optimisation settings screen. */
export function openBatteryOptimizationSettings(): void {
  AlpineShell?.openBatteryOptimizationSettings();
}

/** Get the primary CPU ABI of the device (e.g. "arm64-v8a"). */
export async function getDeviceAbi(): Promise<string> {
  if (!AlpineShell) return 'unknown';
  return AlpineShell.getDeviceAbi();
}

/** Get the total on-disk size of the Alpine rootfs in bytes. */
export async function getRootfsSizeBytes(): Promise<number> {
  if (!AlpineShell) return 0;
  return AlpineShell.getRootfsSizeBytes();
}

// ─── Event subscription ────────────────────────────────────────────────────

/**
 * Subscribe to raw output bytes from the shell.
 * The data string may contain ANSI escape codes.
 *
 * @param callback  Function called with each output chunk.
 * @returns         A subscription object; call `.remove()` to unsubscribe.
 */
export function onShellOutputReceived(
  callback: (data: string) => void,
): EmitterSubscription | null {
  if (!emitter) return null;
  return emitter.addListener(EVENT_SHELL_OUTPUT, callback);
}
