// Window placement maths and Firebase config discovery (no Electron needed).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPEN, overlayBounds, PILL } from '../../src/main/windows/overlay';
import { NOTEPAD, notepadBounds, PALETTE, paletteBounds } from '../../src/main/windows/popup';
import { readFirebaseConfig } from '../../src/main/config';

const wa = { x: 0, y: 0, width: 1920, height: 1032 };

describe('window placement', () => {
  it('overlay sits bottom-left and grows upward, keeping its bottom edge', () => {
    const c = overlayBounds(wa, false);
    const o = overlayBounds(wa, true);
    expect(c).toEqual({ x: 16, y: 1032 - 16 - PILL.height, ...PILL });
    expect(o.y + o.height).toBe(c.y + c.height);
    expect(o.height).toBe(OPEN.height);
  });
  it('overlay follows a work area that does not start at the origin', () => {
    expect(overlayBounds({ x: 60, y: 40, width: 1000, height: 600 }, false)).toMatchObject({ x: 76, y: 40 + 600 - 16 - PILL.height });
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
