import React, { useState } from 'react';
import { app, subjects } from '../appInstance';
import { Card, Bar, Tag } from '../ui';
import { hm } from '../hooks';
import { useAnalysis } from '../analysis';
import { computeSubjectStats, rankByDeficit } from '@app/core/derivations/subjectStats';

export function AnalysisScreen() {
  const [windowDays, setWindowDays] = useState<7 | 30>(7);
  const [nonce, setNonce] = useState(0);
  const { loading, state } = useAnalysis(windowDays, nonce);

  const stats = rankByDeficit(
    computeSubjectStats({
      sessions: [...app.store.getSessions()],
      subjects: subjects.active(),
      today: app.store.today(),
      windowDays,
      now: app.clock.now(),
    }),
  );

  return (
    <div>
      <div className="h1">AI 분석</div>

      <Card
        right={
          <div className="row" style={{ gap: 4 }}>
            {([7, 30] as const).map((w) => (
              <button key={w} className={`pill ${windowDays === w ? 'primary' : ''}`} onClick={() => setWindowDays(w)}>
                {w}일
              </button>
            ))}
            <button className="pill ghost" onClick={() => setNonce((n) => n + 1)}>
              새로고침
            </button>
          </div>
        }
      >
        {loading && <span className="muted small">분석 중…</span>}
        {!loading && state?.kind === 'collecting' && (
          <div className="col" style={{ gap: 8 }}>
            <strong>데이터가 더 모이면 분석해드릴게요</strong>
            <span className="muted small">
              사유: {reasonText(state.info.reason)}
            </span>
            <div className="col" style={{ gap: 4, marginTop: 4 }}>
              <ProgressLine label="학습한 날" have={state.info.progress.distinctStudyDays} need={state.info.needed.distinctStudyDays} />
              <ProgressLine label="세션 수" have={state.info.progress.totalSessions} need={state.info.needed.totalSessions} />
              <ProgressLine label="설치 후 경과일" have={state.info.progress.daysSinceInstall} need={state.info.needed.daysSinceInstall} />
            </div>
          </div>
        )}
        {!loading && state && state.kind !== 'collecting' && (
          <div className="col" style={{ gap: 8 }}>
            <p style={{ margin: 0 }}>{state.comment}</p>
            <div className="row wrap" style={{ gap: 6 }}>
              {state.kind === 'fresh' && <Tag tone="on">방금 생성 (LLM)</Tag>}
              {state.kind === 'stale' && <Tag tone="err">오프라인 · 마지막 분석 재사용 ({errText(state.error)})</Tag>}
              {state.kind === 'fallback-only' && <Tag>온디바이스 템플릿 ({errText(state.error)})</Tag>}
              {'generatedAtWall' in state && (
                <Tag>{new Date(state.generatedAtWall).toLocaleString('ko-KR')}</Tag>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card title={`과목별 목표 대비 (최근 ${windowDays}일)`}>
        {stats.length === 0 && <span className="muted small">과목이 없습니다.</span>}
        {stats.map((s) => {
          const ratio = s.targetMs > 0 ? s.actualMs / s.targetMs : 1;
          const tone = ratio >= 1 ? 'good' : ratio >= 0.6 ? 'warn' : 'bad';
          return (
            <div key={s.subjectId} className="col" style={{ gap: 4, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <div className="row spread small">
                <strong>{s.label}</strong>
                <span className="muted">
                  {hm(s.actualMs)} / {hm(s.targetMs)}
                  {s.deficitPct > 0 ? ` · ${Math.round(s.deficitPct * 100)}% 부족` : ' · 달성'}
                </span>
              </div>
              <Bar value={ratio} tone={tone} />
              <div className="row wrap" style={{ gap: 6 }}>
                {s.consecutiveDaysMissed >= 2 && <Tag tone="err">{s.consecutiveDaysMissed}일 연속 미학습</Tag>}
                {s.daysSinceLastSession != null && <Tag>마지막 {s.daysSinceLastSession}일 전</Tag>}
              </div>
            </div>
          );
        })}
      </Card>

      <p className="muted small">
        규칙 기반 계산은 전부 기기 내에서. 서버로는 집계된 <span className="kbd">AnalysisFacts</span>(과목 라벨·분 단위 시간·경과일)만 전송하며, 엔드포인트 미설정 시 위처럼 온디바이스 템플릿으로 대체됩니다.
      </p>
    </div>
  );
}

function ProgressLine({ label, have, need }: { label: string; have: number; need: number }) {
  return (
    <div className="col" style={{ gap: 3 }}>
      <div className="row spread small muted">
        <span>{label}</span>
        <span>
          {have} / {need}
        </span>
      </div>
      <Bar value={need > 0 ? have / need : 1} tone={have >= need ? 'good' : 'accent'} />
    </div>
  );
}

function reasonText(r: string): string {
  return { 'too-new': '설치 후 3일 미만', 'not-enough-days': '학습한 날이 3일 미만', 'not-enough-sessions': '세션이 5개 미만' }[r] ?? r;
}
function errText(e: string): string {
  return { offline: '오프라인', timeout: '응답 지연', server: '서버 오류' }[e] ?? e;
}
