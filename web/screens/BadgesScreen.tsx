import React, { useMemo, useState } from 'react';
import { app, subjects, getSettings } from '../appInstance';
import { Card, Bar, Tag } from '../ui';
import { hm } from '../hooks';
import { DEFAULT_BADGE_RULES, deriveBadgeMetrics, evaluateBadges } from '@app/core/derivations/badges';
import { computeStreak } from '@app/core/derivations/streak';
import { computeSubjectStats } from '@app/core/derivations/subjectStats';
import { decideNotification } from '@app/features/gamification/notificationThrottler';
import { renderShareCard } from '../shareCard';

export function BadgesScreen() {
  const sessions = [...app.store.getSessions()];
  const attendance = app.store.attendance();
  const today = app.store.today();
  const streak = computeStreak({ attendance, today, freezeConfig: getSettings().freeze });
  const ctx = { sessions, attendance, streak };
  const metrics = deriveBadgeMetrics(ctx);
  const awarded = app.store.awardedBadges();
  const evalResult = useMemo(() => evaluateBadges(ctx, awarded), [sessions.length, streak.current, awarded.size]);

  const [cardUrl, setCardUrl] = useState<string | null>(null);

  const makeCard = () => {
    const todayRow = attendance.find((a) => a.localDate === today);
    const stats = computeSubjectStats({ sessions, subjects: subjects.active(), today, windowDays: 7, now: app.clock.now() });
    const top = [...stats].sort((a, b) => b.actualMs - a.actualMs)[0];
    setCardUrl(
      renderShareCard({
        dateLabel: today,
        studiedMs: todayRow?.countedMs ?? 0,
        goalMs: app.store.getConfig().dailyGoalMs,
        attended: !!todayRow?.attended,
        streakDays: streak.current,
        topSubject: top && top.actualMs > 0 ? top.label : null,
        noTouchMs: metrics.noTouchCountedMs,
      }),
    );
  };

  // demonstrate the throttler decision for the currently-pending badges
  const throttle = decideNotification({
    nowWall: app.clock.now().wall,
    tzOffsetMin: app.clock.now().tzOffsetMin,
    pendingBadgeIds: evalResult.newlyAwarded.map((b) => b.id),
    history: [],
  }, getSettings().throttler);

  return (
    <div>
      <div className="h1">뱃지</div>

      <Card title="진행 상황">
        <Line label="완료 세션" v={`${metrics.completedCount}회`} />
        <Line label="제스처로 시작" v={`${metrics.gestureStartedCount}회`} />
        <Line label="화면 안 만진 누적" v={hm(metrics.noTouchCountedMs)} />
        <Line label="출석한 날" v={`${metrics.daysGoalHit}일`} />
        <Line label="현재 연속" v={`${streak.current}일`} />
      </Card>

      <Card
        title="공유 카드"
        right={
          <button className="pill" onClick={makeCard}>
            오늘 요약 생성
          </button>
        }
      >
        {cardUrl ? (
          <div className="col" style={{ gap: 8 }}>
            <img src={cardUrl} alt="요약 카드" style={{ width: '100%', borderRadius: 12 }} />
            <a href={cardUrl} download={`study-${today}.png`}>
              <button className="primary">PNG 저장</button>
            </a>
          </div>
        ) : (
          <span className="muted small">세션 요약을 이미지 카드로 자동 생성합니다.</span>
        )}
      </Card>

      <Card title={`획득 ${[...evalResult.awardedNow].length} / ${DEFAULT_BADGE_RULES.length}`}>
        <div className="badge-grid">
          {DEFAULT_BADGE_RULES.map((r) => {
            const has = evalResult.awardedNow.has(r.id);
            const isNew = evalResult.newlyAwarded.some((b) => b.id === r.id);
            return (
              <div key={r.id} className={`badge ${has ? '' : 'locked'}`}>
                <div className="b-title">
                  {has ? '🏅 ' : '🔒 '}
                  {r.title}
                </div>
                <div className="muted small" style={{ marginTop: 4 }}>
                  {r.description}
                </div>
                {isNew && <Tag tone="on">방금 획득</Tag>}
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="알림 스로틀러">
        <div className="small muted">
          현재 대기 중인 새 뱃지 {evalResult.newlyAwarded.length}개에 대한 결정:{' '}
          <strong style={{ color: 'var(--text)' }}>
            {throttle.action === 'send'
              ? `발송 — "${'title' in throttle ? throttle.title : ''}"`
              : throttle.action === 'batch-into-recent'
                ? '최근 알림에 합침'
                : `보류 (${'reason' in throttle ? throttle.reason : ''})`}
          </strong>
        </div>
        <div className="small muted" style={{ marginTop: 4 }}>
          일일 최대 {getSettings().throttler.maxPerDay}회 · 최소 간격 {Math.round(getSettings().throttler.minGapMs / 3600000)}시간 · 근접 뱃지는 하나로 배치
        </div>
      </Card>
    </div>
  );
}

function Line({ label, v }: { label: string; v: string }) {
  return (
    <div className="row spread" style={{ padding: '4px 0' }}>
      <span className="muted small">{label}</span>
      <strong className="small">{v}</strong>
    </div>
  );
}
