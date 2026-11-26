// Electron adapter: the preload's window.chronos plus capability flags. Behaviour unchanged.

import type { ChronosApi } from '../preload/api';
import type { ChronosBridge } from './types';

export const DESKTOP_RELEASE_URL = 'https://github.com/16JoeTheCoder/chronos/releases/latest';

declare global {
  interface Window {
    chronos?: ChronosApi;
  }
}

export function electronBridge(): ChronosBridge {
  const api = window.chronos;
  if (!api) throw new Error('Chronos preload is missing (window.chronos).');
  return {
    ...api,
    platform: 'electron',
    can: { overlay: true, notepadHotkey: true, globalShortcuts: true, desktopLayer: true, localMcp: true, askClaude: true, fileShelf: true, zoom: true, windowControls: true, localFiles: true, windowsSettings: true, cloudFiles: true },
    web: null,
    links: { desktopRelease: DESKTOP_RELEASE_URL },
    // Main opens external links from window.open via setWindowOpenHandler.
    openLink: (url) => void window.open(url, '_blank', 'noopener'),
  };
}
