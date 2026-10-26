// Schedule editor (§9.5): set the week once, edit it easily. Left: a Mon–Sun
// week grid (15-minute snap); click-drag on it to draft an event (keyboard path:
// "Add event"). Right: Basic | Advanced edit panel. Top: the timetable master
// switch, per-scope switches and the Holidays list.

import { useRef, useState, type CSSProperties } from 'react';
import type { EventInput } from '../../core/commands';
import { dateLabel, formatHM, parseHM, WEEKDAYS } from '../../core/format';
import { SCOPES, TAG_COLORS, type CalEvent, type Closure, type Data, type Scope, type TagColor } from '../../core/model/types';
import { live, settingsOf } from '../../core/repo/repo';
import { todayOf } from '../../core/tasks/tasks';
import { expandEvents } from '../../core/time/schedule';
import { addDays, isValidZone, mondayOf } from '../../core/time/zone';
import { Icon } from '../components/Icon';
import { recycleWithUndo } from '../components/actions';
import { Dialog, Field, Segmented, Switch } from '../components/ui';
import { run } from '../store';

const SNAP = 15;
const PX_PER_MIN = 0.8;
type Draft = EventInput & { id: string | null };

export function ScheduleEditor({ d, now, guided, onClose }: { d: Data; now: number; guided: boolean; onClose: () => void }) {
  const s = settingsOf(d);
  const monday = mondayOf(todayOf(d, now));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [holidays, setHolidays] = useState(false);
  const [drag, setDrag] = useState<{ day: number; a: number; b: number } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const span = s.dayEndMin - s.dayStartMin;

  const blank = (weekday: number, startMin: number, endMin: number): Draft => ({
    id: null,
    title: '',
    tagId: null,
    scope: 'school',
    tz: s.timezone,
    startMin,
    endMin,
    date: null,
    recur: { weekdays: [weekday], everyNWeeks: 1, anchorDate: monday, from: null, until: null },
    notes: '',
  });
  const edit = (ev: CalEvent) => setDraft({ id: ev.id, title: ev.title, tagId: ev.tagId, scope: ev.scope, tz: ev.tz, startMin: ev.startMin, endMin: ev.endMin, date: ev.date, recur: ev.recur, notes: ev.notes });
  const minuteAt = (y: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return Math.max(s.dayStartMin, Math.min(s.dayEndMin, s.dayStartMin + Math.round(((y - r.top) / r.height) * span / SNAP) * SNAP));
  };
  const timetable = (patch: Partial<typeof s.timetable>) => void run({ type: 'settings.update', patch: { timetable: { ...s.timetable, ...patch } } });

  return (
    <section className="schedule" aria-label="Schedule editor">
      <header className="sched-bar">
        <h2>Schedule</h2>
        <Switch label="Use timetable" checked={s.timetable.enabled} onChange={(enabled) => timetable({ enabled })} />
        {(['school', 'work', 'uni'] as Scope[]).map((sc) => (
          <Switch key={sc} label={sc[0]!.toUpperCase() + sc.slice(1)} checked={s.timetable.scopes[sc]} onChange={(on) => timetable({ scopes: { ...s.timetable.scopes, [sc]: on } })} />
        ))}
        <span className="grow" />
        <button className="btn btn-ghost btn-s" onClick={() => setHolidays(true)}>
          <Icon name="calendar" size={14} /> Holidays
        </button>
        <button className="btn btn-s" onClick={() => setDraft(blank(1, 540, 600))}>
          <Icon name="plus" size={14} /> Add event
        </button>
        <button className="btn btn-ghost btn-s" onClick={onClose}>
          {guided ? 'Done' : 'Close'}
        </button>
      </header>
      {guided && <p className="guide">Drag down a day column to add a class, shift or lecture. Pick the days it repeats on the right. Press Done when your week looks right.</p>}
      <div className="sched-body">
        <div className="week" ref={grid} style={{ '--h': `${span * PX_PER_MIN}px` } as CSSProperties}>
          <div className="week-hours" aria-hidden="true">
            {Array.from({ length: Math.floor(span / 60) + 1 }, (_, i) => (
              <span key={i} style={{ top: `${(i * 60 * 100) / span}%` }}>
                {formatHM(s.dayStartMin + i * 60)}
              </span>
            ))}
          </div>
          {days.map((date, i) => (
            <div key={date} className="week-col">
              <p className="week-day">{dateLabel(date)}</p>
              <div
                className="week-cells"
                onPointerDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const el = e.currentTarget;
                  const a = minuteAt(e.clientY, el);
                  setDrag({ day: i, a, b: a + 60 });
                  const move = (ev: PointerEvent) => setDrag({ day: i, a, b: Math.max(a + SNAP, minuteAt(ev.clientY, el)) });
                  const up = (ev: PointerEvent) => {
                    window.removeEventListener('pointermove', move);
                    window.removeEventListener('pointerup', up);
                    const b = Math.max(a + SNAP, minuteAt(ev.clientY, el));
                    setDrag(null);
                    setDraft(blank(i + 1, a, b === a + SNAP && Math.abs(ev.clientY - e.clientY) < 4 ? a + 60 : b));
                  };
                  window.addEventListener('pointermove', move);
                  window.addEventListener('pointerup', up);
                }}
              >
                {expandEvents(d, date).map((inst) => {
                  const tag = inst.event.tagId ? d.tags[inst.event.tagId] : undefined;
                  return (
                    <button
                      key={inst.event.id}
                      className={`wk-ev${draft?.id === inst.event.id ? ' sel' : ''}`}
                      style={{ top: `${((inst.startMin - s.dayStartMin) * 100) / span}%`, height: `${((inst.endMin - inst.startMin) * 100) / span}%`, '--c': `var(--${tag?.color ?? 'tag7'})` } as CSSProperties}
                      onClick={() => edit(inst.event)}
                      aria-label={`${inst.event.title}, ${dateLabel(date)} ${formatHM(inst.startMin)} to ${formatHM(inst.endMin)}`}
                    >
                      <b>{inst.event.title}</b>
                      <span>
                        {formatHM(inst.startMin)}–{formatHM(inst.endMin)}
                      </span>
                    </button>
                  );
                })}
                {drag?.day === i && <div className="wk-ev wk-draft" style={{ top: `${((drag.a - s.dayStartMin) * 100) / span}%`, height: `${((drag.b - drag.a) * 100) / span}%` }} />}
              </div>
            </div>
          ))}
        </div>
        {draft ? <EventPanel key={draft.id ?? `new${draft.startMin}${draft.recur?.weekdays.join()}`} d={d} draft={draft} onDone={() => setDraft(null)} /> : <p className="muted sched-hint">Select an event to edit it, or drag on the grid to add one.</p>}
      </div>
      {holidays && <Holidays d={d} onClose={() => setHolidays(false)} />}
    </section>
  );
}

