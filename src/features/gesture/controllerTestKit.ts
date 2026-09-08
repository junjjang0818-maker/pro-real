import type { CameraSource, SystemSignal } from './GestureController';
import type { HandObservation } from './fingerCounting';

/** A deterministic scheduler: nothing fires until `advance()` moves time. */
export function manualScheduler() {
  let current = 0;
  let seq = 0;
  const tasks = new Map<number, { at: number; fn: () => void }>();

  return {
    now: () => current,
    schedule(ms: number, fn: () => void): () => void {
      const id = ++seq;
      tasks.set(id, { at: current + ms, fn });
      return () => tasks.delete(id);
    },
    /** advance time, firing any due callbacks in chronological order. */
    advance(ms: number): void {
      const target = current + ms;
      while (true) {
        let nextId = -1;
        let nextAt = Infinity;
        for (const [id, t] of tasks) {
          if (t.at <= target && t.at < nextAt) {
            nextAt = t.at;
            nextId = id;
          }
        }
        if (nextId === -1) break;
        current = nextAt;
        const task = tasks.get(nextId)!;
        tasks.delete(nextId);
        task.fn();
      }
      current = target;
    },
    pending: () => tasks.size,
  };
}

export interface FakeCameraOptions {
  startBehavior?: 'resolve' | 'reject-permission' | 'reject-nocamera' | 'reject-error' | 'hang';
}

export function fakeCamera(opts: FakeCameraOptions = {}) {
  const behavior = opts.startBehavior ?? 'resolve';
  let frameCb: ((o: HandObservation | null) => void) | null = null;
  let signalCb: ((s: SystemSignal) => void) | null = null;
  let stopCount = 0;
  let startCount = 0;

  const source: CameraSource = {
    start() {
      startCount++;
      switch (behavior) {
        case 'resolve':
          return Promise.resolve();
        case 'hang':
          return new Promise<void>(() => {});
        case 'reject-permission':
          return Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
        case 'reject-nocamera':
          return Promise.reject(Object.assign(new Error('device not found'), { name: 'NotFoundError' }));
        case 'reject-error':
          return Promise.reject(new Error('unknown failure'));
      }
    },
    stop() {
      stopCount++;
    },
    onFrame(cb) {
      frameCb = cb;
      return () => {
        frameCb = null;
      };
    },
    onSystemSignal(cb) {
      signalCb = cb;
      return () => {
        signalCb = null;
      };
    },
  };

  return {
    source,
    emitFrame: (o: HandObservation | null) => frameCb?.(o),
    emitSignal: (s: SystemSignal) => signalCb?.(s),
    get stopCount() {
      return stopCount;
    },
    get startCount() {
      return startCount;
    },
  };
}
