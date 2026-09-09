import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Bar } from './ui';
import { HandPoseIcon } from './HandPoseIcon';
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
  listCustomPoses,
  addCustomPose,
  updateCustomPose,
  removeCustomPose,
  recordCustomSample,
  customSampleCount,
  type CustomPose,
} from './calibration';

type Bool5 = [boolean, boolean, boolean, boolean, boolean];

const POSES: { label: string; title: string; hint: string; fingers: Bool5 }[] = [
  { label: '0', title: '주먹', hint: '모든 손가락을 접으세요', fingers: [false, false, false, false, false] },
  { label: '1', title: '손가락 1개', hint: '검지만 펴세요', fingers: [false, true, false, false, false] },
  { label: '2', title: '손가락 2개 (브이)', hint: '검지·중지를 펴세요', fingers: [false, true, true, false, false] },
  { label: '3', title: '손가락 3개', hint: '검지·중지·약지를 펴세요', fingers: [false, true, true, true, false] },
  { label: '4', title: '손가락 4개', hint: '엄지만 접으세요', fingers: [false, true, true, true, true] },
  { label: '5', title: '손바닥 (5개)', hint: '모든 손가락을 펴세요', fingers: [true, true, true, true, true] },
];

const EMITS_OPTIONS: { label: string; value: CustomPose['emits'] }[] = [
  { label: '세션 시작', value: 5 },
  { label: '세션 정지', value: 0 },
  { label: '과목 1', value: 1 },
  { label: '과목 2', value: 2 },
  { label: '과목 3', value: 3 },
  { label: '과목 4', value: 4 },
  { label: '과목 5', value: 5 },
];
const emitsText = (n: number) => EMITS_OPTIONS.find((o) => o.value === n)?.label ?? String(n);

type Phase = 'enroll' | 'custom' | 'train';

