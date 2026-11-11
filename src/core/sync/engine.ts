// The sync engine (docs/SYNC.md). Local data is the source of truth; this
// replicates it. It owns no data: the host (main/controller) holds Data, the
// outbox and the cursors, persists them, and calls back in on every change.
//
//   flush:  outbox head (up to `batch` records) -> provider.commit (one
//           transaction, planCommit per entry) -> drop acknowledged entries.
//           Failures back off 1 s, 2 s, 4 s ... 60 s with jitter, entries kept.
//   pull:   one live listener per collection from its cursor -> mergeRemote ->
//           host.applyRemote. Invalid docs are quarantined, newer-schema docs
//           switch to read-only (nothing is pushed, edits keep queueing).
//   seed:   once the first snapshot of every collection is in, fields that were
//           never synced are queued (a first sign-in uploads local data).
// Timer ownership: only the owner drives a running timer; Take over closes the
// previous owner's slice at the takeover instant on both devices (same session id).

import { COLLS, type Coll, type Conflict, type Data, type QuarantineItem, type SyncStateKind } from '../model/types';
import { get, update, timerOf, type Ctx } from '../repo/repo';
import { recordSlices } from '../tasks/tasks';
import { pauseAt, start } from '../timer/timer';
import { mergeRemote, planCommit } from './merge';
import { enqueue, pendingFields, seedEntries } from './outbox';
import type { OutboxEntry, RemoteDoc, SyncProvider } from './provider';

export interface SyncHost {
  data(): Data;
  /** Remote changes merged in: adopt this data (it must not become an outbox entry). */
  applyRemote(d: Data): void;
  outbox(): OutboxEntry[];
  /** Persist the outbox (atomically) before returning. */
  setOutbox(o: OutboxEntry[]): void;
  cursors(): Partial<Record<Coll, number>>;
  setCursors(c: Partial<Record<Coll, number>>): void;
  conflicts(c: Conflict[]): void;
  quarantine(q: QuarantineItem[]): void;
  /** State changed (also called on every pending-count change). */
  state(s: { state: SyncStateKind; reason: string | null }): void;
  synced(at: number): void;
  log(msg: string): void;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(h: unknown): void;
}

export interface EngineOptions {
  /** This device's id (read when needed: the host may load it after constructing the engine). */
  deviceId: () => string;
  now(): number;
  random?: () => number;
  timers?: Timers;
  /** Wait after a local change before flushing, so typing coalesces. */
  flushDelayMs?: number;
  /** Records per transaction. */
  batch?: number;
}

export const BACKOFF_MIN_MS = 1_000;
export const BACKOFF_MAX_MS = 60_000;
export const READ_ONLY_REASON = 'Update Chronos on this device.';

const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** 1 s, 2 s, 4 s ... capped at 60 s, with ±25% jitter. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.75 + random() * 0.5));
}

export class SyncEngine {
  private provider: SyncProvider | null = null;
  private unsubs: (() => void)[] = [];
  private inflight = new Set<string>();
  private flushing = false;
  private flushTimer: unknown = null;
  private retryTimer: unknown = null;
  private reconnectTimer: unknown = null;
  private attempts = 0;
  private listenAttempts = 0;
  private initial = new Set<Coll>();
  private seeded = false;
  private readOnly: string | null = null;
  private error: string | null = null;
  private offline = false;
  private generation = 0;
  private readonly timers: Timers;
  private readonly random: () => number;

  constructor(private host: SyncHost, private opts: EngineOptions) {
    this.timers = opts.timers ?? realTimers;
    this.random = opts.random ?? Math.random;
  }

  get running(): boolean {
    return this.provider !== null;
  }

  get kind(): SyncStateKind {
    if (!this.provider) return 'off';
    if (this.readOnly) return 'readOnly';
    if (this.offline) return 'offline';
    if (this.error) return 'error';
    if (this.host.outbox().length) return 'pending';
    if (this.initial.size < COLLS.length) return 'syncing';
    return 'synced';
  }

  get reason(): string | null {
    return this.readOnly ?? (this.offline ? 'Offline. Changes are saved here and sync when you reconnect.' : this.error);
  }

  start(provider: SyncProvider): void {
    this.stop();
    this.seeded = false;
    this.provider = provider;
    this.attach();
    this.flushSoon(0);
  }

