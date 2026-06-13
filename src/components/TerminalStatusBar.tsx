/**
 * TerminalStatusBar.tsx
 *
 * A slim status bar at the top of the terminal showing:
 *   • App name / session status
 *   • ABI + Alpine version
 *   • Rootfs size (loaded once)
 *   • Kill switch (CTRL+C shortcut)
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { getDeviceAbi, getRootfsSizeBytes, sendShellCommand } from '../NativeAlpineShell';

interface Props {
  sessionAlive: boolean;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function TerminalStatusBar({ sessionAlive }: Props) {
  const [abi, setAbi] = useState('…');
  const [size, setSize] = useState('…');

  useEffect(() => {
    getDeviceAbi().then(setAbi).catch(() => setAbi('?'));
    getRootfsSizeBytes()
      .then(b => setSize(fmtBytes(b)))
      .catch(() => setSize('?'));
  }, [sessionAlive]);

  return (
    <View style={styles.bar}>
      {/* Status dot + session label */}
      <View style={styles.left}>
        <View style={[styles.dot, sessionAlive ? styles.dotAlive : styles.dotDead]} />
        <Text style={styles.label}>
          {sessionAlive ? 'Alpine Linux' : 'Session stopped'}
        </Text>
      </View>

      {/* Device info */}
      <Text style={styles.meta}>
        {abi} · rootfs {size}
      </Text>

      {/* CTRL+C quick-kill */}
      {sessionAlive && (
        <Pressable
          onPress={() => sendShellCommand('\x03')}
          android_ripple={{ color: '#ff4444', borderless: true }}
          style={styles.ctrlC}>
          <Text style={styles.ctrlCText}>⌃C</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d0d0d',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1e1e1e',
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotAlive: {
    backgroundColor: '#39ff14',
    shadowColor: '#39ff14',
    shadowOpacity: 0.9,
    shadowRadius: 4,
    elevation: 2,
  },
  dotDead: {
    backgroundColor: '#555',
  },
  label: {
    color: '#c0c0c0',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  meta: {
    color: '#4a4a4a',
    fontSize: 10,
    fontFamily: 'monospace',
    marginRight: 8,
  },
  ctrlC: {
    backgroundColor: '#1a0a0a',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#4d1212',
  },
  ctrlCText: {
    color: '#cc4444',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
});
