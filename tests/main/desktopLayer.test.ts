// Desktop layer diagnostics (Phase 3.5 §10): every attach step is logged, and the last result is a status line.
import { describe, expect, it } from 'vitest';
import { DesktopLayer, findDesktopParent, type Native } from '../../src/main/desktopLayer';

function fake(layout: '24h2' | 'classic' | 'none', setParentOk = true): Native {
  return {
    progman: () => (layout === 'none' ? 0 : 0x10),
    spawnWorkerW: () => undefined,
    topLevel: () => [0x10, 0x20],
    find: (parent, after, cls) => {
      if (layout === '24h2' && parent === 0x10 && cls === 'SHELLDLL_DefView') return 0x11;
      if (layout === '24h2' && parent === 0x10 && cls === 'WorkerW') return 0x12;
      if (layout === 'classic' && parent === 0x20 && cls === 'SHELLDLL_DefView') return 0x21;
      if (layout === 'classic' && parent === 0 && after === 0x20 && cls === 'WorkerW') return 0x30;
      return 0;
    },
    setParent: () => setParentOk,
    rect: () => ({ left: 0, top: 0, right: 100, bottom: 100 }),
    move: () => undefined,
  };
}
const win = { getNativeWindowHandle: () => { const b = Buffer.alloc(8); b.writeBigUInt64LE(0x99n); return b; }, isDestroyed: () => false };
const px = { x: 0, y: 0, width: 100, height: 100 };

describe('desktop layer', () => {
  it('handles the 24H2 layout (WorkerW as a child of Progman) and traces each step', () => {
    const steps: string[] = [];
    expect(findDesktopParent(fake('24h2'), (s) => steps.push(s))).toEqual({ ok: true, parent: 0x12, mode: 'progman-child' });
    expect(steps.join('\n')).toMatch(/found Progman 0x10[\s\S]*sent 0x052C[\s\S]*24H2 layout: WorkerW 0x12/);
  });
  it('logs the build, SetParent result and reports "attached"', () => {
    const log: string[] = [];
    const l = new DesktopLayer((m) => log.push(m), () => fake('classic'), 'win32', '10.0.22631');
    expect(l.attach(win, px)).toBe(true);
    expect(l.status).toBe('attached (classic layout, build 10.0.22631)');
    expect(log.join('\n')).toMatch(/build 10\.0\.22631[\s\S]*SetParent\(0x99, 0x30\) ok/);
  });
  it('a failure leaves the window fallback with the reason', () => {
    const l = new DesktopLayer(() => undefined, () => fake('24h2', false), 'win32', 'x');
    expect(l.attach(win, px)).toBe(false);
    expect(l.status).toBe('fallback, SetParent failed');
    const n = new DesktopLayer(() => undefined, () => fake('none'), 'win32', 'x');
    n.attach(win, px);
    expect(n.status).toBe('fallback, Progman not found');
    expect(new DesktopLayer(() => undefined, () => fake('none'), 'linux').attach(win, px)).toBe(false);
  });
});
