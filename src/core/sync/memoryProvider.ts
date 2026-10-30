// Test double: a shared in-memory "server" that behaves like Firestore set():
// each write overwrites the doc and gets a fresh, strictly increasing server time.

import type { Coll } from '../model/types';
import type { Change, SyncProvider } from './provider';

export interface MemoryServer {
  docs: Map<string, Change>;
  clock: number;
  listeners: Set<() => void>;
}

export const memoryServer = (): MemoryServer => ({ docs: new Map(), clock: 0, listeners: new Set() });

export function memoryProvider(server: MemoryServer, online = { value: true }): SyncProvider {
  const guard = () => {
    if (!online.value) throw new Error('offline');
  };
  return {
    get status() {
      return online.value ? 'idle' : 'offline';
    },
    async push(changes) {
      guard();
      for (const c of changes) server.docs.set(`${c.coll}/${c.rec.id}`, { coll: c.coll, rec: structuredClone(c.rec), serverUpdatedAt: ++server.clock });
      server.listeners.forEach((l) => l());
    },
    async pull(coll: Coll, since) {
      guard();
      return [...server.docs.values()].filter((c) => c.coll === coll && (c.serverUpdatedAt ?? 0) > since).map((c) => structuredClone(c));
    },
    subscribe(cb) {
      server.listeners.add(cb);
      return () => server.listeners.delete(cb);
    },
  };
}
