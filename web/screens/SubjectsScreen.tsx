import React, { useState } from 'react';
import { subjects } from '../appInstance';
import { Card, Field, Tag } from '../ui';

const COLORS = ['#e0685f', '#6ea8fe', '#4ec9a5', '#e0a54a', '#b98cff'];

export function SubjectsScreen() {
  const list = subjects.all();
  const [label, setLabel] = useState('');
  const [targetH, setTargetH] = useState(5);
  const usedFingers = new Set(list.filter((s) => s.archivedAt == null && s.gestureFingerCount).map((s) => s.gestureFingerCount));
  const nextFinger = ([1, 2, 3, 4, 5] as const).find((n) => !usedFingers.has(n)) ?? null;

  return (
    <div>
      <div className="h1">과목</div>

      <Card title="새 과목">
        <div className="col" style={{ gap: 10 }}>
          <Field label="이름">
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="예: 과학" />
          </Field>
          <Field label={`주간 목표시간: ${targetH}시간`}>
            <input type="range" min={1} max={30} value={targetH} onChange={(e) => setTargetH(Number(e.target.value))} />
          </Field>
          <div className="row spread">
            <span className="muted small">
              제스처 손가락 {nextFinger ? `#${nextFinger} 자동 배정` : '(5개 모두 사용 중 — 버튼 전용)'}
            </span>
            <button
              className="primary"
              disabled={!label.trim()}
              onClick={() => {
                subjects.add({
                  label: label.trim(),
                  colorToken: COLORS[list.length % COLORS.length]!,
                  weeklyTargetMs: targetH * 3600_000,
                  gestureFingerCount: nextFinger,
                });
                setLabel('');
              }}
            >
              추가
            </button>
          </div>
        </div>
      </Card>

      <Card title={`과목 ${list.filter((s) => !s.archivedAt).length}개`}>
        {list.map((s) => (
          <div
            key={s.id}
            className="row spread"
            style={{ padding: '9px 0', borderBottom: '1px solid var(--line)', opacity: s.archivedAt ? 0.4 : 1 }}
          >
            <span className="row" style={{ gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: s.colorToken, display: 'inline-block' }} />
              <strong>{s.label}</strong>
              {s.gestureFingerCount && <Tag>손가락 {s.gestureFingerCount}</Tag>}
            </span>
            <span className="row" style={{ gap: 10 }}>
              <span className="muted small">{Math.round(s.weeklyTargetMs / 3600_000)}시간/주</span>
              {!s.archivedAt && (
                <button className="ghost small" onClick={() => subjects.archive(s.id)}>
                  보관
                </button>
              )}
            </span>
          </div>
        ))}
      </Card>

      <p className="muted small">
        참고: 과목 데이터는 웹 데모에서 별도 스토어로 관리합니다(코어 <span className="kbd">Persistence</span>에 아직 편입 안 됨). 세션·출석·통계는 단일 소스에서 파생됩니다.
      </p>
    </div>
  );
}
