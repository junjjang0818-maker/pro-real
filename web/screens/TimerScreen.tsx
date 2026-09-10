import React, { useEffect, useReducer, useRef, useState } from 'react';
import {
  app,
  subjects,
  pendingRecovery,
  getSettings,
  gestureWatch,
  setAutoGesturePreview,
  setAutoStartParams,
} from '../appInstance';
import { Card, Tag, Bar } from '../ui';
import { mmss, mmssCs, hm } from '../hooks';
import { GesturePanel } from '../GesturePanel';
import { computeElapsed, isPaused } from '@app/core/session/elapsed';
import { subjectByFingerCount } from '@app/core/subjects';
import type { AttemptKind, AttemptResult } from '@app/features/gesture/GestureController';
import type { WatchState } from '../gestureWatch';
import type { FocusRating } from '@app/core/session/types';

export function TimerScreen() {
  const active = app.store.getActive();
  const now = app.clock.now();
  const list = subjects.active();
  const [subjectId, setSubjectId] = useState<string>(list[0]?.id ?? '');
  const [plannedMin, setPlannedMin] = useState<number>(0);
  const [gesture, setGesture] = useState<{ kind: AttemptKind; then: (r: AttemptResult) => void } | null>(null);
  const rec = pendingRecovery.kind === 'needs-confirmation' ? pendingRecovery : null;
  const [recovered, setRecovered] = useState(rec == null);
  const auto = getSettings().gestureAuto;

  const elapsed = active
    ? computeElapsed({ start: active.start, pauses: active.pauses, endWall: active.endWall }, now)
    : null;
  const paused = active ? isPaused(active) : false;

  const today = app.store.today();
  const todayRow = app.store.attendance().find((a) => a.localDate === today);

  // keep the always-on watcher's start params in sync with the pickers
  useEffect(() => {
    setAutoStartParams(subjectId || null, plannedMin > 0 ? plannedMin * 60_000 : null);
  }, [subjectId, plannedMin]);

  const emitStart = (sid: string, source: 'button' | 'gesture') =>
    app.bus.emit({
      purpose: 'start',
      source,
      subjectId: sid || null,
      plannedMs: plannedMin > 0 ? plannedMin * 60_000 : null,
    });

  const startGestureSubject = () =>
    setGesture({
      kind: 'count',
      then: (r) => {
        setGesture(null);
        if (r.outcome === 'confirmed' && r.value != null) {
          const s = subjectByFingerCount(subjects.active(), r.value);
          emitStart(s?.id ?? subjectId, 'gesture');
        }
      },
    });

  const stopWithGestureRating = () =>
    setGesture({
      kind: 'count',
      then: (r) => {
        setGesture(null);
        const rating = r.outcome === 'confirmed' && r.value != null ? (clamp15(r.value) as FocusRating) : undefined;
        app.bus.emit({ purpose: 'stop', source: r.outcome === 'confirmed' ? 'gesture' : 'button', value: rating });
      },
    });

  return (
    <div>
      <div className="h1">타이머</div>

      {!recovered && rec && (
        <Card>
          <div className="col" style={{ gap: 10 }}>
            <strong>이전 세션 복구</strong>
            <span className="muted small">
              진행 중이던 세션이 있었습니다 ({hm(rec.suggestedCountedMs)} 기록됨, 마지막 저장 시점 기준).
            </span>
            <div className="row wrap">
              <button
                className="good"
                onClick={() => {
                  app.store.applyRecovery(rec, {
                    kind: 'finalize-at-heartbeat',
                    heartbeat: { ...app.clock.now(), wall: rec.suggestedEndWall },
                  });
                  setRecovered(true);
                }}
              >
                기록으로 저장
              </button>
              <button
                onClick={() => {
                  app.store.applyRecovery(rec, { kind: 'keep-running' });
                  setRecovered(true);
                }}
              >
                계속 진행
              </button>
              <button
                className="ghost"
                onClick={() => {
                  app.store.applyRecovery(rec, { kind: 'discard' });
                  setRecovered(true);
                }}
              >
                폐기
              </button>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <div className="center col" style={{ gap: 10, padding: '8px 0 4px' }}>
          <LiveClock hasSession={active != null} paused={paused} />

          <div className="row wrap center" style={{ gap: 6 }}>
            {active ? (
              <>
                <Tag>{subjects.all().find((s) => s.id === active.subjectId)?.label ?? '태그 없음'}</Tag>
                <Tag>{active.startSource === 'gesture' ? '제스처 시작' : '버튼 시작'}</Tag>
                {paused && <Tag tone="err">일시정지</Tag>}
                {active.plannedMs != null && elapsed && (
                  <Tag>남은 {mmss(Math.max(0, active.plannedMs - elapsed.countedMs))}</Tag>
                )}
                {elapsed?.clockAnomaly && <Tag tone="err">시계 이상 감지</Tag>}
              </>
            ) : (
              <span className="muted small">세션이 없습니다</span>
            )}
          </div>
        </div>

        {!active ? (
          <div className="col" style={{ gap: 10, marginTop: 6 }}>
            <div className="row wrap">
              <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} style={{ maxWidth: 180 }}>
                {list.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                    {s.gestureFingerCount ? ` (손가락 ${s.gestureFingerCount})` : ''}
                  </option>
                ))}
              </select>
              <select value={plannedMin} onChange={(e) => setPlannedMin(Number(e.target.value))} style={{ maxWidth: 130 }}>
                <option value={0}>오픈엔드</option>
                <option value={25}>25분</option>
                <option value={50}>50분</option>
              </select>
            </div>
            <div className="row wrap">
              <button className="primary" onClick={() => emitStart(subjectId, 'button')}>
                ▶ 시작
              </button>
              {!auto && !gesture && (
                <>
                  <button onClick={() => setGesture({ kind: 'start', then: (r) => { setGesture(null); if (r.outcome === 'confirmed') emitStart(subjectId, 'gesture'); } })}>
                    ✋ 제스처로 시작
                  </button>
                  <button onClick={startGestureSubject}>🖐 손가락으로 과목 선택 후 시작</button>
                </>
              )}
            </div>
            {gesture && <GesturePanel kind={gesture.kind} onResult={gesture.then} />}
            {auto && <AutoGesturePanel target="start" />}
          </div>
        ) : (
          <div className="col" style={{ gap: 10, marginTop: 6 }}>
            <div className="row wrap">
              <button onClick={() => app.bus.emit({ purpose: 'toggle-pause', source: 'button' })}>
                {paused ? '▶ 재개' : '⏸ 일시정지'}
              </button>
              <button className="bad" onClick={() => app.bus.emit({ purpose: 'stop', source: 'button' })}>
                ■ 정지
              </button>
              {!auto && !gesture && (
                <>
                  <button
                    className="bad ghost"
                    onClick={() =>
                      setGesture({
                        kind: 'stop',
                        then: (r) => {
                          setGesture(null);
                          if (r.outcome === 'confirmed') app.bus.emit({ purpose: 'stop', source: 'gesture' });
                        },
                      })
                    }
                  >
                    ✊ 제스처로 정지
                  </button>
                  <button className="bad ghost" onClick={stopWithGestureRating}>
                    ■ 정지 + 손가락 자기평가
                  </button>
                </>
              )}
            </div>
            {gesture && <GesturePanel kind={gesture.kind} onResult={gesture.then} />}
            {auto && <AutoGesturePanel target="stop" />}
          </div>
        )}
      </Card>

      <Card title="오늘">
        <div className="row spread">
          <span className="muted small">기록된 학습</span>
          <strong>{hm(todayRow?.countedMs ?? 0)}</strong>
        </div>
        <div className="row spread" style={{ marginTop: 6 }}>
          <span className="muted small">출석 (목표 {app.store.getConfig().dailyGoalMs / 60000}분)</span>
          {todayRow?.attended ? <Tag tone="on">출석 ✓</Tag> : <Tag>미달</Tag>}
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>
          타이머가 도는 즉시 이 값이 갱신됩니다 — 세션·출석·통계는 하나의 소스에서 파생됩니다.
        </div>
      </Card>

    </div>
  );
}

