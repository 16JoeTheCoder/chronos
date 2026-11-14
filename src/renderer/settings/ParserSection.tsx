// Parser rules: the learned and user rules the quick-add parser uses, pack import/export
// (*.chronos-parser.json) and the misparse reports.

import { useState } from 'react';
import { builtinRules, exportPack, importPack, mergePacks, type ParserRule } from '../../core/parser';
import type { Snapshot } from '../../core/model/types';
import { live, settingsOf } from '../../core/repo/repo';
import { Icon } from '../components/Icon';
import { toast } from '../store';
import { pickTextFile, saveTextFile } from './files';
import { Btn, Group, saveSettings } from './rows';

/**
 * settings.parserRules is typed as the Phase 1 `{keyword, kind}` list; the parser stores
 * ParserRule objects in it. Read both shapes, write ParserRule (see decision D-14x).
 */
function rulesOf(raw: unknown[]): ParserRule[] {
  const out: ParserRule[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const match = typeof o.match === 'string' ? o.match : typeof o.keyword === 'string' ? o.keyword : '';
    if (!match.trim()) continue;
    out.push({
      ...(o as Partial<ParserRule>),
      id: typeof o.id === 'string' ? o.id : `u-${match.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      match,
      source: o.source === 'learned' ? 'learned' : 'user',
    });
  }
  return out;
}

const saveRules = (rules: ParserRule[]) => saveSettings({ parserRules: rules as unknown as ReturnType<typeof settingsOf>['parserRules'] });

export function ParserSection({ snap }: { snap: Snapshot }) {
  const s = settingsOf(snap.data);
  const rules = rulesOf(s.parserRules as unknown[]);
  const reports = s.parserReports;
  const projects = live(snap.data, 'projects');
  const tags = live(snap.data, 'tags');
  const [msg, setMsg] = useState<{ kind: 'error' | 'ok' | 'warn'; title: string; lines: string[]; pending?: { rules: ParserRule[] } } | null>(null);

  function describe(r: ParserRule): string {
    const bits: string[] = [];
    if (r.kind) bits.push(r.kind === 'fixed' ? 'fixed event' : r.kind);
    if (r.projectId) bits.push(`project ${projects.find((p) => p.id === r.projectId)?.name ?? 'unknown'}`);
    if (r.tagId) bits.push(`tag ${tags.find((t) => t.id === r.tagId)?.name ?? 'unknown'}`);
    if (r.defaultDurationMin) bits.push(`${r.defaultDurationMin} min`);
    if (r.allowDateOnly) bits.push('date only is enough');
    if (r.usesSchedule) bits.push('uses the timetable');
    return bits.join(' · ') || 'no effect';
  }

  async function remove(r: ParserRule) {
    const before = rules;
    const ok = await saveRules(rules.filter((x) => x.id !== r.id));
    if (ok) toast(`Rule "${r.match}" deleted.`, { undo: () => void saveRules(before) });
  }

  async function importFile(): Promise<boolean> {
    const f = await pickTextFile('.json,application/json');
    if (!f) return false;
    const r = importPack(f.text, 'user');
    if (!r.ok) {
      setMsg({ kind: 'error', title: `${f.name} was not imported`, lines: r.errors });
      return false;
    }
    const merged = mergePacks(rules, r.pack.rules, 'existing');
    if (merged.conflicts.length) {
      setMsg({
        kind: 'warn',
        title: `${r.pack.rules.length} rules read, ${merged.conflicts.length} already exist with different settings`,
        lines: merged.conflicts.map((c) => `"${c.match}": yours is ${describe(c.existing)}; the file's is ${describe(c.incoming)}`),
        pending: { rules: r.pack.rules },
      });
      return true;
    }
    return apply(merged.rules, `${r.pack.rules.length} rules from ${r.pack.name || f.name}`);
  }

  async function apply(next: ParserRule[], what: string): Promise<boolean> {
    const before = rules;
    const ok = await saveRules(next);
    if (ok) {
      toast(`Imported ${what}.`, { undo: () => void saveRules(before) });
      setMsg({ kind: 'ok', title: `Imported ${what}`, lines: [] });
    }
    return ok;
  }

  function exportRules(): boolean {
    if (!rules.length) {
      setMsg({ kind: 'warn', title: 'Nothing to export yet', lines: ['Rules appear here after you correct the same chip twice, or import a pack.'] });
      return false;
    }
    saveTextFile('chronos-rules.chronos-parser.json', exportPack({ name: 'My Chronos rules', rules }));
    return true;
  }

  return (
    <>
      <Group title="Your rules" note={`Your rules beat learned rules, and both beat the ${builtinRules.length} built-in ones. A rule is learned after you correct the same chip twice.`}>
        <div className="st-list">
          {rules.length === 0 && <p className="st-empty">No learned or user rules yet. Correct a chip in the quick-add and repeat it once to teach one.</p>}
          {rules.map((r) => (
            <div className="st-item" key={r.id}>
              <div className="st-item-main">
                <span className="st-item-title">{r.match}{r.aliases?.length ? `, ${r.aliases.join(', ')}` : ''}</span>
                <span className="st-item-sub">{describe(r)}</span>
              </div>
              <span className="st-pill" data-on={r.source === 'user'}>{r.source}</span>
              <button type="button" className="st-icon" aria-label={`Delete rule ${r.match}`} onClick={() => void remove(r)}>
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
        </div>
      </Group>

      <Group title="Import and export" note="A rule pack is a *.chronos-parser.json file. Imported rules count as your own.">
        <div className="st-actions">
          <Btn onClick={importFile}>Import rule pack</Btn>
          <Btn onClick={exportRules} done="Exported">Export my rules</Btn>
        </div>
        {msg && (
          <div className="st-msg" data-kind={msg.kind} role={msg.kind === 'error' ? 'alert' : 'status'}>
            <b>{msg.title}</b>
            {msg.lines.length > 0 && <ul>{msg.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
            {msg.pending && (
              <div className="st-actions">
                <Btn variant="solid" onClick={() => { const m = mergePacks(rules, msg.pending!.rules, 'incoming'); return apply(m.rules, 'the pack (file wins)'); }}>Use the file</Btn>
                <Btn onClick={() => { const m = mergePacks(rules, msg.pending!.rules, 'existing'); return apply(m.rules, 'the pack (yours kept)'); }}>Keep mine</Btn>
              </div>
            )}
          </div>
        )}
      </Group>

      <Group title={`Misparse reports (${reports.length})`} note="Added by Report misparse in the palette. Each one becomes a corpus line before it is fixed.">
        <div className="st-list">
          {reports.length === 0 && <p className="st-empty">None. The palette's Report misparse action stores what you typed, what you expected and what the parser did.</p>}
          {[...reports].reverse().slice(0, 50).map((r, i) => (
            <div className="st-item" key={`${r.at}-${i}`}>
              <div className="st-item-main">
                <span className="st-item-title">{r.input}</span>
                <span className="st-item-sub">Expected: {r.expected}</span>
                <span className="st-code">Got: {r.actual}</span>
              </div>
              <span className="st-item-sub">{new Date(r.at).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
        {reports.length > 0 && (
          <div className="st-actions">
            <Btn done="Copied" onClick={() => navigator.clipboard.writeText(JSON.stringify(reports, null, 2)).then(() => true, () => { toast('Could not copy.', { error: true }); return false; })}>
              <Icon name="copy" size={14} /> Copy all
            </Btn>
            <Btn variant="danger" onClick={async () => {
              const before = reports;
              const ok = await saveSettings({ parserReports: [] });
              if (ok) toast('Reports cleared.', { undo: () => void saveSettings({ parserReports: before }) });
              return ok;
            }}>Clear reports</Btn>
          </div>
        )}
      </Group>
    </>
  );
}
