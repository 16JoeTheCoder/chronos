// The web bridge over in-memory seams: no browser, no IndexedDB, no Firebase.
import { describe, expect, it, vi } from 'vitest';
import type { Data } from '../../src/core/model/types';
import { memoryProvider, memoryServer, type MemoryServer } from '../../src/core/sync/memoryProvider';
import { UNSUPPORTED, type ChronosBridge } from '../../src/platform/types';
import { createWebBridge, type WebDeps } from '../../src/platform/web';
import type { WebConfig, WebFirebase } from '../../src/platform/web/firebase';
import { UNDO_TTL_MS, WebUndo } from '../../src/platform/web/core';
import { memKv, memSmall } from '../../src/platform/web/kv';
import { elect, memoryBus, type LockManagerLike } from '../../src/platform/web/leader';
import { openWebStore } from '../../src/platform/web/store';
import type { Result } from '../../src/core/commands';

const cfg: WebConfig = { apiKey: 'k', authDomain: 'd', projectId: 'p', appId: 'a', filesUrl: null };
const none = { locks: null, chan: () => null, quiet: true } as const;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A lock manager where `kill()` releases the holder, like the leader's page closing. */
function fakeLocks() {
  let held = false;
  const waiters: (() => void)[] = [];
  const run = (cb: (l: unknown) => Promise<void>) => {
    held = true;
    void cb({});
  };
  const locks: LockManagerLike = {
    request: ((_n: string, a: unknown, b?: (l: unknown) => Promise<void>) => {
      const cb = (typeof a === 'function' ? a : b) as (l: unknown) => Promise<void>;
      const ifAvailable = typeof a === 'object' && (a as { ifAvailable?: boolean }).ifAvailable;
      if (!held) run(cb);
      else if (ifAvailable) void cb(null);
      else waiters.push(() => run(cb));
      return Promise.resolve();
    }) as LockManagerLike['request'],
  };
  return {
    locks,
    kill: () => {
      held = false;
      waiters.shift()?.();
    },
  };
}

/** A fake Firebase: a fixed signed-in (or signed-out) account over the memory server. */
function fakeFb(server: MemoryServer | null, who: { uid: string; email: string } | null): WebFirebase {
  return {
    onUser: (cb) => {
      setTimeout(() => cb(who), 0);
      return () => undefined;
    },
    signIn: async () => ({ ok: true }),
    signOut: async () => undefined,
    idToken: async () => null,
    provider: async (_uid, deviceId) => memoryProvider(server ?? memoryServer(), deviceId),
    wipe: async () => undefined,
  };
}

const create = (b: ChronosBridge, title: string) => b.command({ type: 'task.create', input: { title, finishCondition: `Done when ${title}` } });
const tasks = (d: Data) => Object.values(d.tasks).filter((t) => t.deletedAt === null);

describe('store', () => {
  it('hydrates what was saved and keeps 7 snapshots', async () => {
    const kv = memKv();
    const small = memSmall();
    const s = await openWebStore(kv, small, 1);
    s.data.save({ hello: 'world' });
    s.outbox.save([{ opId: 'x' }]);
    for (let i = 1; i <= 9; i++) s.writeSnapshot({ n: i }, `chronos-2026-01-0${i}.json`);
    s.writeHeartbeat(1234);
    await s.flush();
    const again = await openWebStore(kv, small, 1);
    expect(again.data.load()).toEqual({ hello: 'world' });
    expect(again.outbox.load()).toEqual([{ opId: 'x' }]);
    expect(again.device.load()).toBeNull();
    expect(again.listSnapshots()).toHaveLength(7);
    expect(again.hasSnapshot('2026-01-09')).toBe(true);
    expect(again.readSnapshot('chronos-2026-01-09.json')).toEqual({ n: 9 });
    expect(again.readSnapshot('../evil')).toBeNull();
    expect(again.readHeartbeat()).toBe(1234);
  });

  it('writes behind: nothing lands until the delay or a flush; discard stops writes', async () => {
    const kv = memKv();
    const s = await openWebStore(kv, memSmall(), 10_000);
    s.data.save({ a: 1 });
    expect(kv.map.size).toBe(0);
    await s.flush();
    expect(kv.map.get('data')).toEqual({ a: 1 });
    s.data.save({ a: 2 });
    s.discard();
    await s.flush();
    expect(kv.map.get('data')).toEqual({ a: 1 });
  });
});

