// System tray icon and menu. Home and the widget have no taskbar button, so the
// tray is the always-available way back and the only Quit besides the widget menu.

import { Menu, Tray, nativeImage } from 'electron';

export interface TrayActions {
  show(): void;
  startPause(): void;
  setLaunchAtLogin(on: boolean): void;
  quit(): void;
}

export class AppTray {
  private tray: Tray;

  constructor(icon: string, private actions: TrayActions, private loginAvailable: boolean) {
    this.tray = new Tray(nativeImage.createFromDataURL(icon));
    this.tray.setToolTip('Chronos');
    this.tray.on('click', () => actions.show());
  }

  update(launchAtLogin: boolean, running: boolean): void {
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show Chronos', click: () => this.actions.show() },
        { label: running ? 'Pause' : 'Start', click: () => this.actions.startPause() },
        { type: 'separator' },
        {
          label: this.loginAvailable ? 'Launch at login' : 'Launch at login (installed build only)',
          type: 'checkbox',
          checked: launchAtLogin,
          enabled: this.loginAvailable,
          click: (item) => this.actions.setLaunchAtLogin(item.checked),
        },
        { type: 'separator' },
        { label: 'Quit Chronos', click: () => this.actions.quit() },
      ]),
    );
  }

  destroy(): void {
    this.tray.destroy();
  }
}
