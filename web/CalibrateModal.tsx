import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Bar } from './ui';
import { gestureWatch, refreshGestureWatch } from './appInstance';
import { webcamGestureSource } from '@app/native/web/webcamGestureSource';
import { countExtendedFingers, type HandObservation } from '@app/features/gesture/fingerCounting';
import {
  CALIB_LABELS,
  SAMPLES_PER_LABEL,
  recordSample,
  clearLabel,
  labelSampleCount,
  clearAllCalibration,
  calibrationReady,
} from './calibration';

const STEPS: { label: string; title: string; hint: string }[] = [
  { label: '0', title: '주먹', hint: '주먹을 쥐고 카메라 정면으로 유지하세요' },
  { label: '1', title: '손가락 1개', hint: '검지 하나만 펴세요' },
  { label: '2', title: '손가락 2개', hint: '검지·중지를 펴세요' },
  { label: '3', title: '손가락 3개', hint: '검지·중지·약지를 펴세요' },
  { label: '4', title: '손가락 4개', hint: '엄지만 접으세요' },
  { label: '5', title: '손바닥 (5개)', hint: '손바닥을 활짝 펴세요' },
];

export function CalibrateModal({ onClose }: { onClose: () => void }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [autoCapture, setAutoCapture] = useState(true);

  const stepRef = useRef(step);
  stepRef.current = step;
  const autoRef = useRef(autoCapture);
  autoRef.current = autoCapture;
  const lastCapRef = useRef(0);
  const lastObsRef = useRef<HandObservation | null>(null);

  useEffect(() => {
    // hand the camera to the modal; stop the always-on watcher while we're here
    gestureWatch.stop();
    const src = webcamGestureSource({ previewContainer: previewRef.current });
    let alive = true;
    const off = src.onFrame((obs: HandObservation | null) => {
      if (!alive) return;
      lastObsRef.current = obs;
      if (!obs) return setLiveCount(null);
      const fc = countExtendedFingers(obs);
      setLiveCount(fc.usable ? fc.count : null);

      const label = STEPS[stepRef.current]!.label;
      if (
        autoRef.current &&
        labelSampleCount(label) < SAMPLES_PER_LABEL &&
        performance.now() - lastCapRef.current > 160
      ) {
        if (recordSample(label, obs)) {
          lastCapRef.current = performance.now();
          bump();
        }
      }
    });
    src
      .start()
      .then(() => alive && setStatus('ready'))
      .catch((e: unknown) => {
        if (!alive) return;
        setStatus('error');
        setErrMsg(e instanceof Error ? e.message : String(e));
      });

    return () => {
      alive = false;
      off();
      src.stop();
      refreshGestureWatch(); // restart the watcher if it was on
    };
  }, []);

  const cur = STEPS[step]!;
  const count = labelSampleCount(cur.label);
  const done = count >= SAMPLES_PER_LABEL;
  const allDone = calibrationReady();

  return (
    <div className="overlay">
      <div className="sheet col" style={{ gap: 12, width: 'min(460px, 100%)' }}>
        <div className="row spread">
          <strong>손 모양 학습 · {step + 1}/{STEPS.length}</strong>
          <button className="ghost small" onClick={onClose}>
            닫기
          </button>
        </div>

        <div
          ref={previewRef}
          className="center"
          style={{ minHeight: 200, background: 'var(--panel-2)', borderRadius: 12, position: 'relative', overflow: 'hidden' }}
        >
          {status === 'loading' && <span className="muted small">카메라·모델 준비 중…</span>}
          {status === 'error' && (
            <span className="small" style={{ color: 'var(--bad)', padding: 12, overflowWrap: 'anywhere' }}>
              {errMsg || '카메라를 시작하지 못했습니다.'}
            </span>
          )}
          {status === 'ready' && liveCount != null && (
            <div style={{ position: 'absolute', right: 12, bottom: 8, fontSize: 34, fontWeight: 800 }}>{liveCount}</div>
          )}
        </div>

        <div className="col" style={{ gap: 4 }}>
          <div className="row spread">
            <strong>{cur.title}</strong>
            <span className="muted small">
              {count}/{SAMPLES_PER_LABEL} 샘플
            </span>
          </div>
          <Bar value={count / SAMPLES_PER_LABEL} tone={done ? 'good' : 'accent'} />
          <span className="muted small">{cur.hint} — 같은 손 모양을 유지하면 자동으로 모읍니다.</span>
        </div>

        <label className="row small" style={{ gap: 8 }}>
          <input type="checkbox" checked={autoCapture} onChange={(e) => setAutoCapture(e.target.checked)} />
          <span>자동 캡처</span>
        </label>

        <div className="row wrap" style={{ gap: 6 }}>
          <button
            disabled={status !== 'ready'}
            onClick={() => {
              const obs = lastObsRef.current;
              if (obs && recordSample(cur.label, obs)) bump();
            }}
          >
            지금 캡처
          </button>
          <button className="ghost" onClick={() => { clearLabel(cur.label); bump(); }}>
            이 단계 다시
          </button>
          <span className="grow" />
          <button disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
            이전
          </button>
          {step < STEPS.length - 1 ? (
            <button className="primary" onClick={() => setStep((s) => s + 1)}>
              다음
            </button>
          ) : (
            <button className="good" disabled={!allDone} onClick={onClose}>
              완료
            </button>
          )}
        </div>

        <div className="row spread small muted">
          <span>{allDone ? '모든 손 모양 학습 완료 — 이제 학습된 모양으로 인식합니다.' : '6단계를 모두 채우면 학습이 적용됩니다.'}</span>
          <button className="ghost small" onClick={() => { clearAllCalibration(); bump(); setStep(0); }}>
            전체 초기화
          </button>
        </div>
      </div>
    </div>
  );
}
