import React, { useState } from 'react';
import { app, getSettings, updateSettings } from '../appInstance';
import { Card, NumberRow, Field, Toggle } from '../ui';
import { DEFAULT_GESTURE_CONFIG } from '@app/features/gesture/gestureConfig';
import { getAnalysisEndpoint, setAnalysisEndpoint } from '../analysis';
import { seedDemoData, resetDemoData } from '../seed';

function readLS(k: string): string {
  try {
    return localStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
}
function writeLS(k: string, v: string): void {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export function SettingsScreen() {
  const s = getSettings();
  const g = { ...DEFAULT_GESTURE_CONFIG, ...s.gestureOverrides };
  const cap = app.foregroundTimerCapabilities();
  const setG = (patch: Partial<typeof g>) => updateSettings({ gestureOverrides: { ...s.gestureOverrides, ...patch } });
  const [endpoint, setEndpoint] = useState(getAnalysisEndpoint() ?? '');
  const [modelUrl, setModelUrl] = useState(readLS('gst:gesture-model'));

  return (
    <div>
      <div className="h1">설정</div>

      <Card title="출석 / 스트릭">
        <NumberRow label="하루 목표 학습시간" suffix="분" min={10} max={240} step={5} value={s.dailyGoalMin} onChange={(v) => updateSettings({ dailyGoalMin: v })} />
        <NumberRow label="보호권 획득 주기 (출석 N일당 1개)" min={1} max={14} value={s.freeze.earnEveryNAttendedDays} onChange={(v) => updateSettings({ freeze: { ...s.freeze, earnEveryNAttendedDays: v } })} />
        <NumberRow label="보호권 최대 보유" min={0} max={5} value={s.freeze.maxFreezes} onChange={(v) => updateSettings({ freeze: { ...s.freeze, maxFreezes: v } })} />
      </Card>

      <Card title="제스처 인식 (오인식 방지 파라미터)">
        <div style={{ marginBottom: 10 }}>
          <Toggle
            label="제스처 시뮬레이션 (웹캠 없이 데모/테스트)"
            checked={s.gestureSim}
            onChange={(b) => updateSettings({ gestureSim: b })}
          />
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            켜면 카메라 대신 합성 프레임을 주입해 동일한 확정 로직(신뢰도·유지시간·프레임수·쿨다운)을 통과시킵니다.
          </p>
        </div>
        <NumberRow label="최소 신뢰도" min={0.4} max={0.95} step={0.05} value={g.minConfidence} onChange={(v) => setG({ minConfidence: v })} />
        <NumberRow label="유지 시간" suffix="ms" min={200} max={1500} step={50} value={g.holdDurationMs} onChange={(v) => setG({ holdDurationMs: v })} />
        <NumberRow label="확정 프레임 수" min={2} max={12} value={g.framesForConfirm} onChange={(v) => setG({ framesForConfirm: v })} />
        <NumberRow label="쿨다운" suffix="ms" min={500} max={6000} step={250} value={g.cooldownMs} onChange={(v) => setG({ cooldownMs: v })} />
        <NumberRow label="버스트 최대" suffix="ms" min={3000} max={20000} step={500} value={g.maxBurstMs} onChange={(v) => setG({ maxBurstMs: v })} />
        <NumberRow label="카메라 준비 타임아웃" suffix="ms" min={1000} max={15000} step={500} value={g.armingTimeoutMs} onChange={(v) => setG({ armingTimeoutMs: v })} />
        <NumberRow label="최소 손 크기 (정규화)" min={0.04} max={0.25} step={0.01} value={g.minHandSpan} onChange={(v) => setG({ minHandSpan: v })} />
        <div style={{ marginTop: 10 }}>
          <Field label="손 인식 모델 URL 재정의 (비우면 기본 MediaPipe 모델)">
            <input
              type="text"
              value={modelUrl}
              onChange={(e) => setModelUrl(e.target.value)}
              placeholder="예: /models/hand_landmarker.task 또는 사내 미러 URL"
            />
          </Field>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <button onClick={() => writeLS('gst:gesture-model', modelUrl.trim())}>저장</button>
            <button className="ghost" onClick={() => { setModelUrl(''); writeLS('gst:gesture-model', ''); }}>
              지우기
            </button>
          </div>
        </div>
        <p className="muted small" style={{ marginBottom: 0, marginTop: 8 }}>
          WASM 은 <span className="kbd">npm run web</span> 실행 시 <span className="kbd">node_modules</span> 에서 <span className="kbd">public/mediapipe/wasm</span> 로 복사돼 버전이 항상 일치합니다 (MediaPipe {typeof __MEDIAPIPE_VERSION__ !== 'undefined' ? __MEDIAPIPE_VERSION__ : '?'}). 로컬 실패 시 같은 버전 CDN 으로 폴백, GPU→CPU 델리게이트 순으로 재시도합니다. 그래도 실패하면 버튼으로 전환됩니다.
        </p>
      </Card>

      <Card title="알림 스로틀러">
        <NumberRow label="하루 최대 축하 알림" min={1} max={6} value={s.throttler.maxPerDay} onChange={(v) => updateSettings({ throttler: { ...s.throttler, maxPerDay: v } })} />
        <NumberRow label="최소 간격" suffix="시간" min={1} max={12} value={Math.round(s.throttler.minGapMs / 3600000)} onChange={(v) => updateSettings({ throttler: { ...s.throttler, minGapMs: v * 3600000 } })} />
        <NumberRow label="방해 금지 시작" suffix="시" min={0} max={23} value={Math.floor((s.throttler.quietHours?.startMinute ?? 1320) / 60)} onChange={(v) => updateSettings({ throttler: { ...s.throttler, quietHours: { startMinute: v * 60, endMinute: s.throttler.quietHours?.endMinute ?? 480 } } })} />
        <NumberRow label="방해 금지 종료" suffix="시" min={0} max={23} value={Math.floor((s.throttler.quietHours?.endMinute ?? 480) / 60)} onChange={(v) => updateSettings({ throttler: { ...s.throttler, quietHours: { startMinute: s.throttler.quietHours?.startMinute ?? 1320, endMinute: v * 60 } } })} />
      </Card>

      <Card title="AI 분석 백엔드">
        <Field label="엔드포인트 URL (비우면 온디바이스 템플릿 사용)">
          <input type="text" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://your-proxy.example/analyze" />
        </Field>
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <button onClick={() => setAnalysisEndpoint(endpoint.trim() || null)}>저장</button>
          <button className="ghost" onClick={() => { setEndpoint(''); setAnalysisEndpoint(null); }}>
            지우기
          </button>
        </div>
        <p className="muted small">POST 로 <span className="kbd">AnalysisFacts</span> JSON 전송 → <span className="kbd">{'{ comment: string }'}</span> 응답. 실패/지연 시 캐시 또는 템플릿으로 폴백.</p>
      </Card>

      <Card title="플랫폼 (솔직하게)">
        <p className="small muted" style={{ margin: 0 }}>
          웹 데모: 백그라운드 타이머 = 문서 제목 (liveTick {String(cap.liveTick)}, exactBackground {String(cap.exactBackground)}). {cap.note}
        </p>
        <p className="small muted">
          iOS 실기기에서는 "완벽한 실시간 백그라운드 갱신"이 불가능 — Live Activity + 로컬 알림 + 포그라운드 재동기화로 처리 (docs/07). Android 14+ 는 foreground service type 제약.
        </p>
      </Card>

      <Card title="데모 데이터">
        <div className="row wrap" style={{ gap: 8 }}>
          <button onClick={seedDemoData}>샘플 3주치 채우기</button>
          <button className="bad ghost" onClick={resetDemoData}>
            전체 초기화
          </button>
        </div>
      </Card>
    </div>
  );
}
