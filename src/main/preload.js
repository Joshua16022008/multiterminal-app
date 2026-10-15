'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('deck', {
  hotkeys: {
    get: () => ipcRenderer.invoke('hotkeys:get'),
    save: bindings => ipcRenderer.invoke('hotkeys:save', bindings),
    capture: enabled => ipcRenderer.invoke('hotkeys:capture', enabled),
    onChange: callback => subscribe('hotkeys:changed', callback),
  },
  agents: {
    list: () => ipcRenderer.invoke('agents:list'),
    onChange: callback => subscribe('agents:changed', callback),
    onJump: callback => subscribe('agents:jump', callback),
    markRead: id => ipcRenderer.invoke('agents:markRead', id),
    markAllRead: () => ipcRenderer.invoke('agents:markAllRead'),
    getSettings: () => ipcRenderer.invoke('agents:getSettings'),
    setSettings: patch => ipcRenderer.invoke('agents:setSettings', patch),
    reportVisible: id => ipcRenderer.send('agents:reportVisible', id),
    userInput: id => ipcRenderer.send('agents:userInput', id),
  },
  ports: {
    list: () => ipcRenderer.invoke('ports:list'),
    resolve: id => ipcRenderer.invoke('ports:resolve', id),
  },
  attachments: {
    pathForFile: file => webUtils.getPathForFile(file),
    pickFiles: () => ipcRenderer.invoke('attachments:pickFiles'),
    validateFiles: files => ipcRenderer.invoke('attachments:validateFiles', files),
    saveImage: bytes => ipcRenderer.invoke('attachments:saveImage', bytes),
    clipboardImage: () => ipcRenderer.invoke('attachments:clipboardImage'),
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    add: () => ipcRenderer.invoke('projects:add'),
    createDraft: name => ipcRenderer.invoke('projects:createDraft', name),
    publish: id => ipcRenderer.invoke('projects:publish', id),
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
  settings: {
    overview: (projectId) => ipcRenderer.invoke('settings:overview', projectId),
    readProfile: (scope) => ipcRenderer.invoke('settings:readProfile', scope),
    saveProfile: (scope, text, revision) => ipcRenderer.invoke('settings:saveProfile', scope, text, revision),
    setLoadAtStart: (scope, enabled) => ipcRenderer.invoke('settings:setLoadAtStart', scope, enabled),
    assignSkill: (provider, id) => ipcRenderer.invoke('settings:assignSkill', provider, id),
    unassignSkill: (provider, name) => ipcRenderer.invoke('settings:unassignSkill', provider, name),
    readResource: (id) => ipcRenderer.invoke('settings:readResource', id),
    openFolder: (scope) => ipcRenderer.invoke('settings:openFolder', scope),
    reveal: (id) => ipcRenderer.invoke('settings:reveal', id),
  },
  terminals: {
    create: (options) => ipcRenderer.invoke('terminals:create', options),
    write: (id, data) => ipcRenderer.send('terminals:write', id, data),
    runBuiltin: (id, command) => ipcRenderer.send('terminals:runBuiltin', id, command),
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
  worktrees: {
    list: (projectId) => ipcRenderer.invoke('worktrees:list', projectId),
    create: (projectId, options) => ipcRenderer.invoke('worktrees:create', projectId, options),
    inspect: (workspaceId) => ipcRenderer.invoke('worktrees:inspect', workspaceId),
    remove: (workspaceId) => ipcRenderer.invoke('worktrees:remove', workspaceId),
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
  // Agent control of the mini browser (mt-browser): the main process asks, the page answers.
  browser: {
    onRequest: (callback) => subscribe('browser:request', callback),
    respond: (reqId, response) => ipcRenderer.send('browser:response', reqId, response),
    // F05: Elementauswahl im Mini-Browser der eigenen Kachel
    pick: terminalId => ipcRenderer.invoke('browser:pick', terminalId),
    pickCancel: terminalId => ipcRenderer.invoke('browser:pickCancel', terminalId),
  },
  onMenu: (callback) => subscribe('menu:action', callback),
  onBeforeQuit: (callback) => subscribe('app:before-quit', callback),
  quitReady: () => ipcRenderer.send('app:quit-ready'),
});
