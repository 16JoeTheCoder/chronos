// Launch at login (§8.4). Login items only make sense for the installed exe, not
// for electron.exe in development. UNVERIFIED-ON-WINDOWS.

import { app } from 'electron';

export const LAUNCH_ARG = '--launch';

export function applyLoginItem(openAtLogin: boolean): void {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin, args: [LAUNCH_ARG] });
}
