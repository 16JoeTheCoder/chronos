// One tab runs the controller and sync (the leader, holder of a Web Lock); other tabs forward
// commands to it over BroadcastChannel and render the snapshots it broadcasts. When the leader's
// page dies the browser releases the lock and the next waiting tab takes over.

import type { Result } from '../../core/commands';
import type { Snapshot } from '../../core/model/types';

export type ReqKind = 'command' | 'undo' | 'snapshot' | 'export' | 'exportLog';

export type Msg =
  | { t: 'hello' }
  | { t: 'req'; id: string; kind: ReqKind; payload?: unknown }
  | { t: 'res'; id: string; result: unknown }
  | { t: 'snap'; snap: Snapshot }
  | { t: 'beep' }
  | { t: 'reload' };

export interface Chan {
  post(m: Msg): void;
  listen(cb: (m: Msg) => void): void;
  close(): void;
}

export function browserChan(name = 'chronos'): Chan | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const bc = new BroadcastChannel(name);
  return { post: (m) => bc.postMessage(m), listen: (cb) => void (bc.onmessage = (e: MessageEvent<Msg>) => cb(e.data)), close: () => bc.close() };
}

/** In-memory channels that deliver to every other endpoint on the same bus (tests). */
export function memoryBus(): () => Chan {
  const ends = new Set<{ cb: ((m: Msg) => void) | null }>();
  return () => {
    const me: { cb: ((m: Msg) => void) | null } = { cb: null };
    ends.add(me);
    return {
      post: (m) => {
        const copy = structuredClone(m);
        for (const e of ends) if (e !== me && e.cb) queueMicrotask(() => e.cb?.(copy));
      },
      listen: (cb) => void (me.cb = cb),
      close: () => void ends.delete(me),
    };
  };
}

export interface Handlers {
  request(kind: ReqKind, payload: unknown): Promise<unknown>;
  snapshot(): Snapshot;
}

/** Leader side: answer followers, broadcast to them. */
export function serve(chan: Chan, h: Handlers): { broadcast(m: Msg): void; stop(): void } {
  chan.listen((m) => {
    if (m.t === 'hello') chan.post({ t: 'snap', snap: h.snapshot() });
    else if (m.t === 'req') {
      h.request(m.kind, m.payload).then(
        (result) => chan.post({ t: 'res', id: m.id, result }),
        (e) => chan.post({ t: 'res', id: m.id, result: { ok: false, error: String(e) } satisfies Result }),
      );
    }
  });
  return { broadcast: (m) => chan.post(m), stop: () => chan.close() };
}

export interface FollowerHandlers {
  onSnap(s: Snapshot): void;
  onBeep(): void;
  onReload(): void;
}

/** Follower side: RPC to the leader plus its broadcasts. */
export function follow(chan: Chan, h: FollowerHandlers, timeoutMs = 8000): { request<T>(kind: ReqKind, payload?: unknown): Promise<T>; stop(): void } {
  let n = 0;
  const waiting = new Map<string, (v: unknown) => void>();
  chan.listen((m) => {
    if (m.t === 'snap') h.onSnap(m.snap);
    else if (m.t === 'beep') h.onBeep();
    else if (m.t === 'reload') h.onReload();
    else if (m.t === 'res') waiting.get(m.id)?.(m.result);
  });
  chan.post({ t: 'hello' });
  return {
    request<T>(kind: ReqKind, payload?: unknown): Promise<T> {
      const id = `${Date.now().toString(36)}-${++n}`;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(new Error('Chronos did not answer. Another tab may be busy.'));
        }, timeoutMs);
        waiting.set(id, (v) => {
          clearTimeout(timer);
          waiting.delete(id);
          resolve(v as T);
        });
        chan.post({ t: 'req', id, kind, payload });
      });
    },
    stop: () => chan.close(),
  };
}

export interface LockManagerLike {
  request(name: string, opts: { ifAvailable: true }, cb: (lock: unknown) => Promise<void>): Promise<unknown>;
  request(name: string, cb: (lock: unknown) => Promise<void>): Promise<unknown>;
}

const never = new Promise<void>(() => undefined);

/**
 * `first`: this tab's role at start. `promoted`: resolves when a follower is granted the lock
 * (the old leader's page is gone). Without Web Locks (old WebViews) every tab leads.
 */
export function elect(locks: LockManagerLike | null, name = 'chronos-leader'): { first: Promise<'leader' | 'follower'>; promoted: Promise<void> } {
  if (!locks) return { first: Promise.resolve('leader'), promoted: never };
  const first = new Promise<'leader' | 'follower'>((resolve) => {
    void locks
      .request(name, { ifAvailable: true }, async (lock) => {
        if (!lock) return resolve('follower');
        resolve('leader');
        await never;
      })
      .catch(() => resolve('leader'));
  });
  const promoted = first.then((r) => (r === 'leader' ? never : new Promise<void>((resolve) => void locks.request(name, async () => { resolve(); await never; }).catch(() => undefined))));
  return { first, promoted };
}
