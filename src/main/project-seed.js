'use strict';

// Files written into a brand-new project folder that is still being planned.
// CLAUDE.md and AGENTS.md carry the same instruction, so Claude Code and Codex
// both start the planning chat without a long prompt on the command line.

const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;

// "Mein Projekt" -> "Mein-Projekt". Returns null when nothing usable is left.
function slugify(input) {
  if (typeof input !== 'string') return null;
  const slug = input.trim().replace(/\s+/g, '-');
  if (!NAME_PATTERN.test(slug) || slug.startsWith('.') || slug === '..') return null;
  return slug;
}

function planningInstruction(name) {
  return `# ${name} – Projektplanung

Dieses Projekt ist neu und befindet sich in der **Planungsphase**.

## Deine Aufgabe

1. Besprich das Projekt mit Joshua im Gespräch: Ziel, Nutzer, Kernfunktionen, Technik, Umfang und Reihenfolge.
   Stelle Rückfragen, jeweils nur wenige auf einmal. Schlage Optionen mit einer Empfehlung vor.
2. Halte den Stand laufend in \`PLAN.md\` fest (Ziel, Entscheidungen, Umfang, Schritte, offene Fragen).
3. Baue **nichts**, bevor Joshua ausdrücklich sagt, dass der Plan steht.
4. Sobald Joshua zustimmt: Lege das Projekt nach dem Plan an (Grundgerüst, \`README.md\`,
   passende \`CLAUDE.md\`/\`AGENTS.md\` für die Bauphase, \`.gitignore\`) und committe es.
   Ersetze dabei diese Planungsanweisung durch Projektregeln für die Bauphase.

## Grenzen

- Veröffentliche nichts auf GitHub und lege kein Repo an; das macht Joshua in der App.
- Ändere nichts außerhalb dieses Ordners.
`;
}

function planTemplate(name) {
  return `# ${name} – Plan

Status: Planung, noch nichts entschieden.

## Ziel

## Nutzer und Nutzen

## Kernfunktionen

## Technik

## Umfang (jetzt / später)

## Schritte

## Offene Fragen
`;
}

function seedFiles(name) {
  const instruction = planningInstruction(name);
  return { 'CLAUDE.md': instruction, 'AGENTS.md': instruction, 'PLAN.md': planTemplate(name) };
}

module.exports = { slugify, seedFiles, NAME_PATTERN };
