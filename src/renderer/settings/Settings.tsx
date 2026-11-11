// Settings (§9.9) and About (§9.10). Synced settings go through settings.update;
// per-machine ones (login, hotkeys, widget dock, display, shelf folder, sound)
// through device.update and never sync.

import { useState } from 'react';
import type { SettingsPatch } from '../../core/commands';
import type { Command } from '../../core/commands';
import { formatHM, formatHuman, parseHM } from '../../core/format';
import { TAG_COLORS, type Snapshot, type TagColor } from '../../core/model/types';
import { live, settingsOf } from '../../core/repo/repo';
import { RECYCLE_DAYS } from '../../core/repo/recycle';
import { isValidZone } from '../../core/time/zone';
import { Icon } from '../components/Icon';
import { recycleWithUndo } from '../components/actions';
import { ask } from '../components/ask';
import { Field, Segmented, Switch } from '../components/ui';
import { run, toast } from '../store';
import brand from '../assets/builtbyjosef.svg';
import monogram from '../assets/jy-monogram.svg';

const SECTIONS = ['General', 'Day', 'Timetable', 'Tags', 'Timer', 'Appearance', 'Data', 'Sync', 'Integrations', 'Advanced', 'Diagnostics', 'About'] as const;
type Section = (typeof SECTIONS)[number];

export function Settings({ snap, onSchedule, onClose }: { snap: Snapshot; onSchedule: () => void; onClose: () => void }) {
  const [sec, setSec] = useState<Section>('General');
  // Diagnostics only exists while Experimental is on (per device).
  const sections = SECTIONS.filter((x) => x !== 'Diagnostics' || snap.device.experimental);
  const shown: Section = sections.includes(sec) ? sec : 'Advanced';
  return (
    <section className="settings" aria-label="Settings">
      <nav className="settings-nav" aria-label="Settings sections">
        <h2>Settings</h2>
        {sections.map((x) => (
          <button key={x} className={shown === x ? 'on' : ''} aria-current={shown === x ? 'page' : undefined} onClick={() => setSec(x)}>
            {x}
          </button>
        ))}
        <button className="btn btn-ghost btn-s" onClick={onClose}>
          Close
        </button>
      </nav>
      <div className="settings-body">
        <h3 className="h">{shown}</h3>
        <Body sec={shown} snap={snap} onSchedule={onSchedule} />
      </div>
    </section>
  );
}

const S = (patch: SettingsPatch) => void run({ type: 'settings.update', patch });
type DevicePatch = Extract<Command, { type: 'device.update' }>['patch'];
const D = (patch: DevicePatch) => void run({ type: 'device.update', patch });

