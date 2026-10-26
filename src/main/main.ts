// Electron entry point: wires the controller (state + persistence) to Home, the
// taskbar widget, quick capture, tray, global shortcuts, the shelf, power events
// and notifications. One instance only; a second launch shows Home.

import os from 'node:os';
import path from 'node:path';
import { Menu, app, dialog, powerMonitor, session, shell, type WebContents } from 'electron';
import fs from 'node:fs';
import type { Snapshot } from '../core/model/types';
import { activeTask } from '../core/tasks/tasks';
import { CHANNELS } from '../preload/api';
import { readFirebaseConfig } from './config';
import { Controller } from './controller';
import { registerIpc } from './ipc';
import { describeError, initLog, log } from './log';
import { notify } from './notify';
import { mark, perfMarks } from './perf';
import { Shelf } from './shelf';
import { registerShortcuts, unregisterShortcuts } from './shortcuts';
import { applyLoginItem } from './startup';
import { Store } from './store';
import { AppTray } from './tray';
import { CaptureWindow } from './windows/capture';
import { HomeWindow } from './windows/home';
import { WidgetWindow } from './windows/widget';

const FAST_TICK_MS = 250;
const SLOW_TICK_MS = 30_000;
// 32 px PNG produced by `node scripts/make-icon.mjs --tray` (same artwork as build/icon.png).
const TRAY_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABo0lEQVR42mNgwAF4+QQcqIkZiAG8fAICvHwC83n5BP7TCIPMFs' +
  'BluQEvn8B7GloOwyA7DLD5nB6WIztCANkB8+loOTw6kB1AtMaQ0ND/fX09/3fu3Pb/+PEjYAxig8RAcqSYhZzaCSpOTk7+f+3qpf+fP73Di0FqQGqJdIQDQQ' +
  'dIy8iCfYhsCYjf0FAPtgiEQWxsakB6KXIAyABQEMMMnTNn1n9NLW2cBoLkQGpg6kF6QWZoiwv+P+Qu/d9KRog0ByD7ioRgBasF63vx8P/dhtj//6PlwRjkCK' +
  'IdADeERMtheEOG3/9/Kdpwy0H4fZgcODSIcgAswYGClFTL20zEUSwG4SV2kv9lhIhMA6DsBPM9vjjHhx8EyoIt/tMQ9P/r1eO4sih2B4DyNCwlk1vQRKiJgD' +
  'EsHYHMJNoBME2g7EVpiQcyA49nsDsAlvXISXy4EjPIzKHjgAGPAmokQnTPkJQIqZENYUUzzBySsiGlBREMw+oFkFkkV0aUFsVE6qdxZUQ4HdGnOh66DRK6NM' +
  'kGvFE6WJrlA9sxGfCu2aDonA5U9xwAE4aQCsquI3QAAAAASUVORK5CYII=';

// Tests and the smoke run point the data folder elsewhere; must happen before the instance lock.
if (process.env.CHRONOS_USER_DATA) app.setPath('userData', process.env.CHRONOS_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  initLog(app.getPath('userData'));
  process.on('uncaughtException', (e) => log(`uncaughtException ${describeError(e)}`));
  process.on('unhandledRejection', (e) => log(`unhandledRejection ${describeError(e)}`));
  app.setAppUserModelId('com.builtbyjosef.chronos');
  app.whenReady().then(boot);
}

