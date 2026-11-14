// MCP tool definitions (docs/MCP.md): names, descriptions and strict JSON input
// schemas. Shared by the stdio bridge (which must list tools even when Chronos is
// closed) and the handlers. Pure data, no Node or Electron.

export type JsonSchema =
  | { type: 'string'; description?: string; enum?: readonly string[]; pattern?: string; maxLength?: number; minLength?: number }
  | { type: 'integer'; description?: string; minimum?: number; maximum?: number }
  | { type: 'boolean'; description?: string }
  | { type: 'array'; description?: string; items: JsonSchema; maxItems?: number }
  | { type: 'object'; description?: string; properties: Record<string, JsonSchema>; required?: readonly string[]; additionalProperties: false };

export interface ToolDef {
  name: string;
  description: string;
  write: boolean;
  inputSchema: Extract<JsonSchema, { type: 'object' }>;
}

const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Local date, YYYY-MM-DD.' } as const;
const ID = { type: 'string', pattern: '^[\\w:.-]{1,160}$' } as const;
const MINUTE = (what: string) => ({ type: 'integer', minimum: 0, maximum: 1440, description: `${what}: minutes after local midnight (870 = 14:30).` }) as const;
const HM = { type: 'string', pattern: '^\\d{1,2}:\\d{2}$', description: 'Local time HH:MM.' } as const;
const obj = (properties: Record<string, JsonSchema>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false }) as const;
const RECURRENCE = obj(
  {
    freq: { type: 'string', enum: ['daily', 'weekly'] },
    interval: { type: 'integer', minimum: 1, maximum: 52, description: 'Every n days or weeks.' },
    weekdays: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 7 }, maxItems: 7, description: 'Weekly only: 1 = Monday .. 7 = Sunday.' },
  },
  ['freq', 'interval'],
);
const STATUS = { type: 'string', enum: ['inbox', 'planned', 'doing', 'done', 'dropped'] } as const;
const PRIORITY = { type: 'string', enum: ['must', 'should', 'nice'] } as const;
const COLOR = { type: 'string', enum: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7', 'tag8'] } as const;

const TASK_FIELDS = {
  title: { type: 'string', minLength: 1, maxLength: 120 },
  finishCondition: { type: 'string', maxLength: 500, description: 'What "finished" looks like (8+ characters, or empty). Needed before the task can be focused.' },
  notes: { type: 'string', maxLength: 5000 },
  tag: { type: 'string', maxLength: 60, description: 'Tag name (case-insensitive) or id.' },
  projectId: ID,
  priority: PRIORITY,
  estimateMin: { type: 'integer', minimum: 1, maximum: 1440 },
  dueDate: DATE,
  dueTime: HM,
  recurrence: RECURRENCE,
} as const;

export const TOOLS: ToolDef[] = [
  // ---- Read ----
  { name: 'get_day', write: false, description: 'One day: fixed events (after per-day exceptions), planned blocks, free gaps, the end-of-day buffer, time left and prep nudges. Times are local wall time in the stated time zone.', inputSchema: obj({ date: DATE }) },
  { name: 'get_week', write: false, description: 'Seven compact days starting at startDate (default: this week\'s Monday): events, blocks and free minutes per day.', inputSchema: obj({ startDate: DATE }) },
  {
    name: 'list_tasks',
    write: false,
    description: 'Tasks matching every given filter, most urgent first. overdue = open and due before today; unscheduled = open with no block today or later.',
    inputSchema: obj({ status: STATUS, projectId: ID, tag: { type: 'string', maxLength: 60 }, dueBefore: DATE, dueAfter: DATE, overdue: { type: 'boolean' }, unscheduled: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 200 } }),
  },
  { name: 'get_task', write: false, description: 'One task in full, with its blocks, total tracked time and recurrence.', inputSchema: obj({ id: ID }, ['id']) },
  {
    name: 'search',
    write: false,
    description: 'Fuzzy, prefix search over tasks, notes, projects and events (title weighs most). Deleted items are excluded.',
    inputSchema: obj({ query: { type: 'string', minLength: 1, maxLength: 200 }, types: { type: 'array', items: { type: 'string', enum: ['task', 'note', 'project', 'event'] }, maxItems: 4 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, ['query']),
  },
  { name: 'list_projects', write: false, description: 'Projects (not archived) with their columns and card counts.', inputSchema: obj({}) },
  { name: 'get_project', write: false, description: 'One project: its columns with ordered cards (tasks).', inputSchema: obj({ id: ID }, ['id']) },
  { name: 'list_events', write: false, description: 'The schedule between from and to (inclusive, at most 31 days; default today), with skips and per-day edits applied.', inputSchema: obj({ from: DATE, to: DATE }) },
  { name: 'get_stats', write: false, description: 'Focus time per tag and per project, estimate vs actual for tasks finished, and counts of finished and dropped tasks, between two dates (inclusive).', inputSchema: obj({ from: DATE, to: DATE }, ['from', 'to']) },
  { name: 'get_review', write: false, description: 'The end-of-day review of a date, if that day was reviewed.', inputSchema: obj({ date: DATE }, ['date']) },
  { name: 'list_notes', write: false, description: 'Notes, newest first.', inputSchema: obj({ limit: { type: 'integer', minimum: 1, maximum: 100 } }) },
  { name: 'search_log', write: false, description: 'Search Log posts (notes) by text, with their project.', inputSchema: obj({ query: { type: 'string', minLength: 1, maxLength: 200 } }, ['query']) },
  { name: 'list_unplaced', write: false, description: 'Fixed events with a date and length but no time yet ("to place"): that day, or all from today on. See place_event.', inputSchema: obj({ date: DATE }) },
  // ---- Write (each returns the changed record and an undoToken) ----
  { name: 'add_task', write: true, description: 'Add a task (structured fields only). It lands in the inbox; give a finishCondition so it can be focused.', inputSchema: obj({ ...TASK_FIELDS, kind: { type: 'string', enum: ['task', 'sprint'] } }, ['title']) },
  { name: 'update_task', write: true, description: 'Change fields of a task. Only the fields given change.', inputSchema: obj({ id: ID, patch: obj(TASK_FIELDS) }, ['id', 'patch']) },
  { name: 'complete_task', write: true, description: 'Mark a task done. A recurring task creates its next instance.', inputSchema: obj({ id: ID }, ['id']) },
  { name: 'drop_task', write: true, description: 'Close a task without finishing it. A reason is required.', inputSchema: obj({ id: ID, reason: { type: 'string', minLength: 3, maxLength: 500 } }, ['id', 'reason']) },
  { name: 'place_block', write: true, description: 'Plan time for a task on the runway. Refused, with the reason, if it overlaps a fixed event or another block.', inputSchema: obj({ taskId: ID, date: DATE, startMin: MINUTE('Start'), endMin: MINUTE('End') }, ['taskId', 'date', 'startMin', 'endMin']) },
  { name: 'move_block', write: true, description: 'Move or resize a planned block. Refused, with the reason, on overlap.', inputSchema: obj({ id: ID, date: DATE, startMin: MINUTE('Start'), endMin: MINUTE('End') }, ['id']) },
  { name: 'remove_block', write: true, description: 'Remove a planned block (it goes to Recently deleted, restorable).', inputSchema: obj({ id: ID }, ['id']) },
  { name: 'skip_event_on', write: true, description: 'Skip one date of a repeating event; the series is unchanged.', inputSchema: obj({ eventId: ID, date: DATE }, ['eventId', 'date']) },
  {
    name: 'edit_event_on',
    write: true,
    description: 'Change one date of a repeating event (title and/or times); the series is unchanged.',
    inputSchema: obj({ eventId: ID, date: DATE, patch: obj({ title: { type: 'string', minLength: 1, maxLength: 120 }, startMin: MINUTE('Start'), endMin: MINUTE('End') }) }, ['eventId', 'date', 'patch']),
  },
  { name: 'add_note', write: true, description: 'Save a note.', inputSchema: obj({ body: { type: 'string', minLength: 1, maxLength: 20000 } }, ['body']) },
  { name: 'post_log', write: true, description: 'Post a note to the Log feed, optionally under a project. Use add_task for work to do.', inputSchema: obj({ body: { type: 'string', minLength: 1, maxLength: 20000 }, projectId: ID }, ['body']) },
  { name: 'place_event', write: true, description: 'Give an unplaced event its time (keeps its length). Refused, with the reason, on overlap.', inputSchema: obj({ eventId: ID, startMin: MINUTE('Start') }, ['eventId', 'startMin']) },
  { name: 'add_project', write: true, description: 'Create a project (default columns: To do, Doing, Done).', inputSchema: obj({ name: { type: 'string', minLength: 1, maxLength: 80 }, color: COLOR, columns: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 40 }, maxItems: 12 } }, ['name']) },
  { name: 'move_card', write: true, description: 'Move a project task to a column, before another card (or to the end).', inputSchema: obj({ taskId: ID, columnId: { type: 'string', minLength: 1, maxLength: 60 }, beforeTaskId: ID }, ['taskId', 'columnId']) },
  { name: 'undo', write: true, description: 'Undo an earlier write by its undoToken.', inputSchema: obj({ undoToken: { type: 'string', pattern: '^[\\w-]{1,80}$' } }, ['undoToken']) },
];

