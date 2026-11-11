// Validation of the schema v2 fields: field validators and whole-record checks.
import { describe, expect, it } from 'vitest';
import { defaultDevice } from '../../src/core/model/defaults';
import type { DeviceSettings, Settings, Task } from '../../src/core/model/types';
import { isTaskRecurrence, recordProblem, validateDevice, validateSettings, validateTaskFields } from '../../src/core/validation';
import { addTask, fresh, run } from '../helpers';

type Obj = Record<string, any>;

function sample() {
  let d = fresh();
  const t = addTask(d, 'Task one');
  d = t.d;
  const p = run(d, { type: 'project.create', name: 'Proj' });
  d = p.d;
  const tag = run(d, { type: 'tag.create', input: { name: 'Math', color: 'tag1', kind: 'class' } });
  d = tag.d;
  const ev = run(d, { type: 'event.create', input: { title: 'Class', tagId: null, scope: 'school', tz: 'Asia/Jakarta', startMin: 480, endMin: 540, date: null, recur: { weekdays: [1], everyNWeeks: 1, anchorDate: '2026-10-26', from: null, until: null }, notes: '' } });
  d = ev.d;
  d = run(d, { type: 'event.skip', id: ev.id, date: '2026-11-02' }).d;
  d = run(d, { type: 'block.create', taskId: t.id, date: '2026-10-27', startMin: 600, endMin: 660 }).d;
  d = run(d, { type: 'idea.add', text: 'a note', taskId: null }).d;
  const task = d.tasks[t.id] as Task;
  return { d, task, project: Object.values(d.projects)[0]!, event: d.events[ev.id]!, exception: Object.values(d.eventExceptions)[0]!, block: Object.values(d.blocks)[0]!, idea: Object.values(d.ideas)[0]!, settings: d.settings.main as Settings };
}
const S = sample();
const bad = (coll: string, rec: Obj, patch: Obj) => recordProblem(coll, { ...rec, ...patch });

describe('baseline: records produced by commands are valid', () => {
  it('passes recordProblem', () => {
    expect(recordProblem('tasks', S.task)).toBeNull();
    expect(recordProblem('projects', S.project)).toBeNull();
    expect(recordProblem('events', S.event)).toBeNull();
    expect(recordProblem('eventExceptions', S.exception)).toBeNull();
    expect(recordProblem('blocks', S.block)).toBeNull();
    expect(recordProblem('ideas', S.idea)).toBeNull();
    expect(recordProblem('settings', S.settings)).toBeNull();
    expect(recordProblem('timer', S.d.timer.current)).toBeNull();
  });
});

