// Timer engine (ported from Monolith): pure functions over a task's runtime,
// always given an explicit `now`. Time is never counted with an interval; it is
// derived from timestamps. A "slice" is one uninterrupted running stretch.
// Closing a slice folds it into phaseElapsedMs and the work/break totals and
// returns it, so the caller can record a Session. Pomodoro boundaries close the
// slice at the phase's exact end, so a late tick never leaks break into work.

import { idleRuntime } from '../model/defaults';
import type { Phase, Slice, Task, TimerEvent } from '../model/types';

export type TimerTask = Pick<Task, 'id' | 'timer' | 'runtime' | 'workMs' | 'breakMs' | 'pomodorosCompleted' | 'estimateMin'>;
export interface Step<T extends TimerTask> {
  task: T;
  events: TimerEvent[];
  slices: Slice[];
}

const MAX_TRANSITIONS = 1000;

/** Elapsed time in the current phase. A clock that moved backwards contributes 0, never negative. */
export function phaseElapsed(rt: Task['runtime'], now: number): number {
  return rt.phaseElapsedMs + (rt.sliceStartedAt !== null ? Math.max(0, now - rt.sliceStartedAt) : 0);
}

export function phaseDuration(task: TimerTask, phase: Phase = task.runtime.phase): number | null {
  const { mode, countdown, pomodoro } = task.timer;
  if (mode === 'countdown') return countdown.durationMs;
  if (mode === 'stopwatch') return null;
  if (phase === 'work') return pomodoro.workMs;
  return phase === 'shortBreak' ? pomodoro.shortBreakMs : pomodoro.longBreakMs;
}

const isBreak = (phase: Phase) => phase !== 'work';

/** Close the running slice at `at`, crediting work or break time. No-op if not running. */
function closeSlice<T extends TimerTask>(task: T, at: number): { task: T; slice: Slice | null } {
  const rt = task.runtime;
  if (rt.sliceStartedAt === null) return { task, slice: null };
  const end = Math.max(at, rt.sliceStartedAt);
  const ms = end - rt.sliceStartedAt;
  const phase: Slice['phase'] = task.timer.mode === 'pomodoro' && isBreak(rt.phase) ? 'break' : 'work';
  return {
    task: {
      ...task,
      workMs: task.workMs + (phase === 'work' ? ms : 0),
      breakMs: task.breakMs + (phase === 'break' ? ms : 0),
      runtime: { ...rt, phaseElapsedMs: rt.phaseElapsedMs + ms, sliceStartedAt: null },
    },
    slice: ms > 0 ? { startedAt: rt.sliceStartedAt, endedAt: end, phase } : null,
  };
}

function close<T extends TimerTask>(s: Step<T>, at: number): Step<T> {
  const c = closeSlice(s.task, at);
  return { task: c.task, events: s.events, slices: c.slice ? [...s.slices, c.slice] : s.slices };
}

/** Process every boundary crossed up to `now`. */
export function advance<T extends TimerTask>(task: T, now: number): Step<T> {
  let s: Step<T> = { task, events: [], slices: [] };
  for (let guard = 0; guard < MAX_TRANSITIONS; guard++) {
    const t = s.task;
    const rt = t.runtime;
    if (rt.status !== 'running' || rt.sliceStartedAt === null) break;
    const dur = phaseDuration(t);
    if (dur === null || phaseElapsed(rt, now) < dur) break;
    // The exact instant this phase ended, independent of when we noticed it.
    const end = rt.sliceStartedAt + Math.max(0, dur - rt.phaseElapsedMs);

    if (t.timer.mode === 'countdown') {
      if (t.timer.countdown.onExpire === 'stop') {
        s = close(s, end);
        s.task = { ...s.task, runtime: { ...s.task.runtime, status: 'completed', phaseElapsedMs: dur, expiredNotified: true } };
        s.events = [...s.events, { kind: 'countdownExpired', taskId: t.id, from: 'work', to: 'work', autoStarted: false }];
      } else if (!rt.expiredNotified) {
        s.task = { ...t, runtime: { ...rt, expiredNotified: true } };
        s.events = [...s.events, { kind: 'countdownExpired', taskId: t.id, from: 'work', to: 'work', autoStarted: true }];
      }
      break;
    }

    s = close(s, end);
    const p = s.task.timer.pomodoro;
    const from = s.task.runtime.phase;
    let next: Phase = 'work';
    let pomodoros = s.task.pomodorosCompleted;
    let cycle = s.task.runtime.cycleSessions;
    if (from === 'work') {
      pomodoros += 1;
      cycle += 1;
      next = cycle >= p.sessionsBeforeLongBreak ? 'longBreak' : 'shortBreak';
      if (next === 'longBreak') cycle = 0;
    }
    const autoStart = isBreak(next) ? p.autoStartBreaks : p.autoStartWork;
    s.task = {
      ...s.task,
      pomodorosCompleted: pomodoros,
      runtime: { ...s.task.runtime, phase: next, cycleSessions: cycle, phaseElapsedMs: 0, status: autoStart ? 'running' : 'idle', sliceStartedAt: autoStart ? end : null },
    };
    s.events = [...s.events, { kind: 'phaseEnded', taskId: t.id, from, to: next, autoStarted: autoStart }];
  }
  return s;
}

