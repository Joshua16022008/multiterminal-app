'use strict';

// Pure generators for the Claude Code status integration:
//  - hookSettings(): the settings JSON handed to `claude --settings <file>`.
//    It only adds hooks that call `mt-event`; the user's own settings stay as is.
//  - claudeWrapperScript(): the `claude` sh script placed first on the PATH of
//    app terminals. It adds `--settings <hooks file>` to interactive sessions
//    when (and only when) the hooks file exists.

const HOOK_EVENTS = Object.freeze(['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop', 'StopFailure', 'Notification', 'PermissionRequest']);

// Only these Notification types matter; the matcher saves a process start for the rest.
const NOTIFICATION_MATCHER = 'permission_prompt|elicitation_dialog|agent_needs_input';

// Hooks share a 1.5 s budget at SessionEnd; mt-event itself stops after ~1.2 s.
const HOOK_TIMEOUT_SECONDS = 2;

// Subcommands of `claude` (from `claude --help`, version 2.1.299). A call that
// starts with one of them is not an interactive session.
const CLAUDE_SUBCOMMANDS = Object.freeze([
  'agents', 'attach', 'auth', 'auto-mode', 'doctor', 'gateway', 'help', 'import', 'install', 'logs', 'mcp',
  'plugin', 'plugins', 'purge', 'respawn', 'rm', 'setup-token', 'stop', 'kill', 'ultrareview', 'update', 'upgrade',
]);

// Flags after which the call is not an interactive session (or already brings its own settings).
const PASSTHROUGH_FLAGS = Object.freeze(['--version', '-v', '-V', '--help', '-h', '-p', '--print', '--bare', '--settings', '--init-only']);

function shellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

// mtEventPath: absolute path of the `mt-event` wrapper.
function hookSettings({ mtEventPath }) {
  if (typeof mtEventPath !== 'string' || !mtEventPath.startsWith('/')) throw new Error('mtEventPath muss ein absoluter Pfad sein.');
  const hooks = {};
  for (const name of HOOK_EVENTS) {
    const group = { hooks: [{ type: 'command', command: `${shellQuote(mtEventPath)} ${name}`, timeout: HOOK_TIMEOUT_SECONDS }] };
    if (name === 'Notification') group.matcher = NOTIFICATION_MATCHER;
    hooks[name] = [group];
  }
  return { hooks };
}

function hookSettingsJson(opts) {
  return JSON.stringify(hookSettings(opts), null, 2) + '\n';
}

// Mirror of the decision the sh wrapper makes, for tests and documentation.
// `tty` is true when stdin and stdout are terminals.
function isInteractiveInvocation(args, tty = true) {
  if (!tty) return false;
  if (args.length && CLAUDE_SUBCOMMANDS.includes(args[0])) return false;
  for (const a of args) {
    if (PASSTHROUGH_FLAGS.includes(a)) return false;
    if (a.startsWith('--settings=') || a.startsWith('--print=')) return false;
  }
  return true;
}

// hooksFile: absolute path of the hooks settings file. If it is missing, the
// wrapper passes everything through unchanged.
function claudeWrapperScript({ hooksFile }) {
  if (typeof hooksFile !== 'string' || !hooksFile.startsWith('/')) throw new Error('hooksFile muss ein absoluter Pfad sein.');
  const subs = CLAUDE_SUBCOMMANDS.join('|');
  const flags = PASSTHROUGH_FLAGS.join('|');
  return `#!/bin/sh
# claude wrapper of Multiterminal: finds the real claude and, for interactive
# sessions, adds the status hooks (--settings) when they are switched on in the app.
HOOKS=${shellQuote(hooksFile)}
SELF_DIR=$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)
REAL=""
OLD_IFS=$IFS
IFS=:
for d in $PATH; do
  [ -n "$d" ] || continue
  D=$(cd "$d" 2>/dev/null && pwd -P) || continue
  [ "$D" = "$SELF_DIR" ] && continue
  if [ -f "$D/claude" ] && [ -x "$D/claude" ]; then REAL="$D/claude"; break; fi
done
IFS=$OLD_IFS
if [ -z "$REAL" ]; then
  echo "claude wurde nicht gefunden (kein 'claude' im PATH ausserhalb von Multiterminal)." >&2
  exit 127
fi
if [ -f "$HOOKS" ] && [ -t 0 ] && [ -t 1 ]; then
  case "\${1-}" in
    ${subs}) exec "$REAL" "$@" ;;
  esac
  for a in "$@"; do
    case "$a" in
      ${flags}|--settings=*|--print=*) exec "$REAL" "$@" ;;
    esac
  done
  exec "$REAL" --settings "$HOOKS" "$@"
fi
exec "$REAL" "$@"
`;
}

// `mt-event` sh script for <dataDir>/bin: silent, always exit 0, stdin passes through.
function eventWrapperScript({ execPath, scriptPath }) {
  return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 ${shellQuote(execPath)} ${shellQuote(scriptPath)} "$@" >/dev/null 2>&1\nexit 0\n`;
}

// `.zshenv` of the ZDOTDIR shim (<dataDir>/zdotdir). The user's .zshrc often puts ~/.local/bin in
// front of our bin folder, so the `claude` wrapper would be skipped. The shim gives ZDOTDIR back
// (unset when it was not set before, so zsh then reads the normal files from $HOME), sources the
// user's own .zshenv and puts binDir first in PATH once, at the first prompt (after all startup
// files). Prints nothing and tolerates a missing add-zsh-hook.
function zdotdirZshenv({ binDir }) {
  if (typeof binDir !== 'string' || !binDir.startsWith('/')) throw new Error('binDir muss ein absoluter Pfad sein.');
  return `# Multiterminal: ZDOTDIR shim, see agent-wrapper.js
if [[ -n "\${MULTITERMINAL_ORIG_ZDOTDIR-}" ]]; then
  ZDOTDIR="$MULTITERMINAL_ORIG_ZDOTDIR"
else
  unset ZDOTDIR
fi
unset MULTITERMINAL_ORIG_ZDOTDIR
if [[ -r "\${ZDOTDIR:-$HOME}/.zshenv" ]]; then
  source "\${ZDOTDIR:-$HOME}/.zshenv"
fi
_mt_path_first() {
  local d=${shellQuote(binDir)}
  path=("$d" \${path:#\${(b)d}})
  precmd_functions=(\${precmd_functions:#_mt_path_first})
  unfunction _mt_path_first 2>/dev/null
}
precmd_functions+=(_mt_path_first)
`;
}

module.exports = {
  zdotdirZshenv, eventWrapperScript, HOOK_EVENTS, NOTIFICATION_MATCHER, CLAUDE_SUBCOMMANDS, PASSTHROUGH_FLAGS,
  shellQuote, hookSettings, hookSettingsJson, isInteractiveInvocation, claudeWrapperScript,
};
