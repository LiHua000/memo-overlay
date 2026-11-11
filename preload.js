'use strict';

/* 渲染层与主进程之间的最小权限桥接 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('memo', {
  loadCache: () => ipcRenderer.invoke('cache:load'),
  saveCache: (text) => ipcRenderer.invoke('cache:save', text),
  saveCacheSync: (text) => ipcRenderer.sendSync('cache:save-sync', text),
  clearCache: () => ipcRenderer.invoke('cache:clear'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  patchSettings: (patch) => ipcRenderer.invoke('settings:patch', patch),

  hide: () => ipcRenderer.send('window:hide'),
  activate: () => ipcRenderer.send('window:activate'),
  collapse: () => ipcRenderer.send('window:collapse'),
  expand: () => ipcRenderer.send('window:expand'),
  resizeBy: (dx, dy) => ipcRenderer.send('window:resize-by', { dx, dy }),
  dragStart: (x, y) => ipcRenderer.send('window:drag-start', { x, y }),
  dragMove: (x, y) => ipcRenderer.send('window:drag-move', { x, y }),
  dragEnd: (x, y) => ipcRenderer.send('window:drag-end', { x, y }),

  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  openCacheDir: () => ipcRenderer.invoke('shell:open-cache-dir'),

  ready: () => ipcRenderer.send('app:ready'),
  quit: () => ipcRenderer.send('app:quit'),

  onEdgeState: (callback) => ipcRenderer.on('edge:state', (_event, state) => callback(state)),
  onFocusEditor: (callback) => ipcRenderer.on('app:focus-editor', () => callback()),
  onClear: (callback) => ipcRenderer.on('app:clear', () => callback()),
  onSettings: (callback) => ipcRenderer.on('settings:changed', (_event, settings) => callback(settings)),
});
