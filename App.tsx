/**
 * App.tsx
 *
 * Root component for Alpine Shell.
 *
 * Responsibilities:
 *  • System bar / safe-area configuration (full black immersive)
 *  • Start the Alpine background service on mount
 *  • Check battery optimisation on first launch and prompt if needed
 *  • Compose the status bar + terminal console
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  AppStateStatus,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  isIgnoringBatteryOptimizations,
  isSessionRunning,
  startAlpineSession,
} from './src/NativeAlpineShell';
import TerminalConsole from './src/components/TerminalConsole';
import TerminalStatusBar from './src/components/TerminalStatusBar';
import BatteryOptimizationPrompt from './src/components/BatteryOptimizationPrompt';

const BATTERY_PROMPT_KEY = '@alpineshell/battery_prompted';

export default function App() {
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionAlive, setSessionAlive] = useState(false);
  const [showBatteryPrompt, setShowBatteryPrompt] = useState(false);

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  useEffect(() => {
    // 1. Start the Alpine service immediately
    startAlpineSession();
    setSessionStarted(true);

    // 2. Brief delay then confirm the process is alive
    const aliveTimer = setTimeout(async () => {
      try {
        const alive = await isSessionRunning();
        setSessionAlive(alive);
      } catch {
        setSessionAlive(false);
      }
    }, 3000);

    // 3. Check battery optimisation once
    checkBatteryOptimisation();

    // 4. Re-check session aliveness when the app comes back to foreground
    const appStateSub = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      clearTimeout(aliveTimer);
      appStateSub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── App state ──────────────────────────────────────────────────────────────

  const handleAppStateChange = useCallback(async (nextState: AppStateStatus) => {
    if (
      appStateRef.current.match(/inactive|background/) &&
      nextState === 'active'
    ) {
      // Came back to foreground — re-start if needed
      try {
        const alive = await isSessionRunning();
        if (!alive) {
          startAlpineSession();
          setSessionStarted(true);
        }
        setSessionAlive(alive);
      } catch {
        /* ignore */
      }
    }
    appStateRef.current = nextState;
  }, []);

  // ── Battery optimisation check ─────────────────────────────────────────────

  const checkBatteryOptimisation = async () => {
    if (Platform.OS !== 'android') return;
    try {
      const alreadyPrompted = await AsyncStorage.getItem(BATTERY_PROMPT_KEY);
      if (alreadyPrompted) return;

      const ignoring = await isIgnoringBatteryOptimizations();
      if (!ignoring) {
        // Small delay so the terminal has rendered first
        setTimeout(() => setShowBatteryPrompt(true), 1500);
      }
    } catch {
      /* non-fatal */
    }
  };

  const dismissBatteryPrompt = useCallback(async () => {
    setShowBatteryPrompt(false);
    await AsyncStorage.setItem(BATTERY_PROMPT_KEY, 'true');
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar
        barStyle="light-content"
        backgroundColor="#000"
        translucent={false}
      />

      <View style={styles.container}>
        {/* ── Status bar ──────────────────────────────────────────────── */}
        <TerminalStatusBar sessionAlive={sessionAlive} />

        {/* ── Terminal ────────────────────────────────────────────────── */}
        <TerminalConsole sessionStarted={sessionStarted} />
      </View>

      {/* ── Battery prompt (modal) ─────────────────────────────────────── */}
      <BatteryOptimizationPrompt
        visible={showBatteryPrompt}
        onDismiss={dismissBatteryPrompt}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#000',
  },
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
});
