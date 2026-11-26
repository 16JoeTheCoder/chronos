// The phone shell's pure parts: viewport classes, the chrome budget, pull-to-refresh, the tab and More lists.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BREAKPOINTS, classifyViewport, currentViewport } from '../../../src/renderer/shell/viewport';
import { CHROME_MAX_RATIO, RUNNING_PILL_H, TAB_BAR_H, TOP_BAR_H, chromePx, chromeRatio, withinBudget } from '../../../src/renderer/shell/chrome';
import { PULL_MAX, PULL_THRESHOLD, canStartPull, phaseFor, pullOffset, shouldRefresh } from '../../../src/renderer/shell/pull';
import { MORE_ITEMS, TABS, activeTab, screenTitle } from '../../../src/renderer/shell/items';

describe('viewport classes', () => {
  it('phone < 640, tablet 640-1023, desktop >= 1024', () => {
    expect([320, 360, 390, 639].map(classifyViewport)).toEqual(['phone', 'phone', 'phone', 'phone']);
    expect([640, 768, 1023].map(classifyViewport)).toEqual(['tablet', 'tablet', 'tablet']);
    expect([1024, 1440, 2560].map(classifyViewport)).toEqual(['desktop', 'desktop', 'desktop']);
  });
  it("is guarded without matchMedia (node): desktop, today's layout", () => {
    expect(currentViewport()).toBe('desktop');
  });
  it('responsive.css documents the same numbers', () => {
    const css = readFileSync('src/renderer/styles/responsive.css', 'utf8');
    expect(css).toContain(`< ${BREAKPOINTS.tablet}`);
    expect(css).toContain(`${BREAKPOINTS.tablet} - ${BREAKPOINTS.desktop - 1}`);
    expect(css).toContain(`>= ${BREAKPOINTS.desktop}`);
    for (const [name, px] of [['--sh-top', TOP_BAR_H], ['--sh-pill', RUNNING_PILL_H], ['--sh-tab', TAB_BAR_H]] as const) expect(css).toContain(`${name}: ${px}px`);
  });
});

describe('chrome budget', () => {
  it('top bar 52 + pill 48 + tab bar 56 = 156 px', () => {
    expect(chromePx({ pill: true })).toBe(156);
    expect(chromePx({ pill: false })).toBe(108);
  });
  it('is within 20 % of a 390x844 phone, with and without the pill', () => {
    expect(chromeRatio(844)).toBeCloseTo(0.1848, 3);
    expect(chromeRatio(844)).toBeLessThanOrEqual(CHROME_MAX_RATIO);
    expect(withinBudget(844, { pill: true })).toBe(true);
    expect(withinBudget(844, { pill: false })).toBe(true);
  });
  it('the 168.8 px limit leaves 12.8 px for the home indicator inset with the pill showing', () => {
    expect(844 * CHROME_MAX_RATIO).toBeCloseTo(168.8, 1);
    expect(withinBudget(844, { pill: true, safeBottom: 12 })).toBe(true);
    expect(withinBudget(844, { pill: true, safeBottom: 34 })).toBe(false);
    expect(withinBudget(844, { pill: false, safeBottom: 34 })).toBe(true);
  });
  it('a 0 height never divides by zero', () => {
    expect(withinBudget(0)).toBe(false);
  });
});

describe('pull to refresh', () => {
  it('starts only at the top with one finger', () => {
    expect(canStartPull(0, 1)).toBe(true);
    expect(canStartPull(1, 1)).toBe(false);
    expect(canStartPull(0, 2)).toBe(false);
  });
  it('phases follow finger travel; release past the threshold refreshes', () => {
    expect(phaseFor(0)).toBe('idle');
    expect(phaseFor(-10)).toBe('idle');
    expect(phaseFor(PULL_THRESHOLD - 1)).toBe('pulling');
    expect(phaseFor(PULL_THRESHOLD)).toBe('ready');
    expect(shouldRefresh(PULL_THRESHOLD - 1)).toBe(false);
    expect(shouldRefresh(PULL_THRESHOLD)).toBe(true);
  });
  it('the indicator is damped and capped', () => {
    expect(pullOffset(-5)).toBe(0);
    expect(pullOffset(40)).toBe(20);
    expect(pullOffset(10_000)).toBe(PULL_MAX);
  });
});

describe('tabs and the More sheet', () => {
  it('five tabs at most: Home, Tasks, Log, Plan, More', () => {
    expect(TABS.map((t) => t.id)).toEqual(['home', 'tasks', 'log', 'plan', 'more']);
    expect(TABS.length).toBeLessThanOrEqual(5);
  });
  it('More lists the rest of the rail: Board, Cache, Settings', () => {
    expect(MORE_ITEMS.map((i) => i.id)).toEqual(['board', 'cache', 'settings']);
    const rail = readFileSync('src/renderer/components/Rail.tsx', 'utf8');
    const ids = [...new Set([...rail.matchAll(/\{ id: '(\w+)', label/g)].map((m) => m[1]))];
    const phone = [...TABS.map((t) => t.id).filter((x) => x !== 'more'), ...MORE_ITEMS.map((i) => i.id)];
    expect(phone.sort()).toEqual([...ids, 'plan'].sort());
  });
  it('every screen lights one tab; Focus belongs to Home', () => {
    expect(activeTab('focus')).toBe('home');
    expect(activeTab('plan')).toBe('plan');
    expect(activeTab('board')).toBe('more');
    expect(activeTab('cache')).toBe('more');
    expect(activeTab('settings')).toBe('more');
  });
  it('titles', () => {
    expect(screenTitle('tasks')).toBe('Tasks');
  });
});
