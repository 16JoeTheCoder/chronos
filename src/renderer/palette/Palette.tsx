// The one palette (Phase 3.5 §3). Ctrl+K in the app, the global shortcut, or the top-bar
// search button all open it. A centred dialog over a dimmed, blurred app: add with live parse
// chips (Enter adds, Shift+Enter adds a fixed event as a task, Tab asks Claude), search matches
// (tasks, events, Log posts, projects), and ">" commands. Ask Claude rows only where can.askClaude. Esc closes and returns focus to
// where it was. Home mounts <Palette open onClose onNavigate />; the standalone window mounts
// the same component with `standalone`.
import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchIndex, type Hit } from '../../core/search';
import type { Command, Result } from '../../core/commands';
import { api } from '../api';
import type { Screen } from '../components/Rail';
import { listThemeChoices } from '../themes';
import { describeError, toast, useSnap } from '../store';
import { useOptionalTheme } from '../theme/ThemeProvider';
import { paletteCommands, type PalAction } from './commands';
import { chipsOf, commandFromParse, describeParse, explicitKind, parseLine } from './fromParse';
import { todayOf } from '../../core/tasks/tasks';
import { useKeyboardInset } from '../components/Sheet';
import './palette.css';

export interface PaletteProps {
  open: boolean;
  onClose: () => void;
  /** Standalone window: closing hides the window and toasts go through main. */
  standalone?: boolean;
  /** In-app navigation (">" commands, opening a match). Closes the palette (it is a layer). */
  onNavigate?: (to: Screen, opts?: { projectId?: string; logProject?: string | null }) => void;
}

interface Row { key: string; label: string; hint?: string; group?: string; run: () => void | Promise<void> }

const HIT_LABEL: Record<Hit['type'], string> = { task: 'task', event: 'event', note: 'log post', project: 'project' };

