// Log search: MiniSearch (core/search) for the words, then phrases and filters on top.
// Shared by the Log screen and the MCP search_log tool.

import type { Data } from '../model/types';
import { dateOf } from '../time/zone';
import type { SearchIndex } from '../search';
import { hasTaskPrefix } from './lines';
import { hasFilters, parseQuery, type LogQuery } from './query';

export interface LogHit {
  id: string;
  score: number;
}

export interface LogSearchOpts {
  tz: string;
  today: string;
  limit?: number;
}

/** Does the note pass the project / before / after / is:task filters and every phrase? */
export function passes(d: Data, id: string, q: LogQuery, tz: string): boolean {
  const n = d.ideas[id];
  if (!n || n.deletedAt !== null) return false;
  if (q.project) {
    const want = q.project.toLowerCase();
    const p = n.projectId ? d.projects[n.projectId] : undefined;
    if (!p || !(p.id === q.project || p.name.toLowerCase() === want || p.name.toLowerCase().startsWith(want))) return false;
  }
  if (q.before || q.after) {
    const day = dateOf(n.createdAt, tz);
    if (q.before && !(day < q.before)) return false;
    if (q.after && !(day > q.after)) return false;
  }
  if (q.isTask && !(n.parsedTaskIds.length > 0 || n.taskId !== null || hasTaskPrefix(n.body))) return false;
  const body = n.body.toLowerCase();
  return q.phrases.every((p) => body.includes(p.toLowerCase()));
}

/** Notes matching the query: by relevance when it has words, newest first when it only has phrases/filters. */
export function searchLog(d: Data, index: SearchIndex, query: string, o: LogSearchOpts): { hits: LogHit[]; query: LogQuery } {
  const q = parseQuery(query, o.today);
  const limit = Math.max(1, Math.min(o.limit ?? 50, 5000));
  if (!q.words.length && !q.phrases.length && !hasFilters(q)) return { hits: [], query: q };
  let ids: LogHit[];
  if (q.words.length) {
    index.update(d);
    ids = index.search(q.words.join(' '), { types: ['note'], limit: 200 }).map((h) => ({ id: h.id, score: h.score }));
  } else {
    ids = Object.values(d.ideas).filter((n) => n.deletedAt === null).sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1)).map((n) => ({ id: n.id, score: 0 }));
  }
  return { hits: ids.filter((h) => passes(d, h.id, q, o.tz)).slice(0, limit), query: q };
}

export interface Seg {
  text: string;
  hit: boolean;
}

/** Split text into plain and highlighted runs for the words and phrases of a query. */
export function highlight(text: string, q: Pick<LogQuery, 'words' | 'phrases'>): Seg[] {
  const terms = [...q.phrases, ...q.words.map((w) => w.replace(/^"|"$/g, ''))].filter((t) => t.length > 0).sort((a, b) => b.length - a.length);
  if (!terms.length) return [{ text, hit: false }];
  const esc = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${esc.join('|')})`, 'gi');
  return text.split(re).map((t, i) => ({ text: t, hit: i % 2 === 1 })).filter((x) => x.text !== '');
}
