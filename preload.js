const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desk', {
  state: () => ipcRenderer.invoke('state'),
  act: (type, payload) => ipcRenderer.invoke('act', type, payload),
  intel: force => ipcRenderer.invoke('intel', !!force),
  open: url => ipcRenderer.invoke('open', url),
  openDir: which => ipcRenderer.invoke('openDir', which),
  pathImages: () => ipcRenderer.invoke('pathImages'),
  pick: () => ipcRenderer.invoke('pick'),
  exportCsv: () => ipcRenderer.invoke('export'),
  agent: () => ipcRenderer.invoke('agent'),
  mode: () => ipcRenderer.invoke('mode'),
  hide: () => ipcRenderer.invoke('hide'),
  quit: () => ipcRenderer.invoke('quit'),
  onState: cb => ipcRenderer.on('state', (_e, s) => cb(s))
});
