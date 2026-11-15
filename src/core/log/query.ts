// Log search query language: free words, "exact phrases", and filters
// project:<name|id>  before:<date>  after:<date>  is:task
// Dates are YYYY-MM-DD, `today` or `yesterday`. before: and after: are exclusive.
// An unknown `key:value` stays a plain word; a bad date is reported in `invalid`.

import { addDays } from '../time/zone';

export interface LogQuery {
  /** Free words (MiniSearch input). */
  words: string[];
  /** Quoted phrases, matched as case-insensitive substrings. */
  phrases: string[];
  project?: string;
  before?: string;
  after?: string;
  isTask?: boolean;
  invalid: string[];
}

const TOKEN = /([a-z]+):("[^"]*"|\S+)|"([^"]*)"|(\S+)/gi;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const unquote = (s: string) => s.replace(/^"|"$/g, '').trim();

export function parseQuery(input: string, today: string): LogQuery {
  const q: LogQuery = { words: [], phrases: [], invalid: [] };
  for (const m of input.matchAll(TOKEN)) {
    const [raw, key, val, phrase, word] = m;
    if (key) {
      const k = key.toLowerCase();
      const v = unquote(val ?? '');
      if (k === 'project' && v) q.project = v;
      else if ((k === 'before' || k === 'after') && v) {
        const d = v.toLowerCase() === 'today' ? today : v.toLowerCase() === 'yesterday' ? addDays(today, -1) : v;
        if (DATE.test(d) && !Number.isNaN(Date.parse(d))) q[k] = d;
        else q.invalid.push(raw);
      } else if (k === 'is' && v.toLowerCase() === 'task') q.isTask = true;
      else if (k === 'is' || k === 'project' || k === 'before' || k === 'after') q.invalid.push(raw);
      else q.words.push(raw);
    } else if (phrase !== undefined) {
      if (phrase.trim()) q.phrases.push(phrase.trim());
    } else if (word) q.words.push(word);
  }
  return q;
}

export const hasFilters = (q: LogQuery) => q.project !== undefined || q.before !== undefined || q.after !== undefined || q.isTask === true;
export const isEmptyQuery = (q: LogQuery) => !q.words.length && !q.phrases.length && !hasFilters(q);
