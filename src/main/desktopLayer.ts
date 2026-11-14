// Desktop layer (D-141): parent the Home window to the WorkerW behind the desktop icons so
// Win+D shows Chronos. Native calls go through koffi, loaded lazily and only on win32 (it is
// an external of the main bundle). EVERY failure returns { ok: false, reason } and the caller
// keeps running as a normal window: never throw, never a black screen.
// UNVERIFIED-ON-WINDOWS: see docs/WINDOWS_CHECKLIST.md "Desktop layer".

import { createRequire } from 'node:module';

export interface Rect { left: number; top: number; right: number; bottom: number }

/** The few user32 calls we need; a fake in tests, koffi on Windows. Handles are plain numbers. */
export interface Native {
  progman(): number;
  /** Progman message 0x052C (twice: wParam 0xD with lParam 0 and 1, the second is what Windows 11 24H2 needs). */
  spawnWorkerW(progman: number): void;
  topLevel(): number[];
  find(parent: number, after: number, cls: string): number;
  setParent(child: number, parent: number): boolean;
  rect(h: number): Rect | null;
  move(h: number, x: number, y: number, w: number, hgt: number): void;
}

export type Attach = { ok: true; parent: number; mode: 'classic' | 'progman-child' } | { ok: false; reason: string };

/** Locate the window to parent to. Pre-24H2: the WorkerW sibling after the one holding SHELLDLL_DefView. 24H2: WorkerW is a child of Progman. */
export function findDesktopParent(n: Native): Attach {
  const prog = n.progman();
  if (!prog) return { ok: false, reason: 'Progman not found' };
  n.spawnWorkerW(prog);
  if (n.find(prog, 0, 'SHELLDLL_DefView')) {
    const w = n.find(prog, 0, 'WorkerW');
    if (w) return { ok: true, parent: w, mode: 'progman-child' };
  }
  for (const top of n.topLevel()) {
    if (!n.find(top, 0, 'SHELLDLL_DefView')) continue;
    const w = n.find(0, top, 'WorkerW');
    if (w) return { ok: true, parent: w, mode: 'classic' };
  }
  return { ok: false, reason: 'WorkerW not found' };
}

/** Attach `hwnd`; `px` is the target rectangle in physical screen pixels. */
export function attachWindow(n: Native, hwnd: number, px: { x: number; y: number; width: number; height: number }): Attach {
  const found = findDesktopParent(n);
  if (!found.ok) return found;
  if (!n.setParent(hwnd, found.parent)) return { ok: false, reason: 'SetParent failed' };
  const origin = n.rect(found.parent);
  n.move(hwnd, px.x - (origin?.left ?? 0), px.y - (origin?.top ?? 0), px.width, px.height);
  return found;
}

/** koffi bindings. Throws if koffi or user32 is unavailable; DesktopLayer catches. */
export function loadWin32(): Native {
  const koffi = createRequire(__filename)('koffi');
  const u = koffi.load('user32.dll');
  const FindWindowW = u.func('intptr_t __stdcall FindWindowW(str16 cls, str16 title)');
  const FindWindowExW = u.func('intptr_t __stdcall FindWindowExW(intptr_t parent, intptr_t after, str16 cls, str16 title)');
  const SendMessageTimeoutW = u.func('intptr_t __stdcall SendMessageTimeoutW(intptr_t h, uint32_t msg, uintptr_t w, intptr_t l, uint32_t flags, uint32_t timeout, _Out_ uintptr_t *res)');
  const SetParent = u.func('intptr_t __stdcall SetParent(intptr_t child, intptr_t parent)');
  koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
  const GetWindowRect = u.func('bool __stdcall GetWindowRect(intptr_t h, _Out_ RECT *rect)');
  const MoveWindow = u.func('bool __stdcall MoveWindow(intptr_t h, int x, int y, int w, int hgt, bool repaint)');
  const Proc = koffi.proto('bool __stdcall EnumProc(intptr_t h, intptr_t l)');
  const EnumWindows = u.func('bool __stdcall EnumWindows(EnumProc *cb, intptr_t l)');
  return {
    progman: () => Number(FindWindowW('Progman', null)),
    spawnWorkerW(p) {
      for (const l of [0, 1]) SendMessageTimeoutW(p, 0x052c, 0xd, l, 0, 1000, [0]);
    },
    topLevel() {
      const out: number[] = [];
      const cb = koffi.register((h: number | bigint) => (out.push(Number(h)), true), koffi.pointer(Proc));
      try { EnumWindows(cb, 0); } finally { koffi.unregister(cb); }
      return out;
    },
    find: (parent, after, cls) => Number(FindWindowExW(parent, after, cls, null)),
    setParent: (c, p) => Number(SetParent(c, p)) !== 0,
    rect(h) {
      const r: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
      return GetWindowRect(h, r) ? r : null;
    },
    move: (h, x, y, w, hg) => void MoveWindow(h, x, y, w, hg, true),
  };
}

/** Owns the attach state for one window. `win` is the minimum of Electron's BrowserWindow we use. */
export interface LayerWindow {
  getNativeWindowHandle(): Buffer;
  isDestroyed(): boolean;
}

export class DesktopLayer {
  private native: Native | null = null;
  private tried = false;
  private hwnd = 0;
  attached = false;
  /** Last failure, for the log and Diagnostics. */
  error: string | null = null;

  constructor(private log: (m: string) => void, private load: () => Native = loadWin32, private platform: string = process.platform) {}

