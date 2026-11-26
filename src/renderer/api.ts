// The platform bridge, typed. The renderer talks to the platform only through this
// (Electron preload or the web bridge, src/platform). Never touch window.chronos here.
import { getBridge, type ChronosBridge } from '../platform';

export const api: ChronosBridge = getBridge();
