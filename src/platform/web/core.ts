// What the leader tab runs: the Controller over the IndexedDB store, the sync lifecycle, ticks, command
// routing (the web twin of main.ts's command switch and snapshot()). No DOM access except through deps.

import type { Command, Result, RevertOp } from '../../core/commands';
import { ATTACH_MAX_BYTES, type Diagnostics, type Snapshot, type SyncView } from '../../core/model/types';
import { Controller } from '../../main/controller';
import { TOKEN_RE } from '../../main/parseCommand';
import { UNSUPPORTED } from '../types';
import type { Usage, WebConfig, WebFirebase } from './firebase';
import type { Small } from './kv';
import type { WebStore } from './store';

export const FAST_TICK_MS = 250;
export const SLOW_TICK_MS = 30_000;
export const UNDO_TTL_MS = 60_000;
const UNDO_KEEP = 20;
export const LS_LOCAL = 'chronos.local';
export const LS_PUBLIC = 'chronos.public';
export const ATTACH_MAX = ATTACH_MAX_BYTES;

/** Undo tokens (D-143), web twin of main/undoTokens.ts (that one needs node:crypto). */
export class WebUndo {
  private held = new Map<string, { ops: RevertOp[]; expires: number }>();
  constructor(private now: () => number = Date.now) {}

  hold(ops: RevertOp[]): string {
    this.sweep();
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    this.held.set(token, { ops, expires: this.now() + UNDO_TTL_MS });
    for (const k of [...this.held.keys()].slice(0, Math.max(0, this.held.size - UNDO_KEEP))) this.held.delete(k);
    return token;
  }

  seal(res: Result): Result {
    if (!res.ok || !res.undo) return res;
    const { undo, ...rest } = res;
    return undo.length ? { ...rest, undoToken: this.hold(undo) } : rest;
  }

  redeem(token: unknown): Extract<Command, { type: 'records.revert' }> | null {
    this.sweep();
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
    const u = this.held.get(token);
    if (!u) return null;
    this.held.delete(token);
    return { type: 'records.revert', ops: u.ops };
  }

  private sweep(): void {
    const t = this.now();
    for (const [k, v] of this.held) if (v.expires <= t) this.held.delete(k);
  }
}

export interface CoreDeps {
  store: WebStore;
  small: Small;
  config: WebConfig | null;
  fb: WebFirebase | null;
  version: string;
  deviceName: string;
  usage: Usage;
  perf: () => Record<string, number>;
  /** Snapshot changed: render here, send to follower tabs. */
  emit(s: Snapshot): void;
  beep(): void;
  visible(): boolean;
  /** Delete the IndexedDB database (public-computer sign-out). */
  destroyDb(): Promise<void>;
  reload(): void;
  /** Tests turn the timers off. */
  timers?: boolean;
  now?: () => number;
}

const LOG_KEEP = 200;

export class LeaderCore {
  readonly controller: Controller;
  readonly undo = new WebUndo();
  private who: { uid: string; email: string | null } | null = null;
  private authReady = false;
  private lastError: string | null = null;
  private offAuth: (() => void) | null = null;
  private fast: ReturnType<typeof setInterval> | null = null;
  private slow: ReturnType<typeof setInterval> | null = null;
  private lines: string[] = [];
  private dead = false;
  private readonly now: () => number;

  constructor(private d: CoreDeps) {
    this.now = d.now ?? Date.now;
    this.controller = new Controller(
      d.store,
      {
        onChange: () => this.changed(),
        onNotify: (n) => {
          d.beep();
          this.browserNotice(n.title, n.body);
        },
        onGap: () => undefined,
        onDeviceChanged: () => undefined,
        log: (m) => this.log(m),
      },
      { deviceName: d.deviceName },
    );
    this.controller.init(this.now());
  }

  get local(): boolean {
    return !this.d.config || this.d.small.get(LS_LOCAL) === '1';
  }

  /** Start ticks and (unless local-only) listen for the Google account. */
  start(): void {
    this.reevaluate();
    if (this.d.timers === false) return;
    this.slow = setInterval(() => this.controller.slowTick(this.now()), SLOW_TICK_MS);
    this.refreshTicks();
  }