describe('task fields (recordProblem)', () => {
  it.each([['inbox'], ['planned'], ['doing'], ['done'], ['dropped']])('accepts status %s', (status) => {
    expect(bad('tasks', S.task, { status })).toBeNull();
  });
  it.each([['queued'], ['active'], [''], [null], [3]])('rejects status %j', (status) => {
    expect(bad('tasks', S.task, { status })).toMatch(/status/);
  });

  it.each([['typed'], ['parsed'], ['claude'], ['import']])('accepts source %s', (source) => {
    expect(bad('tasks', S.task, { source })).toBeNull();
  });
  it.each([['robot'], [null], [undefined]])('rejects source %j', (source) => {
    expect(bad('tasks', S.task, { source })).toMatch(/source/);
  });

  it('dueDate: a real date or null', () => {
    expect(bad('tasks', S.task, { dueDate: '2026-10-30' })).toBeNull();
    expect(bad('tasks', S.task, { dueDate: null })).toBeNull();
    for (const dueDate of ['2026-13-40', '30/10/2026', 20261030, '', '2026-1-3']) expect(bad('tasks', S.task, { dueDate }), String(dueDate)).toMatch(/dueDate/);
  });

  it('dueTime: whole minutes 0-1439 or null', () => {
    for (const dueTime of [0, 870, 1439, null]) expect(bad('tasks', S.task, { dueTime })).toBeNull();
    for (const dueTime of [-1, 1440, 12.5, '14:30', NaN]) expect(bad('tasks', S.task, { dueTime }), String(dueTime)).toMatch(/dueTime/);
  });

  it('recurrence: daily, weekly with weekdays, null', () => {
    for (const recurrence of [null, { freq: 'daily', interval: 1 }, { freq: 'daily', interval: 52 }, { freq: 'weekly', interval: 2 }, { freq: 'weekly', interval: 1, weekdays: [1, 3, 5] }, { freq: 'weekly', interval: 1, weekdays: [] }]) {
      expect(bad('tasks', S.task, { recurrence }), JSON.stringify(recurrence)).toBeNull();
    }
    for (const recurrence of [{ freq: 'monthly', interval: 1 }, { freq: 'daily', interval: 0 }, { freq: 'daily', interval: 53 }, { freq: 'daily', interval: 1.5 }, { freq: 'weekly', interval: 1, weekdays: [8] }, { freq: 'weekly', interval: 1, weekdays: [0] }, { freq: 'weekly', interval: 1, weekdays: 'mon' }, { freq: 'daily' }, 'daily', []]) {
      expect(bad('tasks', S.task, { recurrence }), JSON.stringify(recurrence)).toMatch(/recurrence/);
    }
  });

  it('projectId / columnId / recurrenceParentId: id or null', () => {
    expect(bad('tasks', S.task, { projectId: S.project.id, columnId: 'todo' })).toBeNull();
    expect(bad('tasks', S.task, { projectId: 'has space' })).toMatch(/projectId/);
    expect(bad('tasks', S.task, { projectId: 5 })).toMatch(/projectId/);
    expect(bad('tasks', S.task, { columnId: 7 })).toMatch(/columnId/);
    expect(bad('tasks', S.task, { columnId: 'x'.repeat(61) })).toMatch(/columnId/);
    expect(bad('tasks', S.task, { recurrenceParentId: 'root:2026-10-26' })).toBeNull();
    expect(bad('tasks', S.task, { recurrenceParentId: '../x' })).toMatch(/recurrenceParentId/);
  });

  it('sortKey: base-62 digits, not ending in 0, 1-512 chars', () => {
    for (const sortKey of ['V', 'a1', 'Zz9']) expect(bad('tasks', S.task, { sortKey })).toBeNull();
    for (const sortKey of ['', 'a0', 'a b', 'é', 7, null, 'x'.repeat(513)]) expect(bad('tasks', S.task, { sortKey }), String(sortKey)).toMatch(/sortKey/);
  });
});

describe('validateTaskFields (commands)', () => {
  it('validates dueDate, dueTime and recurrence', () => {
    expect(validateTaskFields({ dueDate: '2026-10-30', dueTime: 900, recurrence: { freq: 'weekly', interval: 1, weekdays: [1, 3] } })).toEqual({});
    expect(validateTaskFields({ dueDate: '2026-02-31x' })).toHaveProperty('dueDate');
    expect(validateTaskFields({ dueTime: 1440 })).toHaveProperty('dueTime');
    expect(validateTaskFields({ recurrence: { freq: 'weekly', interval: 0 } })).toHaveProperty('recurrence');
    expect(validateTaskFields({ recurrence: { freq: 'weekly', interval: 53 } })).toHaveProperty('recurrence');
    expect(validateTaskFields({ recurrence: { freq: 'weekly', interval: 1, weekdays: [8] } })).toHaveProperty('recurrence');
    expect(validateTaskFields({ recurrence: null })).toEqual({});
  });
  it('task.create refuses bad v2 fields with field errors', () => {
    const r = run(fresh(), { type: 'task.create', input: { title: 'ok', finishCondition: 'Finished is defined' } });
    expect(r.id).toBeTruthy();
    expect(() => addTask(fresh(), 'x', { recurrence: { freq: 'daily', interval: 0 } })).toThrow(/recurrence/);
    expect(() => addTask(fresh(), 'x', { dueTime: 5000 })).toThrow(/dueTime/);
  });
});

