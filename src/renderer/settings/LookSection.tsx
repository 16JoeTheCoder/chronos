// Look and widgets: theme picker, theme schedule, theme import/export, desktop, widgets, energy, sound, motion.

import { useMemo, useState } from 'react';
import { parseHM } from '../../core/format';
import type { Snapshot } from '../../core/model/types';
import { settingsOf } from '../../core/repo/repo';
import { composite, contrast, exportTheme, importTheme, minutesOfDay, parseColor, parseThemeId, resolveActiveTheme, type ChronosTheme, type ThemeCheck } from '../../core/theme';
import { Icon } from '../components/Icon';
import { playCue } from '../sound/sound';
import { run, toast } from '../store';
import { BUNDLED_FONT_FAMILIES, DEFAULT_THEME_ID, builtInThemes, findTheme, listThemeChoices } from '../themes';
import { removeCustomTheme, saveCustomTheme, useCustomThemes } from './customThemes';
import { pickTextFile, saveTextFile } from './files';
import { Btn, Group, Row, Seg, TextField, Toggle, saveSettings } from './rows';

type Report = { kind: 'error' | 'ok' | 'warn'; title: string; lines: string[]; pending?: ChronosTheme };

const ratio = (fg: string, bg: string): number | null => {
  const f = parseColor(fg), b = parseColor(bg);
  return f && b ? contrast(f, b) : null;
};

/** The numbers the validator checks, for the "contrast passed" line. */
function contrastLines(t: ChronosTheme): string[] {
  const c = t.color;
  const ground = parseColor(c.ground);
  const panel = parseColor(c.panel);
  const panelOver = ground && panel ? composite(panel, ground) : null;
  const hex = (rgba: number[]) => `rgb(${rgba.slice(0, 3).map(Math.round).join(',')})`;
  const worst = (keys: ('text' | 'text2' | 'text3' | 'muted')[]) =>
    Math.min(...keys.flatMap((k) => [ratio(c[k], c.ground), panelOver ? ratio(c[k], hex(panelOver)) : null]).filter((n): n is number => n !== null));
  const f = (n: number | null) => (n === null || !Number.isFinite(n) ? 'n/a' : `${n.toFixed(1)}:1`);
  return [
    `Text on ground and panel: lowest ${f(worst(['text', 'text2', 'text3', 'muted']))} (needs 4.5:1)`,
    `Accent on ground: ${f(ratio(c.accent, c.ground))} (needs 3:1)`,
    `Text on accent: ${f(ratio(c.onAccent, c.accent))} (needs 4.5:1)`,
  ];
}

