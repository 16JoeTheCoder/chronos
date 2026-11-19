// Window placement maths and Firebase config discovery (no Electron needed).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPEN, overlayBounds, PILL, taskbarBand } from '../../src/main/windows/overlay';
import { NOTEPAD, NOTEPAD_MAX_SHARE, notepadBounds, notepadHeight, PALETTE, paletteBounds } from '../../src/main/windows/popup';
import { readFirebaseConfig } from '../../src/main/config';

const wa = { x: 0, y: 0, width: 1920, height: 1032 };

describe('window placement', () => {
  const disp = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: wa };
  it('overlay docks inside the taskbar band, left by default, as tall as the taskbar', () => {
    expect(taskbarBand(disp)).toEqual({ x: 0, y: 1032, width: 1920, height: 48 });
    const c = overlayBounds(disp, false);
    expect(c).toEqual({ x: 8, y: 1032, width: PILL.width, height: 48 });
    // never over the desktop: entirely inside the band
    expect(c.y).toBeGreaterThanOrEqual(wa.y + wa.height);
  });
  it('right dock stays clear of the tray; free uses the stored position, clamped', () => {
    const r = overlayBounds(disp, false, 'taskbar-right');
    expect(r.x + r.width).toBeLessThanOrEqual(1920 - 300);
    expect(r.y).toBe(1032);
    expect(overlayBounds(disp, false, 'free', { x: 5000, y: 10 })).toMatchObject({ x: 1920 - PILL.width, y: 10 });
  });
  it('a notice grows the pill upward from the band bottom', () => {
    const o = overlayBounds(disp, true);
    expect(o.y + o.height).toBe(1080);
    expect(o.height).toBe(OPEN.height);
  });
  it('top taskbar and hidden taskbar', () => {
    const top = { bounds: disp.bounds, workArea: { x: 0, y: 40, width: 1920, height: 1040 } };
    expect(overlayBounds(top, false)).toMatchObject({ y: 0, height: 40 });
    expect(overlayBounds({ bounds: disp.bounds, workArea: disp.bounds }, false)).toMatchObject({ x: 16, y: 1080 - 16 - PILL.height });
  });
  it('notepad is top-right and the palette is centred', () => {
    expect(notepadBounds(wa)).toEqual({ x: 1920 - NOTEPAD.width - 16, y: 16, ...NOTEPAD });
    const p = paletteBounds(wa);
    expect(p.x * 2 + PALETTE.width).toBe(1920);
    expect(p.y).toBe(Math.round(1032 * 0.2));
  });
});

