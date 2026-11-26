// ControllerStore over IndexedDB: everything is hydrated before the Controller starts (its loads
// are synchronous), saves are write-behind and coalesced per key. Snapshots keep the newest 7.

import type { ControllerStore } from '../../main/controller';
import type { KV, Small } from './kv';

export const SNAPSHOT_KEEP = 7;
export const SAVE_BEHIND_MS = 40;
const SNAPSHOT_RE = /^chronos-(\d{4}-\d{2}-\d{2}|before-[\w-]+)\.json$/;
const HEARTBEAT_KEY = 'chronos.heartbeat';
const FIELDS = ['data', 'device', 'outbox', 'conflicts', 'quarantine'] as const;

export interface WebStore extends ControllerStore {
  /** Write everything pending now (pagehide, sign-out, tests). */
  flush(): Promise<void>;
  /** Stop writing for good (public-computer wipe: the database is about to be deleted). */
  discard(): void;
}

export async function openWebStore(kv: KV, small: Small, delayMs = SAVE_BEHIND_MS): Promise<WebStore> {
  const mem = new Map<string, unknown>();
  const snaps = new Map<string, { at: number; value: unknown }>();
  for (const k of await kv.keys()) {
    const v = await kv.get(k);
    if (v === undefined) continue;
    if (k.startsWith('snap:')) snaps.set(k.slice(5), v as { at: number; value: unknown });
    else mem.set(k, v);
  }
  const dirty = new Set<string>();
  const removed = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> = Promise.resolve();
  let dead = false;

  const write = async (): Promise<void> => {
    if (dead) return;
    const keys = [...dirty];
    const gone = [...removed];
    dirty.clear();
    removed.clear();
    try {
      for (const k of keys) await kv.set(k, k.startsWith('snap:') ? snaps.get(k.slice(5)) : mem.get(k));
      for (const k of gone) await kv.del(k);
    } catch {
      // Storage full or blocked: keep the keys dirty so the next flush retries.
      for (const k of keys) dirty.add(k);
      for (const k of gone) removed.add(k);
    }
  };
  const flush = (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = null;
    writing = writing.then(write);
    return writing;
  };
  const touch = (k: string) => {
    dirty.add(k);
    removed.delete(k);
    timer ??= setTimeout(() => void flush(), delayMs);
  };
  const field = (k: (typeof FIELDS)[number]) => ({
    load: () => structuredClone(mem.get(k) ?? null),
    save: (v: unknown) => {
      mem.set(k, structuredClone(v));
      touch(k);
    },
  });
  const names = () => [...snaps.entries()].sort((a, b) => b[1].at - a[1].at || (a[0] < b[0] ? 1 : -1)).map(([n]) => n);

  return {
    data: field('data'),
    device: field('device'),
    outbox: field('outbox'),
    conflicts: field('conflicts'),
    quarantine: field('quarantine'),
    listSnapshots: names,
    writeSnapshot(value, name) {
      snaps.set(name, { at: Date.now(), value: structuredClone(value) });
      touch(`snap:${name}`);
      for (const old of names().slice(SNAPSHOT_KEEP)) {
        snaps.delete(old);
        dirty.delete(`snap:${old}`);
        removed.add(`snap:${old}`);
      }
      return name;
    },
    hasSnapshot: (date) => snaps.has(`chronos-${date}.json`),
    readSnapshot: (name) => (SNAPSHOT_RE.test(name) && snaps.has(name) ? structuredClone(snaps.get(name)?.value) : null),
    writeHeartbeat: (now) => small.set(HEARTBEAT_KEY, String(now)),
    readHeartbeat: () => {
      const n = Number(small.get(HEARTBEAT_KEY));
      return Number.isFinite(n) && n > 0 ? n : null;
    },
    flush,
    discard() {
      dead = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
