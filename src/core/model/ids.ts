// Record ids: random UUIDs (no auto-increment, so two offline devices never collide).
// globalThis.crypto exists in Node 20+, Electron main and the renderer alike.

export const newId = (): string => globalThis.crypto.randomUUID();

/** Deterministic id for a timer slice, so two devices recording the same slice write one record. */
export const sessionId = (taskId: string, startedAt: number): string => `s-${taskId}-${startedAt}`;
