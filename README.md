# Alpine Shell

A production-ready Android app that runs a persistent **Alpine Linux** environment on your device — **no root required** — via PRoot user-mode emulation.

```
╔══════════════════════════════════════╗
║  Alpine Shell  ●                     ║
║  arm64-v8a · rootfs 47.2 MB    ⌃C   ║
╠══════════════════════════════════════╣
║                                      ║
║  Alpine Linux 3.19.1                 ║
║  ~ # apk update                      ║
║  fetch https://dl-cdn…               ║
║  OK: 1 MB  24 packages               ║
║  ~ # apk add python3 git             ║
║  Installing… ██████████ done         ║
║  ~ # _                               ║
║                                      ║
╠══════════════════════════════════════╣
║  CTRL  ESC  TAB  ↑  ↓               ║
╠══════════════════════════════════════╣
║  $  python3 --version           ↵   ║
╚══════════════════════════════════════╝
```

## Features

| Feature | Detail |
|---|---|
| **No root** | PRoot user-mode, runs inside app's private storage |
| **Persistent** | Alpine rootfs survives reboots; `apk` packages stay installed |
| **Boot-start** | Foreground service auto-starts at boot via `BootReceiver` |
| **WakeLock** | CPU held awake when screen is off |
| **ANSI terminal** | Full 256-colour + bold/italic/underline rendering |
| **Command history** | ↑/↓ navigation, up to 200 entries |
| **Modifier keys** | ESC, CTRL (C/D/Z), TAB inline toolbar |
| **Minimum SDK** | Android 8.0 (API 26) |

---

## Quick Start

### Option A — Build locally

```bash
# 1. Clone
git clone https://github.com/YOUR_USER/alpine-shell
cd alpine-shell

# 2. Install Node dependencies
npm install

# 3. Fetch PRoot binary + Alpine rootfs and place in assets
chmod +x scripts/fetch_proot.sh
./scripts/fetch_proot.sh

# 4. Build & install debug APK on connected device
npx react-native run-android
```

### Option B — GitHub Actions (CI/CD)

```bash
# 1. Push to GitHub — the workflow builds the APK automatically
chmod +x push_to_github.sh
./push_to_github.sh

# 2. Visit: https://github.com/YOUR_USER/alpine-shell/actions
# 3. Download the APK artifact from the completed workflow run
```

### Option C — Signed release APK

1. Generate a keystore:
   ```bash
   keytool -genkeypair -v -keystore release.jks -alias my-key \
     -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Add GitHub repository secrets:
   ```
   KEYSTORE_FILE_PATH   → path to .jks in the runner (or use a base64-encoded secret)
   KEYSTORE_PASSWORD
   KEY_ALIAS
   KEY_PASSWORD
   ```

3. Create a version tag to trigger a release build:
   ```bash
   git tag v1.0.0 && git push origin v1.0.0
   ```

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  React Native (TypeScript)                      │
│   App.tsx                                       │
│   TerminalConsole.tsx  ──── ANSI parser         │
│   TerminalStatusBar.tsx                         │
│   BatteryOptimizationPrompt.tsx                 │
└──────────────┬──────────────────────────────────┘
               │  NativeModule bridge
               ▼
┌─────────────────────────────────────────────────┐
│  AlpineShellModule.kt    (NativeModule)         │
│   startAlpineSession()                          │
│   sendShellCommand(cmd)                         │
│   RCTDeviceEventEmitter → "AlpineShellOutput"   │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  AlpineSessionManager.kt (singleton)            │
│   • First-launch rootfs bootstrap               │
│   • PRoot binary extraction                     │
│   • ProcessBuilder → proot -r … /bin/sh         │
│   • stdout/stderr streaming threads             │
└──────────────┬──────────────────────────────────┘
               │  started by
               ▼
┌─────────────────────────────────────────────────┐
│  AlpineBackgroundService.kt (ForegroundService) │
│   • startForeground() + persistent notification │
│   • PARTIAL_WAKE_LOCK (CPU stays on)            │
│   • START_STICKY                                │
│   • onTaskRemoved → restart                     │
└──────────────┬──────────────────────────────────┘
               │  started at boot by
               ▼
┌─────────────────────────────────────────────────┐
│  BootReceiver.kt (BroadcastReceiver)            │
│   • BOOT_COMPLETED                              │
│   • LOCKED_BOOT_COMPLETED                      │
└─────────────────────────────────────────────────┘
```

## Project Structure

```
AlpineShell/
├── App.tsx                          # Root component
├── index.js                         # RN entry point
├── app.json
├── package.json
├── tsconfig.json
├── scripts/
│   └── fetch_proot.sh               # Fetch proot + Alpine rootfs locally
├── push_to_github.sh                # One-shot git init + push
├── .github/
│   └── workflows/
│       └── build-apk.yml            # CI: fetch assets + build APK
├── src/
│   ├── NativeAlpineShell.ts         # Typed bridge to NativeModule
│   ├── useCommandHistory.ts         # ↑/↓ history hook
│   └── components/
│       ├── TerminalConsole.tsx      # Main terminal view
│       ├── TerminalStatusBar.tsx    # Status bar
│       └── BatteryOptimizationPrompt.tsx
└── android/
    ├── build.gradle
    ├── settings.gradle
    ├── gradle.properties
    └── app/
        ├── build.gradle
        ├── proguard-rules.pro
        └── src/main/
            ├── AndroidManifest.xml
            ├── res/
            │   ├── drawable/ic_terminal.xml
            │   └── values/{strings,styles}.xml
            └── java/com/alpineshell/app/
                ├── MainActivity.kt
                ├── MainApplication.kt
                ├── receivers/
                │   └── BootReceiver.kt
                ├── services/
                │   └── AlpineBackgroundService.kt
                └── modules/
                    ├── AlpineSessionManager.kt
                    ├── AlpineShellModule.kt
                    └── AlpineShellPackage.kt
```

## Battery Optimisation

Android's battery optimiser aggressively kills background processes. On first
launch the app prompts you to exempt it:

**Settings → Battery → Battery Optimisation → All apps → Alpine Shell → Don't optimise**

Or use the in-app prompt which opens the system dialog directly.

## Known Limitations

- **ARM64 and x86_64 only** — no 32-bit ARM support (all modern Android devices are 64-bit).
- **No PTY** — stdin/stdout is piped, not a real pseudo-terminal. `nano` / `vim` TUI apps may behave oddly without a proper PTY implementation.
- **PRoot performance** — syscall interception adds ~5–15% overhead. Fine for package management and scripting; not ideal for heavy computation.
- **Android 14+ background restrictions** — the WakeLock + ForegroundService combination keeps the session alive on all tested devices, but some OEM ROMs (Xiaomi MIUI, Huawei EMUI) have aggressive proprietary kill mechanisms. Follow device-specific guidance in the battery prompt.

## License

MIT © 2024
