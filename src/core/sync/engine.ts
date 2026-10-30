// Sync engine (§10.1). Local data is the source of truth; sync replicates in the
// background. Rules:
// - Dirty: a record this device last wrote with updatedAt > lastPushedAt.
// - Merge: last-write-wins per record on updatedAt (client clock), tie-break on
//   deviceId. A purge stub is terminal: it beats any full record, so a deleted
//   record can never be resurrected by an offline device.
// - If the local copy beats what the server holds, it is pushed again, so plain
//   overwriting writes on the server still converge.
// - Pull cursors use the server's timestamp, so client clock skew never skips changes.
// - DeviceSettings are never synced (they are not in Data).
// - Timer ownership: only the owner drives the running timer; Take over closes the
//   previous owner's slice at the takeover instant on both devices (same session id).

import { COLLS, type Coll, type Data, type Rec, type Stub } from '../model/types';
import { get, putRaw, timerOf, update, type Ctx } from '../repo/repo';
import { recordSlices } from '../tasks/tasks';
import { pauseAt, start } from '../timer/timer';
import { isStub, type Change, type SyncProvider } from './provider';

export interface SyncState {
  lastPushedAt: number;
  cursors: Partial<Record<Coll, number>>;
}

/** Remote beats local? */
export function wins(remote: Rec | Stub, local: Rec | Stub | undefined): boolean {
  if (!local) return true;
  if (isStub(local)) return false;
  if (isStub(remote)) return true;
  return remote.updatedAt > local.updatedAt || (remote.updatedAt === local.updatedAt && remote.deviceId > local.deviceId);
}

function localOf(d: Data, coll: Coll, id: string): Rec | Stub | undefined {
  return d.tombs[coll]?.[id] ?? get(d, coll, id);
}

export function dirty(d: Data, state: SyncState, deviceId: string): Change[] {
  const out: Change[] = [];
  for (const coll of COLLS) {
    const recs: (Rec | Stub)[] = [...Object.values(d[coll] as Record<string, Rec>), ...Object.values(d.tombs[coll] ?? {})];
    for (const rec of recs) if (rec.deviceId === deviceId && rec.updatedAt > state.lastPushedAt) out.push({ coll, rec });
  }
  return out;
}

/** Apply pulled changes. Returns the merged data and local records that must be re-pushed. */
export function merge(d: Data, changes: Change[], ctx: Ctx): { d: Data; repush: Change[] } {
  let out = d;
  const repush: Change[] = [];
  for (const { coll, rec } of changes) {
    const local = localOf(out, coll, rec.id);
    if (!wins(rec, local)) {
      const same = local && !isStub(local) && !isStub(rec) && local.updatedAt === rec.updatedAt && local.deviceId === rec.deviceId;
      if (local && !same && !(isStub(local) && isStub(rec))) repush.push({ coll, rec: local });
      continue;
    }
    if (isStub(rec)) {
      const live = { ...(out[coll] as Record<string, Rec>) };
      delete live[rec.id];
      out = { ...out, [coll]: live, tombs: { ...out.tombs, [coll]: { ...out.tombs[coll], [rec.id]: rec } } };
    } else {
      out = putRaw(out, coll, rec as never);
    }
  }
  return { d: afterTakeover(d, out, ctx), repush };
}

/** The previous owner records the slice it ran up to the takeover instant. */
function afterTakeover(before: Data, after: Data, ctx: Ctx): Data {
  const was = timerOf(before);
  const now = timerOf(after);
  if (was.ownerDeviceId !== ctx.deviceId || now.ownerDeviceId === ctx.deviceId || now.takeoverAt === null) return after;
  const task = get(before, 'tasks', was.taskId);
  if (!task || task.runtime.status !== 'running') return after;
  return recordSlices(after, task.id, pauseAt(task, Math.min(ctx.now, now.takeoverAt)).slices, ctx);
}

/** Take over the running timer on this device: bank the old owner's slice, continue here. */
export function takeover(d: Data, ctx: Ctx & { deviceName?: string }): Data {
  const at = timerOf(d);
  let out = update(d, 'timer', 'current', { ownerDeviceId: ctx.deviceId, ownerName: ctx.deviceName ?? '', takeoverAt: ctx.now }, ctx);
  const task = get(d, 'tasks', at.taskId);
  if (task?.runtime.status === 'running') {
    const s = pauseAt(task, ctx.now);
    const next = s.task.runtime.status === 'paused' ? start(s.task, ctx.now) : s.task;
    out = recordSlices(update(out, 'tasks', task.id, next, ctx), task.id, s.slices, ctx);
  }
  return out;
}

/** One round: pull every collection, merge, push what is dirty or must be re-pushed. */
export async function syncOnce(d: Data, state: SyncState, provider: SyncProvider, ctx: Ctx): Promise<{ d: Data; state: SyncState; pushed: number; pulled: number }> {
  const cursors = { ...state.cursors };
  const pulled: Change[] = [];
  for (const coll of COLLS) {
    const changes = await provider.pull(coll, cursors[coll] ?? 0);
    for (const c of changes) cursors[coll] = Math.max(cursors[coll] ?? 0, c.serverUpdatedAt ?? 0);
    pulled.push(...changes);
  }
  const m = merge(d, pulled, ctx);
  const seen = new Set<string>();
  const push = [...dirty(m.d, state, ctx.deviceId), ...m.repush].filter((c) => {
    const k = `${c.coll}/${c.rec.id}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  if (push.length) await provider.push(push);
  const lastPushedAt = push.reduce((mx, c) => (c.rec.deviceId === ctx.deviceId ? Math.max(mx, c.rec.updatedAt) : mx), state.lastPushedAt);
  return { d: m.d, state: { lastPushedAt, cursors }, pushed: push.length, pulled: pulled.length };
}
