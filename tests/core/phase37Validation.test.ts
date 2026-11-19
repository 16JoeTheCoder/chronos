// Phase 3.7 validation: bare capture keys, notepad device settings, task retention, labels, block placement.
import { describe, expect, it } from 'vitest';
import { blockFits } from '../../src/core/commands';
import { defaultDevice, defaultSettings } from '../../src/core/model/defaults';
import type { DeviceSettings, Settings } from '../../src/core/model/types';
import { isBareKey, recordProblem, validateDevice, validateSettings } from '../../src/core/validation';
import { addTask, fresh, run, TODAY } from '../helpers';

const dev = (): DeviceSettings => defaultDevice('devA', 'PC');

describe('isBareKey', () => {
  it('accepts keys that type nothing', () => {
    for (const k of ['Insert', 'F8', 'Pause', 'f1', 'F24', 'ScrollLock']) expect(isBareKey(k), k).toBe(true);
  });
  it('rejects letters, Space and anything with a modifier or out of range', () => {
    for (const k of ['A', 'Space', 'Enter', 'Ctrl+Insert', 'F25', 'F0', '', 'Insert Insert']) expect(isBareKey(k), k).toBe(false);
    expect(isBareKey(undefined)).toBe(false);
    expect(isBareKey(8)).toBe(false);
  });
});

describe('validateDevice', () => {
  it('accepts a bare key for capture but not for toggle or startPause', () => {
    const d = dev();
    expect(validateDevice({ ...d, shortcuts: { ...d.shortcuts, capture: 'Insert' } })).toEqual({});
    expect(validateDevice({ ...d, shortcuts: { ...d.shortcuts, capture: 'F8' } })).toEqual({});
    expect(validateDevice({ ...d, shortcuts: { ...d.shortcuts, toggle: 'Insert' } })['shortcuts.toggle']).toBeDefined();
    expect(validateDevice({ ...d, shortcuts: { ...d.shortcuts, startPause: 'F8' } })['shortcuts.startPause']).toBeDefined();
    expect(validateDevice({ ...d, shortcuts: { ...d.shortcuts, capture: 'A' } })['shortcuts.capture']).toBeDefined();
  });
  it('validates the notepad position and the recent count (0..3)', () => {
    const d = dev();
    for (const position of ['top-right', 'top-left', 'centre', 'cursor'] as const) expect(validateDevice({ ...d, notepad: { ...d.notepad, position } }), position).toEqual({});
    expect(validateDevice({ ...d, notepad: { ...d.notepad, position: 'middle' as never } }).notepad).toBeDefined();
    for (const recent of [0, 1, 2, 3]) expect(validateDevice({ ...d, notepad: { ...d.notepad, recent } }), String(recent)).toEqual({});
    for (const recent of [-1, 4, 1.5, '2' as never]) expect(validateDevice({ ...d, notepad: { ...d.notepad, recent } }).notepad, String(recent)).toBeDefined();
    expect(validateDevice({ ...d, notepad: undefined as never }).notepad).toBeDefined();
  });
});

describe('validateSettings (tasks block, pillShowsClass)', () => {
  it('accepts the retention choices 24, 72, 168 and 0, rejects anything else', () => {
    for (const doneRetentionHours of [24, 72, 168, 0]) expect(validateSettings({ ...defaultSettings(), tasks: { doneRetentionHours } }), String(doneRetentionHours)).toEqual({});
    for (const doneRetentionHours of [5, -1, 48, '24' as never]) expect(validateSettings({ ...defaultSettings(), tasks: { doneRetentionHours } }).tasks, String(doneRetentionHours)).toBeDefined();
  });
  it('pillShowsClass must be a boolean when present', () => {
    expect(validateSettings({ ...defaultSettings(), pillShowsClass: true })).toEqual({});
    expect(validateSettings({ ...defaultSettings(), pillShowsClass: 'yes' as never }).pillShowsClass).toBeDefined();
  });
  it('a settings doc from an older build, without tasks or pillShowsClass, still validates', () => {
    const { tasks: _t, pillShowsClass: _p, ...old } = defaultSettings();
    expect(validateSettings(old as unknown as Settings)).toEqual({});
    const rec = fresh().settings.main as unknown as Record<string, unknown>;
    const { tasks: _t2, pillShowsClass: _p2, ...oldRec } = rec;
    expect(recordProblem('settings', oldRec)).toBeNull();
  });
});

describe('recordProblem for tasks', () => {
  const one = (): Record<string, unknown> => ({ ...Object.values(addTask(fresh(), 'Essay').d.tasks)[0]! });
  it('accepts a task from the current build', () => {
    expect(recordProblem('tasks', one())).toBeNull();
  });
  it('accepts a task without labels (a record from an older build)', () => {
    const { labels: _l, ...old } = one();
    expect(recordProblem('tasks', old)).toBeNull();
  });
  it('rejects labels that are not a list of strings', () => {
    expect(recordProblem('tasks', { ...one(), labels: [123] })).toMatch(/labels/);
    expect(recordProblem('tasks', { ...one(), labels: 'school' })).toMatch(/labels/);
    expect(recordProblem('tasks', { ...one(), labels: ['school', 'home'] })).toBeNull();
  });
});

describe('blockFits', () => {
  const ev = { title: 'Physics', tagId: null, scope: 'school' as const, tz: 'Asia/Jakarta', startMin: 600, endMin: 660, date: TODAY, recur: null, notes: '' };
  it('allows a block over a fixed event, but not over another block', () => {
    let { d, id } = addTask(fresh(), 'Essay');
    d = run(d, { type: 'event.create', input: ev }).d;
    expect(blockFits(d, TODAY, 630, 700)).toBe(true);
    expect(blockFits(d, TODAY, 600, 660)).toBe(true);
    const b = run(d, { type: 'block.create', taskId: id, date: TODAY, startMin: 660, endMin: 720 });
    d = b.d;
    expect(blockFits(d, TODAY, 690, 750)).toBe(false);
    expect(blockFits(d, TODAY, 630, 700)).toBe(false);
    expect(blockFits(d, TODAY, 660, 720)).toBe(false);
    // touching edges and other days are fine; the block may overlap its own old place
    expect(blockFits(d, TODAY, 720, 780)).toBe(true);
    expect(blockFits(d, TODAY, 600, 660)).toBe(true);
    expect(blockFits(d, '2026-10-27', 690, 750)).toBe(true);
    expect(blockFits(d, TODAY, 690, 750, b.id)).toBe(true);
  });
  it('rejects empty, reversed and out-of-day spans', () => {
    const d = fresh();
    expect(blockFits(d, TODAY, 600, 600)).toBe(false);
    expect(blockFits(d, TODAY, 700, 600)).toBe(false);
    expect(blockFits(d, TODAY, -5, 60)).toBe(false);
    expect(blockFits(d, TODAY, 1400, 1500)).toBe(false);
    expect(blockFits(d, TODAY, 600.5, 700)).toBe(false);
  });
});
