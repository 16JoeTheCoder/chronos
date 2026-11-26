// Markdown-light for Log posts: bold, italic, links, bullet lists. Pure: text in, a small tree out.
// The renderer (Md.tsx) turns the tree into React elements; nothing here produces HTML.

export type Inline =
  | { t: 'text'; s: string }
  | { t: 'br' }
  | { t: 'b'; c: Inline[] }
  | { t: 'i'; c: Inline[] }
  | { t: 'a'; href: string; c: Inline[] };

export type Block = { t: 'p'; c: Inline[] } | { t: 'ul'; items: Inline[][] };

/** Only web links are followed; anything else (javascript:, data:, file:) is dropped. */
const SAFE = /^https?:\/\/[^\s<>"']+$/i;
export function safeHref(url: string): string | null {
  const u = url.trim();
  return SAFE.test(u) ? u : null;
}

const BARE = /^https?:\/\/[^\s<>()"']+/i;
const alnum = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

/** Find the closing single marker: not doubled, not preceded by a space, and (for `_`) not inside a word. */
function closeSingle(s: string, from: number, mark: string): number {
  for (let j = from; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] !== mark) continue;
    if (s[j + 1] === mark || s[j - 1] === mark) continue;
    if (/\s/.test(s[j - 1] ?? ' ')) continue;
    if (mark === '_' && alnum(s[j + 1])) continue;
    return j;
  }
  return -1;
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', s: buf });
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '\\' && i + 1 < s.length && '*_[]()\\'.includes(s[i + 1]!)) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === '[') {
      const m = /^\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/.exec(s.slice(i));
      if (m) {
        const href = safeHref(m[2]!);
        if (href) {
          flush();
          out.push({ t: 'a', href, c: parseInline(m[1]!) });
        } else buf += m[1];
        i += m[0].length;
        continue;
      }
    }
    if (c === '*' && s[i + 1] === '*') {
      const end = s.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: 'b', c: parseInline(s.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((c === '*' || c === '_') && s[i + 1] !== c && s[i + 1] !== undefined && !/\s/.test(s[i + 1]!) && !(c === '_' && alnum(s[i - 1]))) {
      const end = closeSingle(s, i + 1, c);
      if (end > i + 1) {
        flush();
        out.push({ t: 'i', c: parseInline(s.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (c === 'h' && !alnum(s[i - 1])) {
      const m = BARE.exec(s.slice(i));
      if (m) {
        const url = m[0].replace(/[.,;:!?]+$/, '');
        const href = safeHref(url);
        if (href) {
          flush();
          out.push({ t: 'a', href, c: [{ t: 'text', s: url }] });
          i += url.length;
          continue;
        }
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

const BULLET = /^\s*[-*]\s+(.*)$/;

/** Lines (no task lines) to blocks: blank lines split paragraphs; `- `/`* ` lines make a list. */
export function parseBlocks(lines: readonly string[]): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Inline[][] | null = null;
  const endPara = () => {
    if (!para.length) return;
    const c: Inline[] = [];
    para.forEach((l, k) => {
      if (k) c.push({ t: 'br' });
      c.push(...parseInline(l));
    });
    blocks.push({ t: 'p', c });
    para = [];
  };
  const endList = () => {
    if (list) blocks.push({ t: 'ul', items: list });
    list = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const b = BULLET.exec(line);
    if (b && b[1]!.trim()) {
      endPara();
      (list ??= []).push(parseInline(b[1]!.trim()));
    } else if (!line.trim()) {
      endPara();
      endList();
    } else {
      endList();
      para.push(line.trim());
    }
  }
  endPara();
  endList();
  return blocks;
}

/** Plain text of an inline tree (tests, search snippets). */
export const inlineText = (n: readonly Inline[]): string => n.map((x) => (x.t === 'text' ? x.s : x.t === 'br' ? '\n' : inlineText(x.c))).join('');
