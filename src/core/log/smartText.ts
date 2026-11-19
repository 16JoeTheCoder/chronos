// Editing rules for the plain-text editors (notepad, Log composer, Focus notes), Phase 3.7 §7.
// Pure: given the text and the caret, return the new text and caret, or null for "not mine".
//
//   "- " starts a bullet. Enter continues it; Enter or Backspace on an empty bullet ends the list.
//   A line ending in " TASK" (capitals), on Enter, becomes a task: the title is the line without TASK.
//   A line starting "TASK ", on Enter, becomes a task parsed from the rest; TASK is removed.
//   Backspace right after a conversion undoes it and puts TASK back (the caller keeps that state).

export interface Edit { value: string; caret: number }

const lineBounds = (value: string, caret: number): { start: number; end: number; line: string } => {
  const start = value.lastIndexOf('\n', caret - 1) + 1;
  const nl = value.indexOf('\n', caret);
  const end = nl < 0 ? value.length : nl;
  return { start, end, line: value.slice(start, end) };
};

const BULLET = /^(\s*)([-*]) (.*)$/;

/** Enter inside a bullet line: continue the list, or end it on an empty bullet. */
export function bulletEnter(value: string, caret: number): Edit | null {
  const { start, end, line } = lineBounds(value, caret);
  const m = BULLET.exec(line);
  if (!m) return null;
  if (!m[3]!.trim()) {
    // Empty bullet: end the list (the line becomes empty, no new line).
    return { value: value.slice(0, start) + value.slice(end), caret: start };
  }
  const insert = `\n${m[1]}${m[2]} `;
  return { value: value.slice(0, caret) + insert + value.slice(caret), caret: caret + insert.length };
}

/** Backspace right after the "- " of an empty bullet: remove the bullet marker. */
export function bulletBackspace(value: string, caret: number): Edit | null {
  const { start, line } = lineBounds(value, caret);
  const m = /^(\s*)([-*]) $/.exec(line);
  if (!m || caret !== start + line.length) return null;
  return { value: value.slice(0, start) + m[1] + value.slice(caret), caret: start + m[1]!.length };
}

export interface TaskLine {
  /** Where the line starts and ends in the text. */
  start: number;
  end: number;
  /** The line as typed (with TASK). */
  original: string;
  /** The text the task is made from (TASK removed). */
  body: string;
  /** 'end': the title is the body as it is (parsed for date and priority); 'start': the parser reads the body. */
  where: 'start' | 'end';
}

/** Is the caret's line a TASK line? (Checked on Enter.) */
export function taskLineAt(value: string, caret: number): TaskLine | null {
  const { start, end, line } = lineBounds(value, caret);
  if (caret !== end) return null;
  const s = /^(\s*(?:[-*] )?)TASK\s+(\S.*)$/.exec(line);
  if (s) return { start, end, original: line, body: s[2]!.trim(), where: 'start' };
  const e = /^(\s*(?:[-*] )?)(\S.*?)\s+TASK\s*$/.exec(line);
  if (e) return { start, end, original: line, body: e[2]!.trim(), where: 'end' };
  return null;
}

/** Replace the TASK line with its body (the text stays, TASK goes) and put the caret on a new line after it. */
export function applyTaskLine(value: string, t: TaskLine): Edit {
  const prefix = /^(\s*(?:[-*] )?)/.exec(t.original)?.[1] ?? '';
  const line = `${prefix}${t.body}`;
  const next = value.slice(0, t.start) + line + '\n' + value.slice(t.end);
  return { value: next, caret: t.start + line.length + 1 };
}

/** Undo a conversion: the line as typed (with TASK) comes back; the caret sits at its end. */
export function undoTaskLine(value: string, t: TaskLine): Edit {
  const prefix = /^(\s*(?:[-*] )?)/.exec(t.original)?.[1] ?? '';
  const line = `${prefix}${t.body}`;
  const at = value.indexOf(line + '\n', Math.max(0, t.start - 1));
  if (at < 0) return { value, caret: value.length };
  const next = value.slice(0, at) + t.original + value.slice(at + line.length + 1);
  return { value: next, caret: at + t.original.length };
}
