// Time left today, shown as its equation (§6.3a): the hero is the workable time.
import { formatHuman } from '../../core/format';
import type { TimeLeft as TL } from '../../core/time/timeLeft';
import { Dur } from '../components/ui';

export function TimeLeft({ tl }: { tl: TL }) {
  const sprint = tl.sprintableMs;
  return (
    <section className="tl rv" aria-label="Time left today">
      <h2 className="eyebrow">Time left today</h2>
      <p className="tl-hero" aria-live="off">
        <Dur text={formatHuman(tl.workableMs)} />
      </p>
      <p className="tl-eq">
        {formatHuman(tl.dayLeftMs)} day left − {formatHuman(tl.fixedMs)} fixed − {formatHuman(tl.bufferMs)} buffer · committed {formatHuman(tl.committedMs)} · open {formatHuman(tl.unassignedMs)}
      </p>
      <p className="tl-sprint">{sprint > 0 ? `${formatHuman(sprint)} sprint-able: a good sprint window.` : tl.workableMs > 0 ? 'No 90-minute window left today. Short tasks fit.' : 'Day is done. Plan tomorrow or rest.'}</p>
    </section>
  );
}
