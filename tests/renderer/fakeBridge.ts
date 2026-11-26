// A fake ChronosBridge for renderer tests (and QA later). Commands run through the real core `apply`
// over in-memory data, so screens behave as they do on a device, with no Electron, IndexedDB or network.
//   const b = fakeBridge({ platform: 'web', can: { overlay: false } });
//   installBridge(b);  // before importing any renderer module
//   b.setSync({ state: 'signedOut' });
import { apply, type Command, type Result } from '../../src/core/commands';
import { defaultDevice, emptyData } from '../../src/core/model/defaults';
import type { Data, Snapshot, SyncView } from '../../src/core/model/types';
import type { Capabilities, ChronosBridge, WebSession } from '../../src/platform/types';
import { UNSUPPORTED } from '../../src/platform/types';

export const DESKTOP_CAN: Capabilities = { overlay: true, notepadHotkey: true, globalShortcuts: true, desktopLayer: true, localMcp: true, askClaude: true, fileShelf: true, zoom: true, windowControls: true, localFiles: true, windowsSettings: true, cloudFiles: true };
export const WEB_CAN: Capabilities = { overlay: false, notepadHotkey: false, globalShortcuts: false, desktopLayer: false, localMcp: false, askClaude: false, fileShelf: false, zoom: false, windowControls: false, localFiles: false, windowsSettings: false, cloudFiles: true };

export interface FakeBridge extends ChronosBridge {
  /** Every command received, in order. */
  commands: Command[];
  /** Links opened through openLink. */
  opened: string[];
  /** Calls made on the web session. */
  webCalls: string[];
  data: Data;
  setSync(patch: Partial<SyncView>): void;
  setData(d: Data): void;
  emit(): void;
}

export interface FakeOptions {
  platform?: 'electron' | 'web';
  can?: Partial<Capabilities>;
  /** Web session state. Pass null for Electron-like. Default: a configured, signed-out web session. */
  web?: Partial<{ configured: boolean; local: boolean; publicComputer: boolean; install: boolean; signIn: Result }> | null;
  now?: number;
}

export function fakeBridge(o: FakeOptions = {}): FakeBridge {
  const platform = o.platform ?? 'web';
  const can = { ...(platform === 'web' ? WEB_CAN : DESKTOP_CAN), ...o.can };
  let data = emptyData();
  let sync: SyncView = { state: platform === 'web' ? 'signedOut' : 'off', reason: null, pending: 0, oldestPendingAt: null, lastSyncAt: null, email: null, configured: true, files: false };
  const listeners = new Set<(s: Snapshot) => void>();
  const device = defaultDevice('fake-device', 'Fake');
  const snapshot = (): Snapshot => ({ data, device, pendingGap: null, shortcutError: null, desktopLayer: null, isPackaged: false, version: '0.0.0-test', platform: platform === 'web' ? 'web' : 'win32', dataDir: '', perf: {}, homeView: null, sync, diag: null });
  const emit = () => listeners.forEach((l) => l(snapshot()));
  const commands: Command[] = [];
  const opened: string[] = [];
  const webCalls: string[] = [];

  const wo = o.web === undefined ? {} : o.web;
  let local = wo?.local ?? false;
  const installCbs = new Set<() => void>();
  const web: WebSession | null = platform === 'web' && wo !== null
    ? {
        signIn: async (opts) => { webCalls.push(`signIn:${opts.publicComputer}`); return wo.signIn ?? { ok: true }; },
        isPublicComputer: () => wo.publicComputer ?? false,
        continueLocal: () => { webCalls.push('continueLocal'); local = true; },
        isLocal: () => local,
        configured: wo.configured ?? true,
        catchUp: async () => { webCalls.push('catchUp'); },
        install: { available: () => wo.install ?? false, prompt: async () => { webCalls.push('install'); return true; }, onChange: (cb) => { installCbs.add(cb); return () => installCbs.delete(cb); } },
        usage: () => ({ reads: 12, writes: 3, listeners: 6, leader: true }),
        role: () => 'leader',
      }
    : null;

  const unsupported = async () => UNSUPPORTED;
  const bridge: FakeBridge = {
    platform,
    can,
    web,
    links: { desktopRelease: 'fake://desktop-release' },
    openLink: (url) => void opened.push(url),
    commands,
    opened,
    webCalls,
    get data() { return data; },
    setData: (d) => { data = d; emit(); },
    setSync: (p) => { sync = { ...sync, ...p }; emit(); },
    emit,
    getSnapshot: async () => snapshot(),
    onSnapshot: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    onBeep: () => () => undefined,
    onShow: () => () => undefined,
    onNotice: () => () => undefined,
    command: async (cmd) => {
      commands.push(cmd);
      const r = apply(data, cmd, { now: o.now ?? Date.now(), deviceId: device.deviceId, deviceName: device.deviceName });
      if (!r.ok) return { ok: false, error: r.error, fields: r.fields };
      data = r.d;
      emit();
      return { ok: true, id: r.id };
    },
    undo: unsupported,
    win: { hide() {}, showHome() {}, overlayClick() {}, overlayExpand() {}, closeNotepad() {}, closePalette() {}, notepadResize() {}, notify() {}, onOpen: () => () => undefined, quit() {}, restart() {}, mark() {} },
    palette: { askClaude: unsupported },
    files: { put: unsupported, get: async () => ({ ok: false, error: UNSUPPORTED.ok ? '' : UNSUPPORTED.error }), remove: unsupported },
    shelf: { list: async () => [], open: unsupported, trash: unsupported, onChange: () => () => undefined },
  };
  return bridge;
}
