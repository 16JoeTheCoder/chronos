// School timetable (Settings): the weekly recurring school CalEvents, one weekday at a time, and the
// bell grid (period starts and ends). Events are real CalEvents (scope "school", repeating every week),
// so the runway, the week editor and the parser's per-day timetable all read the same data.

import { useEffect, useId, useState } from 'react';
import type { EventInput } from '../../core/commands';
import { WEEKDAYS, formatHM, parseHM } from '../../core/format';
import type { Bell } from '../../core/parser/types';
import type { CalEvent, Snapshot } from '../../core/model/types';
import { settingsOf } from '../../core/repo/repo';
import { todayOf } from '../../core/tasks/tasks';
import { mondayOf, weekdayOf } from '../../core/time/zone';
import { Icon } from '../components/Icon';
import { Btn, Group, Toggle, saveSettings } from '../settings/rows';
import { run, toast } from '../store';
import { periodsOf, saveBells, useBells, type Period } from './timetableData';
import { SEED_BELLS, SEED_TIMETABLE } from './timetableSeed';

const ASKED = 'chronos.timetableSeedAsked';
const wasAsked = () => { try { return localStorage.getItem(ASKED) === '1'; } catch { return false; } };
const markAsked = () => { try { localStorage.setItem(ASKED, '1'); } catch { /* best effort */ } };

const inputOf = (ev: CalEvent, patch: Partial<EventInput> = {}): EventInput => ({
  title: ev.title, tagId: ev.tagId, scope: ev.scope, tz: ev.tz, startMin: ev.startMin, endMin: ev.endMin, date: ev.date, recur: ev.recur, notes: ev.notes, durationMin: ev.durationMin, ...patch,
});

/** A bare input that commits on Enter or blur and reverts on Escape or a refusal. */
function Cell({ label, value, className, check, onCommit }: { label: string; value: string; className?: string; check?: (v: string) => boolean; onCommit: (v: string) => void | boolean | Promise<void | boolean> }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const bad = check ? !check(text) : false;
  const commit = async () => {
    if (text === value || bad) return;
    if ((await onCommit(text)) === false) setText(value);
  };
  return (
    <input
      className={`st-input ${className ?? ''}`}
      aria-label={label}
      aria-invalid={bad}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void commit();
        if (e.key === 'Escape') setText(value);
      }}
    />
  );
}

const isHM = (v: string) => parseHM(v) !== null;

