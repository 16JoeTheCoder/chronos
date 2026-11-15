// The palette in its own window (global shortcut). Main hides the window on blur or Esc.
import { Palette } from './Palette';
import { api } from '../api';

export function PaletteWindow() {
  return <Palette open standalone onClose={() => api.win.closePalette()} />;
}
