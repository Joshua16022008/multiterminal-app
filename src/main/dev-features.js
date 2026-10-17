'use strict';

// NUR ENTWICKLERVERSION. Wird beim öffentlichen Export weggelassen (docs/dev/edition.md).
// Bündelt alles, was an Joshuas Arbeitsumgebung hängt: Second-Brain-Projektordner,
// Diktat über Flüsterflow und die Second-Brain-Aufgaben. Gemeinsame Dateien kennen nur
// edition.js; die Module hier werden erst geladen, wenn die Funktion eingeschaltet ist.

const fs = require('node:fs');
const path = require('node:path');

// Heutige Werte der Entwicklerversion (gelten ohne edition.json).
const EDITION = Object.freeze({
  appName: 'Multiterminal',
  bundleId: 'de.joshua.multiterminal',
  features: Object.freeze({ dictation: true, taskLink: true, secondBrain: true }),
});

const TASK_LINK_LABEL = 'Second-Brain-Aufgabe der Kachel';
// Info.plist: Flüsterflow nimmt als Kindprozess dieser App über das Mikrofon auf.
const MICROPHONE_USAGE = 'Für das Diktat in ein Terminal (Flüsterflow, lokal auf diesem Mac).';

function secondBrainProjects(home) {
  return path.join(home, 'Desktop', 'Second_Brain', 'Arbeit', 'Ai Builds and projekts', 'Claude_code_tasks', 'Projekte');
}

// New clones go next to the existing projects (null when that folder is missing).
function projectsDir(home) {
  const dir = secondBrainProjects(home);
  return fs.existsSync(dir) ? dir : null;
}

function createDictation({ home, ...options }) {
  const { createDictation: create } = require('./dictation');
  return create({ serviceDir: path.join(secondBrainProjects(home), 'Flüsterflow'), ...options });
}

// Second Brain nur lesend, ausschließlich im Main-Prozess (kein Origin-Header).
// Lokale Adresse für Tests/QA: MULTITERMINAL_TASKS_URL (gemeinsame QA) oder MULTITERMINAL_SECOND_BRAIN_URL.
function createTasks(env = process.env) {
  const { createSecondBrainTasks, resolveBaseUrl } = require('./second-brain-tasks');
  return createSecondBrainTasks({ baseUrl: resolveBaseUrl(env.MULTITERMINAL_TASKS_URL || env.MULTITERMINAL_SECOND_BRAIN_URL) });
}

// Label of the task action in the shared hotkey model (menus, palette, settings).
function applyHotkeyLabels(model) {
  if (model && typeof model.setLabel === 'function') model.setLabel('task-link', TASK_LINK_LABEL);
}

module.exports = { EDITION, TASK_LINK_LABEL, MICROPHONE_USAGE, projectsDir, createDictation, createTasks, applyHotkeyLabels };
