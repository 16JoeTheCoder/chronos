// The v1 provider: no replication. v1 never schedules a sync; v1.1 swaps in Firestore (docs/SYNC_V1_1.md).

import type { SyncProvider } from './provider';

export const nullProvider: SyncProvider = {
  status: 'local-only',
  push: async () => {},
  pull: async () => [],
  subscribe: () => () => {},
};
