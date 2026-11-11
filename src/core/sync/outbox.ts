// The outbox (rule 2): every local mutation becomes an entry naming the fields
// it changed, captured by diffing Data before and after (so every write path is
// covered: commands, normalize, housekeeping, imports, restores). Entries are
// coalesced per record while they wait, flushed in order and removed only once
// the server acknowledged them.

import { newId } from '../model/ids';
import { COLLS, type Coll, type Data, type Rec, type Stub } from '../model/types';
import type { OutboxEntry } from './provider';

const SYNC_ONLY = new Set(['fv', 'fw']);

/** Order-insensitive structural equality for JSON-like values (Firestore reorders map keys). */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => same(x, (b as unknown[])[i]));
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** The record's fields as stored remotely (sync maps excluded). */
export function syncedFields(rec: Rec | Stub): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) if (!SYNC_ONLY.has(k) && v !== undefined) out[k] = v;
  return out;
}

/** What changed between two versions of the data, as outbox entries (not yet coalesced). */
export function diffData(before: Data, after: Data, now: number): OutboxEntry[] {
  const out: OutboxEntry[] = [];
  for (const coll of COLLS) {
    const a = before[coll] as Record<string, Rec>;
    const b = after[coll] as Record<string, Rec>;
    if (a !== b) {
      for (const [id, rec] of Object.entries(b)) {
        const prev = a[id];
        if (prev === rec) continue;
        const fields: Record<string, unknown> = {};
        const baseFv: Record<string, number> = {};
        for (const [k, v] of Object.entries(rec)) {
          if (SYNC_ONLY.has(k) || v === undefined) continue;
          if (prev && same(prev[k as keyof Rec], v)) continue;
          fields[k] = v;
          const f = prev?.fv?.[k];
          if (f !== undefined) baseFv[k] = f;
        }
        if (Object.keys(fields).length) out.push({ opId: newId(), coll, id, fields, baseFv, createdAt: now });
      }
    }
    const ta = before.tombs[coll] ?? {};
    const tb = after.tombs[coll] ?? {};
    if (ta !== tb) {
      for (const [id, stub] of Object.entries(tb)) if (ta[id] !== stub) out.push({ opId: newId(), coll, id, fields: { ...stub }, baseFv: {}, createdAt: now, replace: true });
    }
  }
  return out;
}

/** Append entries, merging each into a waiting (not in-flight) entry for the same record. */
export function enqueue(outbox: OutboxEntry[], entries: OutboxEntry[], inflight: ReadonlySet<string> = new Set()): OutboxEntry[] {
  if (!entries.length) return outbox;
  const out = [...outbox];
  for (const e of entries) {
    const i = out.findIndex((x) => x.coll === e.coll && x.id === e.id && !inflight.has(x.opId) && !x.seed === !e.seed);
    const cur = out[i];
    if (!cur) {
      out.push(e);
      continue;
    }
    out[i] = e.replace
      ? { ...cur, fields: e.fields, baseFv: {}, replace: true }
      : { ...cur, fields: { ...cur.fields, ...e.fields }, baseFv: { ...e.baseFv, ...cur.baseFv }, replace: cur.replace };
  }
  return out;
}

/** coll/id/field keys with a local edit not yet acknowledged ('coll/id/*' for a whole-doc replace). */
export function pendingFields(outbox: readonly OutboxEntry[]): Set<string> {
  const out = new Set<string>();
  for (const e of outbox) {
    if (e.replace) out.add(`${e.coll}/${e.id}/*`);
    for (const k of Object.keys(e.fields)) out.add(`${e.coll}/${e.id}/${k}`);
  }
  return out;
}

/** Re-apply waiting entries to local data (startup after a crash between the outbox write and the data write). */
export function replay(d: Data, outbox: readonly OutboxEntry[]): Data {
  let out = d;
  for (const e of outbox) {
    if (e.replace) {
      const live = { ...(out[e.coll] as Record<string, Rec>) };
      delete live[e.id];
      out = { ...out, [e.coll]: live, tombs: { ...out.tombs, [e.coll]: { ...out.tombs[e.coll], [e.id]: e.fields as unknown as Stub } } };
      continue;
    }
    if (out.tombs[e.coll]?.[e.id]) continue;
    const cur = (out[e.coll] as Record<string, Rec>)[e.id];
    const next = { ...(cur ?? { fv: {}, fw: {} }), ...e.fields } as Rec;
    if (cur && same(syncedFields(cur), syncedFields(next))) continue;
    out = { ...out, [e.coll]: { ...out[e.coll], [e.id]: next } };
  }
  return out;
}

/**
 * Fields that were never synced (no fv): what a first sign-in must upload. Run
 * after the first full pull, so anything the server already has is skipped.
 */
export function seedEntries(d: Data, now: number, pending: ReadonlySet<string>): OutboxEntry[] {
  const out: OutboxEntry[] = [];
  for (const coll of COLLS) {
    for (const rec of Object.values(d[coll] as Record<string, Rec>)) {
      if (pending.has(`${coll}/${rec.id}/*`)) continue;
      const fields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(syncedFields(rec))) if (rec.fv?.[k] === undefined && !pending.has(`${coll}/${rec.id}/${k}`)) fields[k] = v;
      if (Object.keys(fields).length) out.push({ opId: newId(), coll: coll as Coll, id: rec.id, fields, baseFv: {}, createdAt: now, seed: true });
    }
  }
  return out;
}

/** Forget every server version (signing in to a different account uploads everything again). */
export function clearSyncMeta(d: Data): Data {
  const out = { ...d } as Data;
  for (const coll of COLLS) {
    const recs: Record<string, Rec> = {};
    for (const [id, r] of Object.entries(d[coll] as Record<string, Rec>)) recs[id] = { ...r, fv: {}, fw: {} };
    (out as Record<string, unknown>)[coll] = recs;
  }
  return out;
}