export function TimetableSection({ snap, onOpenWeek }: { snap: Snapshot; onOpenWeek?: () => void }) {
  const d = snap.data;
  const s = settingsOf(d);
  const now = Date.now();
  const today = todayOf(d, now);
  const bells = useBells();
  const periods = periodsOf(d);
  const [day, setDay] = useState(() => Math.min(weekdayOf(today), 7));
  const [asked, setAsked] = useState(wasAsked);
  const empty = periods.length === 0 && bells.length === 0;
  const dayPeriods = periods.filter((p) => p.day === day);

  async function seed(): Promise<boolean> {
    const anchor = mondayOf(today);
    let n = 0;
    for (const e of SEED_TIMETABLE) {
      const r = await run({
        type: 'event.create',
        input: { title: e.title, tagId: null, scope: 'school', tz: s.timezone, startMin: parseHM(e.start), endMin: parseHM(e.end), date: null, recur: { weekdays: [e.day], everyNWeeks: 1, anchorDate: anchor, from: null, until: null }, notes: '' },
      });
      if (!r.ok) break;
      n += 1;
    }
    saveBells(SEED_BELLS);
    markAsked();
    setAsked(true);
    toast(`Added ${n} periods and ${SEED_BELLS.length} bells.`);
    return true;
  }

  return (
    <>
      <Group title="Weekly lessons" note="Your weekly lessons. They repeat every week, show on the runway, and teach the quick-add what Math or a test means on a given day.">
        <Toggle label="Use the timetable" hint="Off hides every repeating event from the runway." checked={s.timetable.enabled} onChange={(enabled) => saveSettings({ timetable: { ...s.timetable, enabled } })} />
        <Toggle label="Pre-fill national holidays" checked={s.holidaysEnabled} onChange={(holidaysEnabled) => saveSettings({ holidaysEnabled })} />
        {onOpenWeek && (
          <div className="st-actions">
            <Btn onClick={onOpenWeek}><Icon name="calendar" size={14} /> Open the week editor</Btn>
          </div>
        )}
        {empty && !asked && (
          <div className="st-msg" data-kind="warn" role="group" aria-label="Start from the school timetable">
            <b>Your timetable is empty.</b>
            <span>Chronos can start from the school timetable it was set up with: {SEED_TIMETABLE.length} periods, Monday to Friday, and {SEED_BELLS.length} bell periods. You can change every row afterwards.</span>
            <div className="st-actions">
              <Btn variant="solid" onClick={seed}>Use that timetable</Btn>
              <Btn onClick={() => { markAsked(); setAsked(true); }}>Start empty</Btn>
            </div>
          </div>
        )}
      </Group>

      <Group title="Periods">
        <div className="st-days" role="group" aria-label="Weekday">
          {WEEKDAYS.map((w, i) => (
            <button key={w} type="button" className="st-day" aria-pressed={day === i + 1} onClick={() => setDay(i + 1)}>
              {w}
            </button>
          ))}
        </div>
        <div className="st-list">
          {dayPeriods.length === 0 && <p className="st-empty">No periods on {WEEKDAYS[day - 1]}. Add one below.</p>}
          {dayPeriods.map((p) => (
            <PeriodRow key={`${p.eventId}-${p.day}`} p={p} snap={snap} />
          ))}
        </div>
        <AddPeriod day={day} snap={snap} anchor={mondayOf(today)} last={dayPeriods.at(-1)?.endMin ?? parseHM(bells[0]?.start ?? '') ?? s.dayStartMin} />
      </Group>

      <Group title="Bell grid" note="When each period starts and ends. The quick-add reads it to turn “period 4” or “after P6” into a time. Stored on this PC.">
        <BellGrid bells={bells} />
      </Group>
    </>
  );
}

function PeriodRow({ p, snap }: { p: Period; snap: Snapshot }) {
  const ev = snap.data.events[p.eventId];
  if (!ev || 'purged' in ev) return null;
  const edit = (patch: Partial<EventInput>) => run({ type: 'event.update', id: ev.id, input: inputOf(ev, patch) }).then((r) => r.ok);
  const days = ev.recur?.weekdays ?? [];
  const where = p.shared ? days.map((w) => WEEKDAYS[w - 1]).join(' ') : '';
  return (
    <div className="st-period">
      <Cell label={`${p.title} start`} className="st-mono" value={formatHM(p.startMin)} check={isHM} onCommit={(v) => ((parseHM(v) ?? 0) >= p.endMin ? (toast('A period must end after it starts.', { error: true }), false) : edit({ startMin: parseHM(v) }))} />
      <Cell label={`${p.title} end`} className="st-mono" value={formatHM(p.endMin)} check={isHM} onCommit={(v) => ((parseHM(v) ?? 0) <= p.startMin ? (toast('A period must end after it starts.', { error: true }), false) : edit({ endMin: parseHM(v) }))} />
      <div className="st-period-title" style={{ minWidth: 0 }}>
        <Cell label={`Title of the ${formatHM(p.startMin)} period`} value={p.title} check={(v) => v.trim().length > 0 && v.length <= 120} onCommit={(v) => edit({ title: v.trim() })} />
        {where && <span className="st-hint">Also on {where}: editing changes them all.</span>}
      </div>
      <button
        type="button"
        className="st-icon"
        aria-label={`Delete ${p.title} on ${WEEKDAYS[p.day - 1]}`}
        onClick={async () => {
          const was = inputOf(ev);
          if (p.shared && ev.recur) {
            const r = await run({ type: 'event.update', id: ev.id, input: inputOf(ev, { recur: { ...ev.recur, weekdays: days.filter((w) => w !== p.day) } }) });
            if (r.ok) toast(`${p.title} removed from ${WEEKDAYS[p.day - 1]}.`, { undo: () => void run({ type: 'event.update', id: ev.id, input: was }) });
            return;
          }
          const r = await run({ type: 'recycle', coll: 'events', id: ev.id, confirmed: true });
          if (r.ok) toast(`${p.title} deleted.`, { undo: () => void run({ type: 'restore', coll: 'events', id: ev.id }) });
        }}
      >
        <Icon name="trash" size={16} />
      </button>
    </div>
  );
}

