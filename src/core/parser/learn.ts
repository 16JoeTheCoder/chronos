// Learning: the same correction twice becomes a learned rule. Pure: state in, state out.
import type { ParseKind, ParseResult, ParserRule } from './types';

/** What the user changed. `match` names the word when there is no chip for it (spanIndex -1). */
export interface CorrectionValue { kind?: ParseKind; projectId?: string | null; tagId?: string | null; match?: string }

/** `rules` = the user and learned rules (what settings.parserRules stores); `pending` = corrections seen once. */
export interface LearnState { rules: ParserRule[]; pending: Record<string, number> }

export const emptyLearnState = (): LearnState => ({ rules: [], pending: {} });
export const LEARN_AFTER = 2;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function field(v: CorrectionValue): { name: 'kind' | 'projectId' | 'tagId'; value: string | null } | null {
  if (v.kind) return { name: 'kind', value: v.kind };
  if (v.projectId !== undefined) return { name: 'projectId', value: v.projectId };
  if (v.tagId !== undefined) return { name: 'tagId', value: v.tagId };
  return null;
}

/**
 * Records one correction of chip `spanIndex` in `result`. Returns the new state and the learned rule if
 * this correction made the second identical one. User rules always win and are never touched; a learned
 * rule that the user later corrects to something else is removed.
 */
export function applyCorrection(result: ParseResult, spanIndex: number, newValue: CorrectionValue, state: LearnState = emptyLearnState()): { state: LearnState; rule: ParserRule | null } {
  const span = result.spans[spanIndex];
  const match = (span && span.inTitle !== false ? span.text : newValue.match ?? span?.text ?? '').trim().toLowerCase();
  const f = field(newValue);
  if (!match || !f) return { state, rule: null };
  const existing = state.rules.find((r) => r.match.toLowerCase() === match);
  if (existing?.source === 'user') return { state, rule: null };
  const key = `${f.name}|${match}|${f.value}`;
  if (existing && (existing[f.name] ?? null) === f.value) return { state, rule: null };
  if (existing) {
    // The user disagrees with a learned rule: drop it, and start counting the new correction.
    return { state: { rules: state.rules.filter((r) => r !== existing), pending: { ...dropMatch(state.pending, match), [key]: 1 } }, rule: null };
  }
  const count = (state.pending[key] ?? 0) + 1;
  if (count < LEARN_AFTER) return { state: { rules: state.rules, pending: { ...state.pending, [key]: count } }, rule: null };
  const rule: ParserRule = { id: `l-${slug(match)}-${f.name}`, match, source: 'learned', [f.name]: f.value ?? undefined };
  if (f.value === null) delete rule[f.name];
  return { state: { rules: [...state.rules, rule], pending: dropMatch(state.pending, match) }, rule };
}

function dropMatch(pending: Record<string, number>, match: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(pending)) if (k.split('|')[1] !== match) out[k] = v;
  return out;
}
