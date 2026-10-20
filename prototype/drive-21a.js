'use strict';

// Experimental, pure-data protocol. This module is not loaded by index.html.
const { createHash, randomUUID } = require('node:crypto');

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') throw Error('Valor no serializable');
  return JSON.stringify(value);
}

const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const assert = (condition, message) => { if (!condition) throw Error(message); };

function validateMovement(tx) {
  assert(tx && typeof tx.id === 'string' && tx.id, 'ID de movimiento invalido');
  assert(['income', 'expense', 'transfer'].includes(tx.type), 'Tipo de movimiento invalido');
  assert(['done', 'pending'].includes(tx.status), 'Estado de movimiento invalido');
  assert(tx.amount !== null && tx.amount !== '' && Number.isFinite(Number(tx.amount)) && Number(tx.amount) >= 0, 'Importe invalido');
  assert(typeof tx.account === 'string' && tx.account, 'Cuenta de origen invalida');
  assert(typeof tx.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(tx.date), 'Fecha invalida');
  if (tx.type === 'transfer') assert(typeof tx.toAccount === 'string' && tx.toAccount, 'Cuenta de destino invalida');
}

function validateV1(snapshot) {
  assert(snapshot && snapshot.version === 1, 'Se requiere una copia version: 1');
  for (const key of ['accounts', 'transactions', 'lists', 'budgets', 'goals', 'debts', 'categories']) {
    assert(Array.isArray(snapshot[key]), 'Coleccion v1 ausente: ' + key);
  }
  assert(snapshot.categories.every(c => typeof c === 'string'), 'Categorias v1 invalidas');
  for (const key of ['accounts', 'transactions', 'lists', 'goals', 'debts']) {
    const ids = snapshot[key].map(item => item?.id);
    assert(ids.every(id => typeof id === 'string' && id), 'ID v1 invalido en ' + key);
    assert(new Set(ids).size === ids.length, 'ID v1 repetido en ' + key);
  }
  assert(snapshot.accounts.length > 0 && snapshot.accounts.every(a => typeof a.name === 'string' && Number.isFinite(Number(a.opening ?? 0))), 'Cuentas v1 invalidas');
  assert(snapshot.budgets.every(b => b && typeof b.category === 'string' && Number.isFinite(Number(b.amount))), 'Presupuestos v1 invalidos');
  assert(snapshot.goals.every(g => typeof g.name === 'string' && Number.isFinite(Number(g.target))), 'Metas v1 invalidas');
  assert(snapshot.debts.every(d => typeof d.name === 'string' && Number.isFinite(Number(d.balance))), 'Deudas v1 invalidas');
  assert(snapshot.lists.every(l => typeof l.name === 'string'), 'Listas v1 invalidas');
  snapshot.transactions.forEach(validateMovement);
  const accounts = new Set(snapshot.accounts.map(a => a.id));
  for (const tx of snapshot.transactions) {
    assert(accounts.has(tx.account) && (tx.type !== 'transfer' || accounts.has(tx.toAccount)), 'Referencia de cuenta v1 invalida');
  }
}

function prepareGenesis(local, remote) {
  validateV1(local);
  validateV1(remote);
  assert(digest(local) === digest(remote), 'Copias v1 divergentes: requiere decision explicita');
  const snapshot = copy(local);
  // The prototype contains only synthetic fixtures. Production migration must
  // separately remove device-local secrets and validate all legacy references.
  assert(!snapshot.settings || !['cloudKey', 'syncSecret', 'cloudUrl'].some(key => snapshot.settings[key]), 'Ajustes privados no admitidos en el prototipo');
  return { protocol: 1, kind: 'genesis', id: 'g-' + digest(snapshot), snapshot };
}

function envelope(commit) {
  return { payload: copy(commit), sha256: digest(commit) };
}

function unpack(file) {
  assert(file && file.payload && file.sha256 === digest(file.payload), 'Commit incompleto o corrupto');
  const commit = file.payload;
  assert(commit.protocol === 1 && typeof commit.id === 'string' && commit.id, 'Protocolo o ID invalido');
  assert(commit.kind === 'genesis' || commit.kind === 'change', 'Tipo de commit invalido');
  if (commit.kind === 'genesis') {
    validateV1(commit.snapshot);
    assert(commit.id === 'g-' + digest(commit.snapshot), 'Genesis no coincide con su contenido');
  } else {
    assert(typeof commit.root === 'string' && Array.isArray(commit.parents) && commit.parents.length, 'Ancestro ausente');
    assert(new Set(commit.parents).size === commit.parents.length, 'Padres repetidos');
    const op = commit.operation;
    assert(op && op.collection === 'transactions' && typeof op.id === 'string' && op.id, 'Operacion no admitida');
    assert(op.before === null || typeof op.before === 'string', 'Precondicion invalida');
    assert(op.after === null || op.after && op.after.id === op.id, 'Movimiento invalido');
    if (op.after !== null) validateMovement(op.after);
  }
  return commit;
}

async function scan(transport, pageSize = 2) {
  const commits = new Map();
  const pages = new Set();
  let cursor = null;
  do {
    const page = await transport.list(cursor, pageSize);
    assert(page && Array.isArray(page.files) && !page.incomplete, 'Listado remoto incompleto');
    for (const file of page.files) {
      const content = await transport.get(file.id);
      const commit = unpack(content);
      const previous = commits.get(commit.id);
      assert(!previous || digest(previous) === digest(commit), 'ID logico reutilizado con contenido distinto');
      commits.set(commit.id, commit);
    }
    cursor = page.nextPageToken ?? null;
    if (cursor !== null) {
      assert(!pages.has(cursor), 'Paginacion ciclica');
      pages.add(cursor);
    }
  } while (cursor !== null);
  return commits;
}

