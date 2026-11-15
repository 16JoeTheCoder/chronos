import { describe, expect, it } from 'vitest';
import { buildParseContext } from '../../src/core/parseContext';
import { fresh, run, T0 } from '../helpers';

describe('buildParseContext', () => {
  it('carries zone, day window, tags, projects and user rules (legacy shape too)', () => {
    let d = run(fresh(), { type: 'tag.create', input: { name: 'Math', color: 'tag1', kind: 'class' } }).d;
    d = run(d, { type: 'project.create', name: 'Chronos' }).d;
    d = run(d, { type: 'settings.update', patch: { parserRules: [{ id: 'u1', match: 'lab', kind: 'fixed', source: 'user' }, { keyword: 'quiz', kind: 'fixed' } as never] } }).d;
    const c = buildParseContext(d, T0, 'notepad', { mode: 'notepad' });
    expect(c.source).toBe('notepad');
    expect(c.mode).toBe('notepad');
    expect(c.timeZone).toBe('Asia/Jakarta');
    expect(c.tags.map((t) => t.name)).toEqual(['Math']);
    expect(c.projects.map((p) => p.name)).toEqual(['Chronos']);
    expect(c.rules.map((r) => r.match)).toEqual(['lab', 'quiz']);
    expect(c.now.getTime()).toBe(T0);
  });
});
