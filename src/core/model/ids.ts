// Record ids: random UUIDs (no auto-increment, so two offline devices never collide).
// globalThis.crypto exists in Node 20+, Electron main and the renderer alike.
// Generated records use deterministic ids, so two devices producing "the same"
// record write one document and a retried write can never duplicate one.

export const newId = (): string => globalThis.crypto.randomUUID();

/** A timer slice. */
export const sessionId = (taskId: string, startedAt: number): string => `s-${taskId}-${startedAt}`;
/** One occurrence of a repeating event, skipped or edited. */
export const exceptionId = (eventId: string, date: string): string => `x-${eventId}-${date}`;
/** The end-of-day review of a date. */
export const reviewId = (date: string): string => `review-${date}`;
/** The next instance of a recurring task. */
export const recurrenceId = (parentId: string, date: string): string => `${parentId}:${date}`;

/** Ids accepted from outside (IPC, MCP, sync): uuid, deterministic ids, imports. */
export const isId = (v: unknown): v is string => typeof v === 'string' && /^[\w:.-]{1,160}$/.test(v);

/** The block auto-plan makes for a task on a date: deterministic, so two devices planning the same morning write one block. */
export const autoBlockId = (taskId: string, date: string): string => `ab-${taskId}-${date}`;
