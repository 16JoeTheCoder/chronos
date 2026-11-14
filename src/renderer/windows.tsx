// Entry for the small windows, routed by hash: #overlay, #notepad, #palette.
import { createRoot } from 'react-dom/client';
import { useMemo } from 'react';
import './windows.css';
import { settingsOf } from '../core/repo/repo';
import { api } from './api';
import { Notepad } from './notepad/Notepad';
import { Overlay } from './overlay/Overlay';
import { PaletteWindow } from './palette/PaletteWindow';
import { loadCustomThemes } from './settings/customThemes';
import { initStore, useSnap } from './store';
import { ThemeProvider } from './theme/ThemeProvider';

const view = location.hash.slice(1);
document.documentElement.dataset.view = view;

function App() {
  const snap = useSnap();
  const custom = useMemo(() => loadCustomThemes(), [snap?.data.settings]);
  if (!snap) return null;
  const s = settingsOf(snap.data);
  return (
    <ThemeProvider themeId={s.themeId} themeSchedule={s.themeSchedule} customThemes={custom} energy={s.energy}>
      {view === 'overlay' ? <Overlay snap={snap} /> : view === 'notepad' ? <Notepad snap={snap} /> : view === 'palette' ? <PaletteWindow /> : null}
    </ThemeProvider>
  );
}

/** A short synthesised beep for notifications (sound setting); no audio files. */
if (view === 'overlay') {
  api.onBeep(() => {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => void ctx.close();
  });
}

initStore();
createRoot(document.getElementById('root') as HTMLElement).render(<App />);
