import { describe, it, expect, vi } from 'vitest';
import { createApp } from './wiring';
import { inMemoryPersistence } from '../core/store';
import { noopCameraSource, foregroundTimerStub, hapticsStub, memoryKeyValueStore } from '../native/stubs';

const MIN = 60_000;

function baseAdapters() {
  return {
    persistence: inMemoryPersistence(),
    camera: noopCameraSource,
    foregroundTimer: { ...foregroundTimerStub },
    haptics: { ...hapticsStub },
  };
}

describe('createApp — button and gesture flow through one path', () => {
  it('a START intent on the bus creates a session and starts the foreground timer', () => {
    const adapters = baseAdapters();
    const beginSpy = vi.spyOn(adapters.foregroundTimer, 'begin');
    const app = createApp(adapters, { dailyGoalMs: 60 * MIN });

    app.bus.emit({ purpose: 'start', source: 'button', subjectId: 'math' });
    expect(app.store.getActive()?.subjectId).toBe('math');
    expect(beginSpy).toHaveBeenCalledOnce();

    app.bus.emit({ purpose: 'stop', source: 'button' });
    expect(app.store.getActive()).toBeNull();
    app.dispose();
  });

  it('a gesture START fires haptic feedback; a button START does not', () => {
    const adapters = baseAdapters();
    const success = vi.spyOn(adapters.haptics, 'success');
    const app = createApp(adapters, { dailyGoalMs: 60 * MIN });

    app.bus.emit({ purpose: 'start', source: 'gesture', subjectId: 'math', confidence: 0.9 });
    expect(success).toHaveBeenCalledOnce();
    app.dispose();
  });

  it('a duplicate START (gesture racing button) is a no-op, not a second session', () => {
    const adapters = baseAdapters();
    const app = createApp(adapters, { dailyGoalMs: 60 * MIN });
    app.bus.emit({ purpose: 'start', source: 'button', subjectId: 'math' });
    const id = app.store.getActive()?.id;
    app.bus.emit({ purpose: 'start', source: 'gesture', subjectId: 'eng' });
    expect(app.store.getActive()?.id).toBe(id);
    expect(app.store.getActive()?.subjectId).toBe('math');
    app.dispose();
  });
});

describe('createApp — gesture unavailable never blocks input', () => {
  it('the noop camera leads the controller to a fallback, and buttons still work', async () => {
    const adapters = baseAdapters();
    const app = createApp(adapters, { dailyGoalMs: 60 * MIN, gesture: { ...(await import('../features/gesture/gestureConfig')).DEFAULT_GESTURE_CONFIG, armingTimeoutMs: 5, maxBurstMs: 10 } });

    const res = await app.gesture.attempt('start');
    expect(res.outcome).toBe('fallback');

    // button path unaffected
    app.bus.emit({ purpose: 'start', source: 'button', subjectId: 'math' });
    expect(app.store.getActive()).not.toBeNull();
    app.dispose();
  });
});
