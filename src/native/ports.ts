/**
 * Port interfaces for everything the core needs from the platform. The core
 * depends ONLY on these types — never on react-native modules directly — so it
 * stays unit-testable. Concrete adapters live alongside as `*.stub.ts` and, in
 * the app, as real implementations wired in `src/app/wiring.ts`.
 */
import type { NativeClockBridge } from '../core/time/clock';
import type { CameraSource } from '../features/gesture/GestureController';
import type { AnalysisTransport } from '../core/analysis/client';
import type { Persistence } from '../core/store';

export type { NativeClockBridge, CameraSource, AnalysisTransport, Persistence };

/** Foreground timer surface — Android FGS notification / iOS scheduled locals + Live Activity. */
export interface ForegroundTimer {
  /** begin showing elapsed/remaining outside the app, computed from these timestamps. */
  begin(input: { startWall: number; plannedMs: number | null; subjectLabel: string | null }): Promise<void>;
  /** update the outside-the-app surface (Android re-renders the notification; iOS reschedules). */
  update(input: { startWall: number; plannedMs: number | null; paused: boolean }): Promise<void>;
  end(): Promise<void>;
  /** platform capability disclosure for the UI to be honest with the user. */
  capabilities(): { liveTick: boolean; exactBackground: boolean; note: string };
}

export interface Haptics {
  success(): void;
  warning(): void;
  selection(): void;
}

export interface KeyValueStore {
  getString(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export interface SystemSignalsSource {
  /** Low Power Mode / thermal state / delivered camera FPS, pushed on change. */
  subscribe(cb: (s: { lowPower: boolean; thermal: 'nominal' | 'fair' | 'serious' | 'critical' }) => void): () => void;
  isLowPowerMode(): boolean;
}
