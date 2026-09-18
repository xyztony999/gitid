'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 渲染层唯一桥：全部走 invoke，返回 {ok, data|error}
contextBridge.exposeInMainWorld('gitid', {
  getFlags: () => ({ tab: process.env.GITID_TAB || '', scanRoot: process.env.GITID_SCAN_ROOT || '' }),
  getStore: () => ipcRenderer.invoke('store:get'),
  saveIdentity: (id, fields) => ipcRenderer.invoke('identity:save', id, fields),
  removeIdentity: (id) => ipcRenderer.invoke('identity:remove', id),
  applyGlobal: (id) => ipcRenderer.invoke('identity:applyGlobal', id),
  applyLocal: (repo, id) => ipcRenderer.invoke('identity:applyLocal', repo, id),
  unsetLocal: (repo) => ipcRenderer.invoke('identity:unsetLocal', repo),
  importGlobal: () => ipcRenderer.invoke('identity:importGlobal'),
  scan: (root, depth) => ipcRenderer.invoke('repo:scan', root, depth),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
  onStoreUpdated: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('store-updated', listener);
    return () => ipcRenderer.removeListener('store-updated', listener);
  },
});
