// The chrome budget (Josef: "don't clutter the top menu till it covers 40% of the screen").
// Phone chrome = top bar + running pill + tab bar must stay within 20 % of the viewport height.
// These constants are the heights in responsive.css (the --sh-* custom properties there).
export const TOP_BAR_H = 52;
export const RUNNING_PILL_H = 48;
export const TAB_BAR_H = 56;
export const CHROME_MAX_RATIO = 0.2;

export interface ChromeOpts { pill: boolean; safeBottom?: number }
const WORST: ChromeOpts = { pill: true };

/** Pixels of chrome on screen. The pill only counts while a task is active; the home-indicator inset is the device's. */
export const chromePx = (o: ChromeOpts = WORST): number => TOP_BAR_H + (o.pill ? RUNNING_PILL_H : 0) + TAB_BAR_H + (o.safeBottom ?? 0);

export const chromeRatio = (viewportH: number, o: ChromeOpts = WORST): number => (viewportH > 0 ? chromePx(o) / viewportH : 1);

export const withinBudget = (viewportH: number, o: ChromeOpts = WORST): boolean => chromeRatio(viewportH, o) <= CHROME_MAX_RATIO;