describe('isTaskRecurrence', () => {
  it('accepts and rejects', () => {
    expect(isTaskRecurrence({ freq: 'daily', interval: 3 })).toBe(true);
    expect(isTaskRecurrence({ freq: 'weekly', interval: 1, weekdays: [1, 7] })).toBe(true);
    expect(isTaskRecurrence({ freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5, 6, 7, 1] })).toBe(false);
    expect(isTaskRecurrence(null)).toBe(false);
    expect(isTaskRecurrence({ freq: 'yearly', interval: 1 })).toBe(false);
  });
});

describe('project', () => {
  it('columns shape', () => {
    expect(bad('projects', S.project, { columns: [{ id: 'a', name: 'A' }] })).toBeNull();
    expect(bad('projects', S.project, { columns: [] })).toBeNull();
    for (const columns of ['todo', [{ id: '', name: 'x' }], [{ id: 'a' }], [{ id: 'a', name: 5 }], [{ id: 'a'.repeat(61), name: 'x' }], [null], Array.from({ length: 31 }, (_, i) => ({ id: `c${i}`, name: 'x' }))]) {
      expect(bad('projects', S.project, { columns }), JSON.stringify(columns).slice(0, 40)).toMatch(/columns/);
    }
  });
  it('color, archived, name and sortKey', () => {
    expect(bad('projects', S.project, { color: 'tag8' })).toBeNull();
    expect(bad('projects', S.project, { color: 'red' })).toMatch(/color/);
    expect(bad('projects', S.project, { archived: 'no' })).toMatch(/archived/);
    expect(bad('projects', S.project, { name: 3 })).toMatch(/name/);
    expect(bad('projects', S.project, { sortKey: 'a0' })).toMatch(/sortKey/);
  });
});

describe('review', () => {
  const review = { ...S.idea, id: 'review-2026-10-26', date: '2026-10-26', outcomes: [{ taskId: 't1', action: 'tomorrow' }] } as Obj;
  const base = () => {
    const { text: _t, body: _b, taskId: _i, reviewed: _r, parsedTaskIds: _p, ...rest } = review;
    return rest;
  };
  it('accepts every action', () => {
    for (const action of ['tomorrow', 'unscheduled', 'dropped', 'done']) expect(recordProblem('reviews', { ...base(), outcomes: [{ taskId: 't1', action }] })).toBeNull();
    expect(recordProblem('reviews', { ...base(), outcomes: [] })).toBeNull();
  });
  it('rejects bad outcomes and dates', () => {
    expect(recordProblem('reviews', { ...base(), outcomes: [{ taskId: 't1', action: 'later' }] })).toMatch(/outcomes/);
    expect(recordProblem('reviews', { ...base(), outcomes: [{ taskId: 'bad id', action: 'done' }] })).toMatch(/outcomes/);
    expect(recordProblem('reviews', { ...base(), outcomes: 'done' })).toMatch(/outcomes/);
    expect(recordProblem('reviews', { ...base(), outcomes: [{ action: 'done' }] })).toMatch(/outcomes/);
    expect(recordProblem('reviews', { ...base(), date: 'yesterday' })).toMatch(/date/);
  });
});

