import { validateTheme, type ValidateOptions } from './validate';
import type { ChronosTheme, ThemeCheck } from './types';

const MAX_BYTES = 200_000;

export function exportTheme(theme: ChronosTheme): string {
  return JSON.stringify(theme, null, 2) + '\n';
}

/** Parse + validate a theme file's text. Never throws. */
export function importTheme(text: string, opts?: ValidateOptions): ThemeCheck {
  if (text.length > MAX_BYTES) return { ok: false, errors: ['file is too large to be a theme'], warnings: [] };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`not valid JSON: ${(e as Error).message}`], warnings: [] };
  }
  return validateTheme(json, opts);
}
