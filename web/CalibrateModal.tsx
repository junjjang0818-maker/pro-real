import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Bar } from './ui';
import { gestureWatch, refreshGestureWatch } from './appInstance';
import { webcamGestureSource } from '@app/native/web/webcamGestureSource';
import { countExtendedFingers, type HandObservation } from '@app/features/gesture/fingerCounting';
import {
  SAMPLES_PER_LABEL,
  recordSample,
  clearLabel,
  labelSampleCount,
  clearAllCalibration,
  calibrationReady,
  calibrationTrained,
  trainCalibration,
} from './calibration';

const POSES: { label: string; title: string; hint: string }[] = [
  { label: '0', title: '주먹', hint: '주먹을 쥐고 카메라 정면으로 유지하세요' },
  { label: '1', title: '손가락 1개', hint: '검지 하나만 펴세요' },
  { label: '2', title: '손가락 2개', hint: '검지·중지를 펴세요' },
  { label: '3', title: '손가락 3개', hint: '검지·중지·약지를 펴세요' },
  { label: '4', title: '손가락 4개', hint: '엄지만 접으세요' },
  { label: '5', title: '손바닥 (5개)', hint: '손바닥을 활짝 펴세요' },
];

type Phase = 'enroll' | 'train';

export function CalibrateModal({ onClose }: { onClose: () => void }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('enroll');
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [autoCapture, setAutoCapture] = useState(true);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const [training, setTraining] = useState(false);
  const [trainProg, setTrainProg] = useState(0);
  const [trainResult, setTrainResult] = useState<{ ok: boolean; accuracy: number; reason?: string } | null>(null);

  const stepRef = useRef(step);
  stepRef.current = step;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const autoRef = useRef(autoCapture);
  autoRef.current = autoCapture;
  const lastCapRef = useRef(0);
  const lastObsRef = useRef<HandObservation | null>(null);

  useEffect(() => {
    gestureWatch.stop(); // the modal owns the camera while it's open
    const src = webcamGestureSource({ previewContainer: previewRef.current });
    let alive = true;
    const off = src.onFrame((obs: HandObservation | null) => {
      if (!alive) return;
      lastObsRef.current = obs;
      if (!obs) return setLiveCount(null);
      const fc = countExtendedFingers(obs);
      setLiveCount(fc.usable ? fc.count : null);
      if (phaseRef.current !== 'enroll') return;
      const label = POSES[stepRef.current]!.label;
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
      refreshGestureWatch();
    };
  }, []);

  const cur = POSES[step]!;
  const count = labelSampleCount(cur.label);
  const stepDone = count >= 3;
  const allEnrolled = calibrationReady();

  const runTrain = async () => {
    setTraining(true);
    setTrainProg(0);
    setTrainResult(null);
    const r = await trainCalibration(setTrainProg);
    setTraining(false);
    setTrainResult(r);
  };

  return (
    <div className="overlay">
      <div className="sheet col" style={{ gap: 12, width: 'min(460px, 100%)' }}>
        <div className="row spread">
          <strong>
            손 모양 학습 {phase === 'enroll' ? `· ${step + 1}/${POSES.length}` : '· 신경망 학습'}
          </strong>
          <button className="ghost small" onClick={onClose}>
            닫기
          </button>
        </div>

        <div
          ref={previewRef}
          className="center"
          style={{ minHeight: 190, background: 'var(--panel-2)', borderRadius: 12, position: 'relative', overflow: 'hidden' }}
        >
          {status === 'loading' && <span className="muted small">카메라·모델 준비 중…</span>}
          {status === 'error' && (
            <span className="small" style={{ color: 'var(--bad)', padding: 12, overflowWrap: 'anywhere' }}>
              {errMsg || '카메라를 시작하지 못했습니다.'}
            </span>
          )}
          {status === 'ready' && liveCount != null && (
            <div style={{ position: 'absolute', right: 12, bottom: 8, fontSize: 32, fontWeight: 800 }}>{liveCount}</div>
          )}
        </div>

        {phase === 'enroll' ? (
          <>
            <div className="col" style={{ gap: 4 }}>
              <div className="row spread">
                <strong>{cur.title}</strong>
                <span className="muted small">
                  {count}/{SAMPLES_PER_LABEL} 샘플
                </span>
              </div>
              <Bar value={count / SAMPLES_PER_LABEL} tone={stepDone ? 'good' : 'accent'} />
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
              {step < POSES.length - 1 ? (
                <button className="primary" onClick={() => setStep((s) => s + 1)}>
                  다음
                </button>
              ) : (
                <button className="primary" disabled={!allEnrolled} onClick={() => setPhase('train')}>
                  학습 단계로
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="muted small" style={{ margin: 0 }}>
              모은 샘플({POSES.length}포즈 × 최대 {SAMPLES_PER_LABEL}장)을 augmentation 후 작은 신경망(42→24→6)에 몇 초간 학습시킵니다. 전부 브라우저에서 실행됩니다.
            </p>
            {training && (
              <div className="col" style={{ gap: 4 }}>
                <Bar value={trainProg} />
                <span className="muted small center">학습 중… {Math.round(trainProg * 100)}%</span>
              </div>
            )}
            {trainResult && (
              <div className="col center" style={{ gap: 6, padding: '6px 0' }}>
                {trainResult.ok ? (
                  <>
                    <div style={{ fontSize: 30 }}>✓</div>
                    <div style={{ fontWeight: 700 }}>학습 완료 · 학습 정확도 {Math.round(trainResult.accuracy * 100)}%</div>
                    <div className="muted small">이제 인식이 학습된 신경망을 사용합니다.</div>
                  </>
                ) : (
                  <div className="small" style={{ color: 'var(--bad)' }}>{trainResult.reason ?? '학습 실패'}</div>
                )}
              </div>
            )}
            <div className="row wrap" style={{ gap: 6 }}>
              <button onClick={() => setPhase('enroll')} disabled={training}>
                샘플 다시
              </button>
              <span className="grow" />
              {!trainResult?.ok ? (
                <button className="primary" onClick={runTrain} disabled={training}>
                  {training ? '학습 중…' : calibrationTrained() ? '다시 학습' : '학습 시작'}
                </button>
              ) : (
                <button className="good" onClick={onClose}>
                  완료
                </button>
              )}
            </div>
          </>
        )}

        <div className="row spread small muted">
          <span>
            {calibrationTrained()
              ? '신경망 학습됨 — 학습된 모양으로 인식 중'
              : allEnrolled
                ? '샘플 준비 완료 — 학습 단계에서 신경망을 학습시키세요'
                : '6개 포즈를 각각 3장 이상 모으세요'}
          </span>
          <button className="ghost small" onClick={() => { clearAllCalibration(); bump(); setStep(0); setPhase('enroll'); setTrainResult(null); }}>
            전체 초기화
          </button>
        </div>
      </div>
    </div>
  );
}
