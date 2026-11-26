// The one way to reach the platform. The web entry (src/web/entry.ts) installs the web
// bridge before the renderer loads; on Electron the first getBridge() wraps the preload.
// The desktop bundle never imports the web code.

import type { ChronosBridge } from './types';
import { electronBridge } from './electron';

let bridge: ChronosBridge | null = null;

/** Called once, before any renderer module runs (web entry, tests). */
export function installBridge(b: ChronosBridge): void {
  bridge = b;
}

export function getBridge(): ChronosBridge {
  bridge ??= electronBridge();
  return bridge;
}

export type { Capabilities, ChronosBridge, WebSession } from './types';
export { UNSUPPORTED } from './types';
