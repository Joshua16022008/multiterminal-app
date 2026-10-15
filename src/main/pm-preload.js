'use strict';

// PM: Preload des Projektmanager-Fensters. Die projectId kommt aus der URL; der Hauptprozess
// ordnet sie zusätzlich selbst dem Fenster zu und vertraut dem Renderer nicht blind.
const { contextBridge, ipcRenderer } = require('electron');

const projectId = new URLSearchParams(location.search).get('project') || '';

function subscribe(channel, callback) {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('pm', {
  projectId,
  start: (cols, rows) => ipcRenderer.invoke('pm:start', projectId, cols, rows),
  write: data => ipcRenderer.send('pm:write', projectId, data),
  resize: (cols, rows) => ipcRenderer.send('pm:resize', projectId, cols, rows),
  restart: () => ipcRenderer.invoke('pm:restart', projectId),
  state: () => ipcRenderer.invoke('pm:state', projectId),
  onData: callback => subscribe('pm:data', callback),
  onExit: callback => subscribe('pm:exit', callback),
});
