# 2단계 · 데이터 모델 & 아키텍처

## 2.1 단일 진실 소스 (Single Source of Truth)

> 쓰기 가능한 저장소는 **`sessions`(질의용) + `session_events`(append-only)** 둘뿐.
> 출석·스트릭·과목통계·뱃지·AI 입력은 전부 이 리스트에서 **파생(derive)**.

버튼·제스처·음성 → `InputIntent` → **하나의 `SessionStore.dispatch(command)`** → `reduce()` → `sessions/events` 쓰기.

```
[버튼] [제스처] [음성] ──► InputBus ──► intentToCommand ──► SessionStore.dispatch
                                                                │  (유일한 write path)
                                                                ▼
                                              sessions[]  +  session_events[]
                                                                │  (pull-based, 순수)
                     ┌──────────────────────────────────────────┴───────────────────┐
              computeDailyAttendance   computeStreak   computeSubjectStats   evaluateBadges
                     └─ buildAnalysisFacts ─┘          └─ pickQuote ─┘
```

이 구조라 "타이머는 도는데 출석은 안 찍힘"이 **코드상 불가능** — `store.test.ts`의 `데이터 불일치 방지` 그룹에서 검증.

## 2.2 방식: 하이브리드

- `sessions` 행 = SQL 집계용 SoT.
- `session_events` = 전이마다 1줄. AI/분석 피드 + 복구 보조 + 미래 동기화/그룹공유 소스.
- 활성 세션은 MMKV에 **스냅샷**으로 (모든 전이 + 15초 heartbeat 시 동기 기록) → 프로세스 강제 종료 복구.
- UI는 `dispatch`만 호출하므로 나중에 완전 이벤트 소싱으로 교체해도 화면 코드 불변.

## 2.3 "하루"의 정의 (`src/core/time/dayAttribution.ts`)

- 세션은 **`start`의 로컬 캘린더 날짜**에 귀속. 시작 시점 타임존 오프셋(`start.tzOffsetMin`)을 세션에 저장.
- `dailyGoalMs`(기본 60분) 이상이면 그날 **출석**.
- **자정 넘긴 세션:** 전체가 시작 날짜로 귀속 (분할 안 함). `crossedMidnight` 플래그만 표시.
- **시간대 이동:** 과거 세션은 기록된 로컬 날짜 그대로. `tzOffsetMin`이 세션에 박혀 있어 소급 재계산 없음.
- **스트릭 보호:** `earnEveryNAttendedDays`(기본 7)당 freeze 1개(최대 2). 단일 결석일을 bridge. 여행으로 "없는 날"이 생겨도 일반 결석처럼 취급 → 최악의 경우 freeze 1개 소모, 조용한 붕괴 없음.
- **시계 조작/NTP:** 시작 시 `wall + monotonic + bootId` 저장. `|wallΔ − monoΔ| > 5s`면 `clockAnomaly` 플래그 + monotonic 신뢰. `endWall ≥ startWall` 클램프.

## 2.4 핵심 타입 (`src/core/session/types.ts`, `src/core/subjects.ts`)

- `ClockStamp { wall, monotonic, bootId, tzId, tzOffsetMin }`
- `Session { id, ownerId, subjectId, status, start: ClockStamp, endWall, plannedMs, pauses[], focusSelfRating, startSource, endSource, screenTouchedDuringSession, clockAnomaly, attributedLocalDate, ... }`
  - `status: 'running' | 'completed' | 'abandoned' | 'recovered'`
  - `ownerId: 'local'` — 그룹공유 확장 자리
- `SessionEvent { id, sessionId, type, at: ClockStamp, payload }` — append-only
- `ActiveSessionSnapshot { session, lastHeartbeat, snapshotVersion }` — MMKV
- `Subject { id, label, colorToken, gestureFingerCount: 1..5|null, weeklyTargetMs, archivedAt }` — `label`만 서버 전송

## 2.5 서브시스템 경계

| 시스템 | 모듈 | 타이머와의 관계 |
|---|---|---|
| B. 백그라운드 타이머 | `core/session/elapsed.ts` (순수 계산), `core/store.ts`, `native/ports.ts#ForegroundTimer` | `getElapsed()`는 타임스탬프의 순수함수. `setInterval`은 리렌더 트리거일 뿐 |
| A. 제스처 | `features/gesture/*` | 타이머 스토어 **직접 접근 금지**. `GestureController.attempt()` → 확정 시 `InputBus.emit()` (버튼과 동일 경로) |
| C. 출석 | `core/derivations/attendance.ts`, `streak.ts` | 순수 파생 |
| D. AI | `core/analysis/*` | 규칙 계산은 온디바이스, 코멘트만 LLM. `AnalysisFacts`만 전송 |
| E. 동기부여 | `features/motivation/quotes.ts` | 순수 파생 + 데이터 부족 가드 |
| F. 게이미피케이션 | `core/derivations/badges.ts`, `features/gamification/*` | 멱등 파생. `NotificationThrottler`로 알림 피로 억제 |

## 2.6 폴더 구조

```
src/
  core/
    time/         clock (wall+monotonic+bootId), dayAttribution (하루 정의)
    session/      types, reducer(단일 write path), elapsed, recovery
    derivations/  attendance, streak, subjectStats, badges  ← 전부 순수함수
    analysis/     facts(+데이터부족 가드), templateFallback, client(캐시/에러상태)
    subjects.ts
    store.ts      SessionStore — 단일 진실 소스 + 파생 + 영속화 포트
  input/          InputIntent, InputBus, intentToCommand
  features/
    gesture/      fingerCounting, GestureController(상태기계), gestureConfig
    motivation/   quotes
    gamification/ notificationThrottler
  native/         ports(인터페이스) + stubs + kvPersistence   ← 디바이스 구현 경계
  app/            wiring (composition root, 순수)
App.tsx           Expo 엔트리 (네이티브 스택 필요)
```
