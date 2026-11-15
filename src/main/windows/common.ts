// Shared BrowserWindow hardening (§8.1): context isolation, sandbox, no node,
// no navigation, no popups, no permissions, and the page loaded from our files.

import path from 'node:path';
import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { log } from '../log';

export function secureWindow(opts: BrowserWindowConstructorOptions, page: 'index.html' | 'windows.html', hash = ''): BrowserWindow {
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

/** Ctrl + these keys zoom in Chromium; Chronos blocks them (Settings → Look → Size replaces zoom). */
export const ZOOM_KEYS = new Set(['=', '+', '-', '_', '0', 'add', 'subtract', 'numpadadd', 'numpadsubtract', 'plus', 'minus']);
export const isZoomInput = (i: { control: boolean; meta: boolean; alt: boolean; key: string; type: string }): boolean =>
  i.type === 'keyDown' && (i.control || i.meta) && !i.alt && ZOOM_KEYS.has(i.key.toLowerCase());

/**
 * Disable Electron zoom (Ctrl+= / Ctrl+- / Ctrl+0, Ctrl+wheel, pinch) and hold the window at
 * `factor()` (the Size preset, 1 for popups). Call `apply()` again when the preset changes.
 */
export function lockZoom(win: BrowserWindow, factor: () => number = () => 1): { apply(): void } {
  const wc = win.webContents;
  const apply = () => {
    if (wc.isDestroyed()) return;
    void wc.setVisualZoomLevelLimits(1, 1);
    if (Math.abs(wc.getZoomFactor() - factor()) > 0.001) wc.setZoomFactor(factor());
  };
  wc.on('before-input-event', (e, input) => { if (isZoomInput(input)) e.preventDefault(); });
  // Ctrl+wheel changes the zoom without a key event: snap it back.
  wc.on('zoom-changed', () => setTimeout(apply, 0));
  wc.on('did-finish-load', apply);
  return { apply };
}
