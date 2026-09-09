import React, { useEffect, useRef, useState } from 'react';
import { app, cameraProxy } from './appInstance';
import { countExtendedFingers } from '@app/features/gesture/fingerCounting';
import { fingersUp, synthHand } from '@app/features/gesture/synthetic';
import { lastGestureLoadError } from '@app/native/web/webcamGestureSource';
import { templateClassifyCount, calibrationReady } from './calibration';
import type { AttemptKind, AttemptResult, GestureState } from '@app/features/gesture/GestureController';

const PROMPT: Record<AttemptKind, string> = {
  start: '손바닥을 펴서 잠시 유지하세요',
  stop: '주먹을 쥐어 잠시 유지하세요',
  count: '손가락 개수를 펴서 잠시 유지하세요',
};

const RETRYABLE = new Set(['error', 'timeout', 'degraded', 'no-gesture']);

export function GestureOverlay({ kind, onResult }: { kind: AttemptKind; onResult: (r: AttemptResult) => void }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<GestureState>('arming');
  const [count, setCount] = useState<number | null>(null);
  const [done, setDone] = useState<AttemptResult | null>(null);
  const [runId, setRunId] = useState(0);

  const simulated = cameraProxy.isSimulating();

  useEffect(() => {
    setDone(null);
    setState('arming');
    setCount(null);
    cameraProxy.setPreviewContainer(previewRef.current);
    if (app.gesture.isDegraded()) app.gesture.clearDegraded(); // let a manual retry through

    const cfg = app.gesture.getConfig();
    const offFrame = cameraProxy.source.onFrame((obs) => {
      if (!obs) return setCount(null);
      const learned = templateClassifyCount(obs);
      if (learned != null) return setCount(learned);
      const fc = countExtendedFingers(obs, {
        minPresence: cfg.minConfidence,
        minHandSpan: cfg.minHandSpan,
        extendMargin: cfg.extendMargin,
      });
      setCount(fc.usable ? fc.count : null);
    });
    const poll = setInterval(() => setState(app.gesture.getState()), 120);

    // simulation: hold one synthetic hand steady so the controller confirms it
    // through the exact same misrecognition-prevention gates as a real webcam.
    let simTimer: ReturnType<typeof setInterval> | null = null;
    if (simulated) {
      const target =
        kind === 'start'
          ? synthHand({ thumb: true, index: true, middle: true, ring: true, pinky: true })
          : kind === 'stop'
            ? synthHand({})
            : fingersUp(((Math.floor(Math.random() * 5) + 1) as 1 | 2 | 3 | 4 | 5));
      simTimer = setInterval(() => cameraProxy.emitSyntheticFrame(target), 30);
    }

    let alive = true;
    app.gesture.attempt(kind).then((r) => {
      if (!alive) return;
      offFrame();
      clearInterval(poll);
      if (simTimer) clearInterval(simTimer);
      cameraProxy.setPreviewContainer(null);
      setDone(r);
      // auto-close on confirm, or on a plain "no gesture" cancel; keep the sheet
      // open for load/permission errors so the user can retry or read the reason.
      if (r.outcome === 'confirmed') {
        setTimeout(() => onResult(r), 650);
      } else if (r.fallbackReason === 'cooldown' || r.fallbackReason === 'no-gesture') {
        setTimeout(() => onResult(r), 300);
      }
    });
    return () => {
      alive = false;
      offFrame();
      clearInterval(poll);
      if (simTimer) clearInterval(simTimer);
      cameraProxy.setPreviewContainer(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, runId]);

  const loadErr = done && done.outcome === 'fallback' ? lastGestureLoadError() : null;

  return (
    <div className="overlay">
      <div className="sheet col" style={{ gap: 14 }}>
        {done?.outcome === 'confirmed' ? (
          <div className="center col" style={{ gap: 8, padding: '18px 0' }}>
            <div style={{ fontSize: 44 }}>✓</div>
            <div style={{ fontWeight: 700 }}>
              {kind === 'count' ? `${done.value} 인식됨` : kind === 'start' ? '세션 시작' : '세션 정지'}
            </div>
          </div>
        ) : done && done.outcome === 'fallback' ? (
          <div className="center col" style={{ gap: 10, padding: '6px 0' }}>
            <div style={{ fontSize: 30 }}>⌨️</div>
            <div className="muted small">{fallbackText(done.fallbackReason)}</div>
            {loadErr && (
              <div className="kbd small" style={{ maxWidth: '100%', overflowWrap: 'anywhere', color: 'var(--bad)' }}>
                {loadErr}
              </div>
            )}
            {done.fallbackReason === 'error' && (
              <div className="muted small">
                localhost/HTTPS 인지, <span className="kbd">npm run web</span> 로 실행했는지(WASM 로컬 복사), 네트워크(모델 다운로드)를 확인하세요.
              </div>
            )}
            <div className="row" style={{ gap: 6, marginTop: 4 }}>
              {RETRYABLE.has(done.fallbackReason ?? '') && (
                <button className="primary" onClick={() => setRunId((n) => n + 1)}>
                  다시 시도
                </button>
              )}
              <button onClick={() => onResult(done)}>버튼으로 진행</button>
            </div>
          </div>
        ) : (
          <>
            <div className="row spread">
              <strong>{kind === 'count' ? '손가락 개수' : kind === 'start' ? '제스처로 시작' : '제스처로 정지'}</strong>
              <span className="row" style={{ gap: 4 }}>
                {calibrationReady() && <span className="tag on">학습된 손모양</span>}
                {simulated && <span className="tag">시뮬레이션</span>}
                <span className="tag">{stateLabel(state)}</span>
              </span>
            </div>
            <div
              ref={previewRef}
              className="center"
              style={{ minHeight: 180, background: 'var(--panel-2)', borderRadius: 12, position: 'relative' }}
            >
              {state === 'arming' && (
                <span className="muted small">
                  {simulated ? '합성 프레임 주입 중…' : '카메라·모델 준비 중… (최초 1회 수 초)'}
                </span>
              )}
              {state === 'detecting' && count != null && (
                <div style={{ position: 'absolute', right: 12, bottom: 10, fontSize: 40, fontWeight: 800 }}>{count}</div>
              )}
            </div>
            <div className="muted small center">{PROMPT[kind]}</div>
          </>
        )}
        {!done && (
          <button className="ghost" onClick={() => onResult({ outcome: 'fallback', fallbackReason: 'no-gesture' })}>
            취소하고 버튼 사용
          </button>
        )}
      </div>
    </div>
  );
}

function stateLabel(s: GestureState): string {
  return (
    { idle: '대기', arming: '준비 중', detecting: '인식 중', confirmed: '완료', cooldown: '쿨다운', unavailable: '사용 불가' } as Record<
      GestureState,
      string
    >
  )[s];
}

function fallbackText(reason?: string): string {
  switch (reason) {
    case 'permission':
      return '카메라 권한이 거부되었습니다.';
    case 'no-camera':
      return '카메라를 찾을 수 없습니다.';
    case 'degraded':
      return '저전력/발열 또는 프레임 저하로 카메라 인식이 제한됩니다.';
    case 'timeout':
      return '카메라/모델이 제때 준비되지 않았습니다.';
    case 'cooldown':
      return '방금 인식했습니다. 잠시 후 다시 시도하세요.';
    case 'error':
      return '손 인식 모델을 불러오지 못했습니다.';
    default:
      return '제스처를 인식하지 못했습니다.';
  }
}
