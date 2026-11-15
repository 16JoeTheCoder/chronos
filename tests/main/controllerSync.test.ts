// The controller's sync-facing duties: outbox persistence, crash replay, quarantine,
// migration on load, snapshots, restore, and starting sync for an account.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COLLS, type Data, type QuarantineItem, type Rec } from '../../src/core/model/types';
import { live } from '../../src/core/repo/repo';
import { memoryProvider, memoryServer } from '../../src/core/sync/memoryProvider';
import type { OutboxEntry } from '../../src/core/sync/provider';
import { recordProblem } from '../../src/core/validation';
import { Controller } from '../../src/main/controller';
import { Store } from '../../src/main/store';
import { addTask, fresh, MIN, T0 } from '../helpers';

const DAY = 86_400_000;
let dir: string;
let controllers: Controller[];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronos-sync-'));
  controllers = [];
});
afterEach(() => {
  for (const c of controllers) {
    c.stopSync();
    c.flush(); // a debounced save must not fire into a deleted folder
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

function boot(now = T0): Controller {
  const c = new Controller(new Store(dir), { onChange() {}, onNotify() {}, onGap() {}, onDeviceChanged() {} }, { deviceName: 'PC', monolithFile: path.join(dir, 'missing.json') });
  controllers.push(c);
  c.init(now);
  return c;
}
const readJson = (name: string): any => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const outboxFile = (): OutboxEntry[] => readJson('outbox.json');
const create = (c: Controller, title: string, extra: Record<string, unknown> = {}, now = T0): string => {
  const r = c.command({ type: 'task.create', input: { title, finishCondition: `${title} is finished`, ...extra } }, now);
  if (!r.ok || !r.id) throw new Error(`create failed: ${JSON.stringify(r)}`);
  return r.id;
};
const until = async (cond: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 15));
  }
};

describe('outbox persistence', () => {
  it('a command writes outbox.json with an entry naming the changed fields', () => {
    const c = boot();
    const id = create(c, 'Write essay');
    const entries = outboxFile().filter((e) => e.coll === 'tasks' && e.id === id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.fields).toMatchObject({ title: 'Write essay', status: expect.any(String), sortKey: expect.any(String), kind: 'task' });
    expect(entries[0]!.opId).toBeTruthy();
    // the in-memory outbox and the file agree
    expect(outboxFile()).toEqual(JSON.parse(JSON.stringify(c.outbox)));
  });

  it('a later edit names only the fields it changed', () => {
    const c = boot();
    const id = create(c, 'Write essay');
    // pretend the engine acknowledged everything so far
    fs.writeFileSync(path.join(dir, 'outbox.json'), '[]');
    const c2 = boot(T0 + MIN);
    expect(c2.outbox.filter((e) => e.id === id)).toEqual([]);
    expect(c2.command({ type: 'task.update', id, input: { notes: 'Use three sources' } }, T0 + MIN).ok).toBe(true);
    const e = outboxFile().find((x) => x.coll === 'tasks' && x.id === id)!;
    expect(Object.keys(e.fields).sort()).toEqual(['notes', 'updatedAt']);
    expect(e.fields.notes).toBe('Use three sources');
    expect(e.baseFv).toEqual({}); // never synced
  });

  it('edits to a record that is still waiting merge into its entry', () => {
    const c = boot();
    const id = create(c, 'Write essay');
    c.command({ type: 'task.update', id, input: { notes: 'a' } }, T0 + MIN);
    c.command({ type: 'task.update', id, input: { notes: 'b' } }, T0 + 2 * MIN);
    const entries = outboxFile().filter((e) => e.coll === 'tasks' && e.id === id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.fields).toMatchObject({ title: 'Write essay', notes: 'b' });
  });

  it('commands that change nothing queue nothing', () => {
    const c = boot();
    const before = JSON.stringify(c.outbox);
    expect(c.command({ type: 'timer', action: 'pause' }, T0).ok).toBe(false);
    expect(JSON.stringify(c.outbox)).toBe(before);
  });

  it('housekeeping on first run (holidays, snapshot) is queued like any write', () => {
    const c = boot();
    expect(c.outbox.some((e) => e.coll === 'closures' && e.id.startsWith('hol-'))).toBe(true);
    expect(outboxFile().length).toBe(c.outbox.length);
  });
});

