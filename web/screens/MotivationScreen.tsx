import React from 'react';
import { app, subjects, getSettings, updateSettings, installDate } from '../appInstance';
import { Card, Toggle } from '../ui';
import { computeStreak } from '@app/core/derivations/streak';
import { computeSubjectStats } from '@app/core/derivations/subjectStats';
import { pickQuote, quotePool, type QuoteContext } from '@app/features/motivation/quotes';

export function MotivationScreen() {
  const s = getSettings();
  const today = app.store.today();
  const sessions = [...app.store.getSessions()];
  const distinctStudyDays = new Set(sessions.filter((x) => x.status === 'completed' || x.status === 'recovered').map((x) => x.attributedLocalDate)).size;

  const ctx: QuoteContext = {
    today,
    installDate,
    streak: computeStreak({ attendance: app.store.attendance(), today, freezeConfig: s.freeze }),
    subjectStats: computeSubjectStats({ sessions, subjects: subjects.active(), today, windowDays: 7, now: app.clock.now() }),
    userGoals: s.userGoals,
    sources: s.quoteSources,
    distinctStudyDays,
  };

  const quote = pickQuote(ctx);
  const pool = quotePool(ctx);

  return (
    <div>
      <div className="h1">동기부여</div>

      <Card>
        <div className="center col" style={{ gap: 8, padding: '10px 0' }}>
          <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.5 }}>“{quote.text}”</div>
          <div className="muted small">
            {quote.source === 'builtin' ? `명언${quote.author ? ` · ${quote.author}` : ''}` : quote.source === 'data-driven' ? '학습 데이터 기반' : '내 목표'}
          </div>
        </div>
      </Card>

      <Card title="표시할 소스">
        <div className="col" style={{ gap: 8 }}>
          <Toggle label="명언 로테이션 (하루 고정)" checked={s.quoteSources.builtin} onChange={(b) => updateSettings({ quoteSources: { ...s.quoteSources, builtin: b } })} />
          <Toggle label="학습 데이터 기반 (스트릭·부족 과목)" checked={s.quoteSources.dataDriven} onChange={(b) => updateSettings({ quoteSources: { ...s.quoteSources, dataDriven: b } })} />
          <Toggle label="내가 등록한 목표 문장" checked={s.quoteSources.userGoal} onChange={(b) => updateSettings({ quoteSources: { ...s.quoteSources, userGoal: b } })} />
        </div>
        {distinctStudyDays < 3 && (
          <p className="muted small" style={{ marginBottom: 0 }}>
            데이터 기반 문구는 학습 3일 이상 모이면 나타납니다 (현재 {distinctStudyDays}일).
          </p>
        )}
      </Card>

      <Card title="내 목표 문장">
        <div className="col" style={{ gap: 6 }}>
          {s.userGoals.map((g, i) => (
            <div key={i} className="row spread">
              <span className="small">{g}</span>
              <button className="ghost small" onClick={() => updateSettings({ userGoals: s.userGoals.filter((_, j) => j !== i) })}>
                삭제
              </button>
            </div>
          ))}
          <GoalAdder onAdd={(g) => updateSettings({ userGoals: [...s.userGoals, g] })} />
        </div>
      </Card>

      <Card title={`오늘의 후보 (${pool.length})`}>
        {pool.map((q, i) => (
          <div key={i} className="small" style={{ padding: '4px 0', color: 'var(--muted)' }}>
            • {q.text}
          </div>
        ))}
      </Card>
    </div>
  );
}

function GoalAdder({ onAdd }: { onAdd: (g: string) => void }) {
  const [v, setV] = React.useState('');
  return (
    <div className="row" style={{ gap: 6 }}>
      <input type="text" value={v} onChange={(e) => setV(e.target.value)} placeholder="새 목표 문장" />
      <button
        disabled={!v.trim()}
        onClick={() => {
          onAdd(v.trim());
          setV('');
        }}
      >
        추가
      </button>
    </div>
  );
}