function Body({ sec, snap, onSchedule }: { sec: Section; snap: Snapshot; onSchedule: () => void }) {
  const s = settingsOf(snap.data);
  const dev = snap.device;
  switch (sec) {
    case 'General':
      return (
        <div className="form">
          <Commit label="Display name" value={s.displayName} onCommit={(displayName) => S({ displayName })} />
          <Commit label="Time zone" value={s.timezone} help="IANA name. WIB is Asia/Jakarta." valid={isValidZone} onCommit={(timezone) => S({ timezone })} />
          <Switch label="Launch at login" checked={dev.launchAtLogin} onChange={(launchAtLogin) => D({ launchAtLogin })} />
          {!snap.isPackaged && <p className="muted">Launch at login works in the installed build only.</p>}
          <Switch label="Show the launch screen" checked={!dev.skipLaunchScreen} onChange={(on) => D({ skipLaunchScreen: !on })} />
          <Commit label="Display (blank = primary)" value={dev.displayId === null ? '' : String(dev.displayId)} help="The display id Home covers. See Copy diagnostics." onCommit={(v) => D({ displayId: v.trim() ? Number(v) : null })} />
          <Commit label="Shelf folder (blank = Desktop)" value={dev.stackFolder ?? ''} onCommit={(v) => D({ stackFolder: v.trim() || null })} />
          <p className="eyebrow">Hotkeys</p>
          {snap.shortcutError && <p className="warn">{snap.shortcutError}</p>}
          {(['toggle', 'startPause', 'capture'] as const).map((k) => (
            <Commit key={k} label={k === 'toggle' ? 'Show or hide Chronos' : k === 'startPause' ? 'Start or pause' : 'Quick capture'} value={dev.shortcuts[k]} onCommit={(v) => D({ shortcuts: { ...dev.shortcuts, [k]: v } })} />
          ))}
        </div>
      );
    case 'Day':
      return (
        <div className="form">
          <div className="grid2">
            <Commit label="Day starts" value={formatHM(s.dayStartMin)} valid={(v) => parseHM(v) !== null} onCommit={(v) => S({ dayStartMin: parseHM(v) ?? s.dayStartMin })} />
            <Commit label="Day ends" value={formatHM(s.dayEndMin)} valid={(v) => parseHM(v) !== null} onCommit={(v) => S({ dayEndMin: parseHM(v) ?? s.dayEndMin })} />
          </div>
          <Num label="Buffer at the end of the day (minutes)" value={s.bufferMin} onCommit={(bufferMin) => S({ bufferMin })} />
          <Num label="Prep reminder before class (minutes)" value={s.prepLeadMin} onCommit={(prepLeadMin) => S({ prepLeadMin })} />
        </div>
      );
    case 'Timetable':
      return (
        <div className="form">
          <Switch label="Use timetable" checked={s.timetable.enabled} onChange={(enabled) => S({ timetable: { ...s.timetable, enabled } })} />
          {(['school', 'work', 'uni', 'other'] as const).map((sc) => (
            <Switch key={sc} label={sc[0]!.toUpperCase() + sc.slice(1)} checked={s.timetable.scopes[sc]} onChange={(on) => S({ timetable: { ...s.timetable, scopes: { ...s.timetable.scopes, [sc]: on } } })} />
          ))}
          <Switch label="Pre-fill national holidays" checked={s.holidaysEnabled} onChange={(holidaysEnabled) => S({ holidaysEnabled })} />
          <button className="btn btn-s" onClick={onSchedule}>
            <Icon name="calendar" size={14} /> Edit schedule
          </button>
        </div>
      );
    case 'Tags':
      return <Tags snap={snap} />;
    case 'Timer': {
      const t = s.timerDefaults;
      const min = (ms: number) => Math.round(ms / 60_000);
      return (
        <div className="form">
          <Field label="Default mode">
            <Segmented label="Default mode" value={t.mode} options={[['countdown', 'Countdown'], ['pomodoro', 'Pomodoro'], ['stopwatch', 'Stopwatch']]} onChange={(mode) => S({ timerDefaults: { ...t, mode } })} />
          </Field>
          <Num label="Countdown (minutes)" value={min(t.countdown.durationMs)} onCommit={(v) => S({ timerDefaults: { ...t, countdown: { ...t.countdown, durationMs: v * 60_000 } } })} />
          <div className="grid2">
            <Num label="Pomodoro work" value={min(t.pomodoro.workMs)} onCommit={(v) => S({ timerDefaults: { ...t, pomodoro: { ...t.pomodoro, workMs: v * 60_000 } } })} />
            <Num label="Short break" value={min(t.pomodoro.shortBreakMs)} onCommit={(v) => S({ timerDefaults: { ...t, pomodoro: { ...t.pomodoro, shortBreakMs: v * 60_000 } } })} />
            <Num label="Long break" value={min(t.pomodoro.longBreakMs)} onCommit={(v) => S({ timerDefaults: { ...t, pomodoro: { ...t.pomodoro, longBreakMs: v * 60_000 } } })} />
            <Num label="Long break every" value={t.pomodoro.sessionsBeforeLongBreak} onCommit={(v) => S({ timerDefaults: { ...t, pomodoro: { ...t.pomodoro, sessionsBeforeLongBreak: v } } })} />
          </div>
          <Switch label="Auto-start breaks" checked={t.pomodoro.autoStartBreaks} onChange={(autoStartBreaks) => S({ timerDefaults: { ...t, pomodoro: { ...t.pomodoro, autoStartBreaks } } })} />
          <Switch label="Auto-start work" checked={t.pomodoro.autoStartWork} onChange={(autoStartWork) => S({ timerDefaults: { ...t, pomodoro: { ...t.pomodoro, autoStartWork } } })} />
          <Field label="At the end of a block">
            <Segmented label="At the end of a block" value={s.blockEnd} options={[['continue', 'Keep counting (overtime)'], ['stop', 'Stop']]} onChange={(blockEnd) => S({ blockEnd })} />
          </Field>
          <Num label="Sprint checkpoint every (minutes)" value={s.checkpointEveryMin} onCommit={(checkpointEveryMin) => S({ checkpointEveryMin })} />
          <Switch label="Notifications" checked={dev.notifications} onChange={(notifications) => D({ notifications })} />
          <Switch label="Sound" checked={dev.sound} onChange={(sound) => D({ sound })} />
        </div>
      );
    }
    case 'Appearance':
      return (
        <div className="form">
          <Field label="Theme">
            <Segmented label="Theme" value={s.theme} options={[['dark', 'Dark'], ['light', 'Light'], ['system', 'System']]} onChange={(theme) => S({ theme })} />
          </Field>
          <Field label="Runway position">
            <Segmented label="Runway position" value={s.runwayPosition} options={[['top', 'Top'], ['bottom', 'Bottom']]} onChange={(runwayPosition) => S({ runwayPosition })} />
          </Field>
          <Field label="Motion">
            <Segmented label="Motion" value={s.reduceMotion === null ? 'os' : s.reduceMotion ? 'reduce' : 'full'} options={[['os', 'Follow Windows'], ['reduce', 'Reduce'], ['full', 'Full']]} onChange={(v) => S({ reduceMotion: v === 'os' ? null : v === 'reduce' })} />
          </Field>
          <Field label="Taskbar widget">
            <Segmented label="Taskbar widget" value={dev.widgetDock} options={[['taskbar-left', 'Taskbar left'], ['taskbar-right', 'Taskbar right'], ['free', 'Free (drag it)']]} onChange={(widgetDock) => D({ widgetDock })} />
          </Field>
          <p className="muted">For the left slot, turn off Widgets in Windows Settings → Personalization → Taskbar.</p>
        </div>
      );
    case 'Data':
      return (
        <div className="form">
          <p className="muted">Data folder: {snap.dataDir}</p>
          <div className="row gap wrap">
            <button className="btn btn-s" onClick={() => void run({ type: 'data.import', source: 'monolith' }).then((r) => r.ok && toast(`Imported ${r.id} tasks from Monolith.`))}>
              Import from Monolith
            </button>
            <button className="btn btn-s btn-ghost" onClick={() => void run({ type: 'data.export' }).then((r) => r.ok && toast('Exported.'))}>
              Export JSON
            </button>
            <button className="btn btn-s btn-ghost" onClick={() => void run({ type: 'data.openFolder' })}>
              Open data folder
            </button>
          </div>
          <p className="muted">Import reads Monolith's data file and never changes it. Deleted items stay in Trash for {RECYCLE_DAYS} days, then their content is wiped; a tiny marker remains for 60 days so another device cannot bring them back.</p>
        </div>
      );
    case 'Sync':
      return <SyncSection snap={snap} />;
    case 'Integrations':
      return <Integrations snap={snap} />;
    case 'Diagnostics':
      return <Diagnostics snap={snap} />;
    case 'Advanced':
      return (
        <div className="form">
          <p className="muted">Variants of the time-left maths. All off (0) by default.</p>
          <Num label="Ignore free gaps shorter than (minutes)" value={s.timeLeft.gapFilterMin} onCommit={(gapFilterMin) => S({ timeLeft: { ...s.timeLeft, gapFilterMin } })} />
          <Num label="Transition after each fixed event (minutes)" value={s.timeLeft.transitionMin} onCommit={(transitionMin) => S({ timeLeft: { ...s.timeLeft, transitionMin } })} />
          <Num label="Meal reserve at mid-day (minutes)" value={s.timeLeft.mealReserveMin} onCommit={(mealReserveMin) => S({ timeLeft: { ...s.timeLeft, mealReserveMin } })} />
          <Switch label="Experimental" checked={dev.experimental} onChange={(experimental) => D({ experimental })} />
          <p className="muted">Per device. Adds a Diagnostics section with sync internals, snapshots and logs.</p>
        </div>
      );
    case 'About':
      return <About snap={snap} />;
  }
}

