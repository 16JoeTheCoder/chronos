// Screens that load on demand, so the web build's first paint stays small (initial JS <= 250 kB gzip).
// Home.tsx (Mobile-Layout) should import these instead of Settings / Runway / ScheduleEditor / the Planning
// cards, and wrap each in <Suspense fallback={null}>. Board, Log, Cache and Palette are already lazy there.
import { lazy } from 'react';

export const LazySettings = lazy(() => import('./settings/Settings').then((m) => ({ default: m.Settings })));
export const LazyRunway = lazy(() => import('./runway/Runway').then((m) => ({ default: m.Runway })));
export const LazyScheduleEditor = lazy(() => import('./schedule/ScheduleEditor').then((m) => ({ default: m.ScheduleEditor })));
export const LazyReviewHost = lazy(() => import('./planning/Planning').then((m) => ({ default: m.ReviewHost })));
export const LazyMorningStart = lazy(() => import('./planning/Planning').then((m) => ({ default: m.MorningStart })));
export const LazyBreakCard = lazy(() => import('./planning/Planning').then((m) => ({ default: m.BreakCard })));
