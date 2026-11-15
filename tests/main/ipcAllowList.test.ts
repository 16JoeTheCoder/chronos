// The IPC allow-list must cover every Command type (Phase 3.5: project.create and
// task.moveCard were missing, so every project action failed with "Invalid command").
// `examples` is typed Record<Command['type'], ...>: adding a Command without an example
// here is a type error, so this class of bug cannot come back silently.
import { describe, expect, it } from 'vitest';
import type { Command } from '../../src/core/commands';
import { parseCommand } from '../../src/main/ipc';

const ID = 'a1b2c3d4e5f6a7b8c9d0';
const ID2 = 'b1b2c3d4e5f6a7b8c9d0';
const ev = { title: 'Maths', tagId: null, scope: 'school', tz: 'UTC', startMin: 540, endMin: 600, date: '2026-11-16', recur: null, notes: '' };

/** `null` = internal command that must never be accepted over IPC. */
const examples: Record<Command['type'], Record<string, unknown> | null> = {
  'task.create': { input: { title: 'Essay' } },
  'task.update': { id: ID, input: { title: 'Essay 2' } },
  'task.reorder': { id: ID, direction: 'up' },
  'task.finish': { id: ID },
  'task.drop': { id: ID, reason: 'later' },
  'task.close': { id: ID, reason: 'no' },
  'task.reopen': { id: ID },
  'task.moveCard': { id: ID, columnId: 'doing', beforeId: ID2 },
  timer: { action: 'start' },
  'sprint.checkpoint': { id: ID, choice: 'continue' },
  'block.create': { taskId: ID, date: '2026-11-16', startMin: 540, endMin: 600 },
  'block.move': { id: ID, date: '2026-11-16', startMin: 540, endMin: 600 },
  'event.create': { input: ev },
  'event.update': { id: ID, input: ev },
  'event.place': { id: ID, startMin: 600 },
  'event.skip': { id: ID, date: '2026-11-16' },
  'event.editOn': { id: ID, date: '2026-11-16', patch: { title: 'X' } },
  'project.create': { name: 'Thesis', color: 'tag2', columns: ['To do', 'Doing', 'Done'] },
  'closure.create': { input: { name: 'Break', startDate: '2026-12-20', endDate: '2027-01-05', scopes: ['school'], confirmed: true } },
  'closure.update': { id: ID, input: { name: 'Break', startDate: '2026-12-20', endDate: '2027-01-05', scopes: ['school'], confirmed: true } },
  'tag.create': { input: { name: 'Maths', color: 'tag1', kind: 'subject' } },
  'tag.update': { id: ID, input: { name: 'Maths', color: 'tag1', kind: 'subject' } },
  'idea.add': { text: 'hello', taskId: null },
  'plan.auto': {},
  'plan.replan': { date: '2026-11-16' },
  'review.submit': { date: '2026-11-16', outcomes: [{ taskId: ID, action: 'done' }] },
  'parser.report': { input: 'x', expected: 'y', actual: 'z' },
  'records.revert': null,
  'activity.claude': null,
  'idea.edit': { id: ID, body: 'edited' },
  'idea.review': { id: ID, reviewed: true },
  'idea.toTask': { id: ID },
  recycle: { coll: 'tasks', id: ID, confirmed: true },
  restore: { coll: 'tasks', id: ID },
  'settings.update': { patch: { bufferMin: 10 } },
  'device.update': { patch: { sound: true } },
  'sync.signIn': {},
  'sync.signOut': {},
  'sync.retry': {},
  'sync.forceResync': {},
  'diag.clear': { what: 'conflicts' },
  'diag.exportLog': {},
  'snapshot.restore': { name: 'chronos-2026-11-15.json' },
  'mcp.regenerateToken': {},
  'mcp.copyConfig': {},
  'mcp.undo': { token: 'abc123' },
  'gap.answer': { count: true },
  'timer.takeover': {},
  'data.import': { source: 'monolith' },
  'data.export': {},
  'data.openFolder': {},
};

describe('IPC allow-list', () => {
  for (const [type, ex] of Object.entries(examples)) {
    it(ex ? `accepts ${type}` : `rejects internal ${type}`, () => {
      const cmd = parseCommand({ type, ...(ex ?? {}) });
      if (ex) {
        expect(cmd, type).not.toBeNull();
        expect(cmd!.type).toBe(type);
      } else expect(cmd).toBeNull();
    });
  }

  it('validates project.create and task.moveCard inputs', () => {
    expect(parseCommand({ type: 'project.create', name: 42 })).toBeNull();
    expect(parseCommand({ type: 'project.create', name: 'X', color: 'red' })).toBeNull();
    expect(parseCommand({ type: 'project.create', name: 'X', columns: 'a,b' })).toBeNull();
    expect(parseCommand({ type: 'project.create', name: 'X', evil: 1 })).toEqual({ type: 'project.create', name: 'X' });
    expect(parseCommand({ type: 'task.moveCard', id: ID, columnId: '', beforeId: null })).toBeNull();
    expect(parseCommand({ type: 'task.moveCard', id: ID, columnId: 'doing', beforeId: '../x' })).toBeNull();
    expect(parseCommand({ type: 'task.moveCard', id: ID, columnId: 'doing', beforeId: null })).toEqual({ type: 'task.moveCard', id: ID, columnId: 'doing', beforeId: null });
  });
});
