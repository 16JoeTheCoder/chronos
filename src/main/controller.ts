// The app's state machine (ported from Monolith): owns Data and DeviceSettings,
// runs every command through core, persists, and handles time the app could not
// observe (crash, power off, sleep, clock jumps). No Electron imports: main.ts
// wires it to windows, tray and powerMonitor, and the tests drive it directly.
//
// Gap handling in one sentence: when we discover that time passed while we were
// not watching, we stop the clock at the last moment we *know* we were alive
// and ask the user whether the unobserved stretch should count.

import fs from 'node:fs';
import { apply, type Command, type Result } from '../core/commands';
import { defaultDevice, emptyData } from '../core/model/defaults';
import { newId } from '../core/model/ids';
import type { Data, DeviceSettings, Gap, Slice, Task, TimerEvent } from '../core/model/types';
import { fromMonolith, migrate } from '../core/repo/migrate';
import { purge } from '../core/repo/recycle';
import { settingsOf, update, type Ctx } from '../core/repo/repo';
import { checkpointDue } from '../core/tasks/sprints';
import { activeTask, blockSpan, blocksOn, normalize, ownsTimer, recordSlices, todayOf } from '../core/tasks/tasks';
import { seedHolidays } from '../core/time/holidays';
import { prepNudges } from '../core/time/prep';
import { localParts } from '../core/time/zone';
import { takeover } from '../core/sync/engine';
import { advance, pauseAt, start } from '../core/timer/timer';
import { isObj, validateDevice } from '../core/validation';
import { clockOf, formatHuman, phaseLabel } from '../core/format';
import type { Store } from './store';

export const HEARTBEAT_MS = 5_000;
export const STARTUP_GAP_MS = 15_000;
export const TICK_GAP_MS = 10_000;
export const SAVE_DEBOUNCE_MS = 300;
export const PURGE_EVERY_MS = 6 * 3_600_000;

export interface Notice {
  title: string;
  body: string;
}

export interface ControllerHooks {
  onChange(): void;
  onNotify(n: Notice): void;
  onGap(): void;
  onDeviceChanged(prev: DeviceSettings, next: DeviceSettings): void;
}

const noHooks: ControllerHooks = { onChange() {}, onNotify() {}, onGap() {}, onDeviceChanged() {} };

export interface ControllerOptions {
  deviceName: string;
  /** %APPDATA%\Monolith\monolith-data.json, read only on explicit import. */
  monolithFile: string;
}

export class Controller {
  data: Data = emptyData();
  device: DeviceSettings;
  pendingGap: Gap | null = null;
  private gapTaskId: string | null = null;
  private lastTick = 0;
  private lastHeartbeat = 0;
  private lastSlow = 0;
  private lastPurge = 0;
  private suspendedAt: number | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Dedupe keys for notifications already shown this run (prep nudges, checkpoints). */
  private notified = new Set<string>();

  constructor(private store: Store, private hooks: ControllerHooks = noHooks, private opts: ControllerOptions = { deviceName: 'This PC', monolithFile: '' }) {
    this.device = defaultDevice(newId(), opts.deviceName);
  }

  private ctx(now: number): Ctx & { deviceName: string } {
    return { now, deviceId: this.device.deviceId, deviceName: this.device.deviceName };
  }

  /** Load from disk, seed and purge, then recover a timer that was running when the app last died. */
  init(now: number): void {
    const rawDevice = this.store.device.load();
    const base = defaultDevice(isObj(rawDevice) && typeof rawDevice.deviceId === 'string' ? rawDevice.deviceId : newId(), this.opts.deviceName);
    const merged = { ...base, ...(isObj(rawDevice) ? rawDevice : {}), deviceName: this.opts.deviceName } as DeviceSettings;
    this.device = Object.keys(validateDevice(merged)).length ? base : merged;
    this.store.device.save(this.device);

    this.data = migrate(this.store.data.load()) ?? emptyData();
    this.housekeeping(now);
    this.lastTick = now;
    this.lastSlow = now;
    const task = activeTask(this.data);
    const rt = task?.runtime;
    if (task && rt && rt.status === 'running' && rt.sliceStartedAt !== null && ownsTimer(this.data, this.device.deviceId)) {
      const lastAlive = Math.max(this.store.readHeartbeat() ?? 0, rt.sliceStartedAt);
      if (now < lastAlive) {
        // Clock is behind what we recorded: keep what we had, restart from now.
        this.restartAt(task, lastAlive, now);
      } else if (now - lastAlive > STARTUP_GAP_MS) {
        this.pauseWithGap(task, lastAlive, { from: lastAlive, to: now, reason: 'off' }, now);
      }
      // Smaller gaps: keep running seamlessly; the slice simply covers the restart.
    }
    this.save(true);
  }

