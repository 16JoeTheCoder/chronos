// The preload bridge, typed. The renderer talks to main only through this.
import type { ChronosApi } from '../preload/api';

declare global {
  interface Window {
    chronos: ChronosApi;
  }
}

export const api: ChronosApi = window.chronos;
