// Per-day override of a fixed event (G3). Right-click, the ContextMenu key or
// Shift+F10 on a runway event opens a small menu: Skip today, Edit just today,
// Edit every week. "Edit just today" is an inline popover (title, start, end).
// Arrows move, Enter chooses, Esc closes and returns focus to the event.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { formatHM, parseHM } from '../../core/format';
import type { OccurrencePatch } from '../../core/commands';
import type { Instance } from '../../core/time/schedule';
import { skipWithUndo } from '../components/actions';
import { run, toast } from '../store';

export interface MenuState {
  inst: Instance;
  x: number;
  y: number;
  /** Where focus goes when the menu closes. */
  returnTo: HTMLElement | null;
}

type Mode = 'menu' | 'edit';

export function EventMenu({ menu, onClose, onEditEvent }: { menu: MenuState; onClose: (restoreFocus: boolean) => void; onEditEvent: (eventId: string) => void }) {
  const { inst } = menu;
  const ev = inst.event;
  const recurring = !!ev.recur;
  const [mode, setMode] = useState<Mode>('menu');
  const root = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });

  // Keep the popup on screen.
  useLayoutEffect(() => {
    const r = root.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8)) });
  }, [menu.x, menu.y, mode]);

  // A press anywhere else dismisses it.
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [onClose]);

  const items: { id: 'skip' | 'today' | 'series'; label: string }[] = recurring
    ? [
        { id: 'skip', label: 'Skip today' },
        { id: 'today', label: 'Edit just today…' },
        { id: 'series', label: 'Edit every week…' },
      ]
    : [{ id: 'series', label: 'Edit…' }];

  function choose(id: 'skip' | 'today' | 'series') {
    if (id === 'skip') {
      onClose(false);
      void skipWithUndo(ev.id, inst.date, ev.title);
    } else if (id === 'today') setMode('edit');
    else {
      onClose(false);
      onEditEvent(ev.id);
    }
  }

  return (
    <div ref={root} className="pop" style={{ left: pos.left, top: pos.top }}>
      {mode === 'menu' ? <Items label={`${ev.title} options`} items={items} onChoose={choose} onClose={() => onClose(true)} /> : <TodayEditor inst={inst} onDone={() => onClose(true)} />}
    </div>
  );
}

function Items({ label, items, onChoose, onClose }: { label: string; items: { id: 'skip' | 'today' | 'series'; label: string }[]; onChoose: (id: 'skip' | 'today' | 'series') => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);
  const keys = (e: KeyboardEvent) => {
    const els = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      els[(n + els.length) % els.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(els.length - 1);
    else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
  return (
    <div ref={ref} role="menu" aria-label={label} className="menu" onKeyDown={keys}>
      {items.map((x) => (
        <button key={x.id} role="menuitem" tabIndex={-1} className="menu-item" onClick={() => onChoose(x.id)}>
          {x.label}
        </button>
      ))}
    </div>
  );
}

function TodayEditor({ inst, onDone }: { inst: Instance; onDone: () => void }) {
  const ev = inst.event;
  const [title, setTitle] = useState(ev.title);
  const [start, setStart] = useState(formatHM(inst.startMin));
  const [end, setEnd] = useState(formatHM(inst.endMin));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input')?.focus();
  }, []);

  async function save() {
    const sm = parseHM(start);
    const em = parseHM(end);
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = 'Give it a title.';
    if (sm === null) e.start = 'Use HH:MM.';
    if (em === null) e.end = 'Use HH:MM.';
    setErrors(e);
    if (Object.keys(e).length || sm === null || em === null) return;
    const patch: OccurrencePatch = {};
    if (title.trim() !== ev.title) patch.title = title.trim();
    if (sm !== inst.startMin) patch.startMin = sm;
    if (em !== inst.endMin) patch.endMin = em;
    if (Object.keys(patch).length === 0) return onDone();
    setBusy(true);
    const r = await run({ type: 'event.editOn', id: ev.id, date: inst.date, patch }, true);
    setBusy(false);
    if (r.ok) {
      toast(`${title.trim()} changed for today only.`);
      onDone();
    } else setErrors({ ...(r.fields ?? {}), form: r.error });
  }

  return (
    <form
      ref={ref}
      className="pop-form"
      role="dialog"
      aria-label={`Edit ${ev.title} just today`}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onDone();
        }
      }}
    >
      <p className="eyebrow">Just today</p>
      <label className={`field${errors.title ? ' field-error' : ''}`}>
        <span className="eyebrow">Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        {errors.title && <span className="field-help">{errors.title}</span>}
      </label>
      <div className="grid2">
        <label className={`field${errors.start || errors.time ? ' field-error' : ''}`}>
          <span className="eyebrow">Start</span>
          <input value={start} onChange={(e) => setStart(e.target.value)} inputMode="numeric" placeholder="HH:MM" />
          {errors.start && <span className="field-help">{errors.start}</span>}
        </label>
        <label className={`field${errors.end || errors.time ? ' field-error' : ''}`}>
          <span className="eyebrow">End</span>
          <input value={end} onChange={(e) => setEnd(e.target.value)} inputMode="numeric" placeholder="HH:MM" />
          {errors.end && <span className="field-help">{errors.end}</span>}
        </label>
      </div>
      {(errors.time || errors.form) && (
        <p className="field-help pop-err" role="alert">
          {errors.time ?? errors.form}
        </p>
      )}
      <div className="row gap end">
        <button type="button" className="btn btn-ghost btn-s" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn-s" disabled={busy}>
          Save for today
        </button>
      </div>
    </form>
  );
}
