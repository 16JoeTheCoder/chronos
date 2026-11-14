// Electron entry point: wires the controller (state + persistence) to Home, the
// overlay, notepad, palette, tray, global shortcuts, the shelf, power events
// and notifications. One instance only; a second launch shows Home.

import os from 'node:os';
import path from 'node:path';
import { app, clipboard, dialog, net, powerMonitor, safeStorage, session, shell, type WebContents } from 'electron';
import fs from 'node:fs';
import { Mcp } from '../core/mcp/handlers';
import type { Diagnostics, Snapshot, SyncView } from '../core/model/types';
import { activeTask } from '../core/tasks/tasks';
import { CHANNELS, type Notice } from '../preload/api';
import { readFirebaseConfig } from './config';
import { askClaude } from './askClaude';
import { Controller } from './controller';
import { DesktopLayer, fullscreenAppActive } from './desktopLayer';
import { registerIpc } from './ipc';
import { describeError, initLog, log, readLog } from './log';
import { McpServer, newToken } from './mcp/server';
import { SyncManager } from './sync/manager';
import { notify } from './notify';
import { mark, perfMarks } from './perf';
import { Shelf } from './shelf';
import { registerShortcuts, unregisterShortcuts } from './shortcuts';
import { UndoTokens } from './undoTokens';
import { applyLoginItem } from './startup';
import { Store } from './store';
import { AppTray } from './tray';
import { HomeWindow } from './windows/home';
import { OverlayWindow } from './windows/overlay';
import { NOTEPAD, PALETTE, notepadBounds, paletteBounds, PopupWindow } from './windows/popup';

