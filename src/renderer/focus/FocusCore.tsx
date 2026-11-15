// Focus Core (§9.4): one stage. Tag, title, finish condition, the huge timer,
// Start/Pause (the one accent button), Skip phase in Pomodoro, mode switchable
// only before the first start, Finish (hold Enter for 2 s) and a quiet Drop (typed
// reason). A right rail shows what is next and the time left. A stray-thought
// input at the bottom saves an Idea without leaving focus.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { formatHuman, modeLabel } from '../../core/format';
import type { Data, Task, TimerMode } from '../../core/model/types';
import { checkpointDue } from '../../core/tasks/sprints';
import { activeTask, isLocked, ownsTimer } from '../../core/tasks/tasks';
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

type Ritual = { kind: 'drop' } | { kind: 'kill' } | null;

export function FocusCore({ d, m, now, deviceId, onPlan }: { d: Data; m: DayModel; now: number; deviceId: string; onPlan: () => void }) {
  const task = activeTask(d);
  if (!task) {
    return (
      <section className="focus focus-empty" aria-label="Focus">
        <p className="eyebrow">Focus</p>
        <h2 className="focus-title">Nothing in focus.</h2>
        <p className="muted">Give a task a finish condition and it moves here.</p>
        <button className="btn btn-ghost" onClick={onPlan}>
          Back to plan
        </button>
      </section>
    );
  }
  return <Stage d={d} m={m} now={now} task={task} deviceId={deviceId} />;
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
  const finishHold = useHold(() => void finish());
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
    };
    const down = handle('down');
    const up = handle('up');
    const blur = () => finishHold.release();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [owner, finishHold]);

  async function submitRitual() {
    if (!ritual) return;
    const r =
      ritual.kind === 'drop'
        ? await run({ type: 'task.drop', id: task.id, reason: text })
        : await run({ type: 'sprint.checkpoint', id: task.id, choice: 'kill', reason: text });
    if (!r.ok) return;
    setRitual(null);
    setText('');
    toast(ritual.kind === 'drop' ? 'Dropped to the back of the queue. Time kept.' : 'Sprint killed. Reason logged.');
  }

  const ritualOk = isDropReason(text);
  const over = t ? t.overtime : 0;
  const notes = live(d, 'ideas').filter((i) => i.taskId === task.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
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
        <p className="focus-fc">{task.finishCondition}</p>
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
                <HoldButton hold={finishHold} reduce={reduce} label="Hold Enter to finish" hintId="hold-hint" className="btn-hold" />
                {task.timer.mode === 'pomodoro' && (
                  <button className="btn btn-ghost" onClick={() => void run({ type: 'timer', action: 'skipPhase' })}>
                    <Icon name="skip" /> Skip phase
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        <p id="hold-hint" className="muted hold-hint">
          Hold Enter for 2 s to finish. Space starts or pauses.
        </p>
      </div>

      <aside className="focus-side" aria-label="Thinking space">
        <h3 className="eyebrow">Thinking space</h3>
        {notes.map((n, i) => (
          <p key={n.id} className={i === 0 ? 'note first' : 'note'}>
            {n.text}
          </p>
        ))}
        <form
          className="stray"
          onSubmit={(e) => {
            e.preventDefault();
            if (!thought.trim()) return;
            void run({ type: 'idea.add', text: thought, taskId: task.id }).then((r) => r.ok && setThought(''));
          }}
        >
          <Icon name="idea" />
          <input value={thought} onChange={(e) => setThought(e.target.value)} placeholder="Stray thought? Type it, press Enter, keep going." aria-label="Stray thought" maxLength={1000} />
        </form>
      </aside>
      <div className="focus-more">
        <div className="stage-more">
          {!isLocked(task) && <ModePicker task={task} />}
          {owner && (
            <button className="link" onClick={() => setRitual({ kind: 'drop' })}>
              Drop this task
            </button>
          )}
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
              <span className="eyebrow">{ritual.kind === 'drop' ? 'Why drop it? (at least 3 characters)' : 'Why kill it? (at least 3 characters)'}</span>
              <input autoFocus value={text} onChange={(e) => setText(e.target.value)} aria-label="Reason" />
            </label>
            <div className="row gap">
              <button type="button" className="btn btn-ghost" onClick={() => (setRitual(null), setText(''))}>
                Cancel
              </button>
              <button type="submit" className="btn" disabled={!ritualOk}>
                {ritual.kind === 'drop' ? 'Drop task' : 'Kill sprint'}
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
