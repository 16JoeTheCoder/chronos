/** Synthesised UI cues via Web Audio. No audio files. Safe no-op where audio is unavailable. */
export type CueName = 'blockStart' | 'blockFinish';

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  const AC = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
  if (!AC) return null;
  try { ctx = new AC(); } catch { ctx = null; }
  return ctx;
}

function tone(c: AudioContext, t0: number, freq: number, dur: number, peak: number, glideTo?: number) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** blockStart: soft rising tone. blockFinish: short major chord. volume 0..1. */
export function playCue(name: CueName, opts: { volume?: number } = {}): void {
  const vol = Math.min(1, Math.max(0, opts.volume ?? 0.35));
  if (vol === 0) return;
  const c = getCtx();
  if (!c) return;
  try {
    if (c.state === 'suspended') void c.resume();
    const t = c.currentTime + 0.02;
    const peak = vol * 0.4;
    if (name === 'blockStart') {
      tone(c, t, 392, 0.55, peak, 587.33); // G4 -> D5
      tone(c, t + 0.08, 587.33, 0.5, peak * 0.4, 880);
    } else {
      [523.25, 659.25, 783.99].forEach((f, i) => tone(c, t + i * 0.06, f, 0.9, peak * 0.6)); // C major
    }
  } catch {
    /* audio is best-effort */
  }
}
