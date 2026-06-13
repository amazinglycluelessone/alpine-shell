/**
 * TerminalConsole.tsx
 *
 * The heart of the UI: a high-performance, dark-themed terminal emulator
 * that streams output from the Alpine/PRoot session in real-time.
 *
 * Design decisions:
 *  • Uses a FlatList with inverted=false and auto-scroll to bottom.
 *  • ANSI escape codes are rendered with a minimal inline parser that
 *    converts common SGR codes (bold, colour) to React Native Text styles.
 *  • Input bar sits above the soft keyboard with a modifier key toolbar
 *    (ESC, CTRL, TAB, ALT, ↑, ↓).
 *  • All font metrics are driven by a single FONT_SIZE constant so the
 *    user can later have a font-size slider.
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from 'react';
import {
  Dimensions,
  EmitterSubscription,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  onShellOutputReceived,
  sendShellCommand,
} from '../NativeAlpineShell';
import { useHistoryNavigation } from '../useCommandHistory';

// ─── Constants ───────────────────────────────────────────────────────────────

const FONT_SIZE = 13;
const LINE_HEIGHT = FONT_SIZE * 1.4;
const FONT_FAMILY = Platform.select({ android: 'monospace', ios: 'Courier' });
const MAX_LINES = 4000; // rolling buffer

// Colour palette (xterm-256 approximations for common SGR codes)
const ANSI_COLORS: Record<number, string> = {
  30: '#000000', 31: '#cc0000', 32: '#4e9a06', 33: '#c4a000',
  34: '#3465a4', 35: '#75507b', 36: '#06989a', 37: '#d3d7cf',
  90: '#555753', 91: '#ef2929', 92: '#8ae234', 93: '#fce94f',
  94: '#729fcf', 95: '#ad7fa8', 96: '#34e2e2', 97: '#eeeeec',
  // Background (40–47) handled separately
};

// ─── ANSI Parser ─────────────────────────────────────────────────────────────

interface AnsiSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  bgColor?: string;
  dim?: boolean;
}

const SGR_REGEX = /\x1B\[([0-9;]*)m/g;
const STRIP_OTHER_ESC = /\x1B\[[^m]*[A-LNZ^_`a-z{}~]/g;
const STRIP_OSC = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g;

function parseAnsiLine(raw: string): AnsiSpan[] {
  // Strip non-colour/style escape sequences
  const cleaned = raw
    .replace(STRIP_OSC, '')
    .replace(STRIP_OTHER_ESC, '');

  const spans: AnsiSpan[] = [];
  let lastIndex = 0;
  let bold = false;
  let dim = false;
  let italic = false;
  let underline = false;
  let color: string | undefined;
  let bgColor: string | undefined;

  SGR_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = SGR_REGEX.exec(cleaned)) !== null) {
    // Text before this escape
    if (match.index > lastIndex) {
      spans.push({
        text: cleaned.slice(lastIndex, match.index),
        bold, dim, italic, underline, color, bgColor,
      });
    }
    lastIndex = match.index + match[0].length;

    const codes = match[1].split(';').map(Number);
    for (const code of codes) {
      if (code === 0) {
        bold = false; dim = false; italic = false; underline = false;
        color = undefined; bgColor = undefined;
      } else if (code === 1) { bold = true; }
      else if (code === 2) { dim = true; }
      else if (code === 3) { italic = true; }
      else if (code === 4) { underline = true; }
      else if (code === 22) { bold = false; dim = false; }
      else if (code >= 30 && code <= 37) { color = ANSI_COLORS[code]; }
      else if (code === 39) { color = undefined; }
      else if (code >= 40 && code <= 47) { bgColor = ANSI_COLORS[code - 10]; }
      else if (code === 49) { bgColor = undefined; }
      else if (code >= 90 && code <= 97) { color = ANSI_COLORS[code]; }
    }
  }

  // Remaining text after last escape
  if (lastIndex < cleaned.length) {
    spans.push({
      text: cleaned.slice(lastIndex),
      bold, dim, italic, underline, color, bgColor,
    });
  }

  // Empty line placeholder
  if (spans.length === 0) {
    spans.push({ text: '' });
  }

  return spans;
}

function AnsiText({ spans }: { spans: AnsiSpan[] }) {
  return (
    <Text style={styles.lineText} selectable>
      {spans.map((span, i) => (
        <Text
          key={i}
          style={[
            span.bold && styles.bold,
            span.dim && styles.dim,
            span.italic && styles.italic,
            span.underline && styles.underline,
            span.color ? { color: span.color } : null,
            span.bgColor ? { backgroundColor: span.bgColor } : null,
          ]}>
          {span.text}
        </Text>
      ))}
    </Text>
  );
}

// ─── Terminal Line ────────────────────────────────────────────────────────────

interface TerminalLine {
  id: string;
  raw: string;
  spans: AnsiSpan[];
}

let _lineId = 0;
function makeId() {
  return `l${++_lineId}`;
}

// ─── Modifier Key Button ──────────────────────────────────────────────────────

interface ModKeyProps {
  label: string;
  onPress: () => void;
  active?: boolean;
}

function ModKey({ label, onPress, active }: ModKeyProps) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: '#39ff14', borderless: false }}
      style={({ pressed }) => [
        styles.modKey,
        active && styles.modKeyActive,
        pressed && styles.modKeyPressed,
      ]}>
      <Text style={styles.modKeyText}>{label}</Text>
    </Pressable>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export interface TerminalConsoleProps {
  sessionStarted: boolean;
}

export default function TerminalConsole({ sessionStarted }: TerminalConsoleProps) {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [inputText, setInputText] = useState('');
  const [ctrlMode, setCtrlMode] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  const flatListRef = useRef<FlatList<TerminalLine>>(null);
  const inputRef = useRef<TextInput>(null);
  const subscriptionRef = useRef<EmitterSubscription | null>(null);
  const pendingChunkRef = useRef('');  // incomplete-line buffer

  const { navigateUp, navigateDown, reset: resetHistoryCursor } =
    useHistoryNavigation(history);

  // ── Subscribe to shell output ─────────────────────────────────────────────

  useEffect(() => {
    if (!sessionStarted) return;

    subscriptionRef.current = onShellOutputReceived(chunk => {
      // Accumulate chunk into pending buffer
      pendingChunkRef.current += chunk;

      // Split on \r\n or \n, but keep incomplete last segment
      const parts = pendingChunkRef.current.split(/\r?\n/);
      pendingChunkRef.current = parts.pop() ?? ''; // last (possibly incomplete) part

      const newLines: TerminalLine[] = parts.map(raw => ({
        id: makeId(),
        raw,
        spans: parseAnsiLine(raw),
      }));

      // Also add incomplete chunk as a live "typing" line if non-empty
      const incompleteRaw = pendingChunkRef.current;
      if (incompleteRaw.length > 0) {
        newLines.push({
          id: makeId() + '_partial',
          raw: incompleteRaw,
          spans: parseAnsiLine(incompleteRaw),
        });
        pendingChunkRef.current = ''; // consumed into lines temporarily
      }

      if (newLines.length > 0) {
        setLines(prev => {
          const combined = [...prev, ...newLines];
          // Rolling buffer: discard oldest lines if over MAX_LINES
          return combined.length > MAX_LINES
            ? combined.slice(combined.length - MAX_LINES)
            : combined;
        });
      }
    });

    return () => {
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    };
  }, [sessionStarted]);

  // Auto-scroll to bottom whenever lines change
  useEffect(() => {
    if (lines.length > 0) {
      // Small delay lets RN measure new items before scrolling
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: false });
      }, 16);
    }
  }, [lines]);

  // ── Input submission ──────────────────────────────────────────────────────

  const submitInput = useCallback(() => {
    const cmd = inputText;
    setInputText('');
    resetHistoryCursor();
    if (cmd.trim()) {
      setHistory(h => [...h, cmd]);
    }
    sendShellCommand(cmd + '\n');
  }, [inputText, resetHistoryCursor]);

  // ── Modifier key handlers ─────────────────────────────────────────────────

  const handleCtrl = useCallback(() => {
    setCtrlMode(m => !m);
  }, []);

  const sendCtrlKey = useCallback(
    (char: string) => {
      // CTRL+C = 0x03, CTRL+D = 0x04, etc.
      const code = char.toUpperCase().charCodeAt(0) - 64;
      if (code >= 1 && code <= 26) {
        sendShellCommand(String.fromCharCode(code));
      }
      setCtrlMode(false);
    },
    [],
  );

  const handleModKey = useCallback(
    (key: string) => {
      switch (key) {
        case 'ESC':
          sendShellCommand('\x1B');
          break;
        case 'TAB':
          sendShellCommand('\t');
          break;
        case 'CTRL':
          handleCtrl();
          break;
        case '↑': {
          const prev = navigateUp(inputText);
          setInputText(prev);
          break;
        }
        case '↓': {
          const next = navigateDown(inputText);
          setInputText(next);
          break;
        }
        case 'C':
        case 'D':
        case 'Z':
          if (ctrlMode) {
            sendCtrlKey(key);
          }
          break;
        default:
          break;
      }
    },
    [ctrlMode, handleCtrl, inputText, navigateDown, navigateUp, sendCtrlKey],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item }: { item: TerminalLine }) => (
      <View style={styles.lineRow}>
        <AnsiText spans={item.spans} />
      </View>
    ),
    [],
  );

  const keyExtractor = useCallback((item: TerminalLine) => item.id, []);

  const modKeys = ctrlMode
    ? ['C', 'D', 'Z', '↑', '↓', 'ESC', 'TAB']
    : ['CTRL', 'ESC', 'TAB', '↑', '↓'];

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}>

      {/* ── Terminal output area ────────────────────────────────────────── */}
      <Pressable style={styles.outputArea} onPress={() => inputRef.current?.focus()}>
        <FlatList
          ref={flatListRef}
          data={lines}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          style={styles.flatList}
          contentContainerStyle={styles.flatListContent}
          removeClippedSubviews
          maxToRenderPerBatch={30}
          windowSize={10}
          initialNumToRender={60}
          updateCellsBatchingPeriod={50}
          getItemLayout={(_, index) => ({
            length: LINE_HEIGHT,
            offset: LINE_HEIGHT * index,
            index,
          })}
        />
      </Pressable>

      {/* ── Modifier key toolbar ────────────────────────────────────────── */}
      <ScrollView
        horizontal
        style={styles.modBar}
        contentContainerStyle={styles.modBarContent}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always">
        {modKeys.map(k => (
          <ModKey
            key={k}
            label={k}
            onPress={() => handleModKey(k)}
            active={ctrlMode && k === 'CTRL'}
          />
        ))}
      </ScrollView>

      {/* ── Input bar ───────────────────────────────────────────────────── */}
      <View style={styles.inputBar}>
        <Text style={styles.promptSymbol}>$</Text>
        <TextInput
          ref={inputRef}
          style={styles.textInput}
          value={inputText}
          onChangeText={text => {
            setInputText(text);
            resetHistoryCursor();
          }}
          onSubmitEditing={submitInput}
          returnKeyType="send"
          blurOnSubmit={false}
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          keyboardType="visible-password" // disables autocomplete on Android
          placeholderTextColor="#444"
          placeholder="enter command…"
          multiline={false}
          selectionColor="#39ff14"
          cursorColor="#39ff14"
          underlineColorAndroid="transparent"
        />
        <Pressable
          style={styles.sendBtn}
          android_ripple={{ color: '#39ff14' }}
          onPress={submitInput}>
          <Text style={styles.sendBtnText}>↵</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  outputArea: {
    flex: 1,
  },
  flatList: {
    flex: 1,
    paddingHorizontal: 6,
  },
  flatListContent: {
    paddingBottom: 4,
  },
  lineRow: {
    minHeight: LINE_HEIGHT,
    justifyContent: 'flex-start',
  },
  lineText: {
    fontFamily: FONT_FAMILY,
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    color: '#d0d0d0',
  },
  bold: {
    fontWeight: '700',
  },
  dim: {
    opacity: 0.6,
  },
  italic: {
    fontStyle: 'italic',
  },
  underline: {
    textDecorationLine: 'underline',
  },
  // ── Modifier bar ──────────────────────────────────────────────────────────
  modBar: {
    backgroundColor: '#111',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#222',
    maxHeight: 38,
  },
  modBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    gap: 4,
  },
  modKey: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#1a1a1a',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#2e2e2e',
    minWidth: 40,
    alignItems: 'center',
  },
  modKeyActive: {
    backgroundColor: '#1f3320',
    borderColor: '#39ff14',
  },
  modKeyPressed: {
    backgroundColor: '#39ff1430',
  },
  modKeyText: {
    fontFamily: FONT_FAMILY,
    fontSize: 11,
    color: '#b0b0b0',
    fontWeight: '600',
  },
  // ── Input bar ─────────────────────────────────────────────────────────────
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#222',
    paddingHorizontal: 8,
    paddingVertical: 4,
    minHeight: 46,
  },
  promptSymbol: {
    fontFamily: FONT_FAMILY,
    fontSize: FONT_SIZE,
    color: '#39ff14',
    marginRight: 6,
    fontWeight: '700',
  },
  textInput: {
    flex: 1,
    fontFamily: FONT_FAMILY,
    fontSize: FONT_SIZE,
    color: '#e8e8e8',
    backgroundColor: '#161616',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minHeight: 36,
  },
  sendBtn: {
    marginLeft: 8,
    backgroundColor: '#1a2e1a',
    borderRadius: 6,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#39ff14',
  },
  sendBtnText: {
    color: '#39ff14',
    fontSize: 18,
    fontWeight: '700',
  },
});