const STATE_TEXT: Record<Snapshot['sync']['state'], string> = {
  off: 'Off',
  signedOut: 'Signed out',
  syncing: 'Syncing…',
  synced: 'Up to date',
  pending: 'Changes waiting to sync',
  offline: 'Offline. Changes are kept and will sync when the PC is back online.',
  error: 'Sync error',
  readOnly: 'Read-only',
};

const when = (ms: number | null) => (ms === null ? 'Never' : new Date(ms).toLocaleString());

function SyncSection({ snap }: { snap: Snapshot }) {
  const sy = snap.sync;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const signedIn = sy.email !== null && sy.state !== 'signedOut' && sy.state !== 'off';
  async function signIn() {
    setBusy(true);
    setErr(null);
    const r = await run({ type: 'sync.signIn' }, true);
    setBusy(false);
    if (!r.ok) setErr(r.error);
  }
  return (
    <div className="form">
      {!sy.configured ? (
        <p>Sync is not set up on this PC. See docs/SETUP_FIREBASE.md.</p>
      ) : signedIn ? (
        <>
          <p>Signed in as {sy.email}</p>
          <p className="muted">
            {STATE_TEXT[sy.state]}
            {sy.reason ? `: ${sy.reason}` : ''}
          </p>
          <p className="muted">Last sync: {when(sy.lastSyncAt)}</p>
          <div>
            <button className="btn btn-s btn-ghost" onClick={() => void run({ type: 'sync.signOut' })}>
              Sign out
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">Sign in to keep your data in step across your PCs.</p>
          <div className="row gap">
            <button className="btn btn-s" disabled={busy} onClick={() => void signIn()}>
              Sign in with Google
            </button>
            {busy && (
              <span className="muted" role="status">
                Waiting for the browser…
              </span>
            )}
          </div>
          {err && (
            <p className="warn" role="alert">
              {err}
            </p>
          )}
        </>
      )}
      <p className="muted">Device: {snap.device.deviceName}</p>
      <p className="muted mono">Device ID: {snap.device.deviceId}</p>
    </div>
  );
}

