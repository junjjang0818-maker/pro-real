# 7단계 · 리스크 & 테스트 시나리오

168개 유닛 테스트 통과 (`npm test`). 아래는 브리핑이 지정한 8개 오류 케이스별
**구체 시나리오**와, 유닛으로는 못 잡고 실기기에서 해야 하는 항목.

---

## 오류 케이스 ↔ 자동 테스트 매핑

### 1. 오인식 (제스처)

`src/features/gesture/fingerCounting.test.ts`, `GestureController.test.ts`

| 시나리오 | 기대 |
|---|---|
| presence 0.4 프레임 | `usable=false`, 후보 누적 안 됨 |
| 손이 너무 작음(scale 0.3) | `reason='hand-too-small'` |
| 랜드마크 off-frame / NaN | `usable=false` |
| 유지 시간 미달(3프레임 후 정지) | 확정 안 됨 → `fallback:'no-gesture'` |
| 카운트 플리커(2↔3 20회) | 확정 안 됨 → `fallback:'no-gesture'` |
| 확정 직후 재시도 | `fallback:'cooldown'`, `cooldownMs` 경과 후 정상 |
| 정상(안정 8프레임/700ms, ≥8fps) | `confirmed`, 카메라 stop 1회 |

**실기기 추가:** 다양한 조명/배경/손 크기/장갑에서 오인식률 측정, `holdDurationMs`·`framesForConfirm`·`minHandSpan` 튜닝. 목표: 오인식(FP) < 1%, 미인식(FN)은 폴백으로 흡수되므로 상대적으로 관대.

### 2. 백그라운드 타이머 오차

`src/core/session/elapsed.test.ts`

| 시나리오 | 기대 |
|---|---|
| 40분 경과, JS 틱 0회 | `countedMs === 40분` 정확 |
| `computeElapsed` 반복 호출 | 값 드리프트 0 (idempotent) |
| pause 구간 포함 | gross − pause 정확 |
| 지금 pause 상태 | pausedAt에서 누적 멈춤 |

**실기기 추가:** 앱 백그라운드 30분+ 후 복귀 시 표시 시간 오차 < 1초, 기내모드/절전에서도 동일.

### 3. iOS 강제 종료 (메모리 축출)

`src/core/session/recovery.test.ts`, `src/core/store.test.ts`

| 시나리오 | 기대 |
|---|---|
| heartbeat 30초 전 | `resumed`, 원래 start부터 계속 |
| heartbeat 40분 전 | `needs-confirmation`, `suggestedEndWall = lastHeartbeat`(NOT now) |
| heartbeat 13시간 전 | `auto-finalized`, `status='recovered'`, `endWall=lastHeartbeat` |
| 시계가 heartbeat보다 뒤로 | `needs-confirmation` (조용한 확정 금지) |
| 복구 후 열린 pause | 자동 닫힘 |
| store: START→heartbeat→(새 store 인스턴스로 재기동) | 스냅샷에서 세션 복구, 확정 후 attendance 반영 |

**실기기 추가:** Xcode에서 `SIGKILL` 시뮬레이트 또는 메모리 압박 유도 후 재실행. Android task-swipe kill도 동일 경로.

### 4. 자정 경계

`src/core/time/dayAttribution.test.ts`, `derivations/attendance.test.ts`, `store.test.ts`

| 시나리오 | 기대 |
|---|---|
| 23:30 시작 → 01:00 종료 | 전체가 **시작일**로 귀속, `crossedMidnight=true` |
| 정확히 로컬 자정의 인스턴트 | 날짜 경계 정확 (off-by-one 없음) |
| store: 23:40 시작 → 00:20 정지 | `attendance` 1건, 시작일에 40분 |

### 5. 카메라 권한 거부

`src/features/gesture/GestureController.test.ts`, `src/app/wiring.test.ts`

| 시나리오 | 기대 |
|---|---|
| `start()` reject('permission') | `fallback:'permission'`, state `unavailable`, **promise reject 안 함** |
| `start()` reject('no-camera') | `fallback:'no-camera'` |
| 알 수 없는 에러 | `fallback:'error'` (throw 아님) |
| wiring: 제스처 폴백 후 버튼 emit | 세션 정상 생성 (버튼 경로 무영향) |