function resolve(commits, rootId) {
  const root = commits.get(rootId);
  assert(root?.kind === 'genesis', 'Genesis ausente');
  assert([...commits.values()].filter(c => c.kind === 'genesis').every(c => c.id === rootId), 'Bases v1 incompatibles');
  const ancestors = new Map();
  const visiting = new Set();
  const ancestry = id => {
    if (ancestors.has(id)) return ancestors.get(id);
    assert(!visiting.has(id), 'Ciclo en el historial');
    const commit = commits.get(id);
    assert(commit, 'Falta un commit padre');
    visiting.add(id);
    const result = new Set();
    if (commit.kind === 'change') {
      assert(commit.root === rootId, 'Raiz incompatible');
      for (const parent of commit.parents) {
        result.add(parent);
        for (const prior of ancestry(parent)) result.add(prior);
      }
      assert(result.has(rootId), 'Cambio sin genesis');
    }
    visiting.delete(id);
    ancestors.set(id, result);
    return result;
  };
  for (const id of commits.keys()) ancestry(id);

  const base = new Map(root.snapshot.transactions.map(t => [t.id, copy(t)]));
  const byRecord = new Map();
  for (const commit of commits.values()) {
    if (commit.kind !== 'change') continue;
    const key = commit.operation.id;
    if (!byRecord.has(key)) byRecord.set(key, []);
    byRecord.get(key).push(commit);
  }
  const conflicts = [];
  for (const [id, edits] of byRecord) {
    for (const edit of edits) {
      const prior = edits.filter(other => ancestry(edit.id).has(other.id));
      const latest = prior.filter(other => !prior.some(next => next !== other && ancestry(next.id).has(other.id)));
      assert(latest.length <= 1, 'Un cambio depende de un conflicto no resuelto');
      const before = latest.length ? latest[0].operation.after : base.get(id) ?? null;
      assert(edit.operation.before === (before === null ? null : digest(before)), 'Precondicion de registro incorrecta');
    }
    const heads = edits.filter(edit => !edits.some(other => other !== edit && ancestry(other.id).has(edit.id)));
    if (heads.length > 1) {
      conflicts.push({ id, commits: heads.map(c => c.id).sort() });
      continue;
    }
    const next = heads[0].operation.after;
    if (next === null) base.delete(id);
    else base.set(id, copy(next));
  }

  const accounts = new Set(root.snapshot.accounts.map(a => a.id));
  for (const tx of base.values()) {
    assert(accounts.has(tx.account), 'Cuenta de origen inexistente');
    if (tx.type === 'transfer') assert(accounts.has(tx.toAccount), 'Cuenta de destino inexistente');
  }
  return { transactions: [...base.values()].sort((a, b) => a.id.localeCompare(b.id)), conflicts };
}

class Client {
  constructor(id, transport, genesis, checkpoint = null) {
    this.id = id;
    this.transport = transport;
    this.root = genesis.id;
    this.known = checkpoint ? new Map(checkpoint.known.map(c => [c.id, c])) : new Map([[genesis.id, genesis]]);
    this.pending = checkpoint ? checkpoint.pending : [];
    assert(this.known.get(genesis.id)?.kind === 'genesis', 'Diario sin genesis');
    this.view();
  }

  view() { return resolve(this.known, this.root); }

  checkpoint() { return copy({ known: [...this.known.values()], pending: this.pending }); }

  stage(id, after) {
    const current = this.view();
    assert(!current.conflicts.length, 'Conflicto pendiente: no se crean cambios encima');
    const before = current.transactions.find(t => t.id === id) ?? null;
    assert(after === null || after.id === id, 'ID de movimiento cambiado');
    const heads = [...this.known.keys()].filter(key => ![...this.known.values()].some(c => c.kind === 'change' && c.parents.includes(key)));
    const commit = {
      protocol: 1, kind: 'change', id: this.id + '-' + randomUUID(), root: this.root, parents: heads,
      operation: { collection: 'transactions', id, before: before === null ? null : digest(before), after: after === null ? null : copy(after) }
    };
    this.known.set(commit.id, commit);
    this.pending.push(commit);
    try { this.view(); } catch (error) {
      this.known.delete(commit.id);
      this.pending.pop();
      throw error;
    }
    return commit.id;
  }

  async sync() {
    for (const commit of [...this.pending]) {
      const fileId = await this.transport.create(envelope(commit));
      assert(digest(unpack(await this.transport.get(fileId))) === digest(commit), 'Lectura posterior distinta');
      this.pending.shift();
    }
    const discovered = await scan(this.transport);
    for (const [id, commit] of this.known) {
      assert(discovered.has(id) && digest(discovered.get(id)) === digest(commit), 'Commit conocido no visible en listado');
    }
    const view = resolve(discovered, this.root);
    this.known = discovered;
    // A complete list of Drive at one instant is not proven by this scan.
    return { ...view, status: view.conflicts.length ? 'conflict' : 'locally-verified-only' };
  }
}

module.exports = { Client, canonical, digest, envelope, prepareGenesis, resolve, scan, unpack };
