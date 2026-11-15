// Project board logic (pure). Columns come from project.columns. The column mapped to
// status "doing" is the focus slot: it holds ONE card. Dropping another card there swaps
// the two. A move is a short list of `task.moveCard` commands (the existing command), so
// the UI runs them in order and keeps the reverse list for a single Undo.

import { live } from '../repo/repo';
import type { Data, Project, ProjectColumn, Task } from '../model/types';

export interface Move {
  id: string;
  columnId: string;
  /** Put the card before this card of the target column; null = at the end. */
  beforeId: string | null;
}

export type MovePlan =
  | { ok: true; moves: Move[]; undo: Move[]; swapped: Task | null }
  | { ok: false; error: string };

/** The focus slot: the column with id "doing", else the first one named "doing". */
export function doingColumnId(columns: ProjectColumn[]): string | null {
  return (columns.find((c) => c.id === 'doing') ?? columns.find((c) => c.name.trim().toLowerCase() === 'doing'))?.id ?? null;
}

/** The finished column: id "done", else a column named "done". */
export function doneColumnId(columns: ProjectColumn[]): string | null {
  return (columns.find((c) => c.id === 'done') ?? columns.find((c) => c.name.trim().toLowerCase() === 'done'))?.id ?? null;
}

const bySortKey = (a: Task, b: Task) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.createdAt - b.createdAt);

/** A card sits in its column; a card with no or an unknown column sits in the first one (same rule as the MCP get_project). */
export function columnOf(p: Project, t: Task): string {
  return p.columns.some((c) => c.id === t.columnId) ? (t.columnId as string) : (p.columns[0]?.id ?? '');
}

/** The open and finished cards of a project, per column, in board order. Dropped tasks are not shown. */
export function boardCards(d: Data, p: Project): Record<string, Task[]> {
  const out: Record<string, Task[]> = Object.fromEntries(p.columns.map((c) => [c.id, [] as Task[]]));
  for (const t of live(d, 'tasks')) {
    if (t.projectId !== p.id || t.status === 'dropped') continue;
    out[columnOf(p, t)]?.push(t);
  }
  for (const list of Object.values(out)) list.sort(bySortKey);
  return out;
}

/** Cards beyond the first in the focus slot (it can happen after a sync or an MCP edit). The first by order keeps the slot. */
export function focusSlotOverflow(d: Data, p: Project): Task[] {
  const doing = doingColumnId(p.columns);
  return doing ? (boardCards(d, p)[doing] ?? []).slice(1) : [];
}

/**
 * Plan moving `taskId` into `columnId`, before `beforeId` (null = end). If the target is the
 * focus slot and another card holds it, that card goes back to the moved card's old column,
 * at the old position (a swap). Returns the moves in the order to run them, and the reverse
 * moves in the order to run those, so one Undo restores both cards.
 */
export function planMove(d: Data, taskId: string, columnId: string, beforeId: string | null): MovePlan {
  const t = d.tasks[taskId];
  if (!t || t.deletedAt !== null) return { ok: false, error: 'Task not found.' };
  const p = t.projectId ? d.projects[t.projectId] : undefined;
  if (!p || p.deletedAt !== null) return { ok: false, error: 'That task is not in a project.' };
  if (!p.columns.some((c) => c.id === columnId)) return { ok: false, error: 'Unknown column.' };
  const cards = boardCards(d, p);
  const from = columnOf(p, t);
  const fromList = cards[from] ?? [];
  const fromIdx = fromList.findIndex((x) => x.id === t.id);
  const fromNext = fromList[fromIdx + 1]?.id ?? null;
  if (beforeId === t.id) return { ok: false, error: 'Already there.' };
  const target = (cards[columnId] ?? []).filter((x) => x.id !== t.id);
  if (beforeId && !target.some((x) => x.id === beforeId)) return { ok: false, error: 'That card is not in this column.' };

  const slot = doingColumnId(p.columns) === columnId;
  const holder = slot ? target[0] : undefined;
  // Same column, same place: nothing to do.
  if (from === columnId && !holder) {
    const next = target[fromIdx]?.id ?? null;
    if ((beforeId ?? null) === next) return { ok: false, error: 'Already there.' };
  }
  if (!holder) {
    const back: Move = { id: t.id, columnId: from, beforeId: fromNext };
    return { ok: true, moves: [{ id: t.id, columnId, beforeId }], undo: [back], swapped: null };
  }
  // The focus slot is taken: swap. The displaced card goes where the moved one was (if the
  // moved one came from the slot too, nothing to swap with itself, so only reorder).
  if (from === columnId) return { ok: false, error: 'The focus slot holds one card.' };
  return {
    ok: true,
    moves: [
      { id: holder.id, columnId: from, beforeId: fromNext },
      { id: t.id, columnId, beforeId: null },
    ],
    undo: [
      { id: t.id, columnId: from, beforeId: fromNext },
      { id: holder.id, columnId, beforeId: null },
    ],
    swapped: holder,
  };
}

/** Where a keyboard move lands: the neighbouring column (dir -1/+1), keeping the card at the end of it. */
export function neighbourColumn(columns: ProjectColumn[], currentId: string, dir: -1 | 1): string | null {
  const i = columns.findIndex((c) => c.id === currentId);
  const next = columns[i + dir];
  return i < 0 || !next ? null : next.id;
}

/** Reorder inside a column by one step (dir -1 = up). Returns the beforeId for task.moveCard, or null for "no move". */
export function stepWithin(list: Task[], taskId: string, dir: -1 | 1): { beforeId: string | null } | null {
  const i = list.findIndex((x) => x.id === taskId);
  if (i < 0) return null;
  if (dir === -1) return i === 0 ? null : { beforeId: list[i - 1]!.id };
  return i >= list.length - 1 ? null : { beforeId: list[i + 2]?.id ?? null };
}

export interface ProjectSummary {
  total: number;
  done: number;
  /** Estimated minutes still to do (cards not done; no estimate counts as the default block). */
  leftMin: number;
}

export function summarize(d: Data, p: Project, defaultBlockMin: number): ProjectSummary {
  const doneCol = doneColumnId(p.columns);
  const cards = boardCards(d, p);
  let total = 0, done = 0, leftMin = 0;
  for (const [col, list] of Object.entries(cards)) {
    for (const t of list) {
      total += 1;
      if (t.status === 'done' || col === doneCol) done += 1;
      else leftMin += t.estimateMin ?? defaultBlockMin;
    }
  }
  return { total, done, leftMin };
}
