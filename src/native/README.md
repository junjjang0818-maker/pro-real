# `src/native` — platform adapters

Everything in `src/core` and `src/features/*/` logic is pure TypeScript and unit
tested on CI (Windows, no device). This folder is the **boundary to code that
can only run/verify on a real iOS or Android build**. Each file exports:

- a **port interface** consumed by the core, and
- a **stub implementation** that keeps the app running in a dev/web context and
  throws a clear "implement me" error for the parts that genuinely need native.

| Port | Backed by (prod) | Verifiable only on |
|---|---|---|
| `clockBridge` | TurboModule: `SystemClock.elapsedRealtime` (Android) / `ProcessInfo.systemUptime` + `CLOCK_MONOTONIC` (iOS), boot id | device |
| `cameraGestureSource` | `react-native-vision-camera` v4 frame processor + `react-native-mediapipe` (Hand Landmarker) → fallback `react-native-fast-tflite` + bundled `hand_landmarker.task` | device |
| `foregroundTimer` | Android: `notifee` foreground service; iOS: `expo-notifications` scheduled locals + **ActivityKit Live Activity** (`Text(timerInterval:)`) | device |
| `keyValueStore` | `react-native-mmkv` (synchronous) | device (works on web via shim) |
| `sessionDb` | `@op-engineering/op-sqlite` | device (works on node via better-sqlite3 shim for tests) |
| `haptics` | `expo-haptics` | device |
| `analysisBackend` | `fetch()` → your proxy → Claude API | anywhere (network) |

## iOS reality checks (do not paper over these)

- **No continuous background timer.** We compute elapsed from timestamps on
  foreground and use scheduled local notifications + a Live Activity for the
  lock-screen tick. `foregroundTimer.startIOS()` documents this.
- **`BGTaskScheduler`** is opportunistic — never rely on it for exact timing.
- **Live Activities need a Swift widget extension** (~100 LOC). Community RN
  wrappers vary in quality; budget for writing it.

## Android reality checks

- **Foreground service type** is mandatory on Android 14+. A pure timer has no
  perfect type; plan for `specialUse` (Play Console declaration) or reduce scope
  to "notification + reconcile on resume".
- **WorkManager** minimum interval is 15 min — too coarse for a live timer.
