import { describe, it, expect, vi } from 'vitest';
import { InputBus, intentToCommand, type InputIntent } from './intent';

describe('InputBus', () => {
  it('delivers intents to all subscribers', () => {
    const bus = new InputBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    const off = bus.subscribe(b);
    const intent: InputIntent = { purpose: 'start', source: 'button' };
    bus.emit(intent);
    expect(a).toHaveBeenCalledWith(intent);
    expect(b).toHaveBeenCalledWith(intent);
    off();
    bus.emit(intent);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe('intentToCommand — one translation for every input source', () => {
  const ctx = (over: Partial<{ hasActiveSession: boolean; isPaused: boolean }> = {}) => ({
    hasActiveSession: over.hasActiveSession ?? false,
    isPaused: over.isPaused ?? false,
    newSessionId: () => 'sess-new',
  });

  it('a gesture START and a button START produce the SAME command shape', () => {
    const fromButton = intentToCommand(
      { purpose: 'start', source: 'button', subjectId: 'math' },
      ctx(),
    );
    const fromGesture = intentToCommand(
      { purpose: 'start', source: 'gesture', subjectId: 'math', confidence: 0.9 },
      ctx(),
    );
    expect(fromButton).toEqual({
      type: 'START', sessionId: 'sess-new', subjectId: 'math', plannedMs: null, source: 'button',
    });
    expect(fromGesture).toEqual({ ...fromButton, source: 'gesture' });
  });

  it('START is ignored (null) when a session is already running', () => {
    expect(intentToCommand({ purpose: 'start', source: 'gesture' }, ctx({ hasActiveSession: true }))).toBeNull();
  });

  it('STOP carries a finger-count self-rating when valid', () => {
    expect(
      intentToCommand({ purpose: 'stop', source: 'gesture', value: 4 }, ctx({ hasActiveSession: true })),
    ).toEqual({ type: 'STOP', source: 'gesture', focusSelfRating: 4 });
    expect(
      intentToCommand({ purpose: 'stop', source: 'gesture', value: 9 }, ctx({ hasActiveSession: true })),
    ).toEqual({ type: 'STOP', source: 'gesture', focusSelfRating: null });
  });

  it('toggle-pause maps to PAUSE or RESUME based on current state', () => {
    expect(
      intentToCommand({ purpose: 'toggle-pause', source: 'button' }, ctx({ hasActiveSession: true, isPaused: false })),
    ).toEqual({ type: 'PAUSE', source: 'button' });
    expect(
      intentToCommand({ purpose: 'toggle-pause', source: 'button' }, ctx({ hasActiveSession: true, isPaused: true })),
    ).toEqual({ type: 'RESUME', source: 'button' });
  });

  it('select-subject and set-rating require an active session', () => {
    expect(intentToCommand({ purpose: 'select-subject', source: 'gesture', subjectId: 's1' }, ctx())).toBeNull();
    expect(intentToCommand({ purpose: 'set-rating', source: 'gesture', value: 3 }, ctx())).toBeNull();
    expect(
      intentToCommand({ purpose: 'set-rating', source: 'gesture', value: 3 }, ctx({ hasActiveSession: true })),
    ).toEqual({ type: 'SET_RATING', rating: 3, source: 'gesture' });
  });
});
