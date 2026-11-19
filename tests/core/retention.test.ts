// Done-task retention (Phase 3.7): the controller's housekeeping recycles done tasks after the window.
// Uses a real Controller on a temp folder, rebooted at a later "now" (init runs housekeeping), plus the pure pieces.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Data } from '../../src/core/model/types';
import { Controller } from '../../src/main/controller';
import { Store } from '../../src/main/store';
import { HOUR, T0 } from '../helpers';

let dir: string;
let controllers: Controller[];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronos-retention-'));
  controllers = [];
});
afterEach(() => {
  for (const c of controllers) {
    c.stopSync();
    c.flush();
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

function boot(now: number): Controller {
  const c = new Controller(new Store(dir), { onChange() {}, onNotify() {}, onGap() {}, onDeviceChanged() {} }, { deviceName: 'PC', monolithFile: path.join(dir, 'missing.json') });
  controllers.push(c);
  c.init(now);
  return c;
}
const cmd = (c: Controller, command: Parameters<Controller['command']>[0], now: number) => {
  const r = c.command(command, now);
  if (!r.ok) throw new Error(`${command.type}: ${JSON.stringify(r)}`);
  return r.id as string;
};

/** Three done tasks (25 h and 1 h before NOW) and one open one, written by a first controller, then reloaded at NOW. */
function world(retentionHours?: number) {
  const NOW = T0 + 40 * HOUR;
  const c1 = boot(T0);
  if (retentionHours !== undefined) cmd(c1, { type: 'settings.update', patch: { tasks: { doneRetentionHours: retentionHours } } }, T0);
  const old = cmd(c1, { type: 'task.create', input: { title: 'Old done' } }, T0);
  const recent = cmd(c1, { type: 'task.create', input: { title: 'Recent done' } }, T0);
  const open = cmd(c1, { type: 'task.create', input: { title: 'Still open' } }, T0);
  cmd(c1, { type: 'task.finish', id: old }, NOW - 25 * HOUR);
  cmd(c1, { type: 'task.finish', id: recent }, NOW - HOUR);
  c1.stopSync();
  c1.flush();
  controllers.pop();
  // reboot "later": init() runs housekeeping at NOW
  const c2 = boot(NOW);
  return { c: c2, old, recent, open, NOW };
}
const gone = (d: Data, id: string) => d.tasks[id]!.deletedAt !== null;

describe('Controller housekeeping and the done-task window', () => {
  it('default settings (24 h): a task done 25 h ago is recycled, one done 1 h ago stays', () => {
    const { c, old, recent, open } = world();
    expect(gone(c.data, old)).toBe(true);
    expect(gone(c.data, recent)).toBe(false);
    expect(c.data.tasks[recent]!.status).toBe('done');
    expect(gone(c.data, open)).toBe(false);
  });

  it('doneRetentionHours = 0 keeps everything', () => {
    const { c, old, recent, open } = world(0);
    expect(gone(c.data, old)).toBe(false);
    expect(gone(c.data, recent)).toBe(false);
    expect(gone(c.data, open)).toBe(false);
    expect(c.data.tasks[old]!.status).toBe('done');
  });

  it('a longer window (72 h) keeps the 25 h old task', () => {
    const { c, old } = world(72);
    expect(gone(c.data, old)).toBe(false);
  });

  it('a recycled done task is restorable (soft delete, not a purge)', () => {
    const { c, old, NOW } = world();
    expect(gone(c.data, old)).toBe(true);
    cmd(c, { type: 'restore', coll: 'tasks', id: old }, NOW + 1);
    expect(gone(c.data, old)).toBe(false);
  });
});
