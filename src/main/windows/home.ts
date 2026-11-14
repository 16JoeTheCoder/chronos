// Chronos Home (§8.2): a frameless window covering the chosen display's work area
// (not kiosk fullscreen, so the taskbar and the widget stay visible). On show it
// is briefly always-on-top so it lands in front, then becomes an ordinary window:
// Alt+Tab and Win+D always work. Esc hides it; it is never destroyed (instant re-show).
// With "Live on the desktop" (D-144) Esc does not hide it: it goes behind the desktop icons
// (WorkerW) and Win+D shows it; any show() (shortcut, tray, palette) detaches it into this
// normal interactive window again. If attaching fails it simply hides, as before.
// UNVERIFIED-ON-WINDOWS: z-order, DPI, multi-monitor behaviour and the desktop layer.

import { BrowserWindow, screen, type Display } from 'electron';
import { CHANNELS } from '../../preload/api';
import { startMouseForward, type DesktopLayer, type MouseHook } from '../desktopLayer';
import { secureWindow } from './common';

const FRONT_MS = 1500;

export class HomeWindow {
  readonly win: BrowserWindow;
  private frontTimer: ReturnType<typeof setTimeout> | null = null;

  private mouse: MouseHook | null = null;

  constructor(private displayId: () => number | null, onShown: () => void, private layer: DesktopLayer, private layerEnabled: () => boolean, private log: (m: string) => void) {
    this.win = secureWindow(
      {
        ...this.display().workArea,
        frame: false,
        resizable: false,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        backgroundColor: '#0D0E10',
        title: 'Chronos',
      },
      'index.html',
    );
    this.win.once('ready-to-show', onShown);
    const refit = () => this.fit();
    screen.on('display-added', refit);
    screen.on('display-removed', refit);
    screen.on('display-metrics-changed', refit);
  }

  get visible(): boolean {
    return this.win.isVisible();
  }

  display(): Display {
    const id = this.displayId();
    return screen.getAllDisplays().find((d) => d.id === id) ?? screen.getPrimaryDisplay();
  }

  /** The display's full bounds in physical pixels (the layer also covers the taskbar strip). */
  private px() {
    return screen.dipToScreenRect(this.win, this.display().bounds);
  }

  fit(): void {
    if (this.win.isDestroyed()) return;
    if (this.layer.attached) this.layer.place(this.px());
    else this.win.setBounds(this.display().workArea);
  }

  show(view: 'runway' | 'focus' | null = null): void {
    if (this.win.isDestroyed()) return;
    this.leaveLayer();
    this.fit();
    this.win.show();
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.focus();
    if (this.frontTimer) clearTimeout(this.frontTimer);
    this.frontTimer = setTimeout(() => !this.win.isDestroyed() && this.win.setAlwaysOnTop(false), FRONT_MS);
    this.win.webContents.send(CHANNELS.show, view);
  }

  /** Esc: onto the desktop layer when enabled, else hidden. A failed attach hides (the normal-window fallback). */
  hide(): void {
    if (this.win.isDestroyed()) return;
    if (this.frontTimer) clearTimeout(this.frontTimer);
    if (this.layerEnabled() && this.toLayer()) return;
    this.win.hide();
  }

  private toLayer(): boolean {
    this.win.setAlwaysOnTop(false);
    this.win.showInactive();
    if (!this.layer.attach(this.win, this.px())) return false;
    const d = this.display().bounds;
    this.mouse = startMouseForward((kind, x, y, delta) => {
      const p = screen.screenToDipPoint({ x, y });
      const pos = { x: Math.round(p.x - d.x), y: Math.round(p.y - d.y) };
      const wc = this.win.webContents;
      if (wc.isDestroyed()) return;
      if (kind === 'wheel') wc.sendInputEvent({ type: 'mouseWheel', ...pos, deltaX: 0, deltaY: delta });
      else wc.sendInputEvent({ type: kind === 'move' ? 'mouseMove' : kind === 'down' ? 'mouseDown' : 'mouseUp', ...pos, button: 'left', clickCount: 1 });
    }, this.log);
    return true;
  }

  private leaveLayer(): void {
    this.mouse?.stop();
    this.mouse = null;
    this.layer.detach();
  }

  /** The setting was turned off: leave the layer and hide. */
  layerOff(): void {
    if (!this.layer.attached) return;
    this.leaveLayer();
    this.win.hide();
  }

  toggle(view: 'runway' | 'focus' | null): void {
    if (this.visible && this.win.isFocused() && !this.layer.attached) this.hide();
    else this.show(view);
  }
}
