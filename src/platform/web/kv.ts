// The tiny key-value seam under the web store: idb-keyval in the browser, a Map in tests.

export interface KV {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export const DB_NAME = 'chronos';

export async function idbKv(): Promise<KV> {
  const idb = await import('idb-keyval');
  const store = idb.createStore(DB_NAME, 'kv');
  return {
    get: (k) => idb.get(k, store),
    set: (k, v) => idb.set(k, v, store),
    del: (k) => idb.del(k, store),
    keys: async () => (await idb.keys(store)).map(String),
  };
}

export function deleteDb(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const r = indexedDB.deleteDatabase(DB_NAME);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function memKv(seed: Record<string, unknown> = {}): KV & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>(Object.entries(seed));
  return {
    map,
    get: async (k) => (map.has(k) ? structuredClone(map.get(k)) : undefined),
    set: async (k, v) => void map.set(k, structuredClone(v)),
    del: async (k) => void map.delete(k),
    keys: async () => [...map.keys()],
  };
}

/** The slice of localStorage the web layer uses; every access is guarded (private windows, WebViews). */
export interface Small {
  get(k: string): string | null;
  set(k: string, v: string): void;
  remove(k: string): void;
  keys(): string[];
}

export function localSmall(): Small {
  const ls = (): Storage | null => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  };
  return {
    get: (k) => { try { return ls()?.getItem(k) ?? null; } catch { return null; } },
    set: (k, v) => { try { ls()?.setItem(k, v); } catch { /* quota or blocked */ } },
    remove: (k) => { try { ls()?.removeItem(k); } catch { /* ignore */ } },
    keys: () => { try { const s = ls(); return s ? Array.from({ length: s.length }, (_, i) => s.key(i) ?? '') : []; } catch { return []; } },
  };
}

export function memSmall(): Small {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k), keys: () => [...m.keys()] };
}
