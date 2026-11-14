// Preload (sandboxed): exposes window.chronos and nothing else. The renderer
// never sees ipcRenderer itself, only these typed wrappers.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CHANNELS, type ChronosApi } from './api';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: ChronosApi = {
  getSnapshot: () => ipcRenderer.invoke(CHANNELS.getSnapshot),
  onSnapshot: (cb) => subscribe(CHANNELS.snapshot, cb),
  onBeep: (cb) => subscribe<void>(CHANNELS.beep, () => cb()),
  onShow: (cb) => subscribe(CHANNELS.show, cb),
  onNotice: (cb) => subscribe(CHANNELS.notice, cb),
  command: (cmd) => ipcRenderer.invoke(CHANNELS.command, cmd),
  undo: (token) => ipcRenderer.invoke(CHANNELS.undo, token),
  win: {
    hide: () => ipcRenderer.send(CHANNELS.hide),
    showHome: (view) => ipcRenderer.send(CHANNELS.showHome, view ?? null),
    overlayClick: () => ipcRenderer.send(CHANNELS.overlayClick),
    overlayExpand: (on) => ipcRenderer.send(CHANNELS.overlayExpand, on),
    closeNotepad: (created) => ipcRenderer.send(CHANNELS.closeNotepad, created ?? null),
    closePalette: () => ipcRenderer.send(CHANNELS.closePalette),
    notify: (text, undoToken) => ipcRenderer.send(CHANNELS.notify, text, undoToken),
    onOpen: (cb) => subscribe<void>(CHANNELS.open, () => cb()),
    quit: () => ipcRenderer.send(CHANNELS.quit),
    restart: (reason) => ipcRenderer.send(CHANNELS.restart, reason),
    mark: (name, ms) => ipcRenderer.send(CHANNELS.mark, name, ms),
  },
  palette: { askClaude: (text) => ipcRenderer.invoke(CHANNELS.askClaude, text) },
  shelf: {
    list: () => ipcRenderer.invoke(CHANNELS.stackList),
    open: (path) => ipcRenderer.invoke(CHANNELS.stackOpen, path),
    trash: (path) => ipcRenderer.invoke(CHANNELS.stackTrash, path),
    onChange: (cb) => subscribe<void>(CHANNELS.stackChanged, () => cb()),
  },
};

contextBridge.exposeInMainWorld('chronos', api);
