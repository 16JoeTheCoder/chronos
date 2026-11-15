// The post box. Enter posts (one write, nothing is written while typing); Shift+Enter is a newline.
// `/p` or `/project` (or Ctrl+Shift+P) opens the project list: arrows, Enter.
import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { analyzeBody, autoLines } from '../../core/log';
import type { Data } from '../../core/model/types';
import { run } from '../store';
import { queueLines } from './actions';
import { liveProjects, parseCtx } from './ctx';

export interface ComposerHandle {
  focus(): void;
}

interface Props {
  data: Data;
  /** The project new posts go to. */
  projectId: string | null;
  /** True in a project view: the project is fixed. */
  locked: boolean;
  onProject: (id: string | null) => void;
  onPosted: (id: string) => void;
}

const SLASH = /(?:^|\n)\/(p|project)(?:\s+([^\n]*))?$/i;

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ data, projectId, locked, onProject, onPosted }, ref) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(false);
  const [active, setActive] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus() }));

  const slash = locked ? null : SLASH.exec(text);
  const open = !locked && (pick || slash !== null);
  const filter = (slash?.[2] ?? '').trim().toLowerCase();
  const projects = useMemo(() => liveProjects(data), [data.projects]); // eslint-disable-line react-hooks/exhaustive-deps
  const options = useMemo(() => [{ id: null as string | null, name: 'No project' }, ...projects.map((p) => ({ id: p.id as string | null, name: p.name }))].filter((o) => !filter || o.name.toLowerCase().includes(filter)), [projects, filter]);
  const current = projectId ? data.projects[projectId] : undefined;

  useEffect(() => setActive(0), [filter, open]);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const close = () => setPick(false);
  const choose = (id: string | null) => {
    onProject(id);
    if (slash) setText((t) => t.slice(0, slash.index + (t[slash.index] === '\n' ? 1 : 0)));
    setPick(false);
    area.current?.focus();
  };

  const post = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    const r = await run({ type: 'idea.add', text: body, taskId: null, projectId });
    setBusy(false);
    if (!r.ok || !r.id) return;
    setText('');
    onPosted(r.id);
    const auto = autoLines(analyzeBody(body, parseCtx(data), projectId));
    if (auto.length) await queueLines({ id: r.id, parsedTaskIds: [] }, auto);
    area.current?.focus();
  };

  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          ref={area}
          className="composer-input"
          rows={2}
          value={text}
          placeholder="What is on your mind? Start a line with - to queue a task."
          aria-label="Write a post"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'P' && e.ctrlKey && e.shiftKey && !locked) {
              e.preventDefault();
              setPick((v) => !v);
              return;
            }
            if (open) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % Math.max(1, options.length));
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (options[active]) choose(options[active]!.id);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void post();
            }
          }}
        />
        {open && (
          <ul className="picker" role="listbox" id={listId} aria-label="Project">
            {options.length === 0 && <li className="picker-empty">No project matches</li>}
            {options.map((o, i) => (
              <li key={o.id ?? 'none'} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={i === active ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); choose(o.id); }} onMouseEnter={() => setActive(i)}>
                {o.name}
                {o.id === projectId && <span className="picker-cur"> current</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="composer-bar">
        {locked ? (
          <span className="composer-proj">{current?.name ?? 'Project'}</span>
        ) : (
          <button type="button" className="log-btn log-btn-quiet" onClick={() => setPick((v) => !v)} aria-haspopup="listbox" aria-expanded={open} title="Choose project (Ctrl+Shift+P, or type /p)">
            {current ? current.name : 'No project'}
          </button>
        )}
        <span className="composer-hint">Enter to post · Shift+Enter for a new line</span>
        <button type="button" className="log-btn log-btn-primary" onClick={() => void post()} disabled={!text.trim() || busy}>
          Post
        </button>
      </div>
    </div>
  );
});
