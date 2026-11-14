// Log post lines: which lines of a note are tasks. Pure; the parser does the reading.
//
// Thresholds (D-139):
//   task  (auto-add, Undo toast): an explicit prefix (`- `, `[] `, `task `), or a high-confidence
//         parse that has a task/fixed keyword AND a date or time ("call mom tomorrow 5pm").
//   chip  (faint "Add as task?"): a task/fixed parse that is not clear enough: no date or time,
//         or medium confidence ("email Sarah", "math hw").
//   text  (nothing): a note-kind parse, or a low-confidence one ("had a good session today").

import { parse, type ParseContext, type ParseResult } from '../parser';
import type { TaskInput } from '../commands';
import type { Priority } from '../model/types';

export type LineKind = 'task' | 'chip' | 'text';

export interface LineInfo {
  index: number;
  /** The raw line. */
  text: string;
  /** The line without its task prefix: what the checkbox line shows. */
  body: string;
  kind: LineKind;
  /** True when the line carries an explicit prefix. */
  explicit: boolean;
  input: TaskInput | null;
}

/** `- `, `* `, `- [ ] `, `[] `, `[ ] `, `[x] `, `task `. Longest alternative first. */
const PREFIX = /^\s*(?:[-*]\s+\[[ xX]?\]\s*|[-*]\s+|\[[ xX]?\]\s*|task\s+)/i;
/** Most task lines one post may queue by itself; the rest get chips. */
export const MAX_AUTO_LINES = 20;

export const splitLines = (body: string): string[] => String(body ?? '').split('\n').map((l) => l.replace(/\r$/, ''));

export const stripPrefix = (line: string): { body: string; explicit: boolean } => {
  const m = PREFIX.exec(line);
  return m ? { body: line.slice(m[0].length).trim(), explicit: true } : { body: line.trim(), explicit: false };
};

const PRIORITY: Record<number, Priority> = { 1: 'must', 2: 'should', 3: 'nice' };

/** The task fields a parse result implies. */
export function taskInputOf(r: ParseResult, fallbackTitle: string, projectId: string | null): TaskInput {
  const input: TaskInput = { title: (r.title || fallbackTitle).slice(0, 200), source: 'parsed', projectId: r.projectId ?? projectId };
  const due = r.date;
  if (due) input.dueDate = due;
  const t = r.dueTime ?? r.startMin;
  if (t !== undefined) input.dueTime = t;
  const est = r.estimateMin ?? r.durationMin;
  if (est !== undefined && est >= 1) input.estimateMin = est;
  if (r.tagId) input.tagId = r.tagId;
  if (r.priority) input.priority = PRIORITY[r.priority];
  return input;
}

const hasWhen = (r: ParseResult) => r.date !== undefined || r.startMin !== undefined || r.dueTime !== undefined || r.recurrence !== undefined;

/** Decide one line. Empty and note lines are 'text'. */
export function classifyLine(text: string, ctx: ParseContext, projectId: string | null = null, index = 0): LineInfo {
  const { body, explicit } = stripPrefix(text);
  const text_: LineInfo = { index, text, body, kind: 'text', explicit, input: null };
  if (!body) return text_;
  const r = parse(body, { ...ctx, mode: 'quick', source: 'log' });
  if (explicit) return { ...text_, kind: 'task', input: taskInputOf(r, body, projectId) };
  if (r.kind === 'note' || r.confidence === 'low') return text_;
  const keyword = r.spans.some((s) => s.role === 'kindKeyword');
  const kind: LineKind = r.confidence === 'high' && hasWhen(r) && keyword ? 'task' : 'chip';
  return { ...text_, kind, input: taskInputOf(r, body, projectId) };
}

/** Every line of a post, classified. Blank lines are included as 'text' so indexes match the body. */
export function analyzeBody(body: string, ctx: ParseContext, projectId: string | null = null): LineInfo[] {
  return splitLines(body).map((l, i) => classifyLine(l, ctx, projectId, i));
}

/** Lines to queue on posting: clear task lines, capped. */
export const autoLines = (lines: LineInfo[]): LineInfo[] => lines.filter((l) => l.kind === 'task').slice(0, MAX_AUTO_LINES);

/** Cheap prefix check used by `is:task` (no parser). */
export const hasTaskPrefix = (body: string): boolean => splitLines(body).some((l) => PREFIX.test(l) && stripPrefix(l).body !== '');
