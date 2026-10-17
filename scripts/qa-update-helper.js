'use strict';
// Safe local QA only: tests create temporary app fixtures and never target the
// installed app. The native helper test uses a fake opener instead of app launch.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, ['--test', 'tests/update-flow.test.js', 'tests/update-helper.test.js', 'tests/update-ipc.test.js', 'tests/update-ui.test.js', 'tests/pm-main.test.js'], {
  cwd: path.resolve(__dirname, '..'), env: { ...process.env, TMPDIR: '/private/tmp' }, stdio: 'inherit',
});
if (result.error) console.error(result.error.message);
if (result.status === 0) console.log(JSON.stringify({ result: 'passed', scope: 'PM controller/preload/IPC/service with stand-ins; independent native helper on temporary app bundles', liveAppChanged: false, guiVerified: false }));
process.exitCode = result.status === null ? 1 : result.status;
