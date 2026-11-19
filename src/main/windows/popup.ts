// Notepad and palette windows: created lazily on first use, then kept hidden between uses so
// they reopen instantly. `open()` shows and focuses; `close()` hides, which hands focus back to
// the window that had it before (the app you were in).
// UNVERIFIED-ON-WINDOWS: focus return, z-order.

import { BrowserWindow, screen, type BrowserWindowConstructorOptions, type Rectangle } from 'electron';
import { CHANNELS } from '../../preload/api';
import { lockZoom, secureWindow } from './common';

export const NOTEPAD = { width: 420, height: 260 };
/** The notepad grows downward with its text up to this share of the work area, then scrolls. */
export const NOTEPAD_MAX_SHARE = 0.7;
export const PALETTE = { width: 640, height: 460 };
const MARGIN = 16;

export type NotepadPosition = 'top-right' | 'top-left' | 'centre' | 'cursor';

/** Notepad: where Settings → Tasks and notepad says (top-right by default), at its starting height. Pure. */
export function notepadBounds(workArea: Rectangle, pos: NotepadPosition = 'top-right', cursor?: { x: number; y: number }): Rectangle {
  const { width, height } = NOTEPAD;
  const clampX = (x: number) => Math.min(Math.max(x, workArea.x + MARGIN), workArea.x + workArea.width - width - MARGIN);
  const clampY = (y: number) => Math.min(Math.max(y, workArea.y + MARGIN), workArea.y + workArea.height - height - MARGIN);
  if (pos === 'top-left') return { x: workArea.x + MARGIN, y: workArea.y + MARGIN, width, height };
  if (pos === 'centre') return { x: Math.round(workArea.x + (workArea.width - width) / 2), y: Math.round(workArea.y + workArea.height * 0.2), width, height };
  if (pos === 'cursor' && cursor) return { x: clampX(cursor.x - width / 2), y: clampY(cursor.y + 12), width, height };
  return { x: workArea.x + workArea.width - width - MARGIN, y: workArea.y + MARGIN, width, height };
}

/** The notepad's new height: what the content needs, at least the start height, at most 70 % of the work area and never past its bottom. Pure. */
export function notepadHeight(want: number, top: number, workArea: Rectangle): number {
  const max = Math.min(Math.round(workArea.height * NOTEPAD_MAX_SHARE), workArea.y + workArea.height - MARGIN - top);
  return Math.max(Math.min(NOTEPAD.height, max), Math.min(Math.round(want), max));
}

/** Palette: horizontally centred, a fifth of the way down. Pure. */
export function paletteBounds(workArea: Rectangle): Rectangle {
  return { x: Math.round(workArea.x + (workArea.width - PALETTE.width) / 2), y: Math.round(workArea.y + workArea.height * 0.2), ...PALETTE };
}

export class PopupWindow {
  private win: BrowserWindow | null = null;

  constructor(private hash: '#notepad' | '#palette', private place: (wa: Rectangle, cursor: { x: number; y: number }) => Rectangle, private opts: BrowserWindowConstructorOptions, private hideOnBlur: boolean) {}

  get webContents() {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  get visible(): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.isVisible();
  }

  open(): void {
    let win = this.win;
    if (!win || win.isDestroyed()) {
      win = secureWindow({ ...this.opts, frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true }, 'windows.html', this.hash);
      lockZoom(win);
      if (this.hideOnBlur) win.on('blur', () => this.close());
      win.on('closed', () => (this.win = null));
      this.win = win;
    }
    const cursor = screen.getCursorScreenPoint();
    win.setBounds(this.place(screen.getDisplayNearestPoint(cursor).workArea, cursor));
    const show = () => {
      win.show();
      win.focus();
      win.webContents.send(CHANNELS.open);
    };
    if (win.webContents.isLoading()) win.once('ready-to-show', show);
    else show();
  }

  /** Grow or shrink downward (the top edge stays). */
  resize(height: number): void {
    const win = this.win;
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const b = win.getBounds();
    const h = notepadHeight(height, b.y, screen.getDisplayMatching(b).workArea);
    if (h !== b.height) win.setBounds({ ...b, height: h });
  }

  close(): void {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide();
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}
