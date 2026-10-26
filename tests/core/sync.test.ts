// Sync engine (§10.1) with two simulated devices on the in-memory server.
import { describe, expect, it } from 'vitest';
import { apply, type Command } from '../../src/core/commands';
import type { Data } from '../../src/core/model/types';
import { purge } from '../../src/core/repo/recycle';
import { live } from '../../src/core/repo/repo';
import { memoryProvider, memoryServer } from '../../src/core/sync/memoryProvider';
import { nullProvider } from '../../src/core/sync/nullProvider';
import { isStub } from '../../src/core/sync/provider';
import { syncOnce, takeover, type SyncState } from '../../src/core/sync/engine';
import { fresh, MIN, T0 } from '../helpers';

const DAY = 86_400_000;

function device(id: string, server = memoryServer(), online = { value: true }) {
  const dev = {
    id,
    d: fresh() as Data,
    state: { lastPushedAt: 0, cursors: {} } as SyncState,
    provider: memoryProvider(server, online),
    online,
    run(cmd: Command, now = T0) {
      const r = apply(dev.d, cmd, { now, deviceId: id, deviceName: id });
      if (!r.ok) throw new Error(r.error);
      dev.d = r.d;
      return r.id ?? '';
    },
    async sync(now = T0) {
      const r = await syncOnce(dev.d, dev.state, dev.provider, { now, deviceId: id });
      dev.d = r.d;
      dev.state = r.state;
      return r;
    },
  };
  return dev;
}

function pair() {
  const server = memoryServer();
  return [device('devA', server), device('devB', server)] as const;
}

const strip = (d: Data) => JSON.stringify({ ...d, timer: undefined, settings: undefined });

