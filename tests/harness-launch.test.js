'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHarnessCatalog } = require('../src/main/harness-catalog');
const { createHarnessLaunch } = require('../src/main/harness-launch');
const { createAgentProfile } = require('../src/main/agent-profile');
const memoryModule = require('../src/main/memory-launch');
const { createMemoryService } = require('../src/main/memory-service');
const { createKeychain } = require('../src/main/keychain');
const ID = 'a1b2c3d4-0000-4000-8000-123456789abc';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mt-harness-launch-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, "App's data");
  const catalog = createHarnessCatalog();
  const readProfile = provider => ({ text: fs.existsSync(path.join(root, provider + '.md')) ? fs.readFileSync(path.join(root, provider + '.md'), 'utf8') : '', path: path.join(root, provider + '.md') });
  const profile = createAgentProfile({ dataDir, readProfile });
  for (const provider of ['claude', 'codex', 'kimi']) fs.writeFileSync(readProfile(provider).path, 'PERSONAL PROFILE $() "quoted"');
  const memory = createMemoryService({ dataDir });
  const memoryLaunch = memoryModule.createMemoryLaunch({ memory, dataDir, agentProfile: profile, readProfile });
  const scopedMemory = {
    decorateCommand: options => memoryLaunch.decorateCommand({ ...options, projectId: 'project' }),
    contextArgs: options => memoryLaunch.contextArgs({ ...options, projectId: 'project' }),
  };
  let endpoint = { id: 'ep-deepseek', label: 'DeepSeek', type: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic', defaultModel: null, modelMap: null, isolateClaudeConfig: true, hasSecret: true };
  const keychain = createKeychain({ run: () => { throw new Error('build must never read a secret'); } });
  const launch = createHarnessLaunch({ catalog, endpoints: { get: id => endpoint?.id === id ? { ...endpoint } : null }, keychain, agentProfile: profile, memoryLaunch: scopedMemory, dataDir });
  return { root, dataDir, catalog, profile, memory, memoryLaunch, launch, endpoint: value => { endpoint = value; } };
}

test('golden: Claude/Codex/Kimi remain byte-identical for profile × Memory × resume × Full Access', async t => {
  const f = fixture(t);
  let serial = 0;
  const original = memoryModule.writePrivate;
  // Freeze only the generated filename, writing actual private context content.
  // Both legacy and catalog paths therefore produce byte-comparable shell lines.
  memoryModule.writePrivate = (dataDir, suffix, text) => {
    const file = path.join(f.root, `context-${serial++}.${suffix}`);
    fs.writeFileSync(file, text, { mode: 0o600 });
    return file;
  };
  t.after(() => { memoryModule.writePrivate = original; });
  let cases = 0;
  for (const provider of ['claude', 'codex', 'kimi']) {
    for (const profile of [false, true]) for (const memory of [false, true]) {
      f.profile.setEnabled(provider, profile);
      f.memory.setSettings({ enabled: memory });
      for (const resume of [undefined, 'last', { sessionId: ID }]) for (const fullAccess of [undefined, false, true]) {
        const line = resume === 'last' ? { claude: 'claude --continue', codex: 'codex resume --last', kimi: 'kimi --continue' }[provider]
          : resume ? { claude: `claude --resume ${ID}`, codex: `codex resume ${ID}`, kimi: `kimi --session ${ID}` }[provider] : provider;
        serial = 0;
        const expected = f.memoryLaunch.decorateCommand({ command: line, provider, resume: Boolean(resume), projectId: 'project' });
        serial = 0;
        const actual = await f.launch.build({ harnessId: provider, resume, fullAccess });
        assert.equal(actual.command, expected, JSON.stringify({ provider, profile, memory, resume, fullAccess }));
        assert.deepEqual(actual.env, {});
        assert.equal(actual.provider, provider);
        cases++;
      }
    }
  }
  assert.equal(cases, 108);
});

