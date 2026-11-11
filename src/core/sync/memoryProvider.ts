// Test double: a fake Firestore shared by simulated devices. It behaves like the
// real provider where it matters: server commit times (µs, strictly increasing)
// stamp fv/fw/serverUpdatedAt; commit() is one atomic transaction; listeners get
// an initial batch then every change, asynchronously; latency and an offline
// switch can be injected per device.

import type { Coll } from '../model/types';
import type { CommitResult, RemoteDoc, SyncProvider } from './provider';

export interface MemoryServer {
  docs: Map<string, RemoteDoc>;
  /** Last commit time, µs. */
  clock: number;
  listeners: Set<(changed: RemoteDoc[]) => void>;
  writes: number;
  reads: number;
}

export const memoryServer = (): MemoryServer => ({ docs: new Map(), clock: 1_700_000_000_000_000, listeners: new Set(), writes: 0, reads: 0 });

export interface Link {
  online: boolean;
  /** Added before every request and every delivery (ms). */
  latencyMs: number;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const clone = <T>(v: T): T => structuredClone(v);

export function memoryProvider(server: MemoryServer, deviceId: string, link: Link = { online: true, latencyMs: 0 }): SyncProvider {
  const guard = () => {
    if (!link.online) throw new Error('offline');
  };
  return {
    async commit(entries, plan) {
      guard();
      await wait(link.latencyMs);
      guard();
      // Transaction: read all, plan all, then write all at one commit time.
      const results: CommitResult[] = entries.map((e) => {
        const remote = server.docs.get(`${e.coll}/${e.id}`) ?? null;
        server.reads++;
        return { opId: e.opId, plan: plan(e, remote ? clone(remote) : null), remote: remote ? clone(remote) : null };
      });
      const at = ++server.clock;
      const changed: RemoteDoc[] = [];
      for (const [i, r] of results.entries()) {
        const e = entries[i]!;
        const w = r.plan.write;
        if (!w) continue;
        const key = `${e.coll}/${e.id}`;
        const prev = r.plan.replace ? undefined : server.docs.get(key);
        const doc: RemoteDoc = { coll: e.coll, id: e.id, data: { ...(prev?.data ?? {}), ...clone(w) }, fv: { ...(prev?.fv ?? {}) }, fw: { ...(prev?.fw ?? {}) }, serverUpdatedAt: at };
        for (const k of Object.keys(w)) {
          doc.fv[k] = at;
          doc.fw[k] = deviceId;
        }
        server.docs.set(key, doc);
        server.writes++;
        changed.push(doc);
      }
      if (changed.length) for (const l of [...server.listeners]) l(clone(changed));
      return results;
    },

    listen(coll: Coll, since, onDocs, onError) {
      let open = true;
      let initialDone = false;
      const queued: RemoteDoc[][] = [];
      const deliver = (docs: RemoteDoc[]) => {
        void wait(link.latencyMs).then(() => {
          if (!open) return;
          if (!link.online) {
            open = false;
            server.listeners.delete(listener);
            onError(new Error('offline'));
            return;
          }
          onDocs(docs);
        });
      };
      const listener = (changed: RemoteDoc[]) => {
        const mine = changed.filter((d) => d.coll === coll);
        if (!mine.length) return;
        if (!initialDone) queued.push(mine);
        else deliver(mine);
      };
      server.listeners.add(listener);
      void wait(link.latencyMs).then(() => {
        if (!open) return;
        if (!link.online) {
          open = false;
          server.listeners.delete(listener);
          onError(new Error('offline'));
          return;
        }
        const initial = [...server.docs.values()].filter((d) => d.coll === coll && d.serverUpdatedAt >= since).map(clone);
        server.reads += Math.max(1, initial.length);
        initialDone = true;
        onDocs(initial);
        for (const q of queued.splice(0)) deliver(q);
      });
      return () => {
        open = false;
        server.listeners.delete(listener);
      };
    },
  };
}