function AddPeriod({ day, snap, anchor, last }: { day: number; snap: Snapshot; anchor: string; last: number }) {
  const s = settingsOf(snap.data);
  const id = useId();
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(formatHM(last));
  const [end, setEnd] = useState(formatHM(Math.min(last + 45, 1439)));
  useEffect(() => { setStart(formatHM(last)); setEnd(formatHM(Math.min(last + 45, 1439))); }, [last, day]);
  const a = parseHM(start), b = parseHM(end);
  const ok = title.trim().length > 0 && a !== null && b !== null && b > a;
  async function add(): Promise<boolean> {
    if (!ok) { toast(title.trim() ? 'The end must be after the start.' : 'Give the period a title.', { error: true }); return false; }
    const r = await run({ type: 'event.create', input: { title: title.trim(), tagId: null, scope: 'school', tz: s.timezone, startMin: a, endMin: b, date: null, recur: { weekdays: [day], everyNWeeks: 1, anchorDate: anchor, from: null, until: null }, notes: '' } });
    if (r.ok) setTitle('');
    return r.ok;
  }
  return (
    <form className="st-period" aria-labelledby={`${id}-t`} onSubmit={(e) => { e.preventDefault(); void add(); }} style={{ borderBottom: 0, paddingTop: 14 }}>
      <input className="st-input st-mono" aria-label="New period start" value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={a === null} />
      <input className="st-input st-mono" aria-label="New period end" value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={b === null} />
      <input id={`${id}-t`} className="st-input st-period-title" aria-label={`New period title for ${WEEKDAYS[day - 1]}`} placeholder="Physics" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Btn variant="solid" onClick={add}><Icon name="plus" size={14} /> Add</Btn>
    </form>
  );
}

function BellGrid({ bells }: { bells: Bell[] }) {
  const set = (next: Bell[]) => saveBells(next);
  const update = (i: number, patch: Partial<Bell>) => set(bells.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const nextId = () => { for (let n = bells.length + 1; ; n++) if (!bells.some((b) => b.id === `P${n}`)) return `P${n}`; };
  return (
    <>
      <div className="st-bells">
        {bells.map((b, i) => (
          <div className="st-bell" key={`${b.id}-${i}`}>
            <Cell label={`Bell ${i + 1} name`} className="st-bell-id" value={b.id} check={(v) => v.trim().length > 0 && v.length <= 12} onCommit={(v) => update(i, { id: v.trim() })} />
            <Cell label={`${b.id} start`} className="st-mono" value={b.start} check={isHM} onCommit={(v) => ((parseHM(v) ?? 0) >= (parseHM(b.end) ?? 0) ? (toast('A bell must end after it starts.', { error: true }), false) : update(i, { start: formatHM(parseHM(v)!) }))} />
            <Cell label={`${b.id} end`} className="st-mono" value={b.end} check={isHM} onCommit={(v) => ((parseHM(v) ?? 0) <= (parseHM(b.start) ?? 0) ? (toast('A bell must end after it starts.', { error: true }), false) : update(i, { end: formatHM(parseHM(v)!) }))} />
            <button type="button" className="st-icon" aria-label={`Delete bell ${b.id}`} onClick={() => { const was = bells; set(bells.filter((_, j) => j !== i)); toast(`Bell ${b.id} deleted.`, { undo: () => set(was) }); }}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        ))}
      </div>
      {bells.length === 0 && <p className="st-empty">No bells yet.</p>}
      <div className="st-actions">
        <Btn onClick={() => {
          const lastEnd = bells.reduce((m, b) => Math.max(m, parseHM(b.end) ?? 0), 7 * 60 + 45);
          set([...bells, { id: nextId(), start: formatHM(lastEnd), end: formatHM(Math.min(lastEnd + 40, 1439)) }]);
        }}>
          <Icon name="plus" size={14} /> Add a bell
        </Btn>
      </div>
    </>
  );
}
