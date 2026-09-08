# 8단계 · 웹 데모 (Windows/CI 에서 바로 실행)

iOS/Android 네이티브 빌드는 macOS·Xcode / Android SDK 가 필요하지만, **핵심 로직 전체 +
UI 는 브라우저에서 그대로 돌아갑니다.** 코어(`src/core`, `src/features`, `src/input`)가
프레임워크 비의존이라 얻는 이점입니다.

## 실행

```bash
npm install
npm run web        # http://localhost:5173  (vite dev)
```

또는 정적 빌드:

```bash
npm run build      # -> dist/
npm run preview
```

## 무엇이 실제로 동작하나

| 기능 | 웹에서 | 비고 |
|---|---|---|
| 타이머 (절대 타임스탬프, 백그라운드 무관) | ✅ 완전 | 탭 백그라운드로 5분 두고 돌아와도 정확 |
| 세션 상태 persist / 콜드스타트 복구 | ✅ | `localStorage` KV 어댑터, 새로고침해도 진행 세션 복구 프롬프트 |
| 출석 · 스트릭 · 보호권 · 히트맵 | ✅ | 전부 세션 리스트에서 파생 |
| 과목 태그 · 손가락→과목 매핑 | ✅ | 과목은 웹 전용 스토어 (코어 `Persistence` 편입은 TODO) |
| 손동작 인식 (시작/정지/개수) | ✅ 실제 동작 | `getUserMedia` + **MediaPipe Hand Landmarker (WASM)** — 네이티브의 `GestureController` 를 그대로 사용 |
| 오인식 방지 (confidence/hold/frames/cooldown) | ✅ | 설정 화면에서 실시간 튜닝 |
| 권한 거부 / 카메라 없음 / 모델 로드 실패 | ✅ | 자동으로 버튼 폴백, 크래시·행 없음 |
| AI 분석 (규칙 기반 + 자연어 코멘트) | ✅ | 백엔드 미설정 시 온디바이스 템플릿 코멘트로 폴백 (오프라인 상태 UI 포함) |
| 데이터 부족 가드 | ✅ | 학습 3일·세션 5개·설치 3일 미만이면 분석 대신 안내 |
| 동기부여 문구 (명언/데이터기반/내목표) | ✅ | 하루 고정 로테이션 |
| 게이미피케이션 (뱃지 멱등 지급, 스로틀러, 공유 카드) | ✅ | 공유 카드는 `<canvas>` → PNG 다운로드 |

## 웹에서 다른 점 (솔직하게)

- **백그라운드 타이머** = 문서 제목(`▶ 24:31 …`)으로 실시간 표시. 백그라운드 탭은
  브라우저가 스로틀링하며, 포그라운드 복귀 시 타임스탬프로 재계산 —
  iOS 의 "완벽한 실시간 백그라운드 갱신 불가" 제약과 성격이 같습니다.
- **monotonic clock** = `performance.now()` + 페이지 로드마다 새 `bootId`. 새로고침 후에는
  monotonic 교차검증이 (정확히, 의도대로) 건너뛰어집니다 = 기기 재부팅과 동일.
- **MediaPipe 모델/WASM** 은 최초 1회 CDN 에서 내려받습니다(수 초). 그래서 웹 프리셋의
  `armingTimeoutMs` 를 12초로 크게 잡습니다. 오프라인이면 즉시 버튼 폴백.
- **과목 데이터** 는 웹 데모에서 별도 스토어(`web/subjectsStore.ts`)로 관리합니다.
  코어 `Persistence` 에 편입하는 것이 후속 작업입니다.

## 구조

```
index.html · vite.config.ts        # 웹 번들러 (vitest 설정과 분리)
web/
  main.tsx  App.tsx  styles.css     # React DOM 진입 + 탭 셸
  appInstance.ts                    # createApp(웹 어댑터) + 웹 설정 스토어
  hooks.ts  ui.tsx                  # 공용 훅/컴포넌트
  webCameraProxy.ts                 # attempt 마다 웹캠 소스를 지연 생성
  analysis.ts  shareCard.ts  seed.ts
  screens/ Timer·Attendance·Subjects·Analysis·Motivation·Badges·Settings
src/native/web/
  webKeyValueStore.ts               # localStorage 기반 KeyValueStore
  webClock.ts                       # performance.now + bootId
  webHaptics.ts                     # navigator.vibrate
  webForegroundTimer.ts             # document.title 틱 + Notification
  webcamGestureSource.ts            # getUserMedia + @mediapipe/tasks-vision
```

`src/core` · `src/features` · `src/app/wiring.ts` 는 **한 줄도 웹 전용 코드가 없습니다.**
동일 코어가 `App.tsx`(Expo/RN)와 `web/`(React DOM) 양쪽에 주입됩니다.
