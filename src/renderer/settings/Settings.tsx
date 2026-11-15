// Settings: six sections and Experimental at the bottom. Layout follows
// docs/design/StarkSettings.dc.html (nav on the left, one column of grouped rows on the right).
// Synced settings go through settings.update; per-PC ones through device.update.

import { useState, type ReactNode } from 'react';
import type { Snapshot } from '../../core/model/types';
import { TimetableSection } from '../schedule/Timetable';
import { AccountSection } from './AccountSection';
import { DaySection } from './DaySection';
import { ExperimentalSection } from './ExperimentalSection';
import { FocusSection } from './FocusSection';
import { LookSection } from './LookSection';
import { ParserSection } from './ParserSection';
import './settings.css';

export const SETTINGS_SECTIONS = [
  { id: 'look', label: 'Look and widgets' },
  { id: 'day', label: 'Day and planning' },
  { id: 'focus', label: 'Focus' },
  { id: 'parser', label: 'Parser rules' },
  { id: 'timetable', label: 'School timetable' },
  { id: 'account', label: 'Account and sync' },
] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'] | 'experimental';

export interface SettingsProps {
  snap: Snapshot;
  /** Open the week editor (schedule/ScheduleEditor). The School timetable section links to it when given. */
  onSchedule?: () => void;
  onClose?: () => void;
  /** Section to open first. */
  section?: SettingsSectionId;
}

export function Settings({ snap, onSchedule, onClose, section = 'look' }: SettingsProps) {
  const [sec, setSec] = useState<SettingsSectionId>(section);
  const all = [...SETTINGS_SECTIONS, { id: 'experimental' as const, label: 'Experimental' }];
  const title = all.find((x) => x.id === sec)?.label ?? '';
  let body: ReactNode;
  switch (sec) {
    case 'look': body = <LookSection snap={snap} />; break;
    case 'day': body = <DaySection snap={snap} />; break;
    case 'focus': body = <FocusSection snap={snap} />; break;
    case 'parser': body = <ParserSection snap={snap} />; break;
    case 'timetable': body = <TimetableSection snap={snap} onOpenWeek={onSchedule} />; break;
    case 'account': body = <AccountSection snap={snap} />; break;
    case 'experimental': body = <ExperimentalSection snap={snap} />; break;
  }
  return (
    <div className="st-shell">
      <nav className="st-nav" aria-label="Settings sections">
        <h1>Settings</h1>
        {SETTINGS_SECTIONS.map((x) => (
          <button key={x.id} type="button" className="st-nav-item" aria-current={sec === x.id ? 'page' : undefined} onClick={() => setSec(x.id)}>
            {x.label}
          </button>
        ))}
        <span className="st-nav-gap" />
        <button type="button" className="st-nav-item st-nav-quiet" aria-current={sec === 'experimental' ? 'page' : undefined} onClick={() => setSec('experimental')}>
          Experimental
        </button>
        {onClose && (
          <button type="button" className="st-nav-item st-nav-close" onClick={onClose}>
            Close settings
          </button>
        )}
      </nav>
      <main className="st-body" aria-label={title}>
        <div className="st-body-inner">
          <h2 className="st-title" style={{ fontFamily: 'var(--font-display)' }}>{title}</h2>
          {body}
        </div>
      </main>
    </div>
  );
}

export default Settings;
