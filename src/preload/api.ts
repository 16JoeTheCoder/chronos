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
  command(cmd: Command): Promise<Result>;
  win: {
    hide(): void;
    /** Widget: left click toggles Home. */
    widgetClick(): void;
    widgetMenu(): void;
    dragStart(): void;
    /** Resolves true if the pointer moved more than 4 px (a drag), false for a click. */
    dragEnd(): Promise<boolean>;
    closeCapture(): void;
    quit(): void;
    /** Log the reason and relaunch (the renderer's error boundary). */
    restart(reason: string): void;
    /** Report a renderer timing mark (ms since navigation start) for diagnostics. */
    mark(name: string, ms: number): void;
  };
  shelf: {
    list(): Promise<ShelfItem[]>;
    open(path: string): Promise<Result>;
    trash(path: string): Promise<Result>;
    onChange(cb: () => void): () => void;
  };
}

export const CHANNELS = {
  getSnapshot: 'chronos:getSnapshot',
  snapshot: 'chronos:snapshot',
  beep: 'chronos:beep',
  show: 'chronos:show',
  command: 'chronos:command',
  hide: 'win:hide',
  widgetClick: 'win:widgetClick',
  widgetMenu: 'win:widgetMenu',
  dragStart: 'win:dragStart',
  dragEnd: 'win:dragEnd',
  closeCapture: 'win:closeCapture',
  quit: 'win:quit',
  restart: 'win:restart',
  mark: 'win:mark',
  stackList: 'stack.list',
  stackOpen: 'stack.open',
  stackTrash: 'stack.trash',
  stackChanged: 'stack.changed',
} as const;
