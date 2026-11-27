// Web sync QA: two web cores on one in-memory Firestore (the emulator jar downloads here, but these
// tests stay on memoryProvider so they run anywhere), the schema version gate, offline merge,
// desktop <-> web, and cold vs warm start reads.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '../../src/core/commands';
import { SCHEMA_V, type Data } from '../../src/core/model/types';
import { memoryProvider, memoryServer, type Link, type MemoryServer } from '../../src/core/sync/memoryProvider';
import { Controller } from '../../src/main/controller';
import { Store } from '../../src/main/store';
import { createWebBridge } from '../../src/platform/web';
import type { WebConfig, WebFirebase } from '../../src/platform/web/firebase';
import { memKv, memSmall, type KV, type Small } from '../../src/platform/web/kv';
import type { ChronosBridge } from '../../src/platform/types';

const cfg: WebConfig = { apiKey: 'k', authDomain: 'd', projectId: 'p', appId: 'a', filesUrl: null };
const none = { locks: null, chan: () => null, quiet: true } as const;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Docs delivered by listeners and commits' reads, per provider, so start-up reads can be split. */
const tally = { listenDocs: 0, commitDocs: 0, since: [] as number[] };
function fb(server: MemoryServer, link: Link = { online: true, latencyMs: 0 }): WebFirebase {
  return {
    onUser: (cb) => {
      setTimeout(() => cb({ uid: 'u1', email: 'qa@example.test' }), 0);
      return () => undefined;
    },
    signIn: async () => ({ ok: true }),
    signOut: async () => undefined,
    idToken: async () => null,
    provider: async (_uid, deviceId) => {
      const p = memoryProvider(server, deviceId, link);
      return {
        ...p,
        commit: (e, plan) => { tally.commitDocs += e.length; return p.commit(e, plan); },
        listen: (coll, since, onDocs, onErr) => { tally.since.push(since); if (since) (tally as any).c = [...((tally as any).c ?? []), coll]; return p.listen(coll, since, (d) => { tally.listenDocs += d.length; onDocs(d); }, onErr); },
      };
    },
    wipe: async () => undefined,
  };
}
const device = (server: MemoryServer, link?: Link, kv: KV = memKv(), small: Small = memSmall()) => createWebBridge({ ...none, kv, small, config: cfg, fb: fb(server, link) });
const create = (b: ChronosBridge, title: string) => b.command({ type: 'task.create', input: { title, finishCondition: `Done when ${title}` } }) as Promise<Extract<Result, { ok: true }>>;
const titles = async (b: ChronosBridge) => Object.values((await b.getSnapshot()).data.tasks).filter((t) => t.deletedAt === null).map((t) => t.title).sort();
const until = (fn: () => Promise<void> | void) => vi.waitFor(fn, { timeout: 6000, interval: 60 });