describe('bridge commands and snapshot', () => {
  it('is a web bridge with every desktop capability off', async () => {
    const b = await createWebBridge({ ...none, kv: memKv(), small: memSmall(), config: null });
    expect(b.platform).toBe('web');
    expect(Object.entries(b.can).filter(([, v]) => v)).toEqual([]);
    expect(b.web?.role()).toBe('leader');
    const s = await b.getSnapshot();
    expect(s).toMatchObject({ platform: 'web', isPackaged: false, dataDir: 'IndexedDB', desktopLayer: null, shortcutError: null, version: 'web' });
    expect(s.sync).toMatchObject({ state: 'off', configured: false, email: null, files: false });
  });

  it('cloudFiles follows the files URL', async () => {
    const b = await createWebBridge({ ...none, kv: memKv(), small: memSmall(), config: { ...cfg, filesUrl: 'https://files.example.test' }, fb: fakeFb(null, null) });
    expect(b.can.cloudFiles).toBe(true);
  });

  it('answers desktop-only calls with UNSUPPORTED and rejects bad commands', async () => {
    const b = await createWebBridge({ ...none, kv: memKv(), small: memSmall(), config: null });
    expect(await b.command({ type: 'data.import', source: 'monolith' })).toEqual(UNSUPPORTED);
    expect(await b.command({ type: 'mcp.regenerateToken' })).toEqual(UNSUPPORTED);
    expect(await b.command({ type: 'data.openFolder' })).toEqual(UNSUPPORTED);
    expect(await b.palette.askClaude('hi')).toEqual(UNSUPPORTED);
    expect(await b.shelf.list()).toEqual([]);
    expect(await b.command({ type: 'records.revert', ops: [] } as never)).toEqual({ ok: false, error: 'Invalid command.' });
    expect(await b.command({ type: 'nonsense' } as never)).toEqual({ ok: false, error: 'Invalid command.' });
    expect(await b.files.put({ area: 'log', id: 'abcdefgh', name: 'a', mime: 'text/plain', bytes: new Uint8Array(1) })).toMatchObject({ ok: false });
  });

  it('data.export downloads the JSON; win.notify becomes a notice; mark feeds perf', async () => {
    const download = vi.fn();
    const b = await createWebBridge({ ...none, kv: memKv(), small: memSmall(), config: null, download });
    await create(b, 'Exported');
    expect(await b.command({ type: 'data.export' })).toEqual({ ok: true });
    const [name, text, mime] = download.mock.calls[0]!;
    expect(name).toMatch(/^chronos-export-\d{4}-\d{2}-\d{2}\.json$/);
    expect(mime).toBe('application/json');
    expect(JSON.parse(text).tasks).toBeTruthy();
    const seen: string[] = [];
    b.onNotice((n) => seen.push(n.text));
    b.win.notify('Hello');
    b.win.mark('x', 12);
    expect(seen).toEqual(['Hello']);
    expect((await b.getSnapshot()).perf['renderer.x']).toBe(12);
  });

  it('seals undo ops behind a one-use, expiring token', () => {
    let t = 1000;
    const u = new WebUndo(() => t);
    const ops = [{ coll: 'tasks' as const, id: 'x', prev: null }];
    const sealed = u.seal({ ok: true, id: '1', undo: ops });
    expect('undo' in sealed).toBe(false);
    const token = (sealed as { undoToken: string }).undoToken;
    expect(token).toMatch(/^[a-f0-9]{24}$/);
    expect(u.redeem(token)).toEqual({ type: 'records.revert', ops });
    expect(u.redeem(token)).toBeNull();
    const again = (u.seal({ ok: true, undo: ops }) as { undoToken: string }).undoToken;
    t += UNDO_TTL_MS + 1;
    expect(u.redeem(again)).toBeNull();
    expect(u.redeem('nope')).toBeNull();
  });

  it('an unknown undo token fails through the bridge', async () => {
    const b = await createWebBridge({ ...none, kv: memKv(), small: memSmall(), config: null });
    expect((await b.undo('ffffffffffffffffffffffff')).ok).toBe(false);
    expect((await b.command({ type: 'mcp.undo', token: 'ffffffffffffffffffffffff' })).ok).toBe(false);
  });

  it('survives a reload: a second bridge on the same IndexedDB sees the data', async () => {
    const kv = memKv();
    const small = memSmall();
    const a = await createWebBridge({ ...none, kv, small, config: null });
    await create(a, 'Persisted');
    await wait(120);
    const b = await createWebBridge({ ...none, kv, small, config: null });
    expect(tasks((await b.getSnapshot()).data).map((t) => t.title)).toEqual(['Persisted']);
  });
});

