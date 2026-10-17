'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createAgentTaskService}=require('../src/main/agent-task-service');
function fixture(t) {
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-tasks-')); t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
  const terminals=new Map(['a','b','c','d'].map(terminalId=>[terminalId,{terminalId,projectId:'project',provider:'codex',title:terminalId}]));
  terminals.set('other',{terminalId:'other',projectId:'other'}); terminals.set('manager',{terminalId:'manager',projectId:'project',isManager:true});
  const changes=[]; let next=0;
  const options={dataDir,getTerminal:id=>terminals.get(id),listTerminals:p=>[...terminals.values()].filter(x=>x.projectId===p),onChanged:p=>changes.push(p),randomId:()=>`random-${++next}`,now:()=>new Date('2026-10-17T00:00:00Z')};
  const service=createAgentTaskService(options); const actor=terminalId=>({terminalId,projectId:terminals.get(terminalId)?.projectId || 'project'});
  const grant=(terminal='a',patch={})=>service.setGrant('project',terminal,{enabled:true,allowNew:true,maxNewWorkers:2,...patch});
  let requests=0; const send=(input={},source='a')=>service.send(actor(source),{to:'b',title:'Prüfung',text:'Prüfe das Ergebnis',requestId:`request-${++requests}`,...input});
  return {service,options,terminals,actor,grant,send,changes,file:path.join(dataDir,'agent-tasks','tasks.json')};
}
test('strict identity, fields, grants and recipient isolation',t=>{
  const f=fixture(t),s=f.service; assert.throws(()=>f.send(),/freigabe/i); f.grant();
  for (const to of ['a','other','manager','missing']) assert.throws(()=>f.send({to}),/Zielterminal/);
  assert.throws(()=>s.send(f.actor('a'),{to:'b',title:'x',text:'x',requestId:'r',sourceTerminalId:'c'}),/Felder/);
  assert.throws(()=>s.send({...f.actor('a'),projectId:'other'},{to:'b',title:'x',text:'x',requestId:'r'}),/berechtigt/);
  const task=f.send(); assert.equal(task.delivery.state,'inbox');
  assert.throws(()=>s.accept(f.actor('c'),task.id),/Empfänger/);
  assert.throws(()=>s.get(f.actor('other'),task.id),/nicht gefunden/);
  assert.equal(s.list(f.actor('b'),{box:'inbox'}).length,1);
  assert.equal(s.list(f.actor('c'),{box:'outbox'}).length,0);
  assert.deepEqual(f.changes,['project','project']);
});
test('explicit accept and result; snapshots cannot mutate durable state',t=>{
  const f=fixture(t),s=f.service; f.grant(); const task=f.send();
  assert.throws(()=>s.reply(f.actor('b'),task.id,{status:'completed',text:'premature'}),/laufende/);
  assert.equal(s.accept(f.actor('b'),task.id).status,'running');
  assert.equal(s.reply(f.actor('b'),task.id,{status:'completed',text:'fertig <script>'}).result.text,'fertig <script>');
  const snap=s.snapshot('project'); snap.tasks[0].text='mutated'; assert.notEqual(s.get(f.actor('a'),task.id).text,'mutated');
  assert.throws(()=>s.reply(f.actor('b'),task.id,{status:'failed',text:'again'}),/laufende/);
});
test('request deduplication binds source to exact semantic payload',t=>{
  const f=fixture(t);f.grant(); const first=f.send({requestId:'stable'});
  assert.deepEqual(f.send({requestId:'stable'}),first);
  assert.throws(()=>f.send({requestId:'stable',text:'changed'}),/anderem Inhalt/);
  assert.equal(f.service.snapshot('project').tasks.length,1);
  f.service.setGrant('project','a',{enabled:false}); assert.deepEqual(f.send({requestId:'stable'}),first);
});
test('child ownership, depth, active child and same-root dependency gates',t=>{
  const f=fixture(t),s=f.service;f.grant();const root=f.send();
  assert.throws(()=>f.send({parentId:root.id,to:'c'},'b'),/laufende Empfänger/);
  s.accept(f.actor('b'),root.id);
  const child=f.send({parentId:root.id,to:'c'},'b');
  const after=f.send({parentId:root.id,to:'d',dependsOn:[child.id]},'b');
  assert.throws(()=>s.accept(f.actor('d'),after.id),/Abhängigkeiten/);
  f.send({parentId:root.id,to:'c'},'b');
  assert.throws(()=>f.send({parentId:root.id,to:'c'},'b'),/drei aktive/);
  s.accept(f.actor('c'),child.id);s.reply(f.actor('c'),child.id,{status:'completed',text:'ready'});
  s.accept(f.actor('d'),after.id);
  assert.equal(after.grantOwnerId,'a');
  const grand=f.send({parentId:after.id,to:'c'},'d');s.accept(f.actor('c'),grand.id);
  const deepest=f.send({parentId:grand.id,to:'b'},'c');s.accept(f.actor('b'),deepest.id);
  assert.throws(()=>f.send({parentId:deepest.id,to:'c'},'b'),/Aufgabentiefe/);
  f.grant('c');const different=f.send({to:'d'},'c');
  assert.throws(()=>f.send({parentId:grand.id,to:'b',dependsOn:[different.id]},'c'),/selben Aufgabenbaum/);
});
test('worker assignment, internal delivery and inherited nonreplenishing root budget',t=>{
  const f=fixture(t),s=f.service;f.grant();
  const root=f.send({to:undefined,provider:'codex'}); assert.equal(root.delivery.state,'pending');assert.equal(s.pendingLaunches().length,1);
  f.terminals.set(root.targetTerminalId,{terminalId:root.targetTerminalId,projectId:'project',provider:'codex'});
  assert.throws(()=>s.accept(f.actor(root.targetTerminalId),root.id),/nicht gestartet/);
  s.setDelivery(root.id,{state:'preparing'});assert.equal(s.canLaunch(root.id),true);s.setDelivery(root.id,{state:'launched',workspaceId:'workspace'});
  s.accept(f.actor(root.targetTerminalId),root.id);
  const child=f.send({to:undefined,provider:'claude',parentId:root.id},root.targetTerminalId);
  assert.equal(child.maxNewWorkers,2);assert.equal(child.grantOwnerId,'a');
  f.terminals.set(child.targetTerminalId,{terminalId:child.targetTerminalId,projectId:'project',provider:'claude'});
  s.setDelivery(child.id,{state:'preparing'});s.setDelivery(child.id,{state:'launched'});s.accept(f.actor(child.targetTerminalId),child.id);s.reply(f.actor(child.targetTerminalId),child.id,{status:'completed',text:'done'});
  f.grant('a',{maxNewWorkers:4});
  assert.throws(()=>f.send({to:undefined,provider:'codex',parentId:root.id},root.targetTerminalId),/Workerlimit/);
});
test('revocation/current cap checked before launch and failed dependency remains blocked',t=>{
  const f=fixture(t),s=f.service;f.grant();const root=f.send();s.accept(f.actor('b'),root.id);
  const worker=f.send({to:undefined,provider:'codex',parentId:root.id},'b');
  s.setDelivery(worker.id,{state:'preparing'});f.grant('a',{enabled:false});
  assert.equal(s.canLaunch(worker.id),false);assert.throws(()=>s.setDelivery(worker.id,{state:'launched'}),/Freigabe/);
  s.setDelivery(worker.id,{state:'failed',error:'Worktree fehlt'});assert.equal(s.get(f.actor('a'),worker.id).status,'interrupted');
  f.grant();const dep=f.send({to:'c',parentId:root.id},'b');const blocked=f.send({to:undefined,provider:'codex',parentId:root.id,dependsOn:[dep.id]},'b');
  s.accept(f.actor('c'),dep.id);s.reply(f.actor('c'),dep.id,{status:'failed',text:'blocked'});assert.equal(s.canLaunch(blocked.id),false);assert.equal(s.pendingLaunches().length,0);
});
test('restart revokes grants, interrupts active work, preserves existing queued inbox',t=>{
  const f=fixture(t),s=f.service;f.grant();const running=f.send();s.accept(f.actor('b'),running.id);const queued=f.send();const worker=f.send({to:undefined,provider:'codex'});
  const restarted=createAgentTaskService(f.options),snap=restarted.snapshot('project');
  assert.equal(snap.grants.a.enabled,false);assert.equal(snap.tasks.find(x=>x.id===running.id).status,'interrupted');assert.equal(snap.tasks.find(x=>x.id===worker.id).status,'interrupted');assert.equal(snap.tasks.find(x=>x.id===queued.id).status,'queued');assert.deepEqual(restarted.pendingLaunches(),[]);
});
test('corrupt/schema-unsafe/symlinked/missing stores fail clearly',t=>{
  const f=fixture(t);const original=fs.readFileSync(f.file,'utf8');
  for(const content of ['{',JSON.stringify({version:1,tasks:[],grants:{},forged:true}),JSON.stringify({version:1,tasks:[{}],grants:{}})]) {fs.writeFileSync(f.file,content);assert.throws(()=>createAgentTaskService(f.options),/Agent-Aufgaben/);}
  fs.writeFileSync(f.file,original);fs.renameSync(f.file,`${f.file}.saved`);fs.symlinkSync(`${f.file}.saved`,f.file);assert.throws(()=>createAgentTaskService(f.options),/Link|ungültig/);fs.unlinkSync(f.file);
  assert.throws(()=>createAgentTaskService(f.options),/fehlt/);assert.throws(()=>f.service.snapshot('project'),/nicht lesbar/);
});
test('write failure leaves persisted state intact and does not emit change',t=>{
  const f=fixture(t);f.grant();const before=fs.readFileSync(f.file,'utf8'), count=f.changes.length;
  const original=fs.renameSync;fs.renameSync=()=>{throw new Error('simulated disk failure');};
  try {assert.throws(()=>f.send(),/Speichern fehlgeschlagen/);} finally {fs.renameSync=original;}
  assert.equal(fs.readFileSync(f.file,'utf8'),before);assert.equal(f.changes.length,count);assert.equal(fs.readdirSync(path.dirname(f.file)).length,1);
});
test('bounded input and cancellation preserve result semantics',t=>{
  const f=fixture(t),s=f.service;f.grant();
  assert.throws(()=>f.send({text:'x'.repeat(3001)}),/3000/);assert.throws(()=>f.send({title:'x'.repeat(161)}),/160/);
  const root=f.send();assert.throws(()=>s.cancel(f.actor('c'),root.id),/Abbruch/);s.accept(f.actor('b'),root.id);assert.equal(s.cancel(f.actor('a'),root.id).status,'cancelled');
  assert.throws(()=>s.reply(f.actor('b'),root.id,{status:'completed',text:'done'}),/laufende/);
});
test('twenty-task tree bound counts completed children and current cap can only reduce launch authority',t=>{
  const f=fixture(t),s=f.service;f.grant(); const root=f.send();s.accept(f.actor('b'),root.id);
  for(let n=0;n<19;n++){const c=f.send({to:'c',parentId:root.id},'b');s.accept(f.actor('c'),c.id);s.reply(f.actor('c'),c.id,{status:'completed',text:'done'});}
  assert.throws(()=>f.send({to:'c',parentId:root.id},'b'),/20 Aufgaben/);
  const independent=f.send();s.accept(f.actor('b'),independent.id);
  const first=f.send({to:undefined,provider:'codex',parentId:independent.id},'b');
  const second=f.send({to:undefined,provider:'codex',parentId:independent.id},'b');
  assert.equal(s.canLaunch(first.id),true);f.grant('a',{maxNewWorkers:1});assert.equal(s.canLaunch(first.id),false);assert.equal(s.canLaunch(second.id),false);assert.equal(s.pendingLaunches().length,0);
});
test('retained task and file byte bounds reject malformed disk without silent reset',t=>{
  const f=fixture(t);f.grant();f.send();const original=JSON.parse(fs.readFileSync(f.file,'utf8'));
  const oversized={...original,tasks:Array.from({length:501},()=>original.tasks[0])};fs.writeFileSync(f.file,JSON.stringify(oversized));assert.throws(()=>createAgentTaskService(f.options),/Aufgabenspeicher/);
  fs.writeFileSync(f.file,' '.repeat(2*1024*1024+1));assert.throws(()=>createAgentTaskService(f.options),/zu groß/);
});
test('restart interrupts preparing launch, user revocation blocks existing accept but permits already running result',t=>{
  const f=fixture(t),s=f.service;f.grant();const running=f.send();s.accept(f.actor('b'),running.id);const queued=f.send();const worker=f.send({to:undefined,provider:'codex'});s.setDelivery(worker.id,{state:'preparing'});
  f.grant('a',{enabled:false});assert.throws(()=>s.accept(f.actor('b'),queued.id),/widerrufen/);assert.equal(s.reply(f.actor('b'),running.id,{status:'completed',text:'already working'}).status,'completed');
  assert.equal(createAgentTaskService(f.options).get(f.actor('a'),worker.id).status,'interrupted');
});
test('main-only user cancellation and terminal-end interruption never fabricate results',t=>{
  const f=fixture(t),s=f.service;f.grant();const queued=f.send();assert.throws(()=>s.cancelByUser('other',queued.id),/nicht gefunden/);assert.equal(s.cancelByUser('project',queued.id).status,'cancelled');
  const running=f.send();s.accept(f.actor('b'),running.id);const stopped=s.interrupt(running.id,'Terminal geschlossen');assert.equal(stopped.status,'interrupted');assert.equal(stopped.result,null);assert.equal(stopped.delivery.error,'Terminal geschlossen');
  const done=f.send();s.accept(f.actor('b'),done.id);s.reply(f.actor('b'),done.id,{status:'completed',text:'done'});assert.equal(s.interrupt(done.id,'late exit').status,'completed');
});
test('optional inputs still enforce their types and a lowered cap blocks delivery transition',t=>{
  const f=fixture(t),s=f.service;f.grant();
  assert.throws(()=>f.send({dependsOn:null}),/Abhängigkeiten/);assert.throws(()=>f.send({parentId:''}),/ID/);assert.throws(()=>s.list(f.actor('a'),{box:''}),/Postfach/);
  const root=f.send();s.accept(f.actor('b'),root.id);const one=f.send({to:undefined,provider:'codex',parentId:root.id},'b');f.send({to:undefined,provider:'codex',parentId:root.id},'b');s.setDelivery(one.id,{state:'preparing'});f.grant('a',{maxNewWorkers:1});assert.throws(()=>s.setDelivery(one.id,{state:'launched'}),/Freigabe/);
});
test('grant-wide simultaneous worker cap spans independent roots and live finished terminals',t=>{
  const f=fixture(t),s=f.service;f.grant();
  const first=f.send({to:undefined,provider:'codex'});
  const second=f.send({to:undefined,provider:'claude'});
  assert.notEqual(first.rootId,second.rootId);
  assert.throws(()=>f.send({to:undefined,provider:'codex'}),/Quellfreigabe/);
  assert.equal(s.canLaunch(first.id),true);s.setDelivery(first.id,{state:'preparing'});
  // The same preparing assignment and its live terminal consume one slot.
  f.terminals.set(first.targetTerminalId,{terminalId:first.targetTerminalId,projectId:'project',provider:'codex'});
  assert.equal(s.canLaunch(first.id),true);s.setDelivery(first.id,{state:'launched'});
  s.accept(f.actor(first.targetTerminalId),first.id);
  s.reply(f.actor(first.targetTerminalId),first.id,{status:'completed',text:'done'});
  assert.throws(()=>f.send({to:undefined,provider:'codex'}),/Quellfreigabe/);
  f.terminals.delete(first.targetTerminalId);
  const replacement=f.send({to:undefined,provider:'codex'});
  assert.equal(replacement.status,'queued');assert.notEqual(replacement.rootId,first.rootId);
  // Cancellation does not free a live terminal's slot.
  f.terminals.set(replacement.targetTerminalId,{terminalId:replacement.targetTerminalId,projectId:'project',provider:'codex'});
  s.cancelByUser('project',replacement.id);
  assert.throws(()=>f.send({to:undefined,provider:'codex'}),/Quellfreigabe/);
  f.terminals.delete(replacement.targetTerminalId);
  assert.equal(f.send({to:undefined,provider:'codex'}).status,'queued');
  assert.equal(s.canLaunch(second.id),true);
});
test('grant-wide cap is rechecked after user reduction before delivery',t=>{
  const f=fixture(t),s=f.service;f.grant();
  const first=f.send({to:undefined,provider:'codex'});const second=f.send({to:undefined,provider:'codex'});
  s.setDelivery(first.id,{state:'preparing'});f.grant('a',{maxNewWorkers:1});
  assert.equal(s.canLaunch(first.id),false);assert.equal(s.canLaunch(second.id),false);assert.equal(s.pendingLaunches().length,0);
  assert.throws(()=>s.setDelivery(first.id,{state:'launched'}),/Freigabe/);
  s.cancelByUser('project',second.id);assert.equal(s.canLaunch(first.id),true);s.setDelivery(first.id,{state:'launched'});
});
test('cancel parent cascades queued/preparing/running descendants while preserving finished results',t=>{
  const f=fixture(t),s=f.service;f.grant();const root=f.send();s.accept(f.actor('b'),root.id);
  const finished=f.send({to:'c',parentId:root.id},'b');s.accept(f.actor('c'),finished.id);
  const grandchild=f.send({to:'d',parentId:finished.id},'c');s.accept(f.actor('d'),grandchild.id);
  s.reply(f.actor('c'),finished.id,{status:'completed',text:'preserve this result'});
  const pending=f.send({to:undefined,provider:'codex',parentId:root.id},'b');
  const preparing=f.send({to:undefined,provider:'claude',parentId:root.id},'b');s.setDelivery(preparing.id,{state:'preparing'});
  s.cancel(f.actor('a'),root.id);
  for(const task of [root,pending,preparing,grandchild])assert.equal(s.get(f.actor('a'),task.id).status,'cancelled');
  assert.equal(s.get(f.actor('a'),finished.id).result.text,'preserve this result');
  assert.equal(s.get(f.actor('a'),finished.id).status,'completed');
  assert.equal(s.canLaunch(pending.id),false);assert.equal(s.canLaunch(preparing.id),false);assert.deepEqual(s.pendingLaunches(),[]);
  assert.throws(()=>s.setDelivery(preparing.id,{state:'launched'}),/veränderbar/);
  assert.throws(()=>s.reply(f.actor('d'),grandchild.id,{status:'completed',text:'late'}),/laufende/);
});
test('user cancellation cascades through finished parent and ancestor failure blocks child starts',t=>{
  const f=fixture(t),s=f.service;f.grant();const root=f.send();s.accept(f.actor('b'),root.id);
  const worker=f.send({to:undefined,provider:'codex',parentId:root.id},'b');s.setDelivery(worker.id,{state:'preparing'});
  const child=f.send({to:'c',parentId:root.id},'b');s.accept(f.actor('c'),child.id);
  const queued=f.send({to:'d',parentId:child.id},'c');
  s.reply(f.actor('b'),root.id,{status:'failed',text:'root failed explicitly'});
  assert.equal(s.get(f.actor('a'),root.id).result.text,'root failed explicitly');assert.equal(s.canLaunch(worker.id),false);assert.deepEqual(s.pendingLaunches(),[]);
  assert.throws(()=>s.setDelivery(worker.id,{state:'launched'}),/Abhängigkeit/);
  assert.throws(()=>s.accept(f.actor('d'),queued.id),/Abhängigkeiten/);
  assert.throws(()=>f.send({to:'d',parentId:child.id},'c'),/laufende Empfänger/);
  s.cancelByUser('project',root.id);
  assert.equal(s.get(f.actor('a'),root.id).status,'failed');
  for(const task of [worker,child,queued])assert.equal(s.get(f.actor('a'),task.id).status,'cancelled');
});
