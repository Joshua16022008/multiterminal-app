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
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    add: (provider, label) => ipcRenderer.invoke('accounts:add', provider, label),
    rename: (id, label) => ipcRenderer.invoke('accounts:rename', id, label),
    setActive: (provider, id) => ipcRenderer.invoke('accounts:setActive', provider, id),
    remove: (id) => ipcRenderer.invoke('accounts:remove', id),
    loginCommand: (provider) => ipcRenderer.invoke('accounts:loginCommand', provider),
  },
  usage: {
    list: () => ipcRenderer.invoke('usage:list'),
    claudeStatus: () => ipcRenderer.invoke('usage:claudeStatus'),
    claudeEnable: () => ipcRenderer.invoke('usage:claudeEnable'),
    claudeDisable: () => ipcRenderer.invoke('usage:claudeDisable'),
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
  github: {
    status: () => ipcRenderer.invoke('github:status'),
    listRepos: () => ipcRenderer.invoke('github:listRepos'),
    clone: (nameWithOwner) => ipcRenderer.invoke('github:clone', nameWithOwner),
  },
  git: {
    status: (projectId) => ipcRenderer.invoke('git:status', projectId),
    pull: (projectId) => ipcRenderer.invoke('git:pull', projectId),
    sync: (projectId) => ipcRenderer.invoke('git:sync', projectId),
  },
  dictation: {
    start: (terminalId, live) => ipcRenderer.invoke('dictation:start', terminalId, live),
    stop: () => ipcRenderer.invoke('dictation:stop'),
    cancel: () => ipcRenderer.invoke('dictation:cancel'),
    onEvent: (callback) => subscribe('dictation:event', callback),
  },
  onMenu: (callback) => subscribe('menu:action', callback),
  onBeforeQuit: (callback) => subscribe('app:before-quit', callback),
  quitReady: () => ipcRenderer.send('app:quit-ready'),
});
