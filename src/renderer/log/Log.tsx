// The Log: a chronological feed of notes (newest first), one stream for check-ins and task notes.
import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { feedOf, indexForDay, isEmptyQuery, offsetOf, parseQuery, searchLog, visibleRange, highlight } from '../../core/log';
import { SearchIndex } from '../../core/search';
import { activeTask, todayOf } from '../../core/tasks/tasks';
import { addDays, dateOf } from '../../core/time/zone';
import { settingsOf } from '../../core/repo/repo';
import { run, useSnap } from '../store';
import { Calendar } from './Calendar';
import { Composer, type ComposerHandle } from './Composer';
import { whenLabel } from './ctx';
import { Note } from './Note';
import './log.css';

export interface LogProps {
  /** Project view: only this project's posts, and new posts go to it. */
  projectId?: string | null;
  /** Scroll to and highlight this post on open. */
  focusPostId?: string;
}

const EST_HEIGHT = 150;

export function Log({ projectId = null, focusPostId }: LogProps) {
  const snap = useSnap();
  if (!snap) return null;
  return <LogView snap={snap} projectId={projectId} focusPostId={focusPostId} />;
}

function LogView({ snap, projectId, focusPostId }: { snap: NonNullable<ReturnType<typeof useSnap>>; projectId: string | null; focusPostId?: string }) {
  const d = snap.data;
  const s = settingsOf(d);
  const tz = s.timezone;
  const now = Date.now();
  const today = todayOf(d, now);
  const yesterday = addDays(today, -1);

  // ---- composer project: remembered per device, follows the focused task ----
  const remembered = snap.device.composerProjectId && d.projects[snap.device.composerProjectId]?.deletedAt === null ? snap.device.composerProjectId : null;
  const composerProject = projectId ?? remembered;
  const setComposerProject = useCallback((id: string | null) => void run({ type: 'device.update', patch: { composerProjectId: id } }, true), []);
  const focused = activeTask(d);
  const focusedProject = focused?.projectId ?? null;
  const lastFollowed = useRef<string | null>(null);
  useEffect(() => {
    if (projectId !== null || !focusedProject || lastFollowed.current === focusedProject) return;
    lastFollowed.current = focusedProject;
    if (focusedProject !== snap.device.composerProjectId) setComposerProject(focusedProject);
  }, [focusedProject, projectId, snap.device.composerProjectId, setComposerProject]);

  // ---- feed ----
  const feed = useMemo(() => feedOf(d.ideas, projectId), [d.ideas, projectId]);
  const allNotes = useMemo(() => Object.values(d.ideas), [d.ideas]);
  const heights = useRef(new Map<string, number>());
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const raf = useRef(0);
  const onHeight = useCallback((id: string, h: number) => {
    if (heights.current.get(id) === h) return;
    heights.current.set(id, h);
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => bump());
  }, []);
  const hs = feed.map((n) => heights.current.get(n.id) ?? EST_HEIGHT);
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(700);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setViewport(el.clientHeight);
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const range = visibleRange(hs, scrollTop, viewport);

  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollToIndex = useCallback(
    (i: number, id?: string) => {
      const el = scroller.current;
      if (!el || i < 0) return;
      el.scrollTop = offsetOf(hs, i);
      setScrollTop(el.scrollTop);
      // Row heights are estimates until measured: settle once after layout.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const hh = feed.map((n) => heights.current.get(n.id) ?? EST_HEIGHT);
          el.scrollTop = offsetOf(hh, i);
          setScrollTop(el.scrollTop);
          if (id) document.getElementById(`log-post-${id}`)?.focus({ preventScroll: true });
        }),
      );
      if (id) {
        setFlash(id);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(null), 1800);
      }
    },
    [hs, feed],
  );
  const jumpTo = useCallback((id: string) => scrollToIndex(feed.findIndex((n) => n.id === id), id), [feed, scrollToIndex]);

  const focusedOnce = useRef<string | null>(null);
  useEffect(() => {
    if (focusPostId && focusedOnce.current !== focusPostId && feed.some((n) => n.id === focusPostId)) {
      focusedOnce.current = focusPostId;
      jumpTo(focusPostId);
    }
  }, [focusPostId, feed, jumpTo]);

  // ---- calendar ----
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [calOpen, setCalOpen] = useState(false);
  const pickDay = (date: string) => {
    setSelectedDay(date);
    scrollToIndex(indexForDay(feed, date, tz));
  };

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
  const composer = useRef<ComposerHandle>(null);

  const projectName = projectId ? (d.projects[projectId]?.name ?? null) : null;
  const marksProject = projectId ?? composerProject;
  const markName = marksProject ? (d.projects[marksProject]?.name ?? null) : null;
  const q = found ? found.q : null;

  return (
    <section className="log" aria-label="Log">
      <header className="log-head">
        <h1>{projectName ? `Log · ${projectName}` : 'Log'}</h1>
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
                jumpTo(found.hits[resActive]!.id);
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
                  <li key={h.id} id={`${resId}-${i}`} role="option" aria-selected={i === resActive} className={i === resActive ? 'on' : ''} onMouseEnter={() => setResActive(i)} onMouseDown={(e) => { e.preventDefault(); jumpTo(h.id); }}>
                    <span className="results-when">{dateOf(n.createdAt, tz)}</span>
                    <span className="results-text">
                      {highlight(line.slice(0, 140), found.q).map((sg, k) => (sg.hit ? <mark key={k}>{sg.text}</mark> : <span key={k}>{sg.text}</span>))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <button className="log-btn cal-toggle" aria-expanded={calOpen} aria-controls="log-cal" onClick={() => setCalOpen((v) => !v)}>
          Calendar
        </button>
      </header>
      <div className="log-main">
        <div className="log-col">
          <Composer
            ref={composer}
            data={d}
            projectId={composerProject}
            locked={projectId !== null}
            onProject={setComposerProject}
            onPosted={() => {
              setSelectedDay(null);
              if (scroller.current) scroller.current.scrollTop = 0;
            }}
          />
          <div
            className="feed"
            ref={scroller}
            onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
            tabIndex={-1}
            role="feed"
            aria-label="Posts, newest first"
            aria-busy={false}
          >
            {feed.length === 0 ? (
              <p className="feed-empty">{projectName ? `Nothing posted in ${projectName} yet.` : 'Nothing posted yet. Write the first line above.'}</p>
            ) : (
              <div className="feed-spacer" style={{ height: range.total }}>
                <div className="feed-window" style={{ transform: `translateY(${range.top}px)` }}>
                  {feed.slice(range.start, range.end).map((n) => (
                    <Note
                      key={n.id}
                      note={n}
                      data={d}
                      label={whenLabel(n.createdAt, tz, today, yesterday)}
                      projectName={!projectId && n.projectId ? (d.projects[n.projectId]?.name ?? null) : null}
                      q={q}
                      flash={flash === n.id}
                      onHeight={onHeight}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <aside className={`log-side${calOpen ? ' open' : ''}`} id="log-cal" aria-label="Calendar">
          <Calendar notes={allNotes} tz={tz} today={today} projectId={marksProject} projectName={markName} selected={selectedDay} onSelect={pickDay} />
        </aside>
      </div>
    </section>
  );
}
