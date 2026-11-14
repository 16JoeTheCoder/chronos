// The one API the preload exposes to the renderer as window.chronos, and the IPC
// channel names. Data changes go through one `command` channel; window and shelf
// operations have their own typed channels.

import type { Command, Result } from '../core/commands';
import type { ShelfItem, Snapshot } from '../core/model/types';

export interface ChronosApi {
  getSnapshot(): Promise<Snapshot>;
  onSnapshot(cb: (s: Snapshot) => void): () => void;
  /** Main asks the renderer to play a short beep (synthesised in the renderer). */
  onBeep(cb: () => void): () => void;
  /** Home was shown by a hotkey, tray or widget click: which view to open. */
  onShow(cb: (view: 'runway' | 'focus' | null) => void): () => void;
  /** Main reports something the user should see once, e.g. a change Claude made (with an Undo token). */
  onNotice(cb: (n: Notice) => void): () => void;
  command(cmd: Command): Promise<Result>;
  /** Redeem a result's `undoToken` (one use, ~60 s). Resolves with the revert's own result (it may carry a new token to redo). */
  undo(token: string): Promise<Result>;
  win: {
    hide(): void;
    /** Open the main window (palette and overlay use it). */
    showHome(view?: 'runway' | 'focus' | null): void;
    /** Overlay: a click on the pill toggles the main window. */
    overlayClick(): void;
    /** Overlay: grow the window while the pointer is over the pill, shrink it after. */
    overlayExpand(expanded: boolean): void;
    /**
     * Hide the notepad window and give focus back to the app that had it. If lines became records,
     * pass them: main shows an Undo toast (on the overlay or Home) that recycles exactly those.
     */
    closeNotepad(created?: NotepadCreated): void;
    closePalette(): void;
    /** Show a toast with an optional Undo (a token from a command result) on the overlay or Home: for windows that close right after acting. */
    notify(text: string, undoToken?: string): void;
    /** Notepad and palette: main showed the (persistent, hidden) window again. */
    onOpen(cb: () => void): () => void;
    quit(): void;
    /** Log the reason and relaunch (the renderer's error boundary). */
    restart(reason: string): void;
    /** Report a renderer timing mark (ms since navigation start) for diagnostics. */
    mark(name: string, ms: number): void;
  };
  palette: {
    /** Copy `text` to the clipboard and open Claude Desktop (D-143). */
    askClaude(text: string): Promise<Result>;
  };
  shelf: {
    list(): Promise<ShelfItem[]>;
    open(path: string): Promise<Result>;
    trash(path: string): Promise<Result>;
    onChange(cb: () => void): () => void;
  };
}

export interface NotepadCreated {
  text: string;
  records: { coll: 'tasks' | 'events' | 'ideas'; id: string }[];
}

export interface Notice {
  text: string;
  /** Send { type: 'mcp.undo', token } to undo it. */
  undoToken?: string;
  error?: boolean;
}

export const CHANNELS = {
  getSnapshot: 'chronos:getSnapshot',
  snapshot: 'chronos:snapshot',
  beep: 'chronos:beep',
  show: 'chronos:show',
  notice: 'chronos:notice',
  command: 'chronos:command',
  undo: 'chronos:undo',
  askClaude: 'palette:askClaude',
  hide: 'win:hide',
  showHome: 'win:showHome',
  overlayClick: 'win:overlayClick',
  overlayExpand: 'win:overlayExpand',
  closeNotepad: 'win:closeNotepad',
  closePalette: 'win:closePalette',
  notify: 'win:notify',
  open: 'win:open',
  quit: 'win:quit',
  restart: 'win:restart',
  mark: 'win:mark',
  stackList: 'stack.list',
  stackOpen: 'stack.open',
  stackTrash: 'stack.trash',
  stackChanged: 'stack.changed',
} as const;