describe('idea (note)', () => {
  it('body and parsedTaskIds', () => {
    expect(bad('ideas', S.idea, { body: 'x'.repeat(100_000) })).toBeNull();
    expect(bad('ideas', S.idea, { body: 'x'.repeat(100_001) })).toMatch(/body/);
    expect(bad('ideas', S.idea, { body: 4 })).toMatch(/body/);
    expect(bad('ideas', S.idea, { body: undefined })).toMatch(/body/);
    expect(bad('ideas', S.idea, { parsedTaskIds: ['a', 'b:2026-10-26'] })).toBeNull();
    expect(bad('ideas', S.idea, { parsedTaskIds: ['bad id'] })).toMatch(/parsedTaskIds/);
    expect(bad('ideas', S.idea, { parsedTaskIds: 'a' })).toMatch(/parsedTaskIds/);
    expect(bad('ideas', S.idea, { parsedTaskIds: Array.from({ length: 501 }, (_, i) => `t${i}`) })).toMatch(/parsedTaskIds/);
  });
});

describe('block auto', () => {
  it('is a boolean', () => {
    expect(bad('blocks', S.block, { auto: true })).toBeNull();
    expect(bad('blocks', S.block, { auto: false })).toBeNull();
    expect(bad('blocks', S.block, { auto: 'yes' })).toMatch(/auto/);
    expect(bad('blocks', S.block, { auto: undefined })).toMatch(/auto/);
  });
});

describe('eventException edit fields', () => {
  it('skip and edit with overrides', () => {
    expect(bad('eventExceptions', S.exception, { kind: 'edit', title: 'Moved', startMin: 600, endMin: 660, tagId: null })).toBeNull();
    expect(bad('eventExceptions', S.exception, { kind: 'edit', title: null, startMin: null, endMin: null, tagId: 'tag-1' })).toBeNull();
    expect(bad('eventExceptions', S.exception, { kind: 'move' })).toMatch(/kind/);
    expect(bad('eventExceptions', S.exception, { title: 5 })).toMatch(/title/);
    expect(bad('eventExceptions', S.exception, { title: 'x'.repeat(501) })).toMatch(/title/);
    expect(bad('eventExceptions', S.exception, { startMin: 1441 })).toMatch(/startMin/);
    expect(bad('eventExceptions', S.exception, { endMin: -1 })).toMatch(/endMin/);
    expect(bad('eventExceptions', S.exception, { tagId: 'bad id' })).toMatch(/tagId/);
    expect(bad('eventExceptions', S.exception, { date: 'soon' })).toMatch(/date/);
    expect(bad('eventExceptions', S.exception, { eventId: 7 })).toMatch(/eventId/);
  });
  it('the v1 shape (missing override fields) is no longer valid', () => {
    const { title: _t, startMin: _s, endMin: _e, tagId: _g, ...v1like } = S.exception as Obj;
    expect(recordProblem('eventExceptions', v1like)).toMatch(/title/);
  });
});

describe('settings v2 fields', () => {
  const s = (patch: Partial<Settings>) => validateSettings({ ...S.settings, ...patch });
  it('themeId', () => {
    expect(s({ themeId: 'midnight' })).toEqual({});
    expect(s({ themeId: '' })).toHaveProperty('themeId');
    expect(s({ themeId: 'x'.repeat(41) })).toHaveProperty('themeId');
    expect(s({ themeId: 4 as never })).toHaveProperty('themeId');
  });
  it('customTheme', () => {
    expect(s({ customTheme: null })).toEqual({});
    expect(s({ customTheme: { bg: '#000', fg: '#fff' } })).toEqual({});
    expect(s({ customTheme: { bg: 3 as never } })).toHaveProperty('customTheme');
    expect(s({ customTheme: { bg: 'x'.repeat(513) } })).toHaveProperty('customTheme');
    expect(s({ customTheme: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, 'v'])) })).toHaveProperty('customTheme');
    expect(s({ customTheme: [] as never })).toHaveProperty('customTheme');
  });
  it.each([5, 10, 15, 30])('snapMin %i is fine', (snapMin) => expect(s({ snapMin })).toEqual({}));
  it.each([7, 0, 20, 60, -5, 5.5])('snapMin %s is rejected', (snapMin) => expect(s({ snapMin })).toHaveProperty('snapMin'));
  it('parserRules', () => {
    expect(s({ parserRules: [] })).toEqual({});
    expect(s({ parserRules: [{ keyword: 'meeting', kind: 'fixed' }, { keyword: 'todo', kind: 'task' }] })).toEqual({});
    expect(s({ parserRules: [{ keyword: '', kind: 'fixed' }] })).toHaveProperty('parserRules');
    expect(s({ parserRules: [{ keyword: '  ', kind: 'fixed' }] })).toHaveProperty('parserRules');
    expect(s({ parserRules: [{ keyword: 'x', kind: 'other' as never }] })).toHaveProperty('parserRules');
    expect(s({ parserRules: [{ keyword: 'x'.repeat(61), kind: 'task' }] })).toHaveProperty('parserRules');
    expect(s({ parserRules: 'none' as never })).toHaveProperty('parserRules');
    expect(s({ parserRules: Array.from({ length: 201 }, () => ({ keyword: 'k', kind: 'task' as const })) })).toHaveProperty('parserRules');
  });
  it('whole record check reports the failing settings field', () => {
    expect(bad('settings', S.settings, { snapMin: 7 })).toBe('bad snapMin');
    expect(bad('settings', S.settings, { themeId: '' })).toBe('bad themeId');
  });
});

