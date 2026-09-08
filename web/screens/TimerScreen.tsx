import React, { useState } from 'react';
import { app, subjects, pendingRecovery } from '../appInstance';
import { Card, Tag } from '../ui';
import { mmss, hm } from '../hooks';
import { GestureOverlay } from '../GestureOverlay';
import { computeElapsed, isPaused } from '@app/core/session/elapsed';
import { subjectByFingerCount } from '@app/core/subjects';
import type { AttemptKind, AttemptResult } from '@app/features/gesture/GestureController';
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

  const elapsed = active
    ? computeElapsed({ start: active.start, pauses: active.pauses, endWall: active.endWall }, now)
    : null;
  const paused = active ? isPaused(active) : false;

  const today = app.store.today();
  const todayRow = app.store.attendance().find((a) => a.localDate === today);

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
          <div className={`clock big ${paused ? 'muted' : ''}`}>{elapsed ? mmss(elapsed.countedMs) : '00:00'}</div>
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
              <button onClick={() => setGesture({ kind: 'start', then: (r) => { setGesture(null); if (r.outcome === 'confirmed') emitStart(subjectId, 'gesture'); } })}>
                ✋ 제스처로 시작
              </button>
              <button onClick={startGestureSubject}>🖐 손가락으로 과목 선택 후 시작</button>
            </div>
          </div>
        ) : (
          <div className="row wrap" style={{ marginTop: 6 }}>
            <button onClick={() => app.bus.emit({ purpose: 'toggle-pause', source: 'button' })}>
              {paused ? '▶ 재개' : '⏸ 일시정지'}
            </button>
            <button className="bad" onClick={() => app.bus.emit({ purpose: 'stop', source: 'button' })}>
              ■ 정지
            </button>
            <button className="bad ghost" onClick={stopWithGestureRating}>
              ■ 정지 + 손가락 자기평가
            </button>
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

      {gesture && <GestureOverlay kind={gesture.kind} onResult={gesture.then} />}
    </div>
  );
}

function clamp15(n: number): number {
  return Math.max(1, Math.min(5, Math.round(n)));
}
