// Time left today, shown as its equation (§6.3a): the hero is the workable time.
// The breakdown also opens as a tooltip on hover and on keyboard focus (Esc hides it).
import { useState } from 'react';
import { formatHuman } from '../../core/format';
import type { TimeLeft as TL } from '../../core/time/timeLeft';
import { Dur } from '../components/ui';

export function TimeLeft({ tl }: { tl: TL }) {
  const sprint = tl.sprintableMs;
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const show = (hover || focus) && !dismissed;
  const rows: [string, string][] = [
    ['Day left', formatHuman(tl.dayLeftMs)],
    ['Fixed', formatHuman(tl.fixedMs)],
    ['Buffer', formatHuman(tl.bufferMs)],
    ['Committed', formatHuman(tl.committedMs)],
    ['Open', formatHuman(tl.unassignedMs)],
  ];
  return (
    <section className="tl rv" aria-label="Time left today">
      <h2 className="eyebrow">Time left today</h2>
      <div
        className="tl-wrap"
        onMouseEnter={() => (setDismissed(false), setHover(true))}
        onMouseLeave={() => setHover(false)}
        onFocus={() => (setDismissed(false), setFocus(true))}
        onBlur={() => setFocus(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && show) {
            e.preventDefault();
            e.stopPropagation();
            setDismissed(true);
          }
        }}
      >
        <p className="tl-hero" tabIndex={0} aria-describedby="tl-break" aria-live="off">
          <Dur text={formatHuman(tl.workableMs)} />
        </p>
        <div id="tl-break" role="tooltip" className={`tl-pop${show ? ' show' : ''}`}>
          <dl>
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <p className="tl-eq">
        {formatHuman(tl.dayLeftMs)} day left − {formatHuman(tl.fixedMs)} fixed − {formatHuman(tl.bufferMs)} buffer · committed {formatHuman(tl.committedMs)} · open {formatHuman(tl.unassignedMs)}
      </p>
      <p className="tl-sprint">{sprint > 0 ? `${formatHuman(sprint)} sprint-able: a good sprint window.` : tl.workableMs > 0 ? 'No 90-minute window left today. Short tasks fit.' : 'Day is done. Plan tomorrow or rest.'}</p>
    </section>
  );
}
