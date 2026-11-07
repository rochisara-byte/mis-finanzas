'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Client, envelope, prepareGenesis, scan } = require('../prototype/drive-21a');

const clone = value => JSON.parse(JSON.stringify(value));
const fixture = (transactions = []) => ({
  version: 1, device: 'fixture', revision: 0, updatedAt: '2026-01-01T00:00:00Z',
  accounts: [{ id: 'cash', name: 'Efectivo', opening: 0 }, { id: 'bank', name: 'Banco', opening: 0 }],
  lists: [], categories: ['Otros'], transactions, budgets: [], goals: [], debts: [], settings: {}
});
const movement = (id, amount = 10, extras = {}) => ({
  id, type: 'expense', title: 'Prueba', amount, category: 'Otros', date: '2026-01-01',
  account: 'cash', status: 'done', created: '2026-01-01T00:00:00Z', ...extras
});

class FakeDrive {
  constructor() {
    this.files = [];
    this.offline = new Set();
    this.unauthorized = new Set();
    this.hidden = new Map();
    this.failCreate = null;
    this.failGet = false;
    this.failList = false;
    this.incomplete = false;
  }

  access(client) {
    if (this.offline.has(client)) throw Error('Sin conexion');
    if (this.unauthorized.has(client)) throw Error('Sin autorizacion');
  }

  adapter(client) {
    return {
      create: async content => {
        this.access(client);
        if (this.failCreate === 'before') { this.failCreate = null; throw Error('Fallo antes de crear'); }
        const id = 'file-' + (this.files.length + 1);
        this.files.push({ id, content: clone(content) });
        if (this.failCreate === 'after') { this.failCreate = null; throw Error('Respuesta perdida despues de crear'); }
        return id;
      },
      get: async id => {
        this.access(client);
        if (this.failGet) { this.failGet = false; throw Error('Lectura interrumpida'); }
        const file = this.files.find(f => f.id === id);
        if (!file) throw Error('Archivo ausente');
        return clone(file.content);
      },
      list: async (cursor, pageSize) => {
        this.access(client);
        if (this.failList) { this.failList = false; throw Error('Listado interrumpido'); }
        const visible = this.files.filter(f => !this.hidden.get(client)?.has(f.id));
        const offset = cursor === null ? 0 : Number(cursor);
        const page = visible.slice(offset, offset + pageSize);
        const next = offset + pageSize < visible.length ? String(offset + pageSize) : null;
        return { files: page.map(f => ({ id: f.id })), nextPageToken: next, incomplete: this.incomplete };
      }
    };
  }
}

async function setup(snapshot = fixture()) {
  const drive = new FakeDrive();
  const genesis = prepareGenesis(snapshot, clone(snapshot));
  await drive.adapter('init').create(envelope(genesis));
  return { drive, genesis, a: new Client('celular', drive.adapter('a'), genesis), b: new Client('computador', drive.adapter('b'), genesis) };
}

const ids = client => client.view().transactions.map(t => t.id);

test('dos altas simultaneas conectadas convergen sin sobrescribir ni duplicar', async () => {
  const { a, b, drive } = await setup();
  a.stage('mov-a', movement('mov-a'));
  b.stage('mov-b', movement('mov-b'));
  await Promise.all([a.sync(), b.sync()]);
  assert.equal(drive.files.length, 3);
  assert.deepEqual((await a.sync()).transactions.map(t => t.id), ['mov-a', 'mov-b']);
  assert.deepEqual((await b.sync()).transactions.map(t => t.id), ['mov-a', 'mov-b']);
  assert.equal((await a.sync()).status, 'locally-verified-only');
});

test('dos altas offline permanecen locales y convergen al recuperar conexion', async () => {
  const { a, b, drive } = await setup();
  drive.offline.add('a'); drive.offline.add('b');
  a.stage('mov-a', movement('mov-a', 11));
  b.stage('mov-b', movement('mov-b', 22));
  assert.deepEqual(ids(a), ['mov-a']);
  assert.deepEqual(ids(b), ['mov-b']);
  await assert.rejects(a.sync(), /Sin conexion/);
  await assert.rejects(b.sync(), /Sin conexion/);
  drive.offline.clear();
  await a.sync(); await b.sync(); await a.sync();
  assert.deepEqual(ids(a), ['mov-a', 'mov-b']);
  assert.deepEqual(ids(b), ['mov-a', 'mov-b']);
  assert.equal(a.pending.length + b.pending.length, 0);
});

