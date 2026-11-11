// Search (engine only; the Ctrl+K palette is Phase 3). One MiniSearch index over
// tasks (title, notes, finish condition, tag and project names), notes, projects
// and events. update(d) is incremental: only records whose object changed since
// the last call are re-indexed (core/repo replaces a record's object on every
// write), so a keystroke costs a handful of index operations, not a rebuild.
// Tombstoned records stay indexed but are excluded unless asked for.

import MiniSearch from 'minisearch';
import type { Data, Rec } from '../model/types';

export type SearchType = 'task' | 'note' | 'project' | 'event';
export const SEARCH_TYPES: SearchType[] = ['task', 'note', 'project', 'event'];

interface Doc {
  key: string;
  id: string;
  type: SearchType;
  title: string;
  body: string;
  tags: string;
  project: string;
  deleted: boolean;
}

export interface Hit {
  type: SearchType;
  id: string;
  title: string;
  score: number;
  deleted: boolean;
}

const SOURCES = [
  ['tasks', 'task'],
  ['ideas', 'note'],
  ['projects', 'project'],
  ['events', 'event'],
] as const;

export class SearchIndex {
  private ms = new MiniSearch<Doc>({
    idField: 'key',
    fields: ['title', 'body', 'tags', 'project'],
    storeFields: ['id', 'type', 'title', 'deleted'],
    searchOptions: { boost: { title: 3, tags: 1.5, project: 1.5 }, fuzzy: 0.2, prefix: true, combineWith: 'AND' },
  });
  private prev: Data | null = null;

  get size(): number {
    return this.ms.documentCount;
  }

  /** Bring the index in line with d, touching only what changed. */
  update(d: Data): void {
    const p = this.prev;
    this.prev = d;
    // A renamed tag or project changes how its tasks are found.
    const renamed = new Set<string>();
    if (p && p.tags !== d.tags) for (const [id, t] of Object.entries(d.tags)) if (p.tags[id]?.name !== t.name) renamed.add(id);
    if (p && p.projects !== d.projects) for (const [id, x] of Object.entries(d.projects)) if (p.projects[id]?.name !== x.name) renamed.add(id);
    for (const [coll, type] of SOURCES) {
      const now = d[coll] as Record<string, Rec>;
      const before = (p?.[coll] ?? {}) as Record<string, Rec>;
      if (p && now === before && !(type === 'task' && renamed.size)) continue;
      for (const [id, rec] of Object.entries(now)) {
        const stale = type === 'task' && renamed.size && (renamed.has((rec as Data['tasks'][string]).tagId ?? '') || renamed.has((rec as Data['tasks'][string]).projectId ?? ''));
        if (before[id] === rec && !stale) continue;
        this.put(this.toDoc(d, type, rec));
      }
      for (const id of Object.keys(before)) if (!(id in now)) this.drop(`${type}:${id}`);
    }
  }

  search(query: string, opts: { types?: SearchType[]; limit?: number; includeDeleted?: boolean } = {}): Hit[] {
    const q = query.trim();
    if (!q) return [];
    const types = new Set(opts.types?.length ? opts.types : SEARCH_TYPES);
    const hits = this.ms.search(q, { filter: (r) => types.has(r.type as SearchType) && (opts.includeDeleted || !r.deleted) });
    return hits.slice(0, Math.max(1, Math.min(opts.limit ?? 20, 200))).map((h) => ({ type: h.type as SearchType, id: h.id as string, title: h.title as string, score: Math.round(h.score * 100) / 100, deleted: h.deleted as boolean }));
  }

  private put(doc: Doc): void {
    if (this.ms.has(doc.key)) this.ms.replace(doc);
    else this.ms.add(doc);
  }

  private drop(key: string): void {
    if (this.ms.has(key)) this.ms.discard(key);
  }

  private toDoc(d: Data, type: SearchType, rec: Rec): Doc {
    const base = { key: `${type}:${rec.id}`, id: rec.id, type, deleted: rec.deletedAt !== null, tags: '', project: '' };
    switch (type) {
      case 'task': {
        const t = rec as Data['tasks'][string];
        return { ...base, title: t.title, body: `${t.finishCondition}\n${t.notes}`, tags: t.tagId ? (d.tags[t.tagId]?.name ?? '') : '', project: t.projectId ? (d.projects[t.projectId]?.name ?? '') : '' };
      }
      case 'note': {
        const n = rec as Data['ideas'][string];
        const first = n.body.split('\n')[0] ?? '';
        return { ...base, title: first.slice(0, 120), body: n.body };
      }
      case 'project': {
        const x = rec as Data['projects'][string];
        return { ...base, title: x.name, body: x.columns.map((c) => c.name).join(' ') };
      }
      default: {
        const e = rec as Data['events'][string];
        return { ...base, title: e.title, body: e.notes, tags: e.tagId ? (d.tags[e.tagId]?.name ?? '') : '' };
      }
    }
  }
}
