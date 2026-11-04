const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dualChat', {
  setAlwaysOnTop: (v) => ipcRenderer.invoke('set-always-on-top', v),
  setOpacity: (v) => ipcRenderer.invoke('set-opacity', v),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  logoutAll: () => ipcRenderer.invoke('logout-all'),
});
