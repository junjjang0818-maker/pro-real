# 4단계 · 손동작 인식 기본 제스처 + 오인식 방지

## 구현 상태

- [x] `fingerCounting.ts` — 21 랜드마크 → 확장 손가락 개수(0~5) + `usable` 게이트
- [x] `GestureController.ts` — 상태기계 `idle → arming → detecting → confirmed → cooldown` / `unavailable`
- [x] `gestureConfig.ts` — 튜닝 파라미터 전부 + 보수적 기본값
- [x] 권한 거부 / 카메라 없음 / 스로틀링 → 항상 버튼 폴백, 크래시·행 없음
- [ ] VisionCamera 프레임 프로세서에서 `HandObservation` 생산 — **디바이스 구현** (`native/ports.ts#CameraSource`)
- [ ] 확정 피드백(사운드/햅틱/전체화면) — `native/ports.ts#Haptics` + UI

## 오인식 방지 (다층 게이트)

`GestureConfig` (기본값):

| 파라미터 | 기본 | 역할 |
|---|---|---|
| `minConfidence` | 0.7 | 모델 presence 하한 |
| `minHandSpan` | 0.12 | 멀리 있는 작은 손 거부 |
| `holdDurationMs` | 600 | 제스처 유지 시간 |
| `framesForConfirm` | 6 | 연속 일치 프레임 수 |
| `cooldownMs` | 2500 | 확정 후 재인식 차단 |
| `maxBurstMs` | 4000 | 이 안에 확정 없으면 버튼 폴백 |
| `armingTimeoutMs` | 1200 | 카메라 첫 프레임 마감 (초과 = 스로틀링 의심) |
| `minAcceptableFps` | 8 | 지속 FPS 하한 |
| `distinctGestureDebounceMs` | 1200 | 확정 직후 다른 카운트 무시 (플리커 억제) |
| `openPalmMinFingers` | 4 | 편 손=시작 / 주먹=정지 임계 |

인식 파이프라인: `usable` 프레임만 후보 누적 → `framesForConfirm` 연속 일치 **AND** `holdDurationMs` 경과 → 확정 → `cooldownMs`.
- unusable 프레임(저 presence / 작은 손 / off-frame / NaN)은 후보 스트릭을 **끊음**.
- 카운트가 흔들리면(2↔3) 후보가 계속 리셋 → 확정 안 됨 → `maxBurstMs` 후 폴백.

## 카메라 수명주기 (배터리)

- **상시 스트리밍 안 함.** `attempt()` 호출 시에만 `camera.start()`, 확정/폴백/타임아웃 등 **모든 종료 경로**에서 `camera.stop()`.
- 버스트 예산 `maxBurstMs`(4초). 그 안에 못 잡으면 조용히 버튼으로.

## OS 스로틀링 감지 → 폴백 UI

`GestureController`가 `unavailable`을 방출하는 경우:

| 트리거 | fallbackReason | UI |
|---|---|---|
| `camera.start()` reject (권한) | `permission` | "카메라 권한이 필요해요" + 설정 링크 + 버튼 |
| `camera.start()` reject (장치 없음) | `no-camera` | 버튼 전용 모드 |
| 첫 프레임이 `armingTimeoutMs` 내 안 옴 | `timeout` | "카메라가 응답하지 않아요 — 버튼 사용" |
| Low Power Mode / thermal `serious`·`critical` / FPS < 하한 | `degraded` | "iOS가 배터리 보호로 카메라를 제한 중이에요 — 버튼을 쓰거나 충전 중 재시도" + `degradedLatched` |
| 버스트 내 미확정 | `no-gesture` | 조용히 버튼 (에러 아님) |

`degradedLatched` = 이후 `attempt()`는 즉시 폴백. `clearDegraded()`로 해제(사용자가 충전 중 재시도).

## 접근성 / 대체 입력

- 모든 제스처 동작에 **항상 화면에 보이는 버튼 등가물** (`App.tsx`).
- `attempt()` 결과가 `fallback`이면 UI는 아무것도 안 함 — 버튼이 이미 유일한 정상 경로.
- 확정도 `source: 'gesture'`로 `InputBus.emit()` → `intentToCommand` → 버튼과 **동일한 명령**.
- 음성(`@react-native-voice/voice`)도 같은 `InputBus`에 `source: 'voice'`로 얹으면 됨 (`intent.ts`에 경로 존재).

## 확장 (5단계로 이어짐)

- `attempt('count')` → 1~5 반환 → 과목 선택(`TAG_SUBJECT`) / 자기평가(`SET_RATING`).
- `Subject.gestureFingerCount`로 손가락 수 ↔ 과목 매핑.
