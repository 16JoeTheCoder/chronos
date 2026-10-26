// Home entry. The launch screen is already painted (static HTML); this mounts
// React behind it, hydrates data during the launch screen, and reveals the
// Runway with the draw-in on Enter.
import { Component, StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import { api } from './api';
import { Home } from './home/Home';
import { awaitLaunch, fillLaunch } from './launch/launch';
import { initStore, useSnap } from './store';

api.win.mark('launch.script', performance.now());
let reveal: () => void = () => undefined;

function App() {
  const snap = useSnap();
  const [revealed, setRevealed] = useState(false);
  reveal = () => {
    setRevealed(true);
    document.documentElement.classList.add('drawin');
    setTimeout(() => document.documentElement.classList.remove('drawin'), 1000);
  };
  return snap ? <Home snap={snap} revealed={revealed} /> : null;
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

initStore((snap) => {
  fillLaunch(snap);
  api.win.mark('hydrated', performance.now());
  awaitLaunch(snap.device.skipLaunchScreen, () => reveal());
});
