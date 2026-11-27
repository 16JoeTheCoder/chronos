// Account and sync: who you are, sync, this PC, Claude (MCP), your data, and About.

import { useState } from 'react';
import { RECYCLE_DAYS } from '../../core/repo/recycle';
import { settingsOf } from '../../core/repo/repo';
import type { Snapshot } from '../../core/model/types';
import { api } from '../api';
import { ask } from '../components/ask';
import { Icon } from '../components/Icon';
import { SMARTSCREEN_NOTE, useDesktopOffer, usePwaInstall } from '../components/InstallApp';
import { run, toast } from '../store';
import brand from '../assets/builtbyjosef.svg';
import monogram from '../assets/jy-monogram.svg';
import { Btn, Group, Row, TextField, Toggle, saveSettings } from './rows';

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
export const when = (ms: number | null) => (ms === null ? 'Never' : new Date(ms).toLocaleString());

export function AccountSection({ snap }: { snap: Snapshot }) {
  const s = settingsOf(snap.data);
  const dev = snap.device;
  const sy = snap.sync;
  const [err, setErr] = useState<string | null>(null);
  const can = api.can;
  const web = api.web;
  const onWeb = api.platform === 'web';
  const desktopOffer = useDesktopOffer();
  const pwa = usePwaInstall();
  const signedIn = sy.email !== null && sy.state !== 'signedOut' && sy.state !== 'off';
  const signOut = () => {
    const out = () => run({ type: 'sync.signOut' }).then((r) => r.ok);
    if (!web?.isPublicComputer()) return out();
    ask({ title: 'Sign out of Chronos?', body: 'This clears Chronos from this browser. Your data stays in your account.', actions: [{ label: 'Sign out and clear', primary: true, run: () => void out() }] });
    return true;
  };
  const copyConfig = () => run({ type: 'mcp.copyConfig' }).then((r) => { if (r.ok) toast('Copied. Paste it into claude_desktop_config.json.'); return r.ok; });
  const m = snap.diag?.mcp;
  const mcpStatus = m ? (m.error ? `Error: ${m.error}` : m.running ? `Running on port ${m.port}` : m.enabled ? 'Starting…' : 'Off') : dev.mcp.enabled ? `On, port ${dev.mcp.port}` : 'Off';
  const diag = JSON.stringify({ version: snap.version, packaged: snap.isPackaged, platform: snap.platform, dataDir: snap.dataDir, deviceId: dev.deviceId, startup: snap.perf }, null, 2);

  return (
    <>
      <Group title="You">
        <TextField label="Display name" value={s.displayName} wide onCommit={(displayName) => saveSettings({ displayName })} />
      </Group>

      <Group title="Sync" note={!sy.configured ? (onWeb ? 'Sync is not set up for this site.' : 'Sync is not set up on this PC. See docs/SETUP_FIREBASE.md.') : undefined}>
        {sy.configured && (signedIn ? (
          <>
            <Row label={`Signed in as ${sy.email}`} hint={`${STATE_TEXT[sy.state]}${sy.reason ? `: ${sy.reason}` : ''}. Last sync: ${when(sy.lastSyncAt)}`}>
              <Btn onClick={() => signOut()}>Sign out</Btn>
            </Row>
          </>
        ) : (
          <Row label="Sign in with Google" hint={onWeb ? 'You are using Chronos in this browser only. Sign in to keep your data in step across your devices.' : 'Keeps your data in step across your PCs.'}>
            <Btn variant="solid" onClick={async () => { setErr(null); const r = web ? await web.signIn({ publicComputer: false }) : await run({ type: 'sync.signIn' }, true); if (!r.ok) setErr(r.error); return r.ok; }}>Sign in</Btn>
          </Row>
        ))}
        {err && <p className="st-msg" data-kind="error" role="alert"><b>Sign-in failed</b>{err}</p>}
      </Group>

      <Group title={onWeb ? 'This browser' : 'This PC'}>
        <Row label={dev.deviceName} hint={`Device ID ${dev.deviceId}`} />
        {can.windowsSettings && <Toggle label="Launch at login" hint={snap.isPackaged ? undefined : 'Works in the installed build only.'} checked={dev.launchAtLogin} onChange={(launchAtLogin) => run({ type: 'device.update', patch: { launchAtLogin } })} />}
        <Toggle label="Show the launch screen" checked={!dev.skipLaunchScreen} onChange={(on) => run({ type: 'device.update', patch: { skipLaunchScreen: !on } })} />
        {can.windowControls && <TextField label="Display Home covers" hint="Blank is the primary display. Copy diagnostics lists display ids." value={dev.displayId === null ? '' : String(dev.displayId)} onCommit={(v) => run({ type: 'device.update', patch: { displayId: v.trim() ? Number(v) : null } }).then((r) => r.ok)} check={(v) => (!v.trim() || /^\d+$/.test(v.trim()) ? null : 'Use a number, or leave blank.')} mono />}
        {can.fileShelf && <TextField label="Shelf folder" hint="Blank is the Desktop." value={dev.stackFolder ?? ''} wide onCommit={(v) => run({ type: 'device.update', patch: { stackFolder: v.trim() || null } }).then((r) => r.ok)} />}
      </Group>

      {can.localMcp && <Group title="Claude" note="Local only, on 127.0.0.1. Claude Desktop config lives at %APPDATA%\Claude\claude_desktop_config.json; restart Claude Desktop after pasting.">
        <Toggle label="Let Claude Desktop read and change my plan" hint={mcpStatus} checked={dev.mcp.enabled} onChange={(enabled) => run({ type: 'device.update', patch: { mcp: { enabled } } })} />
        <div className="st-actions">
          <Btn onClick={copyConfig} done="Copied"><Icon name="copy" size={14} /> Copy Claude Desktop config</Btn>
        </div>
      </Group>}

      {(can.localFiles || onWeb) && <Group title="Your data" note={`${can.localFiles ? `Data folder: ${snap.dataDir}. ` : ''}Deleted items stay in Trash for ${RECYCLE_DAYS} days, then their content is wiped; a tiny marker remains for 60 days so another device cannot bring them back.`}>
        <div className="st-actions">
          {can.localFiles && <Btn onClick={() => run({ type: 'data.import', source: 'monolith' }).then((r) => { if (r.ok) toast(`Imported ${r.id} tasks from Monolith.`); return r.ok; })}>Import from Monolith</Btn>}
          {can.localFiles && <Btn done="Exported" onClick={() => run({ type: 'data.export' }).then((r) => { if (r.ok) toast('Exported.'); return r.ok; })}>Export JSON</Btn>}
          {can.localFiles && <Btn onClick={() => run({ type: 'data.openFolder' }).then((r) => r.ok)}>Open data folder</Btn>}
        </div>
      </Group>}

      <Group title="About">
        <div className="st-row" style={{ borderBottom: 0, gap: 20 }}>
          <img src={monogram} alt="JY monogram" width={56} height={56} />
          <div className="st-row-text">
            <span className="st-label">Chronos: own your time.</span>
            <span className="st-hint">Version {snap.version}. Built by Josef Yang.</span>
          </div>
        </div>
        <img src={brand} alt="builtbyjosef" height={22} style={{ alignSelf: 'flex-start', margin: '4px 0 8px' }} />
        {desktopOffer && (
          <Row label="Get the desktop app" hint={SMARTSCREEN_NOTE}>
            <Btn onClick={() => api.openLink(api.links.desktopRelease)}>Download for Windows</Btn>
          </Row>
        )}
        {pwa.available && (
          <Row label="Install as an app" hint="Adds Chronos to your home screen or dock, and opens it without browser bars.">
            <Btn onClick={() => pwa.prompt().then(() => true)}>Install</Btn>
          </Row>
        )}
        <div className="st-actions" style={{ paddingTop: 0 }}>
          <Btn done="Copied" onClick={() => navigator.clipboard.writeText(diag).then(() => true, () => { toast('Could not copy.', { error: true }); return false; })}><Icon name="copy" size={14} /> Copy diagnostics</Btn>
        </div>
      </Group>
    </>
  );
}
