# 제스처 기반 학습 타이머

화면을 만지지 않고 손동작으로 조작하는 크로스플랫폼(iOS + Android) 학습 타이머.
핵심 차별점: **온디바이스 손동작 제어** + **실제 학습 데이터 기반 AI 피드백**.

## 현재 상태

**MVP 코어 로직 + 2~6단계 핵심 알고리즘 구현·테스트 완료 + 브라우저에서 도는 전체 UI 웹 데모.**
iOS/Android 네이티브 연동부(FGS 알림, Live Activity, monotonic clock 브리지)는
인터페이스 + stub 이며 macOS/Android SDK 환경에서 실제 어댑터로 교체하면 동작한다.

```bash
npm install
npm run web        # http://localhost:5173 — 타이머·출석·분석·제스처(웹캠+MediaPipe)·뱃지 전부 동작
npm test           # 20 파일 / 170 테스트
npm run typecheck  # tsc --noEmit (strict)
npm run build      # dist/ 정적 번들
```

웹 데모는 네이티브의 `GestureController`·`SessionStore`·파생 로직을 **그대로** 사용한다
(웹 전용 어댑터만 주입). 자세한 내용: [docs/08-web-demo.md](docs/08-web-demo.md).

## 설계 문서

| 문서 | 내용 |
|---|---|
| [docs/01-tech-stack.md](docs/01-tech-stack.md) | RN vs Flutter, 손 인식 라이브러리 비교와 추천 |
| [docs/02-architecture.md](docs/02-architecture.md) | 데이터 모델, 단일 진실 소스, "하루"의 정의 |
| [docs/03-mvp.md](docs/03-mvp.md) | 1단계: 타이머 + 백그라운드 유지 + 출석 뼈대 |
| [docs/04-gestures.md](docs/04-gestures.md) | 2단계: 기본 제스처 + 오인식 방지 |
| [docs/05-analysis-motivation.md](docs/05-analysis-motivation.md) | 3단계: 확장 제스처 + AI 분석 + 동기부여 |
| [docs/06-gamification.md](docs/06-gamification.md) | 4단계: 뱃지 + 알림 스로틀 + 공유 카드 |
| [docs/07-risks-and-tests.md](docs/07-risks-and-tests.md) | 오류 케이스 8종 ↔ 테스트 매핑, 단계별 리스크 |
| [docs/08-web-demo.md](docs/08-web-demo.md) | 웹 데모 실행법, 웹에서 동작/차이 나는 부분 |
| [docs/privacy-policy-draft.md](docs/privacy-policy-draft.md) | 전송 데이터 항목 명시 |

## 아키텍처 한 눈에

```
버튼 / 제스처 / 음성
        │  (전부 동일)
     InputBus ──► intentToCommand ──► SessionStore.dispatch ──► reduce()
        (유일한 write path)                      │
                                    sessions[] + session_events[]   ← 유일한 쓰기 상태
                                                │  (pull-based 순수 파생)
        ┌───────────────────┬───────────────────┼──────────────────┬─────────────┐
   attendance            streak          subjectStats           badges       AnalysisFacts
```

- **단일 진실 소스:** 세션·출석·통계·뱃지가 따로 갱신되지 않음. 전부 세션 리스트에서 파생 → "타이머는 도는데 출석은 안 찍힘" 이 구조적으로 불가능 ([store.test.ts](src/core/store.test.ts)).
- **절대시각 기반:** `computeElapsed()`는 타임스탬프의 순수함수. `setInterval` 누적 안 함 ([elapsed.ts](src/core/session/elapsed.ts)).
- **제스처는 격리:** `GestureController`는 타이머 스토어를 모름. 확정 시 버튼과 똑같이 `InputBus.emit()`.
- **네이티브 경계:** `src/core`, `src/features/*` 는 react-native 의존성 0 → Windows CI 에서 유닛 테스트. 디바이스 필요 코드는 `src/native/ports.ts` 인터페이스 뒤로.

## 디렉터리

```
src/
  core/time/         clock(wall+monotonic+bootId), dayAttribution(하루 정의)
  core/session/      types, reducer(단일 write path), elapsed, recovery
  core/derivations/  attendance, streak, subjectStats, badges  (순수)
  core/analysis/     facts(+데이터부족 가드), templateFallback, client(캐시/에러)
  core/store.ts      SessionStore
  input/             InputBus, intentToCommand
  features/gesture/  fingerCounting, GestureController, gestureConfig
  features/motivation/ quotes
  features/gamification/ notificationThrottler
  native/            ports(인터페이스) + stubs + kvPersistence
  app/wiring.ts      composition root (순수)
App.tsx              Expo 엔트리 (네이티브 스택 필요)
```

## 디바이스 빌드로 넘어가기 (macOS + Xcode / Android SDK)

1. `package.json` 의 `appDependencies` → `dependencies` 승격, `npm install`.
2. `npx expo prebuild && npx expo run:ios` (또는 `run:android`).
3. `App.tsx` 의 stub 3개 교체:
   - `noopCameraSource` → VisionCamera v4 프레임 프로세서 + Hand Landmarker
   - `foregroundTimerStub` → notifee FGS(Android) / Live Activity(iOS)
   - `clockBridgeStub` → 네이티브 monotonic clock + bootId
4. **먼저** `docs/01` 의 2일 스파이크로 손 인식 파이프라인 검증.

## 알려진 플랫폼 한계 (설계 반영 완료)

- **iOS 연속 백그라운드 타이머 불가** → Live Activity + 앱 복귀 재동기화.
- **Android 14+ foregroundServiceType** → `specialUse` 심사 또는 스코프 축소.
- **`react-native-mediapipe` 유지보수 불확실** → `fast-tflite` 폴백 경로 확보.
