// "This month" under the Log calendar: posts, words, active days, current streak, tasks from
// the Log. Computed from notes (core/log monthStats), no stored fields.
import { useMemo } from 'react';
import { monthStats } from '../../core/log';
import type { Idea } from '../../core/model/types';

export function Stats({ notes, tz, today }: { notes: readonly Idea[]; tz: string; today: string }) {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const s = useMemo(() => monthStats(notes, tz, y, m, today), [notes, tz, y, m, today]);
  const rows: [string, number, string][] = [
    ['Posts', s.posts, s.posts === 1 ? 'post' : 'posts'],
    ['Words', s.words, 'words'],
    ['Active days', s.activeDays, s.activeDays === 1 ? 'day' : 'days'],
    ['Current streak', s.streak, s.streak === 1 ? 'day' : 'days'],
    ['Tasks from the Log', s.tasks, s.tasks === 1 ? 'task' : 'tasks'],
  ];
  return (
    <section className="stats" aria-labelledby="stats-h">
      <h2 id="stats-h" className="stats-h">This month</h2>
      {s.posts === 0 ? (
        <p className="stats-empty">No posts this month yet. Your first post starts the count.</p>
      ) : (
        <dl className="stats-list">
          {rows.map(([label, n, unit]) => (
            <div key={label} className="stats-row">
              <dt>{label}</dt>
              <dd><b>{n.toLocaleString()}</b> <span className="sr-only">{unit}</span></dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