describe('two web cores on one provider', () => {
  it('create, edit, complete and delete converge', async () => {
    const server = memoryServer();
    const [a, b] = [await device(server), await device(server)];
    const both = (t: string[]) => until(async () => { expect(await titles(a)).toEqual(t); expect(await titles(b)).toEqual(t); });
    const made = await create(a, 'Shared');
    await both(['Shared']);
    expect((await b.command({ type: 'task.update', id: made.id!, input: { title: 'Edited on B' } })).ok).toBe(true);
    await both(['Edited on B']);
    expect((await a.command({ type: 'task.finish', id: made.id! })).ok).toBe(true);
    await until(async () => expect((await b.getSnapshot()).data.tasks[made.id!]?.status).toBe('done'));
    expect((await b.command({ type: 'recycle', coll: 'tasks', id: made.id!, confirmed: true })).ok).toBe(true);
    await both([]);
  });

  it('an offline edit waits in the outbox and merges on reconnect, without losing the other device\'s field', async () => {
    const server = memoryServer();
    const linkB: Link = { online: true, latencyMs: 0 };
    const [a, b] = [await device(server), await device(server, linkB)];
    const made = await create(a, 'Offline merge');
    await until(async () => expect(await titles(b)).toEqual(['Offline merge']));
    linkB.online = false;
    await b.command({ type: 'task.update', id: made.id!, input: { title: 'Title from B' } });
    await a.command({ type: 'task.update', id: made.id!, input: { notes: 'Notes from A' } });
    await until(async () => expect((await a.getSnapshot()).data.tasks[made.id!]?.notes).toBe('Notes from A'));
    await wait(150);
    expect((await a.getSnapshot()).data.tasks[made.id!]?.title).toBe('Offline merge'); // B's edit has not arrived
    linkB.online = true;
    await b.command({ type: 'sync.now' } as never).catch(() => undefined);
    await until(async () => {
      for (const x of [a, b]) {
        const t = (await x.getSnapshot()).data.tasks[made.id!]!;
        expect([t.title, t.notes]).toEqual(['Title from B', 'Notes from A']);
      }
    });
  }, 15000);

  it('a record from schema v5 puts the receiver in read-only', async () => {
    const server = memoryServer();
    const a = await device(server);
    const made = await create(a, 'Future');
    await until(() => expect([...server.docs.keys()]).toContain(`tasks/${made.id}`));
    const src = server.docs.get(`tasks/${made.id}`)!;
    server.docs.set('tasks/from-the-future', { ...structuredClone(src), id: 'from-the-future', data: { ...structuredClone(src.data), id: 'from-the-future', v: SCHEMA_V + 1 }, serverUpdatedAt: src.serverUpdatedAt + 1 });
    const b = await device(server);
    await until(async () => expect((await b.getSnapshot()).sync.state).toBe('readOnly'));
    const view = (await b.getSnapshot()).sync;
    expect(view.reason ?? '').toMatch(/./);
    expect((await b.getSnapshot()).data.tasks['from-the-future']).toBeUndefined(); // not adopted
    const before = server.writes;
    await b.command({ type: 'task.update', id: made.id!, input: { title: 'Must not upload' } });
    await wait(250);
    expect(server.writes).toBe(before);
    expect(server.docs.get(`tasks/${made.id}`)!.data.title).toBe('Future');
  }, 15000);
});

describe('desktop <-> web through one provider', () => {
  let dir = '';
  afterEach(() => dir && fs.rmSync(dir, { recursive: true, force: true }));
  it('a task created on a desktop Controller reaches a web core, and an edit comes back', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronos-qa-'));
    const server = memoryServer();
    const c = new Controller(new Store(dir), { onChange() {}, onNotify() {}, onGap() {}, onDeviceChanged() {} }, { deviceName: 'PC' });
    c.init(Date.now());
    c.startSync(memoryProvider(server, c.device.deviceId), 'u1');
    const r = c.command({ type: 'task.create', input: { title: 'From the desktop', finishCondition: 'Seen on the web' } }, Date.now());
    expect(r.ok).toBe(true);
    const web = await device(server);
    await until(async () => expect(await titles(web)).toEqual(['From the desktop']));
    const id = Object.keys((await web.getSnapshot()).data.tasks)[0]!;
    await web.command({ type: 'task.update', id, input: { title: 'Renamed on the web' } });
    await until(() => expect(c.data.tasks[id]?.title).toBe('Renamed on the web'));
    c.stopSync();
    c.flush();
  }, 15000);
});

describe('start-up reads (memory provider; real Firestore needs the deployed app)', () => {
  it('a warm device (cursors saved) reads far fewer docs than a fresh one', async () => {
    const server = memoryServer();
    const seeder = await device(server);
    for (let i = 0; i < 25; i++) await create(seeder, `Seed ${i}`);
    await until(() => expect([...server.docs.keys()].filter((k) => k.startsWith('tasks/'))).toHaveLength(25));
    await wait(200);

    const kv = memKv();
    const small = memSmall();
    const r0 = server.reads;
    const cold = await device(server, undefined, kv, small);
    await until(async () => expect((await titles(cold)).length).toBe(25));
    await wait(1500); // let write-behind land the cursors
    const coldReads = server.reads - r0;

    const r1 = server.reads;
    Object.assign(tally, { listenDocs: 0, commitDocs: 0, since: [] });
    const warm = await device(server, undefined, kv, small); // same IndexedDB: data and cursors
    await until(async () => expect((await titles(warm)).length).toBe(25));
    await wait(300);
    const warmReads = server.reads - r1;
    console.log(`start-up reads: cold ${coldReads}, warm ${warmReads} (25 tasks); warm listener docs ${tally.listenDocs}, commit docs ${tally.commitDocs}, cursors ${tally.since.filter(Boolean).length}/${tally.since.length} on ${((tally as any).c ?? []).join(",")}`);
    expect(coldReads).toBeGreaterThanOrEqual(25);
    expect(warmReads).toBeLessThan(coldReads);
  }, 20000);
});

export type { Data };