  private get(): Native | null {
    if (this.platform !== 'win32') return this.fail('not Windows');
    if (!this.tried) {
      this.tried = true;
      try { this.native = this.load(); } catch (e) { this.fail(`koffi/user32 unavailable: ${e instanceof Error ? e.message : String(e)}`); }
    }
    return this.native;
  }

  private fail(reason: string): null {
    this.error = reason;
    this.log(`desktop layer off: ${reason}`);
    return null;
  }

  /** `px`: target rectangle in physical pixels (screen.dipToScreenRect). Returns whether the window is now on the desktop layer. */
  attach(win: LayerWindow, px: { x: number; y: number; width: number; height: number }): boolean {
    if (this.attached) return true;
    const n = this.get();
    if (!n || win.isDestroyed()) return false;
    try {
      this.hwnd = Number(win.getNativeWindowHandle().readBigUInt64LE(0));
      const r = attachWindow(n, this.hwnd, px);
      if (!r.ok) {
        this.fail(r.reason);
        return false;
      }
      this.error = null;
      this.attached = true;
      this.log(`desktop layer on (${r.mode})`);
      return true;
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  /** Back to a normal top-level window. */
  detach(): void {
    if (!this.attached || !this.native) return;
    this.attached = false;
    try { this.native.setParent(this.hwnd, 0); } catch (e) { this.log(`desktop layer detach: ${e instanceof Error ? e.message : String(e)}`); }
  }

  /** Move an attached window (display changed). */
  place(px: { x: number; y: number; width: number; height: number }): void {
    if (!this.attached || !this.native) return;
    try {
      const parent = findDesktopParent(this.native);
      const o = parent.ok ? this.native.rect(parent.parent) : null;
      this.native.move(this.hwnd, px.x - (o?.left ?? 0), px.y - (o?.top ?? 0), px.width, px.height);
    } catch { /* keep the old placement */ }
  }
}

export type MouseKind = 'move' | 'down' | 'up' | 'wheel';
export interface MouseHook { stop(): void }

/**
 * Low-level mouse hook (WH_MOUSE_LL) that reports left-button and move events while the pointer is over the
 * bare desktop (the window under it is the desktop list view), because the layer behind the icons gets no
 * input of its own. `x`,`y` are physical screen pixels. Returns null (and the layer stays passive) on any failure.
 */
export function startMouseForward(onEvent: (kind: MouseKind, x: number, y: number, delta: number) => void, log: (m: string) => void): MouseHook | null {
  try {
    const koffi = createRequire(__filename)('koffi');
    const u = koffi.load('user32.dll');
    const POINT = koffi.struct('POINT', { x: 'long', y: 'long' });
    const MSLL = koffi.struct('MSLLHOOKSTRUCT', { pt: POINT, mouseData: 'uint32_t', flags: 'uint32_t', time: 'uint32_t', extra: 'uintptr_t' });
    const Proc = koffi.proto('intptr_t __stdcall HookProc(int code, uintptr_t w, void *l)');
    const SetHook = u.func('intptr_t __stdcall SetWindowsHookExW(int id, HookProc *fn, intptr_t mod, uint32_t tid)');
    const Unhook = u.func('bool __stdcall UnhookWindowsHookEx(intptr_t h)');
    const Next = u.func('intptr_t __stdcall CallNextHookEx(intptr_t h, int code, uintptr_t w, void *l)');
    const WindowFromPoint = u.func('intptr_t __stdcall WindowFromPoint(POINT p)');
    const ClassName = u.func('int __stdcall GetClassNameW(intptr_t h, _Out_ uint8_t *buf, int n)');
    const buf = Buffer.alloc(128);
    const overDesktop = (pt: { x: number; y: number }): boolean => {
      const h = WindowFromPoint(pt);
      if (!h) return false;
      const n = ClassName(h, buf, 64);
      return /^(SysListView32|SHELLDLL_DefView|Progman|WorkerW)$/.test(buf.toString('utf16le', 0, Math.max(0, n) * 2));
    };
    let hook = 0;
    const KINDS: Record<number, MouseKind> = { 0x200: 'move', 0x201: 'down', 0x202: 'up', 0x20a: 'wheel' };
    const cb = koffi.register((code: number, w: number | bigint, l: unknown) => {
      const kind = code >= 0 ? KINDS[Number(w)] : undefined;
      if (kind) {
        try {
          const m = koffi.decode(l, MSLL);
          if (overDesktop(m.pt)) onEvent(kind, m.pt.x, m.pt.y, kind === 'wheel' ? (m.mouseData >> 16) << 16 >> 16 : 0);
        } catch { /* never break the system mouse */ }
      }
      return Next(hook, code, w, l);
    }, koffi.pointer(Proc));
    hook = Number(SetHook(14, cb, 0, 0));
    if (!hook) {
      koffi.unregister(cb);
      log('mouse forwarding off: SetWindowsHookEx failed');
      return null;
    }
    return { stop: () => { Unhook(hook); koffi.unregister(cb); } };
  } catch (e) {
    log(`mouse forwarding off: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * Is another app full-screen (a game, a video, a presentation)? SHQueryUserNotificationState:
 * 2 busy (full-screen), 3 Direct3D full-screen, 4 presentation. False off Windows or on any failure.
 */
export function fullscreenAppActive(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    const q = (probe ??= createRequire(__filename)('koffi').load('shell32.dll').func('int32_t __stdcall SHQueryUserNotificationState(_Out_ int32_t *state)') as (out: number[]) => number);
    const out = [0];
    return q(out) === 0 && [2, 3, 4].includes(out[0]!);
  } catch {
    return false;
  }
}
let probe: ((out: number[]) => number) | undefined;
