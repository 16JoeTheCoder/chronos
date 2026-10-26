// v1 default: no replication. The engine still runs against it, so the code path is exercised.

import type { SyncProvider } from './provider';

export const nullProvider: SyncProvider = {
  status: 'local-only',
  push: async () => {},
  pull: async () => [],
  subscribe: () => () => {},
};
