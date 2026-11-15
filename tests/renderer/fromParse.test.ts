import { describe, expect, it } from 'vitest';
import { apply } from '../../src/core/commands';
import { chipsOf, commandFromParse, dateLabel, parseLine } from '../../src/renderer/palette/fromParse';
import { ctx, fresh, T0 } from '../helpers';

const d = fresh();
const line = (t: string, mode: 'quick' | 'notepad' = 'quick') => parseLine(t, d, T0, 'user', mode);

describe('commandFromParse', () => {
  it('a task parse becomes a valid task.create with the parsed fields', () => {
    const r = line('finish the physics essay tomorrow 45m');
    const cmd = commandFromParse(r, d, T0)!;
    expect(cmd.type).toBe('task.create');
    expect(cmd).toMatchObject({ input: { title: 'finish the physics essay', dueDate: '2026-10-27', estimateMin: 45, source: 'parsed' } });
    expect(apply(d, cmd, ctx()).ok).toBe(true);
  });

  it('a fixed parse becomes a valid event, or a task when forced', () => {
    const r = line('padel tomorrow 4pm to 6pm');
    expect(r.kind).toBe('fixed');
    const cmd = commandFromParse(r, d, T0)!;
    expect(cmd).toMatchObject({ type: 'event.create', input: { startMin: 960, endMin: 1080, date: '2026-10-27' } });
    expect(apply(d, cmd, ctx()).ok).toBe(true);
    expect(commandFromParse(r, d, T0, true)!.type).toBe('task.create');
  });

  it('notepad mode: only prefixed lines are tasks; plain lines stay notes', () => {
    expect(line('thinking about the curve', 'notepad').kind).toBe('note');
    expect(line('- send the datasheet tomorrow', 'notepad').kind).toBe('task');
  });

  it('empty titles make no command; chips describe the parse', () => {
    expect(commandFromParse({ ...line('x'), title: ' ' }, d, T0)).toBeNull();
    const chips = chipsOf(line('essay tomorrow 45m'), d).map((c) => c.label);
    expect(chips).toContain('Task');
    expect(chips).toContain('45m');
    expect(dateLabel('2026-11-12')).toBe('Thu 12 Nov');
  });
});