  /** Local-only flag or account changed (this tab or another): start or stop sync. */
  reevaluate(): void {
    if (this.dead) return;
    if (this.local || !this.d.fb) {
      this.offAuth?.();
      this.offAuth = null;
      this.who = null;
      this.authReady = true;
      this.controller.stopSync();
      this.changed();
      return;
    }
    if (this.offAuth) return;
    this.offAuth = this.d.fb.onUser((who) => void this.userChanged(who));
  }

  private async userChanged(who: { uid: string; email: string | null } | null): Promise<void> {
    this.authReady = true;
    if (this.dead) return;
    if (!who) {
      this.who = null;
      this.controller.stopSync();
      this.changed();
      return;
    }
    if (this.who?.uid === who.uid && this.controller.engine.running) return;
    this.who = who;
    this.lastError = null;
    const c = this.controller;
    if (c.device.auth.uid !== who.uid || c.device.auth.email !== who.email) c.setDeviceFields({ auth: { refreshTokenEnc: null, email: who.email, uid: who.uid } });
    try {
      const provider = await this.d.fb!.provider(who.uid, c.device.deviceId, this.d.usage);
      if (this.dead || this.who?.uid !== who.uid) return;
      c.startSync(provider, who.uid);
      this.log(`sync: signed in (${who.email ?? who.uid})`);
    } catch (e) {
      this.lastError = `Sync could not start: ${String(e)}`;
      this.log(this.lastError);
    }
    this.changed();
  }

  private browserNotice(title: string, body: string): void {
    try {
      // Never prompt: only when the user already allowed notifications.
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(title, { body });
    } catch {
      // Android WebViews throw on construction
    }
  }

  log(m: string): void {
    this.lines.push(`${new Date(this.now()).toISOString()} ${m}`);
    if (this.lines.length > LOG_KEEP) this.lines.shift();
  }

  private changed(): void {
    if (this.dead) return;
    this.d.emit(this.snapshot());
    this.refreshTicks();
  }

  /** Fast tick only while a timer runs and the page is visible; coming back from hidden counts the hidden stretch (D-190). */
  refreshTicks(): void {
    if (this.d.timers === false) return;
    const want = this.controller.running && this.d.visible();
    if (want && !this.fast) this.fast = setInterval(() => this.controller.tick(this.now()), FAST_TICK_MS);
    if (!want && this.fast) {
      clearInterval(this.fast);
      this.fast = null;
    }
  }

  becameVisible(): void {
    this.controller.tick(this.now(), true);
    this.refreshTicks();
  }

  setOffline(offline: boolean): void {
    this.controller.engine.setOffline(offline);
  }

  syncView(): SyncView {
    const c = this.controller;
    const configured = !!this.d.config;
    const out = !configured || this.local;
    const st = out ? 'off' : !this.authReady ? (c.device.auth.uid ? 'syncing' : 'signedOut') : !this.who ? 'signedOut' : c.sync.state;
    return {
      state: st,
      reason: st === 'signedOut' || st === 'off' ? this.lastError : c.sync.reason,
      pending: c.outbox.length,
      oldestPendingAt: c.outbox[0]?.createdAt ?? null,
      lastSyncAt: c.device.sync.lastSyncAt,
      email: this.who ? c.device.auth.email : null,
      configured,
      files: !!this.d.config?.filesUrl && !!this.who,
    };
  }

  private diag(): Diagnostics | null {
    const c = this.controller;
    if (!c.device.experimental) return null;
    return {
      cursors: c.device.sync.cursors,
      conflicts: c.conflicts.slice(-100).reverse(),
      quarantine: c.quarantine.slice(-100).reverse(),
      snapshots: c.snapshots(),
      mcp: { enabled: false, running: false, port: 0, token: '', error: null, bridgePath: '', config: '' },
    };
  }

  snapshot(): Snapshot {
    const c = this.controller;
    return {
      data: c.data,
      device: c.device,
      pendingGap: c.pendingGap,
      shortcutError: null,
      desktopLayer: null,
      isPackaged: false,
      version: this.d.version,
      platform: 'web',
      dataDir: 'IndexedDB',
      perf: this.d.perf(),
      homeView: null,
      sync: this.syncView(),
      diag: this.diag(),
    };
  }