test('respuesta perdida y reintento duplican el archivo, no el movimiento', async () => {
  const { a, drive, b } = await setup();
  a.stage('mov-a', movement('mov-a'));
  drive.failCreate = 'after';
  await assert.rejects(a.sync(), /Respuesta perdida/);
  assert.equal(a.pending.length, 1);
  await a.sync(); await b.sync();
  assert.equal(drive.files.length, 3);
  assert.deepEqual(ids(b), ['mov-a']);
});

test('diario restaurado tras interrupcion reutiliza el mismo commit logico', async () => {
  const { a, b, drive, genesis } = await setup();
  a.stage('mov-a', movement('mov-a'));
  const saved = a.checkpoint();
  drive.failCreate = 'after';
  await assert.rejects(a.sync(), /Respuesta perdida/);
  const restarted = new Client('celular', drive.adapter('a'), genesis, saved);
  assert.equal(restarted.pending.length, 1);
  await restarted.sync(); await b.sync();
  assert.deepEqual(ids(b), ['mov-a']);
  assert.equal(drive.files.length, 3);
});

test('fallo de lectura posterior no confirma un commit aunque se haya escrito', async () => {
  const { a, b, drive } = await setup();
  a.stage('mov-a', movement('mov-a'));
  drive.failGet = true;
  await assert.rejects(a.sync(), /Lectura interrumpida/);
  assert.equal(a.pending.length, 1);
  await a.sync(); await b.sync();
  assert.deepEqual(ids(b), ['mov-a']);
});

test('dos ediciones del mismo movimiento se detectan como conflicto', async () => {
  const original = movement('mov-0');
  const { a, b } = await setup(fixture([original]));
  a.stage('mov-0', { ...original, amount: 20 });
  b.stage('mov-0', { ...original, amount: 30 });
  await a.sync(); await b.sync();
  const result = await a.sync();
  assert.equal(result.status, 'conflict');
  assert.equal(result.conflicts[0].id, 'mov-0');
  assert.equal(result.transactions[0].amount, 10);
  assert.equal(a.known.size, 3);
});

test('una edicion observada antes de otra mantiene causalidad y no crea conflicto', async () => {
  const original = movement('mov-0');
  const { a, b } = await setup(fixture([original]));
  a.stage('mov-0', { ...original, amount: 20 });
  await a.sync();
  await b.sync();
  b.stage('mov-0', { ...original, amount: 30 });
  await b.sync();
  const result = await a.sync();
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.transactions[0].amount, 30);
});

test('dos altas con el mismo ID y distinto contenido se bloquean', async () => {
  const { a, b } = await setup();
  a.stage('igual-id', movement('igual-id', 10));
  b.stage('igual-id', movement('igual-id', 20));
  await a.sync(); await b.sync();
  const result = await a.sync();
  assert.equal(result.status, 'conflict');
  assert.deepEqual(result.transactions, []);
  assert.equal(result.conflicts[0].id, 'igual-id');
});

test('borrado concurrente con edicion no resucita ni elimina silenciosamente', async () => {
  const original = movement('mov-0');
  const { a, b } = await setup(fixture([original]));
  a.stage('mov-0', null);
  b.stage('mov-0', { ...original, amount: 30 });
  await a.sync(); await b.sync();
  const result = await a.sync();
  assert.equal(result.status, 'conflict');
  assert.deepEqual(ids(a), ['mov-0']);
  assert.equal(a.known.size, 3);
});

test('transferencias validas conservan referencias; cuentas desconocidas se rechazan', async () => {
  const { a, b } = await setup();
  a.stage('transfer-1', movement('transfer-1', 50, { type: 'transfer', toAccount: 'bank' }));
  await a.sync(); await b.sync();
  assert.equal(b.view().transactions[0].toAccount, 'bank');
  assert.throws(() => a.stage('transfer-2', movement('transfer-2', 5, { type: 'transfer', toAccount: 'missing' })), /Cuenta de destino inexistente/);
  assert.deepEqual(ids(a), ['transfer-1']);
});

