'use strict';

// Explicit opt-in QA: real CLI, synthetic credentials, local Anthropic fixture only.
// No model inference or answer-following claim: this verifies serialized context.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createSettingsService } = require('../src/main/settings-service');
const { createAgentProfile, shellQuote } = require('../src/main/agent-profile');

// Real claude CLI: MULTITERMINAL_QA_CLAUDE or the usual install location in the home folder.
const CLI = process.env.MULTITERMINAL_QA_CLAUDE || path.join(os.homedir(), '.local', 'bin', 'claude');
const LIMIT = 2 * 1024 * 1024;
const requests = [];
const children = new Set();
let totalBytes = 0, root, server, deadline, diagnostic;

function child(command, args, options) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { ...options, detached: true });
    children.add(proc);
    let stdout = '', stderr = '';
    proc.stdout.on('data', b => { if (stdout.length < LIMIT) stdout += b; });
    proc.stderr.on('data', b => { if (stderr.length < LIMIT) stderr += b; });
    proc.on('error', reject);
    proc.on('close', code => { children.delete(proc); resolve({ code, stdout, stderr }); });
  });
}
function killChildren() {
  for (const proc of children) {
    try { process.kill(-proc.pid, 'SIGKILL'); } catch { try { proc.kill('SIGKILL'); } catch {} }
  }
}
function fixture(req, res) {
  let chunks = [];
  req.on('data', b => {
    totalBytes += b.length;
    if (totalBytes > LIMIT) { req.destroy(); killChildren(); return; }
    chunks.push(b);
  });
  req.on('end', () => {
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
    catch { res.writeHead(400); res.end('{}'); return; }
    requests.push({ url: req.url, body });
    if (req.url.split('?')[0] !== '/v1/messages') { res.writeHead(404); res.end('{}'); return; }
    const model = body.model || 'claude-sonnet-4-6';
    const message = { id: 'msg_local_fixture', type: 'message', role: 'assistant', model,
      content: [{ type: 'text', text: 'LOCAL_FIXTURE_OK' }], stop_reason: 'end_turn',
      stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    if (!body.stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(message)); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    event('message_start', { message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } });
    event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'LOCAL_FIXTURE_OK' } });
    event('content_block_stop', { index: 0 });
    event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
    event('message_stop', {});
    res.end();
  });
}
const texts = value => typeof value === 'string' ? value : Array.isArray(value)
  ? value.map(texts).join('\n') : value && typeof value === 'object'
    ? Object.values(value).map(texts).join('\n') : '';

