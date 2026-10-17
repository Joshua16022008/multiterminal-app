'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_BYTES = 2 * 1024 * 1024;
const FINISHED = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const STATES = ['queued', 'running', ...FINISHED];
const DEFAULT_GRANT = {
  enabled: false, allowNew: false, maxNewWorkers: 2
};
const clone = (v) => JSON.parse(JSON.stringify(v));
function fail(message) {
  throw new Error(`Agent-Aufgaben: ${message}`);
}
function keys(v, allowed) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v)) || Object.keys(v).some(k => !allowed.includes(k))) fail('Ungültige Felder.');
}
function str(v, max, label, empty = false) {
  if (typeof v !== 'string' || v.length > max || v.includes('\0') || (!empty && !v.trim())) fail(`Ungültiger Text: ${label} (maximal ${max} Zeichen).`);
  return v;
}
function id(v) {
  str(v, 128, 'ID');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(v) || ['constructor', 'prototype', '__proto__'].includes(v)) fail('Ungültige ID.');
  return v;
}
function grant(v) {
  keys(v, Object.keys(DEFAULT_GRANT));
  if (typeof v.enabled !== 'boolean' || typeof v.allowNew !== 'boolean' || !Number.isInteger(v.maxNewWorkers) || v.maxNewWorkers < 1 || v.maxNewWorkers > 4) fail('Ungültige Freigabe.');
}
function validate(s) {
  keys(s, ['version', 'tasks', 'grants']);
  if (s.version !== 1 || !Array.isArray(s.tasks) || s.tasks.length > 500) fail('Ungültiger Aufgabenspeicher.');
  keys(s.grants, Object.keys(s.grants || {}));
  for (const [project, grants] of Object.entries(s.grants)) {
    id(project);
    keys(grants, Object.keys(grants));
    for (const [terminal, g] of Object.entries(grants)) {
      id(terminal);
      grant(g);
    }
  }
  const seen = new Map();
  const requests = new Set();
  for (const t of s.tasks) {
    keys(t, ['id','projectId','rootId','parentId','grantOwnerId','sourceTerminalId','targetTerminalId','targetProvider','newWorker','title','text','status','dependsOn','depth','createdAt','result','delivery','requestId','requestFingerprint','maxNewWorkers']);
    for (const k of ['id','projectId','rootId','grantOwnerId','sourceTerminalId','targetTerminalId','requestId']) id(t[k]);
    if (seen.has(t.id)) fail('Doppelte Aufgaben-ID.');
    const requestKey = JSON.stringify([t.projectId,t.sourceTerminalId,t.requestId]);
    if (requests.has(requestKey)) fail('Doppelte Anfrage-ID.');
    requests.add(requestKey);
    if (t.sourceTerminalId === t.targetTerminalId) fail('Aufgabe an dasselbe Terminal ist nicht erlaubt.');
    if (t.parentId !== null) id(t.parentId);
    str(t.title,160,'Titel');
    str(t.text,3000,'Aufgabe');
    if (typeof t.newWorker !== 'boolean' || !STATES.includes(t.status) || !Number.isInteger(t.depth) || t.depth < 0 || t.depth > 3 || !Number.isInteger(t.maxNewWorkers) || t.maxNewWorkers < 1 || t.maxNewWorkers > 4) fail('Ungültiger Aufgabenstatus.');
    if (t.targetProvider !== null && !['claude','codex','kimi','shell'].includes(t.targetProvider)) fail('Ungültiger Anbieter.');
    if (t.newWorker && !['claude','codex'].includes(t.targetProvider)) fail('Ungültiger Worker.');
    if (typeof t.createdAt !== 'string' || t.createdAt.length > 32 || !Number.isFinite(Date.parse(t.createdAt))) fail('Ungültiger Zeitpunkt.');
    if (typeof t.requestFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(t.requestFingerprint)) fail('Ungültiger Anfragebeleg.');
    if (!Array.isArray(t.dependsOn) || t.dependsOn.length > 5 || new Set(t.dependsOn).size !== t.dependsOn.length) fail('Ungültige Abhängigkeiten.');
    for (const dep of t.dependsOn) {
      id(dep);
      const d = seen.get(dep);
      if (!d || d.projectId !== t.projectId || d.rootId !== t.rootId) fail('Ungültiger Abhängigkeitsbaum.');
    }
    if (t.parentId) {
      const p = seen.get(t.parentId);
      if (!p || p.projectId !== t.projectId || p.rootId !== t.rootId || t.depth !== p.depth + 1 || t.grantOwnerId !== p.grantOwnerId || t.maxNewWorkers !== p.maxNewWorkers || t.sourceTerminalId !== p.targetTerminalId) fail('Ungültiger Aufgabenbaum.');
    } else if (t.rootId !== t.id || t.depth !== 0 || t.grantOwnerId !== t.sourceTerminalId) fail('Ungültige Wurzelaufgabe.');
    keys(t.delivery, ['state','error','workspaceId']);
    if (!['inbox','pending','preparing','launched','failed'].includes(t.delivery.state)) fail('Ungültige Zustellung.');
    if (t.delivery.error !== undefined) str(t.delivery.error,2000,'Zustellfehler',true);
    if (t.delivery.workspaceId !== undefined) id(t.delivery.workspaceId);
    if (t.result !== null) {
      keys(t.result,['status','text','createdAt']);
      if (!['completed','failed'].includes(t.result.status) || t.result.status !== t.status) fail('Ungültiges Ergebnis.');
      str(t.result.text,16000,'Ergebnis',true);
      str(t.result.createdAt,32,'Zeitpunkt');
      if (!Number.isFinite(Date.parse(t.result.createdAt))) fail('Ungültiger Ergebniszeitpunkt.');
    }
    if (['completed','failed'].includes(t.status) && !t.result) fail('Ergebnis fehlt.');
    seen.set(t.id,t);
  }
  for (const parent of s.tasks) if (s.tasks.filter(t => t.parentId === parent.id && !FINISHED.has(t.status)).length > 3) fail('Zu viele aktive Unteraufgaben.');
  for (const root of s.tasks.filter(t => !t.parentId)) {
    const tree = s.tasks.filter(t => t.rootId === root.id);
    if (tree.length > 20 || tree.filter(t => t.newWorker).length > root.maxNewWorkers) fail('Aufgabenlimit überschritten.');
  }
}
function createAgentTaskService({
  dataDir, getTerminal, listTerminals, onChanged = () => {}, now = () => new Date(), randomId = () => crypto.randomUUID(), isGrantRevoked = () => false
}) {
  const dir = path.join(dataDir,'agent-tasks');
  const file = path.join(dir,'tasks.json');
  function safeDir() {
    if (fs.lstatSync(dir).isSymbolicLink() || !fs.lstatSync(dir).isDirectory()) fail('Speicherordner ist ungültig.');
  }
  function read() {
    let fd;
    try {
      safeDir();
      fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_BYTES) fail('Speicherdatei ist ungültig oder zu groß.');
      // Read at most MAX_BYTES + 1 even if an external writer grows the file.
      const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_BYTES + 1));
      const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
      if (count > MAX_BYTES || count !== stat.size) fail('Speicherdatei wurde während des Lesens geändert.');
      const state = JSON.parse(buffer.subarray(0, count).toString('utf8'));
      validate(state);
      return state;
    } catch (error) {
      fail(error.code === 'ELOOP' ? 'Speicherdatei ist ein Link.' : `Speicher nicht lesbar: ${error.message}`);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  function write(state) {
    validate(state);
    const body = JSON.stringify(state);
    if (Buffer.byteLength(body) > MAX_BYTES) fail('Speicherlimit von 2 MiB erreicht.');
    safeDir();
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) fail('Speicherdatei ist ein Link.');
    const temporary = path.join(dir, `.tasks-${crypto.randomUUID()}.tmp`);
    let fd;
    try {
      fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      fs.writeFileSync(fd, body);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, file);
    } catch (error) {
      if (fd !== undefined) fs.closeSync(fd);
      try {
        fs.unlinkSync(temporary);
      } catch {}
      fail(`Speichern fehlgeschlagen: ${error.message}`);
    }
  }
  const newDirectory = !fs.existsSync(dir);
  if (newDirectory) fs.mkdirSync(dir,{
    recursive:true,mode:0o700
  });
  safeDir();
  if (!fs.existsSync(file)) {
    if (!newDirectory || fs.readdirSync(dir).length) fail('Aufgabenspeicher fehlt.');
    write({
      version:1,tasks:[],grants:{}
    });
  }
  const initial = read();
  let recovered = false;
  for (const grants of Object.values(initial.grants)) for (const g of Object.values(grants)) if (g.enabled) {
    g.enabled = false;
    recovered = true;
  }
  for (const t of initial.tasks) if (t.status === 'running' || (t.newWorker && t.status === 'queued' && ['pending','preparing'].includes(t.delivery.state))) {
    t.status='interrupted';
    recovered=true;
  }
  if (recovered) write(initial);
  function time() {
    return new Date(now()).toISOString();
  }
  function actor(a) {
    keys(a,['terminalId','projectId','provider','cwd','workspaceId']);
    id(a.terminalId);
    id(a.projectId);
    const meta=getTerminal(a.terminalId);
    if (meta && (meta.terminalId || meta.id) !== a.terminalId) fail('Terminalidentität stimmt nicht überein.');
    if (!meta || meta.projectId !== a.projectId || meta.manager || meta.isManager || meta.kind === 'manager') fail('Terminal ist nicht für dieses Projekt berechtigt.');
    return a;
  }
  function find(s,project,taskId) {
    id(taskId);
    const t=s.tasks.find(t => t.id === taskId && t.projectId === project);
    if (!t) fail('Aufgabe nicht gefunden.');
    return t;
  }
  function activeGrant(s,t) {
    const g=s.grants[t.projectId]?.[t.grantOwnerId];
    return g?.enabled && !isGrantRevoked(t.projectId, t.grantOwnerId) && (!t.newWorker || g.allowNew);
  }
  function ancestorsPermitWork(state, task) {
    let parentId = task.parentId;
    while (parentId) {
      const parent = state.tasks.find(candidate => candidate.id === parentId);
      if (!parent || ['cancelled', 'failed', 'interrupted'].includes(parent.status)) return false;
      parentId = parent.parentId;
    }
    return true;
  }
  function cancelTree(state, task) {
    const cancelledIds = new Set([task.id]);
    // Durable records are topologically ordered by validation, so descendants
    // appear after their parent, including children of finished intermediates.
    for (const candidate of state.tasks) {
      if (candidate.id === task.id || cancelledIds.has(candidate.parentId)) {
        cancelledIds.add(candidate.id);
        if (!FINISHED.has(candidate.status)) candidate.status = 'cancelled';
      }
    }
  }
  function ready(s,t) {
    return ancestorsPermitWork(s,t) && t.dependsOn.every(d => s.tasks.find(x => x.id===d)?.status==='completed');
  }
  // A grant limits simultaneous worker terminals across every root. Finished
  // tasks still occupy their slot while their terminal exists; cancellation is
  // data only and never closes a terminal. Pending assignments reserve a slot.
  function occupiedWorkerSlots(state, projectId, grantOwnerId) {
    return state.tasks.filter(task =>
      task.newWorker && task.projectId === projectId && task.grantOwnerId === grantOwnerId &&
      (getTerminal(task.targetTerminalId) ||
        (task.status === 'queued' && ['pending', 'preparing'].includes(task.delivery.state)))
    ).length;
  }
  function withinGrantWorkerCap(state, task) {
    const currentGrant = state.grants[task.projectId]?.[task.grantOwnerId];
    return !!currentGrant && occupiedWorkerSlots(state, task.projectId, task.grantOwnerId) <= currentGrant.maxNewWorkers;
  }
  function mutate(fn) {
    const s=read();
    const result=fn(s);
    write(s);
    try {
      onChanged(result.projectId || Object.keys(s.grants).find(p => Object.values(s.grants[p]).includes(result)));
    } catch {}
    return clone(result);
  }
  function visiblePeers(project) {
    return listTerminals(project).filter(t => t.projectId === project && !t.manager && !t.isManager && t.kind !== 'manager').map(t => ({
      terminalId:t.terminalId || t.id,
      id:t.terminalId || t.id,
      title:String(t.title || t.name || t.terminalId || t.id).slice(0,160),
      provider:t.provider || null
    }));
  }
  const api = {
    peers(a) {
      actor(a);
      return visiblePeers(a.projectId);
    },
    list(a,input={}) {
      actor(a);
      keys(input,['box']);
      const box=input.box === undefined ? 'all' : input.box;
      if (!['all','inbox','outbox'].includes(box)) fail('Ungültiges Postfach.');
      return clone(read().tasks.filter(t => t.projectId===a.projectId && (box==='all' || (box==='inbox' ? t.targetTerminalId : t.sourceTerminalId)===a.terminalId)));
    },
    get(a,taskId) {
      actor(a);
      return clone(find(read(),a.projectId,taskId));
    },
    snapshot(project) {
      id(project);
      const s=read();
      return {
        tasks:clone(s.tasks.filter(t=>t.projectId===project)),grants:clone(s.grants[project] || {}),peers:visiblePeers(project)
      };
    },
    setGrant(project,terminal,input) {
      id(project);
      id(terminal);
      const meta=getTerminal(terminal);
      if (meta && (meta.terminalId || meta.id) !== terminal) fail('Quellidentität stimmt nicht überein.');
      if (!meta || meta.projectId!==project || meta.manager || meta.isManager || meta.kind==='manager') fail('Ungültiges Quellterminal.');
      keys(input,Object.keys(DEFAULT_GRANT));
      return mutate(s=>{
        const g={
          ...DEFAULT_GRANT,...s.grants[project]?.[terminal],...input
        };
        grant(g);
        s.grants[project] ||= {};
        s.grants[project][terminal]=g;
        return g;
      });
    },
    send(a,input) {
      actor(a);
      keys(input,['to','provider','title','text','parentId','dependsOn','requestId']);
      id(input.requestId);
      str(input.title,160,'Titel');
      str(input.text,3000,'Aufgabe');
      const newWorker=input.provider !== undefined;
      if (newWorker === (input.to !== undefined)) fail('Genau ein Zielterminal oder Anbieter erforderlich.');
      if (newWorker && !['claude','codex'].includes(input.provider)) fail('Nur Claude und Codex sind als neue Worker erlaubt.');
      if (input.parentId !== undefined) id(input.parentId);
      const deps=input.dependsOn === undefined ? [] : input.dependsOn;
      if (!Array.isArray(deps) || deps.length >5 || new Set(deps).size!==deps.length) fail('Ungültige Abhängigkeiten.');
      deps.forEach(id);
      const normalized={
        to:input.to || null,provider:input.provider || null,title:input.title,text:input.text,parentId:input.parentId || null,dependsOn:deps
      };
      const fingerprint=crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
      return mutate(s=>{
        const old=s.tasks.find(t=>t.projectId===a.projectId && t.sourceTerminalId===a.terminalId && t.requestId===input.requestId);
        if (old) {
          if (old.requestFingerprint!==fingerprint) fail('Anfrage-ID bereits mit anderem Inhalt verwendet.');
          return old;
        }
        const parent=input.parentId ? find(s,a.projectId,input.parentId) : null;
        if (parent && (parent.targetTerminalId!==a.terminalId || parent.status!=='running' || !ancestorsPermitWork(s,parent))) fail('Nur der laufende Empfänger darf Unteraufgaben erstellen.');
        const owner=parent?.grantOwnerId || a.terminalId;
        const g=s.grants[a.projectId]?.[owner] || DEFAULT_GRANT;
        if (!g.enabled || isGrantRevoked(a.projectId, owner) || (newWorker && !g.allowNew)) fail('Benutzerfreigabe für diese Aufgabe fehlt.');
        const depth=parent ? parent.depth+1 : 0;
        if (depth>3) fail('Maximale Aufgabentiefe erreicht.');
        if (parent && s.tasks.filter(t=>t.parentId===parent.id && !FINISHED.has(t.status)).length>=3) fail('Höchstens drei aktive Unteraufgaben erlaubt.');
        const rootId=parent?.rootId;
        const tree=s.tasks.filter(t=>t.rootId===rootId);
        const budget=parent?.maxNewWorkers || g.maxNewWorkers;
        if (tree.length>=20) fail('Höchstens 20 Aufgaben je Wurzel erlaubt.');
        if (newWorker && tree.filter(t=>t.newWorker).length>=Math.min(budget,g.maxNewWorkers)) fail('Workerlimit für diesen Aufgabenbaum erreicht.');
        if (newWorker && occupiedWorkerSlots(s, a.projectId, owner) >= g.maxNewWorkers) fail('Gleichzeitiges Workerlimit für diese Quellfreigabe erreicht.');
        for (const dep of deps) {
          const d=find(s,a.projectId,dep);
          if (!parent || d.rootId!==rootId) fail('Abhängigkeit muss zum selben Aufgabenbaum gehören.');
        }
        let target,provider;
        if (newWorker) {
          target=id(randomId());
          provider=input.provider;
          if (getTerminal(target) || s.tasks.some(t=>t.targetTerminalId===target)) fail('Worker-ID bereits vergeben.');
        } else {
          target=id(input.to);
          const meta=getTerminal(target);
          if (meta && (meta.terminalId || meta.id) !== target) fail('Zielidentität stimmt nicht überein.');
          if (!meta || meta.projectId!==a.projectId || meta.manager || meta.isManager || meta.kind==='manager' || target===a.terminalId) fail('Zielterminal ist nicht erlaubt.');
          provider=['claude','codex','kimi','shell'].includes(meta.provider)?meta.provider:null;
        }
        if (s.tasks.length>=500) fail('Aufbewahrungslimit von 500 Aufgaben erreicht.');
        const taskId=id(randomId());
        if (s.tasks.some(t=>t.id===taskId)) fail('Aufgaben-ID bereits vergeben.');
        const t={
          id:taskId,
          projectId:a.projectId,
          rootId:rootId || taskId,
          parentId:parent?.id || null,
          grantOwnerId:owner,
          sourceTerminalId:a.terminalId,
          targetTerminalId:target,
          targetProvider:provider,newWorker,
          title:input.title,
          text:input.text,
          status:'queued',
          dependsOn:[...deps],depth,
          createdAt:time(),
          result:null,
          delivery:{
            state:newWorker?'pending':'inbox'
          },requestId:input.requestId,requestFingerprint:fingerprint,maxNewWorkers:budget
        };
        s.tasks.push(t);
        return t;
      });
    },
    accept(a,taskId) {
      actor(a);
      return mutate(s=>{
        const t=find(s,a.projectId,taskId);
        if (t.targetTerminalId!==a.terminalId || t.status!=='queued') fail('Nur der Empfänger kann eine wartende Aufgabe annehmen.');
        if (!activeGrant(s,t)) fail('Freigabe widerrufen.');
        if (!ready(s,t)) fail('Abhängigkeiten sind noch nicht abgeschlossen.');
        if (t.newWorker && t.delivery.state!=='launched') fail('Worker wurde noch nicht gestartet.');
        t.status='running';
        return t;
      });
    },
    reply(a,taskId,input) {
      actor(a);
      keys(input,['status','text']);
      if (!['completed','failed'].includes(input.status)) fail('Ungültiger Ergebnisstatus.');
      str(input.text,16000,'Ergebnis',true);
      return mutate(s=>{
        const t=find(s,a.projectId,taskId);
        if (t.targetTerminalId!==a.terminalId || t.status!=='running') fail('Nur der laufende Empfänger kann antworten.');
        t.status=input.status;
        t.result={
          status:input.status,text:input.text,createdAt:time()
        };
        return t;
      });
    },
    cancel(a,taskId) {
      actor(a);
      return mutate(s=>{
        const t=find(s,a.projectId,taskId);
        if (![t.sourceTerminalId,t.targetTerminalId,t.grantOwnerId].includes(a.terminalId)) fail('Abbruch nicht erlaubt.');
        cancelTree(s, t);
        return t;
      });
    },
    canLaunch(taskId) {
      id(taskId);
      const s=read();
      const t=s.tasks.find(t=>t.id===taskId);
      if (!t || !t.newWorker || t.status!=='queued' || !['pending','preparing'].includes(t.delivery.state) || !ready(s,t) || !activeGrant(s,t)) return false;
      const cap=Math.min(t.maxNewWorkers,s.grants[t.projectId][t.grantOwnerId].maxNewWorkers);
      return withinGrantWorkerCap(s, t) && s.tasks.filter(x=>x.rootId===t.rootId && x.newWorker).length<=cap;
    },
    cancelByUser(projectId, taskId) {
      id(projectId);
      return mutate(state => {
        const task = find(state, projectId, taskId);
        cancelTree(state, task);
        return task;
      });
    },
    interrupt(taskId, error) {
      id(taskId);
      str(error, 2000, 'Unterbrechungsgrund', true);
      return mutate(state => {
        const task = state.tasks.find(task => task.id === taskId);
        if (!task) fail('Aufgabe nicht gefunden.');
        if (!FINISHED.has(task.status)) {
          task.status = 'interrupted';
          task.delivery = {
            ...task.delivery, error
          };
        }
        return task;
      });
    },
    pendingLaunches() {
      const s=read();
      return clone(s.tasks.filter(t=>t.newWorker && t.status==='queued' && t.delivery.state==='pending' && ready(s,t) && activeGrant(s,t) && withinGrantWorkerCap(s, t) && s.tasks.filter(x=>x.rootId===t.rootId && x.newWorker).length<=Math.min(t.maxNewWorkers,s.grants[t.projectId][t.grantOwnerId].maxNewWorkers)));
    },
    setDelivery(taskId,input) {
      keys(input,['state','error','workspaceId']);
      return mutate(s=>{
        const t=s.tasks.find(t=>t.id===taskId);
        if (!t || !t.newWorker || t.status!=='queued') fail('Zustellung nicht veränderbar.');
        const allowed={
          pending:['preparing','failed'],preparing:['launched','failed'],launched:['failed'],failed:[]
        };
        if (!allowed[t.delivery.state]?.includes(input.state)) fail('Ungültiger Zustellungsübergang.');
        if (input.state!=='failed' && (!activeGrant(s,t) || !ready(s,t) || !withinGrantWorkerCap(s, t) || s.tasks.filter(x=>x.rootId===t.rootId && x.newWorker).length>Math.min(t.maxNewWorkers,s.grants[t.projectId][t.grantOwnerId].maxNewWorkers))) fail('Freigabe oder Abhängigkeit fehlt.');
        t.delivery={
          ...t.delivery,...input
        };
        if (input.state==='failed') t.status='interrupted';
        return t;
      });
    }
  };
  return api;
}
module.exports = {
  createAgentTaskService
};
