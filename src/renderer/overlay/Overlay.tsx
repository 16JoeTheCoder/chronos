// Overlay (D-142): collapsed pill = mini signature timer + task title + time; expanded on hover =
// title, timer, Hold to finish. The window is focusable:false, so only the pointer reaches it.
// Also shows notices with Undo (Claude's changes, notepad results) when Home is not in front.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Notice } from '../../preload/api';
import type { Snapshot } from '../../core/model/types';
import { formatClock } from '../../core/format';
import { activeTask } from '../../core/tasks/tasks';
import { display } from '../../core/timer/timer';
import { api } from '../api';
import { createHold, HOLD_MS } from '../focus/hold';
import { SignatureTimer } from '../signature/SignatureTimer';
import { useNow } from '../store';
import { useOptionalTheme } from '../theme/ThemeProvider';

const NOTICE_MS = 8000;

export function Overlay({ snap }: { snap: Snapshot }) {
  const task = activeTask(snap.data);
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

  const open = hover || !!notice;
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
            <SignatureTimer mini progress={t.progress ?? 0} remainingSec={ms / 1000} running={running} overrun={over} />
            <button type="button" className="ov-title" onClick={() => api.win.overlayClick()} title="Open Chronos">{task.title}</button>
            {kind !== 'ticking-digits' && <span className="ov-time" role="timer">{time}</span>}
          </div>
          {open && !notice && (
            <button
              type="button"
              className="ov-hold"
              style={{ '--p': p } as React.CSSProperties}
              aria-label={`Hold to finish ${task.title}`}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); hold.current?.press('pointer'); }}
              onPointerUp={() => hold.current?.release()}
              onPointerCancel={() => hold.current?.release()}
            >
              <i className="ov-hold-fill" />
              <span>{p > 0 ? `${Math.max(1, Math.ceil((1 - p) * HOLD_MS / 1000))}s` : 'Hold to finish'}</span>
            </button>
          )}
        </>
      ) : (
        !notice && <p className="ov-idle">Nothing in focus</p>
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
