// "Get the desktop app" and "Install as an app": web only. The desktop link shows only on a
// desktop-class viewport (fine pointer, >= 1024 px, not a mobile UA); the PWA row only when the
// browser offered an install prompt.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useViewport } from '../viewport';

export const SMARTSCREEN_NOTE = 'Windows, unsigned: if SmartScreen warns, choose More info → Run anyway.';

/** True when the web build should offer the Windows download. */
export function useDesktopOffer(): boolean {
  const { desktopClass } = useViewport();
  return api.platform === 'web' && desktopClass;
}

/** Re-renders when the browser's install prompt becomes (un)available. */
export function usePwaInstall(): { available: boolean; prompt: () => Promise<boolean> } {
  const w = api.web;
  const [, bump] = useState(0);
  useEffect(() => (w ? w.install.onChange(() => bump((n) => n + 1)) : undefined), [w]);
  return { available: !!w && w.install.available(), prompt: () => (w ? w.install.prompt() : Promise.resolve(false)) };
}

/** Quiet inline link used on the sign-in screen. */
export function DesktopLink({ className = 'si-link' }: { className?: string }) {
  const offer = useDesktopOffer();
  if (!offer) return null;
  return (
    <div className="si-desktop">
      <button type="button" className={className} onClick={() => api.openLink(api.links.desktopRelease)}>Get the desktop app</button>
      <p className="si-fine">{SMARTSCREEN_NOTE}</p>
    </div>
  );
}
