// The web bridge: the browser's "main process". The leader tab runs the controller, the sync
// engine and Firestore; other tabs forward to it (web/leader.ts). Desktop-only calls are no-ops
// or UNSUPPORTED, and the UI hides their controls through `can`.

import type { Command, Result } from '../core/commands';
import type { Snapshot } from '../core/model/types';
import { createFilesService, isFileArea } from '../main/files';
import { parseCommand } from '../main/parseCommand';
import { DESKTOP_RELEASE_URL } from './electron';
import { ATTACH_MAX, LeaderCore, LS_LOCAL, LS_PUBLIC } from './web/core';
import { createWebFirebase, readWebConfig, type Usage, type WebConfig, type WebFirebase } from './web/firebase';
import { deleteDb, idbKv, localSmall, type KV, type Small } from './web/kv';
import { browserChan, elect, follow, serve, type Chan, type LockManagerLike, type ReqKind } from './web/leader';
import { openWebStore } from './web/store';
import { UNSUPPORTED, type Capabilities, type ChronosBridge, type Notice, type WebSession } from './types';

type Env = Record<string, string | undefined>;
const viteEnv = (): Env => (import.meta as unknown as { env?: Env }).env ?? {};

/** Everything the bridge touches in the browser, injectable for tests. */
export interface WebDeps {
  kv?: KV;
  small?: Small;
  /** null = no Web Locks: this tab leads. */
  locks?: LockManagerLike | null;
  chan?: () => Chan | null;
  config?: WebConfig | null;
  fb?: WebFirebase | null;
  version?: string;
  download?: (name: string, text: string, mime: string) => void;
  visible?: () => boolean;
  reload?: () => void;
  destroyDb?: () => Promise<void>;
  /** Tests: no tick intervals, no window listeners. */
  quiet?: boolean;
  now?: () => number;
}

const NO_CAPS: Capabilities = { overlay: false, notepadHotkey: false, globalShortcuts: false, desktopLayer: false, localMcp: false, askClaude: false, fileShelf: false, zoom: false, windowControls: false, localFiles: false, windowsSettings: false, cloudFiles: false };
const noop = () => undefined;
const unsub = () => noop;

