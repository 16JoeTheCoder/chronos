// Palette (Ctrl+K in the app, Ctrl+Alt+K anywhere): one box to add (live parse chips), search,
// run commands (">") and Ask Claude. Home mounts <Palette open onClose />; the standalone
// window (PaletteWindow) mounts the same component.
import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchIndex, type Hit } from '../../core/search';
import { activeTask } from '../../core/tasks/tasks';
import type { Command, Result } from '../../core/commands';
import { api } from '../api';
import { toast, useSnap } from '../store';
import { chipsOf, commandFromParse, describeParse, parseLine } from './fromParse';

export interface PaletteProps {
  open: boolean;
  onClose: () => void;
  /** Standalone window: closing hides the window and toasts go through main. */
  standalone?: boolean;
  /** A search hit was chosen. Default: open Home. */
  onOpenHit?: (hit: Hit) => void;
}

interface Row { key: string; label: string; hint?: string; run: () => void | Promise<void>; chips?: string[] }

export function Palette({ open, onClose, standalone, onOpenHit }: PaletteProps) {
  const snap = useSnap();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [report, setReport] = useState<string | null>(null);
  const last = useRef('');
  const input = useRef<HTMLInputElement>(null);
  const index = useRef(new SearchIndex());

  useEffect(() => {
    if (open) { setQ(''); setSel(0); setReport(null); setTimeout(() => input.current?.focus(), 0); }
  }, [open]);
  useEffect(() => api.win.onOpen(() => { setQ(''); setSel(0); setReport(null); setTimeout(() => input.current?.focus(), 0); }), []);

  const d = snap?.data;
  const text = q.trim();
  const cmdMode = q.startsWith('>');

  const say = (msg: string, r?: Result) => {
    const token = r?.ok ? r.undoToken : undefined;
    if (standalone) api.win.notify(msg, token);
    else toast(msg, { undo: token ? () => void api.undo(token) : undefined });
  };
  const finish = () => (standalone ? api.win.closePalette() : onClose());
  const exec = async (cmd: Command, msg: (r: Result) => string, keep = false) => {
    const r = await api.command(cmd);
    if (r.ok) say(msg(r), r); else toast(r.error, { error: true });
    if (r.ok && !keep) finish();
  };

  const rows = useMemo<Row[]>(() => {
    if (!d || !text) return [];
    if (report !== null) {
      return [{ key: 'report', label: report.trim() ? `Send: it should have been "${report.trim()}"` : 'Type what it should have been, then Enter', run: async () => {
        if (!report.trim()) return;
        const r = parseLine(last.current, d, Date.now());
        await exec({ type: 'parser.report', input: last.current.slice(0, 300), expected: report.trim().slice(0, 500), actual: describeParse(r, d) }, () => 'Thanks, reported');
      } }];
    }
    if (cmdMode) {
      const needle = text.slice(1).trim().toLowerCase();
      const running = activeTask(d)?.runtime.status === 'running';
      const all: Row[] = [
        { key: 'plan', label: 'Auto-plan today', hint: 'fill free time', run: () => exec({ type: 'plan.auto' }, (r) => (r.ok && r.id && r.id !== '0' ? `Planned ${r.id} blocks` : 'Nothing to plan')) },
        { key: 'replan', label: 'Re-plan', hint: 'move missed blocks forward', run: () => exec({ type: 'plan.replan' }, (r) => (r.ok && r.id && r.id !== '0' ? `Moved ${r.id} blocks` : 'Nothing to move')) },
        { key: 'misparse', label: 'Report misparse', hint: 'the last thing you added', run: () => { if (!last.current) { toast('Add something first, then report it', { error: true }); return; } setReport(''); setQ('>'); } },
        { key: 'timer', label: running ? 'Pause timer' : 'Start timer', run: () => exec({ type: 'timer', action: running ? 'pause' : 'start' }, () => (running ? 'Paused' : 'Started')) },
        { key: 'home', label: 'Open Chronos', run: () => { api.win.showHome(null); finish(); } },
        { key: 'ask', label: 'Ask Claude', hint: 'type after >ask', run: () => askClaude(needle.replace(/^ask\s*/, '')) },
      ];
      return all.filter((r) => !needle || r.label.toLowerCase().includes(needle) || needle.startsWith(r.key));
    }
    const out: Row[] = [];
    const r = parseLine(text, d, Date.now());
    const chips = chipsOf(r, d).map((c) => c.label);
    const add = (asTask: boolean) => async () => {
      const cmd = commandFromParse(r, d, Date.now(), asTask);
      if (!cmd) return;
      last.current = text;
      await exec(cmd, () => (cmd.type === 'event.create' ? 'Event added' : cmd.type === 'idea.add' ? 'Note added' : 'Task added'));
    };
    out.push({ key: 'add', label: `Add ${r.kind === 'fixed' ? 'fixed event' : r.kind}: ${r.title || text}`, hint: 'Enter', chips, run: add(false) });
    if (r.kind === 'fixed') out.push({ key: 'addtask', label: 'Add as a task instead', hint: 'Shift Enter', run: add(true) });
    index.current.update(d);
    for (const h of index.current.search(text, { limit: 6 })) out.push({ key: `${h.type}:${h.id}`, label: h.title, hint: h.type, run: () => { (onOpenHit ?? (() => api.win.showHome('runway')))(h); finish(); } });
    out.push({ key: 'ask', label: `Ask Claude: "${text.slice(0, 60)}"`, hint: 'Tab', run: () => askClaude(text) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, text, cmdMode, report]);

  async function askClaude(t: string) {
    if (!t) return;
    const r = await api.palette.askClaude(t);
    if (r.ok) { toast('Copied. Paste it in Claude'); finish(); } else toast(r.error, { error: true });
  }

  if (!open) return null;
  const row = rows[Math.min(sel, rows.length - 1)];
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); if (report !== null) { setReport(null); setQ(''); } else finish(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Tab' && !cmdMode && text) { e.preventDefault(); void askClaude(text); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) rows.find((r) => r.key === 'addtask')?.run();
      else void row?.run();
    }
  };

  return (
    <div className="pal-scrim" onMouseDown={(e) => e.target === e.currentTarget && finish()}>
      <div className="pal" role="dialog" aria-label="Palette">
        <input
          ref={input}
          className="pal-input"
          value={report !== null ? report : q}
          maxLength={300}
          aria-label="Add a task, search, or type > for commands"
          placeholder={report !== null ? 'What should it have been?' : 'Add a task, search, or type > for commands'}
          onChange={(e) => { if (report !== null) setReport(e.target.value); else { setQ(e.target.value); setSel(0); } }}
          onKeyDown={onKey}
        />
        {report !== null && <p className="pal-note">Reporting: {last.current}</p>}
        <ul className="pal-list" role="listbox">
          {rows.map((r, i) => (
            <li key={r.key} role="option" aria-selected={row === r} data-sel={row === r} onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); void r.run(); }}>
              <span className="pal-label">{r.label}</span>
              {r.chips && <span className="pal-chips">{r.chips.map((c) => <b key={c}>{c}</b>)}</span>}
              {r.hint && <kbd>{r.hint}</kbd>}
            </li>
          ))}
          {!rows.length && <li className="pal-empty">{text ? 'Nothing found' : 'Type to add or search. > runs a command.'}</li>}
        </ul>
      </div>
    </div>
  );
}
