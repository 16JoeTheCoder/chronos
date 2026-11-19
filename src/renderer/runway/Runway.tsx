// The runway (§9.3, Phase 3.7 §5): a horizontal time grid with a fixed width per minute
// (runway/grid.ts), hour and half-hour lines, two lanes. Fixed: events as hatched blocks.
// Plan: blocks (they may sit over a class), free stretches and the drag ghost. The now-line
// sits on the current minute, moves every 15 s and is labelled with the exact time. Every drag has a keyboard path: arrows move a focused
// block 5 min (Shift 15), Alt+arrows resize it, Delete recycles it.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { blockFits } from '../../core/commands';
import { live } from '../../core/repo/repo';
import { clockOf, formatHM, formatHuman } from '../../core/format';
import { SPRINTABLE_MIN } from '../../core/time/timeLeft';
import type { Block, Data } from '../../core/model/types';
import { blockSpan } from '../../core/tasks/tasks';
import { settingsOf } from '../../core/repo/repo';
import { zonedToUtc } from '../../core/time/zone';
import { timeGrid } from './grid';
import { Icon } from '../components/Icon';
import { beginDrag, registerTarget, useDrag, type DragItem } from '../components/drag';
import { dropOnTrash, recycleWithUndo } from '../components/actions';
import { Segmented } from '../components/ui';
import { run } from '../store';
import { EventMenu, type MenuState } from './EventMenu';
import { freeGaps, minuteOf, place, snap, type DayModel } from './model';
import { fixedPreview, intentFor, laneAccepts, nudge, type Intent, type Lane, type Preview as DropPreview } from './dnd';
import { perform } from './dropActions';
import { replanDay } from '../planning/actions';

