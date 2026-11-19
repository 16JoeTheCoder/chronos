// Tasks and notepad (Phase 3.7): how long done tasks stay, the class in the pill, and the
// notepad's hotkey, position and recent notes. Synced settings go through settings.update;
// the notepad is per PC (device.update).

import { useEffect, useState } from 'react';
import type { Command } from '../../core/commands';
import type { DeviceSettings, Snapshot } from '../../core/model/types';
import { taskPrefs } from '../../core/model/defaults';
import { settingsOf } from '../../core/repo/repo';
import { run } from '../store';
import { Group, Row, Seg, Toggle, saveSettings } from './rows';

type DevicePatch = Extract<Command, { type: 'device.update' }>['patch'];
const D = (patch: DevicePatch) => run({ type: 'device.update', patch });

/** Electron accelerator for a key press, or null for a lone modifier. */
export function acceleratorOf(e: { key: string; code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(e.key)) return null;
  const named: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Pause: 'Pause', ScrollLock: 'ScrollLock' };
  const key = named[e.key] ?? (/^F\d{1,2}$/.test(e.key) ? e.key : /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : null);
  if (!key) return null;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super', key].filter(Boolean).join('+');
}

/** Press-to-record shortcut field. Any key with a modifier, or a bare Insert, Pause, Scroll Lock or F-key. */
function KeyField({ label, hint, value, onSave }: { label: string; hint: string; value: string; onSave: (v: string) => Promise<boolean> }) {
  const [rec, setRec] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!rec) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) { setRec(false); return; }
      const acc = acceleratorOf(e);
      if (!acc) return;
      setRec(false);
      void onSave(acc).then((ok) => setErr(ok ? null : `${acc} cannot be used. Try Insert, F8, or Ctrl+Alt with a letter.`));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [rec, onSave]);
  return (
    <Row label={label} hint={err ?? hint}>
      <button type="button" className={`st-input st-mono st-key${rec ? ' is-rec' : ''}`} aria-live="polite" onClick={() => setRec(!rec)}>
        {rec ? 'Press a key… (Esc cancels)' : value}
      </button>
    </Row>
  );
}

export function TasksSection({ snap }: { snap: Snapshot }) {
  const s = settingsOf(snap.data);
  const p = taskPrefs(s);
  const dev = snap.device;
  const np = dev.notepad;
  const keep = String(p.doneRetentionHours) as '24' | '72' | '168' | '0';
  const setNp = (patch: Partial<DeviceSettings['notepad']>) => D({ notepad: { ...np, ...patch } });
  return (
    <>
      <Group title="Done tasks" note="Finished tasks stay in Done, where you can mark them not done. After this long they move to Recently deleted (restorable for 7 days).">
        <Row label="Keep done tasks for">
          <Seg label="Keep done tasks for" value={keep} options={[['24', '24 hours'], ['72', '3 days'], ['168', '7 days'], ['0', 'Always']]} onChange={(v) => void saveSettings({ tasks: { doneRetentionHours: Number(v) } })} />
        </Row>
      </Group>

      <Group title="Overlay pill">
        <Toggle label="Show the current class in the pill" hint="A second, smaller line under the task names the class that is on now, so you remember where you are meant to be." checked={p.pillShowsClass} onChange={(pillShowsClass) => saveSettings({ pillShowsClass })} />
      </Group>

      <Group title="Notepad" note="These apply to this PC only.">
        <KeyField label="Notepad hotkey" hint={snap.shortcutError ?? 'Opens the notepad from any app. Insert works on its own.'} value={dev.shortcuts.capture} onSave={(capture) => D({ shortcuts: { ...dev.shortcuts, capture } }).then((r) => r.ok)} />
        <Row label="Where it opens">
          <Seg label="Where it opens" value={np.position} options={[['top-right', 'Top right'], ['top-left', 'Top left'], ['centre', 'Centre'], ['cursor', 'At the pointer']]} onChange={(position) => void setNp({ position })} />
        </Row>
        <Row label="Recent notes above the editor">
          <Seg label="Recent notes above the editor" value={String(np.recent) as '0'} options={[['0', 'None'], ['1', '1'], ['2', '2'], ['3', '3']]} onChange={(v) => void setNp({ recent: Number(v) })} />
        </Row>
      </Group>
    </>
  );
}
