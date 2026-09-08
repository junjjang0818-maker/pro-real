# 1단계 · 기술스택 비교와 추천

## 결론

| 항목 | 선택 | 이유 |
|---|---|---|
| 프레임워크 | **React Native (Expo + Dev Client, TS)** | 온디바이스 손 랜드마크 파이프라인의 기성품 경로가 RN 쪽이 검증됨 |
| 카메라·프레임 | `react-native-vision-camera` v4 Frame Processor | 프레임을 브릿지 안 태우고 네이티브에서 모델로 전달 |
| 손 인식 | **MediaPipe Tasks – Hand Landmarker** (`.task`) | iOS/Android 공식 지원. 1순위 `react-native-mediapipe`, 폴백 `react-native-fast-tflite` + 번들 모델 |
| 제스처 분류 | 랜드마크 좌표 규칙 로직 (`src/features/gesture/fingerCounting.ts`) | 손가락 개수·정적 포즈엔 ML 학습 불필요, 오인식 튜닝이 쉬움 |
| 백그라운드 | Android `notifee` FGS / iOS 예약 로컬 알림 + Live Activity | OS 제약은 프레임워크로 못 바꿈 |
| 영속화 | `react-native-mmkv`(동기, 스냅샷) + `op-sqlite`(이력) | "상태 바뀔 때마다 저장" 요건에 동기 KV가 크래시 안전 |
| 상태관리 | 자체 `SessionStore` + 순수 파생 (Zustand는 UI 바인딩만) | 단일 진실 소스 구조 |
| AI | 얇은 자체 프록시 → Claude API + 온디바이스 규칙 계산 | 카메라 프레임 미전송, 집계치만 |

## RN vs Flutter (이 앱 기준)

승패는 **카메라 → 온디바이스 손 ML → 제스처** 파이프라인에서 갈림. 나머지는 둘 다 가능.

- **손 랜드마크:** 공식 MediaPipe Flutter 플러그인 없음 → Flutter는 iOS/Android 네이티브 직접 작성 가능성 큼. RN은 `react-native-mediapipe` + VisionCamera 프레임 프로세서라는 기성 경로 존재.
- **ML Kit:** 손/손가락 전용 API가 iOS/Android 모두 없음 → 손가락 세기 제스처엔 부적합. **탈락.**
- **커스텀 TFLite 학습:** 손가락 세기엔 과잉. 단, MediaPipe `.task`를 `fast-tflite`로 직접 구동하는 건 유효한 폴백.
- **Foreground service:** `flutter_foreground_task`가 소폭 깔끔하나 결정적 차이 아님.
- **iOS 백그라운드:** 프레임워크 무관, OS 동일.

## 손가락 개수 인식 범위

한 손 **1~5개**는 랜드마크 휴리스틱(지문 끝 y vs PIP 관절, 엄지는 x축 + handedness)으로 안정적 — `fingerCounting.test.ts`에서 0~5 전부 검증. 양손 6~10은 오인식 급증 → **제스처 과목 선택은 최대 5개**, 그 이상은 버튼.

## 커밋 전 필수 스파이크 (2일, 실제 기기)

1. VisionCamera v4 프레임 프로세서에서 Hand Landmarker가 **iOS/Android 15fps+** 로 도는지, `react-native-mediapipe`가 현재 빌드되는지.
2. 실패 시 즉시 폴백(`fast-tflite` + `hand_landmarker.task`)으로 동일 확인.
3. 4초 버스트 후 카메라 완전 해제 시 **열/배터리 튐 없음** 확인.

스파이크 실패 시 손 인식 난이도가 크게 오르므로 2단계 진입 전 재평가.

## 현실 직시 (iOS)

- **연속 백그라운드 타이머 불가.** 절대시각 재계산 + 예약 로컬 알림 + Live Activity(`Text(timerInterval:)`)로 대응. Live Activity는 Swift 위젯 익스텐션 ~100줄 필요.
- `BGTaskScheduler`는 기회성 — 정확한 타이밍에 의존 금지.

## 현실 직시 (Android)

- Android 14+ **foregroundServiceType 선언 강제.** 순수 타이머엔 완벽한 타입이 없어 `specialUse`(Play Console 심사) 또는 "알림 + 복귀 재동기화"로 축소 검토.
- WorkManager 최소 주기 15분 → 실시간 갱신 부적합.
