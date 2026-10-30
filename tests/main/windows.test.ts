// Widget docking maths and Firebase config discovery (no Electron needed).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dockBounds, WIDGET_H, WIDGET_W } from '../../src/main/windows/widget';
import { readFirebaseConfig } from '../../src/main/config';

const bottom = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1032 } };

describe('dockBounds', () => {
  it('docks in the taskbar free left slot, vertically centred', () => {
    expect(dockBounds(bottom, 'taskbar-left', null)).toEqual({ x: 12, y: 1032 + 2, width: WIDGET_W, height: WIDGET_H });
  });
  it('docks right of centre, leaving room for the tray', () => {
    expect(dockBounds(bottom, 'taskbar-right', null).x).toBe(1920 - WIDGET_W - 320);
  });
  it('falls back to free at top-left for an auto-hidden or side taskbar, and clamps saved positions', () => {
    const autoHide = { bounds: bottom.bounds, workArea: bottom.bounds };
    expect(dockBounds(autoHide, 'taskbar-left', null)).toMatchObject({ x: 12, y: 12 });
    const side = { bounds: bottom.bounds, workArea: { x: 60, y: 0, width: 1860, height: 1080 } };
    expect(dockBounds(side, 'taskbar-left', null)).toMatchObject({ x: 72, y: 12 });
    expect(dockBounds(bottom, 'free', { x: 5000, y: -50 })).toMatchObject({ x: 1920 - WIDGET_W, y: 0 });
  });
});

describe('readFirebaseConfig', () => {
  it('reads the git-ignored file or env vars, else null', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronos-cfg-'));
    expect(readFirebaseConfig(dir, {})).toBeNull();
    const env = { CHRONOS_FIREBASE_API_KEY: 'k', CHRONOS_FIREBASE_AUTH_DOMAIN: 'chronos-jy.firebaseapp.com', CHRONOS_FIREBASE_PROJECT_ID: 'chronos-jy', CHRONOS_FIREBASE_APP_ID: 'a' };
    expect(readFirebaseConfig(dir, env)?.projectId).toBe('chronos-jy');
    fs.writeFileSync(path.join(dir, 'firebase.config.json'), JSON.stringify({ apiKey: 'f', authDomain: 'd', projectId: 'p', appId: 'x' }));
    expect(readFirebaseConfig(dir, {})?.apiKey).toBe('f');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
