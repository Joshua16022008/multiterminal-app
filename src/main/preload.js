'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('deck', {
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    add: () => ipcRenderer.invoke('projects:add'),
    rename: (id, name) => ipcRenderer.invoke('projects:rename', id, name),
    remove: (id) => ipcRenderer.invoke('projects:remove', id),
  },
  presets: {
    list: () => ipcRenderer.invoke('presets:list'),
    add: (preset) => ipcRenderer.invoke('presets:add', preset),
    remove: (id) => ipcRenderer.invoke('presets:remove', id),
  },
  terminals: {
    create: (options) => ipcRenderer.invoke('terminals:create', options),
    write: (id, data) => ipcRenderer.send('terminals:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('terminals:resize', id, cols, rows),
    kill: (id) => ipcRenderer.invoke('terminals:kill', id),
    onData: (callback) => subscribe('terminals:data', callback),
    onExit: (callback) => subscribe('terminals:exit', callback),
  },
  session: {
    load: () => ipcRenderer.invoke('session:load'),
    save: (session) => ipcRenderer.invoke('session:save', session),
    saveScrollback: (terminalId, text) => ipcRenderer.invoke('session:saveScrollback', terminalId, text),
    loadScrollback: (terminalId) => ipcRenderer.invoke('session:loadScrollback', terminalId),
    deleteScrollback: (terminalId) => ipcRenderer.invoke('session:deleteScrollback', terminalId),
  },
  progress: {
    open: (projectId) => ipcRenderer.invoke('progress:open', projectId),
    read: (projectId) => ipcRenderer.invoke('progress:read', projectId),
    saveSnapshot: (projectId, title, text) => ipcRenderer.invoke('progress:saveSnapshot', projectId, title, text),
  },
  onMenu: (callback) => subscribe('menu:action', callback),
  onBeforeQuit: (callback) => subscribe('app:before-quit', callback),
  quitReady: () => ipcRenderer.send('app:quit-ready'),
});
