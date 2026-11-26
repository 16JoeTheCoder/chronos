// Which Settings sections exist on this platform (pure, unit-tested). Desktop keeps all of them;
// the web drops what a browser cannot do.
import type { Capabilities } from '../../platform';

export type SectionId = 'look' | 'day' | 'focus' | 'tasks' | 'parser' | 'timetable' | 'account' | 'experimental';

const ALL: { id: SectionId; label: string }[] = [
  { id: 'look', label: 'Look and widgets' },
  { id: 'day', label: 'Day and planning' },
  { id: 'focus', label: 'Focus' },
  { id: 'tasks', label: 'Tasks and notepad' },
  { id: 'parser', label: 'Parser rules' },
  { id: 'timetable', label: 'School timetable' },
  { id: 'account', label: 'Account and sync' },
  { id: 'experimental', label: 'Experimental' },
];

/** The sections shown, in order. Experimental is last (and rendered quiet). */
export function settingsSections(can: Capabilities): { id: SectionId; label: string }[] {
  // Tasks keeps the done-retention row on every platform; only its name changes without the notepad.
  return ALL.map((s) => (s.id === 'tasks' && !can.notepadHotkey ? { ...s, label: 'Tasks' } : s));
}
