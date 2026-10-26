// Main-process controller + store (ported from Monolith): persistence, .bak
// fallback, debounced saves, crash/sleep/clock-jump recovery, device settings.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Controller, type Notice } from '../../src/main/controller';
import { Store } from '../../src/main/store';
import { activeTask } from '../../src/core/tasks/tasks';
import { live } from '../../src/core/repo/repo';
import { MIN, SEC, T0 } from '../helpers';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronos-'));
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

function boot(now: number, notices: Notice[] = []): Controller {
  const c = new Controller(new Store(dir), { onChange() {}, onNotify: (n) => notices.push(n), onGap() {}, onDeviceChanged() {} }, { deviceName: 'PC', monolithFile: path.join(dir, 'missing.json') });
  c.init(now);
  return c;
}

function runningTask(mode: 'stopwatch' | 'countdown' = 'stopwatch'): Controller {
  const c = boot(T0);
  const timer = { ...c.data.settings.main!.timerDefaults, mode };
  expect(c.command({ type: 'task.create', input: { title: 'Write report', finishCondition: 'Report sent to the client', estimateMin: 12, timer } }, T0).ok).toBe(true);
  expect(c.command({ type: 'timer', action: 'start' }, T0).ok).toBe(true);
  return c;
}

describe('store', () => {
  it('writes atomically, keeps a .bak and falls back to it when the main file is corrupt', () => {
    const store = new Store(dir);
    store.data.save({ schema: 1, n: 1 });
    store.data.save({ schema: 1, n: 2 });
    expect(fs.existsSync(store.data.tmp)).toBe(false);
    expect(JSON.parse(fs.readFileSync(store.data.bak, 'utf8')).n).toBe(1);
    fs.writeFileSync(store.data.file, '{ not json');
    expect(store.data.load()).toEqual({ schema: 1, n: 1 });
  });
});

describe('persistence', () => {
  it('round-trips data and keeps a stable device id in device.json', () => {
    const c = runningTask();
    const again = boot(T0 + 2 * SEC);
    expect(live(again.data, 'tasks')).toHaveLength(1);
    expect(again.device.deviceId).toBe(c.device.deviceId);
    expect(again.pendingGap).toBeNull();
    expect(activeTask(again.data)?.runtime.status).toBe('running'); // small gap: seamless
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'chronos-data.json'), 'utf8')).device).toBeUndefined();
  });

  it('debounces planning edits by 300 ms and flushes on quit', () => {
    vi.useFakeTimers();
    const c = boot(T0);
    c.command({ type: 'tag.create', input: { name: 'Physics', color: 'tag1', kind: 'class' } }, T0);
    expect(fs.readFileSync(path.join(dir, 'chronos-data.json'), 'utf8')).not.toContain('Physics');
    vi.advanceTimersByTime(300);
    expect(fs.readFileSync(path.join(dir, 'chronos-data.json'), 'utf8')).toContain('Physics');
    c.command({ type: 'tag.create', input: { name: 'Maths', color: 'tag2', kind: 'class' } }, T0);
    c.shutdown(T0);
    expect(fs.readFileSync(path.join(dir, 'chronos-data.json'), 'utf8')).toContain('Maths');
  });

  it('seeds holidays on first run', () => {
    const c = boot(T0);
    expect(live(c.data, 'closures').length).toBeGreaterThanOrEqual(14);
  });
});

