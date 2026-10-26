// The replication boundary (§10). v1 ships nullProvider (local only); the tests
// run two devices against memoryProvider; v1.1 adds a Firestore provider with
// the same shape. Changes carry whole records (or purge stubs), never ticks.

import type { Coll, Rec, Stub } from '../model/types';

export type Cursor = number;
export type SyncStatus = 'local-only' | 'idle' | 'syncing' | 'offline' | 'error';

export interface Change {
  coll: Coll;
  rec: Rec | Stub;
  /** Set by the server; pull cursors advance on this, never on client clocks. */
  serverUpdatedAt?: number;
}

export interface SyncProvider {
  readonly status: SyncStatus;
  push(changes: Change[]): Promise<void>;
  /** Changes in one collection with serverUpdatedAt > since. */
  pull(coll: Coll, since: Cursor): Promise<Change[]>;
  /** Called when the server has new changes; returns an unsubscribe function. */
  subscribe(cb: () => void): () => void;
}

export const isStub = (r: Rec | Stub): r is Stub => (r as Stub).purged === true;
