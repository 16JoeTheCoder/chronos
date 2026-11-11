// The runway (§9.3): one time axis, two lanes. Fixed: events as hatched,
// locked obstacles. Plan: blocks, free stretches and the drag ghost. The now-line
// moves with the clock
// (15 s ticks, and always labelled with the exact minute). Every drag has a keyboard path: arrows move a focused
// block 5 min (Shift 15), Alt+arrows resize it, Delete recycles it.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { blockFits } from '../../core/commands';
import { clockOf, formatHM, formatHuman } from '../../core/format';
import { SPRINTABLE_MIN } from '../../core/time/timeLeft';
import type { Block, Data } from '../../core/model/types';
import { blockSpan } from '../../core/tasks/tasks';
import { settingsOf } from '../../core/repo/repo';
import { localParts, zonedToUtc } from '../../core/time/zone';
import { Icon } from '../components/Icon';
import { beginDrag, registerTarget, useDrag, type DragItem } from '../components/drag';
import { dropOnTrash, recycleWithUndo } from '../components/actions';
import { Segmented } from '../components/ui';
import { run } from '../store';
import { EventMenu, type MenuState } from './EventMenu';
import { freeGaps, minuteOf, place, snap, type DayModel } from './model';

export interface Preview {
  startMin: number;
  endMin: number;
  valid: boolean;
}

const MIN = 60_000;

