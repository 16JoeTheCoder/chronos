// The platform bridge, typed. The renderer talks to the platform only through this
// (Electron preload or the web bridge, src/platform). The preload global is read only in src/platform/electron.ts.
import { getBridge, type ChronosBridge } from '../platform';

export const api: ChronosBridge = getBridge();
