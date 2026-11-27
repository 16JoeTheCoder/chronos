// Home (PHASE23 §1, §6; Phase 3.7 §4): one task owns the screen. Now (title, signature timer,
// Start/Pause, Hold Enter to finish), Next and time left, and the shelf of today's cards below.
// Drag the task in focus down to the shelf (or press Pause) and it pauses: the timer stops, the
// session closes, the time is kept, and the focus area becomes an empty drop target. Drop any card
// there to start it. One DOM, many compositions: CSS keyed on data-signature reshapes it.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { clockOf, formatHM, formatHuman } from '../../core/format';
import type { Data } from '../../core/model/types';
import { blockSpan, deriveQueue, ownsTimer, todayOf } from '../../core/tasks/tasks';
import { homeModel } from '../../core/tasks/screens';
import { beginPress, registerTarget, useDrag } from '../components/drag';
import { DEFAULT_DUR } from '../runway/model';
import { TodayShelf } from './TodayShelf';
import { upcoming } from '../../core/time/schedule';
import { Icon } from '../components/Icon';
import { sizeFor, useWidth } from '../focus/FocusCore';
import { HoldButton, useHold } from '../focus/HoldButton';
import { useTimer } from '../focus/TimerDigits';
import type { DayModel } from '../runway/model';
import { SignatureTimer } from '../signature/SignatureTimer';
import { run, toast } from '../store';
import { useOptionalTheme } from '../theme/ThemeProvider';
import { useHolo } from '../moments/holo';
import { Widgets } from '../widgets/Widgets';

