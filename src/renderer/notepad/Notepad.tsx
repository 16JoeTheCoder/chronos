// Notepad: opens on the focused task's notes, else a general note (kept on this device).
// Autosaves (debounced). Esc closes and hands focus back; on close, lines marked as tasks
// ("- ", "task ", "@ ") go through the parser and become records, with an Undo toast (D-139).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Data, Snapshot } from '../../core/model/types';
import { parseNotepad } from '../../core/parser';
import { activeTask } from '../../core/tasks/tasks';
import { display } from '../../core/timer/timer';
import { api } from '../api';
import { commandFromParse, parseCtx } from '../palette/fromParse';
import { SignatureTimer } from '../signature/SignatureTimer';
import { useNow } from '../store';

const GENERAL = 'chronos.notepad.general';
const SAVE_MS = 600;

const readGeneral = (): string => {
  try { return localStorage.getItem(GENERAL) ?? ''; } catch { return ''; }
};
const writeGeneral = (v: string): void => {
  try { localStorage.setItem(GENERAL, v); } catch { /* the draft is best effort */ }
};

/** Lines that became records are marked "[x] " so closing again never duplicates them. */
export async function linesToRecords(body: string, d: Data, now: number): Promise<{ body: string; records: { coll: 'tasks' | 'events' | 'ideas'; id: string }[]; failed: number }> {
  const lines = body.split('\n');
  const records: { coll: 'tasks' | 'events' | 'ideas'; id: string }[] = [];
  let failed = 0;
  for (const l of parseNotepad(body, parseCtx(d, now, 'notepad', 'notepad'))) {
    if (l.result.kind === 'note') continue;
    const cmd = commandFromParse(l.result, d, now);
    if (!cmd) continue;
    const r = await api.command(cmd);
    if (!r.ok || !r.id) { failed++; continue; }
    records.push({ coll: cmd.type === 'task.create' ? 'tasks' : cmd.type === 'event.create' ? 'events' : 'ideas', id: r.id });
    const prefix = l.result.spans.find((s) => s.role === 'kindKeyword' && (s.value as { prefix?: boolean } | null)?.prefix);
    const raw = lines[l.line] ?? '';
    lines[l.line] = `[x] ${prefix ? raw.slice(prefix.end).trimStart() : raw.trimStart()}`;
  }
  return { body: lines.join('\n'), records, failed };
}

export function Notepad({ snap }: { snap: Snapshot }) {
  const task = activeTask(snap.data);
  const taskId = task?.id ?? null;
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(true);
  const area = useRef<HTMLTextAreaElement>(null);
  const live = useRef({ text, taskId, snap });
  live.current = { text, taskId, snap };
  const dirty = useRef(false);
  const now = useNow(task?.runtime.status === 'running' ? 1000 : 30_000);

  const load = useCallback(() => {
    const { taskId: id, snap: s } = live.current;
    setText(id ? (s.data.tasks[id]?.notes ?? '') : readGeneral());
    setSaved(true);
    dirty.current = false;
    requestAnimationFrame(() => area.current?.focus());
  }, []);

  const save = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    const { text: t, taskId: id } = live.current;
    if (id) await api.command({ type: 'task.update', id, input: { notes: t } });
    else writeGeneral(t);
    setSaved(true);
  }, []);

  useEffect(() => { load(); return api.win.onOpen(load); }, [load]);
  useEffect(() => {
    if (saved) return;
    const t = setTimeout(() => void save(), SAVE_MS);
    return () => clearTimeout(t);
  }, [text, saved, save]);

  const close = useCallback(async () => {
    await save();
    const { text: t, taskId: id, snap: s } = live.current;
    const out = await linesToRecords(t, s.data, Date.now());
    if (out.records.length || out.failed) {
      if (id) await api.command({ type: 'task.update', id, input: { notes: out.body } });
      else writeGeneral(out.body);
    }
    const n = out.records.length;
    api.win.closeNotepad(n ? { text: `Added ${n} ${n === 1 ? 'item' : 'items'} from your notes`, records: out.records } : undefined);
  }, [save]);

  const t = task ? display(task, now) : null;
  return (
    <section className="np" aria-label="Notepad">
      <header className="np-head">
        {task && t && <SignatureTimer mini progress={t.progress ?? 0} remainingSec={(t.remaining ?? t.elapsed) / 1000} running={task.runtime.status === 'running'} overrun={t.overtime > 0} />}
        <h1>{task ? `Notes for ${task.title}` : 'Notes'}</h1>
        <span className="np-state" aria-live="polite">{saved ? 'Saved' : 'Saving'}</span>
      </header>
      <textarea
        ref={area}
        value={text}
        spellCheck={false}
        aria-label={task ? `Notes for ${task.title}` : 'General note'}
        placeholder="Write anything. Start a line with “- ” to make it a task."
        onChange={(e) => { dirty.current = true; setSaved(false); setText(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); void close(); } }}
      />
      <footer className="np-foot"><span>“- ” or “task ” makes a task</span><kbd>Esc</kbd><span>back to your app</span></footer>
    </section>
  );
}