describe('validateDevice v2 fields', () => {
  const dev = (patch: Partial<DeviceSettings>) => validateDevice({ ...defaultDevice('dev1', 'PC'), ...patch });
  it('defaults are valid', () => expect(dev({})).toEqual({}));
  it('experimental is boolean', () => {
    expect(dev({ experimental: true })).toEqual({});
    expect(dev({ experimental: 1 as never })).toHaveProperty('experimental');
  });
  it('mcp', () => {
    expect(dev({ mcp: { enabled: true, port: 51234, token: 'abc' } })).toEqual({});
    expect(dev({ mcp: { enabled: true, port: 0, token: '' } })).toEqual({});
    expect(dev({ mcp: { enabled: 'yes' as never, port: 1, token: 't' } })).toHaveProperty('mcp');
    expect(dev({ mcp: { enabled: true, port: 70000, token: 't' } })).toHaveProperty('mcp');
    expect(dev({ mcp: { enabled: true, port: -1, token: 't' } })).toHaveProperty('mcp');
    expect(dev({ mcp: { enabled: true, port: 80.5, token: 't' } })).toHaveProperty('mcp');
    expect(dev({ mcp: { enabled: true, port: 80, token: 5 as never } })).toHaveProperty('mcp');
    expect(dev({ mcp: { enabled: true, port: 80, token: 'x'.repeat(201) } })).toHaveProperty('mcp');
    expect(dev({ mcp: null as never })).toHaveProperty('mcp');
  });
  it('sync', () => {
    expect(dev({ sync: { uid: 'u1', cursors: { tasks: 5, blocks: 9 }, lastSyncAt: 123 } })).toEqual({});
    expect(dev({ sync: { uid: 7 as never, cursors: {}, lastSyncAt: null } })).toHaveProperty('sync');
    expect(dev({ sync: { uid: null, cursors: { tasks: 'x' as never }, lastSyncAt: null } })).toHaveProperty('sync');
    expect(dev({ sync: { uid: null, cursors: {}, lastSyncAt: 'now' as never } })).toHaveProperty('sync');
    expect(dev({ sync: { lastPushedAt: 0, cursors: {} } as never })).toHaveProperty('sync'); // the v1 shape
  });
  it('auth', () => {
    expect(dev({ auth: { refreshTokenEnc: 'abc==', email: 'a@b.c', uid: 'u' } })).toEqual({});
    expect(dev({ auth: { refreshTokenEnc: 5 as never, email: null, uid: null } })).toHaveProperty('auth');
    expect(dev({ auth: { refreshTokenEnc: 'x'.repeat(8001), email: null, uid: null } })).toHaveProperty('auth');
    expect(dev({ auth: null as never })).toHaveProperty('auth');
  });
});