test('recurrencias identicas con IDs distintos no se colapsan por atributos', async () => {
  const { a, b } = await setup();
  a.stage('cuota-a', movement('cuota-a', 25, { repeat: 'monthly', recurrenceParentId: 'padre-a' }));
  b.stage('cuota-b', movement('cuota-b', 25, { repeat: 'monthly', recurrenceParentId: 'padre-b' }));
  await a.sync(); await b.sync(); await a.sync();
  assert.deepEqual(ids(a), ['cuota-a', 'cuota-b']);
  assert.equal(a.view().transactions[0].recurrenceParentId, 'padre-a');
});

test('listado paginado, incompleto, corrupto o sin padres falla sin aplicar datos', async () => {
  const { a, drive } = await setup();
  for (let n = 1; n <= 5; n++) a.stage('m-' + n, movement('m-' + n));
  await a.sync();
  assert.equal((await scan(drive.adapter('a'))).size, 6);
  drive.incomplete = true;
  await assert.rejects(a.sync(), /Listado remoto incompleto/);
  drive.incomplete = false;
  drive.files[1].content.payload.parents = ['padre-inexistente'];
  await assert.rejects(a.sync(), /corrupto/);
  drive.files[1].content.payload.parents = [a.root];
  drive.files[1].content = envelope(drive.files[1].content.payload);
  drive.files.push({ id: 'file-alien', content: envelope({
    protocol: 1, kind: 'change', id: 'alien-1', root: a.root, parents: ['padre-inexistente'],
    operation: { collection: 'transactions', id: 'alien', before: null, after: movement('alien') }
  }) });
  await assert.rejects(a.sync(), /Falta un commit padre/);
});

test('fallos de red, autorizacion, subida y listado mantienen el diario local', async () => {
  const { a, drive } = await setup();
  a.stage('mov-a', movement('mov-a'));
  drive.failCreate = 'before';
  await assert.rejects(a.sync(), /Fallo antes/);
  assert.equal(a.pending.length, 1);
  drive.unauthorized.add('a');
  await assert.rejects(a.sync(), /Sin autorizacion/);
  drive.unauthorized.clear();
  drive.failList = true;
  await assert.rejects(a.sync(), /Listado interrumpido/);
  assert.deepEqual(ids(a), ['mov-a']);
  await a.sync();
  assert.equal(a.pending.length, 0);
});

test('archivo parcial simulado se rechaza; no se proclama convergencia', async () => {
  const { a, drive } = await setup();
  a.stage('mov-a', movement('mov-a'));
  drive.files.push({ id: 'file-parcial', content: { payload: { protocol: 1 } } });
  await assert.rejects(a.sync(), /incompleto o corrupto/);
  assert.deepEqual(ids(a), ['mov-a']);
  assert.equal(a.view().conflicts.length, 0);
});

test('migracion v1 exige copias completas e iguales; ninguna se reescribe', () => {
  const local = fixture([movement('legacy')]);
  const remote = clone(local);
  const genesis = prepareGenesis(local, remote);
  assert.equal(genesis.snapshot.transactions[0].id, 'legacy');
  assert.deepEqual(local, remote);
  remote.transactions[0].amount = 99;
  assert.throws(() => prepareGenesis(local, remote), /divergentes/);
  const incomplete = clone(local);
  delete incomplete.budgets;
  assert.throws(() => prepareGenesis(local, incomplete), /Coleccion v1 ausente/);
  const broken = clone(local);
  broken.transactions[0].account = 'missing';
  assert.throws(() => prepareGenesis(broken, broken), /Referencia de cuenta v1 invalida/);
  const withSecret = clone(local);
  withSecret.settings.cloudKey = 'fictional-secret';
  assert.throws(() => prepareGenesis(withSecret, withSecret), /Ajustes privados/);
});

test('un commit temporalmente invisible no puede demostrarse ausente en Drive', async () => {
  const { a, b, drive } = await setup();
  a.stage('mov-a', movement('mov-a'));
  b.stage('mov-b', movement('mov-b'));
  await a.sync(); await b.sync();
  drive.hidden.set('a', new Set(['file-3']));
  const partial = await a.sync();
  assert.deepEqual(partial.transactions.map(t => t.id), ['mov-a']);
  assert.equal(partial.status, 'locally-verified-only');
  drive.hidden.clear();
  assert.deepEqual((await a.sync()).transactions.map(t => t.id), ['mov-a', 'mov-b']);
});