describe('readFirebaseConfig', () => {
  it('reads the git-ignored file or env vars, else null', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronos-cfg-'));
    expect(readFirebaseConfig(dir, {})).toBeNull();
    const env = { CHRONOS_FIREBASE_API_KEY: 'k', CHRONOS_FIREBASE_AUTH_DOMAIN: 'chronos-jy.firebaseapp.com', CHRONOS_FIREBASE_PROJECT_ID: 'chronos-jy', CHRONOS_FIREBASE_APP_ID: 'a', CHRONOS_FIREBASE_GOOGLE_CLIENT_ID: 'c', CHRONOS_FIREBASE_GOOGLE_CLIENT_SECRET: 's' };
    // Without the Desktop OAuth client the config is incomplete: local-only.
    expect(readFirebaseConfig(dir, { ...env, CHRONOS_FIREBASE_GOOGLE_CLIENT_SECRET: '' })).toBeNull();
    expect(readFirebaseConfig(dir, env)?.projectId).toBe('chronos-jy');
    fs.writeFileSync(path.join(dir, 'firebase.config.json'), JSON.stringify({ apiKey: 'f', authDomain: 'd', projectId: 'p', appId: 'x', googleClientId: 'c', googleClientSecret: 's' }));
    expect(readFirebaseConfig(dir, {})?.apiKey).toBe('f');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('notepad placement (Settings -> Tasks and notepad)', () => {
  const MARGIN = 16;
  const inside = (b: { x: number; y: number; width: number; height: number }, area = wa) => {
    expect(b.x).toBeGreaterThanOrEqual(area.x + MARGIN);
    expect(b.y).toBeGreaterThanOrEqual(area.y + MARGIN);
    expect(b.x + b.width).toBeLessThanOrEqual(area.x + area.width - MARGIN);
    expect(b.y + b.height).toBeLessThanOrEqual(area.y + area.height - MARGIN);
  };

  it('defaults to the top-right corner at the start size', () => {
    expect(notepadBounds(wa)).toEqual({ x: 1920 - NOTEPAD.width - MARGIN, y: MARGIN, width: NOTEPAD.width, height: NOTEPAD.height });
    expect(notepadBounds(wa, 'top-right')).toEqual(notepadBounds(wa));
  });
  it('top-left sits in the opposite corner', () => {
    expect(notepadBounds(wa, 'top-left')).toEqual({ x: MARGIN, y: MARGIN, ...NOTEPAD });
  });
  it('centre is horizontally centred, a fifth of the way down', () => {
    const c = notepadBounds(wa, 'centre');
    expect(c.x * 2 + c.width).toBe(1920);
    expect(c.y).toBe(Math.round(1032 * 0.2));
    expect({ width: c.width, height: c.height }).toEqual(NOTEPAD);
  });
  it('cursor opens just below the pointer, centred on it', () => {
    const b = notepadBounds(wa, 'cursor', { x: 900, y: 400 });
    expect(b).toMatchObject({ x: 900 - NOTEPAD.width / 2, y: 412 });
    inside(b);
  });
  it('cursor is clamped inside the work area at every edge', () => {
    for (const cursor of [{ x: 0, y: 0 }, { x: 1919, y: 1031 }, { x: 5000, y: 5000 }, { x: -300, y: 900 }]) inside(notepadBounds(wa, 'cursor', cursor));
    expect(notepadBounds(wa, 'cursor', { x: 0, y: 0 })).toMatchObject({ x: MARGIN, y: MARGIN });
    // a work area that does not start at the origin (second monitor, taskbar on top)
    const shifted = { x: 1920, y: 40, width: 1280, height: 1000 };
    for (const cursor of [{ x: 1920, y: 40 }, { x: 3199, y: 1039 }]) inside(notepadBounds(shifted, 'cursor', cursor), shifted);
  });
  it('cursor without a pointer position falls back to top-right', () => {
    expect(notepadBounds(wa, 'cursor')).toEqual(notepadBounds(wa));
  });
});

const MARGIN_TOP = 16;

describe('notepadHeight', () => {
  it('never goes below the start height', () => {
    expect(notepadHeight(0, MARGIN_TOP, wa)).toBe(NOTEPAD.height);
    expect(notepadHeight(100, MARGIN_TOP, wa)).toBe(NOTEPAD.height);
    expect(notepadHeight(NOTEPAD.height, MARGIN_TOP, wa)).toBe(NOTEPAD.height);
  });
  it('follows the content in between', () => {
    expect(notepadHeight(400, MARGIN_TOP, wa)).toBe(400);
  });
  it('never exceeds 70 % of the work area', () => {
    const cap = Math.round(wa.height * NOTEPAD_MAX_SHARE);
    expect(NOTEPAD_MAX_SHARE).toBe(0.7);
    expect(notepadHeight(5000, MARGIN_TOP, wa)).toBe(cap);
    expect(notepadHeight(cap + 1, MARGIN_TOP, wa)).toBe(cap);
  });
  it('never reaches past the bottom of the work area', () => {
    for (const top of [100, 500, 800, 1000]) {
      const h = notepadHeight(5000, top, wa);
      expect(top + h).toBeLessThanOrEqual(wa.y + wa.height - 16);
    }
    expect(notepadHeight(5000, 900, wa)).toBe(1032 - 16 - 900);
  });
  it('on a screen smaller than the start height, the cap wins', () => {
    const tiny = { x: 0, y: 0, width: 800, height: 200 };
    expect(notepadHeight(100, MARGIN_TOP, tiny)).toBe(140);
    expect(notepadHeight(5000, MARGIN_TOP, tiny)).toBe(140);
  });
});
