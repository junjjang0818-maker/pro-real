import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Bar } from './ui';
import { HandPoseIcon, type Bool5 } from './HandPoseIcon';
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
  subscribeCalibration,
  type CustomPose,
} from './calibration';

const FULL = SAMPLES_PER_LABEL; // 12 — a pose is "학습됨" when it has this many samples
const MIN = 3; // minimum to count toward training

const POSES: { label: string; title: string; hint: string; fingers: Bool5 }[] = [
  { label: '0', title: '주먹', hint: '다섯 손가락을 모두 접으세요', fingers: [false, false, false, false, false] },
  { label: '1', title: '손가락 1개', hint: '검지만 펴세요', fingers: [false, true, false, false, false] },
  { label: '2', title: '손가락 2개 (브이)', hint: '검지와 중지를 펴세요', fingers: [false, true, true, false, false] },
  { label: '3', title: '손가락 3개', hint: '검지·중지·약지를 펴세요', fingers: [false, true, true, true, false] },
  { label: '4', title: '손가락 4개', hint: '엄지만 접으세요', fingers: [false, true, true, true, true] },
  { label: '5', title: '손바닥 (5개)', hint: '다섯 손가락을 모두 펴세요', fingers: [true, true, true, true, true] },
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

type Phase = 'enroll' | 'custom' | 'train';

export function CalibratePanel({ onClose }: { onClose: () => void }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('enroll');
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [autoCapture, setAutoCapture] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [tick, bump] = useReducer((n: number) => n + 1, 0);

  const [activeCustom, setActiveCustom] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newEmits, setNewEmits] = useState<CustomPose['emits']>(1);

  const [training, setTraining] = useState(false);
  const [trainProg, setTrainProg] = useState(0);
  const [trainResult, setTrainResult] = useState<{ ok: boolean; accuracy: number; reason?: string } | null>(null);

  // frame-loop targets (avoid stale closures)
  const captureTarget = useRef<{ kind: 'label'; label: string } | { kind: 'custom'; id: string } | null>(null);
  const autoRef = useRef(autoCapture);
  autoRef.current = autoCapture;
  const lastCapRef = useRef(0);
  const lastObsRef = useRef<HandObservation | null>(null);
  const armedRef = useRef(true); // is the current enroll step armed for auto-advance?

  useEffect(() => {
    if (phase === 'enroll') {
      captureTarget.current = { kind: 'label', label: POSES[step]!.label };
      armedRef.current = labelSampleCount(POSES[step]!.label) < FULL;
    } else if (phase === 'custom' && activeCustom) {
      captureTarget.current = { kind: 'custom', id: activeCustom };
    } else {
      captureTarget.current = null;
    }
  }, [phase, step, activeCustom]);

  // re-render on any calibration store change (captures, custom edits, resets)
  useEffect(() => subscribeCalibration(bump), []);

  // camera lifecycle — the modal owns it while open
  useEffect(() => {
    gestureWatch.stop();
    const src = webcamGestureSource({ previewContainer: previewRef.current });
    let alive = true;
    const off = src.onFrame((obs: HandObservation | null) => {
      if (!alive) return;
      lastObsRef.current = obs;
      if (!obs) return setLiveCount(null);
      const fc = countExtendedFingers(obs);
      setLiveCount(fc.usable ? fc.count : null);

      const tgt = captureTarget.current;
      if (!tgt || !autoRef.current || performance.now() - lastCapRef.current < 150) return;
      const cur = tgt.kind === 'label' ? labelSampleCount(tgt.label) : customSampleCount(tgt.id);
      if (cur >= FULL) return;
      const ok = tgt.kind === 'label' ? recordSample(tgt.label, obs) : recordCustomSample(tgt.id, obs);
      if (ok) {
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

  // completion watcher: pose full -> "학습 완료" banner -> auto-advance
  useEffect(() => {
    if (phase !== 'enroll' || !armedRef.current) return;
    if (labelSampleCount(POSES[step]!.label) < FULL) return;
    armedRef.current = false;
    setBanner('✓ 학습 완료');
    const t = setTimeout(() => {
      setBanner(null);
      goNextIncomplete();
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, step, phase]);

  const doneCount = POSES.filter((p) => labelSampleCount(p.label) >= FULL).length;
  const allEnrolled = calibrationReady();
  const customList = listCustomPoses();

  const goNextIncomplete = () => {
    for (let i = step + 1; i < POSES.length; i++)
      if (labelSampleCount(POSES[i]!.label) < FULL) return setStep(i);
    for (let i = 0; i < step; i++) if (labelSampleCount(POSES[i]!.label) < FULL) return setStep(i);
    setPhase('custom'); // all six done
  };

  const manualCapture = () => {
    const obs = lastObsRef.current;
    const tgt = captureTarget.current;
    if (!obs || !tgt) return;
    const ok = tgt.kind === 'label' ? recordSample(tgt.label, obs) : recordCustomSample(tgt.id, obs);
    if (ok) bump();
  };

  const runTrain = async () => {
    setTraining(true);
    setTrainProg(0);
    setTrainResult(null);
    const r = await trainCalibration(setTrainProg);
    setTraining(false);
    setTrainResult(r);
  };

  const cur = POSES[step]!;
  const curCount = labelSampleCount(cur.label);

  return (
    <div className="col" style={{ gap: 12, position: 'relative' }}>
      {banner && (
          <div
            style={{
              position: 'absolute',
              top: '38%',
              left: '50%',
              transform: 'translate(-50%,-50%)',
              background: 'var(--panel)',
              border: '2px solid var(--good)',
              borderRadius: 16,
              padding: '18px 28px',
              fontWeight: 800,
              fontSize: 22,
              color: 'var(--good)',
              zIndex: 5,
              boxShadow: '0 8px 32px rgba(0,0,0,.5)',
            }}
          >
            {banner}
          </div>
        )}
        <div className="row spread">
          <strong>손 모양 학습</strong>
          <button className="ghost small" onClick={onClose}>
            닫기
          </button>
        </div>

        {/* stepper */}
        <div className="row" style={{ gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {POSES.map((p, i) => {
            const done = labelSampleCount(p.label) >= FULL;
            const partial = !done && labelSampleCount(p.label) >= MIN;
            const active = phase === 'enroll' && i === step;
            return (
              <button
                key={p.label}
                onClick={() => {
                  setPhase('enroll');
                  setStep(i);
                }}
                title={p.title}
                style={{
                  width: 30,
                  height: 30,
                  padding: 0,
                  borderRadius: 999,
                  fontWeight: 700,
                  border: active ? '2px solid var(--accent)' : '1px solid var(--line)',
                  background: done ? 'var(--good)' : partial ? 'var(--panel-2)' : 'transparent',
                  color: done ? '#04241c' : 'var(--text)',
                }}
              >
                {done ? '✓' : p.label /* the finger count for this pose */}
              </button>
            );
          })}
          <span className="grow" />
          <button className={`pill small ${phase === 'custom' ? 'primary' : ''}`} onClick={() => setPhase('custom')}>
            커스텀 {customList.length || ''}
          </button>
          <button
            className={`pill small ${phase === 'train' ? 'primary' : ''}`}
            disabled={!allEnrolled}
            onClick={() => setPhase('train')}
          >
            학습{calibrationTrained() ? ' ✓' : ''}
          </button>
        </div>

        {/* shared live camera preview (enroll + custom) */}
        {phase !== 'train' && (
          <div
            ref={previewRef}
            className="center"
            style={{ minHeight: 130, background: 'var(--panel-2)', borderRadius: 12, position: 'relative', overflow: 'hidden' }}
          >
            {status === 'loading' && <span className="muted small">카메라 준비 중…</span>}
            {status === 'error' && (
              <span className="small" style={{ color: 'var(--bad)', padding: 10, overflowWrap: 'anywhere' }}>
                {errMsg || '카메라를 시작하지 못했습니다.'}
              </span>
            )}
            {status === 'ready' && liveCount != null && (
              <div style={{ position: 'absolute', right: 10, bottom: 6, fontSize: 26, fontWeight: 800 }}>{liveCount}</div>
            )}
          </div>
        )}

        {phase === 'enroll' && (
          <>
            <div className="row" style={{ gap: 12, alignItems: 'center' }}>
              <HandPoseIcon fingers={cur.fingers} size={128} />
              <div className="col grow" style={{ gap: 5 }}>
                <div style={{ fontWeight: 800, fontSize: 17 }}>{cur.title}</div>
                <div className="muted small">{cur.hint}</div>
                <div style={{ marginTop: 2 }}>
                  <CaptureRing count={curCount} total={FULL} />
                </div>
              </div>
            </div>

            <label className="row small" style={{ gap: 8 }}>
              <input type="checkbox" checked={autoCapture} onChange={(e) => setAutoCapture(e.target.checked)} />
              <span>손 모양을 유지하면 자동으로 캡처</span>
            </label>

            <div className="row wrap" style={{ gap: 6 }}>
              <button disabled={status !== 'ready' || curCount >= FULL} onClick={manualCapture}>
                지금 캡처
              </button>
              <button
                className="ghost"
                onClick={() => {
                  clearLabel(cur.label);
                  armedRef.current = true;
                  bump();
                }}
              >
                이 포즈 다시
              </button>
              <span className="grow" />
              <button disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
                이전
              </button>
              <button
                className="primary"
                disabled={curCount < MIN}
                onClick={() => (step < POSES.length - 1 ? setStep((s) => s + 1) : setPhase('custom'))}
              >
                {step < POSES.length - 1 ? '다음' : '커스텀으로'}
              </button>
            </div>
          </>
        )}

        {phase === 'custom' && (
          <>
            <p className="muted small" style={{ margin: 0 }}>
              원하는 손 모양을 직접 추가하세요. 각 포즈에 <b>뜻</b>(세션 시작·정지·과목 1~5)을 지정하고 <b>{FULL}장</b>을 모으면 학습에 포함됩니다.
              {activeCustom && <b style={{ color: 'var(--accent)' }}> · 지금 캡처 중</b>}
            </p>

            {customList.map((c) => {
              const n = customSampleCount(c.id);
              const capturing = activeCustom === c.id;
              return (
                <div
                  key={c.id}
                  className="col"
                  style={{ gap: 6, border: '1px solid var(--line)', borderRadius: 10, padding: 10, background: capturing ? 'var(--panel-2)' : 'transparent' }}
                >
                  <div className="row spread">
                    <strong className="small">
                      {c.name} {n >= FULL && <span style={{ color: 'var(--good)' }}>✓</span>}
                    </strong>
                    <span className="row small" style={{ gap: 6 }}>
                      <select
                        value={c.emits}
                        onChange={(e) => {
                          updateCustomPose(c.id, { emits: Number(e.target.value) as CustomPose['emits'] });
                          bump();
                        }}
                        style={{ width: 106 }}
                      >
                        {EMITS_OPTIONS.map((o) => (
                          <option key={o.label} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <button
                        className="ghost small"
                        onClick={() => {
                          removeCustomPose(c.id);
                          if (activeCustom === c.id) setActiveCustom(null);
                          bump();
                        }}
                      >
                        삭제
                      </button>
                    </span>
                  </div>
                  <div className="row spread small muted">
                    <span>{n}/{FULL} 샘플</span>
                    <button
                      className={`pill small ${capturing ? 'primary' : ''}`}
                      disabled={status !== 'ready'}
                      onClick={() => setActiveCustom(capturing ? null : c.id)}
                    >
                      {capturing ? '캡처 중지' : n >= FULL ? '다시 캡처' : '샘플 캡처'}
                    </button>
                  </div>
                  <Bar value={Math.min(1, n / FULL)} tone={n >= FULL ? 'good' : n >= MIN ? 'accent' : 'warn'} />
                </div>
              );
            })}

            <div className="row wrap" style={{ gap: 6 }}>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="새 포즈 이름 (예: 따봉)"
                style={{ flex: 1, minWidth: 110 }}
              />
              <select value={newEmits} onChange={(e) => setNewEmits(Number(e.target.value) as CustomPose['emits'])} style={{ width: 106 }}>
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
              <button className="primary" disabled={!allEnrolled} onClick={() => { setActiveCustom(null); setPhase('train'); }}>
                다음: 학습
              </button>
            </div>
          </>
        )}

        {phase === 'train' && (
          <>
            <p className="muted small" style={{ margin: 0 }}>
              기본 6포즈{customList.length ? ` + 커스텀 ${customList.length}개` : ''}를 작은 신경망에 몇 초간 학습시킵니다. 전부 브라우저에서 실행됩니다.
            </p>
            {training && (
              <div className="col" style={{ gap: 4 }}>
                <Bar value={trainProg} />
                <span className="muted small center">학습 중… {Math.round(trainProg * 100)}%</span>
              </div>
            )}
            {trainResult &&
              (trainResult.ok ? (
                <div className="col center" style={{ gap: 6, padding: '10px 0' }}>
                  <div style={{ fontSize: 34 }}>✓</div>
                  <div style={{ fontWeight: 800 }}>학습 완료</div>
                  <div className="muted small">학습 정확도 {Math.round(trainResult.accuracy * 100)}% · 이제 학습된 신경망으로 인식합니다.</div>
                </div>
              ) : (
                <div className="small center" style={{ color: 'var(--bad)' }}>{trainResult.reason ?? '학습 실패'}</div>
              ))}
            <div className="row wrap" style={{ gap: 6 }}>
              <button onClick={() => setPhase('custom')} disabled={training}>
                이전
              </button>
              <span className="grow" />
              {trainResult?.ok ? (
                <button className="good" onClick={onClose}>
                  완료
                </button>
              ) : (
                <button className="primary" onClick={runTrain} disabled={training}>
                  {training ? '학습 중…' : calibrationTrained() ? '다시 학습' : '학습 시작'}
                </button>
              )}
            </div>
          </>
        )}

        <div className="row spread small muted" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          <span>
            기본 {doneCount}/6 학습됨
            {customList.length ? ` · 커스텀 ${customList.filter((c) => customSampleCount(c.id) >= FULL).length}/${customList.length}` : ''}
            {calibrationTrained() ? ' · 신경망 적용됨' : allEnrolled ? ' · 학습 대기' : ''}
          </span>
          <button
            className="ghost small"
            onClick={() => {
              clearAllCalibration();
              armedRef.current = true;
              setStep(0);
              setPhase('enroll');
              setTrainResult(null);
              setActiveCustom(null);
              bump();
            }}
          >
            전체 초기화
          </button>
        </div>
      </div>
  );
}

/** circular "hold to fill" sample counter. */
function CaptureRing({ count, total }: { count: number; total: number }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, count / total);
  const done = count >= total;
  return (
    <div style={{ position: 'relative', width: 72, height: 72, flex: '0 0 auto' }}>
      <svg viewBox="0 0 72 72" width="72" height="72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--line)" strokeWidth="7" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke={done ? 'var(--good)' : 'var(--accent)'}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          transform="rotate(-90 36 36)"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 800,
          fontSize: 13,
          color: done ? 'var(--good)' : 'var(--text)',
        }}
      >
        {done ? '완료' : `${count}/${total}`}
      </div>
    </div>
  );
}
