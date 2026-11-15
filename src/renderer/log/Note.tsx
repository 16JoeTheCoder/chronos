// One sticky-note card: the post, its task lines as checkboxes, "edited", edit-in-place.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { analyzeBody, decodeLinks, encodeLinks, highlight, isEdited, relink, splitLines, stripPrefix, tickCommand, tickState, type LogQuery } from '../../core/log';
import type { Data, Idea } from '../../core/model/types';
import { Icon } from '../components/Icon';
import { run } from '../store';
import { queueLines } from './actions';
import { parseCtx } from './ctx';

const SAVE_AFTER_MS = 700;
const isTaskLine = (l: string) => stripPrefix(l).explicit;

function Marked({ text, q }: { text: string; q: Pick<LogQuery, 'words' | 'phrases'> | null }) {
  if (!q || (!q.words.length && !q.phrases.length)) return <>{text}</>;
  return (
    <>
      {highlight(text, q).map((s, i) => (s.hit ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))}
    </>
  );
}

export interface NoteProps {
  note: Idea;
  data: Data;
  label: string;
  projectName: string | null;
  q: Pick<LogQuery, 'words' | 'phrases'> | null;
  flash: boolean;
  onHeight: (id: string, h: number) => void;
}

function NoteCard({ note, data, label, projectName, q, flash, onHeight }: NoteProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const draftRef = useRef(draft);
  const noteRef = useRef(note);
  noteRef.current = note;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    onHeight(note.id, el.offsetHeight);
    const ro = new ResizeObserver(() => onHeight(note.id, el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [note.id, onHeight]);

  const save = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const n = noteRef.current;
    const body = draftRef.current.trim();
    if (!body || body === n.body) return;
    const links = relink(n.body, body, decodeLinks(n.parsedTaskIds), isTaskLine);
    void run({ type: 'idea.edit', id: n.id, body, parsedTaskIds: encodeLinks(links, n.parsedTaskIds) }, true);
  };
  // Leaving the card (scrolled away, unmounted) must not lose a pending edit.
  useEffect(() => () => { if (timer.current) save(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onDraft = (v: string) => {
    setDraft(v);
    draftRef.current = v;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_AFTER_MS);
  };
  const startEdit = () => {
    setDraft(note.body);
    draftRef.current = note.body;
    setEditing(true);
  };
  const stopEdit = () => {
    save();
    setEditing(false);
  };

  const links = useMemo(() => decodeLinks(note.parsedTaskIds), [note.parsedTaskIds]);
  const lines = useMemo(() => (editing ? [] : splitLines(note.body)), [note.body, editing]);
  const hasTasks = lines.some((l, i) => links.has(i) || isTaskLine(l));
  const analysed = useMemo(() => (editing ? [] : analyzeBody(note.body, parseCtx(data), note.projectId)), [note.body, note.projectId, editing, data.settings, data.projects, data.tags]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={wrap} className="log-row">
      <article id={`log-post-${note.id}`} tabIndex={-1} className={`note${hasTasks ? ' note-tasks' : ''}${flash ? ' note-flash' : ''}`} aria-label={`Post, ${label}`}>
        <header className="note-head">
          <span className="note-when">{label}</span>
          {projectName && <span className="note-project">{projectName}</span>}
          {isEdited(note) && <span className="note-edited">edited</span>}
          <span className="note-spacer" />
          {editing ? (
            <button className="log-btn" onClick={stopEdit}>
              Done
            </button>
          ) : (
            <button className="log-btn log-btn-quiet" onClick={startEdit} aria-label={`Edit post from ${label}`}>
              Edit
            </button>
          )}
        </header>
        {editing ? (
          <textarea
            className="note-edit"
            value={draft}
            autoFocus
            rows={Math.min(14, Math.max(3, draft.split('\n').length + 1))}
            aria-label="Edit post"
            onChange={(e) => onDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                stopEdit();
              }
            }}
          />
        ) : (
          <div className="note-body">
            {lines.map((raw, i) => {
              const tid = links.get(i);
              const task = tid ? data.tasks[tid] : undefined;
              const st = tid ? tickState(task) : 'gone';
              const info = analysed[i];
              if (tid && st !== 'gone' && task) {
                const done = st === 'done';
                return (
                  <div key={i} className={`note-line note-task${done ? ' is-done' : ''}`}>
                    <button
                      role="checkbox"
                      aria-checked={done}
                      className="tick"
                      aria-label={done ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`}
                      onClick={() => {
                        const c = tickCommand(task);
                        if (c) void run(c);
                      }}
                    >
                      <span className="tick-box" aria-hidden="true">
                        {done && <Icon name="check" size={14} />}
                      </span>
                    </button>
                    <span className="note-text">
                      <Marked text={stripPrefix(raw).body || raw} q={q} />
                    </span>
                  </div>
                );
              }
              if (!raw.trim()) return <div key={i} className="note-gap" />;
              const offer = info && (info.kind === 'chip' || (info.kind === 'task' && info.explicit));
              return (
                <div key={i} className={`note-line${offer && info.explicit ? ' note-task' : ''}`}>
                  {offer && info.explicit && (
                    <span className="tick" aria-hidden="true">
                      <span className="tick-box tick-off" />
                    </span>
                  )}
                  <span className="note-text">
                    <Marked text={info?.explicit ? info.body : raw} q={q} />
                  </span>
                  {offer && info && (
                    <button className="chip-ask" onClick={() => void queueLines(note, [info], { toastText: () => 'Added to your queue' })}>
                      Add as task?
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </article>
    </div>
  );
}

export const Note = memo(NoteCard);
