// Quick dates for the date sheet (pure, tested).
import { addDays, mondayOf } from '../../core/time/zone';

/** The quick choices, as dates (pure, tested). `today` is the user's today (YYYY-MM-DD). */
export function quickDates(today: string): { label: string; date: string | null }[] {
  const nextMon = addDays(mondayOf(today), 7);
  return [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'Next week', date: nextMon },
    { label: 'No date', date: null },
  ];
}
