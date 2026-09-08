/**
 * Clock abstraction — every time read in the app goes through a `Clock`.
 *
 * WHY: The brief requires absolute-timestamp based elapsed calculation and
 * resilience against background throttling, NTP corrections, manual clock
 * changes and timezone travel. To get that we capture, at every session
 * boundary, BOTH:
 *   - `wall`      : Date.now() style epoch ms (can jump forwards/backwards)
 *   - `monotonic` : a clock that only moves forward and is immune to NTP /
 *                   user clock edits (Android SystemClock.elapsedRealtime,
 *                   iOS CLOCK_MONOTONIC / ProcessInfo.systemUptime). Only
 *                   *deltas* are meaningful, and it resets to ~0 on reboot.
 *   - `bootId`    : stable for one device boot; when it changes we know the
 *                   monotonic clock reset and cross-checks are invalid.
 *   - `tzId` / `tzOffsetMin` : the timezone active *right now*. We store the
 *                   offset on each session so past sessions are never
 *                   re-attributed when the user travels.
 *
 * Production wires a `SystemClock` backed by a small native bridge.
 * Tests use `FakeClock` for full deterministic control of every axis.
 */

export interface ClockStamp {
  /** epoch ms, UTC. Affected by NTP + manual clock changes. */
  wall: number;
  /** ms from an arbitrary origin; forward-only; NTP-immune; resets on reboot. */
  monotonic: number;
  /** stable per device boot. monotonic is only comparable within one bootId. */
  bootId: string;
  /** IANA timezone id, e.g. "Asia/Seoul". */
  tzId: string;
  /** minutes to ADD to UTC to get local wall time. Seoul = +540. */
  tzOffsetMin: number;
}

export interface Clock {
  now(): ClockStamp;
}

/**
 * Native side must implement this (React Native TurboModule / Expo module).
 * Any missing method falls back to a JS approximation so the app still runs.
 */
export interface NativeClockBridge {
  wallMs(): number;
  monotonicMs(): number;
  bootId(): string;
  tzId(): string;
  tzOffsetMin(): number;
}

export class SystemClock implements Clock {
  constructor(private readonly bridge?: Partial<NativeClockBridge>) {}

  now(): ClockStamp {
    const wall = this.bridge?.wallMs?.() ?? Date.now();
    const monotonic =
      this.bridge?.monotonicMs?.() ??
      // performance.now() is monotonic in Node and Hermes; good enough as a
      // fallback but WILL be wrong across an app relaunch — the native bridge
      // is required for real crash-recovery correctness.
      Math.round(performanceNow());
    const bootId = this.bridge?.bootId?.() ?? 'no-native-bridge';
    const tzId =
      this.bridge?.tzId?.() ??
      safeResolvedTimeZone();
    const tzOffsetMin =
      this.bridge?.tzOffsetMin?.() ??
      -new Date(wall).getTimezoneOffset();
    return { wall, monotonic, bootId, tzId, tzOffsetMin };
  }
}

function performanceNow(): number {
  const p = (globalThis as { performance?: { now(): number } }).performance;
  return p ? p.now() : Date.now();
}

function safeResolvedTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export interface FakeClockInit {
  wall: number;
  monotonic?: number;
  bootId?: string;
  tzId?: string;
  tzOffsetMin?: number;
}

/**
 * Deterministic clock for tests. Each axis can be moved independently so we can
 * reproduce: normal time passing, background gaps, NTP jumps, backwards clock
 * edits, reboots (monotonic reset) and timezone travel.
 */
export class FakeClock implements Clock {
  private _wall: number;
  private _monotonic: number;
  private _bootId: string;
  private _tzId: string;
  private _tzOffsetMin: number;

  constructor(init: FakeClockInit) {
    this._wall = init.wall;
    this._monotonic = init.monotonic ?? 0;
    this._bootId = init.bootId ?? 'boot-1';
    this._tzId = init.tzId ?? 'Asia/Seoul';
    this._tzOffsetMin = init.tzOffsetMin ?? 540;
  }

  now(): ClockStamp {
    return {
      wall: this._wall,
      monotonic: this._monotonic,
      bootId: this._bootId,
      tzId: this._tzId,
      tzOffsetMin: this._tzOffsetMin,
    };
  }

  /** Normal time passing: both clocks advance together. */
  advance(ms: number): this {
    this._wall += ms;
    this._monotonic += ms;
    return this;
  }

  /** NTP correction / user sets clock forward: wall jumps, real time did not. */
  advanceWallOnly(ms: number): this {
    this._wall += ms;
    return this;
  }

  /** Real time passed while wall was frozen/behind (rare; for completeness). */
  advanceMonotonicOnly(ms: number): this {
    this._monotonic += ms;
    return this;
  }

  /** User sets the clock backwards. */
  setWall(wall: number): this {
    this._wall = wall;
    return this;
  }

  /** Device reboot: monotonic resets, bootId changes. */
  reboot(newBootId = `boot-${Math.random().toString(36).slice(2, 8)}`, monotonic = 0): this {
    this._bootId = newBootId;
    this._monotonic = monotonic;
    return this;
  }

  /** Timezone travel. */
  setTimezone(tzId: string, tzOffsetMin: number): this {
    this._tzId = tzId;
    this._tzOffsetMin = tzOffsetMin;
    return this;
  }
}
