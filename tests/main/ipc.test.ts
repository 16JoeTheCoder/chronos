// IPC validation: payloads are rebuilt from known keys; malformed ones are rejected here or by core.
import { describe, expect, it } from 'vitest';
import { apply } from '../../src/core/commands';
import { parseCommand } from '../../src/main/ipc';
import { ctx, fresh } from '../helpers';

describe('parseCommand', () => {
  it('drops unknown keys and rejects malformed payloads', () => {
    const cmd = parseCommand({ type: 'task.create', input: { title: 'Essay', finishCondition: 'Essay is submitted', evil: 'x', priority: 'must' }, extra: 1 });
    expect(cmd).toEqual({ type: 'task.create', input: { title: 'Essay', finishCondition: 'Essay is submitted', priority: 'must' } });
    expect(parseCommand({ type: 'task.finish', id: '../../etc', phrase: 'x' })).toBeNull();
    expect(parseCommand({ type: 'timer', action: 'explode' })).toBeNull();
    expect(parseCommand({ type: 'recycle', coll: 'settings', id: 'main' })).toBeNull();
    expect(parseCommand({ type: 'nope' })).toBeNull();
    expect(parseCommand('string')).toBeNull();
  });

  it('values that survive parsing are still validated by core', () => {
    const bad = [
      { type: 'task.create', input: { title: 'x', priority: 'urgent' } },
      { type: 'block.create', taskId: null, date: '2026-10-26', startMin: 'nine', endMin: 600 },
      { type: 'settings.update', patch: { timezone: 'Nowhere/City', bufferMin: 30 } },
      { type: 'event.create', input: { title: 'X', scope: 'school', tz: 'Asia/Jakarta', startMin: 600, endMin: 500, date: '2026-10-26', recur: null, notes: '' } },
    ];
    for (const raw of bad) {
      const cmd = parseCommand(raw);
      expect(cmd, JSON.stringify(raw)).not.toBeNull();
      expect(apply(fresh(), cmd!, ctx()).ok, JSON.stringify(raw)).toBe(false);
    }
  });

  it('keeps partial task updates partial', () => {
    expect(parseCommand({ type: 'task.update', id: 'abc', input: { notes: 'n' } })).toEqual({ type: 'task.update', id: 'abc', input: { notes: 'n' } });
  });
});

import { pickCreated } from '../../src/main/ipc';

describe('pickCreated (notepad close summary)', () => {
  it('keeps only known collections and well-formed ids', () => {
    expect(pickCreated({ text: 'Added 2', records: [{ coll: 'tasks', id: 'abc123' }, { coll: 'settings', id: 'main' }, { coll: 'ideas', id: '../x' }, { coll: 'events', id: 'def456', extra: 1 }] })).toEqual({
      text: 'Added 2',
      records: [{ coll: 'tasks', id: 'abc123' }, { coll: 'events', id: 'def456' }],
    });
    expect(pickCreated({ text: 'x', records: [{ coll: 'settings', id: 'main' }] })).toBeNull();
    expect(pickCreated('nope')).toBeNull();
    expect(pickCreated({ text: 'x', records: 'no' })).toBeNull();
  });
  it('never accepts records.revert or other internal commands over IPC', () => {
    expect(parseCommand({ type: 'records.revert', ops: [{ coll: 'tasks', id: 'abc', prev: null }] })).toBeNull();
    expect(parseCommand({ type: 'activity.claude', taskId: 'abc', reason: 'x' })).toBeNull();
  });
});

describe('idea.edit', () => {
  it('rebuilds known fields only and validates ids', () => {
    expect(parseCommand({ type: 'idea.edit', id: 'abc', body: 'hi', projectId: null, parsedTaskIds: ['L0:t1', 'L2:t2'], evil: 1 })).toEqual({ type: 'idea.edit', id: 'abc', body: 'hi', projectId: null, parsedTaskIds: ['L0:t1', 'L2:t2'] });
    expect(parseCommand({ type: 'idea.edit', id: 'abc', body: 'x' })).toEqual({ type: 'idea.edit', id: 'abc', body: 'x' });
    expect(parseCommand({ type: 'idea.edit', id: '../x', body: 'x' })).toBeNull();
    expect(parseCommand({ type: 'idea.edit', id: 'abc', parsedTaskIds: [1] })).toBeNull();
    expect(parseCommand({ type: 'idea.edit', id: 'abc', projectId: '../p' })).toMatchObject({ projectId: null });
    expect((parseCommand({ type: 'idea.edit', id: 'abc', parsedTaskIds: Array(900).fill('L0:a') }) as { parsedTaskIds: string[] }).parsedTaskIds).toHaveLength(500);
  });
});

import { validateSettings } from '../../src/core/validation';
import { defaultSettings } from '../../src/core/model/defaults';

describe('settings.update: snapMin, parserRules, parserReports', () => {
  const patch = (p: Record<string, unknown>) => (parseCommand({ type: 'settings.update', patch: p }) as { patch: Record<string, unknown> }).patch;
  const merged = (p: Record<string, unknown>) => validateSettings({ ...defaultSettings(), ...p } as never);

  it('lets them through, copying known keys only', () => {
    const rule = { id: 'u1', match: 'lab', kind: 'fixed', defaultDurationMin: 90, source: 'user', evil: 1 };
    const p = patch({ snapMin: 15, parserRules: [rule], parserReports: [{ at: 5, input: 'a', expected: 'b', actual: 'c', evil: 1 }] });
    expect(p.snapMin).toBe(15);
    expect(p.parserRules).toEqual([{ id: 'u1', match: 'lab', source: 'user', kind: 'fixed', defaultDurationMin: 90 }]);
    expect(p.parserReports).toEqual([{ at: 5, input: 'a', expected: 'b', actual: 'c' }]);
    expect(merged(p)).toEqual({});
  });

  it('core validates the values: bad rules, snap and reports are rejected', () => {
    expect(merged(patch({ snapMin: 7 }))).toHaveProperty('snapMin');
    expect(merged(patch({ parserRules: [{ id: 'u', match: '', source: 'user' }] }))).toHaveProperty('parserRules');
    expect(merged(patch({ parserRules: [{ id: 'u', match: 'x', source: 'hacker' }] }))).toHaveProperty('parserRules');
    expect(merged(patch({ parserRules: [{ id: 'u', match: 'x', source: 'user', kind: 'event' }] }))).toHaveProperty('parserRules');
    expect(merged(patch({ parserRules: [{ id: 'u', match: 'x', source: 'learned', aliases: ['a', 'b'], tagId: 't1', allowDateOnly: true }] }))).toEqual({});
    expect(merged(patch({ parserRules: [{ keyword: 'meeting', kind: 'fixed' }] }))).toEqual({});
    expect(merged(patch({ parserReports: [{ at: 'now', input: 'a', expected: 'b', actual: 'c' }] }))).toHaveProperty('parserReports');
  });
});
