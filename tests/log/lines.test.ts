// Auto-add vs chip thresholds, tick sync between card line and task.
import { describe, expect, it } from 'vitest';
import { autoLines, analyzeBody, classifyLine, decodeLinks, encodeLink, encodeLinks, hasTaskPrefix, MAX_AUTO_LINES, relink, tickCommand, tickState, stripPrefix } from '../../src/core/log';
import { apply } from '../../src/core/commands';
import { isId } from '../../src/core/model/ids';
import { fixtureContext } from '../parser/helpers';
import { addTask, ctx, fresh, run } from '../helpers';

const pc = fixtureContext();
const kind = (t: string) => classifyLine(t, pc).kind;

describe('auto-add vs chip thresholds', () => {
  it('explicit prefixes are auto-added', () => {
    expect(kind('- call mom')).toBe('task');
    expect(kind('[] buy milk')).toBe('task');
    expect(kind('[ ] buy milk')).toBe('task');
    expect(kind('- [ ] buy milk')).toBe('task');
    expect(kind('task finish report')).toBe('task');
    // even a sentence-like line is a task when the user marks it
    expect(kind('- I think this might work out')).toBe('task');
  });
  it('a task keyword plus a date or time is auto-added', () => {
    const l = classifyLine('call mom tomorrow 5pm', pc);
    expect(l.kind).toBe('task');
    expect(l.input?.dueDate).toBe('2026-11-12');
    expect(kind('finish the report by friday')).toBe('task');
  });
  it('a task-looking line without a date or time is only a chip', () => {
    expect(kind('email Sarah')).toBe('chip');
    expect(kind('math hw')).toBe('chip');
  });
  it('plain prose and low-confidence lines stay text', () => {
    expect(kind('I think we should try a different approach')).toBe('text');
    expect(kind('had a good session today')).toBe('text');
    expect(kind('')).toBe('text');
    expect(kind('-')).toBe('text');
    expect(kind('- ')).toBe('text');
  });
  it('strips the prefix and keeps parsed fields', () => {
    expect(stripPrefix('- [ ] x')).toEqual({ body: 'x', explicit: true });
    expect(stripPrefix('task  x')).toEqual({ body: 'x', explicit: true });
    expect(stripPrefix('taskforce x').explicit).toBe(false);
    const l = classifyLine('- gym 4pm', pc, 'p1');
    expect(l.input).toMatchObject({ source: 'parsed', projectId: 'p1' });
    expect(l.input?.dueTime).toBe(16 * 60);
  });
  it('analyzes a whole post and caps auto lines', () => {
    const lines = analyzeBody('Check-in: tired\n- call mom\nemail Sarah\n\n[] buy milk', pc);
    expect(lines.map((l) => l.kind)).toEqual(['text', 'task', 'chip', 'text', 'task']);
    expect(autoLines(lines).map((l) => l.index)).toEqual([1, 4]);
    const many = analyzeBody(Array.from({ length: 40 }, (_, i) => `- t${i}`).join('\n'), pc);
    expect(autoLines(many)).toHaveLength(MAX_AUTO_LINES);
  });
  it('hasTaskPrefix is a cheap check for is:task', () => {
    expect(hasTaskPrefix('hello\n- a')).toBe(true);
    expect(hasTaskPrefix('hello\n- ')).toBe(false);
    expect(hasTaskPrefix('hello')).toBe(false);
  });
});

describe('line <-> task links', () => {
  it('round-trips and is valid under the id rules', () => {
    const e = encodeLink(3, 'abc-123:2026-11-01');
    expect(isId(e)).toBe(true);
    expect([...decodeLinks([e, 'plain-id'])]).toEqual([[3, 'abc-123:2026-11-01']]);
    expect(encodeLinks(new Map([[2, 'b'], [0, 'a']]), ['plain', 'L9:old'])).toEqual(['plain', 'L0:a', 'L2:b']);
  });
  const isTask = (l: string) => stripPrefix(l).explicit;
  it('a link follows its line when lines are inserted above', () => {
    const out = relink('a\n- call mom', 'new\na\n- call mom', new Map([[1, 't1']]), isTask);
    expect([...out]).toEqual([[2, 't1']]);
  });
  it('keeps the link when the task line is edited in place, drops it when the line stops being a task', () => {
    expect([...relink('- call mom', '- call mom tonight', new Map([[0, 't1']]), isTask)]).toEqual([[0, 't1']]);
    expect(relink('- call mom', 'call mom', new Map([[0, 't1']]), isTask).size).toBe(0);
    expect(relink('- call mom', '', new Map([[0, 't1']]), isTask).size).toBe(0);
  });
  it('two identical lines keep distinct links', () => {
    const out = relink('- x\n- x', '- x\n- x', new Map([[0, 'a'], [1, 'b']]), isTask);
    expect([...out]).toEqual([[0, 'a'], [1, 'b']]);
  });
});

describe('tick sync between card and task', () => {
  it('ticking the line finishes the task; unticking reopens it; the card state follows the task', () => {
    const t = addTask(fresh(), 'Call mom');
    let d = t.d;
    expect(tickState(d.tasks[t.id])).toBe('open');
    const c1 = tickCommand(d.tasks[t.id]!)!;
    expect(c1.type).toBe('task.finish');
    d = run(d, c1).d;
    expect(tickState(d.tasks[t.id])).toBe('done');
    const c2 = tickCommand(d.tasks[t.id]!)!;
    expect(c2.type).toBe('task.reopen');
    d = run(d, c2).d;
    expect(tickState(d.tasks[t.id])).toBe('open');
  });
  it('finishing the task elsewhere (Focus) ticks the line with no write to the note', () => {
    const t = addTask(fresh(), 'Call mom');
    const n = run(t.d, { type: 'idea.add', text: '- Call mom', taskId: null });
    const linked = run(n.d, { type: 'idea.edit', id: n.id, parsedTaskIds: [encodeLink(0, t.id)] });
    const before = linked.d.ideas[n.id];
    const after = run(linked.d, { type: 'task.finish', id: t.id }).d;
    expect(after.ideas[n.id]).toBe(before);
    expect(tickState(after.tasks[decodeLinks(after.ideas[n.id]!.parsedTaskIds).get(0)!])).toBe('done');
  });
  it('a recycled or dropped task has no checkbox action', () => {
    const t = addTask(fresh(), 'x');
    const gone = run(t.d, { type: 'recycle', coll: 'tasks', id: t.id, confirmed: true }).d;
    expect(tickState(gone.tasks[t.id])).toBe('gone');
    expect(tickCommand(gone.tasks[t.id]!)).toBeNull();
    expect(tickState(undefined)).toBe('gone');
    const dropped = run(t.d, { type: 'task.close', id: t.id, reason: 'not needed' }).d;
    expect(tickState(dropped.tasks[t.id])).toBe('gone');
  });
  it('idea.edit validates its input', () => {
    const n = run(fresh(), { type: 'idea.add', text: 'hello', taskId: null });
    expect(apply(n.d, { type: 'idea.edit', id: n.id, body: '  ' }, ctx()).ok).toBe(false);
    expect(apply(n.d, { type: 'idea.edit', id: n.id, parsedTaskIds: ['bad id!'] }, ctx()).ok).toBe(false);
    expect(apply(n.d, { type: 'idea.edit', id: n.id, projectId: 'nope' }, ctx()).ok).toBe(false);
    const ok = run(n.d, { type: 'idea.edit', id: n.id, body: 'hello world' });
    expect(ok.d.ideas[n.id]).toMatchObject({ body: 'hello world', text: 'hello world' });
  });
});
