// Month view: a dot on days with posts, a ring on days with posts in the current project.
import { useMemo, useState } from 'react';
import { dayMarks, monthGrid, shiftMonth } from '../../core/log';
import type { Idea } from '../../core/model/types';
import { Icon } from '../components/Icon';
import { MONTH_NAMES } from './ctx';

interface Props {
  notes: readonly Idea[];
  tz: string;
  today: string;
  projectId: string | null;
  projectName: string | null;
  selected: string | null;
  onSelect: (date: string) => void;
}

export function Calendar({ notes, tz, today, projectId, projectName, selected, onSelect }: Props) {
  const [view, setView] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const marks = useMemo(() => dayMarks(notes, tz, projectId), [notes, tz, projectId]);
  const grid = useMemo(() => monthGrid(view.year, view.month), [view]);
  const go = (by: number) => setView((v) => shiftMonth(v.year, v.month, by));
  return (
    <div className="cal" role="group" aria-label="Calendar">
      <div className="cal-head">
        <button className="log-btn log-btn-quiet cal-nav cal-prev" onClick={() => go(-1)} aria-label="Previous month">
          <Icon name="chevronUp" size={16} />
        </button>
        <h2 className="cal-title" aria-live="polite">
          {MONTH_NAMES[view.month - 1]} {view.year}
        </h2>
        <button className="log-btn log-btn-quiet cal-nav cal-next" onClick={() => go(1)} aria-label="Next month">
          <Icon name="chevronUp" size={16} />
        </button>
      </div>
      <div className="cal-grid">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="cal-dow" aria-hidden="true">
            {d}
          </span>
        ))}
        {grid.map((c) => {
          const m = marks.get(c.date);
          const day = Number(c.date.slice(8));
          return (
            <button
              key={c.date}
              className={`cal-day${c.inMonth ? '' : ' out'}${c.date === today ? ' today' : ''}${c.date === selected ? ' sel' : ''}`}
              onClick={() => onSelect(c.date)}
              aria-pressed={c.date === selected}
              aria-label={`${day} ${MONTH_NAMES[Number(c.date.slice(5, 7)) - 1]}${m ? `, ${m.count} ${m.count === 1 ? 'post' : 'posts'}${m.inProject ? ` (${projectName ?? 'project'})` : ''}` : ''}`}
            >
              <span>{day}</span>
              <span className="cal-marks" aria-hidden="true">
                {m && <i className="mark-dot" />}
                {m?.inProject && <i className="mark-ring" />}
              </span>
            </button>
          );
        })}
      </div>
      <p className="cal-legend">
        <i className="mark-dot" /> posts{projectName && (<> <i className="mark-ring" /> in {projectName}</>)}
      </p>
    </div>
  );
}
