// Window placement maths and Firebase config discovery (no Electron needed).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPEN, overlayBounds, PILL, taskbarBand } from '../../src/main/windows/overlay';
import { NOTEPAD, notepadBounds, PALETTE, paletteBounds } from '../../src/main/windows/popup';
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