export function CalibrateModal({ onClose }: { onClose: () => void }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('enroll');
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [autoCapture, setAutoCapture] = useState(true);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  // custom-phase state
  const [activeCustom, setActiveCustom] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newEmits, setNewEmits] = useState<CustomPose['emits']>(1);

  // train-phase state
  const [training, setTraining] = useState(false);
  const [trainProg, setTrainProg] = useState(0);
  const [trainResult, setTrainResult] = useState<{ ok: boolean; accuracy: number; reason?: string } | null>(null);

  // refs for the frame loop (avoids stale closures)
  const captureTarget = useRef<{ kind: 'label'; label: string } | { kind: 'custom'; id: string } | null>(null);
  const autoRef = useRef(autoCapture);
  autoRef.current = autoCapture;
  const lastCapRef = useRef(0);
  const lastObsRef = useRef<HandObservation | null>(null);

  // keep captureTarget in sync with the current phase/step/activeCustom
  useEffect(() => {
    if (phase === 'enroll') captureTarget.current = { kind: 'label', label: POSES[step]!.label };
    else if (phase === 'custom' && activeCustom) captureTarget.current = { kind: 'custom', id: activeCustom };
    else captureTarget.current = null;
  }, [phase, step, activeCustom]);

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

      const tgt = captureTarget.current;
      if (!tgt || !autoRef.current || performance.now() - lastCapRef.current < 160) return;
      const cap =
        tgt.kind === 'label'
          ? { current: labelSampleCount(tgt.label), record: () => recordSample(tgt.label, obs) }
          : { current: customSampleCount(tgt.id), record: () => recordCustomSample(tgt.id, obs) };
      if (cap.current < SAMPLES_PER_LABEL && cap.record()) {
        lastCapRef.current = performance.now();
        bump();
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
  const allEnrolled = calibrationReady();
  const customList = listCustomPoses();

  const runTrain = async () => {
    setTraining(true);
    setTrainProg(0);
    setTrainResult(null);
    const r = await trainCalibration(setTrainProg);
    setTraining(false);
    setTrainResult(r);
  };

  const manualCapture = () => {
    const obs = lastObsRef.current;
    const tgt = captureTarget.current;
    if (!obs || !tgt) return;
    const ok = tgt.kind === 'label' ? recordSample(tgt.label, obs) : recordCustomSample(tgt.id, obs);
    if (ok) bump();
  };

  return (
    <div className="overlay">
      <div className="sheet col" style={{ gap: 12, width: 'min(480px, 100%)' }}>
        <div className="row spread">
          <strong>
            손 모양 학습{' '}
            {phase === 'enroll' ? `· 기본 ${step + 1}/${POSES.length}` : phase === 'custom' ? '· 커스텀' : '· 신경망 학습'}
          </strong>
          <button className="ghost small" onClick={onClose}>
            닫기
          </button>
        </div>

        {/* phase tabs */}
        <div className="row" style={{ gap: 4 }}>
          {(['enroll', 'custom', 'train'] as const).map((p) => (
            <button
              key={p}
              className={`pill ${phase === p ? 'primary' : ''}`}
              disabled={p === 'train' && !allEnrolled}
              onClick={() => setPhase(p)}
            >
              {p === 'enroll' ? '기본 6포즈' : p === 'custom' ? `커스텀 (${customList.length})` : '학습'}
            </button>
          ))}
        </div>

        <div className="row" style={{ gap: 12, alignItems: 'stretch' }}>
          <div
            ref={previewRef}
            className="center"
            style={{ flex: 1, minHeight: 170, background: 'var(--panel-2)', borderRadius: 12, position: 'relative', overflow: 'hidden' }}
          >
            {status === 'loading' && <span className="muted small">카메라 준비 중…</span>}
            {status === 'error' && (
              <span className="small" style={{ color: 'var(--bad)', padding: 10, overflowWrap: 'anywhere' }}>
                {errMsg || '카메라를 시작하지 못했습니다.'}
              </span>
            )}
            {status === 'ready' && liveCount != null && (
              <div style={{ position: 'absolute', right: 10, bottom: 6, fontSize: 28, fontWeight: 800 }}>{liveCount}</div>
            )}
          </div>
          {phase === 'enroll' && (
            <div
              className="center col"
              style={{ width: 130, gap: 4, background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 12, padding: 8 }}
            >
              <span className="muted small">이 모양</span>
              <HandPoseIcon fingers={cur.fingers} size={104} />
            </div>
          )}
        </div>

        {phase === 'enroll' && (
          <>
            <div className="col" style={{ gap: 4 }}>
              <div className="row spread">
                <strong>{cur.title}</strong>
                <span className="muted small">{count}/{SAMPLES_PER_LABEL} 샘플</span>
              </div>
              <Bar value={count / SAMPLES_PER_LABEL} tone={count >= 3 ? 'good' : 'accent'} />
              <span className="muted small">{cur.hint} — 같은 손 모양을 유지하면 자동으로 모읍니다.</span>
            </div>
            <label className="row small" style={{ gap: 8 }}>
              <input type="checkbox" checked={autoCapture} onChange={(e) => setAutoCapture(e.target.checked)} />
              <span>자동 캡처</span>
            </label>
            <div className="row wrap" style={{ gap: 6 }}>
              <button disabled={status !== 'ready'} onClick={manualCapture}>
                지금 캡처
              </button>
              <button className="ghost" onClick={() => { clearLabel(cur.label); bump(); }}>
                이 단계 다시
              </button>
              <span className="grow" />
              <button disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
                이전
              </button>
              {step < POSES.length - 1 ? (
                <button className="primary" onClick={() => setStep((s) => s + 1)}>
                  다음
                </button>
              ) : (
                <button className="primary" disabled={!allEnrolled} onClick={() => setPhase('custom')}>
                  다음: 커스텀
                </button>
              )}
            </div>
          </>
        )}

        {phase === 'custom' && (
          <>
            <p className="muted small" style={{ margin: 0 }}>
              원하는 손 모양을 직접 추가하세요 (예: 따봉 = 세션 시작, 손날 = 정지). 각 포즈에 <b>뜻</b>을 지정하고 샘플을 모으면 학습에 포함됩니다.
            </p>

            {customList.map((c) => {
              const n = customSampleCount(c.id);
              return (
                <div
                  key={c.id}
                  className="col"
                  style={{ gap: 6, border: '1px solid var(--line)', borderRadius: 10, padding: 10, background: activeCustom === c.id ? 'var(--panel-2)' : 'transparent' }}
                >
                  <div className="row spread">
                    <strong className="small">{c.name}</strong>
                    <span className="row small" style={{ gap: 6 }}>
                      <select
                        value={c.emits}
                        onChange={(e) => { updateCustomPose(c.id, { emits: Number(e.target.value) as CustomPose['emits'] }); bump(); }}
                        style={{ width: 110 }}
                      >
                        {EMITS_OPTIONS.map((o) => (
                          <option key={o.label} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <button className="ghost small" onClick={() => { removeCustomPose(c.id); if (activeCustom === c.id) setActiveCustom(null); bump(); }}>
                        삭제
                      </button>
                    </span>
                  </div>
                  <div className="row spread small muted">
                    <span>{n}/{SAMPLES_PER_LABEL} 샘플</span>
                    <button
                      className={`pill small ${activeCustom === c.id ? 'primary' : ''}`}
                      disabled={status !== 'ready'}
                      onClick={() => setActiveCustom(activeCustom === c.id ? null : c.id)}
                    >
                      {activeCustom === c.id ? '캡처 중지' : n >= SAMPLES_PER_LABEL ? '다시 캡처' : '샘플 캡처'}
                    </button>
                  </div>
                  <Bar value={Math.min(1, n / SAMPLES_PER_LABEL)} tone={n >= 3 ? 'good' : 'accent'} />
                </div>
              );
            })}

            <div className="row wrap" style={{ gap: 6 }}>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="새 포즈 이름 (예: 따봉)"
                style={{ flex: 1, minWidth: 120 }}
              />
              <select value={newEmits} onChange={(e) => setNewEmits(Number(e.target.value) as CustomPose['emits'])} style={{ width: 110 }}>
                {EMITS_OPTIONS.map((o) => (
                  <option key={o.label} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                disabled={!newName.trim()}
                onClick={() => {
                  const id = addCustomPose(newName, newEmits);
                  setNewName('');
                  setActiveCustom(id);
                  bump();
                }}
              >
                추가
              </button>
            </div>

            <div className="row">
              <button onClick={() => setPhase('enroll')}>이전</button>
              <span className="grow" />
              <button className="primary" onClick={() => { setActiveCustom(null); setPhase('train'); }}>
                다음: 학습
              </button>
            </div>
          </>
        )}

        {phase === 'train' && (
          <>
            <p className="muted small" style={{ margin: 0 }}>
              기본 6포즈{customList.length ? ` + 커스텀 ${customList.length}개` : ''}를 작은 신경망(42→24→N)에 몇 초간 학습시킵니다. 전부 브라우저에서 실행됩니다.
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
              <button onClick={() => setPhase('custom')} disabled={training}>
                이전
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
              ? `신경망 학습됨${customList.length ? ` · 커스텀 ${customList.length}` : ''} — 학습된 모양으로 인식 중`
              : allEnrolled
                ? '샘플 준비 완료 — 학습 단계에서 신경망을 학습시키세요'
                : '기본 6포즈를 각각 3장 이상 모으세요'}
          </span>
          <button className="ghost small" onClick={() => { clearAllCalibration(); bump(); setStep(0); setPhase('enroll'); setTrainResult(null); setActiveCustom(null); }}>
            전체 초기화
          </button>
        </div>
      </div>
    </div>
  );
}