  exportJson(): string {
    return this.controller.exportJson();
  }

  exportLog(): string {
    const c = this.controller;
    const state = { version: this.d.version, sync: this.syncView(), deviceId: c.device.deviceId, cursors: c.device.sync.cursors, outbox: c.outbox.map((e) => ({ opId: e.opId, coll: e.coll, id: e.id, fields: Object.keys(e.fields), createdAt: new Date(e.createdAt).toISOString() })), conflicts: c.conflicts, quarantine: c.quarantine.map((q) => ({ ...q, doc: undefined })), usage: this.d.usage };
    return `Chronos diagnostics (web)\n\n## State\n${JSON.stringify(state, null, 2)}\n\n## Log\n${this.lines.join('\n')}\n`;
  }

  /** Pull to refresh: re-query from the stored cursors (cursors are kept) and flush. */
  catchUp(): void {
    this.controller.engine.reconnect();
  }

  /** The web twin of main.ts's command routing. Input is already parsed (parseCommand). */
  async command(cmd: Command): Promise<Result> {
    const c = this.controller;
    const now = this.now();
    switch (cmd.type) {
      case 'sync.signIn':
        return this.d.fb ? this.d.fb.signIn() : { ok: false, error: 'Sync is not set up for this site.' };
      case 'sync.signOut':
        return this.signOut();
      case 'sync.retry':
        c.engine.reconnect();
        return { ok: true };
      case 'sync.forceResync':
        if (!this.who) return { ok: false, error: 'Sign in first.' };
        c.forceResync(now);
        return { ok: true };
      case 'diag.clear':
        if (cmd.what === 'conflicts') c.clearConflicts();
        else c.clearQuarantine();
        return { ok: true };
      case 'snapshot.restore':
        return c.restoreSnapshot(cmd.name, now);
      case 'mcp.undo': {
        const revert = this.undo.redeem(cmd.token);
        return revert ? this.undo.seal(c.command(revert, now)) : { ok: false, error: 'That change can no longer be undone.' };
      }
      case 'data.import':
      case 'data.openFolder':
      case 'data.export':
      case 'diag.exportLog':
      case 'mcp.regenerateToken':
      case 'mcp.copyConfig':
        return UNSUPPORTED;
      default:
        return this.undo.seal(c.command(cmd, now));
    }
  }

  redeemUndo(token: unknown): Result {
    const revert = this.undo.redeem(token);
    return revert ? this.undo.seal(this.controller.command(revert, this.now())) : { ok: false, error: 'That change can no longer be undone.' };
  }

  private async signOut(): Promise<Result> {
    const pub = this.d.small.get(LS_PUBLIC) === '1';
    this.controller.stopSync();
    this.who = null;
    try {
      await this.d.fb?.signOut();
    } catch {
      // already signed out
    }
    if (pub) {
      await this.wipe();
      return { ok: true };
    }
    // Keep sync.uid: signing in again as the same account does not re-upload.
    this.controller.setDeviceFields({ auth: { refreshTokenEnc: null, email: null, uid: null } });
    this.log('sync: signed out');
    this.changed();
    return { ok: true };
  }

  /** Public computer: nothing of this account stays in the browser. */
  private async wipe(): Promise<void> {
    this.stop();
    this.d.store.discard();
    await this.d.fb?.wipe();
    await this.d.destroyDb();
    for (const k of this.d.small.keys()) if (k.startsWith('chronos')) this.d.small.remove(k);
    this.d.reload();
  }

  /** Page is going away. */
  async shutdown(): Promise<void> {
    if (this.dead) return;
    this.controller.shutdown(this.now());
    await this.d.store.flush();
  }

  stop(): void {
    this.dead = true;
    this.offAuth?.();
    this.controller.stopSync();
    if (this.fast) clearInterval(this.fast);
    if (this.slow) clearInterval(this.slow);
    this.fast = this.slow = null;
  }
}
