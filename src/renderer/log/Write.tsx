// The Write view: one column, large text, a slim header. Autosaves a draft (this device at once, the data store after
// 1.5 s idle); Publish makes it a post. Editing an existing post opens here too (no draft record).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { analyzeBody, autoLines, wordCount } from '../../core/log';
import { bulletBackspace, bulletEnter } from '../../core/log/smartText';
import type { Command, Result } from '../../core/commands';
import type { Data } from '../../core/model/types';
import { run } from '../store';
import { queueLines } from './actions';
import { liveProjects, parseCtx } from './ctx';
import { discardDraft, editCommand, isTypingTarget, publishDraft, readLocalDraft, resumeDraft, saveDraft, wrapSelection, writeLocalDraft } from './logic';

const SAVE_AFTER_MS = 1500;

export interface WriteProps {
  data: Data;
  /** Edit this published post instead of starting a new one. */
  editId: string | null;
  /** The project a new post starts in. */
  defaultProject: string | null;
  /** True in a project view: the project is fixed. */
  locked: boolean;
  onProject: (id: string | null) => void;
  /** Leave Write. `postId` = a post was published or saved: Read highlights it. */
  onClose: (postId?: string) => void;
}

const storage = (): Storage | null => { try { return window.localStorage; } catch { return null; } };