function clamp15(n: number): number {
  return Math.max(1, Math.min(5, Math.round(n)));
}

/** Persistent status for the always-on watcher: no button, just aim your hand. */
function AutoGesturePanel({ target }: { target: 'start' | 'stop' }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState<WatchState>(gestureWatch.getState());

  useEffect(() => {
    setAutoGesturePreview(previewRef.current);
    const off = gestureWatch.subscribe(setW);
    return () => {
      off();
      setAutoGesturePreview(null);
    };
  }, []);

  const prompt = target === 'start' ? '손바닥을 펴서 유지하면 시작' : '주먹을 쥐어 유지하면 정지';
  return (
    <div
      className="col"
      style={{ gap: 8, background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}
    >
      <div className="row spread">
        <strong className="small">👁 제스처 자동 인식</strong>
        <span className="tag">
          {w.status === 'watching'
            ? w.cooldown
              ? '쿨다운'
              : w.count != null
                ? `감지: ${w.count}`
                : '대기 중'
            : w.status === 'loading'
              ? '모델 로딩…'
              : w.status === 'error'
                ? '오류'
                : '꺼짐'}
        </span>
      </div>
      <div ref={previewRef} style={{ minHeight: 4 }} />
      {w.status === 'watching' && (
        <>
          <Bar value={w.progress} tone={w.progress >= 1 ? 'good' : 'accent'} />
          <span className="muted small center">{prompt}</span>
        </>
      )}
      {w.status === 'error' && (
        <span className="small" style={{ color: 'var(--bad)', overflowWrap: 'anywhere' }}>
          {w.error ?? '카메라/모델을 시작하지 못했습니다.'} — 설정에서 자동 인식을 끄면 버튼으로 진행할 수 있어요.
        </span>
      )}
    </div>
  );
}

/**
 * The big timer readout, mm:ss.cs. Owns its own animation frame loop so the
 * two-decimal seconds update smoothly without re-rendering the whole screen.
 * The value is still a pure function of stored timestamps every frame — the
 * rAF loop only triggers a re-read, it never accumulates.
 */
function LiveClock({ hasSession, paused }: { hasSession: boolean; paused: boolean }) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!hasSession || paused) return;
    let raf = 0;
    const loop = () => {
      tick();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [hasSession, paused]);

  const active = app.store.getActive();
  const elapsed = active
    ? computeElapsed({ start: active.start, pauses: active.pauses, endWall: active.endWall }, app.clock.now())
    : null;
  return (
    <div className={`clock big ${paused ? 'muted' : ''}`}>
      {elapsed ? mmssCs(elapsed.countedMs) : '00:00.00'}
    </div>
  );
}
