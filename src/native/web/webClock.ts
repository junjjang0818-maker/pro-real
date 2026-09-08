import type { NativeClockBridge } from '../ports';

/**
 * Web `NativeClockBridge`. `performance.now()` is monotonic within a page load;
 * `bootId` is a fresh random id per load, so after a reload the monotonic
 * cross-check is correctly skipped (same as a real device reboot). Good enough
 * to demo clock-anomaly handling and crash recovery in the browser.
 */
export function webClockBridge(): Partial<NativeClockBridge> {
  const bootId = `web-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  return {
    wallMs: () => Date.now(),
    monotonicMs: () => Math.round(performance.now()),
    bootId: () => bootId,
    tzId: () => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      } catch {
        return 'UTC';
      }
    },
    tzOffsetMin: () => -new Date().getTimezoneOffset(),
  };
}
