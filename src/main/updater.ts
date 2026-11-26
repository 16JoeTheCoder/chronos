// Auto-update from GitHub Releases (electron-updater). Installed builds only: dev runs and the portable
// exe skip it. Downloads in the background and installs when the app quits. Never throws, never blocks.

import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { describeError, log } from './log';

const FIRST_CHECK_MS = 30_000;
const EVERY_MS = 4 * 60 * 60 * 1000;

export function startAutoUpdate(opts: { notify: (msg: string) => void }): void {
  try {
    if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: (m: unknown) => log(`updater ${String(m)}`), warn: (m: unknown) => log(`updater ${String(m)}`), error: (m: unknown) => log(`updater ${String(m)}`) };
    autoUpdater.on('error', (e) => log(`updater error ${describeError(e)}`));
    autoUpdater.on('update-downloaded', (info) => {
      log(`updater downloaded ${info.version}`);
      try {
        opts.notify('Update downloaded, installs when you quit');
      } catch (e) {
        log(`updater notify failed ${describeError(e)}`);
      }
    });
    const check = (): void => {
      autoUpdater.checkForUpdates().catch((e) => log(`updater check failed ${describeError(e)}`));
    };
    setTimeout(check, FIRST_CHECK_MS).unref();
    setInterval(check, EVERY_MS).unref();
  } catch (e) {
    log(`updater disabled ${describeError(e)}`);
  }
}
