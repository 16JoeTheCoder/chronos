// Home widgets (PHASE23 §6): Day, Momentum, Notes, Wellness. Each is toggled by
// settings.widgets and styled only by theme tokens. In Focus the stack dims to the
// theme's focus.widgetOpacity / blur (CSS: .widgets.dim). Reactive data (Stark's third
// energy layer) charges the momentum cell, fills the day dial per finished block and
// ignites the streak edge, all CSS transitions on SVG/transform.

import { formatHM, formatHuman } from '../../core/format';
import type { Data, Task } from '../../core/model/types';
import { focusChains } from '../../core/planning/wellness';
import { live, settingsOf } from '../../core/repo/repo';
import { useOptionalTheme } from '../theme/ThemeProvider';
import type { DayModel } from '../runway/model';
import { minuteOf } from '../runway/model';
import { arc, daySegments, estimateDriftPct, focusStreak, weekFocus } from './stats';

const R = 80;
const C = 2 * Math.PI * R;
const STREAK_IGNITION = 5;
const MIN = 60_000;

export function Widgets({ d, m, now, task, dim }: { d: Data; m: DayModel; now: number; task: Task | undefined; dim?: boolean }) {
  const s = settingsOf(d);
  const theme = useOptionalTheme();
  // Energy layers are Stark's (reactor-ring) and each sits behind its own switch.
  const reactive = !!theme && !theme.motionOff && theme.theme.motion.signature.kind === 'reactor-ring' && theme.energy.reactiveData === true;
  const w = s.widgets;
  if (!w.day && !w.momentum && !w.notes && !w.wellness) return null;
  return (
    <div className={`widgets${dim ? ' dim' : ''}`} aria-label="Widgets" aria-hidden={dim ? true : undefined}>
      {w.day && <DayWidget d={d} m={m} now={now} reactive={reactive} />}
      {w.momentum && <MomentumWidget d={d} now={now} reactive={reactive} />}
      {w.notes && <NotesWidget d={d} task={task} />}
      {w.wellness && <WellnessWidget d={d} m={m} now={now} />}
    </div>
  );
}

function DayWidget({ d, m, now, reactive }: { d: Data; m: DayModel; now: number; reactive: boolean }) {
  const s = settingsOf(d);
  const fixed = m.instances.map((i): [number, number] => [minuteOf(m, i.start), minuteOf(m, i.end)]);
  const { segs, blocksTotal, blocksDone } = daySegments(fixed, d, m.date);
  const nowMin = minuteOf(m, now);
  const hand = (nowMin / 1440) * 2 * Math.PI - Math.PI / 2;
  const filled = blocksTotal ? blocksDone / blocksTotal : 0;
  return (
    <section className="widget w-day" aria-label="Day">
      <svg viewBox="0 0 200 200" role="img" aria-label={`Today on a 24 hour dial. ${blocksDone} of ${blocksTotal} blocks done.`}>
        <circle className="dial-track" cx="100" cy="100" r={R} />
        {segs.map((g, i) => {
          const a = arc(g.from, g.to, C);
          return <circle key={i} className={`dial-seg dial-${g.kind}`} cx="100" cy="100" r={R} strokeDasharray={a.dash} transform={`rotate(${a.rot} 100 100)`} />;
        })}
        {reactive && <circle className="dial-fill" cx="100" cy="100" r={R - 14} strokeDasharray={`${(C * (R - 14)) / R * filled} ${(C * (R - 14)) / R}`} transform="rotate(-90 100 100)" />}
        <line className="dial-hand" x1="100" y1="100" x2={100 + Math.cos(hand) * (R + 2)} y2={100 + Math.sin(hand) * (R + 2)} />
        <circle className="dial-pivot" cx="100" cy="100" r="4" />
      </svg>
      <div className="w-body">
        <span className="w-label">Free time left today</span>
        <span className="w-big">{formatHuman(m.tl.workableMs)}</span>
        <span className="w-sub">
          After the {s.bufferMin} min buffer before {formatHM(s.dayEndMin)}
        </span>
      </div>
    </section>
  );
}

function MomentumWidget({ d, now, reactive }: { d: Data; now: number; reactive: boolean }) {
  const s = settingsOf(d);
  const week = weekFocus(d, now);
  const total = week.reduce((a, b) => a + b.hours, 0);
  const max = Math.max(1, ...week.map((x) => x.hours));
  const streak = focusStreak(d, now);
  const drift = estimateDriftPct(d);
  const target = Math.max(1, s.weeklyFocusTargetH);
  const charge = Math.min(1, total / target);
  const note = [streak > 0 ? `${streak}-day streak` : null, drift !== null && drift !== 0 ? `estimates running ${Math.abs(drift)} % ${drift > 0 ? 'long' : 'short'}` : null].filter(Boolean).join(' · ');
  return (
    <section className={`widget w-momentum${streak >= STREAK_IGNITION ? ' ignited' : ''}`} aria-label="Momentum">
      <header className="w-head">
        <h2>Focus this week</h2>
        <span className="w-big sm">{total.toFixed(1)} h</span>
      </header>
      <div className="w-chart">
        {reactive && (
          <div className="cell" role="img" aria-label={`${Math.round(charge * 100)} percent of the ${target} hour weekly target`}>
            <i style={{ height: `${Math.round(charge * 100)}%` }} />
          </div>
        )}
        <div className="bars">
          {week.map((b, i) => (
            <div key={b.date} className="bar-col" title={`${b.label}: ${b.hours.toFixed(1)} h`}>
              <i className={i === 6 ? 'today' : ''} style={{ height: `${Math.max(3, Math.round((b.hours / max) * 100))}%` }} />
              <span>{b.label}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="w-sub">{note || `Target ${target} h a week`}</p>
    </section>
  );
}

function NotesWidget({ d, task }: { d: Data; task: Task | undefined }) {
  const notes = task
    ? live(d, 'ideas')
        .filter((i) => i.taskId === task.id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 2)
    : [];
  return (
    <section className="widget w-notes" aria-label="Notes">
      <h2>Thinking space</h2>
      {notes.length ? notes.map((n, i) => <p key={n.id} className={i === 0 ? 'first' : ''}>{n.text}</p>) : <p className="w-sub">Type a stray thought in Focus. It stays with the task.</p>}
    </section>
  );
}

function WellnessWidget({ d, m, now }: { d: Data; m: DayModel; now: number }) {
  const after = settingsOf(d).planning.breakAfterMin;
  const chain = focusChains(d, now).at(-1);
  const active = chain && now - chain.end < 5 * MIN ? Math.floor((chain.end - chain.start) / MIN) : 0;
  const nextEnd = m.blocks.map((b) => b.endMin).filter((e) => e > minuteOf(m, now)).sort((a, b) => a - b)[0];
  return (
    <section className="widget w-wellness" aria-label="Wellness">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
        <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
        <path d="M6 2v3M10 2v3M14 2v3" />
      </svg>
      <div className="w-body">
        {active > 0 ? (
          <>
            <span className="w-label strong">{active} min without a break</span>
            <span className="w-sub">{active >= after - 15 && nextEnd !== undefined ? `Take 10 minutes when this block ends at ${formatHM(nextEnd)}.` : `A break is due after ${after} min.`}</span>
          </>
        ) : (
          <>
            <span className="w-label strong">Rested</span>
            <span className="w-sub">A break is offered after {after} min of focus.</span>
          </>
        )}
      </div>
    </section>
  );
}