const FAST_TICK_MS = 250;
const NOTICE_MS = 9000;
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
  const firebaseConfig = readFirebaseConfig([dataDir, path.join(app.getAppPath(), 'firebase')]);
  const syncConfig = firebaseConfig ? 'present' : 'absent';

  // Renderers make no network requests: block anything that is not our own files or the dev server.
  // Sync (Firestore, Google sign-in) runs in the main process with Node networking, not here (D-116).
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
      onNotify: (n) => notify(n, controller.device, () => overlay.webContents?.send(CHANNELS.beep)),
      onGap: () => home.show(activeTask(controller.data) ? 'focus' : null),
      onDeviceChanged: (prev, next) => applyDevice(next, prev),
      log: (m) => log(m),
    },
    { deviceName: os.hostname(), monolithFile: path.join(app.getPath('appData'), 'Monolith', 'monolith-data.json') },
  );
  controller.init(Date.now());

  const sync = new SyncManager(
    controller,
    firebaseConfig,
    () => require(path.join(__dirname, 'sync.js')),
    {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (s) => safeStorage.encryptString(s).toString('base64'),
      decrypt: (b) => safeStorage.decryptString(Buffer.from(b, 'base64')),
    },
    (url) => shell.openExternal(url),
    log,
    () => broadcast(),
  );

  // Claude (MCP): the handlers run against the live controller, like any UI edit.
  const mcp = new Mcp({
    data: () => controller.data,
    now: () => Date.now(),
    run: (cmd) => controller.command(cmd, Date.now()),
    notify: (n) => notice({ text: n.text, undoToken: n.undoToken }),
    // The parser (and chrono-node) is a lazy chunk, like sync.js, to keep it out of the main bundle (D-147).
    parse: (text, ctx) => (require(path.join(__dirname, 'parser.js')) as typeof import('../core/parser')).parse(text, ctx),
  });
  const undoTokens = new UndoTokens();
  const mcpServer = new McpServer(() => mcp, log);
  const bridgePath = app.isPackaged ? path.join(process.resourcesPath, 'chronos-mcp.js') : path.join(app.getAppPath(), 'dist', 'chronos-mcp.js');
  async function applyMcp(): Promise<void> {
    const m = controller.device.mcp;
    if (!m.enabled) {
      await mcpServer.stop();
      broadcast();
      return;
    }
    const token = m.token || newToken();
    try {
      const port = await mcpServer.start(m.port, () => controller.device.mcp.token);
      if (port !== m.port || token !== m.token) controller.setDeviceFields({ mcp: { enabled: true, port, token } });
    } catch {
      // error kept on mcpServer for Diagnostics
    }
    broadcast();
  }
  function claudeConfig(): string {
    const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1' };
    if (process.env.CHRONOS_USER_DATA) env.CHRONOS_USER_DATA = dataDir;
    return JSON.stringify({ mcpServers: { chronos: { command: process.execPath, args: [bridgePath], env } } }, null, 2);
  }
  // Notices (Claude's changes, notepad results) carry an Undo. Home shows them when you are in it; otherwise
  // the overlay does, and stays up long enough to read and click.
  let noticeUntil = 0;
  function notice(n: Notice): void {
    const homeActive = home.visible && !layer.attached;
    const target = homeActive ? home.win.webContents : overlay.webContents;
    if (!homeActive) {
      noticeUntil = Date.now() + NOTICE_MS;
      setTimeout(syncOverlay, NOTICE_MS + 500);
    }
    if (target && !target.isDestroyed()) target.send(CHANNELS.notice, n);
    syncOverlay();
  }
  function syncOverlay(): void {
    overlay.want(!!activeTask(controller.data) || Date.now() < noticeUntil);
  }

  const layer = new DesktopLayer(log);
  const home = new HomeWindow(
    () => controller.device.displayId,
    () => {
      mark('home.ready');
      if (!quitting) {
        home.show(null);
        mark('home.shown');
      }
    },
    layer,
    () => controller.device.liveOnDesktop,
    log,
  );
  const overlay = new OverlayWindow(fullscreenAppActive, () => controller.device.overlayHideInFullscreen);
  const popupOpts = { backgroundColor: '#00000000', transparent: true, hasShadow: false } as const;
  const notepad = new PopupWindow('#notepad', notepadBounds, { ...popupOpts, ...NOTEPAD, title: 'Chronos notepad' }, false);
  const palette = new PopupWindow('#palette', paletteBounds, { ...popupOpts, ...PALETTE, title: 'Chronos palette' }, true);
  // Smoke test only (scripts/smoke.mjs): global shortcuts cannot be pressed under Xvfb, so the script opens the popups here.
  if (process.env.CHRONOS_SMOKE) (globalThis as Record<string, unknown>).__chronosSmoke = { openNotepad: () => notepad.open(), openPalette: () => palette.open() };
  const shelf = new Shelf(
    () => Shelf.defaultFolder(controller.device.stackFolder),
    () => home.win.webContents.send(CHANNELS.stackChanged),
  );
  for (const w of [home.win, overlay.win]) {
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

  function syncView(): SyncView {
    const st = !sync.configured ? 'off' : !sync.signedIn ? (sync.busy ? 'syncing' : 'signedOut') : controller.sync.state;
    return {
      state: st,
      reason: st === 'signedOut' || st === 'off' ? sync.lastError : controller.sync.reason,
      pending: controller.outbox.length,
      oldestPendingAt: controller.outbox[0]?.createdAt ?? null,
      lastSyncAt: controller.device.sync.lastSyncAt,
      email: sync.signedIn ? controller.device.auth.email : null,
      configured: sync.configured,
    };
  }

  function diag(): Diagnostics | null {
    if (!controller.device.experimental) return null;
    const m = controller.device.mcp;
    return {
      cursors: controller.device.sync.cursors,
      conflicts: controller.conflicts.slice(-100).reverse(),
      quarantine: controller.quarantine.slice(-100).reverse(),
      snapshots: controller.snapshots(),
      mcp: { enabled: m.enabled, running: mcpServer.running, port: mcpServer.port || m.port, token: m.token, error: mcpServer.error, bridgePath, config: claudeConfig() },
    };
  }

  async function exportLog(): Promise<{ ok: true } | { ok: false; error: string }> {
    const res = await dialog.showSaveDialog(home.win, { defaultPath: `chronos-log-${new Date().toISOString().slice(0, 10)}.txt`, filters: [{ name: 'Text', extensions: ['txt'] }] });
    if (res.canceled || !res.filePath) return { ok: false, error: 'Export cancelled.' };
    const state = { version: app.getVersion(), platform: `${process.platform} ${os.release()}`, sync: syncView(), deviceId: controller.device.deviceId, cursors: controller.device.sync.cursors, outbox: controller.outbox.map((e) => ({ opId: e.opId, coll: e.coll, id: e.id, fields: Object.keys(e.fields), createdAt: new Date(e.createdAt).toISOString(), seed: !!e.seed })), conflicts: controller.conflicts, quarantine: controller.quarantine.map((q) => ({ ...q, doc: undefined })), mcp: { enabled: controller.device.mcp.enabled, running: mcpServer.running, port: mcpServer.port, error: mcpServer.error } };
    await fs.promises.writeFile(res.filePath, `Chronos diagnostics\n\n## State\n${JSON.stringify(state, null, 2)}\n\n## logs/chronos.log\n${readLog()}`);
    return { ok: true };
  }

  function snapshot(): Snapshot {
    return {
      data: controller.data,
      device: controller.device,
      pendingGap: controller.pendingGap,
      shortcutError,
      isPackaged: app.isPackaged,
      version: app.getVersion(),
      platform: `${process.platform} ${os.release()} · Electron ${process.versions.electron} · sync config ${syncConfig}`,
      dataDir,
      perf: perfMarks(),
      homeView: null,
      sync: syncView(),
      diag: diag(),
    };
  }

  // Snapshots go out on change only; renderers recompute the display from snapshot + Date.now().
  let fastTick: ReturnType<typeof setInterval> | null = null;
  function broadcast(): void {
    const snap = snapshot();
    const targets: (WebContents | null)[] = [home.win.webContents, overlay.webContents, notepad.webContents, palette.webContents];
    for (const wc of targets) if (wc && !wc.isDestroyed()) wc.send(CHANNELS.snapshot, snap);
    syncOverlay();
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
      shortcutError = registerShortcuts(next.shortcuts, { toggle: toggleHome, startPause, capture: () => notepad.open(), palette: () => palette.open() });
    }
    if (!prev || prev.launchAtLogin !== next.launchAtLogin) applyLoginItem(next.launchAtLogin);
    if (prev && prev.liveOnDesktop && !next.liveOnDesktop) home.layerOff();
    if (prev && prev.displayId !== next.displayId) home.fit();
    if (prev && prev.mcp.enabled !== next.mcp.enabled) void applyMcp();
  }

  registerIpc({
    isOurSender: (e) => [home.win.webContents, overlay.webContents, notepad.webContents, palette.webContents].includes(e.sender),
    snapshot,
    command: async (cmd) => {
      if (cmd.type === 'data.openFolder') {
        const err = await shell.openPath(dataDir);
        return err ? { ok: false, error: err } : { ok: true };
      }
      switch (cmd.type) {
        case 'sync.signIn':
          return sync.signIn();
        case 'sync.signOut':
          await sync.signOut();
          return { ok: true };
        case 'sync.retry':
          if (!sync.signedIn) void sync.resume();
          controller.engine.reconnect();
          return { ok: true };
        case 'sync.forceResync':
          if (!sync.signedIn) return { ok: false, error: 'Sign in first.' };
          controller.forceResync(Date.now());
          return { ok: true };
        case 'diag.clear':
          if (cmd.what === 'conflicts') controller.clearConflicts();
          else controller.clearQuarantine();
          return { ok: true };
        case 'diag.exportLog':
          return exportLog();
        case 'snapshot.restore':
          return controller.restoreSnapshot(cmd.name, Date.now());
        case 'mcp.regenerateToken':
          controller.setDeviceFields({ mcp: { ...controller.device.mcp, token: newToken() } });
          return { ok: true };
        case 'mcp.copyConfig':
          clipboard.writeText(claudeConfig());
          return { ok: true };
        case 'mcp.undo': {
          // Notepad undo tokens (D-143) share this command so Home's existing toast code works for both.
          const revert = undoTokens.redeem(cmd.token);
          if (revert) return controller.command(revert, Date.now());
          const r = mcp.undoToken(cmd.token);
          return r.ok ? { ok: true } : { ok: false, error: r.error };
        }
        default:
          break;
      }
      if (cmd.type === 'data.export') {
        const res = await dialog.showSaveDialog(home.win, { defaultPath: `chronos-export-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
        if (res.canceled || !res.filePath) return { ok: false, error: 'Export cancelled.' };
        await fs.promises.writeFile(res.filePath, controller.exportJson());
        return { ok: true };
      }
      return controller.command(cmd, Date.now());
    },
    seal: (r) => undoTokens.seal(r),
    redeemUndo: (t) => undoTokens.redeem(t),
    hide: () => home.hide(),
    showHome: (view) => {
      palette.close();
      home.show(view);
    },
    overlayClick: toggleHome,
    overlayExpand: (on) => overlay.expand(on),
    closeNotepad: (created) => {
      notepad.close();
      if (created) {
        const token = undoTokens.hold(created.records.map((r) => ({ coll: r.coll, id: r.id, prev: null })));
        notice({ text: created.text || 'Added from your notes', undoToken: token });
      }
    },
    closePalette: () => palette.close(),
    notify: (text, undoToken) => notice({ text, undoToken }),
    askClaude,
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
  void applyMcp();
  void sync.resume();
  let online = net.isOnline();
  const slowTick = setInterval(() => {
    const now = Date.now();
    controller.slowTick(now);
    sync.tick(now);
    // Network regained / lost (rule 7). The engine also reconnects on its own errors.
    const isOnline = net.isOnline();
    if (isOnline !== online) {
      online = isOnline;
      log(`network ${online ? 'online' : 'offline'}`);
      controller.engine.setOffline(!online);
    }
  }, SLOW_TICK_MS);
  powerMonitor.on('suspend', () => controller.suspend(Date.now()));
  powerMonitor.on('resume', () => {
    controller.resume(Date.now());
    controller.engine.reconnect();
  });
  powerMonitor.on('unlock-screen', () => controller.engine.reconnect());
  powerMonitor.on('shutdown', () => controller.shutdown(Date.now()));

  app.on('second-instance', () => home.show(null));
  app.on('before-quit', () => {
    quitting = true;
    clearInterval(slowTick);
    if (fastTick) clearInterval(fastTick);
    controller.shutdown(Date.now());
    controller.stopSync();
    void mcpServer.stop();
    unregisterShortcuts();
    shelf.stop();
    overlay.destroy();
    notepad.destroy();
    palette.destroy();
    layer.detach();
    tray.destroy();
  });
  app.on('window-all-closed', () => app.quit());
}