  stop(): void {
    this.detach();
    for (const t of [this.flushTimer, this.retryTimer, this.reconnectTimer]) if (t !== null) this.timers.clear(t);
    this.flushTimer = this.retryTimer = this.reconnectTimer = null;
    this.provider = null;
    this.readOnly = this.error = null;
    this.offline = false;
    this.attempts = this.listenAttempts = 0;
    this.emit();
  }

  /** A local mutation was queued: flush shortly. */
  localChanged(): void {
    this.emit();
    this.flushSoon(this.opts.flushDelayMs ?? 200);
  }

  /** Network regained, resume/unlock, or a listener failed: re-query from the stored cursors. */
  reconnect(): void {
    if (!this.provider) return;
    this.offline = false;
    this.detach();
    this.attach();
    this.attempts = 0;
    this.flushSoon(0);
  }

  setOffline(offline: boolean): void {
    if (this.offline === offline) return;
    this.offline = offline;
    if (!offline) this.reconnect();
    else this.emit();
  }

  /** Clear the cursors and pull everything again; the outbox is kept and re-flushed. */
  forceResync(): void {
    this.host.setCursors({});
    this.readOnly = null;
    this.seeded = false;
    this.reconnect();
  }

  /** Flush now (also the Retry button). Resolves when the outbox is empty or a failure was scheduled for retry. */
  async flush(): Promise<void> {
    if (this.flushTimer !== null) this.timers.clear(this.flushTimer);
    if (this.retryTimer !== null) this.timers.clear(this.retryTimer);
    this.flushTimer = this.retryTimer = null;
    const provider = this.provider;
    if (!provider || this.flushing || this.readOnly) return;
    this.flushing = true;
    const gen = this.generation;
    try {
      for (;;) {
        const batch = this.host.outbox().slice(0, this.opts.batch ?? 20);
        if (!batch.length || this.provider !== provider || this.readOnly) break;
        for (const e of batch) this.inflight.add(e.opId);
        const results = await provider.commit(batch, (e, remote) => planCommit(e, remote, this.localOf(e), this.opts.deviceId(), this.opts.now()));
        const done = new Set<string>();
        const conflicts: Conflict[] = [];
        const authoritative: RemoteDoc[] = [];
        for (const r of results) {
          conflicts.push(...r.plan.conflicts);
          if (r.plan.outcome === 'newerSchema') {
            this.readOnly = READ_ONLY_REASON;
            continue;
          }
          done.add(r.opId);
          if (r.plan.adopt && r.remote) authoritative.push(r.remote);
        }
        if (conflicts.length) {
          this.host.conflicts(conflicts);
          this.host.log(`sync: ${conflicts.length} conflict(s) logged`);
        }
        this.host.setOutbox(this.host.outbox().filter((e) => !done.has(e.opId)));
        for (const e of batch) this.inflight.delete(e.opId);
        if (authoritative.length) this.merge(authoritative);
        this.attempts = 0;
        this.error = null;
        this.offline = false;
        if (gen === this.generation) this.host.synced(this.opts.now());
        this.emit();
      }
    } catch (e) {
      this.inflight.clear();
      this.attempts++;
      this.error = `Sync failed: ${describe(e)}. Retrying.`;
      const wait = backoffMs(this.attempts, this.random);
      this.host.log(`sync: flush failed (attempt ${this.attempts}, retry in ${wait} ms): ${describe(e)}`);
      this.retryTimer = this.timers.set(() => {
        this.retryTimer = null;
        void this.flush();
      }, wait);
      this.emit();
    } finally {
      this.inflight.clear();
      this.flushing = false;
    }
    // Something was queued while the last batch was in flight.
    if (!this.error && this.provider === provider && !this.readOnly && this.host.outbox().length && this.retryTimer === null) this.flushSoon(0);
  }

  /** Queue local changes (coalesced into waiting entries, never into one in flight) and flush soon. */
  enqueue(entries: OutboxEntry[]): void {
    if (!entries.length) return;
    this.host.setOutbox(enqueue(this.host.outbox(), entries, this.inflight));
    this.localChanged();
  }

  private localOf(e: OutboxEntry) {
    const d = this.host.data();
    return d.tombs[e.coll]?.[e.id] ?? get(d, e.coll, e.id);
  }

