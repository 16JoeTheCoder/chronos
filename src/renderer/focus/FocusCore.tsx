// Focus Core (§9.4): one stage. Tag, title, the huge timer,
// Start/Pause (the one accent button), Skip phase in Pomodoro, mode switchable
// only before the first start, Finish (hold Enter for 2 s) and Drop (hold Backspace for 2 s,
// no reason asked). The right column is the thinking space (Phase 3.7 §8): an input at the top that
// grows with the text, then this task's notes, newest first, with times. A line with TASK at
// its start or end becomes a task instead of a note.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { clockOf, dateLabel, formatHuman, modeLabel } from '../../core/format';
import { todayOf } from '../../core/tasks/tasks';
import type { Data, Task, TimerMode } from '../../core/model/types';
import { checkpointDue } from '../../core/tasks/sprints';
import { activeTask, deriveQueue, isLocked, ownsTimer } from '../../core/tasks/tasks';
import { taskLineAt } from '../../core/log/smartText';
import { taskFromLine } from '../components/smartText';
import { api } from '../api';
import { isDropReason } from '../../core/validation';
import { live, settingsOf, timerOf } from '../../core/repo/repo';
import { Icon } from '../components/Icon';
import { Segmented } from '../components/ui';
import { run, toast } from '../store';
import type { DayModel } from '../runway/model';
import { SignatureTimer } from '../signature/SignatureTimer';
import { useOptionalTheme } from '../theme/ThemeProvider';
import { HoldButton, useHold } from './HoldButton';
import { keyAction, targetOf } from './keys';
import { useTimer } from './TimerDigits';

type Ritual = { kind: 'kill' } | null;

export function FocusCore({ d, m, now, deviceId, onPlan }: { d: Data; m: DayModel; now: number; deviceId: string; onPlan: () => void }) {
  const task = activeTask(d);
  if (!task) return <EmptyFocus d={d} now={now} onPlan={onPlan} />;
  return <Stage d={d} m={m} now={now} task={task} deviceId={deviceId} />;
}