export type Preview = DropPreview;

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
  const grid = timeGrid(m.from, m.to, now, m.tz);
  const pct = (ts: number) => `${grid.x(ts)}px`;
  const width = (a: number, b: number) => `${Math.max(0, grid.x(Math.min(b, m.to)) - grid.x(Math.max(a, m.from)))}px`;
  const scroller = useRef<HTMLDivElement>(null);
  // Open with now a third of the way in (and again when the range changes).
  useEffect(() => {
    const el = scroller.current;
    if (el && grid.now) el.scrollLeft = Math.max(0, grid.now.x - el.clientWidth / 3);
  }, [range, m.date]); // eslint-disable-line react-hooks/exhaustive-deps
  const at = (min: number) => zonedToUtc(m.date, min, m.tz);

  const fixedLane = useRef<HTMLDivElement>(null);
  const snapMin = settingsOf(d).snapMin;
  const unplaced = live(d, 'events').filter((e) => e.date === m.date && e.startMin === null && e.endMin === null);
  const [recur, setRecur] = useState<{ intent: Extract<Intent, { op: 'event.move' }>; x: number; y: number } | null>(null);

  const drop = useCallback(
    (laneId: Lane, it: DragItem, pv: unknown, at?: { x: number; y: number }) => {
      const intent = intentFor(it, laneId, (pv as Preview | null) ?? null);
      if (!intent) return;
      if (intent.op === 'event.move' && intent.recurring) {
        setRecur({ intent, x: at?.x ?? 200, y: at?.y ?? 200 });
        return;
      }
      void perform(intent, d, m.date);
    },
    [d, m.date],
  );

  // Three lanes take drops: Plan (blocks), Fixed (events) and the Unscheduled cards (registered in Cards.tsx).
  useEffect(() => {
    const offPlan = registerTarget('plan', {
      el: () => lane.current,
      accepts: (it) => laneAccepts('plan', it),
      over: (it, x, _y, free) => previewFor(d, m, now, it, x, lane.current, snapMin, free),
      drop: (it, p) => drop('plan', it, p),
    });
    const offFixed = registerTarget('fixed', {
      el: () => fixedLane.current,
      accepts: (it) => laneAccepts('fixed', it),
      over: (it, x, _y, free) => fixedFor(d, m, it, x, fixedLane.current, snapMin, free),
      drop: (it, p) => drop('fixed', it, p),
    });
    return () => (offPlan(), offFixed());
  }, [d, m, now, snapMin, drop]);

  const bufStart = at(dayEndMin - bufferMin);
  const bufEnd = at(dayEndMin);
  const showBuffer = bufferMin > 0 && bufEnd > m.from && bufStart < m.to;
  const bufferLabel = bufferMin >= 60 ? formatHuman(bufferMin * MIN) : `${bufferMin}m`;

  const preview = drag?.target === 'plan' ? (drag.preview as Preview | null) : null;
  const fixedPreview2 = drag?.target === 'fixed' ? (drag.preview as Preview | null) : null;
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
        <div className="row gap">
          <button className="btn btn-s btn-ghost" onClick={() => void replanDay(m.date)}>
            Re-plan
          </button>
          <Segmented label="Runway range" value={range} options={[['full', 'Full day'], ['next6', 'Next 6 h']]} onChange={setRange} />
        </div>
      </header>
      {m.holidays.length > 0 && (
        <p className="holiday" role="note">
          <span className="badge badge-ok">Holiday</span> {m.holidays.map((c) => c.name).join(', ')}: {m.holidays.flatMap((c) => c.scopes).join(', ')} off today.
        </p>
      )}
      <div className="rw-wrap">
      <div className="rw-labels" aria-hidden="true"><span className="rw-l-axis" /><span>Fixed</span><span className="rw-l-plan">Plan</span></div>
      <div className="rw-scroll" ref={scroller}>
      <div className="rw" style={{ width: grid.width }}>
        <div className="rw-grid" aria-hidden="true">
          {grid.lines.map((l) => <i key={l.ts} className={l.major ? 'major' : undefined} style={{ left: l.x }} />)}
        </div>
        <div className="rw-axis" aria-hidden="true">
          {grid.lines.filter((l) => l.label).map((l) => (
            <span key={l.ts} style={{ left: l.x }}>{l.label}</span>
          ))}
        </div>
        <div className="rw-lane rw-fixed" ref={fixedLane}>
          {m.instances.map((i, n) => {
            const tag = i.event.tagId ? d.tags[i.event.tagId] : undefined;
            const sMin = minuteOf(m, i.start);
            const eMin = minuteOf(m, i.end);
            const item = (ev?: React.PointerEvent): DragItem => ({ kind: 'event', eventId: i.event.id, title: i.event.title, date: i.date, recurring: !!i.event.recur, startMin: sMin, endMin: eMin, durMin: eMin - sMin, offsetMin: ev ? pointerMinute(m, ev.clientX, fixedLane.current) - sMin : 0 });
            return (
              <button
                key={`${i.event.id}-${i.date}`}
                className={`ev rv-ev${i.end <= now ? ' past' : ''}`}
                style={{ left: pct(i.start), width: width(i.start, i.end), '--c': `var(--${tag?.color ?? 'tag7'})`, '--i': n } as CSSProperties}
                aria-label={`${i.event.title}, fixed, ${clockOf(i.start, m.tz)} to ${clockOf(i.end, m.tz)}. Arrows move it, Shift for bigger steps.`}
                title={`${i.event.title} · ${clockOf(i.start, m.tz)}-${clockOf(i.end, m.tz)}`}
                onPointerDown={(e) => beginDrag(e, () => item(e))}
                aria-haspopup="menu"
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ inst: i, x: e.clientX, y: e.clientY, returnTo: e.currentTarget });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Delete') dropOnTrash(item());
                  else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey) {
                    e.preventDefault();
                    const r = nudge({ startMin: sMin, endMin: eMin }, e.key === 'ArrowRight' ? 1 : -1, snapMin, e.shiftKey, settingsOf(d).dayStartMin, settingsOf(d).dayEndMin);
                    if (r && !m.blocks.some((b) => r.startMin < b.endMin && b.startMin < r.endMin)) void perform({ op: 'event.move', eventId: i.event.id, date: i.date, recurring: !!i.event.recur, ...r }, d, m.date);
                  } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
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
          {fixedPreview2 && (
            <div className={`ghost ${fixedPreview2.valid ? 'ok' : 'bad'}`} style={{ left: pct(at(fixedPreview2.startMin)), width: width(at(fixedPreview2.startMin), at(fixedPreview2.endMin)) }}>
              {formatHM(fixedPreview2.startMin)}-{formatHM(fixedPreview2.endMin)}
            </div>
          )}
        </div>
        <div className="rw-lane rw-plan" ref={lane}>
          {showBuffer && (
            <div className="buf" style={{ left: pct(bufStart), width: width(bufStart, bufEnd) }} title={`Buffer ${bufferLabel}: kept free at the end of the day`} role="img" aria-label={`Buffer, ${bufferLabel}, kept free at the end of the day`}>
              {/* The label moves right of the now-line when now is inside the buffer, so they never overlap. */}
              <span aria-hidden="true" style={{ left: grid.now && now > bufStart && now < bufEnd ? Math.min(grid.now.x - grid.x(bufStart) + 10, Math.max(0, grid.x(bufEnd) - grid.x(bufStart) - 96)) : 8 }}>Buffer {bufferLabel}</span>
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
        {grid.now && (
          <div className="now rv-now" style={{ left: grid.now.x }} aria-label={`Now, ${grid.now.label}`} role="img">
            <span className="now-label" aria-hidden="true">{grid.now.label}</span>
          </div>
        )}
      </div>
      </div>
      </div>
      {unplaced.length > 0 && (
        <div className="tray" aria-label="To place">
          <span className="eyebrow">To place</span>
          <ul className="tray-list">
            {unplaced.map((e) => (
              <li key={e.id}>
                <button
                  className="tray-item"
                  aria-label={`${e.title}, ${formatHuman(e.durationMin * MIN)}, needs a time. Drag onto the Fixed lane, or press Enter to place it in the first free slot.`}
                  onPointerDown={(ev) => beginDrag(ev, { kind: 'event', eventId: e.id, title: e.title, date: m.date, recurring: false, unplaced: true, durMin: e.durationMin, offsetMin: 0, startMin: null, endMin: null })}
                  onKeyDown={(ev) => {
                    if (ev.key !== 'Enter') return;
                    ev.preventDefault();
                    const gap = freeGaps(d, m, now, undefined, snapMin).find(([a, b]) => b - a >= e.durationMin);
                    if (gap) void perform({ op: 'event.place', eventId: e.id, startMin: gap[0] }, d, m.date);
                  }}
                >
                  <Icon name="lock" size={12} />
                  <span>{e.title}</span>
                  <span className="muted">{formatHuman(e.durationMin * MIN)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {recur && (
        <RecurChoice
          x={recur.x}
          y={recur.y}
          onPick={(scope) => {
            void perform(recur.intent, d, m.date, scope);
            setRecur(null);
          }}
          onCancel={() => setRecur(null)}
        />
      )}
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

function previewFor(d: Data, m: DayModel, now: number, it: DragItem, x: number, el: HTMLElement | null, snapMin: number, free: boolean): Preview | null {
  const g = free ? 1 : snapMin;
  const min = snap(pointerMinute(m, x, el), g);
  if (it.kind === 'task' || (it.kind === 'event' && !it.unplaced)) {
    const dur = it.kind === 'task' ? it.dur : (it.durMin ?? 30);
    // Plan blocks may sit over classes (Phase 3.7): only other blocks are in the way.
    const p = place(freeGaps(d, m, now, undefined, g, true), min, dur, g);
    return p ? { ...p, valid: true } : { startMin: min, endMin: min + dur, valid: false };
  }
  if (it.kind !== 'block') return null;
  const b = d.blocks[it.blockId];
  if (!b) return null;
  let startMin = b.startMin;
  let endMin = b.endMin;
  if (it.mode === 'move') {
    startMin = snap(min - it.offsetMin, g);
    endMin = startMin + (b.endMin - b.startMin);
  } else if (it.mode === 'start') startMin = Math.min(min, b.endMin - Math.min(5, g));
  else endMin = Math.max(min, b.startMin + Math.min(5, g));
  return { startMin, endMin, valid: blockFits(d, m.date, startMin, endMin, b.id) };
}

/** Preview on the Fixed lane for an event, a task or a block being dropped there. */
function fixedFor(d: Data, m: DayModel, it: DragItem, x: number, el: HTMLElement | null, snapMin: number, free: boolean): Preview | null {
  const s = settingsOf(d);
  const pointer = pointerMinute(m, x, el);
  let dur = 30;
  let offset = 0;
  let ignore: string | undefined;
  if (it.kind === 'event') {
    dur = it.durMin ?? 60;
    offset = it.offsetMin ?? 0;
  } else if (it.kind === 'task') dur = it.dur;
  else if (it.kind === 'block') {
    const b = d.blocks[it.blockId];
    if (!b) return null;
    dur = b.endMin - b.startMin;
    ignore = b.id;
  } else return null;
  const blocks = m.blocks.filter((b) => b.id !== ignore).map((b): [number, number] => [b.startMin, b.endMin]);
  return fixedPreview(pointer, dur, offset, { snapMin, free, dayStartMin: s.dayStartMin, dayEndMin: s.dayEndMin, blocks });
}

/** Just today, or every week? Shown after a recurring fixed event is dropped on a new time. Enter takes the default. */
function RecurChoice({ x, y, onPick, onCancel }: { x: number; y: number; onPick: (s: 'today' | 'week') => void; onCancel: () => void }) {
  return (
    <div
      className="pop recur-pop"
      role="dialog"
      aria-label="Move a repeating event"
      style={{ left: Math.min(x, window.innerWidth - 300), top: Math.min(y + 12, window.innerHeight - 140) }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <p className="eyebrow">Moved. For</p>
      <div className="row gap">
        <button className="btn btn-s" autoFocus onClick={() => onPick('today')}>
          Just today
        </button>
        <button className="btn btn-s btn-ghost" onClick={() => onPick('week')}>
          Every week
        </button>
      </div>
      <button className="link" onClick={onCancel}>
        Leave it where it was
      </button>
    </div>
  );
}
