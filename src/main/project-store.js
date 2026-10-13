'use strict';

// Keeps the list of projects in one JSON file.
// This store never touches the project folders themselves.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_NAME_LENGTH = 80;

function cutName(value) {
  return Array.from(value).slice(0, MAX_NAME_LENGTH).join('');
}

function isValidProject(entry) {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    typeof entry.name === 'string' &&
    typeof entry.path === 'string' &&
    path.isAbsolute(entry.path)
  );
}

function createProjectStore(filePath) {
  // Copies a broken file aside so that nothing is lost, then returns [].
  function keepCorruptCopy() {
    try {
      fs.copyFileSync(filePath, filePath + '.corrupt');
    } catch (err) {
      // Nothing to copy or no permission: the store still works without it.
    }
  }

  function readAll() {
    let text;
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      keepCorruptCopy();
      return [];
    }

    if (!Array.isArray(data)) {
      keepCorruptCopy();
      return [];
    }
    return data.filter(isValidProject).map((p) => ({ id: p.id, name: p.name, path: p.path }));
  }

  // Writes to a temp file in the same folder, then renames it over the real file.
  function writeAll(projects) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = path.join(
      dir,
      `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`
    );
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(projects, null, 2) + '\n', 'utf8');
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      try {
        fs.rmSync(tmpPath, { force: true });
      } catch (cleanupErr) {
        // Ignore: the original error is more important.
      }
      throw err;
    }
  }

  function list() {
    return readAll();
  }

  function get(id) {
    return readAll().find((p) => p.id === id) || null;
  }

  function add({ name, path: projectPath } = {}) {
    if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) {
      throw new Error('Projektpfad muss ein absoluter Pfad sein.');
    }

    const projects = readAll();
    const existing = projects.find((p) => p.path === projectPath);
    if (existing) return existing;

    let trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed === '') {
      trimmed = path.basename(projectPath) || projectPath;
    }

    const project = {
      id: crypto.randomUUID(),
      name: cutName(trimmed),
      path: projectPath,
    };
    projects.push(project);
    writeAll(projects);
    return project;
  }

  function rename(id, name) {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error('Name darf nicht leer sein.');
    }

    const projects = readAll();
    const project = projects.find((p) => p.id === id);
    if (!project) {
      throw new Error(`Unbekanntes Projekt: ${id}`);
    }

    project.name = cutName(name.trim());
    writeAll(projects);
    return project;
  }

  function remove(id) {
    const projects = readAll();
    const remaining = projects.filter((p) => p.id !== id);
    if (remaining.length === projects.length) return false;
    writeAll(remaining);
    return true;
  }

  return { list, add, rename, remove, get };
}

module.exports = { createProjectStore };
