// The Log: two views of one stream. Read (a blog of your posts) is the default; Write (a quiet editor, its own chunk)
// opens from the Write button or W, and returns here. Which view is showing is local state: Home's props are unchanged.
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { activeTask, todayOf } from '../../core/tasks/tasks';
import { settingsOf } from '../../core/repo/repo';
import { run, useSnap } from '../store';
import { Read } from './Read';
import './log.css';

const Write = lazy(() => import('./Write'));

export interface LogProps {
  /** Project view: only this project's posts, and new posts go to it. */
  projectId?: string | null;
  /** Scroll to and highlight this post on open. */
  focusPostId?: string;
}

type View = { mode: 'read' } | { mode: 'write'; editId: string | null };

export function Log({ projectId = null, focusPostId }: LogProps) {
  const snap = useSnap();
  if (!snap) {
    return (
      <section className="log" aria-label="Log" aria-busy="true">
        <p className="feed-empty">Loading the Log…</p>
      </section>
    );
  }
  return <LogView snap={snap} projectId={projectId} focusPostId={focusPostId} />;
}

function LogView({ snap, projectId, focusPostId }: { snap: NonNullable<ReturnType<typeof useSnap>>; projectId: string | null; focusPostId?: string }) {
  const d = snap.data;
  const tz = settingsOf(d).timezone;
  const today = todayOf(d, Date.now());
  const [view, setView] = useState<View>({ mode: 'read' });
  const [landed, setLanded] = useState<string | undefined>(focusPostId);
  useEffect(() => setLanded(focusPostId), [focusPostId]);

  // New posts go to the project last used on this device; a project view fixes it; the focused task's project is followed.
  const remembered = snap.device.composerProjectId && d.projects[snap.device.composerProjectId]?.deletedAt === null ? snap.device.composerProjectId : null;
  const composerProject = projectId ?? remembered;
  const setComposerProject = useCallback((id: string | null) => void run({ type: 'device.update', patch: { composerProjectId: id } }, true), []);
  const focusedProject = activeTask(d)?.projectId ?? null;
  const lastFollowed = useRef<string | null>(null);
  useEffect(() => {
    if (projectId !== null || !focusedProject || lastFollowed.current === focusedProject) return;
    lastFollowed.current = focusedProject;
    if (focusedProject !== snap.device.composerProjectId) setComposerProject(focusedProject);
  }, [focusedProject, projectId, snap.device.composerProjectId, setComposerProject]);

  const openWrite = useCallback(() => setView({ mode: 'write', editId: null }), []);
  const openEdit = useCallback((id: string) => setView({ mode: 'write', editId: id }), []);
  const close = useCallback((postId?: string) => {
    setLanded(postId);
    setView({ mode: 'read' });
  }, []);

  return (
    <section className={`log is-${view.mode}`} aria-label={view.mode === 'write' ? 'Write' : 'Log'}>
      {view.mode === 'read' ? (
        <Read data={d} tz={tz} today={today} projectId={projectId} composerProject={composerProject} focusPostId={landed} onWrite={openWrite} onEdit={openEdit} />
      ) : (
        <Suspense fallback={<p className="feed-empty write-loading">Opening the editor…</p>}>
          <Write data={d} editId={view.editId} defaultProject={composerProject} locked={projectId !== null} onProject={setComposerProject} onClose={close} />
        </Suspense>
      )}
    </section>
  );
}
