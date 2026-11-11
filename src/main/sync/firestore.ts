// The Firestore provider (rules 1-8 in docs/SYNC.md). The only module that talks
// to Firestore. Main process only, memory cache only (the app's own store and
// outbox are the offline layer). Documents live at users/{uid}/{collection}/{id}
// as { ...fields, fv: {field: serverTime}, fw: {field: deviceId}, serverUpdatedAt }.

import type { Firestore } from 'firebase/firestore';
import { Timestamp, collection, doc, onSnapshot, query, runTransaction, serverTimestamp, where, type DocumentSnapshot, type FieldValue } from 'firebase/firestore';
import type { Coll } from '../../core/model/types';
import type { CommitResult, RemoteDoc, SyncProvider } from '../../core/sync/provider';

/** Server time as µs since the epoch (fv values and cursors). */
export const toMicros = (t: Timestamp): number => t.seconds * 1_000_000 + Math.floor(t.nanoseconds / 1000);
export const fromMicros = (us: number): Timestamp => new Timestamp(Math.floor(us / 1_000_000), (us % 1_000_000) * 1000);

const micros = (v: unknown): number => (v instanceof Timestamp ? toMicros(v) : typeof v === 'number' ? v : 0);

export function toRemote(coll: Coll, snap: DocumentSnapshot): RemoteDoc | null {
  if (!snap.exists()) return null;
  const { fv, fw, serverUpdatedAt, ...data } = snap.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>;
  const fvOut: Record<string, number> = {};
  for (const [k, v] of Object.entries((fv as Record<string, unknown>) ?? {})) fvOut[k] = micros(v);
  const fwOut: Record<string, string> = {};
  for (const [k, v] of Object.entries((fw as Record<string, unknown>) ?? {})) if (typeof v === 'string') fwOut[k] = v;
  return { coll, id: snap.id, data, fv: fvOut, fw: fwOut, serverUpdatedAt: micros(serverUpdatedAt) };
}

export function firestoreProvider(db: Firestore, uid: string, deviceId: string): SyncProvider {
  const ref = (coll: Coll, id: string) => doc(db, 'users', uid, coll, id);
  return {
    async commit(entries, plan) {
      return runTransaction(db, async (tx) => {
        const snaps = await Promise.all(entries.map((e) => tx.get(ref(e.coll, e.id))));
        const results: CommitResult[] = entries.map((e, i) => {
          const remote = toRemote(e.coll, snaps[i] as DocumentSnapshot);
          return { opId: e.opId, plan: plan(e, remote), remote };
        });
        results.forEach((r, i) => {
          const e = entries[i]!;
          const w = r.plan.write;
          if (!w) return;
          const at = serverTimestamp();
          if (r.plan.replace) {
            const fv: Record<string, FieldValue> = {};
            const fw: Record<string, string> = {};
            for (const k of Object.keys(w)) {
              fv[k] = at;
              fw[k] = deviceId;
            }
            tx.set(ref(e.coll, e.id), { ...w, id: e.id, fv, fw, serverUpdatedAt: at });
          } else {
            // update() replaces each named field whole (maps included), never deep-merges.
            const patch: Record<string, unknown> = { ...w, serverUpdatedAt: at };
            for (const k of Object.keys(w)) {
              patch[`fv.${k}`] = at;
              patch[`fw.${k}`] = deviceId;
            }
            tx.update(ref(e.coll, e.id), patch);
          }
        });
        return results;
      });
    },

    listen(coll, since, onDocs, onError) {
      const q = query(collection(db, 'users', uid, coll), where('serverUpdatedAt', '>=', fromMicros(since)));
      return onSnapshot(
        q,
        (snap) => {
          const docs: RemoteDoc[] = [];
          for (const c of snap.docChanges()) {
            // Our own unacknowledged writes and docs leaving the query are not news.
            if (c.type === 'removed' || c.doc.metadata.hasPendingWrites) continue;
            const r = toRemote(coll, c.doc);
            if (r) docs.push(r);
          }
          onDocs(docs);
        },
        onError,
      );
    },
  };
}
