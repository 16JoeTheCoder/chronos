// Recycle and purge (§5.2). Delete is a tombstone (deletedAt). After 7 days the
// record's content is wiped and only a stub remains (so the user's content is
// really gone); after 60 days the stub is dropped too. The stub exists only so an
// offline device cannot resurrect a deleted record when it syncs.

import { COLLS, SCHEMA_V, type Coll, type Data, type Rec, type Stub } from '../model/types';

export const RECYCLE_DAYS = 7;
export const STUB_DAYS = 60;
const DAY = 86_400_000;

/** Items in the recycle bin, newest first. */
export function recycled(d: Data): { coll: Coll; rec: Rec }[] {
  const out: { coll: Coll; rec: Rec }[] = [];
  for (const coll of COLLS) for (const rec of Object.values(d[coll] as Record<string, Rec>)) if (rec.deletedAt !== null) out.push({ coll, rec });
  return out.sort((a, b) => (b.rec.deletedAt ?? 0) - (a.rec.deletedAt ?? 0));
}

export function purge(d: Data, now: number, deviceId: string): Data {
  let changed = false;
  const out = { ...d, tombs: { ...d.tombs } } as Data;
  for (const coll of COLLS) {
    const records = { ...(d[coll] as Record<string, Rec>) };
    const tombs = { ...(d.tombs[coll] ?? {}) };
    for (const rec of Object.values(records)) {
      if (rec.deletedAt === null || now - rec.deletedAt < RECYCLE_DAYS * DAY) continue;
      const stub: Stub = { id: rec.id, updatedAt: Math.max(now, rec.updatedAt + 1), deletedAt: rec.deletedAt, deviceId, v: SCHEMA_V, purged: true };
      delete records[rec.id];
      tombs[rec.id] = stub;
      changed = true;
    }
    for (const stub of Object.values(tombs)) {
      if (now - stub.deletedAt >= STUB_DAYS * DAY) {
        delete tombs[stub.id];
        changed = true;
      }
    }
    (out as Record<string, unknown>)[coll] = records;
    out.tombs[coll] = tombs;
  }
  return changed ? out : d;
}