**실기기 추가:** 설정에서 권한 회수 후 앱 동작 — 크래시/행 없이 버튼 모드. 최초 실행 시 권한 프롬프트 거부 → 동일.

### 6. 배터리 스로틀링 / 발열

`src/features/gesture/GestureController.test.ts`

| 시나리오 | 기대 |
|---|---|
| `armingTimeoutMs` 내 첫 프레임 없음 | `fallback:'timeout'`, state `unavailable` |
| Low Power Mode 신호 | `fallback:'degraded'`, `degradedLatched=true` |
| thermal `critical` 신호 | `fallback:'degraded'` |
| 4프레임/900ms (~3.3fps) | FPS 워치독 → `degraded` |
| degraded 상태에서 재시도 | 즉시 `fallback:'degraded'`, `clearDegraded()`로 해제 |

**실기기 추가:** 저전력 모드 ON / 기기 가열(벤치 앱 병행) 상태에서 제스처 시도 → 폴백 UI 노출 확인. `ProcessInfo.thermalState` 변화 구독 검증.

### 7. AI 데이터 부족 / API 실패

`src/core/analysis/facts.test.ts`, `client.test.ts`, `templateFallback.test.ts`

| 시나리오 | 기대 |
|---|---|
| 설치 < 3일 (세션 10개여도) | `collecting: 'too-new'`, LLM 미호출 |
| 3일치 미만 distinct days | `collecting: 'not-enough-days'` |
| 3일 O, 세션 < 5 | `collecting: 'not-enough-sessions'` |
| 정상 → 백엔드 성공 | `fresh` + 캐시 기록, 원시 타임스탬프 미포함 검증 |
| 네트워크 실패 + 캐시 O | `stale` + `error:'offline'` + 캐시 코멘트 |
| 타임아웃(주입 20ms) + 캐시 X | `fallback-only` + `error:'timeout'` + 템플릿 코멘트 |
| 타임아웃 + 캐시 O | `stale` (템플릿 아님) |
| 서버 500 + 캐시 X | `fallback-only` + `error:'server'` |

**실기기/통합 추가:** 실제 프록시에 지연/500/타임아웃 주입, 오프라인 토글. 캐시 TTL·백오프 동작.

### 8. 데이터 불일치 (타이머 vs 출석)

`src/core/store.test.ts` — `데이터 불일치 방지` 그룹

| 시나리오 | 기대 |
|---|---|
| START→70분→STOP | attendance/streak/subjectStats **동시** 반영, 저장된 세션 리스트로 독립 재계산해도 일치 |
| 실행 중(61분 경과) | attendance가 이미 `attended:true`, streak 1 — "타이머 도는데 출석 안 찍힘" 불가 |
| 거부된 명령(중복 START) | 저장 상태 바이트 단위로 불변 |
| 같은 시나리오를 gesture vs button | attendance/streak 동일 (source 무관) |
| badge 지급 | 재-dispatch 시 `first-session` 재지급 안 됨 |

---

## 단계별 리스크

| 단계 | 주요 리스크 | 완화 |
|---|---|---|
| MVP(3) | iOS 백그라운드 정확도 기대치 | 문서로 한계 명시, Live Activity + 복귀 재동기화. KV JSON이 세션 수천 개에서 느려짐 → `op-sqlite` 교체 트리거 정의 |
| 제스처(2/4) | `react-native-mediapipe` 유지보수 불확실 | 2일 스파이크 선행, `fast-tflite` 폴백 경로 확보. FPS/발열은 버스트-only로 완화 |
| 확장/AI(5) | LLM 비용·지연·헛소리 | 규칙 계산은 온디바이스, LLM은 코멘트만. 데이터 부족 가드. 템플릿 폴백 항상 존재 |
| 게이미피케이션(6) | 알림 피로, 중복 지급 | `NotificationThrottler` + 멱등 `evaluateBadges` (테스트로 고정) |
| 전반 | 프라이버시 | 카메라 프레임 절대 미전송(코드 경계 + CSP), `AnalysisFacts` 화이트리스트, 개인정보처리방침 초안 |

## CI

```bash
npm test          # 20 파일 / 168 테스트, ~6s
npm run typecheck # tsc --noEmit, strict
```
`src/**` 순수 로직만 CI 대상. `App.tsx`·네이티브 어댑터는 디바이스 빌드(Expo tsconfig)에서 별도 검증.