describe('sync', () => {
  it('two devices converge after interleaved edits', async () => {
    const [a, b] = pair();
    a.run({ type: 'task.create', input: { title: 'From A', finishCondition: 'A is finished' } });
    b.run({ type: 'tag.create', input: { name: 'Physics', color: 'tag1', kind: 'class' } }, T0 + 1);
    await a.sync();
    await b.sync();
    b.run({ type: 'task.create', input: { title: 'From B', finishCondition: 'B is finished' } }, T0 + 2);
    await b.sync();
    await a.sync();
    expect(live(a.d, 'tasks').map((t) => t.title).sort()).toEqual(['From A', 'From B']);
    expect(strip(a.d)).toBe(strip(b.d));
  });

  it('concurrent edits: last write wins on updatedAt, on both devices', async () => {
    const [a, b] = pair();
    const id = a.run({ type: 'tag.create', input: { name: 'Phys', color: 'tag1', kind: 'class' } });
    await a.sync();
    await b.sync();
    a.run({ type: 'tag.update', id, input: { name: 'Older', color: 'tag1', kind: 'class' } }, T0 + 10);
    b.run({ type: 'tag.update', id, input: { name: 'Newer', color: 'tag2', kind: 'class' } }, T0 + 20);
    await b.sync();
    await a.sync(); // A pushes its older edit over the server copy...
    await b.sync(); // ...B sees it lose and re-pushes the winner
    await a.sync();
    expect(a.d.tags[id]?.name).toBe('Newer');
    expect(b.d.tags[id]?.name).toBe('Newer');
  });

  it('delete vs edit: the later action wins', async () => {
    const [a, b] = pair();
    const id = a.run({ type: 'tag.create', input: { name: 'Phys', color: 'tag1', kind: 'class' } });
    await a.sync();
    await b.sync();
    b.run({ type: 'tag.update', id, input: { name: 'Edited', color: 'tag1', kind: 'class' } }, T0 + 5);
    a.run({ type: 'recycle', coll: 'tags', id, confirmed: true }, T0 + 9);
    await b.sync();
    await a.sync();
    await b.sync();
    expect(a.d.tags[id]?.deletedAt).toBe(T0 + 9);
    expect(b.d.tags[id]?.deletedAt).toBe(T0 + 9);
  });

  it('a purge stub never lets an offline device resurrect a deleted record', async () => {
    const server = memoryServer();
    const a = device('devA', server);
    const b = device('devB', server, { value: true });
    const id = a.run({ type: 'tag.create', input: { name: 'Gone', color: 'tag1', kind: 'class' } });
    await a.sync();
    await b.sync();
    b.online.value = false;
    a.run({ type: 'recycle', coll: 'tags', id, confirmed: true }, T0 + 1);
    a.d = purge(a.d, T0 + 8 * DAY, 'devA');
    await a.sync(T0 + 8 * DAY);
    // B edits the record while offline, much later on its own clock, then reconnects after 10 days.
    b.run({ type: 'tag.update', id, input: { name: 'Edited offline', color: 'tag1', kind: 'class' } }, T0 + 9 * DAY);
    b.online.value = true;
    await b.sync(T0 + 10 * DAY);
    await a.sync(T0 + 10 * DAY);
    expect(b.d.tags[id]).toBeUndefined();
    expect(isStub(b.d.tombs.tags![id]!)).toBe(true);
    expect(a.d.tags[id]).toBeUndefined();
    expect(JSON.stringify(a.d)).not.toContain('Edited offline');
  });

  it('an offline device reconnecting after 10 days catches up and contributes its edits', async () => {
    const [a, b] = pair();
    await a.sync();
    b.online.value = false;
    a.run({ type: 'task.create', input: { title: 'Online work', finishCondition: 'Done when it is done' } }, T0 + DAY);
    await a.sync(T0 + DAY);
    b.run({ type: 'task.create', input: { title: 'Offline work', finishCondition: 'Done when it is done' } }, T0 + 2 * DAY);
    await expect(b.sync(T0 + 2 * DAY)).rejects.toThrow('offline');
    b.online.value = true;
    await b.sync(T0 + 10 * DAY);
    await a.sync(T0 + 10 * DAY);
    expect(live(a.d, 'tasks').map((t) => t.title).sort()).toEqual(['Offline work', 'Online work']);
    expect(live(b.d, 'tasks').map((t) => t.title).sort()).toEqual(['Offline work', 'Online work']);
  });

  it('timer takeover closes the previous owner\'s slice at the takeover instant on both devices', async () => {
    const [a, b] = pair();
    const id = a.run({ type: 'task.create', input: { title: 'Essay', finishCondition: 'Essay submitted' } });
    a.run({ type: 'timer', action: 'start' }, T0);
    await a.sync(T0);
    await b.sync(T0);
    expect(apply(b.d, { type: 'timer', action: 'pause' }, { now: T0 + MIN, deviceId: 'devB' }).ok).toBe(false);
    b.d = takeover(b.d, { now: T0 + 20 * MIN, deviceId: 'devB', deviceName: 'Laptop' });
    await b.sync(T0 + 20 * MIN);
    await a.sync(T0 + 25 * MIN);
    for (const dev of [a, b]) {
      const sessions = live(dev.d, 'sessions');
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ taskId: id, startedAt: T0, endedAt: T0 + 20 * MIN });
      expect(dev.d.tasks[id]?.runtime.sliceStartedAt).toBe(T0 + 20 * MIN);
      expect(dev.d.timer.current?.ownerDeviceId).toBe('devB');
    }
  });

  it('running the sync twice is a no-op; the null provider changes nothing', async () => {
    const [a] = pair();
    a.run({ type: 'task.create', input: { title: 'Once', finishCondition: 'Done when it is done' } });
    const first = await a.sync();
    expect(first.pushed).toBeGreaterThan(0);
    const before = a.d;
    const second = await a.sync();
    expect(second.pushed).toBe(0);
    expect(a.d).toEqual(before);
    const n = await syncOnce(a.d, a.state, nullProvider, { now: T0, deviceId: 'devA' });
    expect(n).toMatchObject({ pushed: 0, pulled: 0 });
  });
});