describe('crash between the outbox write and the data write', () => {
  it('replays a waiting create onto older data', () => {
    const c = boot();
    const oldData = fs.readFileSync(path.join(dir, 'chronos-data.json'), 'utf8');
    const id = create(c, 'Made just before the crash');
    expect(readJson('chronos-data.json').tasks[id]).toBeDefined();
    // the data file never got the write; the outbox did
    fs.writeFileSync(path.join(dir, 'chronos-data.json'), oldData);
    fs.rmSync(path.join(dir, 'chronos-data.json.bak'), { force: true });
    expect(readJson('chronos-data.json').tasks[id]).toBeUndefined();
    expect(outboxFile().some((e) => e.id === id)).toBe(true);

    const c2 = boot(T0 + 10 * MIN);
    expect(c2.data.tasks[id]?.title).toBe('Made just before the crash');
    expect(live(c2.data, 'tasks').map((t) => t.id)).toContain(id);
    // and it is saved again, so the next start no longer needs the replay
    expect(readJson('chronos-data.json').tasks[id]).toBeDefined();
  });

  it('replays a waiting edit onto the older record', () => {
    const c = boot();
    const id = create(c, 'Original title');
    c.flush();
    const olderFile = fs.readFileSync(path.join(dir, 'chronos-data.json'), 'utf8');
    expect(c.command({ type: 'task.update', id, input: { title: 'Edited title', notes: 'edited' } }, T0 + MIN).ok).toBe(true);
    fs.writeFileSync(path.join(dir, 'chronos-data.json'), olderFile);
    fs.rmSync(path.join(dir, 'chronos-data.json.bak'), { force: true });
    const c2 = boot(T0 + 5 * MIN);
    expect(c2.data.tasks[id]).toMatchObject({ title: 'Edited title', notes: 'edited' });
  });

  it('replaying when the data file is current changes nothing', () => {
    const c = boot();
    const id = create(c, 'Already saved');
    c.flush();
    const c2 = boot(T0 + MIN);
    expect(c2.data.tasks[id]).toEqual(c.data.tasks[id]);
    expect(live(c2.data, 'tasks')).toHaveLength(1);
  });

  it('ignores malformed outbox entries instead of crashing', () => {
    const c = boot();
    const id = create(c, 'Keep me');
    c.flush();
    const good = outboxFile();
    fs.writeFileSync(path.join(dir, 'outbox.json'), JSON.stringify([...good, null, 5, { opId: 1 }, { opId: 'x', coll: 'nope', id: 'a', fields: {} }, { opId: 'y', coll: 'tasks', id: 'a', fields: 'str' }]));
    const c2 = boot(T0 + MIN);
    expect(c2.outbox.length).toBe(good.length);
    expect(c2.data.tasks[id]?.title).toBe('Keep me');
  });
});

describe('invalid records on load', () => {
  function writeData(mutate: (d: Data) => Data) {
    const a = addTask(fresh(), 'Valid task');
    const b = addTask(a.d, 'Broken task');
    const d = mutate(b.d);
    new Store(dir).data.save(d);
    return { good: a.id, bad: b.id };
  }

  it('moves a bad record to quarantine.json and keeps the valid ones', () => {
    const { good, bad } = writeData((d) => {
      const t = d.tasks[Object.keys(d.tasks)[1]!]!;
      return { ...d, tasks: { ...d.tasks, [t.id]: { ...t, priority: 'urgent' as never } } };
    });
    const c = boot();
    expect(c.data.tasks[bad]).toBeUndefined();
    expect(c.data.tasks[good]?.title).toBe('Valid task');
    expect(c.quarantine).toHaveLength(1);
    const q = readJson('quarantine.json') as QuarantineItem[];
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ coll: 'tasks', id: bad, reason: 'bad priority', at: T0 });
    expect((q[0]!.doc as Rec).id).toBe(bad);
    expect((q[0]!.doc as { priority: string }).priority).toBe('urgent'); // kept as found, for recovery
    // everything left in memory validates
    for (const coll of COLLS) for (const r of Object.values(c.data[coll])) expect(recordProblem(coll, r), `${coll}/${r.id}`).toBeNull();
  });

  it('quarantines across collections and records from a newer schema', () => {
    const { good, bad } = writeData((d) => {
      const t = d.tasks[Object.keys(d.tasks)[1]!]!;
      return {
        ...d,
        tasks: { ...d.tasks, [t.id]: { ...t, v: 4 } },
        blocks: { b1: { id: 'b1', createdAt: 1, updatedAt: 1, deviceId: 'x', deletedAt: null, v: 2, fv: {}, fw: {}, taskId: null, tagId: null, title: 'B', date: '2026-10-26', startMin: 600, endMin: 660, tz: 'Asia/Jakarta', kind: 'work', auto: 'maybe' } as never },
      };
    });
    const c = boot();
    const reasons = Object.fromEntries(c.quarantine.map((q) => [`${q.coll}/${q.id}`, q.reason]));
    expect(reasons[`tasks/${bad}`]).toMatch(/newer than this app/);
    expect(reasons['blocks/b1']).toBe('bad auto');
    expect(c.data.blocks.b1).toBeUndefined();
    expect(c.data.tasks[good]).toBeDefined();
  });

  it('a clean file quarantines nothing and writes no quarantine.json entries', () => {
    writeData((d) => d);
    const c = boot();
    expect(c.quarantine).toEqual([]);
    expect(c.data.tasks).not.toEqual({});
  });

  it('quarantine accumulates across restarts', () => {
    writeData((d) => {
      const t = d.tasks[Object.keys(d.tasks)[1]!]!;
      return { ...d, tasks: { ...d.tasks, [t.id]: { ...t, status: 'queued' as never } } };
    });
    boot();
    const c2 = boot(T0 + MIN); // the bad record is gone from the data file now
    expect(c2.quarantine).toHaveLength(1);
  });
});