export function Palette({ open, onClose, standalone, onNavigate }: PaletteProps) {
  const snap = useSnap();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [report, setReport] = useState<string | null>(null);
  const last = useRef('');
  const input = useRef<HTMLInputElement>(null);
  const index = useRef(new SearchIndex());
  const returnTo = useRef<HTMLElement | null>(null);
  const kb = useKeyboardInset();
  const mission = useOptionalTheme()?.theme.motion.signature.kind === 'mission-clock';

  const reset = () => { setQ(''); setSel(0); setReport(null); setTimeout(() => input.current?.focus(), 0); };
  useEffect(() => {
    if (open) {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      reset();
      return () => { const el = returnTo.current; if (el?.isConnected) setTimeout(() => el.focus(), 0); };
    }
    return undefined;
  }, [open]);
  useEffect(() => api.win.onOpen(reset), []);

  const d = snap?.data;
  const text = q.trim();
  const cmdMode = q.startsWith('>');

  const say = (msg: string, r?: Result) => {
    const token = r?.ok ? r.undoToken : undefined;
    if (standalone) api.win.notify(msg, token);
    else toast(msg, { undo: token ? () => void api.undo(token) : undefined });
  };
  const finish = () => (standalone ? api.win.closePalette() : onClose());
  const exec = async (cmd: Command, msg: (r: Result) => string) => {
    const r = await api.command(cmd);
    if (r.ok) { say(msg(r), r); finish(); } else toast(describeError(cmd, r.error), { error: true });
  };
  const go = (to: Screen, opts?: { projectId?: string; logProject?: string | null }) => {
    if (onNavigate && !standalone) onNavigate(to, opts);
    else { api.win.showHome(to === 'focus' ? 'focus' : to === 'plan' ? 'runway' : null); finish(); }
  };

  async function askClaude(t: string) {
    if (!t) return;
    const r = await api.palette.askClaude(t);
    if (r.ok) { toast('Copied. Paste it in Claude'); finish(); } else toast(r.error, { error: true });
  }

  const doAction = (a: PalAction): void | Promise<void> => {
    switch (a.kind) {
      case 'go': return go(a.to);
      case 'project': return go('board', { projectId: a.id });
      case 'timer': return exec({ type: 'timer', action: a.action }, () => (a.action === 'pause' ? 'Paused' : 'Started'));
      case 'plan': return exec({ type: 'plan.auto' }, (r) => (r.ok && r.id && r.id !== '0' ? `Planned ${r.id} blocks` : 'Nothing to plan'));
      case 'replan': return exec({ type: 'plan.replan' }, (r) => (r.ok && r.id && r.id !== '0' ? `Moved ${r.id} blocks` : 'Nothing to move'));
      case 'theme': return exec({ type: 'settings.update', patch: { themeId: a.id } }, () => 'Theme switched');
      case 'ask': return askClaude(a.text);
      case 'misparse':
        if (!last.current) { toast('Add something first, then report it', { error: true }); return; }
        setReport(''); setQ('>');
    }
  };

  const rows = useMemo<Row[]>(() => {
    if (!d) return [];
    if (report !== null) {
      return [{ key: 'report', label: report.trim() ? `Send: it should have been "${report.trim()}"` : 'Type what it should have been, then Enter', run: async () => {
        if (!report.trim()) return;
        const r = parseLine(last.current, d, Date.now());
        await exec({ type: 'parser.report', input: last.current.slice(0, 300), expected: report.trim().slice(0, 500), actual: describeParse(r, d) }, () => 'Thanks, reported');
      } }];
    }
    if (cmdMode) return paletteCommands(d, q.slice(1), listThemeChoices(), api.can.askClaude).map((c, i) => ({ key: c.key, label: c.label, hint: c.hint, group: i === 0 ? 'Commands' : undefined, run: () => doAction(c.action) }));
    if (!text) return [];
    const out: Row[] = [];
    const r = parseLine(text, d, Date.now());
    // Ctrl+K adds what you typed: a line the parser reads as a note is still a task unless it says "note" or "//".
    const asNote = r.kind === 'note' && explicitKind(r);
    const add = (asTask: boolean, note = false) => async () => {
      const cmd = note ? { type: 'idea.add' as const, text: text.slice(0, 20_000), taskId: null } : commandFromParse(r, d, Date.now(), asTask, true);
      if (!cmd) return;
      last.current = text;
      await exec(cmd, () => (cmd.type === 'event.create' ? 'Event added' : cmd.type === 'idea.add' ? 'Posted to the Log' : cmd.type === 'task.create' && cmd.input.dueDate && cmd.input.dueDate > todayOf(d, Date.now()) ? 'Task added to Upcoming' : 'Task added to Today'));
    };
    out.push({ key: 'add', label: r.kind === 'fixed' ? 'Add fixed event' : asNote ? 'Post to the Log' : 'Add task', hint: 'Enter', run: add(false) });
    if (r.kind === 'fixed') out.push({ key: 'addtask', label: 'Add as a task instead', hint: 'Shift Enter', run: add(true) });
    else if (!asNote) out.push({ key: 'addnote', label: 'Post to the Log instead', run: add(false, true) });
    if (api.can.askClaude) out.push({ key: 'ask', label: `Ask Claude: "${text.slice(0, 60)}"`, hint: 'Tab', run: () => askClaude(text) });
    index.current.update(d);
    index.current.search(text, { limit: 6 }).filter((h) => !h.deleted).forEach((h, i) => out.push({
      key: `${h.type}:${h.id}`, label: h.title, hint: HIT_LABEL[h.type], group: i === 0 ? 'Matches' : undefined,
      run: () => {
        if (h.type === 'project') go('board', { projectId: h.id });
        else if (h.type === 'note') go('log', { logProject: null });
        else if (h.type === 'event') go('plan');
        else go('tasks');
      },
    }));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, text, q, cmdMode, report]);

  if (!open) return null;
  const chips = d && text && !cmdMode && report === null ? chipsOf(parseLine(text, d, Date.now()), d).map((c) => c.label) : [];
  const row = rows[Math.min(sel, rows.length - 1)];
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (report !== null) { setReport(null); setQ(''); } else finish(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Tab') { e.preventDefault(); if (api.can.askClaude && !cmdMode && text && report === null) void askClaude(text); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) void rows.find((r) => r.key === 'addtask')?.run();
      else void row?.run();
    }
  };

  return (
    <div className={`pal-scrim${standalone ? '' : ' in-app'}`} style={kb ? { bottom: kb } : undefined} onMouseDown={(e) => e.target === e.currentTarget && finish()}>
      <div className="pal" role="dialog" aria-modal="true" aria-labelledby="pal-label">
        <div className="pal-head">
          <button type="button" className="pal-close" onMouseDown={(e) => e.preventDefault()} onClick={finish}>Close</button>
          <label id="pal-label" htmlFor="pal-input" className="pal-eyebrow">{report !== null ? 'Report misparse' : cmdMode ? 'Command' : mission ? 'Call Mission Control' : 'Add or search'}</label>
          <input
            id="pal-input"
            ref={input}
            className="pal-input"
            value={report !== null ? report : q}
            maxLength={300}
            autoComplete="off"
            enterKeyHint="go"
            autoCapitalize="sentences"
            spellCheck={false}
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls="pal-list"
            aria-activedescendant={row ? `pal-${row.key}` : undefined}
            placeholder={report !== null ? 'What should it have been?' : 'Add a task, search, or type > for commands'}
            onChange={(e) => { if (report !== null) setReport(e.target.value); else { setQ(e.target.value); setSel(0); } }}
            onKeyDown={onKey}
            onBlur={() => setTimeout(() => { if (input.current && document.activeElement !== input.current && input.current.isConnected) input.current.focus(); }, 0)}
          />
          {chips.length > 0 && <div className="pal-chips" aria-label="How Chronos reads it">{chips.map((c) => <b key={c}>{c}</b>)}</div>}
        </div>
        {report !== null && <p className="pal-note">Reporting: {last.current}</p>}
        <ul className="pal-list" id="pal-list" role="listbox" aria-label="Results">
          {rows.flatMap((r, i) => [
            ...(r.group ? [<li key={`g-${r.group}`} className="pal-group" role="presentation">{r.group}</li>] : []),
            <li key={r.key} id={`pal-${r.key}`} role="option" aria-selected={row === r} data-sel={row === r} onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); void r.run(); }}>
              <span className="pal-label">{r.label}</span>
              {r.hint && <span className="pal-hint">{r.hint}</span>}
            </li>,
          ])}
          {!rows.length && <li className="pal-empty" role="presentation">{text ? 'Nothing found' : 'Type to add or search. Start with > for commands.'}</li>}
        </ul>
        <div className="pal-foot"><span>↑ ↓ to move · Enter to choose · Esc to close</span><span>&gt; for commands</span></div>
      </div>
    </div>
  );
}
