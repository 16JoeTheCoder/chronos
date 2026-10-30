// Quick capture (§8.6, P1): a tiny centred input window, created lazily on the
// hotkey and destroyed after use. Enter saves an inbox task; Esc closes.

import { BrowserWindow, screen } from 'electron';
import { secureWindow } from './common';

const W = 520;
const H = 64;

export class CaptureWindow {
  private win: BrowserWindow | null = null;

  get webContents() {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  open(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.focus();
      return;
    }
    const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const win = secureWindow(
      {
        x: Math.round(wa.x + (wa.width - W) / 2),
        y: Math.round(wa.y + wa.height * 0.28),
        width: W,
        height: H,
        frame: false,
        resizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        backgroundColor: '#16181B',
        title: 'Quick capture',
      },
      'widget.html',
      '#capture',
    );
    win.once('ready-to-show', () => {
      win.show();
      win.focus();
    });
    win.on('blur', () => this.close());
    win.on('closed', () => (this.win = null));
    this.win = win;
  }

  close(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}