function boot(): void {
  mark('app.ready');
  let quitting = false;
  let shortcutError: string | null = null;
  const dataDir = app.getPath('userData');

  // v1 makes no network requests: block anything that is not our own files or the dev server.
  const devUrl = process.env.CHRONOS_DEV_URL;
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const allowed = details.url.startsWith('file:') || details.url.startsWith('data:') || details.url.startsWith('devtools:') || (!!devUrl && details.url.startsWith(devUrl.replace(/\/$/, '')));
    if (!allowed) log(`blocked request ${details.url}`);
    cb({ cancel: !allowed });
  });

  const controller = new Controller(
    new Store(dataDir),
    {
      onChange: () => broadcast(),
      onNotify: (n) => notify(n, controller.device, () => widget.win.webContents.send(CHANNELS.beep)),
      onGap: () => home.show(activeTask(controller.data) ? 'focus' : null),
      onDeviceChanged: (prev, next) => applyDevice(next, prev),
    },
    { deviceName: os.hostname(), monolithFile: path.join(app.getPath('appData'), 'Monolith', 'monolith-data.json') },
  );
  controller.init(Date.now());

  const home = new HomeWindow(
    () => controller.device.displayId,
    () => {
      mark('home.ready');
      if (!quitting) {
        home.show(null);
        mark('home.shown');
      }
    },
  );
  const widget = new WidgetWindow(
    () => controller.device,
    (pos) => controller.command({ type: 'device.update', patch: { widgetPos: pos } }, Date.now()),
  );
  const capture = new CaptureWindow();
  const shelf = new Shelf(
    () => Shelf.defaultFolder(controller.device.stackFolder),
    () => home.win.webContents.send(CHANNELS.stackChanged),
  );
  for (const w of [home.win, widget.win]) {
    w.on('close', (e) => {
      if (!quitting) e.preventDefault();
    });
  }

  const quit = () => {
    quitting = true;
    app.quit();
  };
  const startPause = () => controller.toggleStartPause(Date.now());
  const toggleHome = () => home.toggle(activeTask(controller.data) ? 'focus' : 'runway');

  const tray = new AppTray(
    TRAY_ICON,
    {
      show: () => home.show(null),
      startPause,
      setLaunchAtLogin: (on) => controller.command({ type: 'device.update', patch: { launchAtLogin: on } }, Date.now()),
      quit,
    },
    app.isPackaged,
  );

  function snapshot(): Snapshot {
    return {
      data: controller.data,
      device: controller.device,
      pendingGap: controller.pendingGap,
      shortcutError,
      isPackaged: app.isPackaged,
      version: app.getVersion(),
      platform: `${process.platform} ${os.release()} · Electron ${process.versions.electron} · sync config ${readFirebaseConfig(dataDir) ? 'present' : 'absent'}`,
      dataDir,
      perf: perfMarks(),
      homeView: null,
    };
  }

  // Snapshots go out on change only; renderers recompute the display from snapshot + Date.now().
  let fastTick: ReturnType<typeof setInterval> | null = null;
  function broadcast(): void {
    const snap = snapshot();
    const targets: (WebContents | null)[] = [home.win.webContents, widget.win.webContents, capture.webContents];
    for (const wc of targets) if (wc && !wc.isDestroyed()) wc.send(CHANNELS.snapshot, snap);
    tray.update(controller.device.launchAtLogin, controller.running);
    // The 250 ms tick runs only while a timer runs; otherwise only the 30 s tick does.
    if (controller.running && !fastTick) fastTick = setInterval(() => controller.tick(Date.now()), FAST_TICK_MS);
    if (!controller.running && fastTick) {
      clearInterval(fastTick);
      fastTick = null;
    }
  }

  function applyDevice(next: typeof controller.device, prev?: typeof controller.device): void {
    if (!prev || JSON.stringify(prev.shortcuts) !== JSON.stringify(next.shortcuts)) {
      shortcutError = registerShortcuts(next.shortcuts, { toggle: toggleHome, startPause, capture: () => capture.open() });
    }
    if (!prev || prev.launchAtLogin !== next.launchAtLogin) applyLoginItem(next.launchAtLogin);
    if (prev && (prev.widgetDock !== next.widgetDock || (next.widgetDock !== 'free' && prev.widgetPos !== next.widgetPos))) widget.dock();
    if (prev && prev.displayId !== next.displayId) home.fit();
  }

  function widgetMenu(): void {
    Menu.buildFromTemplate([
      { label: controller.running ? 'Pause' : 'Start', enabled: !!activeTask(controller.data), click: startPause },
      { label: 'Show Chronos', click: () => home.show(null) },
      { type: 'separator' },
      { label: 'Quit Chronos', click: quit },
    ]).popup({ window: widget.win });
  }

  registerIpc({
    isOurSender: (e) => [home.win.webContents, widget.win.webContents, capture.webContents].includes(e.sender),
    snapshot,
    command: async (cmd) => {
      if (cmd.type === 'data.openFolder') {
        const err = await shell.openPath(dataDir);
        return err ? { ok: false, error: err } : { ok: true };
      }
      if (cmd.type === 'data.export') {
        const res = await dialog.showSaveDialog(home.win, { defaultPath: `chronos-export-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
        if (res.canceled || !res.filePath) return { ok: false, error: 'Export cancelled.' };
        await fs.promises.writeFile(res.filePath, controller.exportJson());
        return { ok: true };
      }
      return controller.command(cmd, Date.now());
    },
    hide: () => home.hide(),
    widgetClick: toggleHome,
    widgetMenu,
    dragStart: () => widget.dragStart(),
    dragEnd: () => widget.dragEnd(),
    closeCapture: () => capture.close(),
    quit,
    restart: (reason) => {
      log(`renderer error, restarting: ${reason}`);
      quitting = true;
      app.relaunch();
      app.exit(0);
    },
    mark: (name, ms) => mark(`renderer.${name}`, ms),
    stackList: () => shelf.list(),
    stackOpen: (p) => shelf.open(p),
    stackTrash: (p) => shelf.trash(p),
  });

  applyDevice(controller.device);
  broadcast();
  const slowTick = setInterval(() => controller.slowTick(Date.now()), SLOW_TICK_MS);
  powerMonitor.on('suspend', () => controller.suspend(Date.now()));
  powerMonitor.on('resume', () => controller.resume(Date.now()));
  powerMonitor.on('shutdown', () => controller.shutdown(Date.now()));

  app.on('second-instance', () => home.show(null));
  app.on('before-quit', () => {
    quitting = true;
    clearInterval(slowTick);
    if (fastTick) clearInterval(fastTick);
    controller.shutdown(Date.now());
    unregisterShortcuts();
    shelf.stop();
    widget.destroy();
    tray.destroy();
  });
  app.on('window-all-closed', () => app.quit());
}
