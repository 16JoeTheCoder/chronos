// The merge rules in isolation: planCommit (inside the flush transaction) and
// mergeRemote (pulled docs), plus the outbox's diff/coalesce/pending/replay.
import { describe, expect, it } from 'vitest';
import { apply } from '../../src/core/commands';
import { emptyData } from '../../src/core/model/defaults';
import { SCHEMA_V } from '../../src/core/model/types';
import { mergeRemote, planCommit } from '../../src/core/sync/merge';
import { backoffMs, BACKOFF_MAX_MS } from '../../src/core/sync/engine';
import { diffData, enqueue, pendingFields, replay, same, seedEntries } from '../../src/core/sync/outbox';
import type { OutboxEntry, RemoteDoc } from '../../src/core/sync/provider';
import { T0 } from '../helpers';

const ctx = { now: T0, deviceId: 'devA', deviceName: 'devA' };
const entry = (fields: Record<string, unknown>, baseFv: Record<string, number> = {}, extra: Partial<OutboxEntry> = {}): OutboxEntry => ({ opId: 'op1', coll: 'tags', id: 't1', fields, baseFv, createdAt: T0, ...extra });
const remote = (data: Record<string, unknown>, fv: Record<string, number> = {}, fw: Record<string, string> = {}): RemoteDoc => ({ coll: 'tags', id: 't1', data: { id: 't1', v: SCHEMA_V, deletedAt: null, ...data }, fv, fw, serverUpdatedAt: 10 });

describe('planCommit', () => {
  it('writes a whole new doc when the server has none', () => {
    const p = planCommit(entry({ name: 'A' }), null, undefined, 'devA', T0);
    expect(p).toMatchObject({ outcome: 'written', replace: true, conflicts: [] });
  });

  it('a field changed elsewhere since the edit is a conflict; the local edit still wins', () => {
    const p = planCommit(entry({ name: 'Mine', updatedAt: T0 }, { name: 5 }), remote({ name: 'Theirs' }, { name: 9 }, { name: 'devB' }), undefined, 'devA', T0);
    expect(p.write).toEqual({ name: 'Mine', updatedAt: T0 });
    expect(p.conflicts).toEqual([expect.objectContaining({ field: 'name', overwrittenValue: 'Theirs', newValue: 'Mine', otherDeviceId: 'devB' })]);
  });

  it('no conflict for our own earlier write, an unchanged version, or an identical value', () => {
    expect(planCommit(entry({ name: 'X' }, { name: 5 }), remote({ name: 'Y' }, { name: 9 }, { name: 'devA' }), undefined, 'devA', T0).conflicts).toEqual([]);
    expect(planCommit(entry({ name: 'X' }, { name: 9 }), remote({ name: 'Y' }, { name: 9 }, { name: 'devB' }), undefined, 'devA', T0).conflicts).toEqual([]);
    expect(planCommit(entry({ name: 'Y' }, { name: 5 }), remote({ name: 'Y' }, { name: 9 }, { name: 'devB' }), undefined, 'devA', T0).conflicts).toEqual([]);
  });

  it('a remote tombstone beats an edit (logged, adopted); a restore goes through', () => {
    const r = remote({ name: 'Old', deletedAt: T0 }, { name: 1, deletedAt: 2 }, { deletedAt: 'devB' });
    const p = planCommit(entry({ name: 'Edit' }), r, undefined, 'devA', T0);
    expect(p).toMatchObject({ outcome: 'tombstoned', write: null, adopt: true });
    expect(p.conflicts[0]).toMatchObject({ field: 'name', overwrittenValue: 'Edit', newValue: 'Old', otherDeviceId: 'devB' });
    expect(planCommit(entry({ deletedAt: null }), r, undefined, 'devA', T0).outcome).toBe('written');
  });

  it('never writes over a newer schema', () => {
    expect(planCommit(entry({ name: 'X' }), remote({ v: SCHEMA_V + 1 }), undefined, 'devA', T0).outcome).toBe('newerSchema');
  });

  it('a seed entry fills only what the server lacks and adopts the rest', () => {
    const p = planCommit(entry({ name: 'Default', color: 'tag1' }, {}, { seed: true }), remote({ name: 'Real' }, { name: 3 }), undefined, 'devA', T0);
    expect(p).toMatchObject({ outcome: 'written', write: { color: 'tag1' }, adopt: true, conflicts: [] });
  });
});

describe('outbox', () => {
  const a = apply(emptyData(), { type: 'tag.create', input: { name: 'Phys', color: 'tag1', kind: 'class' } }, ctx);
  if (!a.ok) throw new Error(a.error);
  const id = Object.keys(a.d.tags)[0]!;

  it('diffs only changed fields, coalesces waiting entries, never in-flight ones', () => {
    const b = apply(a.d, { type: 'tag.update', id, input: { name: 'Physics', color: 'tag1', kind: 'class' } }, { ...ctx, now: T0 + 1 });
    if (!b.ok) throw new Error(b.error);
    const [e] = diffData(a.d, b.d, T0);
    expect(Object.keys(e!.fields).sort()).toEqual(['name', 'updatedAt']);
    const created = diffData(emptyData(), a.d, T0);
    const merged = enqueue(created, [e!]);
    expect(merged.filter((x) => x.coll === 'tags')).toHaveLength(1);
    const tagEntry = created.find((x) => x.coll === 'tags')!;
    expect(enqueue(created, [e!], new Set([tagEntry.opId])).filter((x) => x.coll === 'tags')).toHaveLength(2);
    expect(pendingFields(merged).has(`tags/${id}/name`)).toBe(true);
  });

  it('replay re-applies entries; seed lists never-synced fields; same() ignores key order', () => {
    const e = { ...entry({ name: 'Replayed' }), id };
    expect(replay(a.d, [e]).tags[id]?.name).toBe('Replayed');
    expect(seedEntries(a.d, T0, new Set()).some((x) => x.id === id && x.seed)).toBe(true);
    expect(same({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(same([1, 2], [2, 1])).toBe(false);
  });

  it('mergeRemote keeps pending fields local and takes the rest', () => {
    const r: RemoteDoc = { coll: 'tags', id, data: { ...a.d.tags[id], name: 'Remote', color: 'tag5' } as unknown as Record<string, unknown>, fv: { name: 7, color: 7 }, fw: { name: 'devB', color: 'devB' }, serverUpdatedAt: 7 };
    const m = mergeRemote(a.d, [r], new Set([`tags/${id}/name`]), ctx);
    expect(m.d.tags[id]).toMatchObject({ name: 'Phys', color: 'tag5', fv: { name: 7, color: 7 } });
  });

  it('backoff doubles from 1 s and caps at 60 s', () => {
    expect(backoffMs(1, () => 0.5)).toBe(1000);
    expect(backoffMs(3, () => 0.5)).toBe(4000);
    expect(backoffMs(20, () => 0.5)).toBe(BACKOFF_MAX_MS);
  });
});
