// One undo step for any change between two versions of the data: the previous
// values of exactly the fields that changed (a created record is recycled). Used
// by the MCP undo tokens and by the planning commands (auto-plan, re-plan, review),
// which return it so the whole command is undone as one action with records.revert.

import type { RevertOp } from './commands';
import type { Coll, Data, Rec } from './model/types';
import { diffData } from './sync/outbox';

export function revertOpsBetween(before: Data, after: Data, now: number): RevertOp[] {
  return diffData(before, after, now).map((e) => {
    const prev = (before[e.coll] as Record<string, Rec>)[e.id];
    if (!prev) return { coll: e.coll as Coll, id: e.id, prev: null };
    const fields: Record<string, unknown> = {};
    for (const k of Object.keys(e.fields)) fields[k] = (prev as unknown as Record<string, unknown>)[k] ?? null;
    return { coll: e.coll as Coll, id: e.id, prev: fields };
  });
}
