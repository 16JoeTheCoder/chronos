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
