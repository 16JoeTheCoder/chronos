// Experimental: the Phase 1 diagnostics, laid out like the rest of Settings. Everything here is for
// finding out why something is wrong; none of it is needed day to day.

import { useState } from 'react';
import { formatHuman } from '../../core/format';
import type { Snapshot } from '../../core/model/types';
import { settingsOf } from '../../core/repo/repo';
import { ask } from '../components/ask';
import { run, toast } from '../store';
import { when } from './AccountSection';
import { Btn, Group, NumField, Toggle, saveSettings } from './rows';

const short = (v: unknown, n = 60) => {
  const t = JSON.stringify(v) ?? 'undefined';
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

export function ExperimentalSection({ snap }: { snap: Snapshot }) {
  const dev = snap.device;
  const s = settingsOf(snap.data);
  const diag = snap.diag;
  const sy = snap.sync;
  const [show, setShow] = useState(false);
  const oldest = sy.oldestPendingAt === null ? null : formatHuman(Math.max(0, Date.now() - sy.oldestPendingAt));
  const cursors = diag ? Object.entries(diag.cursors) : [];

  return (
    <>
      <Group title="Experimental" note="Things for finding out why something went wrong. Safe to leave off.">
        <Toggle label="Show diagnostics" hint="Sync internals, snapshots, conflicts and the Claude token. Per PC." checked={dev.experimental} onChange={(experimental) => run({ type: 'device.update', patch: { experimental } })} />
      </Group>

      {dev.experimental && (
        <>
          <Group title="Time-left maths" note="Variants of how free time is counted. All 0 by default.">
            <NumField label="Ignore free gaps shorter than" value={s.timeLeft.gapFilterMin} min={0} max={240} suffix="min" onCommit={(gapFilterMin) => saveSettings({ timeLeft: { ...s.timeLeft, gapFilterMin } })} />
            <NumField label="Transition after each fixed event" value={s.timeLeft.transitionMin} min={0} max={240} suffix="min" onCommit={(transitionMin) => saveSettings({ timeLeft: { ...s.timeLeft, transitionMin } })} />
            <NumField label="Meal reserve at mid-day" value={s.timeLeft.mealReserveMin} min={0} max={240} suffix="min" onCommit={(mealReserveMin) => saveSettings({ timeLeft: { ...s.timeLeft, mealReserveMin } })} />
          </Group>

          {!diag ? (
            <p className="st-empty" role="status">Loading diagnostics…</p>
          ) : (
            <>
              <Group title="Sync state">
                <dl className="st-kv">
                  <dt>State</dt><dd>{sy.state}{sy.reason ? `: ${sy.reason}` : ''}</dd>
                  <dt>Outbox</dt><dd>{sy.pending > 0 ? `${sy.pending} waiting${oldest ? `, oldest ${oldest} old` : ''}` : 'Empty'}</dd>
                  <dt>Last sync</dt><dd>{when(sy.lastSyncAt)}</dd>
                  {cursors.map(([k, v]) => <Cursor key={k} k={k} v={Number(v)} />)}
                </dl>
                <div className="st-actions">
                  <Btn
                    variant="danger"
                    onClick={() => ask({
                      title: 'Force resync?',
                      body: 'Chronos snapshots your data, then downloads everything from the cloud again and merges it. Changes waiting to upload are kept.',
                      actions: [{ label: 'Force resync', primary: true, run: () => void run({ type: 'sync.forceResync' }) }],
                    })}
                  >Force resync</Btn>
                </div>
              </Group>

              <Group title="Snapshots" note="Chronos snapshots before risky steps. Restoring snapshots the current data first.">
                {diag.snapshots.length === 0 && <p className="st-empty">No snapshots yet.</p>}
                <div className="st-list">
                  {diag.snapshots.map((name) => (
                    <div className="st-item" key={name}>
                      <div className="st-item-main"><code className="st-code">{name}</code></div>
                      <Btn onClick={() => ask({
                        title: `Restore ${name}?`,
                        body: `Restore ${name}? The current data is snapshotted first.`,
                        actions: [{ label: 'Restore', primary: true, run: () => void run({ type: 'snapshot.restore', name }) }],
                      })}>Restore</Btn>
                    </div>
                  ))}
                </div>
              </Group>

              <Group title={`Conflicts (${diag.conflicts.length})`} note="The same field edited on two PCs. The edit waiting on this PC won; this is what it overwrote.">
                {diag.conflicts.length === 0 && <p className="st-empty">None.</p>}
                <div className="st-list">
                  {diag.conflicts.map((c, i) => (
                    <div className="st-item" key={`${c.at}-${i}`}>
                      <div className="st-item-main">
                        <span className="st-item-title">{c.coll}/{c.id} · {c.field}</span>
                        <span className="st-item-sub">{when(c.at)} · device {c.otherDeviceId}</span>
                        <span className="st-code">{short(c.overwrittenValue)} → {short(c.newValue)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {diag.conflicts.length > 0 && <div className="st-actions"><Btn done="Cleared" onClick={() => run({ type: 'diag.clear', what: 'conflicts' }).then((r) => r.ok)}>Clear conflicts</Btn></div>}
              </Group>

              <Group title={`Quarantine (${diag.quarantine.length})`} note="Records from the cloud that failed validation. They are never merged or shown.">
                {diag.quarantine.length === 0 && <p className="st-empty">None.</p>}
                <div className="st-list">
                  {diag.quarantine.map((q, i) => (
                    <div className="st-item" key={`${q.at}-${i}`}>
                      <div className="st-item-main">
                        <span className="st-item-title">{q.coll}/{q.id}</span>
                        <span className="st-item-sub">{when(q.at)}</span>
                        <span className="st-code">{q.reason}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {diag.quarantine.length > 0 && <div className="st-actions"><Btn done="Cleared" onClick={() => run({ type: 'diag.clear', what: 'quarantine' }).then((r) => r.ok)}>Clear quarantine</Btn></div>}
              </Group>

              <Group title="Claude (MCP)">
                <dl className="st-kv">
                  <dt>Status</dt><dd>{diag.mcp.error ? `Error: ${diag.mcp.error}` : diag.mcp.running ? 'Running' : diag.mcp.enabled ? 'Starting' : 'Off'}</dd>
                  <dt>Port</dt><dd>{diag.mcp.port}</dd>
                  <dt>Token</dt><dd className="st-code">{show ? diag.mcp.token : '•'.repeat(16)}</dd>
                </dl>
                <div className="st-actions">
                  <Btn onClick={() => { setShow((v) => !v); }}>{show ? 'Hide token' : 'Show token'}</Btn>
                  <Btn done="New token" onClick={() => run({ type: 'mcp.regenerateToken' }).then((r) => r.ok)}>Regenerate token</Btn>
                  <Btn done="Exported" onClick={() => run({ type: 'diag.exportLog' }).then((r) => { if (r.ok) toast('Log exported.'); return r.ok; })}>Export log</Btn>
                </div>
              </Group>
            </>
          )}
        </>
      )}
    </>
  );
}

function Cursor({ k, v }: { k: string; v: number }) {
  return (
    <>
      <dt>Cursor {k}</dt>
      <dd>{v}</dd>
    </>
  );
}