/** Start or resume. Starting a countdown that already ran out begins a fresh round (totals kept). */
export function start<T extends TimerTask>(task: T, now: number): T {
  if (task.runtime.status === 'running') return task;
  let rt = task.runtime;
  if (rt.status === 'completed') rt = { ...rt, phaseElapsedMs: 0, expiredNotified: false };
  return { ...task, runtime: { ...rt, status: 'running', sliceStartedAt: now } };
}

/** Process boundaries up to `at`, then close the slice there and pause. */
export function pauseAt<T extends TimerTask>(task: T, at: number): Step<T> {
  const s = advance(task, at);
  if (s.task.runtime.status !== 'running') return s;
  const c = close(s, at);
  return { ...c, task: { ...c.task, runtime: { ...c.task.runtime, status: 'paused' } } };
}

/** Zero the current display and cycle. Totals stay. */
export function reset<T extends TimerTask>(task: T, now: number): Step<T> {
  const s = close(advance(task, now), now);
  return { ...s, task: { ...s.task, runtime: idleRuntime() } };
}

/** Stop completely (finish, drop): bank the running slice and return to idle. */
export const stop = reset;

/** Pomodoro only: end the current phase now. Skipping work earns no pomodoro credit. */
export function skipPhase<T extends TimerTask>(task: T, now: number): Step<T> {
  if (task.timer.mode !== 'pomodoro') return { task, events: [], slices: [] };
  const s = close(advance(task, now), now);
  const t = s.task;
  const from = t.runtime.phase;
  let next: Phase = 'work';
  let cycle = t.runtime.cycleSessions;
  if (from === 'work') {
    next = cycle + 1 >= t.timer.pomodoro.sessionsBeforeLongBreak ? 'longBreak' : 'shortBreak';
    if (next === 'longBreak') cycle = 0;
  }
  const autoStart = isBreak(next) ? t.timer.pomodoro.autoStartBreaks : t.timer.pomodoro.autoStartWork;
  return {
    task: { ...t, runtime: { ...t.runtime, phase: next, cycleSessions: cycle, phaseElapsedMs: 0, status: autoStart ? 'running' : 'idle', sliceStartedAt: autoStart ? now : null } },
    events: [...s.events, { kind: 'phaseEnded', taskId: t.id, from, to: next, autoStarted: autoStart }],
    slices: s.slices,
  };
}

export interface TimerDisplay {
  status: Task['runtime']['status'];
  phase: Phase;
  elapsed: number;
  remaining: number | null;
  overtime: number;
  progress: number | null;
  expired: boolean;
  workMs: number;
  breakMs: number;
  pomodorosCompleted: number;
  cycle: number;
}

/** What to show right now. The renderer calls this every 250 ms from a snapshot. */
export function display(task: TimerTask, now: number): TimerDisplay {
  const t = advance(task, now).task;
  const rt = t.runtime;
  const elapsed = phaseElapsed(rt, now);
  const live = rt.sliceStartedAt !== null ? Math.max(0, now - rt.sliceStartedAt) : 0;
  const liveIsBreak = t.timer.mode === 'pomodoro' && isBreak(rt.phase);
  const workMs = t.workMs + (liveIsBreak ? 0 : live);
  const breakMs = t.breakMs + (liveIsBreak ? live : 0);
  const dur = phaseDuration(t);
  const estimateMs = (t.estimateMin ?? 0) * 60_000;
  let remaining: number | null = null;
  let overtime = 0;
  let progress: number | null = null;
  if (dur !== null) {
    remaining = Math.max(0, dur - elapsed);
    overtime = Math.max(0, elapsed - dur);
    progress = dur > 0 ? Math.min(1, elapsed / dur) : 1;
  } else if (estimateMs > 0) {
    progress = Math.min(1, workMs / estimateMs);
  }
  return {
    status: rt.status,
    phase: rt.phase,
    elapsed,
    remaining,
    overtime,
    progress,
    expired: t.timer.mode === 'countdown' && dur !== null && elapsed >= dur,
    workMs,
    breakMs,
    pomodorosCompleted: t.pomodorosCompleted,
    cycle: Math.min(rt.cycleSessions + 1, t.timer.pomodoro.sessionsBeforeLongBreak),
  };
}
