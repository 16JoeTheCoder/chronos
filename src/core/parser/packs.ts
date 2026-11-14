// Rule packs: the built-in pack, validation, merge, import/export and version migration.
import builtinJson from './builtin.chronos-parser.json';
import type { ParseKind, ParserPack, ParserRule, RuleSource } from './types';

export const PACK_SCHEMA = 'chronos-parser-pack/1';
/** Bump when the pack format changes, and add a step to `migratePack`. */
export const PACK_VERSION = 1;

const KINDS: ParseKind[] = ['fixed', 'task', 'note'];
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Brings an older pack up to PACK_VERSION. Version 0 = a pack with no `version` (the original spec format:
 * rules without `source`, durations named `defaultDuration`). Returns null when the input is not a pack
 * or comes from a newer Chronos.
 */
export function migratePack(input: unknown): ParserPack | null {
  if (!isObj(input) || !Array.isArray(input.rules)) return null;
  const version = typeof input.version === 'number' ? input.version : 0;
  if (version > PACK_VERSION) return null;
  let rules = input.rules.filter(isObj).map((r) => ({ ...r })) as Record<string, unknown>[];
  if (version < 1) {
    rules = rules.map((r) => {
      if (r.defaultDuration !== undefined && r.defaultDurationMin === undefined) r.defaultDurationMin = r.defaultDuration;
      delete r.defaultDuration;
      return r;
    });
  }
  const out: ParserPack = {
    $schema: PACK_SCHEMA,
    name: typeof input.name === 'string' && input.name.trim() ? input.name : 'Imported pack',
    version: PACK_VERSION,
    rules: rules as unknown as ParserRule[],
  };
  if (typeof input.defaultFixedDurationMin === 'number') out.defaultFixedDurationMin = input.defaultFixedDurationMin;
  return out;
}

/** Errors for a pack that cannot be used: ids unique, kinds valid, no empty matches. */
export function validatePack(pack: ParserPack): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  pack.rules.forEach((r, i) => {
    const at = `rule ${i + 1}`;
    if (!isObj(r)) { errors.push(`${at}: not an object`); return; }
    if (typeof r.id !== 'string' || !r.id.trim()) errors.push(`${at}: missing id`);
    else if (ids.has(r.id)) errors.push(`${at}: duplicate id "${r.id}"`);
    else ids.add(r.id);
    if (typeof r.match !== 'string' || !r.match.trim()) errors.push(`${at}: empty match`);
    if (r.aliases !== undefined && (!Array.isArray(r.aliases) || r.aliases.some((a) => typeof a !== 'string' || !a.trim()))) errors.push(`${at}: aliases must be non-empty strings`);
    if (r.kind !== undefined && !KINDS.includes(r.kind)) errors.push(`${at}: kind must be fixed, task or note`);
    if (r.defaultDurationMin !== undefined && !(typeof r.defaultDurationMin === 'number' && r.defaultDurationMin > 0 && r.defaultDurationMin <= 1440)) errors.push(`${at}: defaultDurationMin must be 1-1440`);
  });
  return errors;
}

export type ImportResult = { ok: true; pack: ParserPack } | { ok: false; errors: string[] };

/** Reads the text of a *.chronos-parser.json file. Rules get `source` (default 'user'). */
export function importPack(text: string, source: RuleSource = 'user'): ImportResult {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, errors: ['not valid JSON'] }; }
  const pack = migratePack(raw);
  if (!pack) {
    const newer = isObj(raw) && typeof raw.version === 'number' && raw.version > PACK_VERSION;
    return { ok: false, errors: [newer ? 'this pack was made by a newer Chronos' : 'not a Chronos parser pack (needs a "rules" list)'] };
  }
  pack.rules = pack.rules.map((r) => ({ ...r, source }));
  const errors = validatePack(pack);
  return errors.length ? { ok: false, errors } : { ok: true, pack };
}

/** The text of a *.chronos-parser.json file. */
export function exportPack(pack: Pick<ParserPack, 'name' | 'rules'> & Partial<ParserPack>): string {
  const out: ParserPack = { $schema: PACK_SCHEMA, name: pack.name, version: PACK_VERSION, rules: pack.rules.map(({ source: _s, ...r }) => ({ ...r, source: 'user' as const })) };
  if (pack.defaultFixedDurationMin !== undefined) out.defaultFixedDurationMin = pack.defaultFixedDurationMin;
  return JSON.stringify(out, null, 2) + '\n';
}

const keyOf = (r: ParserRule) => r.match.trim().toLowerCase();

/**
 * Merges by `match`. A match present on both sides is a conflict: `prefer` picks which one survives
 * (the UI asks once, then calls again). Ids stay unique.
 */
export function mergePacks(existing: ParserRule[], incoming: ParserRule[], prefer: 'existing' | 'incoming' = 'existing'): { rules: ParserRule[]; conflicts: { match: string; existing: ParserRule; incoming: ParserRule }[] } {
  const byKey = new Map(existing.map((r) => [keyOf(r), r]));
  const conflicts: { match: string; existing: ParserRule; incoming: ParserRule }[] = [];
  for (const inc of incoming) {
    const cur = byKey.get(keyOf(inc));
    if (!cur) { byKey.set(keyOf(inc), inc); continue; }
    if (JSON.stringify({ ...cur, id: 0 }) === JSON.stringify({ ...inc, id: 0 })) continue;
    conflicts.push({ match: cur.match, existing: cur, incoming: inc });
    if (prefer === 'incoming') byKey.set(keyOf(inc), inc);
  }
  const seen = new Set<string>();
  const rules = [...byKey.values()].map((r) => {
    let id = r.id;
    for (let n = 2; seen.has(id); n++) id = `${r.id}-${n}`;
    seen.add(id);
    return id === r.id ? r : { ...r, id };
  });
  return { rules, conflicts };
}

export const builtinPack: ParserPack = migratePack(builtinJson) ?? { $schema: PACK_SCHEMA, name: 'builtin', version: PACK_VERSION, rules: [] };
export const builtinRules: ParserRule[] = builtinPack.rules.map((r) => ({ ...r, source: 'builtin' as const }));
