// The platform bridge, typed. The renderer talks to the platform only through this
// (Electron preload or the web bridge, src/platform). Never reach for the preload global here.
import { getBridge, type ChronosBridge } from '../platform';

export const api: ChronosBridge = getBridge();
