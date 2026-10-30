// Unscheduled cards (§9.2/§9.3). A card can be dragged onto the Plan lane, or
// scheduled from the keyboard with S (the "Schedule at" popover). Duration chips
// set the estimate (default 25). Alt+arrows reorder; Delete recycles; Enter edits.

import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { formatHM } from '../../core/format';
import type { Data, Task } from '../../core/model/types';
import { deriveQueue, todayOf } from '../../core/tasks/tasks';
import { hasFinishCondition } from '../../core/validation';
import { Icon } from '../components/Icon';
import { recycleWithUndo } from '../components/actions';
import { beginDrag } from '../components/drag';
import { Dialog } from '../components/ui';
import { run } from '../store';
import { DEFAULT_DUR, firstFit, freeGaps, place, scheduledMin, type DayModel } from '../runway/model';

const CHIPS = [15, 25, 45, 90];

export function Unscheduled({ d, m, now, onEdit, onNew }: { d: Data; m: DayModel; now: number; onEdit: (t: Task) => void; onNew: () => void }) {
  const today = todayOf(d, now);
  const [scheduling, setScheduling] = useState<{ task: Task; dur: number } | null>(null);
  const cards = deriveQueue(d, now)
    .map((t) => ({ t, rest: (t.estimateMin ?? DEFAULT_DUR) - scheduledMin(d, t.id, today), any: scheduledMin(d, t.id, today) > 0 }))
    .filter((c) => !c.any || c.rest > 0);

  return (
    <section className="cards rv" aria-label="Unscheduled">
      <header className="sec-head">
        <h2 className="eyebrow">Unscheduled</h2>
        <button className="btn btn-s btn-ghost" onClick={onNew} aria-keyshortcuts="N">
          <Icon name="plus" size={14} /> New <kbd>N</kbd>
        </button>
      </header>
      {cards.length === 0 ? (
        <p className="muted empty">Nothing waiting. Press N to add a task.</p>
      ) : (
        <ul className="card-row">
          {cards.map(({ t, rest, any }, i) => (
            <TaskCard key={t.id} d={d} t={t} index={i} rest={any ? rest : null} onEdit={onEdit} onSchedule={(dur) => setScheduling({ task: t, dur })} />
          ))}
        </ul>
      )}
      {scheduling && <SchedulePopover d={d} m={m} now={now} task={scheduling.task} dur={scheduling.dur} onClose={() => setScheduling(null)} />}
    </section>
  );
}

function TaskCard({ d, t, index, rest, onEdit, onSchedule }: { d: Data; t: Task; index: number; rest: number | null; onEdit: (t: Task) => void; onSchedule: (dur: number) => void }) {
  const tag = t.tagId ? d.tags[t.tagId] : undefined;
  const dur = rest ?? t.estimateMin ?? DEFAULT_DUR;
  const ready = hasFinishCondition(t.finishCondition);
  const keys = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      onSchedule(dur);
    } else if (e.key === 'Enter') onEdit(t);
    else if (e.key === 'Delete') void recycleWithUndo('tasks', t.id, t.title);
    else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      void run({ type: 'task.reorder', id: t.id, direction: e.key === 'ArrowLeft' ? 'up' : 'down' });
    }
  };
  return (
    <li
      className={`card rv-card${t.status === 'active' ? ' card-active' : ''}${t.kind === 'sprint' ? ' card-sprint' : ''}`}
      style={{ '--c': `var(--${tag?.color ?? 'tag7'})`, '--i': index } as CSSProperties}
      tabIndex={0}
      aria-label={`${t.title}${t.status === 'active' ? ', in focus' : ''}, ${t.priority}. S schedules, Enter edits, Delete removes, Alt and arrows reorder.`}
      onKeyDown={keys}
      onPointerDown={(e) => (e.target as HTMLElement).closest('button') || beginDrag(e, { kind: 'task', taskId: t.id, title: t.title, dur }, () => onEdit(t))}
    >
      <div className="card-top">
        {tag && <span className="chip-tag">{tag.name}</span>}
        <span className={`prio prio-${t.priority}`}>{t.priority}</span>
        {t.kind === 'sprint' && <span className="prio">sprint</span>}
      </div>
      <p className="card-title">{t.title}</p>
      <p className={`card-fc${ready ? '' : ' warn'}`}>{ready ? t.finishCondition : 'Needs a finish condition before it can start.'}</p>
      <div className="card-chips">
        {rest !== null && rest > 0 ? (
          <span className="chip chip-rest">+{rest}m unscheduled</span>
        ) : (
          CHIPS.map((c) => (
            <button key={c} className={`chip${(t.estimateMin ?? DEFAULT_DUR) === c ? ' on' : ''}`} aria-pressed={(t.estimateMin ?? DEFAULT_DUR) === c} onClick={() => void run({ type: 'task.update', id: t.id, input: { estimateMin: c } })}>
              {c}m
            </button>
          ))
        )}
      </div>
    </li>
  );
}

/** Keyboard path for scheduling: first gap that fits, Up/Down ±5 min, Enter confirms. */
function SchedulePopover({ d, m, now, task, dur, onClose }: { d: Data; m: DayModel; now: number; task: Task; dur: number; onClose: () => void }) {
  const gaps = freeGaps(d, m, now);
  const [start, setStart] = useState(() => firstFit(gaps, dur));
  const p = start === null ? null : place(gaps, start, dur);
  const confirm = async () => {
    if (!p) return;
    const r = await run({ type: 'block.create', taskId: task.id, date: m.date, startMin: p.startMin, endMin: p.endMin });
    if (r.ok) onClose();
  };
  return (
    <Dialog title={`Schedule ${task.title}`} onClose={onClose}>
      {start === null ? (
        <p className="muted">No free time left today.</p>
      ) : (
        <div
          className="sched"
          tabIndex={0}
          role="spinbutton"
          aria-valuenow={start}
          aria-valuetext={p ? `${formatHM(p.startMin)} to ${formatHM(p.endMin)}` : `${formatHM(start)}, does not fit`}
          aria-label="Start time. Up and Down move 5 minutes, Enter confirms."
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              setStart((s) => (s ?? 0) + (e.key === 'ArrowUp' ? 5 : -5));
            } else if (e.key === 'Enter') void confirm();
          }}
          data-autofocus
        >
          <span className="sched-time">{p ? `${formatHM(p.startMin)} – ${formatHM(p.endMin)}` : formatHM(start)}</span>
          <span className={p ? 'muted' : 'warn'}>{p ? (p.endMin - p.startMin < dur ? `Gap fits ${p.endMin - p.startMin} of ${dur} min` : `${dur} min`) : 'Overlaps something. Move with Up or Down.'}</span>
        </div>
      )}
      <div className="row end gap">
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" disabled={!p} onClick={() => void confirm()}>
          Schedule
        </button>
      </div>
    </Dialog>
  );
}
