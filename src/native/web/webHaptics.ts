import type { Haptics } from '../ports';

/** Uses the Vibration API where available (Android Chrome); no-op elsewhere. */
export function webHaptics(): Haptics {
  const vibrate = (pattern: number | number[]) => {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* ignore */
    }
  };
  return {
    success: () => vibrate([20, 40, 20]),
    warning: () => vibrate(80),
    selection: () => vibrate(10),
  };
}