describe('recordProblem', () => {
  const t = S.task as unknown as Obj;
  it('rejects a schemaVersion newer than this app', () => {
    expect(recordProblem('tasks', { ...t, v: 3 })).toMatch(/newer/);
    expect(recordProblem('tasks', { ...t, v: 99 })).toMatch(/newer/);
    expect(recordProblem('tasks', { ...t, v: 2 })).toBeNull();
    expect(recordProblem('tasks', { ...t, v: 1 })).toBeNull();
  });
  it('rejects bad v', () => {
    expect(recordProblem('tasks', { ...t, v: 0 })).toBe('bad v');
    expect(recordProblem('tasks', { ...t, v: 1.5 })).toBe('bad v');
    expect(recordProblem('tasks', { ...t, v: '2' })).toBe('bad v');
  });
  it('requires fv and fw maps of the right type', () => {
    const { fv: _fv, ...noFv } = t;
    const { fw: _fw, ...noFw } = t;
    expect(recordProblem('tasks', noFv)).toBe('bad fv');
    expect(recordProblem('tasks', noFw)).toBe('bad fw');
    expect(recordProblem('tasks', { ...t, fv: { title: 'x' } })).toBe('bad fv');
    expect(recordProblem('tasks', { ...t, fw: { title: 3 } })).toBe('bad fw');
    expect(recordProblem('tasks', { ...t, fv: [] })).toBe('bad fv');
    expect(recordProblem('tasks', { ...t, fv: { title: 1_700_000_000_000_001 }, fw: { title: 'dev' } })).toBeNull();
  });
  it('rejects wrong types on base and own fields', () => {
    expect(recordProblem('tasks', { ...t, title: 5 })).toBe('bad title');
    expect(recordProblem('tasks', { ...t, createdAt: 'x' })).toBe('bad createdAt');
    expect(recordProblem('tasks', { ...t, deletedAt: undefined })).toBe('bad deletedAt');
    expect(recordProblem('tasks', { ...t, deviceId: null })).toBe('bad deviceId');
    expect(recordProblem('tasks', { ...t, priority: 'urgent' })).toBe('bad priority');
  });
  it('rejects unknown collections, non-objects and bad ids', () => {
    expect(recordProblem('widgets', t)).toMatch(/unknown collection/);
    expect(recordProblem('tasks', null)).toBe('not an object');
    expect(recordProblem('tasks', [])).toBe('not an object');
    expect(recordProblem('tasks', 'x')).toBe('not an object');
    expect(recordProblem('tasks', { ...t, id: '' })).toBe('bad id');
    expect(recordProblem('tasks', { ...t, id: 'a b' })).toBe('bad id');
    expect(recordProblem('tasks', { ...t, id: undefined })).toBe('bad id');
  });
  it("settings must be doc 'main', timer doc 'current'", () => {
    expect(recordProblem('settings', { ...S.settings, id: 'other' })).toMatch(/settings must be doc main/);
    expect(recordProblem('settings', { ...S.settings, id: 'main' })).toBeNull();
    expect(recordProblem('timer', { ...S.d.timer.current, id: 'x' })).toMatch(/timer must be doc current/);
  });
  it('accepts a valid purge stub and rejects broken ones', () => {
    const stub = { id: 'gone', updatedAt: 5, deletedAt: 4, deviceId: 'dev', v: 2, purged: true };
    expect(recordProblem('tasks', stub)).toBeNull();
    expect(recordProblem('blocks', stub)).toBeNull();
    expect(recordProblem('tasks', { ...stub, deletedAt: null })).toBe('bad purge stub');
    expect(recordProblem('tasks', { ...stub, deviceId: 5 })).toBe('bad purge stub');
    expect(recordProblem('tasks', { ...stub, v: 1.5 })).toBe('bad purge stub');
    expect(recordProblem('tasks', { ...stub, id: 'bad id' })).toBe('bad id');
  });
});
