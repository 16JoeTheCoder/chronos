// The launch screen (§8.3) is static HTML + launch.css in index.html, painted
// before React loads. This fills its stat slots once data arrives, then plays
// the reveal on Enter/Space (Esc hides Home for later).

import { formatHuman, greeting } from '../../core/format';
import type { Snapshot } from '../../core/model/types';
import { settingsOf } from '../../core/repo/repo';
import { activeTask, deriveQueue } from '../../core/tasks/tasks';
import { upcoming } from '../../core/time/schedule';
import { localParts, dateOf } from '../../core/time/zone';
import { clockOf } from '../../core/format';
import { api } from '../api';
import { dayModel } from '../runway/model';

const $ = (sel: string) => document.querySelector<HTMLElement>(sel);

export function fillLaunch(snap: Snapshot): void {
  const d = snap.data;
  const s = settingsOf(d);
  const now = Date.now();
  const m = dayModel(d, now, 'full');
  const next = upcoming(d, now, dateOf(now, s.timezone), 24)[0];
  const head = activeTask(d);
  const set = (key: string, text: string) => {
    const el = $(`[data-stat="${key}"]`);
    if (el) {
      el.textContent = text;
      el.classList.remove('sk');
    }
  };
  const greet = $('#launch-greet');
  if (greet) greet.textContent = greeting(localParts(now, s.timezone).minutes, s.displayName);
  set('left', formatHuman(m.tl.workableMs));
  set('next', next ? `${next.event.title} ${clockOf(next.start, next.event.tz)}` : head ? head.title : 'Open day');
  set('queued', String(deriveQueue(d, now).length));
}

/** Wait for Enter/Space, then fade the launch screen and call reveal. Skipped when the user turned it off. */
export function awaitLaunch(skip: boolean, reveal: () => void): void {
  const el = $('#launch');
  if (!el || skip) {
    el?.remove();
    reveal();
    return;
  }
  el.querySelector<HTMLElement>('.launch-body')?.focus();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      window.removeEventListener('keydown', onKey, true);
      el.classList.add('out');
      reveal();
      setTimeout(() => el.remove(), 240);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      api.win.hide();
    }
  };
  window.addEventListener('keydown', onKey, true);
  el.addEventListener('click', () => onKey(new KeyboardEvent('keydown', { key: 'Enter' })), { once: true });
}
