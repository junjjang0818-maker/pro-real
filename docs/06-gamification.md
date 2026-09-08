# 6단계 · 게이미피케이션

## 뱃지 (`src/core/derivations/badges.ts`)

- 세션 전이마다 `evaluateBadges(ctx, alreadyAwarded)` — **순수 파생**.
- `newlyAwarded = 현재 자격 충족 − 이미 지급` (id 키 집합).
- **중복 지급 불가:** 이미 지급된 id는 union으로 유지되어 재방출 안 됨. 지표가 임계 아래로 내려가도(스트릭 붕괴) **회수 안 함, 재지급 안 함** — `badges.test.ts`에서 검증.
- 기본 규칙: `first-session`, `streak-3/7/30`, `notouch-60m/10h`(화면 안 만진 세션 시간 누적), `gesture-10`, `early-bird-5`.
- "화면 안 만짐" 판정: `Session.screenTouchedDuringSession` — 실행 중 아무 탭이나 발생 시 `MARK_SCREEN_TOUCHED`로 `true`. 제스처 시작은 `false`로 출발.

## 알림 피로 억제 (`src/features/gamification/notificationThrottler.ts`)

`decideNotification(req, cfg)` — 결정론적. 반환: `send` / `batch-into-recent` / `defer`.

| 규칙 | 기본값 |
|---|---|
| 하루 최대 축하 알림 | 2 (로컬 날짜 기준) |
| 최소 간격 | 3시간 |
| 배치 창 | 90초 (이 안의 연속 획득은 한 장으로) |
| 방해 금지 시간 | 22:00–08:00 (defer, drop 아님) |

- 근접 획득 → `batch-into-recent` (새 푸시 없이 기존 것에 병합).
- 다중 뱃지 → "뱃지 N개를 획득했어요!" 한 장.
- `defer`는 `retryAtWall` 제공 (스토어가 재시도 예약).

## 공유 카드

- 세션 요약을 오프스크린 React 뷰로 렌더 → `react-native-view-shot` → PNG → 공유 시트.
- **자동 푸시 아님**, 사용자가 "공유" 눌렀을 때만 생성.
- 포함: 날짜, 과목, 집중 시간, 스트릭, 자기평가. 개인 식별정보 없음.

## 화면 안 만진 시간 / 스트릭 기준 뱃지

`DerivedBadgeMetrics.noTouchCountedMs` = `screenTouchedDuringSession === false`인 완료 세션들의 `countedMs` 합. 누적값이라 한 번 넘으면 유지.
