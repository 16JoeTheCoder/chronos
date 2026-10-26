// Entry for the small windows: #widget (taskbar card) and #capture (quick capture).
import { createRoot } from 'react-dom/client';
import './styles/widget.css';
import { settingsOf } from '../core/repo/repo';
import { api } from './api';
import { initStore, useSnap } from './store';
import { Capture } from './widget/Capture';
import { Widget } from './widget/Widget';

const isCapture = location.hash === '#capture';
document.documentElement.classList.add(isCapture ? 'is-capture' : 'is-widget');

function App() {
  const snap = useSnap();
  if (snap) document.documentElement.dataset.theme = settingsOf(snap.data).theme;
  if (isCapture) return <Capture />;
  return snap ? <Widget snap={snap} /> : null;
}

/** A short synthesised beep (sound setting); no audio files, no network. */
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

initStore();
createRoot(document.getElementById('root') as HTMLElement).render(<App />);
