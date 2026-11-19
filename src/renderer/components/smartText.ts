// The live editing rules for text boxes (core/log/smartText): bullets continue, a TASK line
// becomes a task on Enter, Backspace right after undoes it. One hook for the notepad, the
// Log composer and the Focus notes.

import { useRef, type KeyboardEvent } from 'react';
import { applyTaskLine, bulletBackspace, bulletEnter, taskLineAt, undoTaskLine, type Edit, type TaskLine } from '../../core/log/smartText';
import type { Data } from '../../core/model/types';
import { api } from '../api';
import { commandFromParse, parseLine } from '../palette/fromParse';
import { toast } from '../store';

/** Create the task a TASK line asks for. Returns its id, or null. */
export async function taskFromLine(body: string, d: Data, defaults: { projectId?: string | null } = {}): Promise<string | null> {
  const now = Date.now();
  const r = parseLine(body, d, now);
  const cmd = commandFromParse({ ...r, kind: 'task' }, d, now, true, true);
  if (!cmd || cmd.type !== 'task.create') return null;
  const res = await api.command({ ...cmd, input: { ...cmd.input, projectId: cmd.input.projectId ?? defaults.projectId ?? null } });
  return res.ok && res.id ? res.id : null;
}

export function useSmartText(opts: {
  value: string;
  set: (v: string) => void;
  el: () => HTMLTextAreaElement | null;
  /** Off for single-purpose boxes. */
  tasks: boolean;
  d: Data | undefined;
  projectId?: string | null;
  /** Let the caller see the conversion (e.g. to say so). */
  onTask?: (title: string) => void;
}) {
  const last = useRef<{ t: TaskLine; id: string } | null>(null);
  const put = (e: Edit) => {
    opts.set(e.value);
    setTimeout(() => {
      const ta = opts.el();
      if (ta) ta.setSelectionRange(e.caret, e.caret);
    });
  };
  return (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const ta = e.currentTarget;
    const caret = ta.selectionStart;
    const collapsed = caret === ta.selectionEnd;
    const pending = last.current;
    last.current = null;
    if (e.key === 'Backspace' && collapsed && pending) {
      e.preventDefault();
      put(undoTaskLine(opts.value, pending.t));
      void api.command({ type: 'recycle', coll: 'tasks', id: pending.id, confirmed: true });
      toast('Task removed. The line keeps TASK.');
      return true;
    }
    if (!collapsed || e.ctrlKey || e.altKey || e.metaKey) return false;
    if (e.key === 'Enter' && !e.shiftKey) {
      const t = opts.tasks && opts.d ? taskLineAt(opts.value, caret) : null;
      if (t) {
        e.preventDefault();
        const ed = applyTaskLine(opts.value, t);
        put(ed);
        void taskFromLine(t.body, opts.d as Data, { projectId: opts.projectId }).then((id) => {
          if (!id) { toast("Couldn't add that task.", { error: true }); return; }
          last.current = { t, id };
          opts.onTask?.(t.body);
          toast(`Task added: ${t.body}. Backspace undoes it.`);
        });
        return true;
      }
      const b = bulletEnter(opts.value, caret);
      if (b) {
        e.preventDefault();
        put(b);
        return true;
      }
    }
    if (e.key === 'Backspace') {
      const b = bulletBackspace(opts.value, caret);
      if (b) {
        e.preventDefault();
        put(b);
        return true;
      }
    }
    return false;
  };
}
