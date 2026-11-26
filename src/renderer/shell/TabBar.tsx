// The phone navigation: five tabs (Home, Tasks, Log, Plan, More) and the More sheet that
// holds everything else the rail has. Every tap goes through Home's go() (nav.ts navigate()).
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import type { Screen } from '../components/Rail';
import { MORE_ITEMS, TABS, activeTab, type TabId } from './items';

export function TabBar({ screen, onGo }: { screen: Screen; onGo: (s: Screen) => void }) {
  const [more, setMore] = useState(false);
  const lit = activeTab(screen);
  const pick = (id: TabId) => {
    if (id === 'more') {
      setMore((o) => !o);
      return;
    }
    setMore(false);
    onGo(id);
  };
  // Navigating by any other route (palette, keys) closes the sheet.
  useEffect(() => setMore(false), [screen]);
  return (
    <>
      <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab${lit === t.id ? ' on' : ''}`}
            aria-current={lit === t.id ? 'page' : undefined}
            aria-haspopup={t.id === 'more' ? 'dialog' : undefined}
            aria-expanded={t.id === 'more' ? more : undefined}
            onClick={() => pick(t.id)}
          >
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      {more && <MoreSheet screen={screen} onGo={(s) => { setMore(false); onGo(s); }} onClose={() => setMore(false)} />}
    </>
  );
}

function MoreSheet({ screen, onGo, onClose }: { screen: Screen; onGo: (s: Screen) => void; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); // Home's Esc handler skips a handled key
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="More" onClick={(e) => e.stopPropagation()}>
        
        <ul className="sheet-list">
          {MORE_ITEMS.map((i, n) => (
            <li key={i.id}>
              <button ref={n === 0 ? first : undefined} type="button" className={`sheet-item${screen === i.id ? ' on' : ''}`} aria-current={screen === i.id ? 'page' : undefined} onClick={() => onGo(i.id)}>
                <Icon name={i.icon} size={22} />
                <span className="sheet-text">
                  <span className="sheet-label">{i.label}</span>
                  <span className="sheet-hint">{i.hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
