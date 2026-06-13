/**
 * BatteryOptimizationPrompt.tsx
 *
 * Shows a one-time modal warning the user that Android battery optimisation
 * will kill the Alpine background session unless they exempt this app.
 */

import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  requestIgnoreBatteryOptimizations,
  openBatteryOptimizationSettings,
} from '../NativeAlpineShell';

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

export default function BatteryOptimizationPrompt({ visible, onDismiss }: Props) {
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* ── Header ─────────────────────────────────────────────────── */}
          <View style={styles.header}>
            <Text style={styles.icon}>⚡</Text>
            <Text style={styles.title}>Disable Battery Optimisation</Text>
          </View>

          {/* ── Body ───────────────────────────────────────────────────── */}
          <Text style={styles.body}>
            Android's battery optimiser will kill the Alpine background session
            when the screen turns off — wiping running processes and long-running
            commands.
          </Text>
          <Text style={styles.body}>
            To keep the shell alive at all times, tap{' '}
            <Text style={styles.highlight}>Allow</Text> on the next screen and
            select <Text style={styles.highlight}>"Don't optimise"</Text> for
            Alpine Shell.
          </Text>
          <Text style={styles.warning}>
            ⚠ Without this, tmux sessions, daemons, and background jobs will
            terminate whenever the display sleeps.
          </Text>

          {/* ── Actions ────────────────────────────────────────────────── */}
          <View style={styles.actions}>
            <Pressable
              style={[styles.btn, styles.btnSecondary]}
              onPress={() => {
                openBatteryOptimizationSettings();
                onDismiss();
              }}>
              <Text style={styles.btnSecondaryText}>Manual settings</Text>
            </Pressable>

            <Pressable
              style={[styles.btn, styles.btnPrimary]}
              android_ripple={{ color: '#0a1a0a' }}
              onPress={() => {
                requestIgnoreBatteryOptimizations();
                onDismiss();
              }}>
              <Text style={styles.btnPrimaryText}>Fix it now →</Text>
            </Pressable>
          </View>

          <Pressable onPress={onDismiss} style={styles.dismissRow}>
            <Text style={styles.dismissText}>Skip for now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    width: '100%',
    maxWidth: 440,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 8,
  },
  icon: {
    fontSize: 22,
  },
  title: {
    color: '#e8e8e8',
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  body: {
    color: '#999',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 10,
  },
  highlight: {
    color: '#e8e8e8',
    fontWeight: '600',
  },
  warning: {
    color: '#c4a000',
    fontSize: 12,
    lineHeight: 18,
    marginVertical: 12,
    backgroundColor: '#1a1600',
    padding: 10,
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#c4a000',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  btnPrimary: {
    backgroundColor: '#1a3320',
    borderWidth: 1,
    borderColor: '#39ff14',
  },
  btnPrimaryText: {
    color: '#39ff14',
    fontWeight: '700',
    fontSize: 14,
  },
  btnSecondary: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
  },
  btnSecondaryText: {
    color: '#888',
    fontSize: 13,
  },
  dismissRow: {
    marginTop: 14,
    alignItems: 'center',
  },
  dismissText: {
    color: '#444',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
});
