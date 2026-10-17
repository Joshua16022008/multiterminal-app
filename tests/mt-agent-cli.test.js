'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createBrowserBridge } = require('../src/main/browser-bridge');
const { parseArgs, request, run, wrapperScript, MAX_REQUEST_BYTES } = require('../src/main/mt-agent-cli');
test('all CLI verbs, JSON flags, and send idempotency IDs', () => {
  for (const verb of ['peers', 'inbox', 'outbox', 'tasks']) assert.ok(parseArgs([verb, '--json']).cmd.startsWith('task-'));
  for (const verb of ['task', 'accept', 'cancel']) assert.equal(parseArgs([verb, 'id']).args.id, 'id');
  const argv = ['send', '--to', 't', '--title', 'title', '--text', 'text', '--parent', 'parent', '--after', 'a,b'];
  const first = parseArgs(argv), second = parseArgs(argv);
  assert.equal(first.cmd, 'task-send'); assert.equal(first.args.parentId, 'parent'); assert.deepEqual(first.args.dependsOn, ['a','b']); assert.notEqual(first.args.requestId, second.args.requestId);
  assert.equal(parseArgs(['spawn','--provider','codex','--title','x','--text','y']).args.provider, 'codex');
  assert.equal(parseArgs(['reply','id','--status','failed','--text','why']).args.status, 'failed');
  assert.equal(parseArgs(['wait','id','--timeout','300']).timeoutSeconds,300);
});
test('parser rejects overrides, ambiguity, text limits, and invalid workflow flags', () => {
  for (const argv of [[], ['peers','--project','x'], ['task'], ['inbox','x'], ['wait','id','--timeout','301'], ['wait','id','--timeout','0'], ['reply','id','--text','x'], ['reply','id','--status','running','--text','x'], ['send','--to','t','--title','x','--text','x'.repeat(3001)], ['spawn','--provider','kimi','--title','x','--text','x'], ['send','--to','t','--title','x','--text','x','--after','a,a'], ['peers','--json','--json'], ['task','x\0']]) assert.ok(parseArgs(argv).error, JSON.stringify(argv).slice(0,120));
});
test('authenticated socket derives identity; missing/revoked tokens, byte overflow and cross project requests fail', async () => {
  const dir = fs.mkdtempSync('/tmp/mta-'); const sock = dir + '/s'; const calls = [];
  const bridge = createBrowserBridge({socketPath:sock,handler:()=>{throw Error('unexpected browser')},taskHandler:(tid,op,args)=> { calls.push({tid,op,args}); if(args.id==='foreign') throw Error('Fremdes Projekt'); return {id:args.id||'task',status:'completed'}; }});
  await bridge.start(); const token=bridge.register('real'); const env={MULTITERMINAL_BROWSER_SOCK:sock,MULTITERMINAL_BROWSER_TOKEN:token};
  try {
    assert.equal((await request({cmd:'task-get',args:{id:'own'}},{env})).id,'own'); assert.equal(calls[0].tid,'real');
    await assert.rejects(request({cmd:'task-get',args:{id:'foreign'}},{env}),/Fremdes Projekt/);
    await assert.rejects(request({cmd:'task-peers',args:{projectId:'foreign'}},{env}),/Overrides/);
    await assert.rejects(request({cmd:'task-send',args:{text:'界'.repeat(MAX_REQUEST_BYTES)}},{env}),/groß/);
    await assert.rejects(request({cmd:'task-peers',args:{}},{env:{...env,MULTITERMINAL_BROWSER_TOKEN:'bad'}}),/berechtigt/);
    bridge.unregister('real'); await assert.rejects(request({cmd:'task-peers',args:{}},{env}),/berechtigt/);
    await assert.rejects(request({cmd:'task-peers'},{env:{}}),/Socket und Token/);
  } finally {await bridge.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
test('wait polls until explicit final result and respects finite timeout; failures go to stderr', async()=>{
  let output='', error='', calls=0;
  const io={stdout:{write:s=>output+=s},stderr:{write:s=>error+=s}};
  assert.equal(await run(['wait','t','--json'],{},io,{pollMs:1,request:async()=>({id:'t',status:++calls===1?'running':'completed'})}),0);
  assert.equal(calls,2); assert.equal(JSON.parse(output).status,'completed'); assert.equal(error,'');
  output=''; assert.equal(await run(['wait','t','--timeout','0.005'],{},io,{pollMs:1,request:async()=>({status:'queued'})}),1); assert.match(error,/Zeitüberschreitung/);assert.equal(output,'');
});
test('wrapper quotes executable paths and keeps argv literal',()=>{
 assert.equal(wrapperScript({execPath:"/a'b",scriptPath:'/x y.js'}),"#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec '/a'\\''b' '/x y.js' \"$@\"\n");
});
test('CLI is standalone when copied; Node process talks to socket without external providers', async()=>{
 const dir=fs.mkdtempSync('/tmp/mtac-');const script=dir+'/agent cli.js';fs.copyFileSync(require.resolve('../src/main/mt-agent-cli'),script);
 const bridge=createBrowserBridge({socketPath:dir+'/s',handler:()=>null,taskHandler:(tid,op)=>({tid,op})}); await bridge.start(); const token=bridge.register('cli');
 try {
  const {spawn}=require('node:child_process');const result=await new Promise((resolve,reject)=>{ const child=spawn(process.execPath,[script,'peers','--json'],{env:{...process.env,MULTITERMINAL_BROWSER_SOCK:dir+'/s',MULTITERMINAL_BROWSER_TOKEN:token}});let out='',err='';child.stdout.on('data',s=>out+=s);child.stderr.on('data',s=>err+=s);child.on('error',reject);child.on('close',code=>resolve({code,out,err})); });
  assert.equal(result.code,0);assert.equal(result.err,'');assert.deepEqual(JSON.parse(result.out),{tid:'cli',op:'peers'});
 }finally{await bridge.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
