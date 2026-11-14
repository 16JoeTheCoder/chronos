// add_task `text` (D-144): parsed with source 'claude'; only a confident task is written, anything else is returned for confirmation.
import { describe, expect, it } from 'vitest';
import { apply, type Command } from '../../src/core/commands';
import { Mcp, type StorePort } from '../../src/core/mcp/handlers';
import type { Data } from '../../src/core/model/types';
import { live } from '../../src/core/repo/repo';
import { parse } from '../../src/core/parser';
import { ctx, fresh, T0 } from '../helpers';

type Any = Record<string, any>;

function rig(withParser = true) {
  const st = { d: fresh() as Data };
  const seen: string[] = [];
  const port: StorePort = {
    data: () => st.d,
    now: () => T0,
    run: (cmd: Command) => {
      const r = apply(st.d, cmd, ctx(T0, 'mcp'));
      if (!r.ok) return { ok: false, error: r.error };
      st.d = r.d;
      return { ok: true, id: r.id };
    },
    ...(withParser ? { parse: (t: string, c: Parameters<typeof parse>[1]) => (seen.push(c.source ?? ''), parse(t, c)) } : {}),
  };
  const mcp = new Mcp(port);
  const call = (args: Any) => {
    const r = mcp.call('add_task', args);
    return r.ok ? { ok: true as const, ...(r.result as Any) } : { ok: false as const, error: r.error };
  };
  return { st, seen, call };
}

describe('add_task text', () => {
  it('a confident task is written with source claude and the parsed fields', () => {
    const r = rig();
    const res = r.call({ text: 'finish the physics essay tomorrow 45m !!' });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(res.added).not.toBe(false);
    const t = live(r.st.d, 'tasks')[0]!;
    expect(t.source).toBe('claude');
    expect(t.dueDate).toBe('2026-10-27');
    expect(t.estimateMin).toBe(45);
    expect(r.seen).toEqual(['claude']);
  });

  it('an unsure or non-task parse writes nothing and returns the parse', () => {
    const r = rig();
    const res = r.call({ text: 'padel tomorrow 4pm to 6pm' });
    expect(res.ok).toBe(true);
    expect(res).toMatchObject({ added: false, needsConfirmation: true });
    expect((res as Any).parse.kind).toBe('fixed');
    expect(live(r.st.d, 'tasks')).toHaveLength(0);
  });

  it('explicit fields beat the parse; title or text is required; no parser = refused', () => {
    const r = rig();
    r.call({ text: 'write the report tomorrow', dueDate: '2026-11-01' });
    const t = live(r.st.d, 'tasks')[0];
    if (t) expect(t.dueDate).toBe('2026-11-01');
    expect(r.call({})).toMatchObject({ ok: false });
    expect(rig(false).call({ text: 'write the report' })).toMatchObject({ ok: false });
    expect(rig(false).call({ title: 'plain still works' })).toMatchObject({ ok: true });
  });
});
