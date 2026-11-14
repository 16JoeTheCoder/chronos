import './zz-mock';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './theme/ThemeProvider';
import { Settings } from './settings/Settings';
import { useCustomThemes } from './settings/customThemes';
import { Board } from './board/Board';
import { initStore, useSnap } from './store';
import { Toasts } from './components/ui';
import { settingsOf } from '../core/repo/repo';

initStore();
const qs = new URLSearchParams(location.search);
function App() {
  const snap = useSnap();
  const custom = useCustomThemes();
  if (!snap) return null;
  const s = settingsOf(snap.data);
  return (
    <ThemeProvider themeId={s.themeId} themeSchedule={s.themeSchedule} customThemes={custom} energy={s.energy}>
      {qs.get('screen') === 'board' ? <Board onOpenLog={() => {}} onEnterFocus={() => {}} /> : <Settings snap={snap} section={(qs.get('section') as any) ?? 'look'} onSchedule={() => {}} />}
      <Toasts />
    </ThemeProvider>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
