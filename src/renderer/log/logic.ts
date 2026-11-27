// Pure helpers for the Log's Read and Write views (tested in tests/log/readWrite.test.ts).
import type { Command, Result } from '../../core/commands';
import { decodeLinks, encodeLinks, relink, stripPrefix } from '../../core/log';
import { isDraft, postedAt, type Idea } from '../../core/model/types';
import { dateOf, weekdayOf } from '../../core/time/zone';
import { MONTH_NAMES } from './ctx';

// ---- day grouping ----

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "Tuesday 17 November" (the year only when it is not this year). */
export function dayHeading(date: string, today: string): string {
  const base = `${WEEKDAYS[weekdayOf(date) - 1]} ${Number(date.slice(8))} ${MONTH_NAMES[Number(date.slice(5, 7)) - 1]}`;
  return date.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${date.slice(0, 4)}`;
}

export interface DayGroup {
  date: string;
  posts: Idea[];
}

/** A newest-first feed split into consecutive days (in the user's zone). Drafts never appear. */
export function groupByDay(feed: readonly Idea[], tz: string): DayGroup[] {
  const out: DayGroup[] = [];
  for (const n of feed) {
    if (isDraft(n)) continue;
    const date = dateOf(postedAt(n), tz);
    const last = out[out.length - 1];
    if (last && last.date === date) last.posts.push(n);
    else out.push({ date, posts: [n] });
  }
  return out;
}

/** Keep whole days until at least `limit` posts are included. */
export function takePosts(groups: readonly DayGroup[], limit: number): DayGroup[] {
  const out: DayGroup[] = [];
  let n = 0;
  for (const g of groups) {
    if (n >= limit) break;
    out.push(g);
    n += g.posts.length;
  }
  return out;
}

// ---- editing helpers ----

export interface Sel {
  value: string;
  start: number;
  end: number;
}

/** Ctrl+B / Ctrl+I: wrap the selection in `mark`; with nothing selected put the caret between a pair; wrapping again unwraps. */
export function wrapSelection(value: string, start: number, end: number, mark: string): Sel {
  const m = mark.length;
  const before = value.slice(0, start);
  const sel = value.slice(start, end);
  const after = value.slice(end);
  // Already wrapped just outside the selection: unwrap (but `*` must not unwrap half of `**`).
  if (before.endsWith(mark) && after.startsWith(mark) && (m === 2 || (!before.endsWith('**') || before.endsWith('***')))) {
    return { value: before.slice(0, -m) + sel + after.slice(m), start: start - m, end: end - m };
  }
  // The selection includes the marks.
  if (sel.length >= 2 * m + 1 && sel.startsWith(mark) && sel.endsWith(mark) && (m === 2 || (!sel.startsWith('**') || sel.startsWith('***')))) {
    return { value: before + sel.slice(m, -m) + after, start, end: end - 2 * m };
  }
  return { value: before + mark + sel + mark + after, start: start + m, end: end + m };
}

export const isTypingTarget = (el: EventTarget | null): boolean => !!(el as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]');

// ---- draft state: what is stored where ----

export const LOCAL_DRAFT_KEY = 'chronos.log.draft';
export interface LocalDraft {
  /** The draft record's id, once the data store has one. */
  id: string | null;
  body: string;
  projectId: string | null;
  at: number;
}

export function readLocalDraft(storage: Pick<Storage, 'getItem'> | null): LocalDraft | null {
  try {
    const raw = storage?.getItem(LOCAL_DRAFT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LocalDraft>;
    if (typeof v.body !== 'string' || typeof v.at !== 'number') return null;
    return { id: typeof v.id === 'string' ? v.id : null, body: v.body, projectId: typeof v.projectId === 'string' ? v.projectId : null, at: v.at };
  } catch {
    return null;
  }
}

export function writeLocalDraft(storage: Pick<Storage, 'setItem' | 'removeItem'> | null, d: LocalDraft | null): void {
  try {
    if (!d || !d.body.trim()) storage?.removeItem(LOCAL_DRAFT_KEY);
    else storage?.setItem(LOCAL_DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* private mode or blocked storage: the data-store copy still exists */
  }
}

/** The newest live draft record. */
export function latestDraft(ideas: Record<string, Idea>): Idea | null {
  let best: Idea | null = null;
  for (const n of Object.values(ideas)) if (n.deletedAt === null && isDraft(n) && (!best || n.updatedAt > best.updatedAt)) best = n;
  return best;
}

/** What Write opens with: the draft record, unless a newer local copy exists for it (or the record has not synced yet). */
export function resumeDraft(ideas: Record<string, Idea>, local: LocalDraft | null): { id: string | null; body: string; projectId: string | null } | null {
  const rec = latestDraft(ideas);
  if (rec) {
    if (local && local.id === rec.id && local.at > rec.updatedAt && local.body.trim()) return { id: rec.id, body: local.body, projectId: local.projectId };
    return { id: rec.id, body: rec.body, projectId: rec.projectId };
  }
  if (local && local.body.trim()) return { id: null, body: local.body, projectId: local.projectId };
  return null;
}

// ---- draft -> data store: the command sequence ----

export type Exec = (cmd: Command) => Promise<Result>;

/** Autosave: the first save adds the draft, later saves edit it. Empty text saves nothing (a post needs words). */
export async function saveDraft(exec: Exec, id: string | null, body: string, projectId: string | null): Promise<string | null> {
  if (!body.trim()) return id;
  if (!id) {
    const r = await exec({ type: 'idea.add', text: body, taskId: null, projectId, draft: true });
    return r.ok && r.id ? r.id : null;
  }
  await exec({ type: 'idea.edit', id, body, projectId });
  return id;
}

/** Publish: make sure the draft exists, then one edit that sets body, project and `draft:false`. Returns the post id. */
export async function publishDraft(exec: Exec, id: string | null, body: string, projectId: string | null): Promise<string | null> {
  if (!body.trim()) return null;
  let at = id;
  if (!at) {
    const r = await exec({ type: 'idea.add', text: body, taskId: null, projectId, draft: true });
    if (!r.ok || !r.id) return null;
    at = r.id;
  }
  const r = await exec({ type: 'idea.edit', id: at, body, projectId, draft: false });
  return r.ok ? at : null;
}

/** Back with nothing written: the empty draft goes to the Recycle bin so none linger. */
export async function discardDraft(exec: Exec, id: string | null): Promise<void> {
  if (id) await exec({ type: 'recycle', coll: 'ideas', id, confirmed: true });
}

const isTaskLine = (l: string) => stripPrefix(l).explicit;

/** Saving an edit to a published post: keep each task link on its line. */
export function editCommand(note: Pick<Idea, 'id' | 'body' | 'parsedTaskIds' | 'projectId'>, body: string, projectId: string | null): Command | null {
  const text = body.trim();
  if (!text || (text === note.body && projectId === note.projectId)) return null;
  const links = relink(note.body, text, decodeLinks(note.parsedTaskIds), isTaskLine);
  return { type: 'idea.edit', id: note.id, body: text, projectId, parsedTaskIds: encodeLinks(links, note.parsedTaskIds) };
}
