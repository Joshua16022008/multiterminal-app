'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { shellQuote } = require('./agent-profile');
const { resumeFromCatalog } = require('./agent-session-service');
const { linkShared } = require('./account-store');
const { writePrivate } = require('./memory-launch');
const { expandArgv, isValidModel } = require('./harness-catalog');

const BUILTIN = new Set(['claude', 'codex', 'kimi']);
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,79}$/;
const ENDPOINT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const quote = word => /^[A-Za-z0-9_\-./=]+$/.test(word) ? word : shellQuote(word);
const unsafe = text => typeof text !== 'string' || /[\x00-\x1f\x7f]/.test(text);

function privateDirectory(dir) {
  let current = path.parse(path.resolve(dir)).root;
  for (const component of path.resolve(dir).slice(current.length).split(path.sep)) {
    current = path.join(current, component);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsicherer Endpunkt-Konfigurationsordner.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      fs.mkdirSync(current, { mode: 0o700 });
    }
  }
  fs.chmodSync(dir, 0o700);
  return dir;
}

// IPC §2. build is asynchronous because endpoint views consult Keychain metadata.
// For project Memory supply a project-bound memoryLaunch adapter; build's public
// argument shape deliberately contains no projectId or account selection.
function createHarnessLaunch({ catalog, endpoints, keychain, agentProfile, memoryLaunch, dataDir }) {
  if (!catalog || !agentProfile || !dataDir) throw new Error('Harness-Start ist nicht konfiguriert.');

  async function build({ harnessId, model, endpointId, prompt, resume, fullAccess } = {}) {
    const entry = catalog.get(harnessId);
    if (!entry) throw new Error('Unbekanntes Harness.');
    const claudeAdapter = entry.binary === 'claude' && entry.profileInjection === 'claude-append';
    const codexAdapter = entry.binary === 'codex' && entry.profileInjection === 'codex-developer';
    if (model != null && !isValidModel(model)) throw new Error('Ungültiger Modellname.');
    if (prompt != null && (unsafe(prompt) || prompt.length > 2000)) throw new Error('Ungültiger oder zu langer Auftragstext.');
    if (fullAccess !== undefined && typeof fullAccess !== 'boolean') throw new Error('Ungültige Startberechtigung.');
    if (resume != null && resume !== 'last' && (!resume || typeof resume !== 'object'
      || Array.isArray(resume) || Object.keys(resume).some(key => key !== 'sessionId')
      || typeof resume.sessionId !== 'string')) throw new Error('Ungültige Fortsetzen-Auswahl.');

    // Unconfirmed launch metadata never grants permission to synthesize flags.
    if (entry.evidence === 'unconfirmed') return { command: entry.binary, env: {}, provider: entry.id, label: entry.label };

    let endpoint = null;
    if (endpointId != null) {
      if (typeof endpointId !== 'string' || !ENDPOINT_ID.test(endpointId)) throw new Error('Ungültige Endpunkt-ID.');
      endpoint = await endpoints?.get(endpointId);
      if (!endpoint) throw new Error('Endpunkt nicht gefunden.');
      if (endpoint.id !== endpointId) throw new Error('Ungültige Endpunkt-Zuordnung.');
      if (!entry.endpoints?.[endpoint.type]) throw new Error('Dieses Harness unterstützt den Endpunkt-Typ nicht.');
      if (codexAdapter && endpoint.type === 'ollama'
        && !['http://127.0.0.1:11434', 'http://localhost:11434'].includes(endpoint.baseUrl.replace(/\/$/, ''))) {
        throw new Error('Für Codex ist derzeit nur der lokale Ollama-Standardendpunkt belegt.');
      }
    }
    const chosenModel = model ?? endpoint?.defaultModel ?? entry.defaultModel ?? null;
    if (chosenModel != null && !isValidModel(chosenModel)) throw new Error('Ungültiger Modellname.');
    if (chosenModel && !entry.model?.args?.length) throw new Error('Für dieses Harness ist keine Modellwahl belegt.');

    let argv;
    if (resume === 'last') {
      if (!entry.resume?.last) throw new Error('Dieses Harness unterstützt kein belegtes Fortsetzen.');
      argv = expandArgv(entry.resume.last);
    } else if (resume) {
      const built = resumeFromCatalog(entry, resume.sessionId);
      if (!built) throw new Error('Gesprächs-ID oder Fortsetzen wird nicht unterstützt.');
      argv = built.argv;
    } else argv = expandArgv(entry.start);

    let command = argv.map(quote).join(' ');
    const legacy = entry.builtin && BUILTIN.has(entry.id) && entry.binary === entry.id;
    const combineMemoryPrompt = legacy && Boolean(prompt) && entry.prompt?.args && !(entry.id === 'codex' && resume === 'last');
    if (legacy) {
      const decorator = combineMemoryPrompt ? agentProfile : (memoryLaunch || agentProfile);
      command = decorator.decorateCommand({ command, provider: entry.id, resume: Boolean(resume) });
    }

    const values = { model: chosenModel || '', baseUrl: endpoint?.baseUrl || '' };
    const env = {};
    const prefixes = [];
    const append = words => { if (words.length) command += ' ' + words.map(quote).join(' '); };
    if (!legacy && entry.profileInjection) {
      const provider = { 'claude-append': 'claude', 'codex-developer': 'codex', 'kimi-agent-file': 'kimi' }[entry.profileInjection];
      if (provider && agentProfile.argsFor) {
        const args = agentProfile.argsFor(provider, { resume: Boolean(resume) });
        if (provider === 'claude' && args.length) {
          // Profiles are usually multiline; keep them in a private file instead
          // of typing literal newlines into the interactive terminal shell.
          const file = writePrivate(dataDir, 'md', args[1]);
          command += ` --append-system-prompt "$(cat ${shellQuote(file)})"`;
        } else append(args);
      }
    }
    if (chosenModel) append(expandArgv(entry.model.args, values));
    if (!legacy && fullAccess && entry.id === 'codex' && entry.fullAccess) append(entry.fullAccess);

    let context = [];
    if ((!legacy || combineMemoryPrompt) && entry.prompt?.args && memoryLaunch?.contextArgs) {
      context = await memoryLaunch.contextArgs({ harnessId: entry.id, resume });
      if (!Array.isArray(context) || context.some(unsafe)) throw new Error('Ungültiger Memory-Kontext.');
    }
    const combinedPrompt = [...context, ...(prompt ? [prompt] : [])].join(' ');
    if (combinedPrompt && !entry.prompt?.args) throw new Error('Dieses Harness unterstützt keinen belegten Startauftrag.');

    if (endpoint) {
      const config = entry.endpoints[endpoint.type];
      if (unsafe(endpoint.baseUrl)) throw new Error('Ungültige Endpunkt-URL.');
      const u = new URL(endpoint.baseUrl);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('Ungültige Endpunkt-URL.');
      for (const [name, template] of Object.entries(config.env || {})) {
        if (!ENV_NAME.test(name)) throw new Error('Ungültige Endpunkt-Variable.');
        if (!chosenModel && template.includes('{model}')) continue;
        env[name] = expandArgv([template], values)[0];
      }
      if (claudeAdapter) {
        // Prevent an inherited account credential from selecting the paid default
        // provider; wrapper --settings remains on the claude executable itself.
        env.ANTHROPIC_API_KEY = '';
        if (endpoint.modelMap) {
          const names = { opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL', sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL', haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', subagent: 'CLAUDE_CODE_SUBAGENT_MODEL' };
          for (const [alias, name] of Object.entries(names)) {
            if (endpoint.modelMap[alias] != null) {
              if (!isValidModel(endpoint.modelMap[alias])) throw new Error('Ungültige Modellzuordnung.');
              env[name] = endpoint.modelMap[alias];
            }
          }
        }
        if (endpoint.isolateClaudeConfig !== false) {
          const dir = privateDirectory(path.join(dataDir, 'endpoint-configs', 'claude', endpoint.id));
          linkShared('claude', dir, { isolateClaudeConfig: true });
          // Refuse previously linked settings rather than loading account auth.
          const settings = path.join(dir, 'settings.json');
          try { if (fs.lstatSync(settings).isSymbolicLink()) throw new Error('Isolierte Claude-Einstellungen dürfen kein symbolischer Link sein.'); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          env.CLAUDE_CONFIG_DIR = dir;
        }
      }
      if (config.args) {
        // Codex templates embed the URL in a TOML basic string inside one argv
        // value. Escape it for TOML before the outer shell word is quoted.
        const argValues = codexAdapter ? { ...values, baseUrl: JSON.stringify(endpoint.baseUrl).slice(1, -1) } : values;
        append(expandArgv(config.args, argValues));
      }
      if (config.secretEnv) {
        if (!ENV_NAME.test(config.secretEnv)) throw new Error('Ungültige Schlüsselvariable.');
        if (!endpoint.hasSecret) {
          if (endpoint.type !== 'ollama') throw new Error('Für diesen Endpunkt ist kein Schlüssel gespeichert.');
          // Ollama's documented dummy credential is not an account secret.
          env[config.secretEnv] = 'ollama';
        } else {
          const lookup = keychain.lookupExpression(endpoint.id);
          // Keychain service is the sole authority for this shell expression.
          if (typeof lookup !== 'string' || !lookup.startsWith('$(/usr/bin/security ') || /[\r\n\0]/.test(lookup)) throw new Error('Ungültiger Schlüsselbund-Verweis.');
          // The assignment must succeed and contain a value before exec. A
          // subshell confines the credential to the launched process tree.
          prefixes.push({ name: config.secretEnv, lookup });
        }
      }
    }
    // All CLI options precede positional prompt delimiters, including endpoint
    // provider overrides. Prompt text never becomes a permission option.
    if (combinedPrompt) append(expandArgv(entry.prompt.args, { ...values, prompt: combinedPrompt }));
    let line = [...Object.entries(env).map(([name, value]) => `${name}=${shellQuote(value)}`), command].join(' ');
    for (const { name, lookup } of prefixes.reverse()) {
      line = `(set +x; ${name}="${lookup}" && [ -n "$${name}" ] || { printf '%s\\n' 'Endpunkt-Schlüssel konnte nicht geladen werden.' >&2; exit 1; }; export ${name}; ${line})`;
    }
    if (line.length > 2000 || /[\r\n\0]/.test(line)) throw new Error('Harness-Startbefehl ist ungültig oder länger als 2000 Zeichen.');
    return { command: line, env, provider: entry.id, label: [entry.label, endpoint?.label, chosenModel].filter(Boolean).join(' · ') };
  }

  return { build };
}

module.exports = { createHarnessLaunch };
