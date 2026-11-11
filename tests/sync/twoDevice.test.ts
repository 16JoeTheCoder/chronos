// Two-device sync simulation (docs/SYNC.md, scenarios a-h) against the fake Firestore.
import { describe, expect, it } from 'vitest';
import { live } from '../../src/core/repo/repo';
import { SCHEMA_V } from '../../src/core/model/types';
import { isStub } from '../../src/core/sync/provider';
import { purge } from '../../src/core/repo/recycle';
import { HOUR, T0 } from '../helpers';
import { content, Device, pair, settle, wait } from './sim';
import { MIN } from '../helpers';
import { takeover } from '../../src/core/sync/engine';

const tag = (name: string, color = 'tag1') => ({ type: 'tag.create' as const, input: { name, color: color as 'tag1', kind: 'class' as const } });

describe('two-device sync', () => {
  it('(a) a record created on A appears on B', async () => {
    const [a, b] = pair();
    a.connect();
    b.connect();
    const id = a.run({ type: 'task.create', input: { title: 'From A', finishCondition: 'A is finished' } });
    await settle(a, b);
    expect(b.d.tasks[id]?.title).toBe('From A');
    expect(content(a.d)).toBe(content(b.d));
  });

  it('first sign-in uploads local data; the second device adopts it and adds its own', async () => {
    const [a, b] = pair();
    const ta = a.run({ type: 'task.create', input: { title: 'Local on A', finishCondition: 'Done when done' } });
    const tb = b.run({ type: 'task.create', input: { title: 'Local on B', finishCondition: 'Done when done' } });
    a.connect();
    await settle(a);
    b.connect();
    await settle(a, b);
    await settle(a, b);
    expect(live(a.d, 'tasks').map((t) => t.id).sort()).toEqual([ta, tb].sort());
    expect(content(a.d)).toBe(content(b.d));
    expect(a.conflicts).toEqual([]);
  });

  it('(b) offline edits to different fields of the same records converge without conflicts', async () => {
    const [a, b] = pair();
    a.connect();
    b.connect();
    const ids = [1, 2, 3, 4, 5].map((n) => a.run(tag(`Tag ${n}`)));
    await settle(a, b);
    a.goOffline();
    b.goOffline();
    for (const id of ids) a.run({ type: 'tag.update', id, input: { name: `A edit ${id.slice(0, 4)}`, color: 'tag1', kind: 'class' } });
    // B changes only the colour of two of them.
    for (const id of ids.slice(0, 2)) b.run({ type: 'tag.update', id, input: { name: b.d.tags[id]!.name, color: 'tag5', kind: 'class' } });
    a.goOnline();
    b.goOnline();
    await settle(a, b);
    await settle(a, b);
    for (const id of ids) expect(a.d.tags[id]?.name).toMatch(/^A edit/);
    for (const id of ids.slice(0, 2)) expect(a.d.tags[id]?.color).toBe('tag5');
    expect(content(a.d)).toBe(content(b.d));
    expect([...a.conflicts, ...b.conflicts]).toEqual([]);
  });

  it('(c) the same field edited on both converges and logs exactly one conflict', async () => {
    const [a, b] = pair();
    a.connect();
    b.connect();
    const id = a.run(tag('Phys'));
    await settle(a, b);
    a.goOffline();
    b.goOffline();
    a.run({ type: 'tag.update', id, input: { name: 'From A', color: 'tag1', kind: 'class' } });
    b.run({ type: 'tag.update', id, input: { name: 'From B', color: 'tag1', kind: 'class' } });
    a.goOnline();
    await settle(a);
    b.goOnline();
    await settle(a, b);
    await settle(a, b);
    expect(a.d.tags[id]?.name).toBe('From B');
    expect(b.d.tags[id]?.name).toBe('From B');
    const all = [...a.conflicts, ...b.conflicts];
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ coll: 'tags', id, field: 'name', overwrittenValue: 'From A', newValue: 'From B', otherDeviceId: 'devA' });
  });

  it('(d) a delete on A beats an offline edit on B; the edit is logged', async () => {
    const [a, b] = pair();
    a.connect();
    b.connect();
    const id = a.run(tag('Gone'));
    await settle(a, b);
    b.goOffline();
    a.run({ type: 'recycle', coll: 'tags', id, confirmed: true });
    await settle(a);
    b.run({ type: 'tag.update', id, input: { name: 'Edited offline', color: 'tag1', kind: 'class' } });
    b.goOnline();
    await settle(a, b);
    await settle(a, b);
    expect(a.d.tags[id]?.deletedAt).not.toBeNull();
    expect(b.d.tags[id]?.deletedAt).toBe(a.d.tags[id]?.deletedAt);
    expect(b.d.tags[id]?.name).toBe('Gone');
    expect(b.conflicts).toEqual([expect.objectContaining({ id, field: 'name', overwrittenValue: 'Edited offline', newValue: 'Gone' })]);
    expect(content(a.d)).toBe(content(b.d));
  });

  it('a purge stub on the server is terminal: an offline edit cannot resurrect the record', async () => {
    const [a, b] = pair();
    a.connect();
    b.connect();
    const id = a.run(tag('Purged'));
    await settle(a, b);
    b.goOffline();
    a.run({ type: 'recycle', coll: 'tags', id, confirmed: true });
    a.clock = T0 + 8 * 24 * HOUR;
    a.commit(purge(a.d, a.now(), a.id));
    await settle(a);
    b.run({ type: 'tag.update', id, input: { name: 'Edited offline', color: 'tag1', kind: 'class' } });
    b.goOnline();
    await settle(a, b);
    await settle(a, b);
    expect(b.d.tags[id]).toBeUndefined();
    expect(isStub(b.d.tombs.tags![id]!)).toBe(true);
    expect(JSON.stringify(a.d) + JSON.stringify(b.d)).not.toContain('Edited offline');
  });

  it('(e) a crash between the outbox write and the flush re-flushes the entry once, no duplicates', async () => {
    const [a, b, server] = pair();
    a.connect();
    b.connect();
    await settle(a, b);
    a.goOffline();
    const id = a.run({ type: 'task.create', input: { title: 'Survives a crash', finishCondition: 'Done when done' } });
    const savedOutbox = structuredClone(a.outbox);
    const savedData = structuredClone(a.d);
    a.engine.stop();
    // "Restart": a new device process over the persisted outbox and data.
    const restarted = new Device('devA', server);
    restarted.d = savedData;
    restarted.outbox = savedOutbox;
    restarted.cursors = { ...a.cursors };
    restarted.connect();
    await settle(restarted, b);
    // A second flush of the same entry (e.g. the ack was lost) changes nothing.
    restarted.outbox = structuredClone(savedOutbox);
    restarted.engine.localChanged();
    await settle(restarted, b);
    expect([...server.docs.keys()].filter((k) => k.startsWith('tasks/'))).toEqual([`tasks/${id}`]);
    expect(live(b.d, 'tasks')).toHaveLength(1);
    expect(restarted.conflicts).toEqual([]);
  });

  it('(f) an older client receiving a newer-schema record goes read-only and pushes nothing', async () => {
    const [a, b, server] = pair();
    a.connect();
    b.connect();
    const id = a.run(tag('Shared'));
    await settle(a, b);
    // A newer app version writes the record with v3 and a field this app does not know.
    const doc = server.docs.get(`tags/${id}`)!;
    server.clock++;
    server.docs.set(`tags/${id}`, { ...doc, data: { ...doc.data, v: SCHEMA_V + 1, emoji: '*' }, serverUpdatedAt: server.clock });
    for (const l of [...server.listeners]) l([server.docs.get(`tags/${id}`)!]);
    await wait(20);
    expect(b.state).toBe('readOnly');
    const writes = server.writes;
    b.run(tag('Queued while read-only'));
    await wait(30);
    expect(server.writes).toBe(writes);
    expect(b.outbox.length).toBeGreaterThan(0);
    expect(b.d.tags[id]?.v).toBe(SCHEMA_V);
  });

  it('(g) an invalid remote document is quarantined, never merged', async () => {
    const [a, b, server] = pair();
    a.connect();
    b.connect();
    await settle(a, b);
    server.clock++;
    const bad = { coll: 'tasks' as const, id: 'evil', data: { id: 'evil', title: 42, v: SCHEMA_V }, fv: {}, fw: {}, serverUpdatedAt: server.clock };
    server.docs.set('tasks/evil', bad);
    for (const l of [...server.listeners]) l([bad]);
    await wait(20);
    expect(b.d.tasks.evil).toBeUndefined();
    expect(b.quarantined).toEqual([expect.objectContaining({ coll: 'tasks', id: 'evil' })]);
  });

  it('(h) a device clock 2 h fast or slow changes nothing about who wins', async () => {
    for (const skew of [2 * HOUR, -2 * HOUR]) {
      const [a, b] = pair();
      a.skew = skew;
      a.connect();
      b.connect();
      const id = b.run(tag('Skew'));
      await settle(a, b);
      // B edits after A in real (server) order; A's clock says A was later.
      a.run({ type: 'tag.update', id, input: { name: 'A first', color: 'tag1', kind: 'class' } });
      await settle(a, b);
      b.run({ type: 'tag.update', id, input: { name: 'B second', color: 'tag1', kind: 'class' } });
      await settle(a, b);
      expect(a.d.tags[id]?.name).toBe('B second');
      expect(b.d.tags[id]?.name).toBe('B second');
      expect([...a.conflicts, ...b.conflicts]).toEqual([]);
    }
  });

  it('timer takeover closes the previous owner\'s slice at the takeover instant on both devices', async () => {
    const [a, b] = pair();
    a.connect();
    b.connect();
    const id = a.run({ type: 'task.create', input: { title: 'Essay', finishCondition: 'Essay submitted' } });
    a.run({ type: 'timer', action: 'start' });
    await settle(a, b);
    b.clock = T0 + 20 * MIN;
    b.commit(takeover(b.d, { now: b.now(), deviceId: 'devB', deviceName: 'Laptop' }));
    await settle(a, b);
    a.clock = T0 + 25 * MIN;
    await settle(a, b);
    for (const dev of [a, b]) {
      const sessions = live(dev.d, 'sessions');
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ taskId: id, startedAt: T0, endedAt: T0 + 20 * MIN });
      expect(dev.d.tasks[id]?.runtime.sliceStartedAt).toBe(T0 + 20 * MIN);
      expect(dev.d.timer.current?.ownerDeviceId).toBe('devB');
    }
  });

  it('completing a recurring task on two offline devices yields one next instance', async () => {
    const [a, b] = pair();
    a.connect();
    b.connect();
    const id = a.run({ type: 'task.create', input: { title: 'Water plants', finishCondition: 'All plants watered', dueDate: '2026-10-26', recurrence: { freq: 'daily', interval: 2 } } });
    await settle(a, b);
    a.goOffline();
    b.goOffline();
    a.run({ type: 'task.finish', id });
    b.clock = T0 + MIN;
    b.run({ type: 'task.finish', id });
    a.goOnline();
    b.goOnline();
    await settle(a, b);
    await settle(a, b);
    const next = (d: typeof a.d) => live(d, 'tasks').filter((t) => t.recurrenceParentId === id);
    expect(next(a.d).map((t) => t.id)).toEqual([`${id}:2026-10-28`]);
    expect(next(b.d).map((t) => t.id)).toEqual([`${id}:2026-10-28`]);
    expect(content(a.d)).toBe(content(b.d));
  });

  it('latency: a change reaches the other device after reconnects and sleep', async () => {
    const [a, b] = pair();
    a.link.latencyMs = 15;
    b.link.latencyMs = 15;
    a.connect();
    b.connect();
    await settle(a, b);
    b.goOffline();
    const id = a.run(tag('While B slept'));
    await settle(a);
    b.goOnline();
    await settle(a, b);
    expect(b.d.tags[id]?.name).toBe('While B slept');
  });
});
