import { describe, it, expect } from 'vitest';
import { GestureController } from './GestureController';
import { DEFAULT_GESTURE_CONFIG } from './gestureConfig';
import { manualScheduler, fakeCamera } from './controllerTestKit';
import { fingersUp, synthHand } from './testFixtures';
import type { HandObservation } from './fingerCounting';

const C = DEFAULT_GESTURE_CONFIG;

function setup(cameraOpts?: Parameters<typeof fakeCamera>[0]) {
  const sched = manualScheduler();
  const cam = fakeCamera(cameraOpts);
  const states: string[] = [];
  const controller = new GestureController({
    camera: cam.source,
    now: sched.now,
    schedule: sched.schedule,
    onStateChange: (s) => states.push(s),
  });
  return { sched, cam, controller, states };
}

type Sched = ReturnType<typeof manualScheduler>;
type Cam = ReturnType<typeof fakeCamera>;

/** Emit frames at absolute times (ms from attempt start). */
function feed(sched: Sched, cam: Cam, obs: HandObservation | null, times: number[]): void {
  for (const t of times) {
    sched.advance(t - sched.now());
    cam.emitFrame(obs);
  }
}

/** 8 stable frames spanning 700ms — enough for the default confirm gate. */
const STABLE = [0, 100, 200, 300, 400, 500, 600, 700];

describe('GestureController — happy path', () => {
  it('confirms an open-palm START after enough stable frames + hold time', async () => {
    const { sched, cam, controller, states } = setup();
    const p = controller.attempt('start');
    feed(sched, cam, fingersUp(5), STABLE);
    const res = await p;
    expect(res.outcome).toBe('confirmed');
    expect(cam.stopCount).toBe(1);
    expect(states).toContain('arming');
    expect(states).toContain('detecting');
    expect(states).toContain('cooldown');
  });

  it('confirms a finger COUNT and returns the number', async () => {
    const { sched, cam, controller } = setup();
    const p = controller.attempt('count');
    feed(sched, cam, fingersUp(3), STABLE);
    expect(await p).toMatchObject({ outcome: 'confirmed', value: 3 });
  });
});

describe('GestureController — 오인식 방지', () => {
  it('does NOT confirm if the gesture is not held long enough', async () => {
    const { sched, cam, controller } = setup();
    const p = controller.attempt('start');
    feed(sched, cam, fingersUp(5), [0, 100, 200]); // 3 frames only
    sched.advance(C.maxBurstMs);
    expect(await p).toEqual({ outcome: 'fallback', fallbackReason: 'no-gesture' });
  });

  it('does NOT confirm if the count keeps flickering', async () => {
    const { sched, cam, controller } = setup();
    const p = controller.attempt('count');
    for (let i = 0; i < 24; i++) {
      sched.advance(i === 0 ? 0 : 120);
      cam.emitFrame(fingersUp(i % 2 === 0 ? 2 : 3));
    }
    sched.advance(C.maxBurstMs);
    expect((await p).fallbackReason).toBe('no-gesture');
  });

  it('ignores unusable frames (low presence)', async () => {
    const { sched, cam, controller } = setup();
    const p = controller.attempt('start');
    const weak = synthHand({ index: true, middle: true, ring: true, pinky: true, thumb: true }, { presence: 0.2 });
    feed(sched, cam, weak, [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    sched.advance(C.maxBurstMs);
    expect((await p).fallbackReason).toBe('no-gesture');
  });

  it('enforces a cooldown after a successful confirm', async () => {
    const { sched, cam, controller } = setup();
    const p1 = controller.attempt('start');
    feed(sched, cam, fingersUp(5), STABLE);
    await p1;

    const r2 = await controller.attempt('start');
    expect(r2).toEqual({ outcome: 'fallback', fallbackReason: 'cooldown' });

    sched.advance(C.cooldownMs + 1);
    const base = sched.now();
    const p3 = controller.attempt('start');
    feed(sched, cam, fingersUp(5), STABLE.map((t) => base + t));
    expect((await p3).outcome).toBe('confirmed');
  });
});

describe('GestureController — 권한 거부 / 카메라 없음 (always falls back, never throws)', () => {
  it('permission denied => fallback:permission, state unavailable', async () => {
    const { controller, states } = setup({ startBehavior: 'reject-permission' });
    expect(await controller.attempt('start')).toEqual({ outcome: 'fallback', fallbackReason: 'permission' });
    expect(states.at(-1)).toBe('unavailable');
  });

  it('no camera device => fallback:no-camera', async () => {
    const { controller } = setup({ startBehavior: 'reject-nocamera' });
    expect((await controller.attempt('start')).fallbackReason).toBe('no-camera');
  });

  it('unknown camera error => resolves with fallback:error (never rejects)', async () => {
    const { controller } = setup({ startBehavior: 'reject-error' });
    await expect(controller.attempt('start')).resolves.toMatchObject({ fallbackReason: 'error' });
  });
});

describe('GestureController — 배터리/발열 스로틀링', () => {
  it('arming timeout (no frame delivered) => fallback:timeout, state unavailable', async () => {
    const { sched, controller, states } = setup({ startBehavior: 'hang' });
    const p = controller.attempt('start');
    sched.advance(C.armingTimeoutMs + 1);
    expect((await p).fallbackReason).toBe('timeout');
    expect(states.at(-1)).toBe('unavailable');
  });

  it('Low Power Mode signal aborts the burst and latches degraded', async () => {
    const { sched, cam, controller } = setup();
    const p = controller.attempt('start');
    feed(sched, cam, fingersUp(5), [0, 100]);
    cam.emitSignal({ lowPower: true, thermal: 'nominal', deliveredFps: 30 });
    expect((await p).fallbackReason).toBe('degraded');
    expect(controller.isDegraded()).toBe(true);

    expect((await controller.attempt('start')).fallbackReason).toBe('degraded');
    controller.clearDegraded();
    expect(controller.getState()).toBe('idle');
  });

  it('sustained low delivered FPS trips the watchdog', async () => {
    const { sched, cam, controller } = setup();
    const p = controller.attempt('count');
    feed(sched, cam, fingersUp(3), [0, 300, 600, 900]); // ~3.3 fps
    expect((await p).fallbackReason).toBe('degraded');
  });

  it('a critical thermal state degrades', async () => {
    const { sched, cam, controller } = setup();
    const p = controller.attempt('start');
    feed(sched, cam, fingersUp(5), [0]);
    cam.emitSignal({ lowPower: false, thermal: 'critical', deliveredFps: 30 });
    expect((await p).fallbackReason).toBe('degraded');
  });
});

describe('GestureController — camera lifecycle', () => {
  it('releases the camera on every terminal outcome', async () => {
    const ok = setup();
    const p = ok.controller.attempt('start');
    feed(ok.sched, ok.cam, fingersUp(5), STABLE);
    await p;
    expect(ok.cam.stopCount).toBe(1);

    const none = setup();
    const p2 = none.controller.attempt('start');
    none.sched.advance(C.maxBurstMs + 1);
    await p2;
    expect(none.cam.stopCount).toBe(1);
  });
});
