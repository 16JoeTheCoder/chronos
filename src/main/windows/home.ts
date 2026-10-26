// Chronos Home (§8.2): a frameless window covering the chosen display's work area
// (not kiosk fullscreen, so the taskbar and the widget stay visible). On show it
// is briefly always-on-top so it lands in front, then becomes an ordinary window:
// Alt+Tab and Win+D always work. Esc hides it; it is never destroyed (instant re-show).
// UNVERIFIED-ON-WINDOWS: z-order, DPI and multi-monitor behaviour.

import { BrowserWindow, screen, type Display } from 'electron';
import { CHANNELS } from '../../preload/api';
import { secureWindow } from './common';

const FRONT_MS = 1500;

export class HomeWindow {
  readonly win: BrowserWindow;
  private frontTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private displayId: () => number | null, onShown: () => void) {
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

  fit(): void {
    if (!this.win.isDestroyed()) this.win.setBounds(this.display().workArea);
  }

  show(view: 'runway' | 'focus' | null = null): void {
    if (this.win.isDestroyed()) return;
    this.fit();
    this.win.show();
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.focus();
    if (this.frontTimer) clearTimeout(this.frontTimer);
    this.frontTimer = setTimeout(() => !this.win.isDestroyed() && this.win.setAlwaysOnTop(false), FRONT_MS);
    this.win.webContents.send(CHANNELS.show, view);
  }

  hide(): void {
    if (!this.win.isDestroyed()) this.win.hide();
  }

  toggle(view: 'runway' | 'focus' | null): void {
    if (this.visible && this.win.isFocused()) this.hide();
    else this.show(view);
  }
}
