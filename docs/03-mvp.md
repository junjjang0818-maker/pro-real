# 3단계 · MVP (기본 타이머 + 백그라운드 유지 + 출석 뼈대)

## 범위

- [x] `core/time` — clock 추상화(wall/monotonic/bootId), 하루 귀속 로직
- [x] `core/session` — reducer(단일 write path), 절대시각 elapsed 계산, 강제종료 복구
- [x] `core/derivations` — attendance, streak (freeze 포함)
- [x] `core/store` — SessionStore: dispatch + 파생 + 영속화 포트 + heartbeat + 복구 API
- [x] `input` — InputBus + intentToCommand (버튼/제스처/음성 단일 경로)
- [x] `native/kvPersistence` — MMKV류 KV 백엔드 Persistence 구현
- [x] `App.tsx` — 타이머 화면(시작/정지/일시정지), 출석 스트립, 제스처 버튼(폴백)
- [ ] Android FGS 알림 / iOS Live Activity — `native/ports.ts#ForegroundTimer` 인터페이스만. **디바이스 구현 필요**
- [ ] SQLite 세션 로그 — 지금은 KV(JSON). 데이터 늘면 `op-sqlite`로 교체 (Persistence 인터페이스 유지)

## 백그라운드 타이머 설계

- `computeElapsed(session, now)`는 **항상 순수함수**. `countedMs = (endWall ?? now.wall) - start.wall - Σ pause`.
- `App.tsx`의 `setInterval(250ms)`는 **리렌더만** 유발, 카운터에 더하지 않음 → 30분 백그라운드 갭·0틱이어도 정확.
- `clockAnomaly`: 실행 중 + 같은 boot에서 `|wallΔ − monoΔ| > 5s`면 monotonic 채택.
- 스냅샷: 모든 전이 + `store.heartbeat()`(15초)마다 KV에 동기 기록.

### iOS 백그라운드 — 할 수 있는 것 / 없는 것

| | 가능 | 방법 |
|---|---|---|
| 포그라운드 실시간 갱신 | O | JS 타이머 |
| 잠금화면 실시간 틱 | O(제한적) | **Live Activity** `Text(timerInterval:)` — 클라이언트가 안 깨우고 틱. Swift 위젯 익스텐션 필요 |
| 목표/종료 시각 알림 | O | 예약 로컬 알림 (예약 시점에 `start + plannedMs` 계산) |
| 임의 주기 백그라운드 코드 실행 | X | `BGTaskScheduler`는 기회성. 정확 타이밍 불가 |
| 앱 복귀 시 정확 동기화 | O | 타임스탬프 재계산 + 알림 재예약 (`App.syncOnForeground()`) |

### Android 백그라운드

- `notifee` foreground service + 알림에 경과/잔여를 타임스탬프로 계산해 10~30초마다 갱신.
- Android 14+ `foregroundServiceType` 필요 — `specialUse`(Play Console 문구) 또는 스코프 축소.

## 강제 종료 복구 (`core/session/recovery.ts`)

콜드 스타트에서 `store.inspectRecovery()`:

| 마지막 heartbeat 경과 | 결과 | 처리 |
|---|---|---|
| ≤ 90초 | `resumed` | 원래 start부터 계속 계산, 자동 |
| 90초 ~ 12시간 | `needs-confirmation` | UI가 "N분짜리 세션이 진행 중이었어요 — 유지 / heartbeat 시점 종료 / 폐기" |
| ≥ 12시간 | `auto-finalized` | `endWall = lastHeartbeat`, `status='recovered'`, 자동 |
| 시계가 뒤로 감 | `needs-confirmation` | 조용한 확정 금지 |

**절대 "지금 시각"으로 종료하지 않음** — 보수적으로 항상 `lastHeartbeat.wall`.

## 실행

```bash
npm install          # 현재는 테스트 도구만 (vitest, typescript)
npm test             # 168개 유닛 테스트
npm run typecheck
```

### 디바이스 빌드로 넘어갈 때 (macOS + Xcode / Android SDK)

1. `package.json`의 `appDependencies`를 `dependencies`로 승격 후 `npm install`.
2. `npx expo prebuild` → `npx expo run:ios` / `run:android` (Dev Client).
3. `App.tsx`의 stub 3개를 실제 어댑터로 교체:
   - `noopCameraSource` → VisionCamera + Hand Landmarker 프레임 프로세서
   - `foregroundTimerStub` → notifee FGS / Live Activity
   - `clockBridgeStub` → 네이티브 monotonic + bootId TurboModule
