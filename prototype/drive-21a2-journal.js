'use strict';

// Experimental on-disk journal for synthetic checkpoints; never used by the app.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { digest } = require('./drive-21a');

function rejectSecrets(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (/token|secret|password|cloudKey|authorization/i.test(key)) throw Error('El diario no admite credenciales');
    rejectSecrets(nested);
  }
}

class ExperimentalJournal {
  constructor(directory) {
    const root = path.resolve(__dirname, '..');
    const target = path.resolve(directory || root);
    if (target === root || target.startsWith(root + path.sep)) throw Error('El diario debe estar fuera del repositorio');
    this.directory = target;
    this.filename = path.join(target, 'checkpoint.json');
  }

  async load() {
    let raw;
    try { raw = await fs.readFile(this.filename, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    let record;
    try { record = JSON.parse(raw); } catch { throw Error('Diario experimental ilegible'); }
    if (record?.sha256 !== digest(record.checkpoint)) throw Error('Diario experimental corrupto');
    rejectSecrets(record.checkpoint);
    return record.checkpoint;
  }

  async save(checkpoint) {
    rejectSecrets(checkpoint);
    const record = JSON.stringify({ checkpoint, sha256: digest(checkpoint) });
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.directory, 'checkpoint-' + randomUUID() + '.tmp');
    const file = await fs.open(temporary, 'wx', 0o600);
    try { await file.writeFile(record); await file.sync(); }
    finally { await file.close(); }
    await fs.rename(temporary, this.filename);
    const directory = await fs.open(this.directory, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
}

module.exports = { ExperimentalJournal };