test('Claude + DeepSeek contains only a Keychain lookup and isolated config; no secret enters env', async t => {
  const f = fixture(t); f.memory.setSettings({ enabled: false });
  const built = await f.launch.build({ harnessId: 'claude', endpointId: 'ep-deepseek', model: 'deepseek-flash[1m]' });
  assert.match(built.command, /ANTHROPIC_AUTH_TOKEN="\$\(\/usr\/bin\/security find-generic-password/);
  assert.match(built.command, /-s 'de\.multiterminal\.endpoint' -a 'ep-deepseek' -w\)"/);
  assert.equal(built.env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(built.env.ANTHROPIC_API_KEY, '');
  assert.equal(built.env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
  assert.equal(built.env.CLAUDE_CONFIG_DIR, path.join(f.dataDir, 'endpoint-configs', 'claude', 'ep-deepseek'));
  assert.equal(fs.statSync(built.env.CLAUDE_CONFIG_DIR).mode & 0o777, 0o700);
  assert.equal(fs.existsSync(path.join(built.env.CLAUDE_CONFIG_DIR, 'settings.json')), false);
  assert.ok(built.label.includes('DeepSeek'));
});

test('Codex custom provider emits required TOML configuration and quotes unusual URLs', async t => {
  const f = fixture(t); f.memory.setSettings({ enabled: false });
  f.endpoint({ id: 'ep-openai', label: 'Custom', type: 'openai', baseUrl: 'https://api.example.test/v1/"quoted"', defaultModel: 'org/model', hasSecret: true });
  const built = await f.launch.build({ harnessId: 'codex', endpointId: 'ep-openai' });
  assert.match(built.command, /model_provider="mt"/);
  assert.match(built.command, /model_providers\.mt\.wire_api="responses"/);
  assert.match(built.command, /model_providers\.mt\.env_key="MT_ENDPOINT_KEY"/);
  assert.match(built.command, /model_providers\.mt\.base_url="https:\/\/api\.example\.test\/v1\/\\"quoted\\""/);
  assert.equal(built.env.MT_ENDPOINT_KEY, undefined);
});

test('OpenCode model/provider, resume and prompt are argv data; apostrophes in prompt stay literal', async t => {
  const f = fixture(t); f.memory.setSettings({ enabled: false });
  const built = await f.launch.build({ harnessId: 'opencode', model: 'provider/model', resume: { sessionId: ID }, prompt: "run 'quoted' $(touch BAD)" });
  const bin = path.join(f.root, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'opencode'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
  const argv = execFileSync('/bin/sh', ['-c', built.command], { cwd: f.root, encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH } }).trim().split('\n');
  assert.deepEqual(argv, ['--session', ID, '-m', 'provider/model', '--prompt', "run 'quoted' $(touch BAD)"]);
  assert.equal(fs.existsSync(path.join(f.root, 'BAD')), false);
});

test('model validation, missing endpoints, unsupported resume/prompt and command bound fail closed', async t => {
  const f = fixture(t); f.memory.setSettings({ enabled: false });
  for (const model of ["bad'$(id)", 'a'.repeat(201), 'two words', 'bad\nmodel']) await assert.rejects(f.launch.build({ harnessId: 'opencode', model }), /Modellname/);
  await assert.rejects(f.launch.build({ harnessId: 'claude', endpointId: 'missing' }), /Endpunkt nicht gefunden/);
  await assert.rejects(f.launch.build({ harnessId: 'claude', resume: { sessionId: '-bad-id' } }), /Gesprächs-ID/);
  await assert.rejects(f.launch.build({ harnessId: 'kimi', prompt: 'unsupported' }), /Startauftrag/);
  await assert.rejects(f.launch.build({ harnessId: 'opencode', prompt: 'x'.repeat(1990) }), /2000 Zeichen/);
  await assert.rejects(f.launch.build({ harnessId: 'claude', prompt: 'a\rb' }), /Auftragstext/);
  const prefix = (await f.launch.build({ harnessId: 'opencode', prompt: 'x' })).command.length - 1;
  assert.equal((await f.launch.build({ harnessId: 'opencode', prompt: 'x'.repeat(2000 - prefix) })).command.length, 2000);
  await assert.rejects(f.launch.build({ harnessId: 'opencode', prompt: 'x'.repeat(2001 - prefix) }), /2000 Zeichen/);
});

test('unconfirmed entries launch only their bare binary, regardless of optional requested flags', async t => {
  const f = fixture(t);
  for (const entry of f.catalog.list().filter(entry => entry.evidence === 'unconfirmed')) {
    assert.equal((await f.launch.build({ harnessId: entry.id, model: 'model', resume: 'last', prompt: 'ignored', fullAccess: true })).command, entry.binary);
  }
});

test('foreign harness receives project-bound Memory only via its declared prompt argv', async t => {
  const f = fixture(t); f.memory.setSettings({ enabled: true });
  const built = await f.launch.build({ harnessId: 'opencode', model: 'p/m' });
  assert.match(built.command, /--prompt 'Lies die Memory-Datei/);
  const files = fs.readdirSync(path.join(f.dataDir, 'memory-contexts'));
  assert.equal(files.length, 1);
  assert.match(fs.readFileSync(path.join(f.dataDir, 'memory-contexts', files[0]), 'utf8'), /aktuelle Projekt project/);
});

test('Claude endpoint map and missing key errors never fall back to default paid account', async t => {
  const f = fixture(t); f.memory.setSettings({ enabled: false });
  f.endpoint({ id: 'ep-custom', label: 'Custom', type: 'anthropic', baseUrl: 'https://example.test', modelMap: { sonnet: 'org/fast', subagent: 'org/small' }, hasSecret: false });
  await assert.rejects(f.launch.build({ harnessId: 'claude', endpointId: 'ep-custom' }), /kein Schlüssel/);
  f.endpoint({ id: 'ep-custom', label: 'Custom', type: 'anthropic', baseUrl: 'https://example.test', modelMap: { sonnet: 'org/fast', subagent: 'org/small' }, hasSecret: true });
  const built = await f.launch.build({ harnessId: 'claude', endpointId: 'ep-custom' });
  assert.equal(built.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'org/fast');
  assert.equal(built.env.CLAUDE_CODE_SUBAGENT_MODEL, 'org/small');
});

test('key lookup failure or empty value aborts before starting the CLI, success stays process-scoped', async t => {
  const f = fixture(t); f.memory.setSettings({ enabled: false });
  const built = await f.launch.build({ harnessId: 'claude', endpointId: 'ep-deepseek' });
  assert.equal(built.env.ANTHROPIC_MODEL, undefined, 'optional model does not create an empty variable');
  const bin = path.join(f.root, 'bin'); fs.mkdirSync(bin);
  const security = path.join(bin, 'security');
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nprintf "CLI_STARTED"\n', { mode: 0o755 });
  const line = built.command.replace('/usr/bin/security', security);
  const options = { cwd: f.root, env: { ...process.env, PATH: bin + ':' + process.env.PATH }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  for (const script of ['#!/bin/sh\nexit 1\n', '#!/bin/sh\nexit 0\n']) {
    fs.writeFileSync(security, script, { mode: 0o755 });
    assert.throws(() => execFileSync('/bin/sh', ['-c', line], options), error => {
      assert.equal(error.status, 1);
      assert.equal(error.stdout, '');
      assert.match(error.stderr, /Endpunkt-Schlüssel konnte nicht geladen/);
      return true;
    });
  }
  fs.writeFileSync(security, '#!/bin/sh\nprintf "DUMMY_TEST_TOKEN"\n', { mode: 0o755 });
  const output = execFileSync('/bin/sh', ['-c', line + '; printf "AFTER:%s" "${ANTHROPIC_AUTH_TOKEN-unset}"'], options);
  assert.equal(output, 'CLI_STARTEDAFTER:unset');
  const traced = require('node:child_process').spawnSync('/bin/sh', ['-xc', line], options);
  assert.equal(traced.status, 0);
  assert.equal(traced.stdout, 'CLI_STARTED');
  assert.equal(traced.stderr.includes('DUMMY_TEST_TOKEN'), false);
});

test('Memory + explicit prompt is exactly one positional argument after all provider flags', async t => {
  const f = fixture(t); f.memory.setSettings({ enabled: true });
  const bin = path.join(f.root, 'bin'); fs.mkdirSync(bin);
  for (const harnessId of ['claude', 'codex']) {
    fs.writeFileSync(path.join(bin, harnessId), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
    for (const resume of [undefined, 'last', { sessionId: ID }]) {
      const built = await f.launch.build({ harnessId, model: 'p/m', resume, prompt: '--help' });
      const args = execFileSync('/bin/sh', ['-c', built.command], { cwd: f.root, encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH } }).trim().split('\n');
      const delimiter = args.indexOf('--');
      assert.ok(delimiter >= 0);
      assert.equal(args.length, delimiter + 2);
      assert.ok(args.slice(0, delimiter).includes(harnessId === 'claude' ? '--model' : '-m'));
      assert.ok(args.at(-1).endsWith('--help'));
      if (!(harnessId === 'codex' && resume === 'last')) assert.match(args.at(-1), /^Lies die Memory-Datei/);
    }
  }
});

test('new raw argument interfaces expose profile, memory and catalog resume without changing legacy behavior', async t => {
  const f = fixture(t);
  const { resumeFromCatalog, buildResume } = require('../src/main/agent-session-service');
  for (const provider of ['claude', 'codex', 'kimi']) {
    assert.deepEqual(f.profile.argsFor(provider), []);
    f.profile.setEnabled(provider, true);
    const args = f.profile.argsFor(provider);
    assert.ok(args.length > 0);
    if (provider === 'kimi') assert.deepEqual(f.profile.argsFor(provider, { resume: true }), []);
    assert.deepEqual(resumeFromCatalog(f.catalog.get(provider), ID), buildResume(provider, ID));
  }
  assert.equal(resumeFromCatalog(f.catalog.get('claude'), 'short'), null);
  f.memory.setSettings({ enabled: false });
  assert.deepEqual(f.memoryLaunch.contextArgs({ harnessId: 'opencode', projectId: 'project' }), []);
  f.memory.setSettings({ enabled: true });
  assert.deepEqual(f.memoryLaunch.contextArgs({ harnessId: 'kimi', resume: 'last', projectId: 'project' }), []);
  const args = f.memoryLaunch.contextArgs({ harnessId: 'codex', resume: 'last', projectId: 'project' });
  assert.equal(args[0], '-c');
  assert.match(args[1], /developer_instructions=/);
  assert.match(args[1], /PERSONAL PROFILE/);
});

test('linkShared exports isolation that retains hooks but never settings.json or credentials', t => {
  const f = fixture(t), home = path.join(f.root, 'home'), target = path.join(f.root, 'isolated');
  const { linkShared } = require('../src/main/account-store');
  fs.mkdirSync(path.join(home, '.claude', 'hooks'), { recursive: true }); fs.mkdirSync(target);
  for (const name of ['settings.json', '.credentials.json', 'CLAUDE.md']) fs.writeFileSync(path.join(home, '.claude', name), '{}');
  linkShared('claude', target, { homeDir: home, isolateClaudeConfig: true });
  assert.equal(fs.existsSync(path.join(target, 'settings.json')), false);
  assert.equal(fs.existsSync(path.join(target, '.credentials.json')), false);
  assert.equal(fs.lstatSync(path.join(target, 'hooks')).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(path.join(target, 'CLAUDE.md')).isSymbolicLink(), true);
});

test('endpoint configuration refuses symlink destinations and Ollama custom URLs unsupported by Codex', async t => {
  const f = fixture(t); f.memory.setSettings({ enabled: false });
  const dir = path.join(f.dataDir, 'endpoint-configs', 'claude', 'ep-deepseek');
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.symlinkSync(f.root, dir);
  await assert.rejects(f.launch.build({ harnessId: 'claude', endpointId: 'ep-deepseek' }), /Unsicherer Endpunkt/);
  f.endpoint({ id: 'ep-ollama', label: 'Local', type: 'ollama', baseUrl: 'http://127.0.0.1:9999', hasSecret: false });
  await assert.rejects(f.launch.build({ harnessId: 'codex', endpointId: 'ep-ollama' }), /Standardendpunkt/);
  f.endpoint({ id: 'ep-ollama', label: 'Local', type: 'ollama', baseUrl: 'http://127.0.0.1:11434', hasSecret: false });
  const built = await f.launch.build({ harnessId: 'codex', endpointId: 'ep-ollama', model: 'local:model' });
  assert.match(built.command, /--oss --local-provider ollama/);
  assert.doesNotMatch(built.command, /security/);
});

test('own entries use declared profile injection and validated resume templates', async t => {
  const f = fixture(t); f.memory.setSettings({ enabled: false }); f.profile.setEnabled('claude', true);
  fs.writeFileSync(path.join(f.root, 'claude.md'), 'PERSONAL PROFILE\nMULTILINE $(touch BAD)');
  const custom = { ...JSON.parse(f.catalog.exportEntry('claude')), id: 'own-claude', label: 'Own Claude' };
  const userCatalog = createHarnessCatalog({ userFile: path.join(f.root, 'harnesses.json') });
  userCatalog.addOwn(custom);
  const launch = createHarnessLaunch({ catalog: userCatalog, agentProfile: f.profile, dataDir: f.dataDir });
  const built = await launch.build({ harnessId: 'own-claude', model: 'my/model', resume: { sessionId: ID } });
  assert.match(built.command, /claude --resume /);
  assert.match(built.command, /--append-system-prompt "\$\(cat /);
  assert.doesNotMatch(built.command, /\n/);
  const profileFiles = fs.readdirSync(path.join(f.dataDir, 'memory-contexts'));
  assert.equal(fs.readFileSync(path.join(f.dataDir, 'memory-contexts', profileFiles[0]), 'utf8'), 'PERSONAL PROFILE\nMULTILINE $(touch BAD)');
  assert.match(built.command, /--model my\/model/);
  const withEndpoint = createHarnessLaunch({ catalog: userCatalog, agentProfile: f.profile, dataDir: f.dataDir,
    keychain: createKeychain(), endpoints: { get: () => ({ id: 'ep-own', label: 'Own', type: 'anthropic', baseUrl: 'https://example.test', hasSecret: true, isolateClaudeConfig: true }) } });
  const endpointLaunch = await withEndpoint.build({ harnessId: 'own-claude', endpointId: 'ep-own' });
  assert.equal(endpointLaunch.env.CLAUDE_CONFIG_DIR, path.join(f.dataDir, 'endpoint-configs', 'claude', 'ep-own'));
  assert.equal(endpointLaunch.env.ANTHROPIC_API_KEY, '');
});
