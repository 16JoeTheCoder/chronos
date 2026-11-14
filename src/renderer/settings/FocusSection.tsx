// Focus: timer defaults, how a block ends, the overlay, shortcuts, and how finishing works.

import type { Command } from '../../core/commands';
import type { Snapshot } from '../../core/model/types';
import { settingsOf } from '../../core/repo/repo';
import { run } from '../store';
import { Group, NumField, Row, Seg, TextField, Toggle, saveSettings } from './rows';

type DevicePatch = Extract<Command, { type: 'device.update' }>['patch'];
const D = (patch: DevicePatch) => run({ type: 'device.update', patch });

export function FocusSection({ snap }: { snap: Snapshot }) {
  const s = settingsOf(snap.data);
  const dev = snap.device;
  const t = s.timerDefaults;
  const min = (ms: number) => Math.round(ms / 60_000);
  const setT = (patch: Partial<typeof t>) => saveSettings({ timerDefaults: { ...t, ...patch } });
  return (
    <>
      <Group title="Finishing a task" note="One task owns the screen, and finishing it is deliberate.">
        <div className="st-msg" data-kind="ok">
          <b>Hold Enter for 2 seconds to finish.</b>
          <span>A ring fills while you hold. Let go early and it drains back, nothing is lost. Space starts and pauses, and never finishes.</span>
        </div>
      </Group>

      <Group title="Overlay" note="The small timer pill at the bottom left of your screen. Hover it for the title, timer and Hold to finish.">
        <Toggle label="Hide the overlay in full-screen apps" hint="Games, video and presentations stay clean. Needs Windows to report a full-screen app (see the Windows checklist)." checked={dev.overlayHideInFullscreen} onChange={(overlayHideInFullscreen) => D({ overlayHideInFullscreen })} />
        <Toggle label="Notifications" hint="Upcoming fixed events and the end-of-day review." checked={dev.notifications} onChange={(notifications) => D({ notifications })} />
      </Group>

      <Group title="When a block ends">
        <Row label="At the end of a block">
          <Seg label="At the end of a block" value={s.blockEnd} options={[['continue', 'Keep counting'], ['stop', 'Stop']]} onChange={(blockEnd) => void saveSettings({ blockEnd })} />
        </Row>
        <NumField label="Sprint checkpoint every" value={s.checkpointEveryMin} min={15} max={600} suffix="min" onCommit={(checkpointEveryMin) => saveSettings({ checkpointEveryMin })} />
      </Group>

      <Group title="Timer defaults">
        <Row label="Default mode">
          <Seg label="Default mode" value={t.mode} options={[['countdown', 'Countdown'], ['pomodoro', 'Pomodoro'], ['stopwatch', 'Stopwatch']]} onChange={(mode) => void setT({ mode })} />
        </Row>
        <NumField label="Countdown" value={min(t.countdown.durationMs)} min={1} max={600} suffix="min" onCommit={(v) => setT({ countdown: { ...t.countdown, durationMs: v * 60_000 } })} />
        <NumField label="Pomodoro work" value={min(t.pomodoro.workMs)} min={1} max={180} suffix="min" onCommit={(v) => setT({ pomodoro: { ...t.pomodoro, workMs: v * 60_000 } })} />
        <NumField label="Short break" value={min(t.pomodoro.shortBreakMs)} min={1} max={60} suffix="min" onCommit={(v) => setT({ pomodoro: { ...t.pomodoro, shortBreakMs: v * 60_000 } })} />
        <NumField label="Long break" value={min(t.pomodoro.longBreakMs)} min={1} max={120} suffix="min" onCommit={(v) => setT({ pomodoro: { ...t.pomodoro, longBreakMs: v * 60_000 } })} />
        <NumField label="Long break every" value={t.pomodoro.sessionsBeforeLongBreak} min={2} max={12} suffix="sessions" onCommit={(v) => setT({ pomodoro: { ...t.pomodoro, sessionsBeforeLongBreak: v } })} />
        <Toggle label="Start breaks automatically" checked={t.pomodoro.autoStartBreaks} onChange={(autoStartBreaks) => setT({ pomodoro: { ...t.pomodoro, autoStartBreaks } })} />
        <Toggle label="Start work automatically" checked={t.pomodoro.autoStartWork} onChange={(autoStartWork) => setT({ pomodoro: { ...t.pomodoro, autoStartWork } })} />
      </Group>

      <Group title="Shortcuts" note={snap.shortcutError ?? 'Global shortcuts work from any app. Format: Ctrl+Alt+Space.'}>
        {(['toggle', 'startPause', 'capture'] as const).map((k) => (
          <TextField key={k} label={k === 'toggle' ? 'Show or hide Chronos' : k === 'startPause' ? 'Start or pause' : 'Notepad'} value={dev.shortcuts[k]} wide mono onCommit={(v) => D({ shortcuts: { ...dev.shortcuts, [k]: v.trim() } }).then((r) => r.ok)} />
        ))}
      </Group>
    </>
  );
}