export function LookSection({ snap }: { snap: Snapshot }) {
  const s = settingsOf(snap.data);
  const dev = snap.device;
  const custom = useCustomThemes();
  const choices = useMemo(() => listThemeChoices(custom), [custom]);
  const [report, setReport] = useState<Report | null>(null);
  const idOf = (id: string) => {
    const t = findTheme(id, custom);
    return t.variant ? `${t.id}/${t.variant}` : t.id;
  };
  const selected = idOf(s.themeId);
  const activeNow = idOf(resolveActiveTheme(s.themeId, s.themeSchedule, minutesOfDay(new Date())));
  const nameOf = (id: string) => choices.find((c) => c.id === idOf(id))?.name ?? id;
  const isStark = findTheme(s.themeId, custom).motion.signature.kind === 'reactor-ring';
  const motion = s.energy.motion;
  const customIds = new Set(custom.map((t) => t.id));

  async function pick(id: string) {
    const ok = await saveSettings({ themeId: id });
    if (ok) toast(`Theme: ${nameOf(id)}.`);
  }

  async function importFile(): Promise<boolean> {
    const f = await pickTextFile('.json,application/json,.chronos-theme.json');
    if (!f) return false;
    const r: ThemeCheck = importTheme(f.text, { bundledFamilies: BUNDLED_FONT_FAMILIES });
    if (!r.ok || !r.theme) {
      setReport({ kind: 'error', title: `${f.name} was not imported`, lines: r.errors.length ? r.errors : ['The file is not a chronos-theme/1 theme.'] });
      return false;
    }
    if (r.warnings.length) {
      setReport({ kind: 'warn', title: `${r.theme.name} passed, with warnings`, lines: [...r.warnings, ...contrastLines(r.theme)], pending: r.theme });
      return true;
    }
    return keep(r.theme, []);
  }

  function keep(theme: ChronosTheme, warnings: string[]): boolean {
    const res = saveCustomTheme(theme);
    if (!res.ok) {
      setReport({ kind: 'error', title: `${theme.name} was not imported`, lines: [res.error] });
      return false;
    }
    setReport({ kind: 'ok', title: `${theme.name} added`, lines: ['Contrast passed.', ...contrastLines(theme), ...warnings] });
    toast(`Added theme ${theme.name}.`);
    return true;
  }

  function exportCurrent(): boolean {
    const base = parseThemeId(s.themeId).base;
    const theme = [...custom, ...builtInThemes].find((t) => t.id === base) as ChronosTheme | undefined;
    if (!theme) return false;
    saveTextFile(`${theme.id}.chronos-theme.json`, exportTheme(theme));
    return true;
  }

  const setRows = (rows: { from: string; themeId: string }[]) => saveSettings({ themeSchedule: [...rows].sort((a, b) => (a.from < b.from ? -1 : 1)) });

  return (
    <>
      <Group title="Theme" note={activeNow !== selected ? `Right now the schedule below shows ${nameOf(activeNow)}.` : undefined}>
        <div className="st-themes" role="group" aria-label="Theme">
          {choices.map((c) => {
            const t = findTheme(c.id, custom);
            return (
              <div className="st-theme-wrap" key={c.id}>
                <button type="button" className="st-theme" aria-pressed={selected === c.id} onClick={() => void pick(c.id)}>
                  <span className="st-theme-sw" aria-hidden="true">
                    {[t.color.ground, t.color.accent, t.color.now].map((col, i) => (
                      <i key={i} style={{ ['--sw' as string]: col }} />
                    ))}
                  </span>
                  <span>
                    {c.name}
                    <small>{c.mode === 'dark' ? 'Dark' : 'Light'}{customIds.has(c.id.split('/')[0]!) ? ' · imported' : ''}</small>
                  </span>
                </button>
                {customIds.has(c.id.split('/')[0]!) && (
                  <button
                    type="button"
                    className="st-btn st-btn-danger st-theme-del"
                    onClick={() => {
                      const was = custom.find((x) => x.id === c.id);
                      removeCustomTheme(c.id);
                      if (selected === c.id) void saveSettings({ themeId: DEFAULT_THEME_ID });
                      toast(`Removed ${c.name}.`, { undo: () => was && void saveCustomTheme(was) });
                    }}
                  >
                    <Icon name="trash" size={14} /> Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="st-actions">
          <Btn onClick={importFile}>Import theme file</Btn>
          <Btn onClick={exportCurrent} done="Exported">Export current theme</Btn>
        </div>
        {report && (
          <div className="st-msg" data-kind={report.kind} role={report.kind === 'error' ? 'alert' : 'status'}>
            <b>{report.title}</b>
            <ul>{report.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            {report.pending && (
              <div className="st-actions">
                <Btn variant="solid" onClick={() => void keep(report.pending!, report.lines.slice(0, -3))}>Keep theme</Btn>
                <Btn onClick={() => setReport(null)}>Discard</Btn>
              </div>
            )}
          </div>
        )}
      </Group>

      <Group title="Switch themes on a schedule" note="Each row says: from this time, use this theme. The last row that has started wins, and midnight wraps. No rows means the theme above stays.">
        <div>
          {s.themeSchedule.map((row, i) => (
            <div className="st-sched" key={`${row.from}-${i}`}>
              <span className="st-sched-word">From</span>
              <TextField
                label={`Switch time ${i + 1}`}
                value={row.from}
                mono
                placeholder="18:00"
                check={(v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v) && parseHM(v) !== null ? null : 'Use HH:MM, 24 hour.')}
                onCommit={(v) => setRows(s.themeSchedule.map((r, j) => (j === i ? { ...r, from: v } : r)))}
              />
              <span className="st-sched-word">use</span>
              <select className="st-select" aria-label={`Theme for switch time ${i + 1}`} value={idOf(row.themeId)} onChange={(e) => void setRows(s.themeSchedule.map((r, j) => (j === i ? { ...r, themeId: e.target.value } : r)))}>
                {choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button type="button" className="st-icon" aria-label={`Remove switch time ${row.from}`} onClick={() => void setRows(s.themeSchedule.filter((_, j) => j !== i))}>
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
        </div>
        <div className="st-actions">
          <Btn
            disabled={s.themeSchedule.length >= 24}
            onClick={() => {
              const used = new Set(s.themeSchedule.map((r) => r.from));
              const from = ['18:00', '19:00', '20:00', '07:00', '12:00', '21:00'].find((t) => !used.has(t)) ?? '22:30';
              const other = choices.find((c) => c.id !== selected)?.id ?? selected;
              return setRows([...s.themeSchedule, { from, themeId: other }]);
            }}
          >
            <Icon name="plus" size={14} /> Add a switch time
          </Btn>
        </div>
      </Group>

      <Group title="Widgets on the desktop">
        <Toggle label="Day" hint="24-hour dial and free time left" checked={s.widgets.day} onChange={(day) => saveSettings({ widgets: { ...s.widgets, day } })} />
        <Toggle label="Momentum" hint="Seven-day focus hours, streak and estimate drift" checked={s.widgets.momentum} onChange={(momentum) => saveSettings({ widgets: { ...s.widgets, momentum } })} />
        <Toggle label="Notes" hint="The current task's latest notes" checked={s.widgets.notes} onChange={(notes) => saveSettings({ widgets: { ...s.widgets, notes } })} />
        <Toggle label="Wellness" hint="Break reminder at the end of long blocks" checked={s.widgets.wellness} onChange={(wellness) => saveSettings({ widgets: { ...s.widgets, wellness } })} />
      </Group>

      <Group title="Motion and energy" note={isStark ? 'Stark workshop effects. Each is its own switch.' : 'These effects belong to Stark workshop. They take effect when that theme is showing.'}>
        <Toggle label="Motion" hint="Off stills every animation and turns the three effects below off. Windows reduced motion is always honoured." checked={motion} onChange={(m) => saveSettings({ energy: { ...s.energy, motion: m } })} />
        <Toggle label="Living reactor" hint="The timer ring charges, turns and breathes" checked={motion && s.energy.livingReactor} disabled={!motion} onChange={(livingReactor) => saveSettings({ energy: { ...s.energy, livingReactor } })} />
        <Toggle label="Holographic depth" hint="Panels tilt a few degrees with the mouse and assemble when they open" checked={motion && s.energy.holographicDepth} disabled={!motion} onChange={(holographicDepth) => saveSettings({ energy: { ...s.energy, holographicDepth } })} />
        <Toggle label="Reactive data" hint="The momentum cell charges toward your weekly goal; the day dial fills per block" checked={motion && s.energy.reactiveData} disabled={!motion} onChange={(reactiveData) => saveSettings({ energy: { ...s.energy, reactiveData } })} />
        <Row label="Reduce motion in the app" hint="Follow Windows, or choose for this app.">
          <Seg label="Reduce motion" value={s.reduceMotion === null ? 'os' : s.reduceMotion ? 'reduce' : 'full'} options={[['os', 'Follow Windows'], ['reduce', 'Reduce'], ['full', 'Full']]} onChange={(v) => void saveSettings({ reduceMotion: v === 'os' ? null : v === 'reduce' })} />
        </Row>
      </Group>

      <Group title="Sound" note="Synthesised cues, no sound files: a soft rising tone when a block starts and a short chord when it finishes.">
        <Toggle label="Play sounds" checked={s.sound.enabled} onChange={(enabled) => saveSettings({ sound: { ...s.sound, enabled } })} />
        <Volume value={s.sound.volume} disabled={!s.sound.enabled} onCommit={(volume) => saveSettings({ sound: { ...s.sound, volume } })} />
        <Toggle label="Mute while a task is in focus" hint="Keeps the cues for the runway only" checked={s.sound.muteInFocus} onChange={(muteInFocus) => saveSettings({ sound: { ...s.sound, muteInFocus } })} />
        <Row label="Test the cues" hint="Plays at the volume above, even when sound is off.">
          <Btn onClick={() => playCue('blockStart', { volume: s.sound.volume })}>Block start</Btn>
          <Btn onClick={() => playCue('blockFinish', { volume: s.sound.volume })}>Block finish</Btn>
        </Row>
      </Group>

      <Group title="Desktop and layout">
        <Toggle label="Live on the desktop" hint="Home sits behind your desktop icons, so Win+D shows it. Windows only; if it cannot attach it runs as a normal window." checked={dev.liveOnDesktop} onChange={(liveOnDesktop) => run({ type: 'device.update', patch: { liveOnDesktop } })} />
        <Row label="Runway position">
          <Seg label="Runway position" value={s.runwayPosition} options={[['top', 'Top'], ['bottom', 'Bottom']]} onChange={(runwayPosition) => void saveSettings({ runwayPosition })} />
        </Row>
        <Row label="Taskbar widget" hint="For the left slot, turn off Widgets in Windows Settings, Personalization, Taskbar.">
          <Seg label="Taskbar widget" value={dev.widgetDock} options={[['taskbar-left', 'Left'], ['taskbar-right', 'Right'], ['free', 'Free']]} onChange={(widgetDock) => void run({ type: 'device.update', patch: { widgetDock } })} />
        </Row>
      </Group>
    </>
  );
}

function Volume({ value, disabled, onCommit }: { value: number; disabled: boolean; onCommit: (v: number) => void | Promise<unknown> }) {
  const [v, setV] = useState(Math.round(value * 100));
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setV(Math.round(value * 100)); }
  const commit = () => v !== Math.round(value * 100) && void onCommit(v / 100);
  return (
    <Row label="Volume" hint={`${v} percent`} htmlFor="st-volume">
      <input id="st-volume" type="range" min={0} max={100} step={5} value={v} disabled={disabled} aria-valuetext={`${v} percent`} onChange={(e) => setV(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
    </Row>
  );
}