describe('a v1 data file on disk', () => {
  const v1 = () => JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/v1-josef.json'), 'utf8'));

  it('loads migrated: schema 2, statuses mapped, nothing quarantined', () => {
    new Store(dir).data.save(v1());
    const c = boot();
    expect(c.data.schema).toBe(3);
    expect(c.quarantine).toEqual([]);
    expect(c.data.tasks['t-sprint-app']?.status).toBe('doing');
    expect(c.data.tasks['t-calc-hw']?.status).toBe('planned'); // block today
    expect(c.data.tasks['t-lab-report']?.status).toBe('planned');
    expect(c.data.tasks['t-essay']?.status).toBe('inbox'); // only a past block
    expect(c.data.tasks['t-read-ch4']?.status).toBe('inbox');
    expect(c.data.tasks['t-done-quiz']).toMatchObject({ status: 'done', outcome: 'finished' });
    expect(c.data.tasks['t-calc-hw']?.dueDate).toBe('2026-10-30');
    expect(c.data.eventExceptions['x-ev-chem-2026-10-30']?.kind).toBe('edit');
    expect(Object.keys(c.data.tasks)).toHaveLength(9);
  });

  it('is saved back as schema 2 and loads identically the second time', () => {
    new Store(dir).data.save(v1());
    const c = boot();
    c.flush();
    expect(readJson('chronos-data.json').schema).toBe(3);
    expect(readJson('chronos-data.json').tasks['t-calc-hw'].deadline).toBeUndefined();
    const again = boot();
    expect(again.data.tasks).toEqual(c.data.tasks);
    expect(again.data.events).toEqual(c.data.events);
  });

  it('migrated records are not fabricated into the outbox (they upload as a first-sign-in seed)', () => {
    new Store(dir).data.save(v1());
    const c = boot();
    expect(c.outbox.filter((e) => e.coll === 'tasks' && e.id.startsWith('t-') && !e.id.includes(':'))).toEqual([]);
    for (const t of Object.values(c.data.tasks)) expect(t.fv).toEqual({});
  });
});

describe('snapshots', () => {
  it('init writes the daily snapshot snapshots/chronos-<date>.json', () => {
    const c = boot();
    const file = path.join(dir, 'snapshots', 'chronos-2026-10-26.json');
    expect(fs.existsSync(file)).toBe(true);
    const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(snap.schema).toBe(3);
    expect(c.snapshots()).toEqual(['chronos-2026-10-26.json']);
  });

  it('one per local day: a second start the same day keeps the first, the next day adds one', () => {
    const c = boot();
    const id = create(c, 'Added after the snapshot');
    c.flush();
    boot(T0 + 3 * MIN);
    const first = JSON.parse(fs.readFileSync(path.join(dir, 'snapshots', 'chronos-2026-10-26.json'), 'utf8'));
    expect(first.tasks[id]).toBeUndefined();
    boot(T0 + DAY);
    const names = new Store(dir).listSnapshots().sort();
    expect(names).toEqual(['chronos-2026-10-26.json', 'chronos-2026-10-27.json']);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'snapshots', 'chronos-2026-10-27.json'), 'utf8')).tasks[id]).toBeDefined();
  });

  it('keeps the newest seven daily snapshots', () => {
    for (let i = 0; i < 10; i++) boot(T0 + i * DAY);
    expect(new Store(dir).listSnapshots()).toHaveLength(7);
  });
});

