const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dualChat', {
  setAlwaysOnTop: (v) => ipcRenderer.invoke('set-always-on-top', v),
  setOpacity: (v) => ipcRenderer.invoke('set-opacity', v),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  logoutAll: () => ipcRenderer.invoke('logout-all'),
  measureDelay: (args) => ipcRenderer.invoke('measure-delay', args),
  checkUpdates: () => ipcRenderer.invoke('update-check'),
  getUpdateStatus: () => ipcRenderer.invoke('update-status'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  sendReport: (r) => ipcRenderer.invoke('report-send', r),
  myReports: (token) => ipcRenderer.invoke('report-mine', token),
  setReportStatus: (pw, id, status, note) => ipcRenderer.invoke('report-set-status', { password: pw, id, status, note }),
  reportIsAdmin: (pw) => ipcRenderer.invoke('report-is-admin', pw),
  listReports: (pw) => ipcRenderer.invoke('report-list', pw),
  deleteReport: (pw, id) => ipcRenderer.invoke('report-delete', { password: pw, id }),
  onUpdate: (cb) => ipcRenderer.on('update-status', (_e, s) => cb(s)),
});
