import { describe, expect, it } from 'vitest';
import { defaultDevice, emptyData } from '../../src/core/model/defaults';
import { paletteCommands } from '../../src/renderer/palette/commands';
import { settingsSections } from '../../src/renderer/settings/sections';
import { needsSignIn, plainSignInError } from '../../src/renderer/signin/logic';
import { isDesktopClass, isMobileUA, viewportClass } from '../../src/renderer/viewport';
import { DESKTOP_CAN, WEB_CAN, fakeBridge } from './fakeBridge';

describe('viewportClass', () => {
  it('splits at 640 and 1024', () => {
    expect([360, 639].map(viewportClass)).toEqual(['phone', 'phone']);
    expect([640, 1023].map(viewportClass)).toEqual(['tablet', 'tablet']);
    expect([1024, 1920].map(viewportClass)).toEqual(['desktop', 'desktop']);
  });
});

describe('isDesktopClass', () => {
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
  const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36';
  const ipad = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
  it('needs width, a mouse and a non-mobile UA', () => {
    expect(isDesktopClass({ width: 1440, finePointer: true, ua: chrome })).toBe(true);
    expect(isDesktopClass({ width: 900, finePointer: true, ua: chrome })).toBe(false);
    expect(isDesktopClass({ width: 1440, finePointer: false, ua: chrome })).toBe(false);
    expect(isDesktopClass({ width: 1440, finePointer: true, ua: android })).toBe(false);
    expect(isDesktopClass({ width: 1366, finePointer: true, ua: ipad })).toBe(false);
  });
  it('spots mobile user agents', () => {
    expect(isMobileUA(android)).toBe(true);
    expect(isMobileUA(chrome)).toBe(false);
  });
});

describe('settingsSections', () => {
  it('keeps every section on desktop', () => {
    expect(settingsSections(DESKTOP_CAN).map((s) => s.id)).toEqual(['look', 'day', 'focus', 'tasks', 'parser', 'timetable', 'account', 'experimental']);
    expect(settingsSections(DESKTOP_CAN).find((s) => s.id === 'tasks')?.label).toBe('Tasks and notepad');
  });
  it('drops "and notepad" from the name when there is no notepad', () => {
    expect(settingsSections(WEB_CAN).find((s) => s.id === 'tasks')?.label).toBe('Tasks');
    expect(settingsSections(WEB_CAN)).toHaveLength(8);
  });
});

describe('palette without Ask Claude', () => {
  const d = emptyData();
  it('answers ">ask" with Ask Claude on desktop and with nothing on the web', () => {
    expect(paletteCommands(d, 'ask hello', [], true)[0]?.key).toBe('ask');
    expect(paletteCommands(d, 'ask hello', [], false).some((c) => c.key === 'ask')).toBe(false);
  });
});

describe('sign-in gate', () => {
  const web = (configured: boolean, local: boolean) => ({ configured, isLocal: () => local });
  it('shows only when configured, not local, and signed out', () => {
    expect(needsSignIn(web(true, false), 'signedOut')).toBe(true);
    expect(needsSignIn(web(true, true), 'signedOut')).toBe(false);
    expect(needsSignIn(web(false, false), 'signedOut')).toBe(false);
    expect(needsSignIn(web(true, false), 'synced')).toBe(false);
    expect(needsSignIn(null, 'signedOut')).toBe(false);
  });
  it('says what went wrong in plain words', () => {
    expect(plainSignInError('auth/popup-closed-by-user')).toMatch(/closed/);
    expect(plainSignInError('network request failed')).toMatch(/connection/);
    expect(plainSignInError('')).toMatch(/did not work/);
    expect(plainSignInError('Account disabled.')).toBe('Account disabled.');
  });
});

describe('fakeBridge', () => {
  it('runs commands through core and pushes snapshots', async () => {
    const b = fakeBridge({ platform: 'web' });
    let seen = 0;
    b.onSnapshot(() => seen++);
    const r = await b.command({ type: 'task.create', input: { title: 'Write essay' } });
    expect(r.ok).toBe(true);
    expect(Object.values((await b.getSnapshot()).data.tasks).map((t) => t.title)).toContain('Write essay');
    expect(seen).toBe(1);
    expect(b.commands).toHaveLength(1);
  });
  it('models the web session', async () => {
    const b = fakeBridge({ platform: 'web', web: { install: true } });
    expect(b.web?.isLocal()).toBe(false);
    b.web?.continueLocal();
    expect(b.web?.isLocal()).toBe(true);
    expect(b.web?.install.available()).toBe(true);
    expect((await b.web!.signIn({ publicComputer: true })).ok).toBe(true);
    expect(b.webCalls).toEqual(['continueLocal', 'signIn:true']);
    b.openLink(b.links.desktopRelease);
    expect(b.opened).toEqual(['fake://desktop-release']);
  });
  it('is Electron-like without a web session', () => {
    const b = fakeBridge({ platform: 'electron' });
    expect(b.web).toBeNull();
    expect(b.can.overlay).toBe(true);
    expect(defaultDevice('x', 'y').deviceId).toBe('x');
  });
});