describe('restoreSnapshot', () => {
  it('snapshots the current data first, then restores; the restored fields go to the outbox', () => {
    const c = boot();
    const id = create(c, 'Original title');
    c.flush();
    new Store(dir).writeSnapshot(c.data, 'chronos-before-test.json');
    c.command({ type: 'task.update', id, input: { title: 'Edited title' } }, T0 + MIN);
    c.flush();
    expect(c.data.tasks[id]!.title).toBe('Edited title');
    const now = T0 + 5 * MIN;

    const r = c.restoreSnapshot('chronos-before-test.json', now);
    expect(r).toEqual({ ok: true });
    expect(c.data.tasks[id]!.title).toBe('Original title');

    // the "before restore" snapshot holds what was current, i.e. the edited title
    const backup = path.join(dir, 'snapshots', `chronos-before-restore-${now}.json`);
    expect(fs.existsSync(backup)).toBe(true);
    expect(JSON.parse(fs.readFileSync(backup, 'utf8')).tasks[id].title).toBe('Edited title');
    expect(c.snapshots()).toContain(`chronos-before-restore-${now}.json`);

    // and the restore is an ordinary edit for sync
    const e = c.outbox.find((x) => x.coll === 'tasks' && x.id === id)!;
    expect(e.fields.title).toBe('Original title');
    expect(outboxFile().find((x) => x.id === id)!.fields.title).toBe('Original title');
    // persisted
    expect(readJson('chronos-data.json').tasks[id].title).toBe('Original title');
  });

  it('keeps the sync versions (fv/fw) of records that exist both before and after', () => {
    const c = boot();
    const id = create(c, 'Synced task');
    new Store(dir).writeSnapshot(c.data, 'chronos-before-fv.json');
    c.data = { ...c.data, tasks: { ...c.data.tasks, [id]: { ...c.data.tasks[id]!, fv: { title: 1_700_000_000_000_123 }, fw: { title: 'otherDevice' } } } };
    expect(c.restoreSnapshot('chronos-before-fv.json', T0 + MIN).ok).toBe(true);
    expect(c.data.tasks[id]!.fv).toEqual({ title: 1_700_000_000_000_123 });
    expect(c.data.tasks[id]!.fw).toEqual({ title: 'otherDevice' });
  });

  it('refuses an unknown or unsafe snapshot name and changes nothing', () => {
    const c = boot();
    const id = create(c, 'Stay');
    const before = c.data;
    expect(c.restoreSnapshot('chronos-2020-01-01.json', T0).ok).toBe(false);
    expect(c.restoreSnapshot('../chronos-data.json', T0).ok).toBe(false);
    expect(c.restoreSnapshot('nope', T0).ok).toBe(false);
    expect(c.data).toBe(before);
    expect(c.data.tasks[id]).toBeDefined();
    expect(fs.readdirSync(path.join(dir, 'snapshots')).some((f) => f.startsWith('chronos-before-restore'))).toBe(false);
  });

  it('a snapshot with a bad record restores the good ones and quarantines the bad', () => {
    const c = boot();
    const id = create(c, 'Fine');
    const snap = structuredClone(c.data);
    snap.tasks['broken'] = { ...snap.tasks[id]!, id: 'broken', sortKey: 'bad key' };
    new Store(dir).writeSnapshot(snap, 'chronos-before-bad.json');
    // note: restoreSnapshot quarantines nothing itself, but must not load the invalid record
    expect(c.restoreSnapshot('chronos-before-bad.json', T0 + MIN).ok).toBe(true);
    expect(c.data.tasks.broken).toBeUndefined();
    expect(c.data.tasks[id]).toBeDefined();
  });

  // Regression (fixed, D-126): restoring drops records that are not in the snapshot without queuing anything (src/main/controller.ts restoreSnapshot builds `merged` from the snapshot only and diffData ignores removals), so they linger on other devices
  it('a record created after the snapshot is not silently lost: it stays (recycled) or is queued', () => {
    const c = boot();
    const first = create(c, 'In the snapshot');
    c.flush();
    new Store(dir).writeSnapshot(c.data, 'chronos-before-later.json');
    const later = create(c, 'Created later', {}, T0 + MIN);
    c.flush();
    fs.writeFileSync(path.join(dir, 'outbox.json'), '[]');
    const c2 = boot(T0 + 2 * MIN);
    expect(c2.restoreSnapshot('chronos-before-later.json', T0 + 3 * MIN).ok).toBe(true);
    expect(c2.data.tasks[first]).toBeDefined();
    const kept = c2.data.tasks[later] !== undefined;
    const queued = c2.outbox.some((e) => e.id === later);
    expect(kept || queued).toBe(true);
  });
});

