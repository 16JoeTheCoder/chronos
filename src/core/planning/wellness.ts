// Wellness (PHASE23 §4): offer a break when a block ends after at least
// planning.breakAfterMin of continuous focus. Never while another block is in
// progress (never mid-block). "Continuous" = work sessions (and the slice running
// now) whose gaps are shorter than BREAK_GAP_MIN; a gap of 5 minutes or more is a
// break already taken. Pure; which prompts were already shown is device-local state
// the caller passes in.

import type { Data } from '../model/types';
import { live, settingsOf } from '../repo/repo';
import { blockSpan, blocksOn, todayOf } from '../tasks/tasks';

const MIN = 60_000;
export const BREAK_GAP_MIN = 5;
/** How long after a block ends the prompt may still appear. */
export const PROMPT_WINDOW_MIN = 10;

export interface FocusChain {
  start: number;
  end: number;
}

/** Work stretches merged across gaps shorter than BREAK_GAP_MIN, oldest first; the running slice counts up to `now`. */
export function focusChains(d: Data, now: number): FocusChain[] {
  const spans: FocusChain[] = live(d, 'sessions').filter((s) => s.phase === 'work' && s.endedAt > s.startedAt).map((s) => ({ start: s.startedAt, end: s.endedAt }));
  for (const t of live(d, 'tasks')) {
    const rt = t.runtime;
    if (rt.sliceStartedAt !== null && rt.status === 'running' && !(t.timer.mode === 'pomodoro' && rt.phase !== 'work') && now > rt.sliceStartedAt) spans.push({ start: rt.sliceStartedAt, end: now });
  }
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const out: FocusChain[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.start - last.end < BREAK_GAP_MIN * MIN) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

export interface BreakPrompt {
  /** Dedupe key: the block that just ended. */
  blockId: string;
  taskId: string | null;
  /** Continuous focus up to the block's end, minutes. */
  focusedMin: number;
  blockEndedAt: number;
}

/** The break to offer right now, or null. `shown` = block ids already prompted on this device. */
export function breakDue(d: Data, now: number, shown: ReadonlySet<string> = new Set()): BreakPrompt | null {
  const after = settingsOf(d).planning.breakAfterMin;
  const blocks = blocksOn(d, todayOf(d, now)).filter((b) => b.kind !== 'break');
  // Never mid-block: while any block is in progress there is no prompt.
  if (blocks.some((b) => blockSpan(b)[0] <= now && now < blockSpan(b)[1])) return null;
  const chains = focusChains(d, now);
  const ended = blocks
    .filter((b) => !shown.has(b.id) && blockSpan(b)[1] <= now && now - blockSpan(b)[1] <= PROMPT_WINDOW_MIN * MIN)
    .sort((a, b) => blockSpan(b)[1] - blockSpan(a)[1]);
  for (const b of ended) {
    const [bs, be] = blockSpan(b);
    const chain = chains.find((c) => c.start < be && c.end > bs);
    if (!chain || now - chain.end >= BREAK_GAP_MIN * MIN) continue; // no focus in it, or already resting
    const focusedMin = Math.floor((Math.min(chain.end, be) - chain.start) / MIN);
    if (focusedMin >= after) return { blockId: b.id, taskId: b.taskId, focusedMin, blockEndedAt: be };
  }
  return null;
}