export function NowScreen({ d, m, now, deviceId, onFocus, onPlan, onDone, onSchedule }: { d: Data; m: DayModel; now: number; deviceId: string; onFocus: () => void; onPlan: () => void; onDone?: () => void; onSchedule?: () => void }) {
  const theme = useOptionalTheme();
  const home = homeModel(d, now);
  const task = home.active;
  const drag = useDrag();
  const hero = useRef<HTMLElement>(null);
  // The focus area takes a card (start it); the task in focus can be dragged out to the shelf (pause it).
  useEffect(
    () =>
      registerTarget('focus-slot', {
        el: () => hero.current,
        accepts: (it) => it.kind === 'task' && it.taskId !== task?.id,
        drop: (it) => {
          if (it.kind !== 'task') return;
          void run({ type: 'task.start', id: it.taskId, run: true }).then((r) => r.ok && toast(`Started ${it.title}.`));
        },
      }),
    [task?.id],
  );
  const t = useTimer(task);
  const root = useRef<HTMLDivElement>(null);
  useHolo(root);
  const running = task?.runtime.status === 'running';
  const owner = ownsTimer(d, deviceId);
  const dropHold = useHold(() => {
    if (!task) return;
    void run({ type: 'task.drop', id: task.id }).then((r) => r.ok && toast('Dropped to the back of the queue. Time kept.'));
  }, 'Backspace');
  const hold = useHold(() => {
    if (!task) return;
    void run({ type: 'task.finish', id: task.id }).then((r) => r.ok && toast('Done.'));
  });
  const today = todayOf(d, now);
  const events = upcoming(d, now, today, 24);
  const nextEv = events[0];
  const thenEv = events[1];
  const queue = deriveQueue(d, now).filter((x) => x.id !== task?.id);
  const [pausing, setPausing] = useState(false);
  const pause = () => {
    if (!task || pausing) return;
    setPausing(true);
    void run({ type: 'task.pause', id: task.id }).finally(() => setPausing(false));
  };
  const block = task ? m.blocks.find((b) => b.taskId === task.id) : undefined;
  const nextText = nextEv ? `${nextEv.event.title}${nextEv.date !== today ? ' tomorrow' : ''} at ${clockOf(nextEv.start, nextEv.event.tz)}` : queue[0] ? queue[0].title : 'Nothing fixed ahead';
  const over = t ? t.overtime : 0;
  const main = t ? (t.remaining !== null ? (over > 0 ? over : t.remaining) : t.elapsed) : 0;
  const kind = theme?.theme.motion.signature.kind;
  const width = useWidth();
  const size = sizeFor(kind, width > 760 ? Math.min(width, 1500) * 0.55 : width);
  const tag = task?.tagId ? d.tags[task.tagId] : undefined;
  const [lead, ...rest] = task && task.title.includes(': ') ? task.title.split(': ') : ['', task?.title ?? ''];

  return (
    <div className="nowscreen" ref={root} style={{ '--c': `var(--${tag?.color ?? 'tag7'})` } as CSSProperties}>
      <div className="now-bar">
        <span className="now-free">{formatHuman(m.tl.workableMs)} free today</span>
        <span className="now-bar-gap" />
        <button className="btn btn-ghost btn-s" onClick={onPlan}><Icon name="calendar" size={14} /> Plan <kbd>P</kbd></button>
        <button className="btn btn-ghost btn-s" onClick={onFocus}><Icon name="bolt" size={14} /> Focus <kbd>F</kbd></button>
        {onDone && <button className="btn btn-ghost btn-s" onClick={onDone}><Icon name="list" size={14} /> Done today</button>}
        {onSchedule && <button className="btn btn-ghost btn-s" onClick={onSchedule}><Icon name="calendar" size={14} /> Schedule</button>}
      </div>

      <section ref={hero} className={`now-hero holo${drag?.target === 'focus-slot' ? ' drop-on' : ''}${!task ? ' is-empty' : ''}`} aria-label="Current task">
        {task ? (
          <>
            <div
              className="now-head now-grab"
              title="Drag to the shelf below to pause"
              onPointerDown={(e) => (e.target as HTMLElement).closest('button') || beginPress(e, { kind: 'task', taskId: task.id, title: task.title, dur: task.estimateMin ?? DEFAULT_DUR })}
            >
              <h1 className="now-title">
                {lead && <span className="light">{lead}: </span>}
                <span className="strong">{rest.join(': ')}</span>
              </h1>
              {block && <span className="chip-time">{formatHM(block.startMin)} to {formatHM(block.endMin)}</span>}
            </div>
            <div className="now-timer">
              <div className="sig-slot">
                <SignatureTimer progress={t?.progress ?? 0} remainingSec={main / 1000} elapsedSec={(t?.elapsed ?? 0) / 1000} estimateSec={task.estimateMin ? task.estimateMin * 60 : undefined} running={running} overrun={over > 0} size={size} onComplete={hold.pulse} />
              </div>
              <div className="now-actions">
                {owner ? (
                  <>
                    <button className="btn btn-accent btn-l" disabled={pausing} onClick={() => (running ? pause() : void run({ type: 'timer', action: 'start' }))}>
                      <Icon name={running ? 'pause' : 'play'} /> {running ? 'Pause' : task.runtime.status === 'paused' ? 'Resume' : 'Start'}
                    </button>
                    <HoldButton hold={hold} reduce={!!theme?.motionOff} label="Finish" title="Hold Enter for 2 seconds" hintId="now-hint" className="btn-hold" />
                    <HoldButton hold={dropHold} reduce={!!theme?.motionOff} label="Drop" title="Hold for 2 seconds (Backspace in Focus)" hintId="now-hint" icon="x" className="btn-hold btn-drop" />
                  </>
                ) : (
                  <button className="btn btn-ghost" onClick={() => void run({ type: 'timer.takeover' })}>Take over timer</button>
                )}
                <button className="link" onClick={onFocus}>Focus view <kbd>F</kbd></button>
              </div>
            </div>
            <p id="now-hint" className="sr-only">Hold Finish for 2 seconds to finish, or Drop to drop.</p>
          </>
        ) : (
          <div className="now-empty">
            <h1 className="now-title"><span className="strong">{home.shelf.length ? 'Drop a task here to start it' : 'Nothing for today yet'}</span></h1>
            <p className="muted">{home.shelf.length ? 'Drag a card up from the shelf, or start the next one.' : 'Press Ctrl+K and type a task. It lands here for today.'}</p>
            {queue[0] && (
              <button className="btn btn-accent" onClick={() => void run({ type: 'task.start', id: queue[0]!.id, run: true })}>
                <Icon name="play" /> Start {queue[0].title}
              </button>
            )}
          </div>
        )}
        <div className="now-next">
          <span>Next: <b>{nextText}</b></span>
          {thenEv && <span>Then: <b>{thenEv.event.title}{thenEv.date !== today ? ' tomorrow' : ''} at {clockOf(thenEv.start, thenEv.event.tz)}</b></span>}
          {!nextEv && queue[1] && <span>Then: <b>{queue[1].title}</b></span>}
        </div>
      </section>

      <aside className="now-side" aria-label="Today">
        <Widgets d={d} m={m} now={now} task={task} />
      </aside>

      <TodayShelf d={d} now={now} tasks={home.shelf} pausedIds={home.pausedIds} activeId={task?.id ?? null} />
    </div>
  );
}

export { blockSpan };
