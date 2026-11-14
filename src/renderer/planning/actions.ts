// Planning actions the UI triggers: plan the day, re-plan, answer the review. Each is one
// command through the single commit path and each reports itself with an Undo toast
// (undo token from main, or the revert ops the command returned).

import type { Result } from '../../core/commands';
import { run, toast, undoFor } from '../store';

const count = (r: Result): number => (r.ok && r.id !== undefined ? Number(r.id) || 0 : 0);

export async function planDay(date?: string, onDone?: (n: number) => void): Promise<void> {
  const r = await run({ type: 'plan.auto', date });
  if (!r.ok) return;
  const n = count(r);
  onDone?.(n);
  toast(n ? `Planned ${n} ${n === 1 ? 'block' : 'blocks'}.` : 'Nothing to plan: the day is full or the queue is empty.', { undo: n ? undoFor(r) : undefined });
}

export async function replanDay(date?: string): Promise<void> {
  const r = await run({ type: 'plan.replan', date });
  if (!r.ok) return;
  const n = count(r);
  toast(n ? `Moved ${n} missed ${n === 1 ? 'block' : 'blocks'} forward.` : 'Nothing missed to move.', { undo: n ? undoFor(r) : undefined });
}
