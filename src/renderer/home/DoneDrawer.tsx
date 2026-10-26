// Done drawer (§9.7): this week's stats, sprint outcomes, the estimate overrun
// line, finished/dropped history with Reopen/Recycle, and the Ideas list.
import { formatHuman } from '../../core/format';
import type { Data } from '../../core/model/types';
import { live } from '../../core/repo/repo';
import { metrics } from '../../core/tasks/metrics';
import { Icon } from '../components/Icon';
import { recycleWithUndo } from '../components/actions';
import { Dur } from '../components/ui';
import { run } from '../store';

export function DoneDrawer({ d, now, onClose }: { d: Data; now: number; onClose: () => void }) {
  const m = metrics(d, now);
  const done = live(d, 'tasks').filter((t) => t.status === 'done').sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)).slice(0, 30);
  const drops = live(d, 'activity').filter((a) => a.type === 'dropped').sort((a, b) => b.at - a.at).slice(0, 10);
  const ideas = live(d, 'ideas').sort((a, b) => Number(a.reviewed) - Number(b.reviewed) || b.createdAt - a.createdAt);
  return (
    <aside className="drawer" role="dialog" aria-modal="true" aria-label="Done">
      <header className="dlg-head">
        <h2>Done</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </button>
      </header>
      <div className="stats">
        <Stat label="Focused today" value={formatHuman(m.focusTodayMs)} />
        <Stat label="This week" value={formatHuman(m.focusWeekMs)} />
        <Stat label="Started" value={String(m.started)} />
        <Stat label="Finished" value={String(m.finished)} />
        <Stat label="Dropped" value={String(m.dropped)} />
      </div>
      <p className="muted">
        Sprints: {m.sprints.shipped} shipped · {m.sprints.killed} killed · {m.sprints.active} active
        {m.overrun !== null && ` · your estimates run ${m.overrun.toFixed(1)}× ${m.overrun >= 1 ? 'long' : 'short'}`}
      </p>

      <h3 className="eyebrow">Finished</h3>
      {done.length === 0 && <p className="muted">Nothing finished yet this week. The first one is the hardest.</p>}
      <ul className="list">
        {done.map((t) => (
          <li key={t.id}>
            <span>
              {t.outcome === 'killed' ? <span className="badge badge-bad">Killed</span> : t.outcome === 'shipped' ? <span className="badge badge-ok">Shipped</span> : <span className="badge badge-ok">Done</span>} {t.title}{' '}
              <span className="muted">{formatHuman(t.workMs)}</span>
            </span>
            <span className="row gap">
              <button className="btn btn-s btn-ghost" onClick={() => void run({ type: 'task.reopen', id: t.id })}>
                Reopen
              </button>
              <button className="icon-btn" aria-label={`Delete ${t.title}`} onClick={() => void recycleWithUndo('tasks', t.id, t.title, true)}>
                <Icon name="trash" size={16} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {drops.length > 0 && (
        <>
          <h3 className="eyebrow">Dropped</h3>
          <ul className="list">
            {drops.map((a) => (
              <li key={a.id}>
                <span>
                  <span className="badge badge-warn">Dropped</span> {d.tasks[a.taskId]?.title ?? 'Deleted task'} <span className="muted">· {a.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="eyebrow">Ideas</h3>
      {ideas.length === 0 && <p className="muted">Stray thoughts from Focus land here.</p>}
      <ul className="list">
        {ideas.map((i) => (
          <li key={i.id} className={i.reviewed ? 'dim' : ''}>
            <span>{i.text}</span>
            <span className="row gap">
              {!i.reviewed && (
                <button className="btn btn-s btn-ghost" onClick={() => void run({ type: 'idea.review', id: i.id, reviewed: true })}>
                  Reviewed
                </button>
              )}
              <button className="btn btn-s btn-ghost" onClick={() => void run({ type: 'idea.toTask', id: i.id })}>
                Make task
              </button>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="eyebrow">{label}</span>
      <span className="stat-v">
        <Dur text={value} />
      </span>
    </div>
  );
}
