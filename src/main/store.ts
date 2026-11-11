// Persistence. Takes a directory instead of calling app.getPath, so it runs in
// tests without Electron. Writes are crash-safe (Monolith's procedure): write
// .tmp, fsync, keep the previous file as .bak, rename .tmp over the real file
// (atomic on NTFS and ext4). A corrupt main file falls back to .bak.
// Synced data and device-local settings live in separate files; the sync outbox,
// conflict log and quarantine list each have their own small file, and a daily
// snapshot of the data is kept for 7 days in snapshots\.

import fs from 'node:fs';
import path from 'node:path';

/** The storage seam: a SQLite adapter can replace JsonFile later (D-004). */
export interface Persistence {
  load(): unknown;
  save(value: unknown): void;
}

export class JsonFile implements Persistence {
  readonly bak: string;
  readonly tmp: string;

  constructor(readonly file: string) {
    this.bak = `${file}.bak`;
    this.tmp = `${file}.tmp`;
  }

  /** The main file, else the backup, else null. */
  load(): unknown {
    for (const f of [this.file, this.bak]) {
      try {
        return JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch {
        // missing or corrupt: try the next one
      }
    }
    return null;
  }

  save(value: unknown): void {
    writeDurable(this.tmp, JSON.stringify(value));
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.bak);
    fs.renameSync(this.tmp, this.file);
  }
}

export const SNAPSHOT_KEEP = 7;
const SNAPSHOT_RE = /^chronos-(\d{4}-\d{2}-\d{2}|before-[\w-]+)\.json$/;

export class Store {
  readonly data: JsonFile;
  readonly device: JsonFile;
  readonly outbox: JsonFile;
  readonly conflicts: JsonFile;
  readonly quarantine: JsonFile;
  readonly heartbeatFile: string;
  readonly snapshotDir: string;

  constructor(readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.data = new JsonFile(path.join(dir, 'chronos-data.json'));
    this.device = new JsonFile(path.join(dir, 'device.json'));
    this.outbox = new JsonFile(path.join(dir, 'outbox.json'));
    this.conflicts = new JsonFile(path.join(dir, 'conflicts.json'));
    this.quarantine = new JsonFile(path.join(dir, 'quarantine.json'));
    this.heartbeatFile = path.join(dir, 'heartbeat');
    this.snapshotDir = path.join(dir, 'snapshots');
  }

  /** Snapshot names, newest first. */
  listSnapshots(): string[] {
    try {
      const mtime = (f: string) => fs.statSync(path.join(this.snapshotDir, f)).mtimeMs;
      return fs
        .readdirSync(this.snapshotDir)
        .filter((f) => SNAPSHOT_RE.test(f))
        .sort((a, b) => mtime(b) - mtime(a) || (a < b ? 1 : -1));
    } catch {
      return [];
    }
  }

  /** Write snapshots\chronos-<date>.json (or `-<stamp>` for a manual one) and keep the newest 7 daily ones. */
  writeSnapshot(value: unknown, name: string): string {
    fs.mkdirSync(this.snapshotDir, { recursive: true });
    const file = path.join(this.snapshotDir, name);
    writeDurable(`${file}.tmp`, JSON.stringify(value));
    fs.renameSync(`${file}.tmp`, file);
    for (const old of this.listSnapshots().slice(SNAPSHOT_KEEP)) fs.rmSync(path.join(this.snapshotDir, old), { force: true });
    return name;
  }

  hasSnapshot(date: string): boolean {
    return fs.existsSync(path.join(this.snapshotDir, `chronos-${date}.json`));
  }

  readSnapshot(name: string): unknown {
    if (!SNAPSHOT_RE.test(name)) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(this.snapshotDir, name), 'utf8'));
    } catch {
      return null;
    }
  }

  writeHeartbeat(now: number): void {
    try {
      writeDurable(this.heartbeatFile, String(now));
    } catch {
      // A missed heartbeat only makes recovery slightly more conservative.
    }
  }

  readHeartbeat(): number | null {
    try {
      const n = Number(fs.readFileSync(this.heartbeatFile, 'utf8'));
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  }
}

function writeDurable(file: string, text: string): void {
  const fd = fs.openSync(file, 'w');
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
