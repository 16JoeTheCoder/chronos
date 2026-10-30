// Global shortcuts (only three). Re-registered from scratch whenever they change;
// a failed registration (usually: another app owns that combination) is reported
// back to Settings instead of failing silently.

import { globalShortcut } from 'electron';
import type { DeviceSettings } from '../core/model/types';

export interface ShortcutActions {
  toggle(): void;
  startPause(): void;
  capture(): void;
}

/** Returns a human-readable error, or null when everything registered. */
export function registerShortcuts(sc: DeviceSettings['shortcuts'], actions: ShortcutActions): string | null {
  globalShortcut.unregisterAll();
  const failed: string[] = [];
  for (const [accel, fn] of [[sc.toggle, actions.toggle], [sc.startPause, actions.startPause], [sc.capture, actions.capture]] as const) {
    try {
      if (!globalShortcut.register(accel, fn)) failed.push(accel);
    } catch {
      failed.push(accel);
    }
  }
  return failed.length ? `Could not register ${failed.join(' and ')}. Another app may be using it.` : null;
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
}
