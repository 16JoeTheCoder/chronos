// Taskbar widget (§8.5): a small frameless, transparent, always-on-top card
// docked in the taskbar's free left slot (or right, or free-floating). It never
// takes focus, so it never steals typing. Docking computes the taskbar rectangle
// from the primary display's bounds vs. work area; an auto-hidden or side taskbar
// falls back to free placement at the top-left. Dragging (free mode only) polls
// the cursor like Monolith instead of -webkit-app-region, which swallows clicks.
// UNVERIFIED-ON-WINDOWS: z-order over the taskbar, DPI, Start-menu behaviour.

import { BrowserWindow, screen, type Rectangle } from 'electron';
import type { DeviceSettings } from '../../core/model/types';
import { secureWindow } from './common';

export const WIDGET_W = 300;
export const WIDGET_H = 44;
const MARGIN = 12;
/** Room left for the system tray and clock on the right of the taskbar. */
const TRAY_ROOM = 320;
const DRAG_THRESHOLD = 4;
const REASSERT_MS = 3000;

type Pos = { x: number; y: number };

/** Where the widget goes for a dock mode. Pure, so it is unit-tested. */
export function dockBounds(display: { bounds: Rectangle; workArea: Rectangle }, dock: DeviceSettings['widgetDock'], saved: Pos | null): Rectangle {
  const { bounds: b, workArea: wa } = display;
  const bottomBar = wa.y === b.y && wa.height < b.height && wa.width === b.width;
  const barH = b.height - wa.height;
  if (dock !== 'free' && bottomBar && barH >= WIDGET_H - 4) {
    const y = wa.y + wa.height + Math.round((barH - WIDGET_H) / 2);
    const x = dock === 'taskbar-left' ? b.x + MARGIN : b.x + b.width - WIDGET_W - TRAY_ROOM;
    return { x, y, width: WIDGET_W, height: WIDGET_H };
  }
  const p = saved ?? { x: wa.x + MARGIN, y: wa.y + MARGIN };
  return {
    x: Math.min(Math.max(p.x, b.x), b.x + b.width - WIDGET_W),
    y: Math.min(Math.max(p.y, b.y), b.y + b.height - WIDGET_H),
    width: WIDGET_W,
    height: WIDGET_H,
  };
}

export class WidgetWindow {
  readonly win: BrowserWindow;
  private drag: { timer: ReturnType<typeof setInterval>; cursor: Pos; bounds: Rectangle; moved: boolean } | null = null;
  private reassert: ReturnType<typeof setInterval>;

  constructor(private device: () => DeviceSettings, private onMoved: (pos: Pos) => void) {
    this.win = secureWindow(
      {
        ...this.bounds(),
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        resizable: false,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: false,
        title: 'Chronos widget',
      },
      'widget.html',
      '#widget',
    );
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.once('ready-to-show', () => this.win.showInactive());
    // Windows drops topmost windows behind the taskbar when it is clicked; re-assert.
    this.win.on('blur', () => this.top());
    this.reassert = setInterval(() => this.win.isVisible() && this.top(), REASSERT_MS);
    const redock = () => this.dock();
    screen.on('display-metrics-changed', redock);
    screen.on('display-added', redock);
    screen.on('display-removed', redock);
  }

  private bounds(): Rectangle {
    const d = this.device();
    return dockBounds(screen.getPrimaryDisplay(), d.widgetDock, d.widgetPos);
  }

  dock(): void {
    if (!this.win.isDestroyed() && !this.drag) this.win.setBounds(this.bounds());
  }

  private top(): void {
    if (!this.win.isDestroyed()) this.win.setAlwaysOnTop(true, 'screen-saver');
  }

  dragStart(): void {
    if (this.drag || this.win.isDestroyed() || this.device().widgetDock !== 'free') return;
    const cursor = screen.getCursorScreenPoint();
    // audit-allow: 8 ms cursor polling runs only while the pointer is held down on the widget.
    const timer = setInterval(() => this.dragMove(), 8);
    this.drag = { timer, cursor, bounds: this.win.getBounds(), moved: false };
  }

  dragEnd(): boolean {
    const d = this.drag;
    if (!d) return false;
    this.dragMove();
    clearInterval(d.timer);
    this.drag = null;
    if (d.moved) {
      const b = this.win.getBounds();
      this.onMoved({ x: b.x, y: b.y });
    }
    return d.moved;
  }

  private dragMove(): void {
    const d = this.drag;
    if (!d || this.win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    const dx = p.x - d.cursor.x;
    const dy = p.y - d.cursor.y;
    if (!d.moved && Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
    d.moved = true;
    // Same width/height every time: avoids DIP<->pixel rounding drift at non-100% DPI.
    this.win.setBounds({ x: d.bounds.x + dx, y: d.bounds.y + dy, width: d.bounds.width, height: d.bounds.height });
  }

  destroy(): void {
    clearInterval(this.reassert);
    if (this.drag) clearInterval(this.drag.timer);
    if (!this.win.isDestroyed()) this.win.destroy();
  }
}
