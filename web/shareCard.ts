import { hm } from './hooks';

export interface ShareCardData {
  dateLabel: string;
  studiedMs: number;
  goalMs: number;
  attended: boolean;
  streakDays: number;
  topSubject: string | null;
  noTouchMs: number;
}

/** Renders a shareable summary card to a PNG data URL (no library). On web an
 *  <a download> works, so the caller can offer a real save. */
export function renderShareCard(d: ShareCardData): string {
  const W = 1080;
  const H = 1080;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) return '';

  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#12151c');
  grad.addColorStop(1, '#1c2331');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  g.fillStyle = '#6ea8fe';
  g.font = '600 34px -apple-system, "Segoe UI", "Noto Sans KR", sans-serif';
  g.fillText('제스처 학습 타이머', 80, 130);

  g.fillStyle = '#9aa3b2';
  g.font = '400 30px -apple-system, "Segoe UI", "Noto Sans KR", sans-serif';
  g.fillText(d.dateLabel, 80, 180);

  g.fillStyle = '#e8eaed';
  g.font = '800 150px -apple-system, "Segoe UI", "Noto Sans KR", sans-serif';
  g.fillText(hm(d.studiedMs), 76, 360);

  g.fillStyle = d.attended ? '#4ec9a5' : '#9aa3b2';
  g.font = '600 40px -apple-system, "Segoe UI", "Noto Sans KR", sans-serif';
  g.fillText(d.attended ? `출석 완료 · 목표 ${hm(d.goalMs)}` : `목표 ${hm(d.goalMs)} 중`, 80, 430);

  const rows: [string, string][] = [
    ['연속 출석', `${d.streakDays}일`],
    ['화면 안 만진 시간', hm(d.noTouchMs)],
    ['많이 한 과목', d.topSubject ?? '-'],
  ];
  g.font = '400 38px -apple-system, "Segoe UI", "Noto Sans KR", sans-serif';
  rows.forEach(([k, v], i) => {
    const y = 620 + i * 90;
    g.fillStyle = '#9aa3b2';
    g.fillText(k, 80, y);
    g.fillStyle = '#e8eaed';
    g.textAlign = 'right';
    g.fillText(v, W - 80, y);
    g.textAlign = 'left';
  });

  g.strokeStyle = '#2a2f3a';
  g.lineWidth = 2;
  g.strokeRect(60, 60, W - 120, H - 120);

  return c.toDataURL('image/png');
}
