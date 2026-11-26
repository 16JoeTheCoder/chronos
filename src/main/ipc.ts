// IPC handlers. Everything arriving from a renderer is untrusted: the sender must
// be one of our windows; payloads are rebuilt by parseCommand.ts before they reach the controller.

import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { Command, Result } from '../core/commands';
import type { ShelfItem, Snapshot } from '../core/model/types';
import { CHANNELS, type NotepadCreated } from '../preload/api';
import { isObj } from '../core/validation';
import { FILE_ID_RE, isFileArea, type FileArea, type FileGet } from './files';
import { TOKEN_RE, oneOf, parseCommand, pickCreated, str } from './parseCommand';

export { parseCommand, pickCreated } from './parseCommand';

export interface IpcDeps {
  isOurSender(e: IpcMainEvent | IpcMainInvokeEvent): boolean;
  snapshot(): Snapshot;
  command(cmd: Command): Result | Promise<Result>;
  /** Raw undo ops from a command result go behind a token (D-143). */
  seal(res: Result): Result;
  redeemUndo(token: unknown): Extract<Command, { type: 'records.revert' }> | null;
  hide(): void;
  showHome(view: 'runway' | 'focus' | null): void;
  overlayClick(): void;
  overlayExpand(expanded: boolean): void;
  closeNotepad(created: NotepadCreated | null): void;
  closePalette(): void;
  notepadResize(height: number): void;
  notify(text: string, undoToken: string | undefined): void;
  askClaude(text: string): Promise<Result>;
  quit(): void;
  restart(reason: string): void;
  mark(name: string, ms: number): void;
  stackList(): Promise<ShelfItem[]>;
  stackOpen(path: string): Promise<Result>;
  stackTrash(path: string): Promise<Result>;
  filesPut(area: FileArea, id: string, name: string, mime: string, bytes: Uint8Array): Promise<Result>;
  filesGet(area: FileArea, id: string): Promise<FileGet>;
  filesRemove(area: FileArea, id: string): Promise<Result>;
}

export function registerIpc(deps: IpcDeps): void {
  const guard = <A extends unknown[], R>(fallback: R, fn: (...a: A) => R) =>
    (e: IpcMainEvent | IpcMainInvokeEvent, ...a: A): R => (deps.isOurSender(e) ? fn(...a) : fallback);
  const forbidden: Result = { ok: false, error: 'Forbidden' };

  ipcMain.handle(CHANNELS.getSnapshot, guard(null, () => deps.snapshot()));
  ipcMain.handle(
    CHANNELS.command,
    guard<[unknown], Promise<Result>>(Promise.resolve(forbidden), async (raw) => {
      const cmd = parseCommand(raw);
      return cmd ? deps.seal(await deps.command(cmd)) : { ok: false, error: 'Invalid command.' };
    }),
  );
  ipcMain.handle(
    CHANNELS.undo,
    guard<[unknown], Promise<Result>>(Promise.resolve(forbidden), async (token) => {
      const cmd = deps.redeemUndo(token);
      return cmd ? deps.seal(await deps.command(cmd)) : { ok: false, error: 'That change can no longer be undone.' };
    }),
  );
  ipcMain.handle(CHANNELS.askClaude, guard<[unknown], Promise<Result>>(Promise.resolve(forbidden), (text) => {
    const t = str(text, 20_000).trim();
    return t ? deps.askClaude(t) : Promise.resolve({ ok: false, error: 'Nothing to send.' });
  }));
  ipcMain.on(CHANNELS.hide, guard(undefined, () => deps.hide()));
  ipcMain.on(CHANNELS.showHome, guard<[unknown], void>(undefined, (v) => deps.showHome(oneOf(v, ['runway', 'focus'] as const) ?? null)));
  ipcMain.on(CHANNELS.overlayClick, guard(undefined, () => deps.overlayClick()));
  ipcMain.on(CHANNELS.overlayExpand, guard<[unknown], void>(undefined, (v) => deps.overlayExpand(v === true)));
  ipcMain.on(CHANNELS.closeNotepad, guard<[unknown], void>(undefined, (v) => deps.closeNotepad(pickCreated(v))));
  ipcMain.on(CHANNELS.closePalette, guard(undefined, () => deps.closePalette()));
  ipcMain.on(CHANNELS.notepadResize, guard<[unknown], void>(undefined, (h) => { if (typeof h === 'number' && Number.isFinite(h)) deps.notepadResize(h); }));
  ipcMain.on(CHANNELS.notify, guard<[unknown, unknown], void>(undefined, (text, token) => {
    const t = str(text, 120).trim();
    if (t) deps.notify(t, typeof token === 'string' && TOKEN_RE.test(token) ? token : undefined);
  }));
  ipcMain.on(CHANNELS.quit, guard(undefined, () => deps.quit()));
  ipcMain.on(CHANNELS.restart, guard<[unknown], void>(undefined, (reason) => deps.restart(str(reason, 2000))));
  ipcMain.on(CHANNELS.mark, guard<[unknown, unknown], void>(undefined, (name, ms) => {
    if (typeof name === 'string' && /^[\w.-]{1,40}$/.test(name) && Number.isFinite(ms)) deps.mark(name, ms as number);
  }));
  const noFile: FileGet = { ok: false, error: 'Forbidden' };
  ipcMain.handle(CHANNELS.filesPut, guard<[unknown], Promise<Result>>(Promise.resolve(forbidden), (v) => {
    if (!isObj(v) || !isFileArea(v.area) || typeof v.id !== 'string' || !FILE_ID_RE.test(v.id) || !(v.bytes instanceof Uint8Array)) return Promise.resolve({ ok: false, error: 'Invalid file.' });
    return deps.filesPut(v.area, v.id, str(v.name, 200) || 'file', str(v.mime, 100), v.bytes);
  }));
  ipcMain.handle(CHANNELS.filesGet, guard<[unknown], Promise<FileGet>>(Promise.resolve(noFile), (v) =>
    isObj(v) && isFileArea(v.area) && typeof v.id === 'string' && FILE_ID_RE.test(v.id) ? deps.filesGet(v.area, v.id) : Promise.resolve({ ok: false, error: 'Invalid file.' })));
  ipcMain.handle(CHANNELS.filesRemove, guard<[unknown], Promise<Result>>(Promise.resolve(forbidden), (v) =>
    isObj(v) && isFileArea(v.area) && typeof v.id === 'string' && FILE_ID_RE.test(v.id) ? deps.filesRemove(v.area, v.id) : Promise.resolve({ ok: false, error: 'Invalid file.' })));
  ipcMain.handle(CHANNELS.stackList, guard(Promise.resolve([] as ShelfItem[]), () => deps.stackList()));
  ipcMain.handle(CHANNELS.stackOpen, guard<[unknown], Promise<Result>>(Promise.resolve(forbidden), (p) => deps.stackOpen(str(p, 2000))));
  ipcMain.handle(CHANNELS.stackTrash, guard<[unknown], Promise<Result>>(Promise.resolve(forbidden), (p) => deps.stackTrash(str(p, 2000))));
}
