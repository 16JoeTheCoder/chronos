// Notepad (Phase 3.7 §6): a scratch editor on a global hotkey. It shows the last 0-3 notes above
// the editor (Settings → Tasks and notepad), starts about three lines tall and grows downward
// with the text (main keeps the top edge and stops at 70 % of the screen, then it scrolls).
// Ctrl+Enter or Push sends the note to the Log (with the task in focus and its project), clears
// the editor and shows it in the recent list. The draft is kept on this PC. Esc closes and hands
// focus back to the app you were in. Bullets continue on Enter; a line ending in TASK (or
// starting with it) becomes a task on Enter, and Backspace right after undoes it.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Snapshot } from '../../core/model/types';
import { live } from '../../core/repo/repo';
import { active } from '../../core/tasks/selectors';
import { display } from '../../core/timer/timer';
import { api } from '../api';
import { useSmartText } from '../components/smartText';
import { SignatureTimer } from '../signature/SignatureTimer';
import { useNow } from '../store';

const DRAFT = 'chronos.notepad.general';
const readDraft = (): string => { try { return localStorage.getItem(DRAFT) ?? ''; } catch { return ''; } };
const writeDraft = (v: string): void => { try { localStorage.setItem(DRAFT, v); } catch { /* the draft is best effort */ } };

const ago = (ms: number): string => {
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

export function Notepad({ snap }: { snap: Snapshot }) {
  const d = snap.data;
  const task = active(d);
  const [text, setText] = useState(readDraft);
  const [msg, setMsg] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLElement>(null);
  const now = useNow(task?.runtime.status === 'running' ? 1000 : 30_000);
  const count = Math.max(0, Math.min(3, snap.device.notepad?.recent ?? 3));
  const recent = live(d, 'ideas').sort((a, b) => b.createdAt - a.createdAt).slice(0, count);

  const set = (v: string) => { setText(v); writeDraft(v); };
  const smart = useSmartText({ value: text, set, el: () => area.current, tasks: true, d, projectId: task?.projectId ?? null, onTask: () => setMsg('') });

  const load = useCallback(() => {
    setText(readDraft());
    setMsg('');
    setTimeout(() => area.current?.focus());
  }, []);
  useEffect(() => { load(); return api.win.onOpen(load); }, [load]);

  // Grow downward: the textarea is as tall as its text plus one empty line; the window follows.
  useLayoutEffect(() => {
    const ta = area.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 22;
    const pad = parseFloat(getComputedStyle(ta).paddingTop) + parseFloat(getComputedStyle(ta).paddingBottom);
    ta.style.height = `${Math.max(ta.scrollHeight + lh, 3 * lh + pad)}px`;
    const el = root.current;
    if (el) api.win.notepadResize(el.scrollHeight + 2);
  }, [text, recent.length]);

  const push = async () => {
    const body = text.trim();
    if (!body) { setMsg('Nothing to push yet.'); return; }
    const r = await api.command({ type: 'idea.add', text: body, taskId: task?.id ?? null, projectId: task?.projectId ?? null });
    if (!r.ok) { setMsg(`Couldn't push: ${r.error}`); return; }
    set('');
    setMsg(task ? `Pushed to the Log under ${task.title}.` : 'Pushed to the Log.');
    area.current?.focus();
  };

  const t = task ? display(task, now) : null;
  return (
    <section ref={root} className="np" aria-label="Notepad">
      <header className="np-head">
        {task && t && <SignatureTimer mini progress={t.progress ?? 0} remainingSec={(t.remaining ?? t.elapsed) / 1000} running={task.runtime.status === 'running'} overrun={t.overtime > 0} />}
        <h1>{task ? task.title : 'Notepad'}</h1>
        <span className="np-state" aria-live="polite">{msg}</span>
      </header>
      {recent.length > 0 && (
        <ol className="np-recent" aria-label="Recent notes">
          {recent.map((n) => (
            <li key={n.id}>
              <p>{n.body || n.text}</p>
              <span>{ago(now - n.createdAt)}{n.taskId && d.tasks[n.taskId] ? ` · ${d.tasks[n.taskId]!.title}` : ''}</span>
            </li>
          ))}
        </ol>
      )}
      <textarea
        ref={area}
        value={text}
        rows={3}
        spellCheck={false}
        aria-label="Note"
        placeholder="Write anything. End a line with TASK to make it a task."
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); api.win.closeNotepad(); return; }
          if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); void push(); return; }
          smart(e);
        }}
      />
      <footer className="np-foot">
        <span>Ctrl Enter pushes to the Log · Esc closes</span>
        <button type="button" className="btn btn-s" onClick={() => void push()} disabled={!text.trim()}>Push</button>
      </footer>
    </section>
  );
}
