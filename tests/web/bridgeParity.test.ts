// Bridge parity: renderer helpers run against the fake bridge, and no renderer file reaches window.chronos
// (the same rule scripts/audit.mjs enforces).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { paletteCommands } from '../../src/renderer/palette/commands';
import { needsSignIn } from '../../src/renderer/signin/logic';
import { settingsSections } from '../../src/renderer/settings/sections';
import { fakeBridge } from '../renderer/fakeBridge';

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));

describe('no window.chronos in the renderer', () => {
  it('src/renderer reaches the platform only through getBridge()', () => {
    const bad = walk('src/renderer').filter((f) => /window\.chronos\b/.test(fs.readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});

describe('renderer helpers against the fake bridge', () => {
  it('settings sections follow the capability flags', () => {
    const web = fakeBridge({ platform: 'web' });
    const desk = fakeBridge({ platform: 'electron', web: null });
    expect(settingsSections(desk.can).find((s) => s.id === 'tasks')!.label).not.toBe(settingsSections(web.can).find((s) => s.id === 'tasks')!.label);
    expect(paletteCommands(web.data, '', [], web.can.askClaude).some((c) => /ask claude/i.test(c.label))).toBe(false);
  });

  it('sign-in is required only for a configured, signed-out, non-local web session', () => {
    const b = fakeBridge({ platform: 'web' });
    expect(needsSignIn(b.web, 'signedOut')).toBe(true);
    b.web!.continueLocal();
    expect(needsSignIn(b.web, 'signedOut')).toBe(false);
    expect(needsSignIn(null, 'signedOut')).toBe(false);
  });

  it('commands run through the real core and show up in the snapshot', async () => {
    const b = fakeBridge();
    const r = await b.command({ type: 'task.create', input: { title: 'Parity', finishCondition: 'Seen' } });
    expect(r.ok).toBe(true);
    expect(Object.values((await b.getSnapshot()).data.tasks).map((t) => t.title)).toEqual(['Parity']);
    expect(b.commands).toHaveLength(1);
  });
});
