// The date sheet a left swipe on a task row opens: quick days and a date field. A bottom sheet on phones.
import { useState } from 'react';
import type { Task } from '../../core/model/types';
import { addDays, mondayOf } from '../../core/time/zone';
import { Sheet } from '../components/Sheet';
import { run, toast } from '../store';
import { dueLabel } from './bits';

/** The quick choices, as dates (pure, tested). `today` is the user's today (YYYY-MM-DD). */
export function quickDates(today: string): { label: string; date: string | null }[] {
  const nextMon = addDays(mondayOf(today), 7);
  return [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'Next week', date: nextMon },
    { label: 'No date', date: null },
  ];
}

export function DateSheet({ task, today, onClose, onEdit }: { task: Task; today: string; onClose: () => void; onEdit: (t: Task) => void }) {
  const [date, setDate] = useState(task.dueDate ?? '');
  const set = async (dueDate: string | null) => {
    const prev = task.dueDate;
    const r = await run({ type: 'task.update', id: task.id, input: { dueDate } });
    if (!r.ok) return;
    toast(dueDate ? `${task.title}: ${dueLabel(dueDate, today)}` : `${task.title}: no date`, { undo: () => void run({ type: 'task.update', id: task.id, input: { dueDate: prev } }) });
    onClose();
  };
  return (
    <Sheet title="Set a date" onClose={onClose}>
      <p className="muted ds-task">{task.title}</p>
      <div className="ds-quick">
        {quickDates(today).map((q) => (
          <button key={q.label} type="button" className={`btn btn-ghost${q.date === task.dueDate ? ' on' : ''}`} onClick={() => void set(q.date)}>{q.label}</button>
        ))}
      </div>
      <label className="field">
        <span className="eyebrow">Pick a date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="row end gap">
        <button type="button" className="btn btn-ghost" onClick={() => { onClose(); onEdit(task); }}>More options</button>
        <button type="button" className="btn" disabled={!date} onClick={() => void set(date)}>Set date</button>
      </div>
    </Sheet>
  );
}
