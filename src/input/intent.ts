import type { InputSource } from '../core/session/types';
import type { Command } from '../core/session/reducer';

/**
 * The unified input layer. Buttons, gestures and voice ALL construct an
 * `InputIntent` and push it onto one `InputBus`. A single subscriber translates
 * intents into session `Command`s and calls `reduce`. There is no other path
 * into the session state — this is the "single write path" in code form, and
 * the reason a gesture can never desync the timer from attendance.
 */

export type IntentPurpose = 'start' | 'stop' | 'select-subject' | 'set-rating' | 'toggle-pause';

export interface InputIntent {
  purpose: IntentPurpose;
  source: InputSource;
  /** present for gesture-sourced intents; used for telemetry / debugging only. */
  confidence?: number;
  /** finger count for select-subject / set-rating. */
  value?: number;
  /** resolved subject id for start / select-subject (button flow resolves it up front). */
  subjectId?: string | null;
  plannedMs?: number | null;
}

export type IntentListener = (intent: InputIntent) => void;

export class InputBus {
  private readonly listeners = new Set<IntentListener>();

  subscribe(listener: IntentListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(intent: InputIntent): void {
    for (const l of [...this.listeners]) l(intent);
  }
}

/**
 * Translate an intent + the current active-session flag into a session Command.
 * Returns null when the intent isn't actionable in the current state (caller
 * shows a hint rather than crashing).
 */
export function intentToCommand(
  intent: InputIntent,
  ctx: { hasActiveSession: boolean; isPaused: boolean; newSessionId: () => string },
): Command | null {
  switch (intent.purpose) {
    case 'start':
      if (ctx.hasActiveSession) return null;
      return {
        type: 'START',
        sessionId: ctx.newSessionId(),
        subjectId: intent.subjectId ?? null,
        plannedMs: intent.plannedMs ?? null,
        source: intent.source,
      };
    case 'stop':
      if (!ctx.hasActiveSession) return null;
      return {
        type: 'STOP',
        source: intent.source,
        focusSelfRating: isRating(intent.value) ? intent.value : null,
      };
    case 'toggle-pause':
      if (!ctx.hasActiveSession) return null;
      return ctx.isPaused
        ? { type: 'RESUME', source: intent.source }
        : { type: 'PAUSE', source: intent.source };
    case 'select-subject':
      if (!ctx.hasActiveSession) return null;
      if (intent.subjectId == null) return null;
      return { type: 'TAG_SUBJECT', subjectId: intent.subjectId, source: intent.source };
    case 'set-rating':
      if (!ctx.hasActiveSession || !isRating(intent.value)) return null;
      return { type: 'SET_RATING', rating: intent.value, source: intent.source };
    default:
      return null;
  }
}

function isRating(v: number | undefined): v is 1 | 2 | 3 | 4 | 5 {
  return v != null && Number.isInteger(v) && v >= 1 && v <= 5;
}
