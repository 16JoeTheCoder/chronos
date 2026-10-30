// Persistence. Takes a directory instead of calling app.getPath, so it runs in
// tests without Electron. Writes are crash-safe (Monolith's procedure): write
// .tmp, fsync, keep the previous file as .bak, rename .tmp over the real file
// (atomic on NTFS and ext4). A corrupt main file falls back to .bak.
// Synced data and device-local settings live in separate files.

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

export class Store {
  readonly data: JsonFile;
  readonly device: JsonFile;
  readonly heartbeatFile: string;

  constructor(readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.data = new JsonFile(path.join(dir, 'chronos-data.json'));
    this.device = new JsonFile(path.join(dir, 'device.json'));
    this.heartbeatFile = path.join(dir, 'heartbeat');
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
