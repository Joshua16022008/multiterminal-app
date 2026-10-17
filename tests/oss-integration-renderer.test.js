'use strict';

// Integration (Etappe 3a), renderer side: page markup, script order, and the app.js
// pieces that connect the Stammbaum and the help panel. GUI behaviour itself is covered
// by scripts/qa-worktree-tree.js and scripts/qa-help.js in a real Electron window.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = path.join(__dirname, '../src/renderer');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
const pos = (needle) => { const i = html.indexOf(needle); assert.ok(i >= 0, 'missing in index.html: ' + needle); return i; };

test('index.html loads layout before view, markdown before help, all before app.js', () => {
  const s = (name) => pos(`<script src="${name}"></script>`);
  assert.ok(s('tree-layout.js') < s('worktree-tree.js'));
  assert.ok(s('terminal-pane.js') < s('worktree-tree.js'), 'D.h comes from terminal-pane.js');
  assert.ok(s('tree-layout.js') < s('terminal-pane.js'), 'branch chip colours need DeckTreeLayout');
  assert.ok(s('command-palette.js') < s('help-panel.js'));
  assert.ok(s('guide-markdown.js') < s('help-panel.js'));
  for (const name of ['worktree-tree.js', 'help-panel.js']) assert.ok(s(name) < s('app.js'), name);
  pos('<link rel="stylesheet" href="worktree-tree.css">');
  pos('<link rel="stylesheet" href="help.css">');
  for (const file of ['tree-layout.js', 'worktree-tree.js', 'guide-markdown.js', 'help-panel.js', 'worktree-tree.css', 'help.css']) {
    assert.ok(fs.existsSync(path.join(dir, file)), file);
  }
});

test('the page scripts share one global scope without clashing top-level names', () => {
  // Classic <script>s share the global lexical scope: a second top-level `const api` is a
  // SyntaxError at load time. Compiling them as one script catches that without a browser.
  const local = [...html.matchAll(/<script src="([^"/.][^"]*)"><\/script>/g)].map((m) => m[1]).filter((src) => !src.startsWith('..'));
  assert.ok(local.includes('tree-layout.js') && local.includes('help-panel.js'));
  const source = local.map((src) => fs.readFileSync(path.join(dir, src), 'utf8')).join('\n;\n');
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'index-scripts.js' }));
});

test('topbar has the Stammbaum button right of title and counter (hidden until git is known) and a help button', () => {
  const title = pos('<h1 id="ws-title">'), counter = pos('<span id="counter"'), tree = pos('<button id="btn-tree"');
  assert.ok(title < counter && counter < tree);
  assert.ok(tree < pos('<span class="spacer">'), 'directly next to the project name, before the spacer');
  assert.match(html, /<button id="btn-tree"[^>]*\shidden[\s>]/);
  assert.match(html, /<button id="btn-help"[^>]*aria-controls="help-panel"[^>]*>\?<\/button>/);
  assert.match(html, /<section id="worktree-view" hidden aria-label="Arbeitskopien-Stammbaum"><\/section>/);
});

test('panesFor maps tiles to branches by workspaceId, project-folder tiles to the project node', () => {
  const start = app.indexOf('    function panesForNode(');
  const end = app.indexOf('    function focusProjectOf(');
  assert.ok(start > 0 && end > start, 'panesForNode present');
  const pane = (id, title, workspaceId, activity) => ({ id, desc: { title, workspaceId }, activity: () => activity });
  const panes = [pane('a', 'Plain', undefined, 'working'), pane('b', 'Feature', 'ws-1', 'waiting'), pane('c', 'Other', 'ws-2', null)];
  const context = vm.createContext({ panesOf: (pid) => (pid === 'p1' ? panes : []), lastTree: null });
  vm.runInContext(app.slice(start, end) + '\nthis.panesForNode = panesForNode; this.setTree = (t) => { lastTree = t; };', context);
  const plain = (v) => JSON.parse(JSON.stringify(v)); // results come from another VM realm
  assert.deepEqual(plain(context.panesForNode('project')), [], 'no tree loaded yet');
  context.setTree({ projectId: 'p1', tree: { nodes: [
    { id: 'project', kind: 'project', workspaceId: null },
    { id: 'ws-1', kind: 'managed', workspaceId: 'ws-1' },
    { id: 'path:abc', kind: 'external', workspaceId: null },
  ] } });
  assert.deepEqual(plain(context.panesForNode('project')), [{ id: 'a', title: 'Plain', activity: 'working' }]);
  assert.deepEqual(plain(context.panesForNode('ws-1')), [{ id: 'b', title: 'Feature', activity: 'waiting' }]);
  assert.deepEqual(plain(context.panesForNode('path:abc')), [], 'an external branch has no tiles before adopting');
  assert.deepEqual(plain(context.panesForNode('missing')), []);
});

test('app.js wires hotkey actions, palette entries, hooks and panel exclusion', () => {
  for (const id of ["'worktree-tree'", "'help'"]) assert.ok(app.includes(id), id);
  assert.match(app, /case 'worktree-tree':/);
  assert.match(app, /case 'help': closeMenu\(\); showHelp\(\); return true;/);
  const palette = app.slice(app.indexOf('const paletteActions'), app.indexOf('let paletteReturn'));
  assert.ok(palette.includes("'worktree-tree'") && palette.includes("'help'"), 'both actions reachable from the palette');
  assert.match(app, /onBranchClick: \(pane\) =>/);
  assert.match(app, /setHooks\(\{\s*panesFor: panesForNode,/);
  for (const hook of ['onJump', 'onOpenTerminal', 'onStartAgent', 'onShowDiff', 'onAdopt', 'onClose']) assert.ok(app.includes(hook + ':'), hook);
  assert.match(app, /D\.agentLaunch\.open\(\{ project, workspaceId: workspaceId \|\| null \}\)/);
  assert.match(app, /newTerminal\(project\.id, null, undefined, workspace \|\| undefined\)/);
  // Opening settings closes the Stammbaum and the help panel; the help panel closes the other right panels.
  const settings = app.slice(app.indexOf('function showSettings('), app.indexOf('D.settingsPanel.init('));
  assert.ok(settings.includes('D.worktreeTree.close()') && settings.includes('showHelp(false)'));
  assert.match(app, /settingsOpen = !\$\('settings-panel'\)\.hidden \|\| !\$\('worktree-view'\)\.hidden/);
});

test('the hotkey table hook renders every action with its current binding', () => {
  const start = app.indexOf('    function hotkeyTable(');
  const end = app.indexOf('    if (window.DeckHelp && api.guide)');
  assert.ok(start > 0 && end > start);
  const hk = require('../src/renderer/hotkeys.js');
  const h = (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat().filter(Boolean) });
  const node = { replaceChildren(...c) { this.children = c; } };
  const context = vm.createContext({ window: { DeckHotkeys: hk }, h, hotkeyBindings: hk.defaults('darwin') });
  vm.runInContext(app.slice(start, end) + '\nthis.hotkeyTable = hotkeyTable;', context);
  context.hotkeyTable(node);
  const texts = [];
  const visit = (n) => { if (!n || !n.props) return; if (n.props.text) texts.push(n.props.text); n.children.forEach(visit); };
  node.children.forEach(visit);
  assert.ok(texts.includes('Hilfe öffnen') && texts.includes(hk.format('Cmd+Shift+H')));
  assert.ok(texts.includes('Stammbaum / Arbeitskopien') && texts.includes(hk.format('Cmd+Shift+Y')));
});
