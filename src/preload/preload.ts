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
  command: (cmd) => ipcRenderer.invoke(CHANNELS.command, cmd),
  win: {
    hide: () => ipcRenderer.send(CHANNELS.hide),
    widgetClick: () => ipcRenderer.send(CHANNELS.widgetClick),
    widgetMenu: () => ipcRenderer.send(CHANNELS.widgetMenu),
    dragStart: () => ipcRenderer.send(CHANNELS.dragStart),
    dragEnd: () => ipcRenderer.invoke(CHANNELS.dragEnd),
    closeCapture: () => ipcRenderer.send(CHANNELS.closeCapture),
    quit: () => ipcRenderer.send(CHANNELS.quit),
    restart: (reason) => ipcRenderer.send(CHANNELS.restart, reason),
    mark: (name, ms) => ipcRenderer.send(CHANNELS.mark, name, ms),
  },
  shelf: {
    list: () => ipcRenderer.invoke(CHANNELS.stackList),
    open: (path) => ipcRenderer.invoke(CHANNELS.stackOpen, path),
    trash: (path) => ipcRenderer.invoke(CHANNELS.stackTrash, path),
    onChange: (cb) => subscribe<void>(CHANNELS.stackChanged, () => cb()),
  },
};

contextBridge.exposeInMainWorld('chronos', api);
