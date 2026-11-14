// Focus screen keys, with no DOM: what a key event means. The Focus screen listens on the
// window (not on a focused button), so Space and hold-Enter work the moment the screen is
// up, without clicking first. Text inputs, open dialogs and other focused controls keep
// their own keys.

export type Target = 'body' | 'hold' | 'text' | 'control';
export type KeyAction = 'toggle' | 'press' | 'release' | 'swallow' | null;

export interface KeyInput {
  type: 'down' | 'up';
  key: string;
  repeat: boolean;
  modifier: boolean;
  target: Target;
  dialogOpen: boolean;
}

/**
 * Space = start or pause (never finishes). Enter held = the finish hold. Everything else is
 * not ours. `swallow` means: prevent the browser default (a Space scroll, an Enter click) and do nothing.
 */
export function keyAction(k: KeyInput): KeyAction {
  if (k.modifier || k.dialogOpen || k.target === 'text' || k.target === 'control') return null;
  if (k.key === ' ') return k.type === 'down' ? (k.repeat ? 'swallow' : 'toggle') : 'swallow';
  if (k.key === 'Enter') return k.type === 'down' ? 'press' : 'release';
  return null;
}

/** Classify the element that has focus. */
export function targetOf(el: Element | null): Target {
  if (!el || el === document.body || el === document.documentElement) return 'body';
  if (el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return 'text';
  if (el.closest('[data-hold], .focus-title')) return 'hold';
  if (el.closest('button, a[href], summary, [role="button"], [role="radio"], [role="switch"], [role="menuitem"]')) return 'control';
  return 'body';
}