  private flushSoon(ms: number): void {
    if (!this.provider || this.flushTimer !== null) return;
    this.flushTimer = this.timers.set(() => {
      this.flushTimer = null;
      void this.flush();
    }, ms);
  }

  private attach(): void {
    const provider = this.provider;
    if (!provider) return;
    const gen = ++this.generation;
    this.initial.clear();
    const cursors = this.host.cursors();
    for (const coll of COLLS) {
      this.unsubs.push(
        provider.listen(
          coll,
          cursors[coll] ?? 0,
          (docs) => {
            if (gen !== this.generation) return;
            this.onDocs(coll, docs);
          },
          (e) => {
            if (gen !== this.generation) return;
            this.onListenError(coll, e);
          },
        ),
      );
    }
    this.emit();
  }

  private detach(): void {
    this.generation++;
    for (const u of this.unsubs) {
      try {
        u();
      } catch {
        // already closed
      }
    }
    this.unsubs = [];
    this.initial.clear();
  }

  private onDocs(coll: Coll, docs: RemoteDoc[]): void {
    this.listenAttempts = 0;
    if (docs.length) {
      const cursors = { ...this.host.cursors() };
      for (const doc of docs) cursors[coll] = Math.max(cursors[coll] ?? 0, doc.serverUpdatedAt);
      this.merge(docs);
      this.host.setCursors(cursors);
    }
    const first = !this.initial.has(coll);
    this.initial.add(coll);
    if (first && this.initial.size === COLLS.length) {
      this.host.synced(this.opts.now());
      if (!this.seeded) {
        this.seeded = true;
        const seed = seedEntries(this.host.data(), this.opts.now(), pendingFields(this.host.outbox()));
        if (seed.length) this.host.log(`sync: uploading ${seed.length} record(s) never synced`);
        this.enqueue(seed);
      }
    }
    this.emit();
  }

  private merge(docs: RemoteDoc[]): void {
    const ctx: Ctx = { now: this.opts.now(), deviceId: this.opts.deviceId() };
    const m = mergeRemote(this.host.data(), docs, pendingFields(this.host.outbox()), ctx);
    if (m.quarantined.length) {
      this.host.quarantine(m.quarantined);
      this.host.log(`sync: quarantined ${m.quarantined.length} invalid doc(s): ${m.quarantined.map((q) => `${q.coll}/${q.id} (${q.reason})`).join(', ')}`);
    }
    if (m.newer.length && !this.readOnly) {
      this.readOnly = READ_ONLY_REASON;
      this.host.log(`sync: read-only, ${m.newer.length} doc(s) from a newer schema`);
    }
    if (m.changed) this.host.applyRemote(m.d);
  }

  private onListenError(coll: Coll, e: unknown): void {
    this.listenAttempts++;
    this.error = `Sync connection lost: ${describe(e)}. Reconnecting.`;
    const wait = backoffMs(this.listenAttempts, this.random);
    this.host.log(`sync: listener ${coll} failed, reconnect in ${wait} ms: ${describe(e)}`);
    this.detach();
    if (this.reconnectTimer !== null) this.timers.clear(this.reconnectTimer);
    this.reconnectTimer = this.timers.set(() => {
      this.reconnectTimer = null;
      if (!this.provider) return;
      this.error = null;
      this.attach();
      this.flushSoon(0);
    }, wait);
    this.emit();
  }

  private emit(): void {
    this.host.state({ state: this.kind, reason: this.reason });
  }
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Take over the running timer on this device: bank the old owner's slice, continue here. */
export function takeover(d: Data, ctx: Ctx & { deviceName?: string }): Data {
  const at = timerOf(d);
  let out = update(d, 'timer', 'current', { ownerDeviceId: ctx.deviceId, ownerName: ctx.deviceName ?? '', takeoverAt: ctx.now }, ctx);
  const task = get(d, 'tasks', at.taskId);
  if (task?.runtime.status === 'running') {
    const s = pauseAt(task, ctx.now);
    const next = s.task.runtime.status === 'paused' ? start(s.task, ctx.now) : s.task;
    out = recordSlices(update(out, 'tasks', task.id, next, ctx), task.id, s.slices, ctx);
  }
  return out;
}
