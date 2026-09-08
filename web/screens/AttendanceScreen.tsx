import React from 'react';
import { app, getSettings } from '../appInstance';
import { Card, Tag } from '../ui';
import { hm } from '../hooks';
import { computeStreak } from '@app/core/derivations/streak';
import { addLocalDays } from '@app/core/time/dayAttribution';

const WEEKS = 10;

export function AttendanceScreen() {
  const today = app.store.today();
  const attendance = app.store.attendance();
  const byDate = new Map(attendance.map((a) => [a.localDate, a]));
  const streak = computeStreak({ attendance, today, freezeConfig: getSettings().freeze });
  const goalMs = app.store.getConfig().dailyGoalMs;

  // grid: WEEKS*7 cells ending today, week rows
  const start = addLocalDays(today, -(WEEKS * 7 - 1));
  const cells: { date: string; level: number; isToday: boolean; ms: number }[] = [];
  for (let i = 0; i < WEEKS * 7; i++) {
    const date = addLocalDays(start, i);
    const row = byDate.get(date);
    const ms = row?.countedMs ?? 0;
    const ratio = goalMs > 0 ? ms / goalMs : 0;
    const level = ms === 0 ? 0 : ratio >= 1 ? 4 : ratio >= 0.66 ? 3 : ratio >= 0.33 ? 2 : 1;
    cells.push({ date, level, isToday: date === today, ms });
  }

  return (
    <div>
      <div className="h1">출석</div>

      <Card>
        <div className="row spread">
          <div className="col" style={{ gap: 2 }}>
            <span className="muted small">현재 연속</span>
            <span className="clock" style={{ fontSize: 32 }}>
              {streak.current}일
            </span>
          </div>
          <div className="col" style={{ gap: 2, textAlign: 'right' }}>
            <span className="muted small">최장</span>
            <span className="clock" style={{ fontSize: 20 }}>
              {streak.longest}일
            </span>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
          <Tag>{streak.todayAttended ? '오늘 출석 완료' : '오늘 미완료'}</Tag>
          <Tag>보호권 {streak.freezesRemaining}/{streak.freezesEarned}</Tag>
          {streak.usedFreezeDates.length > 0 && <Tag tone="err">보호권 사용 {streak.usedFreezeDates.length}회</Tag>}
        </div>
      </Card>

      <Card title={`히트맵 · 최근 ${WEEKS}주`}>
        <div className="heat">
          {cells.map((c) => (
            <div
              key={c.date}
              className={`cell ${c.level ? `l${c.level}` : ''} ${c.isToday ? 'today' : ''}`}
              title={`${c.date} · ${hm(c.ms)}`}
            />
          ))}
        </div>
        <div className="row" style={{ gap: 6, marginTop: 10, alignItems: 'center' }}>
          <span className="muted small">적음</span>
          <span className="cell l1" style={{ width: 14, height: 14, borderRadius: 4, display: 'inline-block' }} />
          <span className="cell l2" style={{ width: 14, height: 14, borderRadius: 4, display: 'inline-block' }} />
          <span className="cell l3" style={{ width: 14, height: 14, borderRadius: 4, display: 'inline-block' }} />
          <span className="cell l4" style={{ width: 14, height: 14, borderRadius: 4, display: 'inline-block' }} />
          <span className="muted small">목표 달성</span>
        </div>
      </Card>

      <Card title="일별 기록">
        {attendance.length === 0 && <span className="muted small">아직 기록이 없습니다.</span>}
        {[...attendance].reverse().slice(0, 14).map((a) => (
          <div key={a.localDate} className="row spread" style={{ padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
            <span className="small">{a.localDate}{a.crossedMidnight ? ' · 자정 넘김' : ''}</span>
            <span className="row" style={{ gap: 8 }}>
              <span className="muted small">{hm(a.countedMs)}</span>
              {a.attended ? <Tag tone="on">출석</Tag> : <Tag>미달</Tag>}
            </span>
          </div>
        ))}
      </Card>
    </div>
  );
}
