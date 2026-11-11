// The replication boundary (docs/SYNC.md). Pure types: the engine (core) talks to
// a provider; the Firestore provider lives in src/main/sync (the only place the
// Firebase SDK is imported) and the tests use memoryProvider, a fake Firestore.

import type { Coll, Conflict, Rec, Stub } from '../model/types';

/** A durable, ordered intent to write some fields of one record (%APPDATA%\Chronos\outbox.json). */
export interface OutboxEntry {
  opId: string;
  coll: Coll;
  id: string;
  /** Changed field -> new value. */
  fields: Record<string, unknown>;
  /** fv of each changed field when the edit was made (absent = never synced). */
  baseFv: Record<string, number>;
  createdAt: number;
  /** A purge stub: replace the whole document. */
  replace?: boolean;
  /** First-sync upload of never-synced fields: fills gaps only, never overwrites the server. */
  seed?: boolean;
}

/** A document as the server holds it. Versions and cursors are server commit times in µs. */
export interface RemoteDoc {
  coll: Coll;
  id: string;
  /** Every stored field except the sync maps. */
  data: Record<string, unknown>;
  fv: Record<string, number>;
  fw: Record<string, string>;
  serverUpdatedAt: number;
}

export type CommitOutcome = 'written' | 'tombstoned' | 'newerSchema' | 'noop';

/** What to do with one entry once its remote document has been read (decided by core/sync/merge). */
export interface CommitPlan {
  outcome: CommitOutcome;
  /** Fields to write; each also gets fv.<f> = server time and fw.<f> = this device. */
  write: Record<string, unknown> | null;
  /** Overwrite the whole document instead of updating fields. */
  replace: boolean;
  conflicts: Conflict[];
  /** Merge the remote doc (as read) into local data afterwards: it is authoritative for what was not written. */
  adopt: boolean;
}

export interface CommitResult {
  opId: string;
  plan: CommitPlan;
  remote: RemoteDoc | null;
}

export interface SyncProvider {
  /**
   * In one transaction: read the remote doc of every entry, ask `plan` what to do,
   * write. Resolves once the server has acknowledged; rejects (nothing written) on
   * any failure, so the caller simply retries the same entries later.
   */
  commit(entries: OutboxEntry[], plan: (e: OutboxEntry, remote: RemoteDoc | null) => CommitPlan): Promise<CommitResult[]>;
  /**
   * Live query: docs of `coll` with serverUpdatedAt >= since, first as one initial
   * batch (possibly empty), then every change. This device's own unacknowledged
   * writes are never delivered. Returns an unsubscribe function.
   */
  listen(coll: Coll, since: number, onDocs: (docs: RemoteDoc[]) => void, onError: (e: unknown) => void): () => void;
}

export const isStub = (r: Rec | Stub): r is Stub => (r as Stub).purged === true;
