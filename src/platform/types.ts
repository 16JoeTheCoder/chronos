// The platform bridge (Phase 4, FROZEN: changes go through the lead, docs/swarm/BOARD.md).
// The renderer talks to the platform only through `getBridge()` (src/platform/index.ts):
// the Electron adapter wraps the preload (window.chronos); the web adapter runs the
// controller, core commands and Firestore sync in the page. No renderer file may touch
// window.chronos (scripts/audit.mjs).

import type { ChronosApi } from '../preload/api';
import type { Result } from '../core/commands';

export type { ChronosApi, Notice, NotepadCreated } from '../preload/api';

/** What this platform can do. The UI hides a control whose flag is false (never shows it disabled). */
export interface Capabilities {
  /** Overlay pill window in the taskbar band. */
  overlay: boolean;
  /** Notepad window with a global hotkey. */
  notepadHotkey: boolean;
  /** Global shortcuts (start/pause, palette) registered with the OS. */
  globalShortcuts: boolean;
  /** "Live on the desktop" (WorkerW) layer. */
  desktopLayer: boolean;
  /** Local MCP endpoint for Claude Desktop. */
  localMcp: boolean;
  /** Ask Claude (copies and opens Claude Desktop). */
  askClaude: boolean;
  /** The Downloads/Desktop file shelf on Home. */
  fileShelf: boolean;
  /** Per-device UI size presets (zoom factor). */
  zoom: boolean;
  /** Hide / quit / restart the app window, tray. */
  windowControls: boolean;
  /** Open the data folder, Monolith import, local JSON snapshots. */
  localFiles: boolean;
  /** Windows-only settings (start with Windows, taskbar band, overlay dock). */
  windowsSettings: boolean;
  /** Cloud attachments through the files Worker (both platforms when configured). */
  cloudFiles: boolean;
}

/** Returned by any desktop-only call on the web. */
export const UNSUPPORTED: Result = { ok: false, error: 'Not available on the web.' };

/** Web-only session controls (null on Electron). */
export interface WebSession {
  /** Google sign-in (popup, redirect fallback on mobile Safari / in-app browsers). publicComputer: wipe local data on sign-out. */
  signIn(opts: { publicComputer: boolean }): Promise<Result>;
  /** True when this browser was signed in as a public computer. */
  isPublicComputer(): boolean;
  /** Use Chronos in this browser without an account (local only, no sync). Also used by tests and screenshots. */
  continueLocal(): void;
  /** The user chose local-only (or Firebase is not configured): no sign-in screen. */
  isLocal(): boolean;
  /** Firebase web config present at build time. */
  configured: boolean;
  /** Pull to refresh: ask the sync engine to catch up now. */
  catchUp(): Promise<void>;
  /** PWA install prompt (beforeinstallprompt), when the browser offered one. */
  install: { available(): boolean; prompt(): Promise<boolean>; onChange(cb: () => void): () => void };
  /** Firestore document reads/writes this session (Settings → Experimental usage meter). */
  usage(): { reads: number; writes: number; listeners: number; leader: boolean };
  /** This tab runs sync (leader) or follows another tab over BroadcastChannel. */
  role(): 'leader' | 'follower';
}

export interface ChronosBridge extends ChronosApi {
  platform: 'electron' | 'web';
  can: Capabilities;
  web: WebSession | null;
  /** Links the UI may open (kept here: URL literals are not allowed in the renderer). */
  links: { desktopRelease: string };
  /** Open a URL in the system browser (Electron) or a new tab (web). Only bridge.links values. */
  openLink(url: string): void;
}
