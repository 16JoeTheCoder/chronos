// Hand-written inline icons (2px stroke, Lucide-like). Decorative unless labelled.
import type { ReactElement } from 'react';

const P: Record<string, ReactElement> = {
  play: <path d="M7 4l13 8-13 8z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  skip: <path d="M5 5l10 7-10 7zM19 5v14" />,
  check: <path d="M4 12l5 5L20 6" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  folder: <path d="M3 6h6l2 2h10v11H3z" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1" />,
  chevronUp: <path d="M6 15l6-6 6 6" />,
  undo: <path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  idea: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5V16h8v-2.5A6 6 0 0 0 12 3z" />,
  restore: <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M4 16V4h12" /></>,
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      {P[name]}
    </svg>
  );
}