describe('sync state', () => {
  const open = (extra: WebDeps) => createWebBridge({ ...none, kv: memKv(), small: memSmall(), config: cfg, ...extra });

  it('signedOut when configured, not local, and no user; off once local', async () => {
    const b = await open({ fb: fakeFb(null, null) });
    expect(b.web!.configured).toBe(true);
    expect(b.web!.isLocal()).toBe(false);
    await vi.waitFor(async () => expect((await b.getSnapshot()).sync.state).toBe('signedOut'));
    b.web!.continueLocal();
    expect(b.web!.isLocal()).toBe(true);
    expect((await b.getSnapshot()).sync.state).toBe('off');
  });

  it('is local when Firebase is not configured', async () => {
    const b = await open({ config: null, fb: null });
    expect(b.web!.isLocal()).toBe(true);
    expect((await b.getSnapshot()).sync.state).toBe('off');
    expect(await b.command({ type: 'sync.signIn' })).toMatchObject({ ok: false });
  });

  it('signs in: email in the view, sync starts, public-computer flag stored', async () => {
    const server = memoryServer();
    const b = await open({ fb: fakeFb(server, { uid: 'u1', email: 'a@b.test' }) });
    await b.web!.signIn({ publicComputer: true });
    expect(b.web!.isPublicComputer()).toBe(true);
    await vi.waitFor(async () => {
      const s = await b.getSnapshot();
      expect(s.sync.email).toBe('a@b.test');
      expect(['syncing', 'synced', 'pending']).toContain(s.sync.state);
    });
    await create(b, 'Goes up');
    await vi.waitFor(() => expect([...server.docs.keys()].some((k) => k.startsWith('tasks/'))).toBe(true), { timeout: 3000 });
    expect(b.web!.usage().writes).toBeGreaterThanOrEqual(0);
  });

  it('public-computer sign-out wipes the database and local flags, then reloads', async () => {
    const kv = memKv();
    const small = memSmall();
    const reload = vi.fn();
    const destroyDb = vi.fn(async () => kv.map.clear());
    const b = await open({ kv, small, reload, destroyDb, fb: fakeFb(memoryServer(), { uid: 'u1', email: 'a@b.test' }) });
    await b.web!.signIn({ publicComputer: true });
    await create(b, 'Secret');
    await wait(100);
    small.set('chronos.heartbeat', '1');
    expect(await b.command({ type: 'sync.signOut' })).toEqual({ ok: true });
    expect(destroyDb).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
    expect(small.keys().filter((k) => k.startsWith('chronos'))).toEqual([]);
    await wait(120);
    expect(kv.map.size).toBe(0);
  });
});

describe('leader and followers', () => {
  it('elects one leader; followers forward commands and get snapshots; a follower takes over', async () => {
    const { locks, kill } = fakeLocks();
    const chan = memoryBus();
    const kv = memKv();
    const shared = { locks, chan, kv, small: memSmall(), config: null, quiet: true } as const;
    const a = await createWebBridge(shared);
    const b = await createWebBridge(shared);
    expect(a.web!.role()).toBe('leader');
    expect(b.web!.role()).toBe('follower');

    const seenByB: number[] = [];
    b.onSnapshot((s) => seenByB.push(tasks(s.data).length));
    const made = await create(b, 'From the follower');
    expect(made.ok).toBe(true);
    expect(tasks((await a.getSnapshot()).data).map((t) => t.title)).toEqual(['From the follower']);
    await vi.waitFor(() => expect(seenByB.at(-1)).toBe(1));
    expect(tasks((await b.getSnapshot()).data)).toHaveLength(1);
    expect(await b.command({ type: 'data.import', source: 'monolith' })).toEqual(UNSUPPORTED);

    await wait(100); // the leader's write-behind lands in IndexedDB
    kill();
    await vi.waitFor(() => expect(b.web!.role()).toBe('leader'));
    expect(tasks((await b.getSnapshot()).data).map((t) => t.title)).toEqual(['From the follower']);
  });

  it('without Web Locks every tab leads; elect() reports the roles', async () => {
    expect(await elect(null).first).toBe('leader');
    const { locks } = fakeLocks();
    expect(await elect(locks).first).toBe('leader');
    expect(await elect(locks).first).toBe('follower');
  });
});

describe('two web devices on one provider', () => {
  it('converge through create, edit, complete and delete', async () => {
    const server = memoryServer();
    const mk = (uid: string) => createWebBridge({ ...none, kv: memKv(), small: memSmall(), config: cfg, fb: fakeFb(server, { uid, email: 'x@y.test' }) });
    const [a, b] = [await mk('u1'), await mk('u1')];
    const view = async (x: ChronosBridge) => tasks((await x.getSnapshot()).data).map((t) => `${t.title}`).sort();
    const both = async (expected: string[]) => vi.waitFor(async () => {
      expect(await view(a)).toEqual(expected);
      expect(await view(b)).toEqual(expected);
    }, { timeout: 6000, interval: 100 });

    const made = (await create(a, 'Shared task')) as Extract<Result, { ok: true }>;
    await both(['Shared task']);

    expect((await b.command({ type: 'task.update', id: made.id!, input: { title: 'Renamed on B' } })).ok).toBe(true);
    await both(['Renamed on B']);

    const fin = await a.command({ type: 'task.finish', id: made.id! });
    expect(fin.ok).toBe(true);
    await vi.waitFor(async () => {
      expect((await b.getSnapshot()).data.tasks[made.id!]?.status).toBe('done');
    }, { timeout: 6000, interval: 100 });

    expect((await b.command({ type: 'recycle', coll: 'tasks', id: made.id!, confirmed: true })).ok).toBe(true);
    await both([]);
    expect((await a.getSnapshot()).data.tasks[made.id!]?.deletedAt).not.toBeNull();
  });
});
