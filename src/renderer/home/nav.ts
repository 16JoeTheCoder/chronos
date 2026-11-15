// Navigation state for Home (Phase 3.5 §2.2). One screen plus at most one layer on top.
// Rules: any navigation closes the open layer first, then changes screen; opening a layer
// replaces any other layer; Esc closes the layer, then leaves a non-Home screen, then hides.
// Pure so it can be unit-tested; Home.tsx routes every rail, top-bar, key and command nav through it.
import type { Screen } from '../components/Rail';

export type Layer = 'drawer' | 'shelf' | 'trash' | 'schedule' | 'editor' | 'palette';
export interface NavState { screen: Screen; layer: Layer | null }

export const navigate = (_s: NavState, to: Screen): NavState => ({ screen: to, layer: null });
/** P / F toggle: pressing the key of the current screen goes back Home. */
export const toggle = (s: NavState, to: Screen): NavState => navigate(s, s.screen === to ? 'home' : to);
export const openLayer = (s: NavState, l: Layer): NavState => ({ ...s, layer: l });
/** Close `l` (or whatever is open when omitted). Closing a layer that is not open changes nothing. */
export const closeLayer = (s: NavState, l?: Layer): NavState => (l && s.layer !== l ? s : s.layer === null ? s : { ...s, layer: null });
export const toggleLayer = (s: NavState, l: Layer): NavState => (s.layer === l ? closeLayer(s) : openLayer(s, l));
/** Esc: the new state, or 'hide' when Home itself should hide. */
export const escape = (s: NavState): NavState | 'hide' => (s.layer ? closeLayer(s) : s.screen !== 'home' ? navigate(s, 'home') : 'hide');
