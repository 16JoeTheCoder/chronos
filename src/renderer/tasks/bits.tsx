// Small shared pieces of a task row (Phase 3.7): the P1-P4 flag and the one-line meta
// (due, labels, project). Used by Tasks, Home's shelf cards, the Plan cards and Board.
import type { CSSProperties } from 'react';
import { formatHM } from '../../core/format';
import type { Data, Priority, Task } from '../../core/model/types';
import { labelsOf } from '../../core/tasks/selectors';
import { addDays } from '../../core/time/zone';
import { Icon } from '../components/Icon';

export const PRIO_LABEL: Record<Priority, string> = { must: 'P1', should: 'P2', nice: 'P3', none: 'P4' };
export const PRIO_OF_NUM: Record<number, Priority> = { 1: 'must', 2: 'should', 3: 'nice', 4: 'none' };

/** A flag for P1-P3 (theme colours); P4 shows nothing. */
export function PrioFlag({ p }: { p: Priority }) {
  if (p === 'none') return null;
  return (
    <span className={`prio-flag prio-${p}`} title={`Priority ${PRIO_LABEL[p].slice(1)}`}>
      <Icon name="flag" size={13} />
      <span className="sr-only">{PRIO_LABEL[p]}</span>
    </span>
  );
}

/** "Today", "Tomorrow", "Mon 24 Nov", "Overdue · 18 Nov". */
export function dueLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  const d = new Date(`${date}T12:00:00Z`);
  const s = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return date < today ? `Overdue · ${s}` : s;
}

export function TaskMeta({ d, t, today, hideProject }: { d: Data; t: Task; today: string; hideProject?: boolean }) {
  const project = !hideProject && t.projectId ? d.projects[t.projectId] : undefined;
  const parts: JSX.Element[] = [];
  if (t.dueDate) parts.push(<span key="due" className={`tm-due${t.dueDate < today ? ' is-late' : ''}`}>{dueLabel(t.dueDate, today)}{t.dueTime !== null ? ` ${formatHM(t.dueTime)}` : ''}</span>);
  if (t.recurrence) parts.push(<span key="rep" className="tm-rep">Repeats</span>);
  if (t.estimateMin) parts.push(<span key="est">{t.estimateMin}m</span>);
  for (const l of labelsOf(t)) parts.push(<span key={`l${l}`} className="tm-label">@{l}</span>);
  if (project && project.deletedAt === null) parts.push(<span key="proj" className="tm-proj" style={{ '--c': `var(--${project.color})` } as CSSProperties}>{project.name}</span>);
  return parts.length ? <span className="tm">{parts}</span> : null;
}
