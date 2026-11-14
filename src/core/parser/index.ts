// Public API of the Chronos quick-add parser. Pure TypeScript: no Electron, Node or DOM imports.
import { parse } from './parse';
import type { ParseContext, ParseResult } from './types';

export { parse } from './parse';
export { applyCorrection, emptyLearnState, LEARN_AFTER } from './learn';
export type { CorrectionValue, LearnState } from './learn';
export { builtinPack, builtinRules, exportPack, importPack, mergePacks, migratePack, validatePack, PACK_SCHEMA, PACK_VERSION } from './packs';
export type { ImportResult } from './packs';
export type * from './types';

export interface NotepadLine { line: number; offset: number; text: string; result: ParseResult }

/** Notepad close: each non-empty line through the parser; a line without a prefix stays a note. */
export function parseNotepad(body: string, ctx: ParseContext): NotepadLine[] {
  const out: NotepadLine[] = [];
  let offset = 0;
  String(body ?? '').split('\n').forEach((raw, line) => {
    const text = raw.replace(/\r$/, '');
    if (text.trim()) out.push({ line, offset, text, result: parse(text, { ...ctx, mode: 'notepad', literalRanges: undefined }) });
    offset += raw.length + 1;
  });
  return out;
}
