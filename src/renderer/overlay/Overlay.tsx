// Overlay pill (D-145, Phase 3.5 §7): mini signature timer + task title + time, docked in the
// taskbar. Hover never expands it: the title crossfades to Pause/Resume (click toggles the timer).
// Holding the mini timer for 2 s finishes the task (fill while held, drain on early release).
// The window is focusable:false, so only the pointer reaches it. It grows only for a notice with Undo.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Notice } from '../../preload/api';
import type { Snapshot } from '../../core/model/types';
import { formatClock } from '../../core/format';
import { pillModel } from '../../core/tasks/screens';
import { display } from '../../core/timer/timer';
import { api } from '../api';
import { createHold, HOLD_MS } from '../focus/hold';
import { SignatureTimer } from '../signature/SignatureTimer';
import { useNow } from '../store';
import { useOptionalTheme } from '../theme/ThemeProvider';

const NOTICE_MS = 8000;

export function Overlay({ snap }: { snap: Snapshot }) {
  const coarse = useNow(30_000);
  const { task, planned, classNow } = pillModel(snap.data, coarse);
  const running = task?.runtime.status === 'running';
  const now = useNow(running ? 250 : 30_000);
  const kind = useOptionalTheme()?.theme.motion.signature.kind;
  const [hover, setHover] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [p, setP] = useState(0);
  const hold = useRef<ReturnType<typeof createHold> | null>(null);
  const taskId = task?.id;

  useEffect(() => api.onNotice((n) => setNotice(n)), []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  const open = !!notice;
  useEffect(() => api.win.overlayExpand(open), [open]);

  hold.current = useMemo(() => createHold({ onProgress: setP, onComplete: () => taskId && void api.command({ type: 'task.finish', id: taskId }) }), [taskId]);
  useEffect(() => () => hold.current?.cancel(), []);

  const t = task ? display(task, now) : null;
  const over = !!t && t.overtime > 0;
  const ms = t ? (t.remaining !== null ? (over ? t.overtime : t.remaining) : t.elapsed) : 0;
  const time = (over ? '+' : '') + formatClock(ms);

  const undo = (n: Notice) => {
    if (n.undoToken) void api.command({ type: 'mcp.undo', token: n.undoToken });
    setNotice(null);
  };

  return (
    <div className="ov" data-open={open} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      {task && t ? (
        <>
          <div className="ov-row">
            <button
              type="button"
              className="ov-icon"
              style={{ '--p': p } as React.CSSProperties}
              aria-label={`Hold 2 seconds to finish ${task.title}`}
              title="Hold to finish"
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); hold.current?.press('pointer'); }}
              onPointerUp={() => hold.current?.release()}
              onPointerCancel={() => hold.current?.release()}
            >
              <SignatureTimer mini progress={t.progress ?? 0} remainingSec={ms / 1000} running={running} overrun={over} />
              <i className="ov-icon-fill" aria-hidden="true" />
            </button>
            <button type="button" className="ov-title" data-hover={hover} data-two={!!classNow} onClick={() => void api.command({ type: 'timer', action: running ? 'pause' : task.runtime.status === 'paused' ? 'resume' : 'start' })} aria-label={running ? 'Pause' : 'Resume'}>
              <span className="ov-t-name">{p > 0 ? `Finishing… ${Math.max(1, Math.ceil((1 - p) * HOLD_MS / 1000))}s` : task.title}</span>
              {classNow && <span className="ov-t-class">In class: {classNow}</span>}
              <span className="ov-t-act" aria-hidden="true">{running ? 'Pause' : 'Resume'}</span>
            </button>
            {kind !== 'ticking-digits' && <span className="ov-time" role="timer">{time}</span>}
          </div>
        </>
      ) : (
        !notice && <p className="ov-idle">{planned ? `Planned now: ${planned.title}` : 'Nothing in focus'}{classNow && <span className="ov-t-class">In class: {classNow}</span>}</p>
      )}
      {notice && (
        <div className="ov-notice" role="status">
          <span>{notice.text}</span>
          {notice.undoToken && <button type="button" onClick={() => undo(notice)}>Undo</button>}
        </div>
      )}
    </div>
  );
}
