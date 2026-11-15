// Notepad and palette windows: created lazily on first use, then kept hidden between uses so
// they reopen instantly. `open()` shows and focuses; `close()` hides, which hands focus back to
// the window that had it before (the app you were in).
// UNVERIFIED-ON-WINDOWS: focus return, z-order.

import { BrowserWindow, screen, type BrowserWindowConstructorOptions, type Rectangle } from 'electron';
import { CHANNELS } from '../../preload/api';
import { secureWindow } from './common';

export const NOTEPAD = { width: 380, height: 440 };
export const PALETTE = { width: 640, height: 460 };
const MARGIN = 16;

/** Notepad: top-right of the work area. Pure. */
export function notepadBounds(workArea: Rectangle): Rectangle {
  return { x: workArea.x + workArea.width - NOTEPAD.width - MARGIN, y: workArea.y + MARGIN, ...NOTEPAD };
}

/** Palette: horizontally centred, a fifth of the way down. Pure. */
export function paletteBounds(workArea: Rectangle): Rectangle {
  return { x: Math.round(workArea.x + (workArea.width - PALETTE.width) / 2), y: Math.round(workArea.y + workArea.height * 0.2), ...PALETTE };
}

export class PopupWindow {
  private win: BrowserWindow | null = null;

  constructor(private hash: '#notepad' | '#palette', private place: (wa: Rectangle) => Rectangle, private opts: BrowserWindowConstructorOptions, private hideOnBlur: boolean) {}

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
      if (this.hideOnBlur) win.on('blur', () => this.close());
      win.on('closed', () => (this.win = null));
      this.win = win;
    }
    win.setBounds(this.place(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea));
    const show = () => {
      win.show();
      win.focus();
      win.webContents.send(CHANNELS.open);
    };
    if (win.webContents.isLoading()) win.once('ready-to-show', show);
    else show();
  }

  close(): void {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide();
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}
