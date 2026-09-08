import React, { useState } from 'react';
import { useAppSync } from './hooks';
import { TimerScreen } from './screens/TimerScreen';
import { AttendanceScreen } from './screens/AttendanceScreen';
import { SubjectsScreen } from './screens/SubjectsScreen';
import { AnalysisScreen } from './screens/AnalysisScreen';
import { MotivationScreen } from './screens/MotivationScreen';
import { BadgesScreen } from './screens/BadgesScreen';
import { SettingsScreen } from './screens/SettingsScreen';

const TABS = [
  { id: 'timer', label: '타이머', icon: '⏱', C: TimerScreen },
  { id: 'attend', label: '출석', icon: '🔥', C: AttendanceScreen },
  { id: 'subjects', label: '과목', icon: '📚', C: SubjectsScreen },
  { id: 'analysis', label: '분석', icon: '📈', C: AnalysisScreen },
  { id: 'motivate', label: '동기', icon: '✨', C: MotivationScreen },
  { id: 'badges', label: '뱃지', icon: '🏅', C: BadgesScreen },
  { id: 'settings', label: '설정', icon: '⚙️', C: SettingsScreen },
] as const;

export default function App() {
  useAppSync();
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('timer');
  const Active = TABS.find((t) => t.id === tab)!.C;

  return (
    <div className="app">
      <Active />
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={t.id === tab ? 'active' : ''} onClick={() => setTab(t.id)}>
            <div style={{ fontSize: 16 }}>{t.icon}</div>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
