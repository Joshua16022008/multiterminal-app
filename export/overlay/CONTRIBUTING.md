# Contributing

Bug reports, focused fixes, documentation and verified harness catalog entries are welcome.

## Setup and validation

Use macOS on Apple Silicon with Node.js LTS, npm and Git:

```bash
npm ci
npm test
npm start
```

Tests use `node:test`. For UI changes, first run `node scripts/qa-env-check.js`, then an appropriate Electron script such as `./node_modules/.bin/electron scripts/qa-help.js`. Report source tests and actual GUI checks separately.

## Pull requests

Keep changes focused and explain the resulting behavior. Follow the surrounding CommonJS/vanilla JavaScript style. UI text is German. Update the relevant page in `docs/guide` when behavior changes. Add tests for meaningful behavior changes and run `npm test`. Discuss new runtime dependencies first. Do not include personal paths, account data, secrets or conversation logs.

## Add a harness

Catalog entries are JSON files in `src/main/harness-catalog`, loaded by `src/main/harness-catalog.js`. Follow the [catalog schema and contributor reference](docs/harness-catalog.md). Give the entry a stable ID, executable name and an accurate `verifiedWith` value. Contribute only arguments checked against that CLI; unsupported adapters must be stated explicitly. Add or update catalog tests and describe the CLI version and manual checks in the pull request.
