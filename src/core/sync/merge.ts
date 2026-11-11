// Merge rules (rules 4-6, 8), pure:
// - planCommit decides, inside the flush transaction, what one outbox entry
//   writes. The local pending edit wins; if another device changed the same
//   field since this edit was made (remote fv differs from the entry's baseFv and
//   the last writer was not us) a Conflict is logged. A remote tombstone wins over
//   an edit that does not itself delete or restore. A record from a newer schema
//   is never written over.
// - mergeRemote folds pulled documents into local data field by field: fields
//   with a pending local edit keep the local value, the rest take the server's.
//   Server timestamps (fv) order everything, so client clocks never decide.

import { META_FIELDS, get, putRaw, timerOf, type Ctx } from '../repo/repo';
import { SCHEMA_V, type Coll, type Conflict, type Data, type QuarantineItem, type Rec, type Stub } from '../model/types';
import { recordProblem } from '../validation';
import { recordSlices } from '../tasks/tasks';
import { pauseAt } from '../timer/timer';
import { same, syncedFields } from './outbox';
import type { CommitPlan, OutboxEntry, RemoteDoc } from './provider';

const isRemoteStub = (r: RemoteDoc) => r.data.purged === true;
const newer = (r: RemoteDoc) => typeof r.data.v === 'number' && r.data.v > SCHEMA_V;

/** Decide one entry's write against the remote doc (null = does not exist yet). */
export function planCommit(e: OutboxEntry, remote: RemoteDoc | null, local: Rec | Stub | undefined, deviceId: string, now: number): CommitPlan {
  const none = (outcome: CommitPlan['outcome'], conflicts: Conflict[] = [], adopt = false): CommitPlan => ({ outcome, write: null, replace: false, conflicts, adopt });
  if (remote && newer(remote)) return none('newerSchema');
  const lost = (r: RemoteDoc): Conflict[] =>
    Object.entries(e.fields)
      .filter(([k, v]) => !META_FIELDS.has(k) && k !== 'deletedAt' && !same(r.data[k], v))
      .map(([field, v]) => ({ at: now, coll: e.coll, id: e.id, field, overwrittenValue: v, newValue: r.data[field] ?? null, otherDeviceId: r.fw.deletedAt ?? String(r.data.deviceId ?? '') }));
  if (remote && isRemoteStub(remote)) return e.replace ? none('noop') : none('tombstoned', e.seed ? [] : lost(remote), true);
  if (e.replace) return { outcome: 'written', write: { ...e.fields }, replace: true, conflicts: [], adopt: false };
  if (!remote) {
    // A new document: send the whole record so other devices never see half of one.
    const write = local && !(local as Stub).purged ? { ...syncedFields(local), ...e.fields } : { ...e.fields };
    return { outcome: 'written', write, replace: true, conflicts: [], adopt: false };
  }
  if (e.seed) {
    // Fill only what the server does not have; adopt the rest.
    const write = Object.fromEntries(Object.entries(e.fields).filter(([k]) => remote.fv[k] === undefined && !(k in remote.data)));
    return Object.keys(write).length ? { outcome: 'written', write, replace: false, conflicts: [], adopt: true } : none('noop', [], true);
  }
  if (remote.data.deletedAt !== null && remote.data.deletedAt !== undefined && !('deletedAt' in e.fields)) return none('tombstoned', lost(remote), true);
  const conflicts: Conflict[] = [];
  for (const [field, v] of Object.entries(e.fields)) {
    if (META_FIELDS.has(field)) continue;
    const rv = remote.fv[field];
    if (rv === undefined || rv === e.baseFv[field] || remote.fw[field] === deviceId || same(remote.data[field], v)) continue;
    conflicts.push({ at: now, coll: e.coll, id: e.id, field, overwrittenValue: remote.data[field] ?? null, newValue: v, otherDeviceId: remote.fw[field] ?? String(remote.data.deviceId ?? '') });
  }
  return { outcome: 'written', write: { ...e.fields }, replace: false, conflicts, adopt: false };
}

export interface MergeResult {
  d: Data;
  quarantined: QuarantineItem[];
  /** Docs from a newer schema: not merged; sync goes read-only. */
  newer: RemoteDoc[];
  changed: number;
}

/** Fold pulled documents into local data. `pending` comes from outbox.pendingFields. */
export function mergeRemote(d: Data, docs: readonly RemoteDoc[], pending: ReadonlySet<string>, ctx: Ctx): MergeResult {
  let out = d;
  const quarantined: QuarantineItem[] = [];
  const newerDocs: RemoteDoc[] = [];
  let changed = 0;
  for (const doc of docs) {
    const { coll, id } = doc;
    if (newer(doc)) {
      newerDocs.push(doc);
      continue;
    }
    const stubbed = out.tombs[coll]?.[id];
    if (isRemoteStub(doc)) {
      const stub = { ...doc.data, id } as unknown as Stub;
      const problem = recordProblem(coll, stub);
      if (problem) {
        quarantined.push({ at: ctx.now, coll, id, reason: problem, doc: doc.data });
        continue;
      }
      if (stubbed) continue;
      const live = { ...(out[coll] as Record<string, Rec>) };
      delete live[id];
      out = { ...out, [coll]: live, tombs: { ...out.tombs, [coll]: { ...out.tombs[coll], [id]: stub } } };
      changed++;
      continue;
    }
    // A purge stub is terminal locally; our own stub is on its way to the server.
    if (stubbed || pending.has(`${coll}/${id}/*`)) continue;
    const local = get(out, coll, id) as Rec | undefined;
    const merged: Record<string, unknown> = { ...(local ?? {}) };
    for (const [k, v] of Object.entries(doc.data)) {
      if (k === 'serverUpdatedAt' || k === 'fv' || k === 'fw') continue;
      if (!pending.has(`${coll}/${id}/${k}`)) merged[k] = v;
    }
    merged.id = id;
    merged.fv = { ...(local?.fv ?? {}), ...doc.fv };
    merged.fw = { ...(local?.fw ?? {}), ...doc.fw };
    const problem = recordProblem(coll, merged);
    if (problem) {
      quarantined.push({ at: ctx.now, coll, id, reason: problem, doc: doc.data });
      continue;
    }
    if (local && same(local, merged)) continue;
    out = putRaw(out, coll as Coll, merged as never);
    changed++;
  }
  return { d: changed ? afterTakeover(d, out, ctx) : d, quarantined, newer: newerDocs, changed };
}

/** The previous owner records the slice it ran up to the takeover instant. */
export function afterTakeover(before: Data, after: Data, ctx: Ctx): Data {
  const was = timerOf(before);
  const now = timerOf(after);
  if (was.ownerDeviceId !== ctx.deviceId || now.ownerDeviceId === ctx.deviceId || now.takeoverAt === null) return after;
  const task = get(before, 'tasks', was.taskId);
  if (!task || task.runtime.status !== 'running') return after;
  return recordSlices(after, task.id, pauseAt(task, Math.min(ctx.now, now.takeoverAt)).slices, ctx);
}
