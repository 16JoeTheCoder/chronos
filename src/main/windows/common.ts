// Shared BrowserWindow hardening (§8.1): context isolation, sandbox, no node,
// no navigation, no popups, no permissions, and the page loaded from our files.

import path from 'node:path';
import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { log } from '../log';

export function secureWindow(opts: BrowserWindowConstructorOptions, page: 'index.html' | 'widget.html', hash = ''): BrowserWindow {
  const win = new BrowserWindow({
    ...opts,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  const wc = win.webContents;
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Only clipboard writes (About → Copy diagnostics) are allowed.
  wc.session.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'));
  wc.on('render-process-gone', (_e, d) => log(`renderer gone (${page}${hash}): ${d.reason} (${d.exitCode})`));
  const dev = process.env.CHRONOS_DEV_URL;
  if (dev) void win.loadURL(`${dev}${page}${hash}`);
  else void win.loadFile(path.join(__dirname, 'renderer', page), hash ? { hash: hash.slice(1) } : undefined);
  return win;
}
