/**
 * Expo entry — MVP timer screen. This is the ONE file that needs the native
 * stack installed (`npm install` after promoting appDependencies). The logic it
 * drives (`src/core`, `src/features`) is fully unit-tested on CI without a device.
 *
 * What is intentionally still a stub here (needs a device build):
 *   - `buildCameraGestureSource()` — VisionCamera + Hand Landmarker frame processor
 *   - `buildForegroundTimer()`     — notifee FGS (Android) / Live Activity (iOS)
 *   - `buildClockBridge()`         — native monotonic clock + bootId
 * See src/native/README.md.
 */
import React, { useEffect, useMemo, useReducer, useState } from 'react';
import { SafeAreaView, ScrollView, Text, View, Pressable, StyleSheet } from 'react-native';
import { MMKV } from 'react-native-mmkv';

import { createApp } from './src/app/wiring';
import { computeElapsed } from './src/core/session/elapsed';
import { kvPersistence } from './src/native/kvPersistence';
import { foregroundTimerStub, hapticsStub, noopCameraSource, clockBridgeStub } from './src/native/stubs';

const mmkv = new MMKV();

const app = createApp(
  {
    clockBridge: clockBridgeStub, // TODO: buildClockBridge()
    persistence: kvPersistence(mmkv),
    camera: noopCameraSource, // TODO: buildCameraGestureSource()
    foregroundTimer: foregroundTimerStub, // TODO: buildForegroundTimer()
    haptics: hapticsStub, // TODO: expo-haptics adapter
  },
  { dailyGoalMs: 60 * 60_000 },
);

export default function App() {
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const [tick, setTick] = useState(0);

  useEffect(() => app.store.subscribe(forceRender), []);
  useEffect(() => {
    // re-render only; elapsed is always derived from timestamps, never accumulated
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  const active = app.store.getActive();
  const elapsedMs = useMemo(() => {
    if (!active) return 0;
    return computeElapsed(active, app.clock.now()).countedMs;
  }, [active, tick]);

  const attendance = app.store.attendance();
  const streak = app.store.streak();

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.h1}>제스처 학습 타이머</Text>

        <Text style={styles.timer}>{formatDuration(elapsedMs)}</Text>
        <Text style={styles.sub}>
          {active ? (app.store.isActivePaused() ? '일시정지' : '진행 중') : '대기'} · 오늘 스트릭 {streak.current}일
        </Text>

        <View style={styles.row}>
          {!active ? (
            <Btn label="시작" onPress={() => app.bus.emit({ purpose: 'start', source: 'button', subjectId: null })} />
          ) : (
            <>
              <Btn
                label={app.store.isActivePaused() ? '재개' : '일시정지'}
                onPress={() => app.bus.emit({ purpose: 'toggle-pause', source: 'button' })}
              />
              <Btn label="정지" onPress={() => app.bus.emit({ purpose: 'stop', source: 'button' })} />
            </>
          )}
        </View>

        <Pressable
          style={styles.gestureBtn}
          onPress={async () => {
            const r = await app.gesture.attempt(active ? 'stop' : 'start');
            if (r.outcome === 'confirmed') {
              app.bus.emit({ purpose: active ? 'stop' : 'start', source: 'gesture', confidence: r.confidence });
            }
            // r.outcome === 'fallback' -> buttons above remain the way in; nothing to do
          }}
        >
          <Text style={styles.gestureText}>손동작으로 {active ? '정지' : '시작'} (인식 안 되면 위 버튼 사용)</Text>
        </Pressable>

        <Text style={styles.h2}>이번 주 출석</Text>
        {attendance.length === 0 ? (
          <Text style={styles.sub}>아직 기록이 없어요.</Text>
        ) : (
          attendance.map((d) => (
            <Text key={d.localDate} style={styles.sub}>
              {d.localDate} · {Math.round(d.countedMs / 60_000)}분 {d.attended ? '✅' : '—'}
              {d.crossedMidnight ? ' (자정 넘김)' : ''}
            </Text>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Btn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.btn} onPress={onPress}>
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0c' },
  container: { padding: 24, gap: 12 },
  h1: { color: '#fff', fontSize: 22, fontWeight: '700' },
  h2: { color: '#fff', fontSize: 16, fontWeight: '600', marginTop: 24 },
  timer: { color: '#fff', fontSize: 56, fontVariant: ['tabular-nums'], fontWeight: '300', marginTop: 24 },
  sub: { color: '#9a9aa2', fontSize: 13 },
  row: { flexDirection: 'row', gap: 12, marginTop: 12 },
  btn: { backgroundColor: '#2b2b30', paddingVertical: 14, paddingHorizontal: 22, borderRadius: 12 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  gestureBtn: { borderColor: '#2b2b30', borderWidth: 1, padding: 14, borderRadius: 12, marginTop: 12 },
  gestureText: { color: '#c7c7cf', fontSize: 13 },
});
