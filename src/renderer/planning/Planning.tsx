// The planning prompts (PHASE23 §1, §4). Only three things may interrupt:
//   1. an upcoming fixed event (the Strips / heads-up in Home),
//   2. the end-of-day review (ReviewDialog),
//   3. the break prompt at the end of a long block (BreakCard).
// The morning proposal is not an interruption: it is a quiet card that appears when Chronos is
// opened for the first time in a day. Enter accepts, Esc or "Not today" skips. Every automatic
// action reports itself on a toast with Undo (and Ctrl+Z).

import { useEffect, useMemo, useState } from 'react';
import { formatHM, formatHuman } from '../../core/format';
import type { ReviewAction } from '../../core/model/types';
import { autoPlan } from '../../core/planning/plan';
import { pendingReview } from '../../core/planning/review';
import { breakDue } from '../../core/planning/wellness';
import { settingsOf } from '../../core/repo/repo';
import { metrics } from '../../core/tasks/metrics';
import { todayOf } from '../../core/tasks/tasks';
import { localParts } from '../../core/time/zone';
import type { Data } from '../../core/model/types';
import { Dialog } from '../components/ui';
import { run, runWithToast, toast, undoFor } from '../store';
import { planDay } from './actions';
import { deferReview, markBreak, markMorning, morningDone, reviewDeferred, shownBreaks } from './storage';

/** True when a key event is for the page, not for a text field, a dialog or another control. */
const free = (e: KeyboardEvent) => !(e.target as HTMLElement | null)?.closest('input, textarea, select, button, a, [contenteditable]') && !document.querySelector('[aria-modal="true"]') && !e.ctrlKey && !e.altKey && !e.metaKey;

export function MorningStart({ d, now, active, deviceId }: { d: Data; now: number; active: boolean; deviceId: string }) {
  const today = todayOf(d, now);
  const [gone, setGone] = useState(() => morningDone(today));
  const s = settingsOf(d);
  const plan = useMemo(() => (gone || !s.onboarded ? null : autoPlan(d, today, { now, deviceId })), [gone, s.onboarded, d, today, now, deviceId]);
  const show = active && !!plan && plan.placed.length > 0;
  const close = () => {
    markMorning(today);
    setGone(true);
  };
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (!free(e)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        void planDay(today);
        close();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [show, today]);
  if (!show || !plan) return null;
  const shown = plan.placed.slice(0, 4);
  return (
    <section className="morning" aria-label="Plan your day">
      <div className="morning-head">
        <h2>Plan your day</h2>
        <span className="muted">
          {plan.placed.length} {plan.placed.length === 1 ? 'block' : 'blocks'} fit
        </span>
      </div>
      <ul className="morning-list">
        {shown.map((b) => (
          <li key={b.blockId}>
            <span className="mono">{formatHM(b.startMin)}</span>
            <span>{b.title}</span>
            <span className="muted">{formatHuman((b.endMin - b.startMin) * 60_000)}</span>
          </li>
        ))}
        {plan.placed.length > shown.length && <li className="muted">and {plan.placed.length - shown.length} more</li>}
      </ul>
      <div className="row gap">
        <button
          className="btn"
          onClick={() => {
            void planDay(today);
            close();
          }}
        >
          Plan my day <kbd>Enter</kbd>
        </button>
        <button className="btn btn-ghost" onClick={close}>
          Not today <kbd>Esc</kbd>
        </button>
      </div>
    </section>
  );
}

const CHOICES: [ReviewAction, string][] = [
  ['tomorrow', 'Tomorrow'],
  ['unscheduled', 'Unscheduled'],
  ['dropped', 'Drop'],
  ['done', 'Done'],
];

/** End-of-day review: each unfinished planned task is asked once. Defaults to tomorrow; one tap changes it. */
export function ReviewHost({ d, now }: { d: Data; now: number }) {
  const [, tick] = useState(0);
  const review = pendingReview(d, now);
  if (!review || reviewDeferred(review.date)) return null;
  return <ReviewDialog key={review.date} d={d} now={now} date={review.date} tasks={review.tasks.map((t) => ({ id: t.id, title: t.title }))} onLater={() => (deferReview(review.date), tick((n) => n + 1))} />;
}

