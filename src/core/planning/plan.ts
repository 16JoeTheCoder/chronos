// Auto-plan and re-plan (PHASE23 §4). Pure: (data, date, clock) -> new data plus a
// report. Both run as ONE command through the single commit path (commands.ts
// 'plan.auto' / 'plan.replan'), which also returns the revert ops that undo the
// whole run as one action.
//
// Free time = what core/time/timeLeft leaves: inside the day, before the end-of-day
// buffer, outside fixed events (padded by the transition variant), outside the meal
// reserve and every existing block. Auto-plan only ever ADDS blocks (auto: true);
// it never touches a manual block. Re-plan only ever MOVES unfinished auto blocks
// that ended without being started, later in the same day, into the gaps that are left.

import { autoBlockId } from '../model/ids';
import type { Block, Data, Task } from '../model/types';
import { create, get, live, settingsOf, update, type Ctx } from '../repo/repo';
import { PRIORITY_RANK, blockSpan, blocksOn, isLocked, isOpen, todayOf } from '../tasks/tasks';
import { expandEvents } from '../time/schedule';
import { timeLeft } from '../time/timeLeft';
import { localParts, zonedToUtc } from '../time/zone';
import { estimateMin } from './estimates';

const MIN = 60_000;
export const MIN_BLOCK_MIN = 5;

/** A free stretch of the day in minutes after local midnight. */
export interface Gap {
  startMin: number;
  endMin: number;
}

/**
 * Free stretches on `date` for planning. Today starts at `now` (snapped up to
 * settings.snapMin); other dates start at the day start; past dates have none.
 * Blocks in `ignore` are treated as if they were not there (re-plan).
 */
export function freeGaps(d: Data, date: string, now: number, ignore: ReadonlySet<string> = new Set()): Gap[] {
  const s = settingsOf(d);
  const today = todayOf(d, now);
  if (date < today) return [];
  const dayStart = zonedToUtc(date, s.dayStartMin, s.timezone);
  const dayEnd = zonedToUtc(date, s.dayEndMin, s.timezone);
  const tl = timeLeft({
    now: date === today ? now : dayStart,
    dayStart,
    dayEnd,
    bufferMin: s.bufferMin,
    fixed: expandEvents(d, date).map((i): [number, number] => [i.start, i.end]),
    blocks: blocksOn(d, date).filter((b) => !ignore.has(b.id)).map(blockSpan),
    variants: s.timeLeft,
  });
  const out: Gap[] = [];
  for (const [a, b] of tl.free) {
    const raw = localParts(a, s.timezone).minutes;
    const startMin = Math.ceil(raw / s.snapMin) * s.snapMin;
    const endMin = Math.min(1440, raw + Math.floor((b - a) / MIN));
    if (endMin - startMin >= MIN_BLOCK_MIN) out.push({ startMin, endMin });
  }
  return out;
}

/** Order of the plan: priority, then due date (none last), then sortKey, then id (every device derives the same plan). */
export function byPlanOrder(a: Task, b: Task): number {
  return (
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99') ||
    (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0) ||
    (a.id < b.id ? -1 : 1)
  );
}

/**
 * Tasks auto-plan may place on `date`: open, not started (a started task is the
 * user's to continue), and with no block on that date or later yet.
 */
export function planCandidates(d: Data, date: string): Task[] {
  const scheduled = new Set(live(d, 'blocks').filter((b) => b.taskId && b.date >= date).map((b) => b.taskId));
  return live(d, 'tasks').filter((t) => isOpen(t) && !isLocked(t) && !scheduled.has(t.id)).sort(byPlanOrder);
}

export interface PlannedBlock {
  blockId: string;
  taskId: string;
  title: string;
  startMin: number;
  endMin: number;
}
export interface AutoPlanResult {
  d: Data;
  placed: PlannedBlock[];
  /** Candidate task ids that did not fit in any remaining gap. */
  unplaced: string[];
}

/** First-fit `tasks` (in the given order) into the free gaps of `date`, as auto blocks. */
export function placeTasks(d: Data, date: string, tasks: readonly Task[], ctx: Ctx): AutoPlanResult {
  const tz = settingsOf(d).timezone;
  const gaps = freeGaps(d, date, ctx.now);
  let out = d;
  const placed: PlannedBlock[] = [];
  const unplaced: string[] = [];
  for (const t of tasks) {
    const dur = estimateMin(d, t);
    const gap = gaps.find((g) => g.endMin - g.startMin >= dur);
    if (!gap) {
      unplaced.push(t.id);
      continue;
    }
    const startMin = gap.startMin;
    const endMin = startMin + dur;
    gap.startMin = endMin;
    const blockId = autoBlockId(t.id, date);
    out = create(out, 'blocks', { taskId: t.id, tagId: t.tagId, title: t.title.slice(0, 120), date, startMin, endMin, tz, kind: t.kind === 'sprint' ? 'sprint' : 'work', auto: true }, ctx, blockId).d;
    placed.push({ blockId, taskId: t.id, title: t.title, startMin, endMin });
  }
  return { d: out, placed, unplaced };
}

/** Fill today's (or `date`'s) free gaps with the candidates, most important first. */
export function autoPlan(d: Data, date: string, ctx: Ctx): AutoPlanResult {
  return placeTasks(d, date, planCandidates(d, date), ctx);
}

export interface MovedBlock {
  blockId: string;
  taskId: string;
  fromStartMin: number;
  startMin: number;
  endMin: number;
}
export interface ReplanResult {
  d: Data;
  moved: MovedBlock[];
  /** Block ids that found no gap and stay where they are. */
  stuck: string[];
}

/** Missed blocks: unfinished auto blocks of today that have already ended and whose task was never started. */
export function movableBlocks(d: Data, date: string, now: number): Block[] {
  if (date !== todayOf(d, now)) return [];
  const nowMin = localParts(now, settingsOf(d).timezone).minutes;
  return blocksOn(d, date).filter((b) => {
    const t = get(d, 'tasks', b.taskId);
    return b.auto && b.kind !== 'break' && b.endMin <= nowMin && !!t && isOpen(t) && !isLocked(t);
  });
}

/** Move missed auto blocks forward, in their original order, into the gaps that remain today. Manual blocks never move. */
export function replan(d: Data, date: string, ctx: Ctx): ReplanResult {
  const movable = movableBlocks(d, date, ctx.now);
  const gaps = freeGaps(d, date, ctx.now, new Set(movable.map((b) => b.id)));
  let out = d;
  const moved: MovedBlock[] = [];
  const stuck: string[] = [];
  for (const b of movable) {
    const len = b.endMin - b.startMin;
    const gap = gaps.find((g) => g.endMin - g.startMin >= len);
    if (!gap) {
      stuck.push(b.id);
      continue;
    }
    const startMin = gap.startMin;
    gap.startMin += len;
    out = update(out, 'blocks', b.id, { startMin, endMin: startMin + len }, ctx);
    moved.push({ blockId: b.id, taskId: b.taskId as string, fromStartMin: b.startMin, startMin, endMin: startMin + len });
  }
  return { d: out, moved, stuck };
}
