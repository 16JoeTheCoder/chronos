// Seed for the School timetable (copied from tests/parser/fixture.json; the app never imports from tests/).
// Offered once, on the first visit to an empty timetable, and only after asking.
import type { Bell, TimetableEntry } from '../../core/parser/types';

export const SEED_BELLS: Bell[] = [
  { id: 'P1', start: '07:45', end: '08:25' },
  { id: 'P2', start: '08:25', end: '09:05' },
  { id: 'P3', start: '09:05', end: '09:45' },
  { id: 'P4', start: '10:00', end: '10:40' },
  { id: 'P5', start: '10:40', end: '11:20' },
  { id: 'P6', start: '11:20', end: '12:00' },
  { id: 'P7', start: '12:00', end: '12:40' },
  { id: 'P8', start: '13:10', end: '13:50' },
  { id: 'P9', start: '13:50', end: '14:30' },
];

export const SEED_TIMETABLE: TimetableEntry[] = [
  { day: 1, start: '07:45', end: '09:05', title: "Math" },
  { day: 1, start: '09:05', end: '09:45', title: "Well-being" },
  { day: 1, start: '10:00', end: '11:20', title: "Biology" },
  { day: 1, start: '11:20', end: '12:40', title: "Computer Science make-up" },
  { day: 1, start: '13:10', end: '13:50', title: "HST" },
  { day: 1, start: '13:50', end: '14:30', title: "LT" },
  { day: 2, start: '07:45', end: '09:05', title: "Math" },
  { day: 2, start: '09:05', end: '10:40', title: "HPE" },
  { day: 2, start: '10:40', end: '11:20', title: "Bahasa Indonesia" },
  { day: 2, start: '11:20', end: '12:40', title: "PP" },
  { day: 2, start: '13:10', end: '14:30', title: "IELTS" },
  { day: 2, start: '15:00', end: '17:00', title: "Football" },
  { day: 3, start: '07:45', end: '09:05', title: "Computer Science" },
  { day: 3, start: '09:05', end: '09:45', title: "Computer Science make-up" },
  { day: 3, start: '10:00', end: '11:20', title: "Bahasa Indonesia" },
  { day: 3, start: '11:20', end: '12:40', title: "Math" },
  { day: 3, start: '13:10', end: '14:30', title: "Performing Arts" },
  { day: 3, start: '14:45', end: '16:30', title: "Greenmech" },
  { day: 4, start: '07:45', end: '09:45', title: "Biology" },
  { day: 4, start: '10:00', end: '11:20', title: "Physics" },
  { day: 4, start: '11:20', end: '12:40', title: "CBR" },
  { day: 4, start: '13:10', end: '14:30', title: "Mandarin" },
  { day: 5, start: '07:45', end: '09:05', title: "White Period" },
  { day: 5, start: '09:05', end: '10:40', title: "Math" },
  { day: 5, start: '10:40', end: '12:40', title: "Physics" },
  { day: 5, start: '13:10', end: '13:50', title: "STEAM" },
  { day: 5, start: '15:30', end: '17:30', title: "Football" },
];