function ReviewDialog({ d, now, date, tasks, onLater }: { d: Data; now: number; date: string; tasks: { id: string; title: string }[]; onLater: () => void }) {
  const [answers, setAnswers] = useState<Record<string, ReviewAction>>(() => Object.fromEntries(tasks.map((t) => [t.id, 'tomorrow' as ReviewAction])));
  const m = metrics(d, now);
  const submit = async () => {
    const outcomes = tasks.map((t) => ({ taskId: t.id, action: answers[t.id] ?? 'tomorrow' }));
    const r = await run({ type: 'review.submit', date, outcomes });
    if (!r.ok) return;
    const n = outcomes.filter((o) => o.action === 'tomorrow').length;
    toast(n ? `Day closed. ${n} moved to tomorrow.` : 'Day closed.', { undo: undoFor(r) });
  };
  return (
    <Dialog title="Close the day" onClose={onLater} wide>
      <div className="review-sum">
        <svg className="rev-dial" width="84" height="84" viewBox="0 0 200 200" role="img" aria-label="Day dial closing">
          <circle className="rev-track" cx="100" cy="100" r="80" />
          <circle className="rev-arc" cx="100" cy="100" r="80" strokeDasharray="502.7 502.7" transform="rotate(-90 100 100)" />
        </svg>
        <div>
          <p className="w-big sm">{formatHuman(m.focusTodayMs)}</p>
          <p className="muted">
            focused today · {m.finishedToday} {m.finishedToday === 1 ? 'task' : 'tasks'} done
          </p>
        </div>
      </div>
      <p className="muted">Where does each of these go? One tap each; Tomorrow is the default.</p>
      <ul className="review-list">
        {tasks.map((t) => (
          <li key={t.id}>
            <span className="review-title">{t.title}</span>
            <div className="seg" role="radiogroup" aria-label={`Where does ${t.title} go`}>
              {CHOICES.map(([v, label]) => (
                <button key={v} role="radio" aria-checked={answers[t.id] === v} className={answers[t.id] === v ? 'on' : ''} tabIndex={answers[t.id] === v ? 0 : -1} onClick={() => setAnswers({ ...answers, [t.id]: v })}>
                  {label}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="row end gap">
        <button className="btn btn-ghost" onClick={onLater}>
          Later
        </button>
        <button className="btn" data-autofocus onClick={() => void submit()}>
          Close the day
        </button>
      </div>
    </Dialog>
  );
}

/** Break prompt: only when `breakDue` says so (a long block just ended; never mid-block). */
export function BreakCard({ d, now }: { d: Data; now: number }) {
  const [shown, setShown] = useState(shownBreaks);
  const due = breakDue(d, now, shown);
  if (!due) return null;
  const dismiss = () => {
    markBreak(due.blockId);
    setShown(new Set([...shown, due.blockId]));
  };
  const take = async () => {
    const tz = settingsOf(d).timezone;
    const start = Math.ceil(localParts(now, tz).minutes / 5) * 5;
    const r = await run({ type: 'block.create', taskId: null, date: todayOf(d, now), startMin: start, endMin: start + 10, title: 'Break', kind: 'break' }, true);
    if (r.ok) toast('Break planned for 10 minutes.', { undo: undoFor(r) ?? (r.id ? () => void run({ type: 'recycle', coll: 'blocks', id: r.id as string, confirmed: true }) : undefined) });
    dismiss();
  };
  return (
    <aside className="break-card" role="status" aria-label="Break">
      <p className="w-label strong">{due.focusedMin} min of focus.</p>
      <p className="w-sub">A 10 minute break now keeps the next block sharp.</p>
      <div className="row gap">
        <button className="btn btn-s" onClick={() => void take()}>
          Take 10 minutes
        </button>
        <button className="btn btn-s btn-ghost" onClick={dismiss}>
          Not now
        </button>
      </div>
    </aside>
  );
}

export { runWithToast };