/** Nothing in focus: Space (or the button) starts the head of the queue. */
function EmptyFocus({ d, now, onPlan }: { d: Data; now: number; onPlan: () => void }) {
  const next = deriveQueue(d, now)[0];
  useEffect(() => {
    if (!next) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.repeat || targetOf(document.activeElement) === 'text' || document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      void run({ type: 'task.start', id: next.id, run: true });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  {
    return (
      <section className="focus focus-empty" aria-label="Focus">
        <h2 className="focus-title">Nothing in focus</h2>
        <p className="muted">{next ? 'Press Space to start the next task, or start one from Home or Tasks.' : 'Add a task with Ctrl+K, then start it here.'}</p>
        <div className="row gap">
          {next && (
            <button className="btn btn-accent" onClick={() => void run({ type: 'task.start', id: next.id, run: true })}>
              <Icon name="play" /> Start {next.title}
            </button>
          )}
          <button className="btn btn-ghost" onClick={onPlan}>Open the plan</button>
        </div>
      </section>
    );
  }
}

function Stage({ d, m, now, task, deviceId }: { d: Data; m: DayModel; now: number; task: Task; deviceId: string }) {
  const [ritual, setRitual] = useState<Ritual>(null);
  const [text, setText] = useState('');
  const [thought, setThought] = useState('');
  const t = useTimer(task);
  const theme = useOptionalTheme();
  const s = settingsOf(d);
  const tag = task.tagId ? d.tags[task.tagId] : undefined;
  const running = task.runtime.status === 'running';
  const owner = ownsTimer(d, deviceId);
  const due = checkpointDue(task, now);
  const width = useWidth();

  const reduce = useReduceMotion(s.reduceMotion) || !!theme?.motionOff;
  const toggle = () => {
    if (owner) void run({ type: 'timer', action: running ? 'pause' : 'start' });
  };

  async function finish() {
    const r = await run({ type: 'task.finish', id: task.id });
    if (!r.ok) return;
    const done = Object.values(d.tasks).filter((x) => x.status === 'done' && x.outcome !== 'killed' && (x.completedAt ?? 0) >= m.from).length + 1;
    toast(`Done. ${done} finished today.`);
  }
  async function drop() {
    const r = await run({ type: 'task.drop', id: task.id });
    if (r.ok) toast('Dropped to the back of the queue. Time kept.');
  }
  const finishHold = useHold(() => void finish());
  const dropHold = useHold(() => void drop(), 'Backspace');
  const shipHold = useHold(() => void finish());

  // Window-level keys: Space and hold-Enter work as soon as Focus is up, with no click first.
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    if (!owner) return;
    const handle = (type: 'down' | 'up') => (e: KeyboardEvent) => {
      const act = keyAction({ type, key: e.key, repeat: e.repeat, modifier: e.ctrlKey || e.altKey || e.metaKey, target: targetOf(document.activeElement), dialogOpen: !!document.querySelector('[aria-modal="true"]') });
      if (!act) return;
      e.preventDefault();
      if (act === 'toggle') toggleRef.current();
      else if (act === 'press') finishHold.press('enter');
      else if (act === 'release') finishHold.release();
      else if (act === 'dropPress') dropHold.press('backspace');
      else if (act === 'dropRelease') dropHold.release();
    };
    const down = handle('down');
    const up = handle('up');
    const blur = () => { finishHold.release(); dropHold.release(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [owner, finishHold, dropHold]);

  async function submitRitual() {
    if (!ritual) return;
    const r = await run({ type: 'sprint.checkpoint', id: task.id, choice: 'kill', reason: text });
    if (!r.ok) return;
    setRitual(null);
    setText('');
    toast('Sprint killed. Reason logged.');
  }

  const ritualOk = isDropReason(text);
  const over = t ? t.overtime : 0;
  const notes = live(d, 'ideas').filter((i) => i.taskId === task.id).sort((a, b) => b.createdAt - a.createdAt);
  const addThought = async () => {
    const body = thought.trim();
    if (!body) return;
    const line = taskLineAt(body, body.length);
    if (line && !body.includes('\n')) {
      const id = await taskFromLine(line.body, d, { projectId: task.projectId });
      if (id) { setThought(''); toast(`Task added: ${line.body}`, { undo: () => void api.command({ type: 'recycle', coll: 'tasks', id, confirmed: true }) }); }
      return;
    }
    const r = await run({ type: 'idea.add', text: body, taskId: task.id, projectId: task.projectId });
    if (r.ok) setThought('');
  };
  const [lead, ...rest] = task.title.includes(': ') ? task.title.split(': ') : ['', task.title];
  const main = t ? (t.remaining !== null ? (over > 0 ? over : t.remaining) : t.elapsed) : 0;
  const sigSize = sizeFor(theme?.theme.motion.signature.kind, width);

  return (
    <section className="focus" aria-label="Focus" style={{ '--c': `var(--${tag?.color ?? 'tag7'})` } as CSSProperties}>
      <div className="stage hold-target">
        {task.timer.mode === 'pomodoro' && t && <div className="stage-meta"><span className="muted">Pomodoro {t.cycle} of {task.timer.pomodoro.sessionsBeforeLongBreak}</span></div>}
        <h2 className="focus-title" tabIndex={0} aria-describedby="hold-hint">
          {lead && <span className="light">{lead}: </span>}
          <span className="strong">{rest.join(': ')}</span>
        </h2>
        <div className="timer-row">
          <div className="sig-slot">
            <SignatureTimer
              progress={t?.progress ?? 0}
              remainingSec={main / 1000}
              elapsedSec={(t?.elapsed ?? 0) / 1000}
              estimateSec={task.estimateMin ? task.estimateMin * 60 : undefined}
              running={running}
              overrun={over > 0}
              size={sigSize}
              onComplete={finishHold.pulse}
            />
          </div>
          <div className="controls">
            {!owner ? (
              <>
                <span className="muted">Running on {timerOf(d).ownerName || 'another device'}.</span>
                <button className="btn btn-ghost" onClick={() => void run({ type: 'timer.takeover' })}>
                  Take over
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-accent btn-l" onClick={toggle} aria-keyshortcuts="Space">
                  <Icon name={running ? 'pause' : 'play'} /> {running ? 'Pause' : task.runtime.status === 'paused' ? 'Resume' : 'Start'}
                </button>
                <HoldButton hold={finishHold} reduce={reduce} label="Finish" title="Hold Enter for 2 seconds" hintId="hold-hint" className="btn-hold" />
                <HoldButton hold={dropHold} reduce={reduce} label="Drop" title="Hold Backspace for 2 seconds" hintId="hold-hint" icon="x" className="btn-hold btn-drop" />
                {task.timer.mode === 'pomodoro' && (
                  <button className="btn btn-ghost" onClick={() => void run({ type: 'timer', action: 'skipPhase' })}>
                    <Icon name="skip" /> Skip phase
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        <p id="hold-hint" className="sr-only">
          Hold Enter for 2 seconds to finish, or Backspace for 2 seconds to drop. Space starts or pauses. Esc leaves Focus.
        </p>
      </div>

      <aside className="focus-side" aria-label="Thinking space">
        <h3 className="ts-title">Thinking space</h3>
        <div className="stray">
          <Icon name="idea" />
          <textarea
            value={thought}
            rows={1}
            onChange={(e) => { setThought(e.target.value); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`; }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void addThought(); } }}
            placeholder="A thought for later"
            aria-label="A thought for later. Enter saves it, Shift Enter adds a line."
            maxLength={1000}
          />
        </div>
        <p className="ts-hint">Enter saves · end with TASK to add a task</p>
        {notes.length === 0 ? (
          <p className="ts-empty">Thoughts you save while working on this task collect here.</p>
        ) : (
          <ol className="ts-list">
            {notes.map((n) => (
              <li key={n.id}>
                <p>{n.body || n.text}</p>
                <time dateTime={new Date(n.createdAt).toISOString()}>{clockOf(n.createdAt, s.timezone)}{todayOf(d, n.createdAt) !== todayOf(d, now) ? ` · ${dateLabel(todayOf(d, n.createdAt))}` : ''}</time>
              </li>
            ))}
          </ol>
        )}
      </aside>
      <div className="focus-more">
        <div className="stage-more">
          {!isLocked(task) && <ModePicker task={task} />}
        </div>

        {due && (
          <div className="checkpoint" role="region" aria-label="Sprint checkpoint">
            <p>
              <b>{formatHuman(t?.workMs ?? task.workMs)}</b> into this sprint. Keep going, ship it, or kill it?
            </p>
            <div className="row gap">
              <button className="btn btn-ghost" onClick={() => void run({ type: 'sprint.checkpoint', id: task.id, choice: 'continue' })}>
                Continue
              </button>
              <HoldButton hold={shipHold} reduce={reduce} label="Ship" hintId="hold-hint" />
              <button className="btn btn-ghost" onClick={() => setRitual({ kind: 'kill' })}>
                Kill
              </button>
            </div>
          </div>
        )}

        {ritual && (
          <form
            className="ritual"
            onSubmit={(e) => {
              e.preventDefault();
              void submitRitual();
            }}
          >
            <label className="field">
              <span className="eyebrow">Why kill it? (at least 3 characters)</span>
              <input autoFocus value={text} onChange={(e) => setText(e.target.value)} aria-label="Reason" />
            </label>
            <div className="row gap">
              <button type="button" className="btn btn-ghost" onClick={() => (setRitual(null), setText(''))}>
                Cancel
              </button>
              <button type="submit" className="btn" disabled={!ritualOk}>
                Kill sprint
              </button>
            </div>
          </form>
        )}
      </div>
      <p className="sr-only">Esc leaves Focus.</p>
    </section>
  );
}

/** Signature size for the viewport: the theme's full size, shrunk to fit narrow windows. */
export function sizeFor(kind: string | undefined, width: number): number {
  // Text-based signatures (digits, mission clock, lap timer) size by font; rings and slabs by box.
  const text = kind === 'ticking-digits' || kind === 'mission-clock' || kind === 'lap-timer' || !kind;
  const full = kind === 'reactor-ring' ? 380 : kind === 'slab-monolith' ? (width < 760 ? 220 : 300) : kind === 'accretion-ring' ? 440 : kind === 'lap-timer' ? 150 : 112;
  const room = text ? width * (kind === 'lap-timer' ? 0.11 : 0.2) : width - 96;
  return Math.max(text ? 56 : 200, Math.min(full, room));
}

export function useWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

function ModePicker({ task }: { task: Task }) {
  const set = (mode: TimerMode) => void run({ type: 'task.update', id: task.id, input: { timer: { ...task.timer, mode } } });
  const mins = Math.round(task.timer.countdown.durationMs / 60_000);
  return (
    <div className="row gap mode">
      <Segmented<TimerMode> label="Timer mode" value={task.timer.mode} options={(['countdown', 'pomodoro', 'stopwatch'] as const).map((x) => [x, modeLabel(x)])} onChange={set} />
      {task.timer.mode === 'countdown' && (
        <label className="inline">
          <input
            type="number"
            min={1}
            max={1440}
            value={mins}
            aria-label="Countdown minutes"
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 1) void run({ type: 'task.update', id: task.id, input: { timer: { ...task.timer, countdown: { ...task.timer.countdown, durationMs: v * 60_000 } } } });
            }}
          />{' '}
          min
        </label>
      )}
    </div>
  );
}

/** The Motion setting, or the OS preference when it follows Windows. */
function useReduceMotion(setting: boolean | null): boolean {
  const [os, setOs] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setOs(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return setting ?? os;
}
