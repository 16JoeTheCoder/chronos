// Big moments (PHASE23 §6): block start and block finish. They never block input
// (pointer-events none, 2 s) and are CSS/SVG only.
//   Tactile: micro-interactions only (no overlay).
//   Stark: StarkMoments. The ring charges from empty and the title rises in; on finish a burst
//          ring and a check. The overlay is part of the living-reactor layer.
//   TARS / Gargantua: derived from FlightMoments. TARS: the step bar runs out and a
//          BLOCK COMPLETE stamp lands. Gargantua: the ring draws, then flares.
// Sound cues play on start and finish honouring settings.sound (+ muteInFocus), motion or not.

import { useEffect, useRef, useState } from 'react';
import { formatClock } from '../../core/format';
import type { Snapshot } from '../../core/model/types';
import { settingsOf } from '../../core/repo/repo';
import { playCue } from '../sound/sound';
import { useOptionalTheme } from '../theme/ThemeProvider';

type Kind = 'start' | 'finish';
interface Moment { kind: Kind; title: string; key: number; durationMs: number }

/** What changed between two task snapshots: a first start, or a finish. */
export function momentsBetween(prev: Map<string, { status: string; run: string }>, tasks: { id: string; title: string; status: string; outcome: string | null; runtime: { status: string }; timer: { countdown: { durationMs: number } } }[]): Moment[] {
  const out: Moment[] = [];
  for (const t of tasks) {
    const p = prev.get(t.id);
    if (!p) continue;
    if (t.status === 'done' && p.status !== 'done' && t.outcome !== 'killed') out.push({ kind: 'finish', title: t.title, key: 0, durationMs: 0 });
    else if (t.runtime.status === 'running' && p.run === 'idle') out.push({ kind: 'start', title: t.title, key: 0, durationMs: t.timer.countdown.durationMs });
  }
  return out;
}

export function Moments({ snap, inFocus }: { snap: Snapshot; inFocus: boolean }) {
  const theme = useOptionalTheme();
  const s = settingsOf(snap.data);
  const prev = useRef<Map<string, { status: string; run: string }> | null>(null);
  const seq = useRef(0);
  const [m, setM] = useState<Moment | null>(null);
  const tasks = Object.values(snap.data.tasks).filter((t) => t.deletedAt === null);
  const sound = useRef(s.sound);
  sound.current = s.sound;

  useEffect(() => {
    const map = new Map(tasks.map((t) => [t.id, { status: t.status, run: t.runtime.status }]));
    if (prev.current) {
      const found = momentsBetween(prev.current, tasks);
      const first = found[found.length - 1];
      if (first) {
        const snd = sound.current;
        if (snd.enabled && !(inFocus && snd.muteInFocus)) playCue(first.kind === 'start' ? 'blockStart' : 'blockFinish', { volume: snd.volume });
        if (!theme?.motionOff && theme?.theme.motion.signature.kind !== 'ticking-digits') {
          setM({ ...first, key: ++seq.current });
        }
      }
    }
    prev.current = map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.data.tasks]);

  useEffect(() => {
    if (!m) return;
    const id = setTimeout(() => setM(null), 2200);
    return () => clearTimeout(id);
  }, [m]);

  if (!m || !theme) return null;
  const kind = theme.theme.motion.signature.kind;
  const label = m.kind === 'start' ? 'Block started' : 'Block finished';
  return (
    <div className={`moment moment-${kind} moment-${m.kind}`} key={m.key} aria-hidden="true" data-label={label}>
      {kind === 'reactor-ring' && <StarkMoment m={m} />}
      {kind === 'slab-monolith' && <TarsMoment m={m} />}
      {kind === 'accretion-ring' && <GargantuaMoment m={m} />}
    </div>
  );
}

function StarkMoment({ m }: { m: Moment }) {
  return (
    <div className="moment-card">
      <svg width="280" height="280" viewBox="0 0 440 440">
        <defs>
          <mask id="mm1"><circle className="mo-charge" cx="220" cy="220" r="170" fill="none" stroke="#fff" strokeWidth="30" strokeDasharray="1068 1068" transform="rotate(-90 220 220)" /></mask>
        </defs>
        <circle className="mo-track" cx="220" cy="220" r="170" strokeDasharray="20 6.7" />
        {m.kind === 'start' ? <circle className="mo-on" cx="220" cy="220" r="170" strokeDasharray="20 6.7" mask="url(#mm1)" /> : <circle className="mo-on" cx="220" cy="220" r="170" strokeDasharray="20 6.7" />}
        {m.kind === 'finish' && <><circle className="mo-burst" cx="220" cy="220" r="90" /><path className="mo-check" d="M168 224 l38 38 l74 -84" /></>}
        {m.kind === 'start' && <text className="mo-time" x="220" y="240" textAnchor="middle" fontSize="64">{formatClock(m.durationMs)}</text>}
      </svg>
      <span className="mo-title">{m.title}</span>
    </div>
  );
}

function TarsMoment({ m }: { m: Moment }) {
  return (
    <div className="moment-card">
      <span className="mo-title">{m.title}</span>
      {m.kind === 'start' ? (
        <>
          <span className="mo-clock">T- {formatClock(m.durationMs)}</span>
          <span className="mo-bar"><i /></span>
        </>
      ) : (
        <span className="mo-stamp">BLOCK COMPLETE</span>
      )}
    </div>
  );
}

function GargantuaMoment({ m }: { m: Moment }) {
  return (
    <div className="moment-card">
      <svg width="260" height="260" viewBox="0 0 720 720">
        <circle className="mo-rim" cx="360" cy="360" r="206" />
        <circle className="mo-draw" cx="360" cy="360" r="206" strokeDasharray="1294 1294" transform="rotate(-90 360 360)" />
        {m.kind === 'finish' && <circle className="mo-burst" cx="360" cy="360" r="206" />}
      </svg>
      <span className="mo-title">{m.title}</span>
    </div>
  );
}