  /** Seed holidays, purge old tombstones, keep the active task right for today. */
  private housekeeping(now: number): void {
    const ctx = this.ctx(now);
    let d = this.data;
    if (settingsOf(d).holidaysEnabled) d = seedHolidays(d, localParts(now, settingsOf(d).timezone).year, ctx);
    if (now - this.lastPurge >= PURGE_EVERY_MS) {
      d = purge(d, now, ctx.deviceId);
      this.lastPurge = now;
    }
    d = normalize(d, ctx);
    if (d !== this.data) {
      this.data = d;
      this.save(false);
    }
  }

  get running(): boolean {
    return activeTask(this.data)?.runtime.status === 'running';
  }

  /** Fast tick (main runs it every 250 ms only while a timer runs). Detects jumps, processes boundaries, heartbeats. */
  tick(now: number): void {
    const prev = this.lastTick;
    this.lastTick = now;
    const task = activeTask(this.data);
    if (!task || task.runtime.status !== 'running' || !ownsTimer(this.data, this.device.deviceId)) return;

    if (now < prev) {
      // Clock moved backwards: bank what we had up to the last tick, then restart.
      this.restartAt(task, prev, now);
      this.changed(true);
      return;
    }
    if (now - prev > TICK_GAP_MS) {
      // We were not scheduled for a while (sleep, suspension, forward jump).
      this.pauseWithGap(task, prev, { from: prev, to: now, reason: 'sleep' }, now);
      this.changed(true);
      this.hooks.onGap();
      return;
    }
    const s = advance(task, now);
    if (s.events.length || s.task.runtime.status !== task.runtime.status) {
      this.replace(s.task, s.slices, now);
      this.notifyTimer(s.events);
      this.changed(true);
    }
    if (checkpointDue(task, now)) this.notifyOnce(`cp:${task.id}:${task.nextCheckpointMs}`, { title: 'Sprint checkpoint', body: `${formatHuman(task.workMs)} into ${task.title}. Continue, ship or kill?` });
    if (now - this.lastHeartbeat >= HEARTBEAT_MS) {
      this.lastHeartbeat = now;
      this.store.writeHeartbeat(now);
    }
  }

  /** Slow tick (every 30 s): block ends, prep nudges, day rollover, holidays, purge. */
  slowTick(now: number): void {
    const from = this.lastSlow;
    this.lastSlow = now;
    const s = settingsOf(this.data);
    for (const b of blocksOn(this.data, todayOf(this.data, now))) {
      const end = blockSpan(b)[1];
      if (end > from && end <= now) this.notifyOnce(`blk:${b.id}:${end}`, { title: 'Block ended', body: `${b.title} · ${clockOf(end, s.timezone)}` });
    }
    for (const n of prepNudges(this.data, now)) {
      if (n.instance.start - s.prepLeadMin * 60_000 > now) continue;
      const body = `${n.task.title} before ${n.instance.event.title} ${clockOf(n.instance.start, n.instance.event.tz)} · needs ${n.needsMin}m, ${n.freeBeforeMin}m free`;
      this.notifyOnce(`prep:${n.key}`, { title: n.tight ? 'Tight before class' : 'Before class', body });
    }
    const before = this.data;
    this.housekeeping(now);
    if (this.data !== before) this.hooks.onChange();
  }

  /** powerMonitor 'suspend': stop at this exact moment. */
  suspend(now: number): void {
    const task = activeTask(this.data);
    if (!task || task.runtime.status !== 'running' || !ownsTimer(this.data, this.device.deviceId)) return;
    const s = pauseAt(task, now);
    this.replace(s.task, s.slices, now);
    this.suspendedAt = now;
    this.gapTaskId = task.id;
    this.changed(true);
  }

  /** powerMonitor 'resume': ask whether the sleep should count. */
  resume(now: number): void {
    this.lastTick = now;
    if (this.suspendedAt === null) return;
    this.pendingGap = { from: this.suspendedAt, to: now, reason: 'sleep' };
    this.suspendedAt = null;
    this.hooks.onChange();
    this.hooks.onGap();
  }

  shutdown(now: number): void {
    if (this.running) this.store.writeHeartbeat(now);
    this.flush();
  }

  /** Global shortcut and tray: start or pause the active task. Ignored while a gap prompt is open. */
  toggleStartPause(now: number): Result {
    if (this.pendingGap) return { ok: false, error: 'Answer the time-gap question first.' };
    return this.command({ type: 'timer', action: this.running ? 'pause' : 'start' }, now);
  }

