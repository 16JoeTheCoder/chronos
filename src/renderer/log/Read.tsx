// The Read view: the Log as a blog. Posts newest first under day headings; search and a project filter on top;
// the calendar (and this month's numbers) in a drawer that is closed until asked for.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { feedOf, highlight, indexForDay, isEmptyQuery, parseQuery, projectsWithPosts, searchLog } from '../../core/log';
import { SearchIndex } from '../../core/search';
import type { Data } from '../../core/model/types';
import { dateOf } from '../../core/time/zone';
import { Boundary } from '../components/Boundary';
import { Calendar } from './Calendar';
import { dayHeading, groupByDay, isTypingTarget, takePosts } from './logic';
import { Post } from './Post';
import { Stats } from './Stats';

const PAGE = 40;
const CAL_KEY = 'chronos.log.cal';

interface Props {
  data: Data;
  tz: string;
  today: string;
  /** Project view: the filter starts on this project. */
  projectId: string | null;
  /** The project the next post goes to (calendar's second mark). */
  composerProject: string | null;
  /** Scroll to and highlight this post (opened from elsewhere, or just published). */
  focusPostId?: string;
  onWrite: () => void;
  onEdit: (id: string) => void;
}

export function Read({ data: d, tz, today, projectId, composerProject, focusPostId, onWrite, onEdit }: Props) {
  const [chip, setChip] = useState<string | null>(projectId);
  useEffect(() => setChip(projectId), [projectId]);
  const projects = useMemo(() => {
    const ids = projectsWithPosts(Object.values(d.ideas));
    return Object.values(d.projects).filter((p) => p.deletedAt === null && ids.has(p.id)).sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
  }, [d.ideas, d.projects]);

  const feed = useMemo(() => feedOf(d.ideas, chip), [d.ideas, chip]);
  const allNotes = useMemo(() => Object.values(d.ideas), [d.ideas]);
  const groups = useMemo(() => groupByDay(feed, tz), [feed, tz]);
  const [limit, setLimit] = useState(PAGE);
  const shown = useMemo(() => takePosts(groups, limit), [groups, limit]);
  const shownCount = shown.reduce((n, g) => n + g.posts.length, 0);

  // ---- jump to a post: widen the window if it is further back, then scroll once it is in the page ----
  const [flash, setFlash] = useState<string | null>(focusPostId ?? null);
  const [jump, setJump] = useState<string | null>(focusPostId ?? null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startFlash = useCallback((id: string) => {
    setFlash(id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 2200);
  }, []);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);
  const lastFocus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (focusPostId && lastFocus.current !== focusPostId) {
      lastFocus.current = focusPostId;
      setJump(focusPostId);
    }
  }, [focusPostId]);
  useEffect(() => {
    if (!jump) return;
    const i = feed.findIndex((n) => n.id === jump);
    if (i < 0) {
      if (feed.length) setJump(null);
      return;
    }
    if (i >= shownCount) {
      setLimit(i + 1);
      return;
    }
    const el = document.getElementById(`log-post-${jump}`);
    if (el) {
      el.scrollIntoView({ block: 'start' });
      el.focus({ preventScroll: true });
      startFlash(jump);
      setJump(null);
    }
  }, [jump, feed, shownCount, startFlash]);

  // ---- calendar drawer: closed by default, remembered on this device ----
  const [calOpen, setCalOpenState] = useState(() => { try { return localStorage.getItem(CAL_KEY) === '1'; } catch { return false; } });
  const setCalOpen = (v: boolean) => {
    setCalOpenState(v);
    try { localStorage.setItem(CAL_KEY, v ? '1' : '0'); } catch { /* per-viewer convenience */ }
  };
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const pickDay = (date: string) => {
    setSelectedDay(date);
    const i = indexForDay(feed, date, tz);
    if (i >= 0) setJump(feed[i]!.id);
    if (window.matchMedia?.('(max-width: 639px)').matches) setCalOpen(false);
  };

  // ---- W opens Write ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'w' && e.key !== 'W') || e.ctrlKey || e.altKey || e.metaKey || isTypingTarget(e.target) || document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      onWrite();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onWrite]);

  // ---- search ----
  const indexRef = useRef<SearchIndex | null>(null);
  indexRef.current ??= new SearchIndex();
  const [query, setQuery] = useState('');
  const [resActive, setResActive] = useState(0);
  const resId = useId();
  const feedIds = useMemo(() => new Set(feed.map((n) => n.id)), [feed]);
  const found = useMemo(() => {
    if (isEmptyQuery(parseQuery(query, today))) return null;
    const r = searchLog(d, indexRef.current!, query, { tz, today, limit: 30 });
    return { q: r.query, hits: r.hits.filter((h) => feedIds.has(h.id)) };
  }, [query, d.ideas, d.projects, tz, today, feedIds]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setResActive(0), [query]);
  const q = found ? found.q : null;

  const projectName = chip ? (d.projects[chip]?.name ?? null) : null;
  const marksProject = chip ?? composerProject;
  const markName = marksProject ? (d.projects[marksProject]?.name ?? null) : null;

  return (
    <div className={`read${calOpen ? ' cal-open' : ''}`}>
      <header className="log-head">
        <h1>{projectName ? <>Log <span className="log-h-proj">· {projectName}</span></> : 'Log'}</h1>
        <div className="search">
          <input
            type="search"
            className="search-input"
            value={query}
            placeholder='Search posts: "exact phrase" project: before: after: is:task'
            aria-label="Search posts"
            role="combobox"
            aria-expanded={!!found}
            aria-controls={found ? resId : undefined}
            aria-activedescendant={found?.hits.length ? `${resId}-${resActive}` : undefined}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('');
                return;
              }
              if (!found?.hits.length) return;
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setResActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + found.hits.length) % found.hits.length);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                setJump(found.hits[resActive]!.id);
                setQuery('');
              }
            }}
          />
          {found && (
            <ul className="results" role="listbox" id={resId} aria-label="Search results">
              {found.hits.length === 0 && <li className="results-empty">No posts match{found.q.invalid.length ? ` (${found.q.invalid.join(' ')} not understood)` : ''}</li>}
              {found.hits.map((h, i) => {
                const n = d.ideas[h.id]!;
                const line = n.body.split('\n').find((l) => found.q.phrases.some((p) => l.toLowerCase().includes(p.toLowerCase())) || found.q.words.some((w) => l.toLowerCase().includes(w.toLowerCase()))) ?? n.body.split('\n')[0] ?? '';
                return (
                  <li key={h.id} id={`${resId}-${i}`} role="option" aria-selected={i === resActive} className={i === resActive ? 'on' : ''} onMouseEnter={() => setResActive(i)} onMouseDown={(e) => { e.preventDefault(); setJump(h.id); }}>
                    <span className="results-when">{dateOf(n.publishedAt ?? n.createdAt, tz)}</span>
                    <span className="results-text">
                      {highlight(line.slice(0, 140), found.q).map((sg, k) => (sg.hit ? <mark key={k}>{sg.text}</mark> : <span key={k}>{sg.text}</span>))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="log-tools">
          {projects.length > 0 && (
            <select className="log-select" aria-label="Show posts from" value={chip ?? ''} onChange={(e) => setChip(e.target.value || null)}>
              <option value="">All projects</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button className="log-btn" aria-expanded={calOpen} aria-controls="log-cal" onClick={() => setCalOpen(!calOpen)}>
            {calOpen ? 'Hide calendar' : 'Calendar'}
          </button>
          <button className="log-btn log-btn-primary" aria-keyshortcuts="W" onClick={onWrite} title="Write a post (W)">
            Write <kbd>W</kbd>
          </button>
        </div>
      </header>

      <Boundary what="the posts">
        <div className="read-scroll" tabIndex={-1}>
          <div className="read-col" role="feed" aria-label="Posts, newest first">
            {groups.length === 0 ? (
              <p className="feed-empty">{projectName ? `Nothing posted in ${projectName} yet.` : 'Nothing posted yet. Press Write to start the first post.'}</p>
            ) : (
              shown.map((g) => (
                <section key={g.date} className="day" aria-label={dayHeading(g.date, today)}>
                  <h2 className="day-h">{dayHeading(g.date, today)}</h2>
                  {g.posts.map((n) => (
                    <Post key={n.id} note={n} data={d} tz={tz} projectName={!chip && n.projectId ? (d.projects[n.projectId]?.name ?? null) : null} q={q} flash={flash === n.id} onEdit={onEdit} />
                  ))}
                </section>
              ))
            )}
            {shownCount < feed.length && (
              <button className="log-btn read-more" onClick={() => setLimit((l) => l + PAGE)}>Older posts</button>
            )}
          </div>
        </div>
      </Boundary>

      {calOpen && (
        <>
          <button className="drawer-scrim" aria-label="Close calendar" tabIndex={-1} onClick={() => setCalOpen(false)} />
          <aside
            className="log-drawer"
            id="log-cal"
            aria-label="Calendar and this month"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setCalOpen(false);
              }
            }}
          >
            <div className="drawer-bar">
              <span className="drawer-grip" aria-hidden="true" />
              <button className="log-btn log-btn-quiet" onClick={() => setCalOpen(false)}>Close</button>
            </div>
            <Boundary what="the calendar">
              <Calendar notes={allNotes} tz={tz} today={today} projectId={marksProject} projectName={markName} selected={selectedDay} onSelect={pickDay} />
            </Boundary>
            <Boundary what="this month's numbers">
              <Stats notes={allNotes} tz={tz} today={today} />
            </Boundary>
          </aside>
        </>
      )}
    </div>
  );
}
