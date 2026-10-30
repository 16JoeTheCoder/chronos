// Desktop shelf (§8.7) and Recycle Bin (§8.8). Lists the real Desktop folder
// (app.getPath('desktop') follows OneDrive redirection) or the folder chosen in
// Settings. Read-only: Chronos never moves or renames files; the one file action
// is shell.trashItem (the Windows Recycle Bin, never a permanent delete), after
// the renderer has asked for confirmation. Paths from the renderer must resolve
// to a direct child of the shelf folder.

import fs from 'node:fs';
import path from 'node:path';
import { app, shell } from 'electron';
import type { Result } from '../core/commands';
import type { ShelfItem } from '../core/model/types';
import { log } from './log';

const MAX_ITEMS = 300;
const HIDDEN = new Set(['desktop.ini', 'thumbs.db']);

export class Shelf {
  private watcher: fs.FSWatcher | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private watchedDir = '';

  constructor(private folder: () => string, private onChange: () => void) {}

  static defaultFolder(override: string | null): string {
    return override && fs.existsSync(override) ? override : app.getPath('desktop');
  }

  async list(): Promise<ShelfItem[]> {
    const dir = this.folder();
    this.watch(dir);
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (e) {
      log(`shelf readdir failed: ${String(e)}`);
      return [];
    }
    const visible = entries.filter((e) => !e.name.startsWith('.') && !HIDDEN.has(e.name.toLowerCase())).slice(0, MAX_ITEMS);
    return Promise.all(
      visible.map(async (e): Promise<ShelfItem> => {
        const p = path.join(dir, e.name);
        const icon = await app.getFileIcon(p, { size: 'normal' }).then((img) => img.toDataURL(), () => null);
        return { name: e.name, path: p, isDir: e.isDirectory(), icon };
      }),
    ).then((items) => items.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name)));
  }

  async open(p: string): Promise<Result> {
    const file = this.resolve(p);
    if (!file) return { ok: false, error: 'That file is not on the shelf.' };
    const err = await shell.openPath(file);
    return err ? { ok: false, error: err } : { ok: true };
  }

  async trash(p: string): Promise<Result> {
    const file = this.resolve(p);
    if (!file) return { ok: false, error: 'That file is not on the shelf.' };
    try {
      await shell.trashItem(file);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `Could not move it to the Recycle Bin: ${String(e)}` };
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  private resolve(p: string): string | null {
    const dir = path.resolve(this.folder());
    const file = path.resolve(p);
    return path.dirname(file) === dir && fs.existsSync(file) ? file : null;
  }

  private watch(dir: string): void {
    if (this.watcher && this.watchedDir === dir) return;
    this.stop();
    this.watchedDir = dir;
    try {
      this.watcher = fs.watch(dir, () => {
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(this.onChange, 300);
      });
    } catch (e) {
      log(`shelf watch failed: ${String(e)}`);
    }
  }
}
