// Home (PHASE23 §1, §6): one task owns the screen. Now (title, signature timer, Start/Pause,
// Hold Enter to finish), Next and time left. Everything else is one key away: P plan, F focus,
// N new, Ctrl+K palette. One DOM, three compositions: CSS keyed on data-signature (Tactile
// digits, Stark reactor, TARS slabs, Gargantua ring) reshapes it, never a different tree.

import { useRef, type CSSProperties } from 'react';
import { clockOf, dateLabel, formatHM, formatHuman } from '../../core/format';
import type { Data } from '../../core/model/types';
import { settingsOf } from '../../core/repo/repo';
import { activeTask, blockSpan, deriveQueue, ownsTimer, todayOf } from '../../core/tasks/tasks';
import { upcoming } from '../../core/time/schedule';
import { localParts } from '../../core/time/zone';
import { Icon } from '../components/Icon';
import { HoldButton, useHold } from '../focus/HoldButton';
import { useTimer } from '../focus/TimerDigits';
import type { DayModel } from '../runway/model';
import { SignatureTimer } from '../signature/SignatureTimer';
import { run, toast } from '../store';
import { useOptionalTheme } from '../theme/ThemeProvider';
import { useHolo } from '../moments/holo';
import { Widgets } from '../widgets/Widgets';

export function NowScreen({ d, m, now, deviceId, onFocus, onPlan }: { d: Data; m: DayModel; now: number; deviceId: string; onFocus: () => void; onPlan: () => void }) {
  const s = settingsOf(d);
  const theme = useOptionalTheme();
  const task = activeTask(d);
  const t = useTimer(task);
  const root = useRef<HTMLDivElement>(null);
  useHolo(root);
  const running = task?.runtime.status === 'running';
  const owner = ownsTimer(d, deviceId);
  const hold = useHold(() => {
    if (!task) return;
    void run({ type: 'task.finish', id: task.id }).then((r) => r.ok && toast('Done.'));
  });
  const today = todayOf(d, now);
  const events = upcoming(d, now, today, 24);
  const nextEv = events[0];
  const thenEv = events[1];
  const queue = deriveQueue(d, now).filter((x) => x.id !== task?.id);
  const block = task ? m.blocks.find((b) => b.taskId === task.id) : undefined;
  const nextText = nextEv ? `${nextEv.event.title} at ${clockOf(nextEv.start, nextEv.event.tz)}` : queue[0] ? queue[0].title : 'Nothing fixed ahead';
  const lp = localParts(now, s.timezone);
  const over = t ? t.overtime : 0;
  const main = t ? (t.remaining !== null ? (over > 0 ? over : t.remaining) : t.elapsed) : 0;
  const kind = theme?.theme.motion.signature.kind;
  const size = kind === 'reactor-ring' ? 360 : kind === 'slab-monolith' ? 280 : kind === 'accretion-ring' ? 420 : 112;
  const tag = task?.tagId ? d.tags[task.tagId] : undefined;
  const [lead, ...rest] = task && task.title.includes(': ') ? task.title.split(': ') : ['', task?.title ?? ''];

  return (
    <div className="now" ref={root} style={{ '--c': `var(--${tag?.color ?? 'tag7'})` } as CSSProperties}>
      <div className="now-bar">
        <span className="now-clock">{formatHM(lp.minutes)}</span>
        <span className="muted">{dateLabel(today)}</span>
        <span className="now-bar-gap" />
        <span className="muted now-free">{formatHuman(m.tl.workableMs)} free today</span>
      </div>

      <section className="now-hero holo" aria-label="Current task">
        {task ? (
          <>
            <div className="now-head">
              <h1 className="now-title">
                {lead && <span className="light">{lead}: </span>}
                <span className="strong">{rest.join(': ')}</span>
              </h1>
              {block && <span className="chip-time">{formatHM(block.startMin)} to {formatHM(block.endMin)}</span>}
            </div>
            {task.finishCondition && <p className="now-fc">{task.finishCondition}</p>}
            <div className="now-timer">
              <SignatureTimer progress={t?.progress ?? 0} remainingSec={main / 1000} running={running} overrun={over > 0} size={size} onComplete={hold.pulse} />
              <div className="now-actions">
                {owner ? (
                  <>
                    <button className="btn btn-accent btn-l" onClick={() => void run({ type: 'timer', action: running ? 'pause' : 'start' })}>
                      <Icon name={running ? 'pause' : 'play'} /> {running ? 'Pause' : task.runtime.status === 'paused' ? 'Resume' : 'Start'}
                    </button>
                    <HoldButton hold={hold} reduce={!!theme?.motionOff} label="Hold Enter to finish" hintId="now-hint" className="btn-hold" />
                  </>
                ) : (
                  <button className="btn btn-ghost" onClick={() => void run({ type: 'timer.takeover' })}>Take over timer</button>
                )}
                <button className="link" onClick={onFocus}>Focus view <kbd>F</kbd></button>
              </div>
            </div>
            <p id="now-hint" className="sr-only">Hold Enter for 2 seconds to finish.</p>
          </>
        ) : (
          <div className="now-empty">
            <h1 className="now-title"><span className="strong">Nothing queued.</span></h1>
            <p className="muted">Press N to add a task, or Ctrl K to type one in a sentence.</p>
            <button className="btn btn-ghost" onClick={onPlan}>Plan the day <kbd>P</kbd></button>
          </div>
        )}
        <div className="now-next">
          <span>Next: <b>{nextText}</b></span>
          {thenEv && <span>Then: <b>{thenEv.event.title} at {clockOf(thenEv.start, thenEv.event.tz)}</b></span>}
          {!nextEv && queue[1] && <span>Then: <b>{queue[1].title}</b></span>}
        </div>
      </section>

      <aside className="now-side" aria-label="Up next">
        {queue.length > 0 && (
          <section className="widget w-queue" aria-label="Up next">
            <h2>Up next</h2>
            <ul>
              {queue.slice(0, 3).map((q) => {
                const b = m.blocks.find((x) => x.taskId === q.id);
                return (
                  <li key={q.id}>
                    <span className="q-dot" aria-hidden="true" />
                    <span className="q-title">{q.title}</span>
                    {b && <span className="mono muted">{formatHM(b.startMin)}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <Widgets d={d} m={m} now={now} task={task} />
      </aside>
    </div>
  );
}

export { blockSpan };
