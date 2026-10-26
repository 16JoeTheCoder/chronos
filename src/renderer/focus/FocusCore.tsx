// Focus Core (§9.4): one stage. Tag, title, finish condition, the huge timer,
// Start/Pause (the one accent button), Skip phase in Pomodoro, mode switchable
// only before the first start, Finish (typed phrase) and a quiet Drop (typed
// reason). A right rail shows what is next and the time left. A stray-thought
// input at the bottom saves an Idea without leaving focus.

import { useState, type CSSProperties } from 'react';
import { clockOf, formatHuman, modeLabel } from '../../core/format';
import type { Data, Task, TimerMode } from '../../core/model/types';
import { checkpointDue } from '../../core/tasks/sprints';
import { activeTask, isLocked, ownsTimer, todayOf } from '../../core/tasks/tasks';
import { upcoming } from '../../core/time/schedule';
import { FINISH_PHRASE, isDropReason, isFinishPhrase } from '../../core/validation';
import { timerOf } from '../../core/repo/repo';
import { Icon } from '../components/Icon';
import { Segmented } from '../components/ui';
import { run, toast } from '../store';
import type { DayModel } from '../runway/model';
import { TimerDigits, useTimer } from './TimerDigits';

type Ritual = { kind: 'finish' } | { kind: 'drop' } | { kind: 'kill' } | null;

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
  const tag = task.tagId ? d.tags[task.tagId] : undefined;
  const running = task.runtime.status === 'running';
  const owner = ownsTimer(d, deviceId);
  const next = upcoming(d, now, todayOf(d, now), 24)[0];
  const due = checkpointDue(task, now);

  async function submitRitual() {
    if (!ritual) return;
    const r =
      ritual.kind === 'finish'
        ? await run({ type: 'task.finish', id: task.id, phrase: text })
        : ritual.kind === 'drop'
          ? await run({ type: 'task.drop', id: task.id, reason: text })
          : await run({ type: 'sprint.checkpoint', id: task.id, choice: 'kill', reason: text });
    if (!r.ok) return;
    setRitual(null);
    setText('');
    if (ritual.kind === 'finish') {
      const done = Object.values(d.tasks).filter((x) => x.status === 'done' && x.outcome !== 'killed' && (x.completedAt ?? 0) >= m.from).length + 1;
      toast(`Done. ${done} finished today.`);
    } else toast(ritual.kind === 'drop' ? 'Dropped to the back of the queue. Time kept.' : 'Sprint killed. Reason logged.');
  }

  const ritualOk = ritual?.kind === 'finish' ? isFinishPhrase(text) : isDropReason(text);
  return (
    <section className="focus" aria-label="Focus" style={{ '--c': `var(--${tag?.color ?? 'tag7'})` } as CSSProperties}>
      <div className="stage">
        <div className="stage-meta">
          {tag && <span className="chip-tag">{tag.name}</span>}
          {task.kind === 'sprint' && <span className="prio">sprint</span>}
          {task.timer.mode === 'pomodoro' && t && <span className="muted">Pomodoro {t.cycle} of {task.timer.pomodoro.sessionsBeforeLongBreak}</span>}
        </div>
        <h2 className="focus-title">{task.title}</h2>
        <p className="focus-fc">{task.finishCondition}</p>
        <TimerDigits task={task} size="hero" />
        {!owner ? (
          <div className="row gap">
            <span className="muted">Running on {timerOf(d).ownerName || 'another device'}.</span>
            <button className="btn btn-ghost" onClick={() => void run({ type: 'timer.takeover' })}>
              Take over
            </button>
          </div>
        ) : (
          <div className="row gap controls">
            <button className="btn btn-accent btn-l" onClick={() => void run({ type: 'timer', action: running ? 'pause' : 'start' })} aria-keyshortcuts="Control+Alt+P">
              <Icon name={running ? 'pause' : 'play'} /> {running ? 'Pause' : task.runtime.status === 'paused' ? 'Resume' : 'Start'}
            </button>
            {task.timer.mode === 'pomodoro' && (
              <button className="btn btn-ghost" onClick={() => void run({ type: 'timer', action: 'skipPhase' })}>
                <Icon name="skip" /> Skip phase
              </button>
            )}
            <button className="btn" onClick={() => setRitual({ kind: 'finish' })}>
              <Icon name="check" /> Finish
            </button>
          </div>
        )}
        {!isLocked(task) && <ModePicker task={task} />}
        {owner && (
          <button className="link" onClick={() => setRitual({ kind: 'drop' })}>
            Drop this task
          </button>
        )}

        {due && (
          <div className="checkpoint" role="region" aria-label="Sprint checkpoint">
            <p>
              <b>{formatHuman(t?.workMs ?? task.workMs)}</b> into this sprint. Keep going, ship it, or kill it?
            </p>
            <div className="row gap">
              <button className="btn btn-ghost" onClick={() => void run({ type: 'sprint.checkpoint', id: task.id, choice: 'continue' })}>
                Continue
              </button>
              <button className="btn" onClick={() => setRitual({ kind: 'finish' })}>
                Ship
              </button>
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
              <span className="eyebrow">{ritual.kind === 'finish' ? `Type: ${FINISH_PHRASE}` : ritual.kind === 'drop' ? 'Why drop it? (at least 3 characters)' : 'Why kill it? (at least 3 characters)'}</span>
              {ritual.kind === 'finish' && <span className="muted">Finished means: {task.finishCondition}</span>}
              <input autoFocus value={text} onChange={(e) => setText(e.target.value)} aria-label={ritual.kind === 'finish' ? 'Finish phrase' : 'Reason'} />
            </label>
            <div className="row gap">
              <button type="button" className="btn btn-ghost" onClick={() => (setRitual(null), setText(''))}>
                Cancel
              </button>
              <button type="submit" className="btn" disabled={!ritualOk}>
                {ritual.kind === 'finish' ? (task.kind === 'sprint' ? 'Ship it' : 'Finish task') : ritual.kind === 'drop' ? 'Drop task' : 'Kill sprint'}
              </button>
            </div>
          </form>
        )}
      </div>

      <aside className="rail" aria-label="Day">
        <p className="eyebrow">Next</p>
        <p>{next ? `${next.event.title} ${clockOf(next.start, next.event.tz)} · in ${formatHuman(next.start - now)}` : 'Nothing fixed ahead.'}</p>
        <p className="eyebrow">Left today</p>
        <p>{formatHuman(m.tl.workableMs)}</p>
        <p className="eyebrow">Tracked</p>
        <p>{formatHuman(t?.workMs ?? task.workMs)}</p>
      </aside>

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
    </section>
  );
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
