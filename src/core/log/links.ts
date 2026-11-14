// Line <-> task links. A note's `parsedTaskIds` (existing field, schema v3 frozen) holds
// one entry per linked line: `L<lineIndex>:<taskId>`. isId() allows ':' so the entry
// validates unchanged; a plain id without the prefix (older data, other writers) is a
// task made from the note that no line points at. The link is by line index and is
// re-aligned when the body is edited (relink). Ticking never writes the note: a line is
// ticked exactly when its task is done, so card and task cannot disagree.

import type { Command } from '../commands';
import type { Task } from '../model/types';

const LINK = /^L(\d{1,5}):(.+)$/;

export const encodeLink = (line: number, taskId: string): string => `L${line}:${taskId}`;

/** line index -> task id (later entries win). */
export function decodeLinks(parsedTaskIds: readonly string[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const e of parsedTaskIds) {
    const x = LINK.exec(e);
    if (x) m.set(Number(x[1]), x[2]!);
  }
  return m;
}

export function encodeLinks(links: ReadonlyMap<number, string>, keepPlain: readonly string[] = []): string[] {
  return [...keepPlain.filter((e) => !LINK.test(e)), ...[...links].sort((a, b) => a[0] - b[0]).map(([l, t]) => encodeLink(l, t))];
}

const norm = (s: string | undefined) => (s ?? '').trim();

/**
 * Carry links across an edit. A link follows its line: same index and text, else the
 * nearest unclaimed identical line, else the same index if that line is still a
 * prefixed task line that was edited in place. Otherwise the link is dropped (the task stays).
 */
export function relink(oldBody: string, newBody: string, links: ReadonlyMap<number, string>, isTaskLine: (line: string) => boolean): Map<number, string> {
  const o = oldBody.split('\n');
  const n = newBody.split('\n');
  const out = new Map<number, string>();
  const claimed = new Set<number>();
  const pending: [number, string][] = [];
  for (const [i, tid] of links) {
    if (norm(o[i]) !== '' && norm(n[i]) === norm(o[i]) && !claimed.has(i)) {
      out.set(i, tid);
      claimed.add(i);
    } else pending.push([i, tid]);
  }
  const rest: [number, string][] = [];
  for (const [i, tid] of pending) {
    let best = -1;
    for (let j = 0; j < n.length; j++) if (!claimed.has(j) && norm(n[j]) === norm(o[i]) && norm(o[i]) !== '' && (best < 0 || Math.abs(j - i) < Math.abs(best - i))) best = j;
    if (best >= 0) {
      out.set(best, tid);
      claimed.add(best);
    } else rest.push([i, tid]);
  }
  for (const [i, tid] of rest) if (!claimed.has(i) && n[i] !== undefined && isTaskLine(n[i]!)) {
    out.set(i, tid);
    claimed.add(i);
  }
  return out;
}

export type TickState = 'open' | 'done' | 'gone';

/** What a line's checkbox shows. A missing, recycled or dropped task has no live state. */
export function tickState(task: Task | undefined): TickState {
  if (!task || task.deletedAt !== null || task.status === 'dropped') return 'gone';
  return task.status === 'done' ? 'done' : 'open';
}

/** Click on the checkbox: finish an open task, reopen a done one. A dropped or missing task has no checkbox action. */
export function tickCommand(task: Task): Command | null {
  if (task.deletedAt !== null || task.status === 'dropped') return null;
  return task.status === 'done' ? { type: 'task.reopen', id: task.id } : { type: 'task.finish', id: task.id };
}
