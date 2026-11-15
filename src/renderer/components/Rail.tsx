// The app rail: Home, Board, Log, Settings. Real buttons with names and aria-current.
import { Icon, type IconName } from './Icon';

export type Screen = 'home' | 'plan' | 'focus' | 'board' | 'log' | 'settings';

const ITEMS: { id: 'home' | 'board' | 'log' | 'settings'; label: string; icon: IconName; key?: string }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'board', label: 'Board', icon: 'board' },
  { id: 'log', label: 'Log', icon: 'log', key: 'Control+L' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
];

export function Rail({ screen, onGo }: { screen: Screen; onGo: (s: Screen) => void }) {
  const here = (id: string) => (id === 'home' ? screen === 'home' || screen === 'plan' || screen === 'focus' : screen === id);
  return (
    <nav className="rail-nav" aria-label="Main">
      <span className="rail-mark" aria-hidden="true" />
      {ITEMS.map((i) => (
        <button key={i.id} className={`rail-btn${here(i.id) ? ' on' : ''}${i.id === 'settings' ? ' rail-end' : ''}`} aria-current={here(i.id) ? 'page' : undefined} aria-label={i.label} title={i.label} aria-keyshortcuts={i.key} onClick={() => onGo(i.id)}>
          <Icon name={i.icon} size={22} />
          <span>{i.label}</span>
        </button>
      ))}
    </nav>
  );
}