function saveText(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function createWebBridge(deps: WebDeps = {}): Promise<ChronosBridge> {
  const env = viteEnv();
  const small = deps.small ?? localSmall();
  const config = deps.config !== undefined ? deps.config : readWebConfig(env);
  const fb = deps.fb !== undefined ? deps.fb : config ? createWebFirebase(config) : null;
  const win = deps.quiet || typeof window === 'undefined' ? null : window;
  const visible = deps.visible ?? (() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const reload = deps.reload ?? (() => location.reload());
  const version = deps.version ?? env.VITE_APP_VERSION ?? 'web';
  const download = deps.download ?? saveText;
  const usage: Usage = { reads: 0, writes: 0, listeners: 0 };
  const perf: Record<string, number> = {};

  const snapL = new Set<(s: Snapshot) => void>();
  const beepL = new Set<() => void>();
  const noticeL = new Set<(n: Notice) => void>();
  const emitSnap = (s: Snapshot) => snapL.forEach((cb) => cb(s));
  const emitBeep = () => {
    if (visible()) beepL.forEach((cb) => cb());
  };

  let role: 'leader' | 'follower' = 'follower';
  let core: LeaderCore | null = null;
  let hub: ReturnType<typeof serve> | null = null;
  let client: ReturnType<typeof follow> | null = null;

  const locksOf = (): LockManagerLike | null => (deps.locks !== undefined ? deps.locks : typeof navigator !== 'undefined' && navigator.locks ? (navigator.locks as unknown as LockManagerLike) : null);
  const newChan = () => (deps.chan ? deps.chan() : browserChan());

  async function answer(kind: ReqKind, payload: unknown): Promise<unknown> {
    const c = core!;
    switch (kind) {
      case 'command':
        return c.command(payload as Command);
      case 'undo':
        return c.redeemUndo(payload);
      case 'snapshot':
        return c.snapshot();
      case 'export':
        return c.exportJson();
      case 'exportLog':
        return c.exportLog();
    }
  }

  async function lead(): Promise<void> {
    const store = await openWebStore(deps.kv ?? (await idbKv()), small);
    const c = new LeaderCore({
      store,
      small,
      config,
      fb,
      version,
      deviceName: 'Web browser',
      usage,
      perf: () => ({ ...perf }),
      emit: (s) => {
        emitSnap(s);
        hub?.broadcast({ t: 'snap', snap: s });
      },
      beep: () => {
        emitBeep();
        hub?.broadcast({ t: 'beep' });
      },
      visible,
      destroyDb: deps.destroyDb ?? deleteDb,
      reload: () => {
        hub?.broadcast({ t: 'reload' });
        reload();
      },
      timers: !deps.quiet,
      now: deps.now,
    });
    core = c;
    role = 'leader';
    const chan = newChan();
    hub = chan ? serve(chan, { request: answer, snapshot: () => c.snapshot() }) : null;
    c.start();
    emitSnap(c.snapshot());
    hub?.broadcast({ t: 'snap', snap: c.snapshot() });
    if (win) wire(win, c);
  }

  function wire(w: Window, c: LeaderCore): void {
    w.document.addEventListener('visibilitychange', () => {
      if (visible()) c.becameVisible();
      else {
        c.refreshTicks();
        void c.shutdown();
      }
    });
    w.addEventListener('pagehide', () => void c.shutdown());
    w.addEventListener('online', () => c.setOffline(false));
    w.addEventListener('offline', () => c.setOffline(true));
    // Another tab chose local-only or signed in: this leader starts or stops sync.
    w.addEventListener('storage', (e) => {
      if (e.key === LS_LOCAL) c.reevaluate();
    });
  }

  function follower(): void {
    const chan = newChan();
    if (!chan) return void lead();
    role = 'follower';
    client = follow(chan, { onSnap: emitSnap, onBeep: emitBeep, onReload: reload });
    // A redirect sign-in may land in a follower tab: someone must process it.
    if (fb && !(!config || small.get(LS_LOCAL) === '1')) fb.onUser(noop);
  }

  const elected = elect(locksOf());
  if ((await elected.first) === 'leader') await lead();
  else follower();
  void elected.promoted.then(async () => {
    client?.stop();
    client = null;
    await lead();
  });

  async function rpc<T>(kind: ReqKind, payload?: unknown): Promise<T> {
    if (role === 'leader') return (await answer(kind, payload)) as T;
    return client!.request<T>(kind, payload);
  }
  const failed = (e: unknown): Result => ({ ok: false, error: e instanceof Error ? e.message : String(e) });
  const stamp = () => new Date().toISOString().slice(0, 10);

  // ---- install prompt ----
  type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
  let installEvent: InstallEvent | null = null;
  const installL = new Set<() => void>();
  if (win) {
    win.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      installEvent = e as InstallEvent;
      installL.forEach((cb) => cb());
    });
    win.addEventListener('appinstalled', () => {
      installEvent = null;
      installL.forEach((cb) => cb());
    });
  }

  const isLocal = () => !config || small.get(LS_LOCAL) === '1';
  const web: WebSession = {
    configured: !!config,
    async signIn({ publicComputer }) {
      if (!fb) return { ok: false, error: 'Sync is not set up for this site.' };
      small.set(LS_PUBLIC, publicComputer ? '1' : '0');
      small.remove(LS_LOCAL);
      core?.reevaluate();
      try {
        return await fb.signIn();
      } catch (e) {
        return failed(e);
      }
    },
    isPublicComputer: () => small.get(LS_PUBLIC) === '1',
    continueLocal() {
      small.set(LS_LOCAL, '1');
      core?.reevaluate();
    },
    isLocal,
    async catchUp() {
      if (core) core.catchUp();
      else await rpc('command', { type: 'sync.retry' });
    },
    install: {
      available: () => installEvent !== null,
      async prompt() {
        const e = installEvent;
        if (!e) return false;
        installEvent = null;
        try {
          await e.prompt();
          return (await e.userChoice).outcome === 'accepted';
        } catch {
          return false;
        } finally {
          installL.forEach((cb) => cb());
        }
      },
      onChange: (cb) => {
        installL.add(cb);
        return () => void installL.delete(cb);
      },
    },
    usage: () => ({ ...usage, leader: role === 'leader' }),
    role: () => role,
  };

  // ---- files (the Worker, same protocol as src/main/files.ts; Bearer = Firebase ID token) ----
  const files = createFilesService({ url: () => config?.filesUrl ?? null, token: async () => (fb ? fb.idToken() : null), maxBytes: ATTACH_MAX });
  const badFile: Result = { ok: false, error: 'Invalid file.' };

  return {
    platform: 'web',
    can: { ...NO_CAPS, cloudFiles: !!config?.filesUrl },
    web,
    links: { desktopRelease: DESKTOP_RELEASE_URL },
    openLink: (url) => void window.open(url, '_blank', 'noopener'),

    getSnapshot: () => rpc<Snapshot>('snapshot'),
    onSnapshot: (cb) => {
      snapL.add(cb);
      return () => void snapL.delete(cb);
    },
    onBeep: (cb) => {
      beepL.add(cb);
      return () => void beepL.delete(cb);
    },
    onShow: unsub,
    onNotice: (cb) => {
      noticeL.add(cb);
      return () => void noticeL.delete(cb);
    },
    async command(raw) {
      const cmd = parseCommand(raw);
      if (!cmd) return { ok: false, error: 'Invalid command.' };
      try {
        if (cmd.type === 'data.export') {
          download(`chronos-export-${stamp()}.json`, await rpc<string>('export'), 'application/json');
          return { ok: true };
        }
        if (cmd.type === 'diag.exportLog') {
          download(`chronos-log-${stamp()}.txt`, await rpc<string>('exportLog'), 'text/plain');
          return { ok: true };
        }
        return await rpc<Result>('command', cmd);
      } catch (e) {
        return failed(e);
      }
    },
    undo: (token) => rpc<Result>('undo', token).catch(failed),

    win: {
      hide: noop,
      showHome: noop,
      overlayClick: noop,
      overlayExpand: noop,
      closeNotepad: noop,
      closePalette: noop,
      notepadResize: noop,
      notify: (text, undoToken) => noticeL.forEach((cb) => cb({ text, undoToken })),
      onOpen: unsub,
      quit: noop,
      restart: () => reload(),
      mark: (name, ms) => void (perf[`renderer.${name}`] = ms),
    },
    palette: { askClaude: async () => UNSUPPORTED },
    files: {
      async put(f) {
        if (!isFileArea(f.area)) return badFile;
        return files.put(f.area, f.id, f.name, f.mime, f.bytes);
      },
      async get(area, id) {
        return isFileArea(area) ? files.get(area, id) : { ok: false, error: 'Invalid file.' };
      },
      async remove(area, id) {
        return isFileArea(area) ? files.remove(area, id) : badFile;
      },
    },
    shelf: { list: async () => [], open: async () => UNSUPPORTED, trash: async () => UNSUPPORTED, onChange: unsub },
  };
}
