// Home strips: "Before class" prep nudges (§6.5) and the holiday "Heads up" card (§6.3).
import { useState } from 'react';
import { clockOf, dateLabel } from '../../core/format';
import { SCOPES, type Closure, type Data, type Scope } from '../../core/model/types';
import { live } from '../../core/repo/repo';
import { todayOf } from '../../core/tasks/tasks';
import { prepNudges } from '../../core/time/prep';
import { addDays } from '../../core/time/zone';
import { run } from '../store';

export function BeforeClass({ d, now }: { d: Data; now: number }) {
  const list = prepNudges(d, now);
  if (!list.length) return null;
  return (
    <section className="strip rv" aria-label="Before class">
      <h2 className="eyebrow">Before class</h2>
      <ul>
        {list.map((n) => (
          <li key={n.key} className={n.tight ? 'tight' : ''}>
            {n.tight && <span className="badge badge-warn">Tight</span>}
            <b>{n.task.title}</b> · {n.instance.event.title} {clockOf(n.instance.start, n.instance.event.tz)} · needs {n.needsMin}m, {n.freeBeforeMin}m free
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Unconfirmed closures in the next 14 days: ask per scope whether it applies. */
export function HeadsUp({ d, now }: { d: Data; now: number }) {
  const today = todayOf(d, now);
  const soon = live(d, 'closures').filter((c) => !c.confirmed && c.endDate >= today && c.startDate <= addDays(today, 14));
  const first = soon.sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  return first ? <HeadsUpCard key={first.id} c={first} /> : null;
}

const SHOWN: Scope[] = SCOPES.filter((s) => s !== 'other');

function HeadsUpCard({ c }: { c: Closure }) {
  const [off, setOff] = useState<Set<Scope>>(() => new Set(SHOWN));
  const flip = (s: Scope) => setOff((o) => (o.has(s) ? new Set([...o].filter((x) => x !== s)) : new Set([...o, s])));
  return (
    <section className="strip headsup rv" aria-label="Heads up">
      <h2 className="eyebrow">Heads up</h2>
      <p>
        <b>{c.name}</b> on {dateLabel(c.startDate)}
        {c.endDate !== c.startDate ? ` to ${dateLabel(c.endDate)}` : ''}. Does it apply to you?
      </p>
      <div className="row gap wrap">
        {SHOWN.map((s) => (
          <button key={s} className={`chip${off.has(s) ? ' on' : ''}`} aria-pressed={off.has(s)} onClick={() => flip(s)}>
            {s[0]?.toUpperCase()}
            {s.slice(1)}: {off.has(s) ? 'Off' : 'On'}
          </button>
        ))}
        <button className="btn btn-s" onClick={() => void run({ type: 'closure.update', id: c.id, input: { name: c.name, startDate: c.startDate, endDate: c.endDate, scopes: [...off], confirmed: true } })}>
          Confirm
        </button>
      </div>
    </section>
  );
}