describe('restart with a running timer', () => {
  it('pauses at the last heartbeat; discard keeps only observed time', () => {
    runningTask();
    new Store(dir).writeHeartbeat(T0 + MIN);
    const c = boot(T0 + 30 * MIN);
    expect(c.pendingGap).toEqual({ from: T0 + MIN, to: T0 + 30 * MIN, reason: 'off' });
    expect(c.command({ type: 'timer', action: 'start' }, T0 + 30 * MIN).ok).toBe(false);
    expect(c.command({ type: 'gap.answer', count: false }, T0 + 30 * MIN).ok).toBe(true);
    const t = activeTask(c.data)!;
    expect(t.workMs).toBe(MIN);
    expect(t.runtime.status).toBe('paused');
    expect(live(c.data, 'sessions')).toHaveLength(1);
  });

  it('count credits the gap and stays paused', () => {
    runningTask();
    new Store(dir).writeHeartbeat(T0 + MIN);
    const c = boot(T0 + 30 * MIN);
    c.command({ type: 'gap.answer', count: true }, T0 + 31 * MIN);
    const t = activeTask(c.data)!;
    expect(t.workMs).toBe(30 * MIN);
    expect(t.runtime.status).toBe('paused');
    expect(c.pendingGap).toBeNull();
  });
});

describe('runtime ticks and power events', () => {
  it('a long pause between ticks raises a gap; a backwards clock never goes negative', () => {
    const c = runningTask();
    c.tick(T0 + 250);
    c.tick(T0 - 5 * MIN); // clock jumped back
    let t = activeTask(c.data)!;
    expect(t.workMs).toBe(250);
    expect(t.runtime.sliceStartedAt).toBe(T0 - 5 * MIN);
    c.tick(T0 - 5 * MIN + SEC);
    c.tick(T0 + 20 * MIN); // far more than 10 s later
    t = activeTask(c.data)!;
    expect(c.pendingGap?.from).toBe(T0 - 5 * MIN + SEC);
    expect(t.runtime.status).toBe('paused');
    expect(t.workMs).toBe(250 + SEC);
  });

  it('suspend pauses at that moment; resume raises a gap', () => {
    const c = runningTask();
    c.suspend(T0 + 10 * MIN);
    expect(activeTask(c.data)?.runtime.status).toBe('paused');
    c.resume(T0 + 70 * MIN);
    expect(c.pendingGap).toEqual({ from: T0 + 10 * MIN, to: T0 + 70 * MIN, reason: 'sleep' });
    expect(c.toggleStartPause(T0 + 70 * MIN).ok).toBe(false);
  });

  it('notifies once per sprint checkpoint', () => {
    const notices: Notice[] = [];
    const c = boot(T0, notices);
    c.command({ type: 'task.create', input: { kind: 'sprint', title: 'Proto', finishCondition: 'Demo runs end to end', checkpointEveryMin: 15 } }, T0);
    c.command({ type: 'timer', action: 'start' }, T0);
    for (let t = T0; t <= T0 + 16 * MIN; t += 5 * SEC) c.tick(t);
    expect(notices.filter((n) => n.title === 'Sprint checkpoint')).toHaveLength(1);
  });
});

describe('device settings and import', () => {
  it('validates device patches and keeps them out of synced data', () => {
    const c = boot(T0);
    expect(c.command({ type: 'device.update', patch: { shortcuts: { toggle: 'Ctrl+Alt+Space', startPause: 'Ctrl+Alt+Space', capture: 'Ctrl+Alt+N' } } }, T0).ok).toBe(false);
    expect(c.command({ type: 'device.update', patch: { widgetDock: 'free' } }, T0).ok).toBe(true);
    expect(boot(T0).device.widgetDock).toBe('free');
  });

  it('reports a missing Monolith file and imports an existing one', () => {
    const c = boot(T0);
    expect(c.command({ type: 'data.import', source: 'monolith' }, T0).ok).toBe(false);
    const file = path.join(dir, 'monolith.json');
    fs.writeFileSync(file, JSON.stringify({ version: 2, tasks: [{ id: 'a', name: 'Old', finishCondition: 'Old task is done', status: 'queued' }] }));
    const c2 = new Controller(new Store(dir), undefined, { deviceName: 'PC', monolithFile: file });
    c2.init(T0);
    expect(c2.command({ type: 'data.import', source: 'monolith' }, T0)).toEqual({ ok: true, id: '1' });
  });
});