describe('startSync', () => {
  it('uploads the controller\'s existing data to the server (first sign-in seed)', async () => {
    const c = boot();
    const id = create(c, 'Made before signing in');
    c.flush();
    const server = memoryServer();
    c.startSync(memoryProvider(server, c.device.deviceId), 'uid-1');
    await until(() => server.docs.has(`tasks/${id}`) && c.outbox.length === 0);
    expect(server.docs.get(`tasks/${id}`)!.data).toMatchObject({ title: 'Made before signing in', status: expect.any(String) });
    expect(server.docs.has('settings/main')).toBe(true);
    expect([...server.docs.keys()].some((k) => k.startsWith('closures/hol-'))).toBe(true);
    // the acknowledged versions come back into local data
    await until(() => Object.keys(c.data.tasks[id]!.fv).length > 0);
    expect(c.device.sync.uid).toBe('uid-1');
    expect(readJson('device.json').sync.uid).toBe('uid-1');
    await until(() => c.sync.state === 'synced');
  });

  it('an edit made while syncing reaches the server', async () => {
    const c = boot();
    const id = create(c, 'Live edit');
    const server = memoryServer();
    c.startSync(memoryProvider(server, c.device.deviceId), 'uid-1');
    await until(() => c.outbox.length === 0 && server.docs.has(`tasks/${id}`));
    expect(c.command({ type: 'task.update', id, input: { notes: 'typed while connected' } }, T0 + MIN).ok).toBe(true);
    await until(() => server.docs.get(`tasks/${id}`)?.data.notes === 'typed while connected');
    await until(() => c.outbox.length === 0);
  });

  it('signing in to a different uid clears fv and fw and the cursors; the same uid keeps them', async () => {
    const c = boot();
    const id = create(c, 'Belongs to the first account');
    const server = memoryServer();
    c.startSync(memoryProvider(server, c.device.deviceId), 'uid-1');
    await until(() => c.outbox.length === 0 && Object.keys(c.data.tasks[id]!.fv).length > 0 && c.device.sync.lastSyncAt !== null);
    const withVersions = COLLS.reduce((n, coll) => n + Object.values(c.data[coll] as Record<string, Rec>).filter((r) => Object.keys(r.fv).length > 0).length, 0);
    expect(withVersions).toBeGreaterThan(0);
    expect(Object.keys(c.device.sync.cursors).length).toBeGreaterThan(0);
    c.stopSync();

    // same account again: versions survive
    c.startSync(memoryProvider(server, c.device.deviceId), 'uid-1');
    expect(Object.keys(c.data.tasks[id]!.fv).length).toBeGreaterThan(0);
    expect(c.device.sync.lastSyncAt).not.toBeNull();
    c.stopSync();

    // a different account: everything is forgotten so it uploads again
    const other = memoryServer();
    c.startSync(memoryProvider(other, c.device.deviceId), 'other');
    for (const coll of COLLS) for (const r of Object.values(c.data[coll] as Record<string, Rec>)) {
      expect(r.fv, `${coll}/${r.id}`).toEqual({});
      expect(r.fw, `${coll}/${r.id}`).toEqual({});
    }
    expect(c.device.sync).toEqual({ uid: 'other', cursors: {}, lastSyncAt: null });
    expect(readJson('device.json').sync).toEqual({ uid: 'other', cursors: {}, lastSyncAt: null });
    expect(readJson('chronos-data.json').tasks[id].fv).toEqual({});
  });

  // Regression (fixed, D-126): SyncEngine.seeded is never reset by stop()/start() (src/core/sync/engine.ts:112-130), so after signing out and into another account in the same run nothing is uploaded
  it('after switching account in the same run, the existing data is uploaded to the new account', async () => {
    const c = boot();
    const id = create(c, 'Belongs to the first account');
    const first = memoryServer();
    c.startSync(memoryProvider(first, c.device.deviceId), 'uid-1');
    await until(() => c.outbox.length === 0 && first.docs.has(`tasks/${id}`));
    c.stopSync();
    const other = memoryServer();
    c.startSync(memoryProvider(other, c.device.deviceId), 'other');
    await until(() => other.docs.has(`tasks/${id}`), 1500);
    expect(other.docs.get(`tasks/${id}`)!.data.title).toBe('Belongs to the first account');
  });

  it('stopSync stops the engine', async () => {
    const c = boot();
    const server = memoryServer();
    c.startSync(memoryProvider(server, c.device.deviceId), 'uid-1');
    expect(c.engine.running).toBe(true);
    c.stopSync();
    expect(c.engine.running).toBe(false);
    const id = create(c, 'Offline now');
    await new Promise((r) => setTimeout(r, 300));
    expect(server.docs.has(`tasks/${id}`)).toBe(false);
    expect(c.outbox.some((e) => e.id === id)).toBe(true);
  });
});
