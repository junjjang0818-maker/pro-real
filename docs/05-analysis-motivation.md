# 5단계 · 확장 제스처 + AI 분석 + 동기부여 문구

## 확장 제스처

- `GestureController.attempt('count')` → `usable` 프레임에서 1~5 확정 → `value` 반환.
- 세션 **시작 시**: 손가락 N개 → `Subject.gestureFingerCount === N`인 과목으로 `START` (자동 태그).
- 세션 **종료 시**: 손가락 1~5 → `STOP` 명령의 `focusSelfRating`.
- 매핑 실패(해당 손가락 수 과목 없음)면 폴백 → 과목 선택 시트.

## AI 학습 분석 (`src/core/analysis`)

### 규칙 기반 (온디바이스, `subjectStats.ts` + `facts.ts`)

과목별 7d/30d 윈도우: `targetMs`(주간목표를 윈도우로 스케일), `actualMs`, `deficitMs/Pct`, `daysSinceLastSession`, `consecutiveDaysMissed`. LLM 없이 계산.

### 데이터 부족 가드 (`buildAnalysisFacts`)

`distinctStudyDays ≥ 3` **AND** `totalSessions ≥ 5` **AND** `daysSinceInstall ≥ 3` 모두 충족해야 분석. 아니면:

```
{ status: 'collecting', reason: 'too-new' | 'not-enough-days' | 'not-enough-sessions',
  progress: {...}, needed: {...} }
```
→ UI는 "데이터가 더 모이면 분석해드릴게요" + 진행률. **LLM 호출 안 함.**

### 서버로 나가는 데이터 = `AnalysisFacts` 뿐 (privacy-policy-draft.md와 동기화)

```
windowDays, locale, anonymousInstallId(랜덤 UUID), dailyGoalMinutes, streakCurrent,
subjects: [{ label(사용자 입력 문자열), targetMinutes, actualMinutes(일 버킷 합, 분 반올림),
             lastSessionDaysAgo, missedDayCount }]
```
**안 나가는 것:** 카메라 프레임(영원히), 원시 세션 시작/종료 시각, 위치, 연락처, 기기 식별자, 자유서술 메모.

### 실패/지연 처리 (`client.ts` `getAnalysis`)

| 상황 | 반환 | UI |
|---|---|---|
| 데이터 부족 | `collecting` | 안내 문구, LLM 미호출 |
| 성공 | `fresh` | 코멘트 + 캐시 기록 |
| 네트워크 실패 + 캐시 있음 | `stale` (`error: 'offline'`) | 캐시 코멘트 + "마지막 분석: N일 전" + "지금은 새로고침 불가" 칩 |
| 타임아웃(기본 6초) + 캐시 있음 | `stale` (`error: 'timeout'`) | 동일 |
| 실패 + 캐시 없음 | `fallback-only` | 온디바이스 템플릿 코멘트(`templateFallback.ts`, 결정론적) |

화면 안 막음, 무한 스피너 없음, 지수 백오프.

## 동기부여 문구 (`src/features/motivation/quotes.ts`)

- `builtin` — 번들 명언, **날짜로 결정론적 로테이션** (하루 안엔 고정, 로컬 자정에 교체).
- `data-driven` — 스트릭/부족 과목 보간. `distinctStudyDays < 3`이면 억제(같은 가드 정신).
- `user-goal` — 사용자가 입력한 목표 문장.
- 사용자가 소스 on/off. `quotePool()`은 **절대 비지 않음**(전부 꺼도 builtin 1개).