export const toolByName = (name: string): ToolDef | undefined => TOOLS.find((t) => t.name === name);

/** Strict check of args against a tool's schema: the first problem, or null. */
export function checkArgs(schema: JsonSchema, v: unknown, path = 'args'): string | null {
  switch (schema.type) {
    case 'string':
      if (typeof v !== 'string') return `${path} must be a string`;
      if (schema.enum && !schema.enum.includes(v)) return `${path} must be one of ${schema.enum.join(', ')}`;
      if (schema.minLength !== undefined && v.length < schema.minLength) return `${path} is too short`;
      if (schema.maxLength !== undefined && v.length > schema.maxLength) return `${path} is too long (max ${schema.maxLength})`;
      if (schema.pattern && !new RegExp(schema.pattern).test(v)) return `${path} has the wrong format`;
      return null;
    case 'integer':
      if (!Number.isInteger(v)) return `${path} must be a whole number`;
      if (schema.minimum !== undefined && (v as number) < schema.minimum) return `${path} must be >= ${schema.minimum}`;
      if (schema.maximum !== undefined && (v as number) > schema.maximum) return `${path} must be <= ${schema.maximum}`;
      return null;
    case 'boolean':
      return typeof v === 'boolean' ? null : `${path} must be true or false`;
    case 'array': {
      if (!Array.isArray(v)) return `${path} must be an array`;
      if (schema.maxItems !== undefined && v.length > schema.maxItems) return `${path} has too many items`;
      for (const [i, x] of v.entries()) {
        const p = checkArgs(schema.items, x, `${path}[${i}]`);
        if (p) return p;
      }
      return null;
    }
    case 'object': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return `${path} must be an object`;
      const o = v as Record<string, unknown>;
      for (const k of Object.keys(o)) if (!(k in schema.properties)) return `${path}.${k} is not a known field`;
      for (const k of schema.required ?? []) if (o[k] === undefined) return `${path}.${k} is required`;
      for (const [k, s] of Object.entries(schema.properties)) {
        if (o[k] === undefined) continue;
        const p = checkArgs(s, o[k], `${path}.${k}`);
        if (p) return p;
      }
      return null;
    }
  }
}