  command(cmd: Command, now: number): Result {
    switch (cmd.type) {
      case 'gap.answer':
        return this.answerGap(cmd.count, now);
      case 'device.update':
        return this.updateDevice(cmd.patch);
      case 'timer.takeover':
        this.data = normalize(takeover(this.data, this.ctx(now)), this.ctx(now));
        this.changed(true);
        return { ok: true };
      case 'data.import':
        return this.importMonolith(now);
      case 'data.export':
      case 'data.openFolder':
        return { ok: false, error: 'Handled by the shell.' };
      default:
        break;
    }
    if (cmd.type === 'timer' && this.pendingGap) return { ok: false, error: 'Answer the time-gap question first.' };
    const res = apply(this.data, cmd, this.ctx(now));
    if (!res.ok) return { ok: false, error: res.error, fields: res.fields };
    this.data = res.d;
    this.notifyTimer(res.events);
    // Timer and session changes persist immediately; planning edits are debounced.
    this.changed(cmd.type === 'timer' || cmd.type.startsWith('task.') || cmd.type === 'sprint.checkpoint');
    return { ok: true, id: res.id };
  }

  /** Recent JSON of everything synced, for Settings → Data → Export. */
  exportJson(): string {
    return JSON.stringify(this.data, null, 2);
  }

  /** Write any debounced change now (quit, tests). */
  flush(): void {
    if (this.saveTimer) this.save(true);
  }

  private importMonolith(now: number): Result {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(this.opts.monolithFile, 'utf8'));
    } catch {
      return { ok: false, error: 'No Monolith data found on this PC.' };
    }
    const r = fromMonolith(this.data, raw, this.ctx(now));
    this.data = normalize(r.d, this.ctx(now));
    this.changed(true);
    return { ok: true, id: String(r.count) };
  }

  private updateDevice(patch: Partial<DeviceSettings>): Result {
    const next = { ...this.device, ...patch, deviceId: this.device.deviceId, sync: this.device.sync };
    const fields = validateDevice(next);
    if (Object.keys(fields).length) return { ok: false, error: 'Please fix the highlighted fields.', fields };
    const prev = this.device;
    this.device = next;
    this.store.device.save(next);
    this.hooks.onDeviceChanged(prev, next);
    this.hooks.onChange();
    return { ok: true };
  }

  /**
   * Count: replay the gap as if the timer had run from `from` to `to`, so
   * Pomodoro boundaries inside it are honoured. Discard: stay paused at the last
   * recorded time. Either way the timer stays paused until the user resumes.
   */
  private answerGap(count: boolean, now: number): Result {
    const gap = this.pendingGap;
    if (!gap) return { ok: false, error: 'There is no time gap to answer.' };
    const task = activeTask(this.data);
    if (count && task && task.id === this.gapTaskId && task.runtime.status === 'paused') {
      const running: Task = { ...task, runtime: { ...task.runtime, status: 'running', sliceStartedAt: gap.from } };
      const s = pauseAt(running, gap.to);
      this.replace(s.task, s.slices, now);
    }
    this.pendingGap = null;
    this.gapTaskId = null;
    this.changed(true);
    return { ok: true };
  }

  private pauseWithGap(task: Task, at: number, gap: Gap, now: number): void {
    const s = pauseAt(task, at);
    this.replace(s.task, s.slices, now);
    if (s.task.runtime.status === 'paused') {
      this.pendingGap = gap;
      this.gapTaskId = task.id;
    }
  }

  /** Bank the slice up to closeAt, then keep running from now. */
  private restartAt(task: Task, closeAt: number, now: number): void {
    const s = pauseAt(task, closeAt);
    this.replace(s.task.runtime.status === 'paused' ? start(s.task, now) : s.task, s.slices, now);
  }

  private replace(task: Task, slices: Slice[], now: number): void {
    const ctx = this.ctx(now);
    this.data = recordSlices(update(this.data, 'tasks', task.id, task, ctx), task.id, slices, ctx);
  }

  private notifyTimer(events: TimerEvent[]): void {
    const last = events.at(-1);
    if (!last) return;
    const name = this.data.tasks[last.taskId]?.title ?? 'Your task';
    if (last.kind === 'countdownExpired') {
      this.hooks.onNotify({ title: "Time's up", body: last.autoStarted ? `${name}: now in overtime.` : `${name}: countdown finished.` });
    } else {
      const label = phaseLabel(last.to);
      this.hooks.onNotify({ title: last.to === 'work' ? 'Break over' : `${label} time`, body: `${name}: ${last.autoStarted ? `${label} started.` : `press Start when you are ready.`}` });
    }
  }

  private notifyOnce(key: string, n: Notice): void {
    if (this.notified.has(key)) return;
    this.notified.add(key);
    this.hooks.onNotify(n);
  }

  private changed(immediate: boolean): void {
    this.save(immediate);
    this.hooks.onChange();
  }

  private save(immediate: boolean): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (immediate) this.store.data.save(this.data);
    else this.saveTimer = setTimeout(() => this.save(true), SAVE_DEBOUNCE_MS);
  }
}