function EventPanel({ d, draft, onDone }: { d: Data; draft: Draft; onDone: () => void }) {
  const [f, setF] = useState(draft);
  const [tab, setTab] = useState<'basic' | 'advanced'>('basic');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [newTag, setNewTag] = useState<{ name: string; color: TagColor } | null>(null);
  const [dupDays, setDupDays] = useState<number[]>([]);
  const set = (p: Partial<Draft>) => setF((x) => ({ ...x, ...p }));
  const r = f.recur;
  const tags = live(d, 'tags');
  const exceptions = f.id ? live(d, 'eventExceptions').filter((x) => x.eventId === f.id) : [];
  const toggleDay = (w: number) => r && set({ recur: { ...r, weekdays: r.weekdays.includes(w) ? r.weekdays.filter((x) => x !== w) : [...r.weekdays, w] } });

  async function save(copyDays?: number[]) {
    let tagId = f.tagId;
    if (newTag?.name.trim()) {
      const t = await run({ type: 'tag.create', input: { name: newTag.name, color: newTag.color, kind: 'class' } });
      if (!t.ok) return;
      tagId = t.id ?? null;
    }
    const { id, ...input } = { ...f, tagId };
    const payload: EventInput = copyDays && input.recur ? { ...input, recur: { ...input.recur, weekdays: copyDays } } : input;
    const res = id && !copyDays ? await run({ type: 'event.update', id, input: payload }, true) : await run({ type: 'event.create', input: payload }, true);
    if (res.ok) onDone();
    else setErrors(res.fields ?? { title: res.error });
  }

  return (
    <form
      className="panel"
      aria-label={f.id ? 'Edit event' : 'New event'}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Segmented label="Panel" value={tab} options={[['basic', 'Basic'], ['advanced', 'Advanced']]} onChange={setTab} />
      {tab === 'basic' ? (
        <>
          <Field label="Title" error={errors.title}>
            <input autoFocus value={f.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} placeholder="Physics" />
          </Field>
          <Field label="Tag">
            <select value={newTag ? '__new' : (f.tagId ?? '')} onChange={(e) => (e.target.value === '__new' ? setNewTag({ name: f.title, color: 'tag1' }) : (setNewTag(null), set({ tagId: e.target.value || null })))}>
              <option value="">No tag</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              <option value="__new">New tag…</option>
            </select>
          </Field>
          {newTag && (
            <div className="row gap">
              <input aria-label="New tag name" value={newTag.name} onChange={(e) => setNewTag({ ...newTag, name: e.target.value })} />
              <div className="swatches" role="radiogroup" aria-label="Tag colour">
                {TAG_COLORS.map((c) => (
                  <button type="button" key={c} role="radio" aria-checked={newTag.color === c} aria-label={c} className="swatch" style={{ background: `var(--${c})` }} onClick={() => setNewTag({ ...newTag, color: c })} />
                ))}
              </div>
            </div>
          )}
          <Field label="Scope" error={errors.scope}>
            <Segmented<Scope> label="Scope" value={f.scope} options={SCOPES.map((x) => [x, x[0]!.toUpperCase() + x.slice(1)])} onChange={(scope) => set({ scope })} />
          </Field>
          {r ? (
            <Field label="Days" error={errors.days}>
              <div className="row gap wrap" role="group" aria-label="Days">
                {WEEKDAYS.map((w, i) => (
                  <button type="button" key={w} className={`chip${r.weekdays.includes(i + 1) ? ' on' : ''}`} aria-pressed={r.weekdays.includes(i + 1)} onClick={() => toggleDay(i + 1)}>
                    {w}
                  </button>
                ))}
              </div>
            </Field>
          ) : (
            <Field label="Date" error={errors.date}>
              <input type="date" value={f.date ?? ''} onChange={(e) => set({ date: e.target.value })} />
            </Field>
          )}
          <div className="grid2">
            <Field label="Start" error={errors.time}>
              <TimeInput value={f.startMin} onChange={(startMin) => set({ startMin })} />
            </Field>
            <Field label="End">
              <TimeInput value={f.endMin} onChange={(endMin) => set({ endMin })} />
            </Field>
          </div>
        </>
      ) : (
        <>
          <Switch label="Repeats weekly" checked={!!r} onChange={(on) => set(on ? { date: null, recur: { weekdays: [1], everyNWeeks: 1, anchorDate: mondayOf(new Date().toISOString().slice(0, 10)), from: null, until: null } } : { recur: null, date: new Date().toISOString().slice(0, 10) })} />
          {r && (
            <>
              <div className="grid2">
                <Field label="Valid from" error={errors.range}>
                  <input type="date" value={r.from ?? ''} onChange={(e) => set({ recur: { ...r, from: e.target.value || null } })} />
                </Field>
                <Field label="Until">
                  <input type="date" value={r.until ?? ''} onChange={(e) => set({ recur: { ...r, until: e.target.value || null } })} />
                </Field>
              </div>
              <div className="grid2">
                <Field label="Repeat every" error={errors.everyNWeeks}>
                  <select value={r.everyNWeeks} onChange={(e) => set({ recur: { ...r, everyNWeeks: Number(e.target.value) as 1 } })}>
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? 'Every week' : `Every ${n} weeks`}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Week A starts" help="A date in the first week of the cycle." error={errors.anchorDate}>
                  <input type="date" value={r.anchorDate} onChange={(e) => set({ recur: { ...r, anchorDate: e.target.value } })} />
                </Field>
              </div>
            </>
          )}
          <Field label="Time zone" error={errors.tz} help={isValidZone(f.tz) ? 'IANA name, e.g. Asia/Jakarta.' : 'Unknown time zone.'}>
            <input value={f.tz} onChange={(e) => set({ tz: e.target.value })} />
          </Field>
          <Field label="Notes">
            <textarea rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
          {exceptions.length > 0 && (
            <>
              <p className="eyebrow">Exceptions</p>
              <ul className="list">
                {exceptions.map((x) => (
                  <li key={x.id}>
                    <span>
                      {dateLabel(x.date)} · {x.kind === 'skip' ? 'skipped' : `moved to ${formatHM(x.startMin ?? 0)}`}
                    </span>
                    <button type="button" className="btn btn-s btn-ghost" onClick={() => void run({ type: 'recycle', coll: 'eventExceptions', id: x.id, confirmed: true })}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <div className="row gap wrap">
        <button type="submit" className="btn">
          {f.id ? 'Save' : 'Add event'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
        {f.id && (
          <button type="button" className="btn btn-ghost" onClick={() => void recycleWithUndo('events', f.id as string, f.title).then(onDone)}>
            <Icon name="trash" size={14} /> Delete
          </button>
        )}
      </div>
      {f.id && r && (
        <div className="dup">
          <p className="eyebrow">Duplicate to days</p>
          <div className="row gap wrap">
            {WEEKDAYS.map((w, i) => (
              <button type="button" key={w} className={`chip${dupDays.includes(i + 1) ? ' on' : ''}`} aria-pressed={dupDays.includes(i + 1)} onClick={() => setDupDays((x) => (x.includes(i + 1) ? x.filter((y) => y !== i + 1) : [...x, i + 1]))}>
                {w}
              </button>
            ))}
            <button type="button" className="btn btn-s btn-ghost" disabled={!dupDays.length} onClick={() => void save(dupDays)}>
              Duplicate
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

function TimeInput({ value, onChange }: { value: number; onChange: (min: number) => void }) {
  const [text, setText] = useState(formatHM(value));
  return (
    <input
      value={text}
      inputMode="numeric"
      placeholder="09:00"
      onChange={(e) => {
        setText(e.target.value);
        const m = parseHM(e.target.value);
        if (m !== null) onChange(m);
      }}
    />
  );
}

function Holidays({ d, onClose }: { d: Data; onClose: () => void }) {
  const list = live(d, 'closures').sort((a, b) => a.startDate.localeCompare(b.startDate));
  const [edit, setEdit] = useState<(Omit<Closure, 'id'> & { id: string | null }) | null>(null);
  const save = async () => {
    if (!edit) return;
    const input = { name: edit.name, startDate: edit.startDate, endDate: edit.endDate, scopes: edit.scopes, confirmed: edit.confirmed };
    const r = edit.id ? await run({ type: 'closure.update', id: edit.id, input }) : await run({ type: 'closure.create', input });
    if (r.ok) setEdit(null);
  };
  return (
    <Dialog title="Holidays and breaks" onClose={onClose} wide>
      <p className="muted">Fixed national holidays are pre-filled; add the movable ones (Eid, Nyepi, Vesak, Chinese New Year, joint leave) and school breaks yourself. A closure turns off the scopes you tick.</p>
      {edit ? (
        <div className="form">
          <Field label="Name">
            <input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </Field>
          <div className="grid2">
            <Field label="From">
              <input type="date" value={edit.startDate} onChange={(e) => setEdit({ ...edit, startDate: e.target.value })} />
            </Field>
            <Field label="To">
              <input type="date" value={edit.endDate} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })} />
            </Field>
          </div>
          <div className="row gap wrap" role="group" aria-label="Off for">
            {SCOPES.map((sc) => (
              <button key={sc} className={`chip${edit.scopes.includes(sc) ? ' on' : ''}`} aria-pressed={edit.scopes.includes(sc)} onClick={() => setEdit({ ...edit, scopes: edit.scopes.includes(sc) ? edit.scopes.filter((x) => x !== sc) : [...edit.scopes, sc] })}>
                {sc} off
              </button>
            ))}
          </div>
          <Switch label="Confirmed" checked={edit.confirmed} onChange={(confirmed) => setEdit({ ...edit, confirmed })} />
          <div className="row gap">
            <button className="btn" onClick={() => void save()}>
              Save
            </button>
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <button className="btn btn-s" onClick={() => setEdit({ id: null, name: '', startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10), scopes: ['school'], source: 'custom', confirmed: true, createdAt: 0, updatedAt: 0, deviceId: '', deletedAt: null, v: 1 })}>
            <Icon name="plus" size={14} /> Add holiday or break
          </button>
          <ul className="list">
            {list.map((c) => (
              <li key={c.id}>
                <span>
                  {c.confirmed ? <span className="badge badge-ok">{c.scopes.length ? `${c.scopes.join(', ')} off` : 'Not off'}</span> : <span className="badge badge-warn">Unconfirmed</span>} {c.name} · {dateLabel(c.startDate)}
                  {c.endDate !== c.startDate && ` – ${dateLabel(c.endDate)}`}
                </span>
                <span className="row gap">
                  <button className="btn btn-s btn-ghost" onClick={() => setEdit({ ...c })}>
                    Edit
                  </button>
                  <button className="icon-btn" aria-label={`Delete ${c.name}`} onClick={() => void recycleWithUndo('closures', c.id, c.name)}>
                    <Icon name="trash" size={16} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}
