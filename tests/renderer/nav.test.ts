// Navigation closes layers (Phase 3.5 §2.2): Schedule then Board/Log/Home each renders.
import { describe, expect, it } from 'vitest';
import { closeLayer, escape, navigate, openLayer, toggle, toggleLayer, type NavState } from '../../src/renderer/home/nav';

const home: NavState = { screen: 'home', layer: null };

describe('navigate()', () => {
  it('Schedule open, then Board, Log, Home: each screen is shown with no layer on top', () => {
    let s = openLayer(home, 'schedule');
    for (const to of ['board', 'log', 'home'] as const) {
      s = navigate(s, to);
      expect(s).toEqual({ screen: to, layer: null });
      s = openLayer(s, 'schedule');
    }
  });
  it('the palette closes on navigation (Settings no longer sits under it)', () => {
    expect(navigate(openLayer(home, 'palette'), 'settings')).toEqual({ screen: 'settings', layer: null });
  });
  it('only one layer is open at a time', () => {
    const s = openLayer(openLayer(openLayer(home, 'drawer'), 'schedule'), 'palette');
    expect(s.layer).toBe('palette');
    expect(toggleLayer(s, 'palette').layer).toBeNull();
    expect(closeLayer(s, 'drawer')).toBe(s);
  });
  it('Esc closes the layer, then leaves the screen, then hides', () => {
    const s = openLayer({ screen: 'board', layer: null }, 'editor');
    const a = escape(s) as NavState;
    expect(a).toEqual({ screen: 'board', layer: null });
    expect(escape(a)).toEqual(home);
    expect(escape(home)).toBe('hide');
  });
  it('P/F toggle back to Home and close layers', () => {
    expect(toggle(openLayer(home, 'drawer'), 'plan')).toEqual({ screen: 'plan', layer: null });
    expect(toggle({ screen: 'plan', layer: null }, 'plan').screen).toBe('home');
  });
});
