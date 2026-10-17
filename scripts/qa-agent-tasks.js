'use strict';
// Manual QA with local fixtures only. No CLI/model provider is launched, and the
// user's running app is not touched. Electron/PTY boundaries use stand-ins.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, ['--test', 'tests/agent-task-app.test.js', 'tests/agent-task-main.test.js',
  'tests/agent-task-service.test.js', 'tests/mt-agent-cli.test.js', 'tests/agent-tasks-ui.test.js', 'tests/browser-bridge.test.js'], {
  cwd: path.resolve(__dirname, '..'), env: { ...process.env, TMPDIR: '/private/tmp' }, stdio: 'inherit',
});
if (result.error) console.error(result.error.message);
if (result.status === 0) console.log(JSON.stringify({ result: 'passed', scope: 'real main/socket/CLI/store/Git worktree/context, dummy PTYs and DOM fixtures', providerCalls: 0, guiVerified: false }));
process.exitCode = result.status === null ? 1 : result.status;
