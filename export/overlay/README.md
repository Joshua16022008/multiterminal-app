# Multiterminal

A macOS workspace for terminal-based coding agents. Keep projects in a sidebar, run real terminals side by side, and open a mini-browser in each tile.

**UI currently in German.** The built-in [user guide](docs/guide/README.md) is also in German.

<!-- Screenshot: add a capture of the public edition before publication. -->

## Features

- Up to 30 terminals per project, with saved layouts and restored terminal output.
- Quick starts for Claude Code, Codex, Kimi Code and custom commands.
- A harness and model catalog, endpoint profiles and credentials stored in the macOS Keychain.
- A Git worktree tree, project diffs, port overview and terminal handoffs.
- File, image and clipboard attachments, project context and shared notes.
- Built-in help with configurable keyboard shortcuts.

Provider support varies by harness; see the [guide](docs/guide/harnesses-modelle.md). Install and authenticate the agent CLIs you want to use separately.

## Requirements

- macOS on Apple Silicon (arm64).
- Git and your chosen agent CLIs.
- The GitHub CLI (`gh`) for cloning from GitHub through the app.
- Node.js LTS and npm when building from source.

## Download and install

When published, macOS builds are distributed as DMG files through this repository's **GitHub Releases** page.

1. Download the DMG and its `.sha256` file. In the download folder, run `shasum -a 256 -c <file>.dmg.sha256`.
2. Open the DMG and drag **Multiterminal.app** onto **Applications**.
3. Launch the app from Applications.

Initial builds are unsigned and not notarized. If macOS blocks a build you trust, try Finder → right-click the app → **Open** and follow the macOS prompt. If needed, remove the quarantine attribute for this downloaded app:

```bash
xattr -dr com.apple.quarantine "/Applications/Multiterminal.app"
```

Close the app before replacing an older installation. Agent subscriptions and CLI installations are separate from this app.

## Build from source

```bash
npm install
npm start
npm test
npm run build
npm run release
```

`npm run build` writes `dist/Multiterminal-darwin-arm64/Multiterminal.app`.
`npm run release` builds that app and writes a DMG plus SHA256 file under `dist/release/`.
Creating a DMG requires a native macOS session with access to disk-image services. Source tests do not verify a packaged app.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), the [harness catalog schema](docs/harness-catalog.md), [SECURITY.md](SECURITY.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Deutsch

Multiterminal bündelt Projekte, echte Terminals und Mini-Browser in einer macOS-App. Die Oberfläche und die [Anleitung](docs/guide/README.md) sind Deutsch. Agenten-CLIs selbst installieren und anmelden; die App enthält keine Anbieterabonnements. Veröffentlichte DMGs stehen unter GitHub Releases.

## License

[MIT — The Multiterminal Authors](LICENSE).
