// Renders the markdown-light tree as React elements. No HTML strings, no dangerouslySetInnerHTML.
import type { ReactNode } from 'react';
import { highlight, type LogQuery } from '../../core/log';
import { parseBlocks, type Inline } from './markdown';

type Q = Pick<LogQuery, 'words' | 'phrases'> | null;

function Text({ s, q }: { s: string; q: Q }) {
  if (!q || (!q.words.length && !q.phrases.length)) return <>{s}</>;
  return <>{highlight(s, q).map((g, i) => (g.hit ? <mark key={i}>{g.text}</mark> : <span key={i}>{g.text}</span>))}</>;
}

function inline(nodes: readonly Inline[], q: Q): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text': return <Text key={i} s={n.s} q={q} />;
      case 'br': return <br key={i} />;
      case 'b': return <strong key={i}>{inline(n.c, q)}</strong>;
      case 'i': return <em key={i}>{inline(n.c, q)}</em>;
      case 'a': return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">{inline(n.c, q)}</a>;
    }
  });
}

/** One line of text with inline formatting (a task chip's label). */
export function Inlines({ text, q }: { text: string; q: Q }) {
  const b = parseBlocks([text])[0];
  const nodes = !b ? [] : b.t === 'p' ? b.c : b.items.flat();
  return <>{inline(nodes, q)}</>;
}

/** Plain (non-task) lines of a post as paragraphs and lists. */
export function Md({ lines, q }: { lines: readonly string[]; q: Q }) {
  const blocks = parseBlocks(lines);
  return (
    <>
      {blocks.map((b, i) =>
        b.t === 'p' ? (
          <p key={i}>{inline(b.c, q)}</p>
        ) : (
          <ul key={i}>
            {b.items.map((it, k) => <li key={k}>{inline(it, q)}</li>)}
          </ul>
        ),
      )}
    </>
  );
}
