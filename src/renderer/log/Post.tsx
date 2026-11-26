// One post in the Read view: time, project, body as markdown-light, task chips that tick the real task.
import { memo, useMemo } from 'react';
import { analyzeBody, decodeLinks, isEdited, splitLines, stripPrefix, tickCommand, tickState, type LogQuery } from '../../core/log';
import type { Data, Idea } from '../../core/model/types';
import { localParts } from '../../core/time/zone';
import { Icon } from '../components/Icon';
import { AttachList } from '../files/Attachments';
import { run } from '../store';
import { queueLines } from './actions';
import { parseCtx } from './ctx';
import { Inlines, Md } from './Md';

export interface PostProps {
  note: Idea;
  data: Data;
  tz: string;
  projectName: string | null;
  q: Pick<LogQuery, 'words' | 'phrases'> | null;
  flash: boolean;
  onEdit: (id: string) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

function PostCard({ note, data, tz, projectName, q, flash, onEdit }: PostProps) {
  const p = localParts(note.publishedAt ?? note.createdAt, tz);
  const time = `${pad(p.hour)}:${pad(p.minute)}`;
  const links = useMemo(() => decodeLinks(note.parsedTaskIds), [note.parsedTaskIds]);
  const lines = useMemo(() => splitLines(note.body), [note.body]);
  const analysed = useMemo(() => analyzeBody(note.body, parseCtx(data), note.projectId), [note.body, note.projectId, data.settings, data.projects, data.tags]); // eslint-disable-line react-hooks/exhaustive-deps
  // Lines that look like tasks but were not marked: one quiet offer in the header (D-166), never inline in the text.
  const offers = analysed.filter((info, i) => info && !links.has(i) && info.input && (info.kind === 'chip' || (info.kind === 'task' && info.explicit)));

  // Task lines become chips; everything between them is markdown-light.
  const parts: JSX.Element[] = [];
  let run_: string[] = [];
  const flushRun = (key: string) => {
    if (run_.some((l) => l.trim())) parts.push(<Md key={key} lines={run_} q={q} />);
    run_ = [];
  };
  lines.forEach((raw, i) => {
    const tid = links.get(i);
    const task = tid ? data.tasks[tid] : undefined;
    const st = tid ? tickState(task) : 'gone';
    if (tid && st !== 'gone' && task) {
      flushRun(`m${i}`);
      const done = st === 'done';
      parts.push(
        <div key={`t${i}`} className={`post-task${done ? ' is-done' : ''}`}>
          <button
            role="checkbox"
            aria-checked={done}
            className="post-tick"
            aria-label={done ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`}
            onClick={() => {
              const c = tickCommand(task);
              if (c) void run(c);
            }}
          >
            <span className="tick-box" aria-hidden="true">{done && <Icon name="check" size={14} />}</span>
            <span className="post-task-tag">Task</span>
          </button>
          <span className="post-task-text"><Inlines text={stripPrefix(raw).body || raw} q={q} /></span>
        </div>,
      );
      return;
    }
    const info = analysed[i];
    if (info?.explicit && info.body) {
      // Marked as a task but not queued (yet): the chip shows, the box is dashed.
      flushRun(`m${i}`);
      parts.push(
        <div key={`u${i}`} className="post-task is-pending">
          <span className="post-tick" aria-hidden="true">
            <span className="tick-box tick-off" />
            <span className="post-task-tag">Task</span>
          </span>
          <span className="post-task-text"><Inlines text={info.body} q={q} /></span>
        </div>,
      );
      return;
    }
    run_.push(raw);
  });
  flushRun('end');

  return (
    <article id={`log-post-${note.id}`} tabIndex={-1} className={`post${flash ? ' is-new' : ''}`} aria-label={`Post, ${time}`}>
      <header className="post-head">
        <time className="post-time">{time}</time>
        {projectName && <span className="post-project">{projectName}</span>}
        {isEdited(note) && <span className="post-edited">edited</span>}
        <span className="post-spacer" />
        {offers.length > 0 && (
          <button className="post-link post-offer" onClick={() => void queueLines(note, offers, { toastText: (n) => (n === 1 ? 'Added to your tasks' : `Added ${n} tasks`) })} title={offers.map((o) => o.body).join('\n')}>
            {offers.length === 1 ? 'Add as task?' : `Add ${offers.length} as tasks?`}
          </button>
        )}
        <button className="post-link" onClick={() => onEdit(note.id)} aria-label={`Edit post from ${time}`}>Edit</button>
      </header>
      <div className="post-body">{parts}</div>
      <AttachList files={note.files} area="log" />
    </article>
  );
}

export const Post = memo(PostCard);
