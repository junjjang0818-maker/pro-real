import type { KeyValueStore } from '../ports';

/**
 * `KeyValueStore` backed by `localStorage` for the web demo. Synchronous, which
 * is what the crash-recovery snapshot needs. Every access is wrapped: a private
 * window / disabled storage falls back to an in-memory map (state then lives
 * only for the tab session, which is acceptable for a demo).
 */
export function webKeyValueStore(namespace = 'gst'): KeyValueStore {
  const prefix = `${namespace}:`;
  const mem = new Map<string, string>();
  let usable = true;
  try {
    const probe = `${prefix}__probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
  } catch {
    usable = false;
  }

  return {
    getString(key) {
      if (!usable) return mem.get(key) ?? null;
      try {
        return localStorage.getItem(prefix + key);
      } catch {
        return mem.get(key) ?? null;
      }
    },
    set(key, value) {
      mem.set(key, value);
      if (!usable) return;
      try {
        localStorage.setItem(prefix + key, value);
      } catch {
        /* quota / disabled — keep the in-memory copy */
      }
    },
    delete(key) {
      mem.delete(key);
      if (!usable) return;
      try {
        localStorage.removeItem(prefix + key);
      } catch {
        /* ignore */
      }
    },
  };
}
