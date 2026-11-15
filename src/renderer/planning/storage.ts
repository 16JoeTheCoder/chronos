// Device-local "already shown" memory for the planning prompts. localStorage can be missing or throw
// (private window, cleared site data), so every access is guarded and the UI works without it.

const get = (k: string): string | null => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k: string, v: string): void => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* a convenience only */
  }
};

export const morningDone = (date: string): boolean => get('chronos.morning') === date;
export const markMorning = (date: string): void => set('chronos.morning', date);

export function shownBreaks(): Set<string> {
  try {
    return new Set(JSON.parse(get('chronos.breakShown') ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
export function markBreak(blockId: string): void {
  set('chronos.breakShown', JSON.stringify([...shownBreaks(), blockId].slice(-30)));
}

/** The review the user closed with Esc this session ("later"). */
let reviewLater: string | null = null;
export const reviewDeferred = (date: string): boolean => reviewLater === date;
export const deferReview = (date: string): void => {
  reviewLater = date;
};
