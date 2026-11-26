// What the phone tab bar and the More sheet list. Pure, so it can be tested.
import type { Screen } from '../components/Rail';
import type { IconName } from '../components/Icon';

export type TabId = 'home' | 'tasks' | 'log' | 'plan' | 'more';
export interface TabItem { id: TabId; label: string; icon: IconName }
export interface MoreItem { id: 'board' | 'cache' | 'settings'; label: string; icon: IconName; hint: string }

/** At most five. */
export const TABS: readonly TabItem[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks' },
  { id: 'log', label: 'Log', icon: 'log' },
  { id: 'plan', label: 'Plan', icon: 'calendar' },
  { id: 'more', label: 'More', icon: 'layers' },
];

/** Everything else the rail has lives here (rail order). */
export const MORE_ITEMS: readonly MoreItem[] = [
  { id: 'board', label: 'Board', icon: 'board', hint: 'Projects and their tasks' },
  { id: 'cache', label: 'Cache', icon: 'cache', hint: 'Drafts and loose notes' },
  { id: 'settings', label: 'Settings', icon: 'gear', hint: 'Themes, schedule and sync' },
];

/** Which tab is lit for a screen. Focus belongs to Home (the pill opens it). */
export function activeTab(screen: Screen): TabId {
  if (screen === 'home' || screen === 'focus') return 'home';
  if (screen === 'tasks' || screen === 'log' || screen === 'plan') return screen;
  return 'more';
}

const TITLES: Record<Screen, string> = { home: 'Home', plan: 'Plan', focus: 'Focus', tasks: 'Tasks', board: 'Board', log: 'Log', cache: 'Cache', settings: 'Settings' };
export const screenTitle = (screen: Screen): string => TITLES[screen];