export default function Write({ data, editId, defaultProject, locked, onProject, onClose }: WriteProps) {
  const dataRef = useRef(data);
  dataRef.current = data;
  const note = editId ? data.ideas[editId] : undefined;

  const init = useMemo(() => {
    if (note) return { id: note.id as string | null, body: note.body, projectId: note.projectId };
    const r = resumeDraft(data.ideas, readLocalDraft(storage()));
    return r ? { ...r, projectId: locked ? defaultProject : (r.projectId ?? defaultProject) } : { id: null as string | null, body: '', projectId: defaultProject };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [text, setText] = useState(init.body);
  const [projectId, setProjectId] = useState<string | null>(init.projectId);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const draftId = useRef<string | null>(editId ? null : init.id);
  const textRef = useRef(text);
  const projRef = useRef(projectId);
  const savedBody = useRef(note || init.id ? init.body : '');
  const savedProj = useRef(init.projectId);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const area = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<{ start: number; end: number } | null>(null);
  const done = useRef(false);

  const enqueue = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.current.then(fn, fn);
    chain.current = p.catch(() => undefined);
    return p;
  }, []);
  const quiet = (c: Command): Promise<Result> => run(c, true);
  const loud = (c: Command): Promise<Result> => run(c);

  const projects = useMemo(() => liveProjects(data), [data.projects]); // eslint-disable-line react-hooks/exhaustive-deps
  const words = useMemo(() => wordCount(text), [text]);

  /** Write what is typed to the data store now (a draft, or an edit of the post). */
  const flush = useCallback((): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const body = textRef.current.trim();
    const proj = projRef.current;
    if (!body || (body === savedBody.current.trim() && proj === savedProj.current)) return chain.current.then(() => undefined);
    setStatus('Saving…');
    return enqueue(async () => {
      if (editId) {
        const n = dataRef.current.ideas[editId];
        const c = n ? editCommand(n, body, proj) : null;
        if (c) await quiet(c);
      } else {
        draftId.current = await saveDraft(quiet, draftId.current, body, proj);
        writeLocalDraft(storage(), { id: draftId.current, body: textRef.current, projectId: proj, at: Date.now() });
      }
      savedBody.current = body;
      savedProj.current = proj;
      setStatus('Saved');
    });
  }, [editId, enqueue]);

  const change = (value: string, sel?: { start: number; end: number }) => {
    textRef.current = value;
    setText(value);
    if (sel) caret.current = sel;
    if (!editId) writeLocalDraft(storage(), { id: draftId.current, body: value, projectId: projRef.current, at: Date.now() });
    setStatus('');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
  };
  useLayoutEffect(() => {
    if (caret.current && area.current) {
      area.current.setSelectionRange(caret.current.start, caret.current.end);
      caret.current = null;
    }
  }, [text]);

  const pickProject = (id: string | null) => {
    projRef.current = id;
    setProjectId(id);
    onProject(id);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
  };

  const back = useCallback(async () => {
    if (done.current) return;
    done.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!editId && !textRef.current.trim()) {
      await enqueue(() => discardDraft(quiet, draftId.current));
      draftId.current = null;
      writeLocalDraft(storage(), null);
    } else await flush();
    onClose();
  }, [editId, enqueue, flush, onClose]);

  const publish = useCallback(async () => {
    const body = textRef.current.trim();
    if (!body || done.current) return;
    done.current = true;
    setBusy(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const proj = projRef.current;
    if (editId) {
      const n = dataRef.current.ideas[editId];
      const c = n ? editCommand(n, body, proj) : null;
      if (c) await enqueue(() => loud(c));
      onClose(editId);
      return;
    }
    const id = await enqueue(() => publishDraft(loud, draftId.current, body, proj));
    if (!id) {
      done.current = false;
      setBusy(false);
      return;
    }
    draftId.current = null;
    writeLocalDraft(storage(), null);
    const auto = autoLines(analyzeBody(body, parseCtx(dataRef.current), proj));
    if (auto.length) await queueLines({ id, parsedTaskIds: [] }, auto);
    onClose(id);
  }, [editId, enqueue, onClose]);

  // Second Esc (the first one blurs the field) goes back to Read; capture phase so the app's own Esc does not also act.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isTypingTarget(e.target) || document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      e.stopPropagation();
      void back();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [back]);

  // Leaving the page or the tab must not lose the last words.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden' && !done.current) void flush(); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      if (!done.current && timer.current) void flush();
    };
  }, [flush]);

  // Phone keyboard: size the screen to what is visible (guarded; 100dvh is the fallback).
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const el = root.current;
    if (!vv || !el) return;
    const fit = () => {
      el.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      el.style.setProperty('--vvt', `${Math.round(vv.offsetTop)}px`);
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
    };
  }, []);

  useEffect(() => { area.current?.focus(); area.current?.setSelectionRange(text.length, text.length); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    if (e.key === 'Escape') {
      e.stopPropagation();
      ta.blur();
      return;
    }
    if (e.nativeEvent.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      void publish();
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && (e.key === 'b' || e.key === 'B' || e.key === 'i' || e.key === 'I')) {
      e.preventDefault();
      const w = wrapSelection(ta.value, ta.selectionStart, ta.selectionEnd, e.key.toLowerCase() === 'b' ? '**' : '*');
      change(w.value, { start: w.start, end: w.end });
      return;
    }
    if (e.key === 'Enter' && !mod && !e.altKey && ta.selectionStart === ta.selectionEnd) {
      const b = bulletEnter(ta.value, ta.selectionStart);
      if (b) {
        e.preventDefault();
        change(b.value, { start: b.caret, end: b.caret });
      }
      return;
    }
    if (e.key === 'Backspace' && ta.selectionStart === ta.selectionEnd) {
      const b = bulletBackspace(ta.value, ta.selectionStart);
      if (b) {
        e.preventDefault();
        change(b.value, { start: b.caret, end: b.caret });
      }
    }
  };

  return (
    <div className="write" ref={root}>
      <header className="write-head">
        <button className="log-btn log-btn-quiet" onClick={() => void back()} aria-label="Back to Read" title="Back to Read (Esc, Esc)">
          <span aria-hidden="true">←</span> Read
        </button>
        <span className="write-spacer" />
        {!locked && (
          <select className="log-select" aria-label="Project" value={projectId ?? ''} onChange={(e) => pickProject(e.target.value || null)}>
            <option value="">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <span className="write-count" aria-live="off">{words.toLocaleString()} {words === 1 ? 'word' : 'words'}</span>
        <span className="write-status" role="status">{status}</span>
        <button className="log-btn log-btn-primary" disabled={busy || !text.trim()} onClick={() => void publish()} aria-keyshortcuts="Control+Enter Meta+Enter" title={editId ? 'Save (Ctrl+Enter)' : 'Publish (Ctrl+Enter)'}>
          {editId ? 'Save' : 'Publish'}
        </button>
      </header>
      <div className="write-col">
        <textarea
          ref={area}
          className="write-input"
          value={text}
          aria-label={editId ? 'Edit post' : 'Write a post'}
          placeholder="Write. End a line with TASK to add it to Tasks. - makes a list."
          spellCheck
          onChange={(e) => change(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
}
