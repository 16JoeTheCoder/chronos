// Home's bottom shelf (Phase 3.7 §4): today's cards, paused ones first. Short cards in one row;
// "Show details" pulls them out (meta, Start), "Hide details" pushes them back (remembered per
// device). The shelf is also the drop target for the task in focus: dropping it here pauses it.
// Cards drag up into the focus area to start. Keyboard: Enter or S on a card starts it.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Data, Task } from '../../core/model/types';
import { todayOf } from '../../core/tasks/tasks';
import { Icon } from '../components/Icon';
import { beginPress, registerTarget, useDrag } from '../components/drag';
import { DEFAULT_DUR } from '../runway/model';
import { run, toast } from '../store';
import { PrioFlag, TaskMeta } from '../tasks/bits';

const OPEN_KEY = 'chronos.home.shelfOpen';
const loadOpen = (): boolean => { try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } };

export function TodayShelf({ d, now, tasks, pausedIds, activeId }: { d: Data; now: number; tasks: Task[]; pausedIds: Set<string>; activeId: string | null }) {
  const [open, setOpenState] = useState(loadOpen);
  const setOpen = (v: boolean) => { setOpenState(v); try { localStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch { /* per-viewer convenience */ } };
  const box = useRef<HTMLElement>(null);
  const drag = useDrag();
  const today = todayOf(d, now);

  useEffect(
    () =>
      registerTarget('home-shelf', {
        el: () => box.current,
        accepts: (it) => it.kind === 'task' && it.taskId === activeId,
        drop: (it) => {
          if (it.kind !== 'task') return;
          void run({ type: 'task.pause', id: it.taskId }).then((r) => r.ok && toast(`Paused ${it.title}. Time kept.`));
        },
      }),
    [activeId],
  );

  const start = (t: Task) => void run({ type: 'task.start', id: t.id, run: true });
  const pullingActive = drag?.item.kind === 'task' && drag.item.taskId === activeId;

  return (
    <section ref={box} className={`tshelf${open ? ' is-open' : ''}${drag?.target === 'home-shelf' ? ' drop-on' : ''}${pullingActive ? ' is-target' : ''}`} aria-label="Today's tasks">
      <header className="tshelf-head">
        <h2>Today</h2>
        <span className="tshelf-n">{tasks.length ? `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}` : ''}</span>
        {pullingActive && <span className="tshelf-hint">Drop here to pause</span>}
        <span className="tshelf-gap" />
        {tasks.length > 0 && (
          <button type="button" className="btn btn-ghost btn-s" aria-expanded={open} onClick={() => setOpen(!open)}>
            <Icon name={open ? 'chevronDown' : 'chevronUp'} size={14} /> {open ? 'Hide details' : 'Show details'}
          </button>
        )}
      </header>
      {tasks.length === 0 ? (
        <p className="tshelf-empty">{activeId ? 'Nothing else for today.' : 'Nothing for today. Press Ctrl+K to add a task.'}</p>
      ) : (
        <ul className="tshelf-row">
          {tasks.map((t) => {
            const tag = t.tagId ? d.tags[t.tagId] : undefined;
            const isPaused = pausedIds.has(t.id);
            const isDrag = drag?.item.kind === 'task' && drag.item.taskId === t.id;
            return (
              <li
                key={t.id}
                className={`tcard${isPaused ? ' is-paused' : ''}${isDrag ? ' is-drag' : ''}`}
                style={{ '--c': `var(--${tag?.color ?? 'tag7'})` } as CSSProperties}
                tabIndex={0}
                aria-label={`${t.title}${isPaused ? ', paused' : ''}. Enter starts it.`}
                onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === 's' || e.key === 'S')) { e.preventDefault(); start(t); } }}
                onPointerDown={(e) => (e.target as HTMLElement).closest('button') || beginPress(e, { kind: 'task', taskId: t.id, title: t.title, dur: t.estimateMin ?? DEFAULT_DUR })}
              >
                <div className="tcard-top">
                  <span className="tcard-title">{t.title}</span>
                  <PrioFlag p={t.priority} />
                </div>
                {isPaused && <span className="tcard-state">Paused · {Math.max(1, Math.round(t.workMs / 60_000))}m in</span>}
                {open && (
                  <>
                    <TaskMeta d={d} t={t} today={today} />
                    <button type="button" className="btn btn-s tcard-start" onClick={() => start(t)}>
                      <Icon name="play" size={13} /> {isPaused ? 'Resume' : 'Start'}
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
