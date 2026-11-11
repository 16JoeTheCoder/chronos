// Simulated devices for the sync tests: each holds its own Data, outbox and
// cursors and mirrors what main/controller does (commands -> diff -> outbox;
// remote merges -> normalize -> any derived change -> outbox).
import { apply, type Command } from '../../src/core/commands';
import { emptyData } from '../../src/core/model/defaults';
import type { Coll, Conflict, Data, QuarantineItem, SyncStateKind } from '../../src/core/model/types';
import { normalize } from '../../src/core/tasks/tasks';
import { SyncEngine } from '../../src/core/sync/engine';
import { diffData, enqueue } from '../../src/core/sync/outbox';
import { memoryProvider, memoryServer, type Link, type MemoryServer } from '../../src/core/sync/memoryProvider';
import type { OutboxEntry } from '../../src/core/sync/provider';
import { T0 } from '../helpers';

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Device {
  d: Data = emptyData();
  outbox: OutboxEntry[] = [];
  cursors: Partial<Record<Coll, number>> = {};
  conflicts: Conflict[] = [];
  quarantined: QuarantineItem[] = [];
  state: SyncStateKind = 'off';
  link: Link = { online: true, latencyMs: 0 };
  /** This device's clock offset (clock skew tests). */
  skew = 0;
  clock = T0;
  engine: SyncEngine;

  constructor(readonly id: string, readonly server: MemoryServer) {
    this.engine = new SyncEngine(
      {
        data: () => this.d,
        applyRemote: (d) => {
          const n = normalize(d, this.ctx());
          this.d = d;
          this.commit(n);
        },
        outbox: () => this.outbox,
        setOutbox: (o) => (this.outbox = o),
        cursors: () => this.cursors,
        setCursors: (c) => (this.cursors = c),
        conflicts: (c) => this.conflicts.push(...c),
        quarantine: (q) => this.quarantined.push(...q),
        state: (s) => (this.state = s.state),
        synced: () => {},
        log: () => {},
      },
      { deviceId: () => id, now: () => this.now(), flushDelayMs: 0, random: () => 0.5 },
    );
  }

  now(): number {
    return this.clock + this.skew;
  }

  ctx() {
    return { now: this.now(), deviceId: this.id, deviceName: this.id };
  }

  /** Adopt new local data and queue what changed (the controller's commit()). */
  commit(next: Data): void {
    const entries = diffData(this.d, next, this.now());
    this.d = next;
    if (this.engine.running) this.engine.enqueue(entries);
    else this.outbox = enqueue(this.outbox, entries);
  }

  run(cmd: Command): string {
    const r = apply(this.d, cmd, this.ctx());
    if (!r.ok) throw new Error(`${cmd.type}: ${r.error} ${JSON.stringify(r.fields ?? {})}`);
    this.commit(r.d);
    return r.id ?? '';
  }

  connect(): void {
    this.engine.start(memoryProvider(this.server, this.id, this.link));
  }

  goOffline(): void {
    this.link.online = false;
  }

  goOnline(): void {
    this.link.online = true;
    this.engine.reconnect();
  }
}

export function pair(): [Device, Device, MemoryServer] {
  const server = memoryServer();
  return [new Device('devA', server), new Device('devB', server), server];
}

/** Wait until every online device has an empty outbox and nothing is in flight. */
export async function settle(...devs: Device[]): Promise<void> {
  for (let i = 0; i < 200; i++) {
    await wait(5);
    if (devs.every((d) => !d.link.online || (d.outbox.length === 0 && (d.state === 'synced' || d.state === 'readOnly')))) {
      await wait(10);
      if (devs.every((d) => !d.link.online || d.outbox.length === 0)) return;
    }
  }
  throw new Error(`did not settle: ${devs.map((d) => `${d.id} ${d.state} outbox=${d.outbox.length}`).join(', ')}`);
}

/** Comparable content: sync metadata and per-device timer ownership excluded. */
export function content(d: Data): string {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) if (k !== 'fv' && k !== 'fw') out[k] = strip((v as Record<string, unknown>)[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(strip(d));
}