async function main() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-claude-local-qa-'));
  deadline = setTimeout(() => { killChildren(); server?.closeAllConnections(); }, 35000);
  const project = path.join(root, 'project');
  const config = path.join(root, 'config');
  // Quotes and spaces exercise the production path quoting as well as content.
  const appData = path.join(root, "app data ' quote");
  for (const dir of [project, config, appData]) fs.mkdirSync(dir, { recursive: true });
  const marker = path.join(root, 'must-not-exist');
  const profile = `MT_APP_PROFILE_SENTINEL\nLiteral $(touch '${marker}') and \`touch '${marker}'\`\nQuotes \" ' ; & | > < \\ $HOME\nUnicode ä ✓`;
  const native = 'MT_NATIVE_PROJECT_SENTINEL\nNative project rules stay separate.\n';
  const nativeFile = path.join(project, 'CLAUDE.md');
  fs.writeFileSync(nativeFile, native);
  const settings = createSettingsService({ dataDir: appData, homeDir: path.join(root, 'fake-home') });
  for (const [scope, text] of [['claude', profile], ['codex', 'MT_CODEX_ABSENT_SENTINEL'], ['kimi', 'MT_KIMI_ABSENT_SENTINEL']]) {
    settings.saveProfile(scope, text, settings.readProfile(scope).revision);
  }
  const agent = createAgentProfile({ dataDir: appData, readProfile: settings.readProfile });
  assert.equal(agent.decorateCommand({ command: 'claude' }), 'claude');
  agent.setEnabled('claude', true);
  const decorated = agent.decorateCommand({ command: 'claude' });
  assert.match(decorated, /--append-system-prompt/);
  server = http.createServer(fixture);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const env = {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8', TMPDIR: root,
    CLAUDE_CONFIG_DIR: config, ANTHROPIC_API_KEY: 'sk-ant-local-fixture-not-a-secret',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1', DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: '1',
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
  };
  const versionResult = await child(CLI, ['--version'], { cwd: project, env });
  assert.equal(versionResult.code, 0, 'CLI version failed');
  const flags = ['--print', '--model', 'claude-sonnet-4-6', '--max-turns', '1',
    // Empty setting sources also suppress native project memory in recent CLIs.
    // Only the synthetic project's settings source is allowed; user/local stay off.
    '--setting-sources', 'project', '--settings', '{"disableAllHooks":true}',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', 'Read',
    '--disable-slash-commands', '--no-chrome', '--no-session-persistence',
    '--output-format', 'json', 'Reply LOCAL_FIXTURE_OK.'];
  const shim = `claude() { ${shellQuote(CLI)} "$@" ${flags.map(shellQuote).join(' ')}; }\n${decorated}`;
  const result = await child('/bin/sh', ['-c', shim], { cwd: project, env });
  assert.equal(result.code, 0, `CLI failed (exit ${result.code}); local requests=${requests.length}`);
  const candidates = requests.filter(r => Array.isArray(r.body.messages));
  const request = candidates.find(r => texts(r.body.system).includes('MT_APP_PROFILE_SENTINEL'));
  const observed = request || candidates[0];
  diagnostic = observed ? {
    appInSystem: texts(observed.body.system).includes('MT_APP_PROFILE_SENTINEL'),
    nativeInSystem: texts(observed.body.system).includes('MT_NATIVE_PROJECT_SENTINEL'),
    nativeInMessages: texts(observed.body.messages).includes('MT_NATIVE_PROJECT_SENTINEL'),
    systemBlocks: Array.isArray(observed.body.system) ? observed.body.system.length : typeof observed.body.system,
    messageRoles: observed.body.messages.map(m => m.role), keys: Object.keys(observed.body),
  } : { messageRequestAbsent: true };
  assert.ok(request, 'No actual messages request containing app profile');
  const system = texts(request.body.system), messages = texts(request.body.messages);
  assert.ok(system.includes(profile), 'Profile content changed during shell/CLI serialization');
  assert.ok(/Claude Code|interactive CLI|software engineering/i.test(system.replace(profile, '')), 'Default system prompt missing');
  assert.ok(messages.includes('MT_NATIVE_PROJECT_SENTINEL'), 'Native project CLAUDE.md absent from separate messages context');
  assert.ok(!system.includes('MT_NATIVE_PROJECT_SENTINEL'), 'Native project rules unexpectedly merged into app system profile');
  const all = texts(request.body);
  assert.ok(!all.includes('MT_CODEX_ABSENT_SENTINEL') && !all.includes('MT_KIMI_ABSENT_SENTINEL'), 'Other agent profiles leaked');
  assert.equal(fs.existsSync(marker), false, 'Profile shell metacharacters executed');
  assert.equal(fs.readFileSync(nativeFile, 'utf8'), native, 'Native CLAUDE.md modified');
  assert.ok(result.stdout.includes('LOCAL_FIXTURE_OK'), 'Fixture reply not accepted');
  console.log(JSON.stringify({ ok: true, version: versionResult.stdout.trim(), requestCount: requests.length,
    messageRequestCount: candidates.length, totalBodyBytes: totalBytes,
    checks: ['app-profile-in-system', 'default-system-preserved', 'native-project-in-messages',
      'other-profiles-absent', 'shell-metacharacters-literal', 'native-file-unchanged', 'local-fixture-response'],
    scope: 'Real CLI context serialization only; no remote inference or interactive-app acceptance.' }, null, 2));
}
main().catch(err => {
  console.error(JSON.stringify({ ok: false, error: err.message, code: err.code || null, requestCount: requests.length, totalBodyBytes: totalBytes, diagnostic }));
  process.exitCode = 1;
}).finally(() => {
  clearTimeout(deadline); killChildren();
  if (server) { server.closeAllConnections(); server.close(); }
  if (root) fs.rmSync(root, { recursive: true, force: true });
});
