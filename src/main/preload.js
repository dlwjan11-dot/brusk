'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch, fn) => { const l = (_e, d) => fn(d); ipcRenderer.on(ch, l); return () => ipcRenderer.removeListener(ch, l); };

contextBridge.exposeInMainWorld('barq', {
  state: () => invoke('state'),
  getSettings: () => invoke('settings:get'),
  setSettings: p => invoke('settings:set', p),
  inspect: (url, captureId) => invoke('inspect', url, captureId),
  torrentInfo: (src, key) => invoke('torrent:info', src, key),
  cancelTorrentInfo: key => invoke('torrent:cancel', key),
  add: items => invoke('add', items),
  control: (id, action, opts) => invoke('control', id, action, opts),
  bulk: (action, ids) => invoke('bulk', action, ids),
  open: id => invoke('open', id),
  reveal: id => invoke('reveal', id),
  openFolder: dir => invoke('openFolder', dir),
  chooseFolder: def => invoke('chooseFolder', def),
  chooseTorrent: () => invoke('chooseTorrent'),
  sha256: id => invoke('sha256', id),
  copy: text => invoke('copy', text),
  toolsStatus: () => invoke('tools:status'),
  updateTool: name => invoke('tools:update', name),
  openExtensionFolder: () => invoke('extension:open'),
  browsers: () => invoke('browsers'),
  bridgeStatus: () => invoke('bridge:status'),
  bridgeRetry: () => invoke('bridge:retry'),
  forgetBrowser: id => invoke('browsers:forget', id),
  setMagnetDefault: () => invoke('magnet:default'),
  cancelAfter: () => invoke('after:cancel'),
  afterNow: a => invoke('after:now', a),
  openExternal: url => invoke('openExternal', url),
  filePath: file => webUtils.getPathForFile(file),
  platform: process.platform,
  on,
});
