// Undo tokens (D-143). `records.revert` is never accepted over IPC (D-136), so a command
// result that carries undo ops is kept here and the renderer gets a short-lived token.
// Redeeming a token runs one `records.revert`; a token works once.

import { randomBytes } from 'node:crypto';
import type { Command, Result, RevertOp } from '../core/commands';

export const UNDO_TTL_MS = 60_000;
export const UNDO_KEEP = 20;
export const TOKEN_RE = /^[a-f0-9]{24}$/;

export class UndoTokens {
  private held = new Map<string, { ops: RevertOp[]; expires: number }>();

  constructor(private now: () => number = Date.now) {}

  get size(): number {
    return this.held.size;
  }

  hold(ops: RevertOp[]): string {
    this.sweep();
    const token = randomBytes(12).toString('hex');
    this.held.set(token, { ops, expires: this.now() + UNDO_TTL_MS });
    for (const k of [...this.held.keys()].slice(0, Math.max(0, this.held.size - UNDO_KEEP))) this.held.delete(k);
    return token;
  }

  /** Strip raw ops from a result; hold them behind a token instead. */
  seal(res: Result): Result {
    if (!res.ok || !res.undo) return res;
    const { undo, ...rest } = res;
    return undo.length ? { ...rest, undoToken: this.hold(undo) } : rest;
  }

  /** The revert command for a token, or null when unknown, expired or already used. */
  redeem(token: unknown): Extract<Command, { type: 'records.revert' }> | null {
    this.sweep();
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
    const u = this.held.get(token);
    if (!u) return null;
    this.held.delete(token);
    return { type: 'records.revert', ops: u.ops };
  }

  private sweep(): void {
    const t = this.now();
    for (const [k, v] of this.held) if (v.expires <= t) this.held.delete(k);
  }
}
