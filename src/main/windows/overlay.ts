// Overlay pill (D-145, Phase 3.5 §7): docked in the Windows taskbar band (left by default,
// right, or a free position), as tall as the taskbar, so it never covers the desktop or apps.
// `focusable: false` + showInactive, so it never takes focus. Hover does not expand it (the
// title crossfades to Pause); it only grows, upward, while a notice with Undo is showing.
// Hidden while nothing is in focus, while Home is in front, and under a full-screen app.
// UNVERIFIED-ON-WINDOWS: taskbar band maths on real taskbars (auto-hide, vertical, DPI), z-order.

import { BrowserWindow, screen, type Rectangle } from 'electron';
import { lockZoom, secureWindow } from './common';

export const PILL = { width: 280, height: 48 };
export const OPEN = { width: 340, height: 148 };
const MARGIN = 16;
/** Right dock: stay clear of the tray and clock (about 360 px on a default Windows 11 taskbar). */
const TRAY_CLEARANCE = 360;
const REASSERT_MS = 5000;

export type Dock = 'taskbar-left' | 'taskbar-right' | 'free';
interface DisplayRects { bounds: Rectangle; workArea: Rectangle }

/** The taskbar strip: bounds minus work area along the edge where they differ, or null (auto-hide, none). */
export function taskbarBand(d: DisplayRects): Rectangle | null {
  const b = d.bounds, w = d.workArea;
  const bottom = b.y + b.height - (w.y + w.height);
  const top = w.y - b.y;
  if (bottom > 0) return { x: b.x, y: w.y + w.height, width: b.width, height: bottom };
  if (top > 0) return { x: b.x, y: b.y, width: b.width, height: top };
  return null; // vertical or hidden taskbar: no horizontal band to sit in
}

/** Pure, unit-tested. Docked: inside the taskbar band, full band height. Expanded (a notice) grows upward. */
export function overlayBounds(d: DisplayRects, expanded: boolean, dock: Dock = 'taskbar-left', pos: { x: number; y: number } | null = null): Rectangle {
  const band = taskbarBand(d);
  const w = d.workArea;
  if (dock === 'free' && pos) {
    const s = expanded ? OPEN : PILL;
    const x = Math.min(Math.max(pos.x, d.bounds.x), d.bounds.x + d.bounds.width - s.width);
    const y = Math.min(Math.max(pos.y, d.bounds.y), d.bounds.y + d.bounds.height - s.height);
    return { x, y, width: s.width, height: s.height };
  }
  const h = band ? Math.min(Math.max(band.height, 32), 72) : PILL.height;
  const size = expanded ? OPEN : { width: PILL.width, height: h };
  const left = band ? band.x + 8 : w.x + MARGIN;
  const right = band ? band.x + band.width - TRAY_CLEARANCE - size.width : w.x + w.width - MARGIN - size.width;
  const x = dock === 'taskbar-right' ? Math.max(left, right) : left;
  if (!band) return { x, y: w.y + w.height - MARGIN - size.height, ...size };
  const atTop = band.y === d.bounds.y && band.y < w.y;
  // Docked at the bottom: the pill fills the band; a notice grows upward from the band's bottom edge.
  const y = atTop ? band.y : band.y + band.height - size.height;
  return { x, y, ...size };
}

export class OverlayWindow {
  readonly win: BrowserWindow;
  private expanded = false;
  private wanted = false;
  private hiddenByFullscreen = false;
  private timer: ReturnType<typeof setInterval>;

  private homeInFront = false;

  constructor(private isFullscreenApp: () => boolean, private hideInFullscreen: () => boolean, private place: () => { dock: Dock; pos: { x: number; y: number } | null } = () => ({ dock: 'taskbar-left', pos: null })) {
    this.win = secureWindow(
      { ...overlayBounds(screen.getPrimaryDisplay(), false), frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, focusable: false, title: 'Chronos overlay' },
      'windows.html',
      '#overlay',
    );
    lockZoom(this.win);
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

  /** Home is focused or in front: the pill would only duplicate it (and covered Settings). */
  setHomeInFront(on: boolean): void {
    this.homeInFront = on;
    this.refresh();
  }

  /** Dock or position changed in Settings. */
  replace(): void {
    this.fit();
  }

  expand(on: boolean): void {
    this.expanded = on;
    this.fit();
  }

  private fit(): void {
    if (this.win.isDestroyed()) return;
    const p = this.place();
    this.win.setBounds(overlayBounds(screen.getPrimaryDisplay(), this.expanded, p.dock, p.pos));
  }

  private refresh(): void {
    if (this.win.isDestroyed()) return;
    this.hiddenByFullscreen = this.hideInFullscreen() && this.isFullscreenApp();
    const show = this.wanted && !this.hiddenByFullscreen && !this.homeInFront;
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