function Integrations({ snap }: { snap: Snapshot }) {
  const dev = snap.device;
  const m = snap.diag?.mcp;
  const status = m ? (m.error ? `Error: ${m.error}` : m.running ? `Running on port ${m.port}` : m.enabled ? 'Starting…' : 'Off') : dev.mcp.enabled ? `On, port ${dev.mcp.port}` : 'Off';
  return (
    <div className="form">
      <p className="eyebrow">Claude (MCP)</p>
      <Switch label="Let Claude Desktop read and change my plan" checked={dev.mcp.enabled} onChange={(enabled) => D({ mcp: { enabled } })} />
      <p className="muted" role="status">
        {status}
      </p>
      <div>
        <button className="btn btn-s btn-ghost" onClick={() => void run({ type: 'mcp.copyConfig' }).then((r) => r.ok && toast('Copied. Paste it into claude_desktop_config.json.'))}>
          <Icon name="copy" size={14} /> Copy Claude Desktop config
        </button>
      </div>
      <p className="muted">
        Claude Desktop config lives at <code>%APPDATA%\Claude\claude_desktop_config.json</code>. Restart Claude Desktop after pasting.
      </p>
    </div>
  );
}

const short = (v: unknown, n = 60) => {
  const t = JSON.stringify(v) ?? 'undefined';
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

function Diagnostics({ snap }: { snap: Snapshot }) {
  const diag = snap.diag;
  const sy = snap.sync;
  const [show, setShow] = useState(false);
  if (!diag) return <p className="muted">Loading diagnostics…</p>;
  const cursors = Object.entries(diag.cursors);
  const oldest = sy.oldestPendingAt === null ? null : formatHuman(Math.max(0, Date.now() - sy.oldestPendingAt));
  return (
    <div className="form">
      <section className="set-sec" aria-label="Sync state">
        <p className="eyebrow">Sync</p>
        <dl className="kv">
          <dt>State</dt>
          <dd>
            {sy.state}
            {sy.reason ? `: ${sy.reason}` : ''}
          </dd>
          <dt>Outbox</dt>
          <dd>{sy.pending > 0 ? `${sy.pending} waiting${oldest ? `, oldest ${oldest} old` : ''}` : 'empty'}</dd>
          <dt>Last sync</dt>
          <dd>{when(sy.lastSyncAt)}</dd>
        </dl>
        <p className="eyebrow">Cursors</p>
        {cursors.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <dl className="kv mono">
            {cursors.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd>{Number(v)}</dd>
              </div>
            ))}
          </dl>
        )}
        <div>
          <button
            className="btn btn-s btn-ghost"
            onClick={() =>
              ask({
                title: 'Force resync?',
                body: 'Chronos snapshots your data, then downloads everything from the cloud again and merges it. Changes waiting to upload are kept.',
                actions: [{ label: 'Force resync', primary: true, run: () => void run({ type: 'sync.forceResync' }) }],
              })
            }
          >
            Force resync
          </button>
        </div>
      </section>

      <section className="set-sec" aria-label="Snapshots">
        <p className="eyebrow">Snapshots</p>
        {diag.snapshots.length === 0 && <p className="muted">No snapshots yet.</p>}
        <ul className="diag-list">
          {diag.snapshots.map((name) => (
            <li key={name}>
              <span className="row gap">
                <code>{name}</code>
                <button
                  className="btn btn-s btn-ghost"
                  onClick={() =>
                    ask({
                      title: `Restore ${name}?`,
                      body: `Restore ${name}? The current data is snapshotted first.`,
                      actions: [{ label: 'Restore', primary: true, run: () => void run({ type: 'snapshot.restore', name }) }],
                    })
                  }
                >
                  Restore
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="set-sec" aria-label="Conflict log">
        <div className="row gap">
          <p className="eyebrow grow">Conflicts ({diag.conflicts.length})</p>
          {diag.conflicts.length > 0 && (
            <button className="btn btn-s btn-ghost" onClick={() => void run({ type: 'diag.clear', what: 'conflicts' })}>
              Clear
            </button>
          )}
        </div>
        {diag.conflicts.length === 0 && <p className="muted">None.</p>}
        <ul className="diag-list">
          {diag.conflicts.map((c, i) => (
            <li key={`${c.at}-${i}`}>
              <span>
                {when(c.at)} · {c.coll}/{c.id} · {c.field}
              </span>
              <code>
                {short(c.overwrittenValue)} → {short(c.newValue)} · device {c.otherDeviceId}
              </code>
            </li>
          ))}
        </ul>
      </section>

      <section className="set-sec" aria-label="Quarantine">
        <div className="row gap">
          <p className="eyebrow grow">Quarantine ({diag.quarantine.length})</p>
          {diag.quarantine.length > 0 && (
            <button className="btn btn-s btn-ghost" onClick={() => void run({ type: 'diag.clear', what: 'quarantine' })}>
              Clear
            </button>
          )}
        </div>
        {diag.quarantine.length === 0 && <p className="muted">None.</p>}
        <ul className="diag-list">
          {diag.quarantine.map((q, i) => (
            <li key={`${q.at}-${i}`}>
              <span>
                {when(q.at)} · {q.coll}/{q.id}
              </span>
              <code>{q.reason}</code>
            </li>
          ))}
        </ul>
      </section>

      <section className="set-sec" aria-label="Claude (MCP)">
        <p className="eyebrow">Claude (MCP)</p>
        <dl className="kv">
          <dt>Status</dt>
          <dd>{diag.mcp.error ? `Error: ${diag.mcp.error}` : diag.mcp.running ? 'Running' : diag.mcp.enabled ? 'Starting' : 'Off'}</dd>
          <dt>Port</dt>
          <dd>{diag.mcp.port}</dd>
          <dt>Token</dt>
          <dd className="mono">{show ? diag.mcp.token : '•'.repeat(16)}</dd>
        </dl>
        <div className="row gap wrap">
          <button className="btn btn-s btn-ghost" aria-pressed={show} onClick={() => setShow((v) => !v)}>
            {show ? 'Hide token' : 'Show token'}
          </button>
          <button className="btn btn-s btn-ghost" onClick={() => void run({ type: 'mcp.regenerateToken' })}>
            Regenerate token
          </button>
          <button className="btn btn-s btn-ghost" onClick={() => void run({ type: 'diag.exportLog' }).then((r) => r.ok && toast('Log exported.'))}>
            Export log
          </button>
        </div>
      </section>
    </div>
  );
}

function Tags({ snap }: { snap: Snapshot }) {
  const tags = live(snap.data, 'tags');
  const [name, setName] = useState('');
  const [color, setColor] = useState<TagColor>('tag1');
  return (
    <div className="form">
      <ul className="list">
        {tags.map((t) => (
          <li key={t.id}>
            <span className="row gap">
              <span className="dot" style={{ background: `var(--${t.color})` }} /> {t.name}
            </span>
            <span className="row gap">
              <select aria-label={`Colour of ${t.name}`} value={t.color} onChange={(e) => void run({ type: 'tag.update', id: t.id, input: { name: t.name, color: e.target.value as TagColor, kind: t.kind } })}>
                {TAG_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button className="icon-btn" aria-label={`Delete ${t.name}`} onClick={() => void recycleWithUndo('tags', t.id, t.name)}>
                <Icon name="trash" size={16} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      <form
        className="row gap"
        onSubmit={(e) => {
          e.preventDefault();
          void run({ type: 'tag.create', input: { name, color, kind: 'general' } }).then((r) => r.ok && setName(''));
        }}
      >
        <input aria-label="New tag name" placeholder="New tag" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="swatches" role="radiogroup" aria-label="Tag colour">
          {TAG_COLORS.map((c) => (
            <button type="button" key={c} role="radio" aria-checked={color === c} aria-label={c} className="swatch" style={{ background: `var(--${c})` }} onClick={() => setColor(c)} />
          ))}
        </div>
        <button className="btn btn-s" type="submit">
          Add tag
        </button>
      </form>
    </div>
  );
}

function About({ snap }: { snap: Snapshot }) {
  const diag = JSON.stringify({ version: snap.version, packaged: snap.isPackaged, platform: snap.platform, dataDir: snap.dataDir, deviceId: snap.device.deviceId, startup: snap.perf }, null, 2);
  return (
    <div className="about">
      <div className="about-stage">
        <img className="about-mark" src={monogram} alt="JY monogram" />
        <div>
          <p className="about-name pair">
            Chronos: own your <b>time.</b>
          </p>
          <p className="muted">Version {snap.version}</p>
        </div>
      </div>
      <p>Built by Josef Yang · builtbyjosef</p>
      <img className="about-lockup" src={brand} alt="builtbyjosef" />
      <button className="btn btn-s btn-ghost" onClick={() => void navigator.clipboard.writeText(diag).then(() => toast('Diagnostics copied.'), () => toast('Could not copy.', { error: true }))}>
        <Icon name="copy" size={14} /> Copy diagnostics
      </button>
      <pre className="diag">{diag}</pre>
    </div>
  );
}

/** A text field that commits on blur or Enter (settings validate in main). */
function Commit({ label, value, help, valid, onCommit }: { label: string; value: string; help?: string; valid?: (v: string) => boolean; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  const bad = valid ? !valid(v) : false;
  const commit = () => v !== value && !bad && onCommit(v);
  return (
    <Field label={label} help={bad ? 'Check this value.' : help} error={bad ? 'Check this value.' : undefined}>
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </Field>
  );
}

function Num({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  return <Commit label={label} value={String(value)} valid={(v) => /^\d+$/.test(v.trim())} onCommit={(v) => onCommit(Number(v))} />;
}

