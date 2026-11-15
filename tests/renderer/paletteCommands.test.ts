// ">" commands: navigate, timer, plan, re-plan, switch project, switch theme, report misparse.
import { describe, expect, it } from 'vitest';
import { apply } from '../../src/core/commands';
import { paletteCommands } from '../../src/renderer/palette/commands';
import { ctx, fresh } from '../helpers';

const themes = [{ id: 'tactile-instrument', name: 'Tactile instrument' }, { id: 'pit-wall', name: 'Pit wall' }];

describe('palette > commands', () => {
  it('lists navigation, timer, planning, themes and misparse with an empty needle', () => {
    const keys = paletteCommands(fresh(), '', themes).map((c) => c.key);
    for (const k of ['go:home', 'go:board', 'go:log', 'go:settings', 'timer', 'plan', 'replan', 'theme:pit-wall', 'misparse']) expect(keys).toContain(k);
  });
  it('filters by every word', () => {
    expect(paletteCommands(fresh(), 'go log', themes).map((c) => c.key)).toEqual(['go:log']);
    expect(paletteCommands(fresh(), 'theme pit', themes)[0]?.action).toEqual({ kind: 'theme', id: 'pit-wall' });
  });
  it('offers each project to switch to', () => {
    const r = apply(fresh(), { type: 'project.create', name: 'Thesis' }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = paletteCommands(r.d, 'thesis', themes);
    expect(c[0]).toMatchObject({ label: 'Switch project: Thesis', action: { kind: 'project' } });
  });
  it('>ask hands the rest to Claude', () => {
    expect(paletteCommands(fresh(), 'ask what next', themes)).toEqual([expect.objectContaining({ action: { kind: 'ask', text: 'what next' } })]);
  });
});
