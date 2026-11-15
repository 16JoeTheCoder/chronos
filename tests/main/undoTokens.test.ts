import { describe, expect, it } from 'vitest';
import { apply } from '../../src/core/commands';
import { UNDO_KEEP, UNDO_TTL_MS, UndoTokens } from '../../src/main/undoTokens';
import { ctx, fresh, run } from '../helpers';

const ops = [{ coll: 'tasks' as const, id: 'x', prev: null }];

describe('UndoTokens', () => {
  it('seals results: raw ops never reach the renderer', () => {
    const u = new UndoTokens();
    const r = u.seal({ ok: true, id: '1', undo: ops });
    expect(r).toMatchObject({ ok: true, id: '1' });
    expect('undo' in r).toBe(false);
    expect((r as { undoToken?: string }).undoToken).toMatch(/^[a-f0-9]{24}$/);
    expect(u.seal({ ok: true })).toEqual({ ok: true });
    expect(u.seal({ ok: true, undo: [] })).toEqual({ ok: true });
    expect(u.seal({ ok: false, error: 'no' })).toEqual({ ok: false, error: 'no' });
  });

  it('redeems once, rejects junk, unknown and expired tokens', () => {
    let t = 1000;
    const u = new UndoTokens(() => t);
    const tok = u.hold(ops);
    expect(u.redeem(tok)).toEqual({ type: 'records.revert', ops });
    expect(u.redeem(tok)).toBeNull();
    expect(u.redeem('../../x')).toBeNull();
    expect(u.redeem(42)).toBeNull();
    const old = u.hold(ops);
    t += UNDO_TTL_MS + 1;
    expect(u.redeem(old)).toBeNull();
    expect(u.size).toBe(0);
  });

  it('keeps only the newest tokens', () => {
    const u = new UndoTokens();
    const first = u.hold(ops);
    for (let i = 0; i < UNDO_KEEP; i++) u.hold(ops);
    expect(u.size).toBe(UNDO_KEEP);
    expect(u.redeem(first)).toBeNull();
  });

  it('a sealed plan.auto undoes as one action through the token', () => {
    const base = run(fresh(), { type: 'task.create', input: { title: 'A', estimateMin: 30 } }).d;
    const res = apply(base, { type: 'plan.auto' }, ctx());
    if (!res.ok) throw new Error(res.error);
    const u = new UndoTokens();
    const sealed = u.seal({ ok: true, undo: res.undo });
    const cmd = u.redeem((sealed as { undoToken: string }).undoToken)!;
    const back = apply(res.d, cmd, ctx());
    expect(back.ok).toBe(true);
  });
});