export function Runway({ d, m, now, range, setRange, onEditEvent }: { d: Data; m: DayModel; now: number; range: 'full' | 'next6'; setRange: (r: 'full' | 'next6') => void; onEditEvent: (eventId: string) => void }) {
  const lane = useRef<HTMLDivElement>(null);
  const drag = useDrag();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback((restore: boolean) => {
    setMenu((cur) => {
      if (restore) cur?.returnTo?.focus();
      return null;
    });
  }, []);
  const bufferMin = settingsOf(d).bufferMin;
  const dayEndMin = settingsOf(d).dayEndMin;
  const span = m.to - m.from;
  const pct = (ts: number) => `${Math.min(100, Math.max(0, ((ts - m.from) / span) * 100))}%`;
  const width = (a: number, b: number) => `${Math.max(0, ((Math.min(b, m.to) - Math.max(a, m.from)) / span) * 100)}%`;
  const at = (min: number) => zonedToUtc(m.date, min, m.tz);

  // The plan lane is a drop target for cards (schedule) and blocks (move/resize).
  useEffect(
    () =>
      registerTarget('plan', {
        el: () => lane.current,
        accepts: (it) => it.kind === 'task' || it.kind === 'block',
        over: (it, x) => previewFor(d, m, now, it, x, lane.current),
        drop: (it, p) => {
          const pv = p as Preview | null;
          if (!pv?.valid) return;
          if (it.kind === 'task') void run({ type: 'block.create', taskId: it.taskId, date: m.date, startMin: pv.startMin, endMin: pv.endMin });
          if (it.kind === 'block') void run({ type: 'block.move', id: it.blockId, date: m.date, startMin: pv.startMin, endMin: pv.endMin });
        },
      }),
    [d, m, now],
  );

  // Ticks sit on real instants (whole local hours between from and to), so they
  // are right for any window, including one that crosses midnight.
  const ticks: number[] = [];
  const wide = span > 8 * 3_600_000;
  const lp = localParts(m.from, m.tz);
  for (let ts = m.from + ((60 - (lp.minutes % 60)) % 60) * MIN; ts <= m.to; ts += 60 * MIN) {
    if (wide && Math.round(localParts(ts, m.tz).minutes / 60) % 2 !== 0) continue;
    if (Math.abs(ts - now) < span * 0.035) continue; // the now label takes this spot
    ticks.push(ts);
  }
  const bufStart = at(dayEndMin - bufferMin);
  const bufEnd = at(dayEndMin);
  const showBuffer = bufferMin > 0 && bufEnd > m.from && bufStart < m.to;
  const bufferLabel = bufferMin >= 60 ? formatHuman(bufferMin * MIN) : `${bufferMin}m`;

  const preview = drag?.target === 'plan' ? (drag.preview as Preview | null) : null;
  const done = (b: Block) => (b.taskId ? d.tasks[b.taskId]?.status === 'done' : false);

  function blockKeys(e: KeyboardEvent, b: Block) {
    const step = e.shiftKey ? 15 : 5;
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (dir) {
      e.preventDefault();
      const next = e.altKey ? { startMin: b.startMin, endMin: b.endMin + dir * step } : { startMin: b.startMin + dir * step, endMin: b.endMin + dir * step };
      if (next.endMin - next.startMin >= 5 && blockFits(d, b.date, next.startMin, next.endMin, b.id)) void run({ type: 'block.move', id: b.id, date: b.date, ...next });
    } else if (e.key === 'Delete') {
      e.preventDefault();
      void recycleWithUndo('blocks', b.id, b.title);
    }
  }

  return (
    <section className="runway rv" aria-label="Runway">
      <header className="sec-head">
        <h2 className="eyebrow">Runway</h2>
        <Segmented label="Runway range" value={range} options={[['full', 'Full day'], ['next6', 'Next 6 h']]} onChange={setRange} />
      </header>
      {m.holidays.length > 0 && (
        <p className="holiday" role="note">
          <span className="badge badge-ok">Holiday</span> {m.holidays.map((c) => c.name).join(', ')}: {m.holidays.flatMap((c) => c.scopes).join(', ')} off today.
        </p>
      )}
      <div className="rw">
        <div className="rw-axis" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ left: pct(t) }}>
              {clockOf(t, m.tz)}
            </span>
          ))}
        </div>
        <div className="rw-lane rw-fixed">
          <span className="lane-label">Fixed</span>
          {m.instances.map((i, n) => {
            const tag = i.event.tagId ? d.tags[i.event.tagId] : undefined;
            const item: DragItem = { kind: 'event', eventId: i.event.id, title: i.event.title, date: i.date, recurring: !!i.event.recur };
            return (
              <button
                key={`${i.event.id}-${i.date}`}
                className={`ev rv-ev${i.end <= now ? ' past' : ''}`}
                style={{ left: pct(i.start), width: width(i.start, i.end), '--c': `var(--${tag?.color ?? 'tag7'})`, '--i': n } as CSSProperties}
                aria-label={`${i.event.title}, fixed, ${clockOf(i.start, m.tz)} to ${clockOf(i.end, m.tz)}`}
                title={`${i.event.title} · ${clockOf(i.start, m.tz)}-${clockOf(i.end, m.tz)}`}
                onPointerDown={(e) => beginDrag(e, item)}
                aria-haspopup="menu"
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ inst: i, x: e.clientX, y: e.clientY, returnTo: e.currentTarget });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Delete') dropOnTrash(item);
                  else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({ inst: i, x: r.left, y: r.bottom + 4, returnTo: e.currentTarget });
                  }
                }}
              >
                <Icon name="lock" size={12} />
                <span>{i.event.title}</span>
              </button>
            );
          })}
        </div>
        <div className="rw-lane rw-plan" ref={lane}>
          <span className="lane-label">Plan</span>
          {showBuffer && (
            <div className="buf" style={{ left: pct(bufStart), width: width(bufStart, bufEnd) }} title={`Buffer ${bufferLabel}: kept free at the end of the day`} role="img" aria-label={`Buffer, ${bufferLabel}, kept free at the end of the day`}>
              <span aria-hidden="true">Buffer {bufferLabel}</span>
            </div>
          )}
          {m.tl.free.map(([a, b]) => (
            <div key={a} className="free" style={{ left: pct(a), width: width(a, b) }} aria-hidden={b - a < SPRINTABLE_MIN * MIN}>
              {b - a >= SPRINTABLE_MIN * MIN && <span>{formatHuman(b - a)} open</span>}
            </div>
          ))}
          {m.blocks.map((b, n) => {
            const [s, e] = blockSpan(b);
            const tag = b.tagId ? d.tags[b.tagId] : undefined;
            const isDone = done(b);
            const move = (mode: 'move' | 'start' | 'end') => (ev: React.PointerEvent) =>
              beginDrag(ev, () => ({ kind: 'block', blockId: b.id, title: b.title, mode, offsetMin: pointerMinute(m, ev.clientX, lane.current) - b.startMin }));
            return (
              <div
                key={b.id}
                className={`blk rv-ev${b.kind === 'sprint' ? ' blk-sprint' : ''}${e <= now ? ' past' : ''}${isDone ? ' blk-done' : ''}${drag?.item.kind === 'block' && drag.item.blockId === b.id ? ' blk-moving' : ''}`}
                style={{ left: pct(s), width: width(s, e), '--c': `var(--${tag?.color ?? 'tag7'})`, '--i': n } as CSSProperties}
              >
                <span className="blk-edge" onPointerDown={move('start')} aria-hidden="true" />
                <button
                  className="blk-body"
                  aria-label={`${b.title}, ${b.kind === 'sprint' ? 'sprint' : 'planned'}${isDone ? ', done' : ''}, ${formatHM(b.startMin)} to ${formatHM(b.endMin)}. Arrows move, Alt and arrows resize, Delete removes.`}
                  title={`${b.title} · ${clockOf(s, m.tz)}-${clockOf(e, m.tz)}`}
                  onPointerDown={move('move')}
                  onKeyDown={(e) => blockKeys(e, b)}
                >
                  {isDone && <Icon name="check" size={12} />}
                  <span>{b.title}</span>
                </button>
                <span className="blk-edge blk-edge-r" onPointerDown={move('end')} aria-hidden="true" />
              </div>
            );
          })}
          {preview && (
            <div className={`ghost ${preview.valid ? 'ok' : 'bad'}`} style={{ left: pct(at(preview.startMin)), width: width(at(preview.startMin), at(preview.endMin)) }}>
              {formatHM(preview.startMin)}-{formatHM(preview.endMin)}
            </div>
          )}
        </div>
        {now >= m.from && now <= m.to && (
          <div className="now rv-now" style={{ left: pct(now) }} aria-label={`Now, ${clockOf(now, m.tz)}`} role="img">
            <span className="now-label" aria-hidden="true">
              {clockOf(now, m.tz)}
            </span>
          </div>
        )}
      </div>
      {menu && <EventMenu menu={menu} onClose={closeMenu} onEditEvent={onEditEvent} />}
    </section>
  );
}

function pointerMinute(m: DayModel, x: number, el: HTMLElement | null): number {
  const r = el?.getBoundingClientRect();
  if (!r) return 0;
  const ts = m.from + ((x - r.left) / r.width) * (m.to - m.from);
  return minuteOf(m, ts);
}

function previewFor(d: Data, m: DayModel, now: number, it: DragItem, x: number, el: HTMLElement | null): Preview | null {
  const min = snap(pointerMinute(m, x, el));
  if (it.kind === 'task') {
    const p = place(freeGaps(d, m, now), min, it.dur);
    return p ? { ...p, valid: true } : { startMin: min, endMin: min + it.dur, valid: false };
  }
  if (it.kind !== 'block') return null;
  const b = d.blocks[it.blockId];
  if (!b) return null;
  let startMin = b.startMin;
  let endMin = b.endMin;
  if (it.mode === 'move') {
    startMin = snap(min - it.offsetMin);
    endMin = startMin + (b.endMin - b.startMin);
  } else if (it.mode === 'start') startMin = Math.min(min, b.endMin - 5);
  else endMin = Math.max(min, b.startMin + 5);
  return { startMin, endMin, valid: blockFits(d, m.date, startMin, endMin, b.id) };
}
