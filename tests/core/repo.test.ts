// Repo stamping: every write sets updatedAt (strictly increasing), deviceId and v; deletes are tombstones.
import { describe, expect, it } from 'vitest';
import { create, recycle, restore, update } from '../../src/core/repo/repo';
import { ctx, fresh, T0 } from '../helpers';

describe('repo', () => {
  it('stamps creates and updates, monotonic even if the clock steps back', () => {
    const r = create(fresh(), 'tags', { name: 'Physics', color: 'tag1', kind: 'class' }, ctx(T0, 'devA'));
    expect(r.rec).toMatchObject({ createdAt: T0, updatedAt: T0, deviceId: 'devA', deletedAt: null, v: 1 });
    const d2 = update(r.d, 'tags', r.rec.id, { name: 'Phys' }, ctx(T0 - 5000, 'devB'));
    expect(d2.tags[r.rec.id]).toMatchObject({ name: 'Phys', updatedAt: T0 + 1, deviceId: 'devB', createdAt: T0 });
    expect(update(r.d, 'tags', 'missing', { name: 'x' }, ctx())).toBe(r.d);
  });

  it('recycle is a tombstone and restore clears it', () => {
    const r = create(fresh(), 'tags', { name: 'Physics', color: 'tag1', kind: 'class' }, ctx());
    const gone = recycle(r.d, 'tags', r.rec.id, ctx(T0 + 10));
    expect(gone.tags[r.rec.id]?.deletedAt).toBe(T0 + 10);
    expect(restore(gone, 'tags', r.rec.id, ctx(T0 + 20)).tags[r.rec.id]?.deletedAt).toBeNull();
  });
});
