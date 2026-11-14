// Overlay (D-142): a small always-on-top pill at the bottom-left of the work area. It is
// `focusable: false` and shown with showInactive, so it never takes keyboard focus from
// the app you are in (clicks still reach it). Collapsed it is a pill; the renderer asks to
// expand while the pointer is over it (or a notice with Undo is showing). It hides while
// another app is full-screen when the device setting says so, and while nothing is in focus.
// UNVERIFIED-ON-WINDOWS: z-order over other apps, full-screen detection, DPI.

import { BrowserWindow, screen, type Rectangle } from 'electron';
import { secureWindow } from './common';

export const PILL = { width: 300, height: 52 };
export const OPEN = { width: 340, height: 148 };
const MARGIN = 16;
const REASSERT_MS = 5000;

/** Bottom-left of the work area; the bottom edge stays put when it grows. Pure, unit-tested. */
export function overlayBounds(workArea: Rectangle, expanded: boolean): Rectangle {
  const s = expanded ? OPEN : PILL;
  return { x: workArea.x + MARGIN, y: workArea.y + workArea.height - MARGIN - s.height, width: s.width, height: s.height };
}

export class OverlayWindow {
  readonly win: BrowserWindow;
  private expanded = false;
  private wanted = false;
  private hiddenByFullscreen = false;
  private timer: ReturnType<typeof setInterval>;

  constructor(private isFullscreenApp: () => boolean, private hideInFullscreen: () => boolean) {
    this.win = secureWindow(
      { ...overlayBounds(screen.getPrimaryDisplay().workArea, false), frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, focusable: false, title: 'Chronos overlay' },
      'windows.html',
      '#overlay',
    );
    this.win.setAlwaysOnTop(true, 'screen-saver');
    // Windows drops topmost windows behind the taskbar when it is clicked; re-assert, and re-check full-screen apps.
    this.timer = setInterval(() => this.refresh(), REASSERT_MS);
    const fit = () => this.fit();
    screen.on('display-metrics-changed', fit);
    screen.on('display-added', fit);
    screen.on('display-removed', fit);
  }

  get webContents() {
    return this.win.isDestroyed() ? null : this.win.webContents;
  }

  /** Show only while there is something to show (a task in focus, or a notice). */
  want(on: boolean): void {
    this.wanted = on;
    this.refresh();
  }

  expand(on: boolean): void {
    this.expanded = on;
    this.fit();
  }

  private fit(): void {
    if (!this.win.isDestroyed()) this.win.setBounds(overlayBounds(screen.getPrimaryDisplay().workArea, this.expanded));
  }

  private refresh(): void {
    if (this.win.isDestroyed()) return;
    this.hiddenByFullscreen = this.hideInFullscreen() && this.isFullscreenApp();
    const show = this.wanted && !this.hiddenByFullscreen;
    if (show && !this.win.isVisible()) {
      this.fit();
      this.win.showInactive();
    } else if (!show && this.win.isVisible()) this.win.hide();
    if (show) this.win.setAlwaysOnTop(true, 'screen-saver');
  }

  destroy(): void {
    clearInterval(this.timer);
    if (!this.win.isDestroyed()) this.win.destroy();
  }
}
