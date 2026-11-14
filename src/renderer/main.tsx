// Home entry. The launch screen is already painted (static HTML); this mounts
// React behind it, hydrates data during the launch screen, and reveals the
// Runway with the draw-in on Enter.
import { Component, StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import './styles/screens.css';
import { api } from './api';
import { Home } from './home/Home';
import { settingsOf } from '../core/repo/repo';
import { themeToCssVars } from '../core/theme';
import { useCustomThemes } from './settings/customThemes';
import { ThemeProvider, useTheme as useActiveTheme } from './theme/ThemeProvider';
import { awaitLaunch, fillLaunch } from './launch/launch';
import { initStore, toast, useSnap } from './store';

api.win.mark('launch.script', performance.now());
let reveal: () => void = () => undefined;

function App() {
  const snap = useSnap();
  const custom = useCustomThemes();
  const [revealed, setRevealed] = useState(false);
  reveal = () => {
    setRevealed(true);
    document.documentElement.classList.add('drawin');
    setTimeout(() => document.documentElement.classList.remove('drawin'), 1000);
  };
  if (!snap) return null;
  const s = settingsOf(snap.data);
  return (
    <ThemeProvider themeId={s.themeId} themeSchedule={s.themeSchedule} customThemes={custom} energy={s.energy}>
      <ThemeBoot />
      <Home snap={snap} revealed={revealed} />
    </ThemeProvider>
  );
}

/** Remember the active theme's variables so the next launch screen paints themed (public/boot.js). */
function ThemeBoot() {
  const t = useActiveTheme();
  useEffect(() => {
    try {
      localStorage.setItem('chronos.themeBoot', JSON.stringify({ vars: themeToCssVars(t.theme), mode: t.theme.mode, id: t.id, sig: t.theme.motion.signature.kind }));
    } catch {
      /* optional */
    }
  }, [t]);
  return null;
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: Error) {
    api.win.restart(`${e.name}: ${e.message}\n${e.stack ?? ''}`);
  }
  render() {
    return this.state.failed ? <p className="crash">Something broke. Restarting Chronos…</p> : this.props.children;
  }
}

// Pause CSS animation while hidden: nothing should burn CPU behind the desktop.
document.addEventListener('visibilitychange', () => document.documentElement.classList.toggle('hidden', document.hidden));

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>,
);

// Things main wants the user to see once (e.g. a change Claude made, with Undo).
api.onNotice((n) => toast(n.text, { error: n.error, undo: n.undoToken ? () => void api.undo(n.undoToken as string) : undefined }));

initStore((snap) => {
  fillLaunch(snap);
  api.win.mark('hydrated', performance.now());
  awaitLaunch(snap.device.skipLaunchScreen, () => reveal());
});
