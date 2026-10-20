'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Client, envelope, prepareGenesis, resolve, scan } = require('../prototype/drive-21a');
const { Drive21A2Adapter, discoverWithChanges } = require('../prototype/drive-21a2-adapter');
const { ExperimentalJournal } = require('../prototype/drive-21a2-journal');

const NAMESPACE = 'mf21a2-abcdefghijklmnop';
const clone = value => JSON.parse(JSON.stringify(value));
const fixture = () => ({
  version: 1, device: 'ensayo', revision: 0, updatedAt: '2026-01-01T00:00:00Z',
  accounts: [{ id: 'cash', name: 'Efectivo', opening: 0 }, { id: 'bank', name: 'Banco', opening: 0 }],
  lists: [], categories: ['Otros'], transactions: [], budgets: [], goals: [], debts: [], settings: {}
});
const movement = (id, amount) => ({ id, type: 'expense', title: 'Ficticio', amount, category: 'Otros', date: '2026-01-01', account: 'cash', status: 'done' });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => clone(body), text: async () => typeof body === 'string' ? body : JSON.stringify(body) });

class FakeGoogleDrive {
  constructor() {
    this.files = [];
    this.changes = [];
    this.requests = [];
    this.offline = new Set();
    this.hidden = new Map();
    this.incomplete = false;
    this.lostAfterCreate = false;
    this.onListOnce = null;
    this.omitMetadata = false;
  }

  async fetch(input, options = {}) {
    const url = new URL(input);
    const method = options.method || 'GET';
    const bearer = options.headers?.Authorization;
    if (!['Bearer test-a', 'Bearer test-b'].includes(bearer)) return response({}, 401);
    if (this.offline.has(bearer)) throw Error('Sin conexion simulada');
    this.requests.push({ method, pathname: url.pathname, query: url.searchParams.toString() });
    if (url.pathname === '/upload/drive/v3/files' && method === 'POST') {
      assert.equal(url.searchParams.get('uploadType'), 'multipart');
      const pieces = options.body.split('\r\n\r\n');
      const metadata = JSON.parse(pieces[1].split('\r\n--')[0]);
      const content = JSON.parse(pieces[2].split('\r\n--')[0]);
      assert.deepEqual(metadata.parents, ['appDataFolder']);
      const id = 'file-' + (this.files.length + 1);
      this.files.push({ id, name: metadata.name, mimeType: metadata.mimeType, parents: metadata.parents, content });
      this.changes.push({ fileId: id, removed: false, file: { id, name: metadata.name, mimeType: metadata.mimeType, parents: metadata.parents } });
      if (this.lostAfterCreate) { this.lostAfterCreate = false; throw Error('Respuesta perdida'); }
      return response({ id, name: metadata.name, parents: metadata.parents });
    }
    if (url.pathname === '/drive/v3/files') {
      assert.equal(url.searchParams.get('spaces'), 'appDataFolder');
      assert.match(url.searchParams.get('q'), /^name contains 'mf21a2-/);
      const token = bearer.slice(7);
      const prefix = NAMESPACE + '-';
      const visible = this.files.filter(file => file.name.startsWith(prefix) && !this.hidden.get(token)?.has(file.id));
      const offset = Number(url.searchParams.get('pageToken') || 0);
      const limit = Number(url.searchParams.get('pageSize'));
      const page = visible.slice(offset, offset + limit);
      if (this.onListOnce) { const callback = this.onListOnce; this.onListOnce = null; await callback(); }
      return response({ files: page.map(({ id, name, mimeType, parents }) => ({ id, name, mimeType, parents })),
        nextPageToken: offset + limit < visible.length ? String(offset + limit) : undefined, incompleteSearch: this.incomplete });
    }
    if (url.pathname.startsWith('/drive/v3/files/')) {
      assert.equal(url.searchParams.get('alt'), 'media');
      const id = decodeURIComponent(url.pathname.split('/').pop());
      const found = this.files.find(file => file.id === id);
      return found ? response(found.content) : response({}, 404);
    }
    if (url.pathname === '/drive/v3/changes/startPageToken') return response({ startPageToken: String(this.changes.length) });
    if (url.pathname === '/drive/v3/changes') {
      assert.equal(url.searchParams.get('spaces'), 'appDataFolder');
      assert.equal(url.searchParams.get('restrictToMyDrive'), 'false');
      const offset = Number(url.searchParams.get('pageToken'));
      const limit = Number(url.searchParams.get('pageSize'));
      const page = this.changes.slice(offset, offset + limit).map(change => this.omitMetadata ? { fileId: change.fileId, removed: change.removed } : change);
      return response({ changes: page, nextPageToken: offset + limit < this.changes.length ? String(offset + limit) : undefined,
        newStartPageToken: offset + limit >= this.changes.length ? String(this.changes.length) : undefined });
    }
    throw Error('Ruta no simulada');
  }

  adapter(token = 'test-a') {
    return new Drive21A2Adapter({ fetchImpl: this.fetch.bind(this), accessToken: token, namespace: NAMESPACE, approvedTestEnvironment: true });
  }
}

async function setup() {
  const server = new FakeGoogleDrive();
  const genesis = prepareGenesis(fixture(), fixture());
  const aTransport = server.adapter('test-a');
  const bTransport = server.adapter('test-b');
  await aTransport.create(envelope(genesis));
  await bTransport.list();
  return { server, genesis, aTransport, bTransport,
    a: new Client('celular', aTransport, genesis), b: new Client('computador', bTransport, genesis) };
}

test('no existe acceso accidental sin permiso, transporte y namespace experimental', async () => {
  const server = new FakeGoogleDrive();
  const config = { fetchImpl: server.fetch.bind(server), accessToken: 'test-a', namespace: NAMESPACE };
  assert.throws(() => new Drive21A2Adapter(config), /no autorizado/);
  assert.throws(() => new Drive21A2Adapter({ ...config, approvedTestEnvironment: true, namespace: 'mis-finanzas-sync-v1' }), /Espacio experimental/);
  assert.throws(() => new ExperimentalJournal(path.resolve(__dirname, '..', 'diario')), /fuera del repositorio/);
  const adapter = server.adapter();
  await assert.rejects(adapter.request('https://example.com/drive/v3/files'), /Endpoint fuera/);
  await assert.rejects(adapter.request('https://www.googleapis.com/drive/v3/files/file-1', { method: 'PATCH' }), /Metodo de escritura no permitido/);
  assert.equal(server.requests.length, 0);
});

test('dos clientes crean altas simultaneas con POST inmutable y convergen', async () => {
  const { a, b, server } = await setup();
  a.stage('a', movement('a', 11));
  b.stage('b', movement('b', 22));
  await Promise.all([a.sync(), b.sync()]);
  assert.deepEqual((await a.sync()).transactions.map(t => t.id), ['a', 'b']);
  assert.deepEqual((await b.sync()).transactions.map(t => t.id), ['a', 'b']);
  assert.deepEqual(server.requests.map(r => r.method).filter(m => m !== 'GET'), ['POST', 'POST', 'POST']);
});

test('altas offline y diario local sobreviven cierre, respuesta perdida y reintento', async () => {
  const { a, b, aTransport, genesis, server } = await setup();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mf21a2-journal-'));
  const journal = new ExperimentalJournal(directory);
  a.stage('a', movement('a', 11));
  b.stage('b', movement('b', 22));
  await journal.save(a.checkpoint());
  server.offline.add('Bearer test-a');
  await assert.rejects(a.sync(), /Sin conexion/);
  server.offline.clear();
  server.lostAfterCreate = true;
  await assert.rejects(a.sync(), /Respuesta perdida/);
  const reopened = new Client('celular', aTransport, genesis, await journal.load());
  await reopened.sync(); await b.sync(); await reopened.sync();
  assert.deepEqual(reopened.view().transactions.map(t => t.id), ['a', 'b']);
  assert.equal((await scan(aTransport)).size, 3);
  assert.equal(server.files.length, 4); // Physical retry is allowed; logical duplicate is not.
});

test('listado paginado y changes.list recuperan un commit omitido durante el listado', async () => {
  const { server, aTransport, bTransport, genesis } = await setup();
  for (let n = 0; n < 4; n++) {
    const client = new Client('source-' + n, bTransport, genesis);
    client.stage('m' + n, movement('m' + n, n + 1));
    await client.sync();
  }
  const newClient = new Client('late', bTransport, genesis);
  newClient.stage('late', movement('late', 99));
  server.onListOnce = async () => {
    await newClient.sync();
    server.hidden.set('test-a', new Set([server.files.at(-1).id]));
  };
  const result = await discoverWithChanges(aTransport, 2);
  assert.equal(result.commits.size, 6);
  assert.deepEqual(resolve(result.commits, genesis.id).transactions.map(t => t.id), ['late', 'm0', 'm1', 'm2', 'm3']);
  assert.equal(result.status, 'observado-hasta-token-sin-garantia-global');
  assert.equal(result.nextToken, String(server.changes.length));
});

test('changes.list paginado no lee archivos ajenos y rechaza metadatos ambiguos', async () => {
  const { server, aTransport } = await setup();
  const token = '0';
  server.changes.push({ fileId: 'other-file', removed: false, file: { id: 'other-file', name: 'otro-archivo.json' } });
  const recovered = await aTransport.recoverChanges(token, 1);
  assert.equal(recovered.ids.length, 1);
  assert.equal(server.requests.some(r => r.pathname === '/drive/v3/files/other-file'), false);
  server.omitMetadata = true;
  await assert.rejects(aTransport.recoverChanges(token, 1), /Cambio sin metadatos/);
});

test('cambio que elimina un commit conocido detiene la recuperacion', async () => {
  const { server, aTransport } = await setup();
  const knownId = server.files[0].id;
  server.changes.push({ fileId: knownId, removed: true });
  await assert.rejects(aTransport.recoverChanges('1', 1), /eliminado o inaccesible/);
});

test('archivo parcial, listado incompleto y token de acceso denegado fallan cerrados', async () => {
  const { server, aTransport } = await setup();
  server.incomplete = true;
  await assert.rejects(scan(aTransport), /incompleto/);
  server.incomplete = false;
  server.files[0].content = { payload: { protocol: 1 } };
  await assert.rejects(scan(aTransport), /corrupto/);
  const denied = new Drive21A2Adapter({ fetchImpl: server.fetch.bind(server), accessToken: 'test-invalid', namespace: NAMESPACE, approvedTestEnvironment: true });
  await assert.rejects(denied.list(), /HTTP 401/);
  await assert.rejects(aTransport.get('file-no-permitido'), /fuera del espacio experimental/);
});

test('diario experimental rechaza credenciales y contenido alterado', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mf21a2-journal-'));
  const journal = new ExperimentalJournal(directory);
  await assert.rejects(journal.save({ accessToken: 'ficticio' }), /no admite credenciales/);
  await journal.save({ known: [], pending: [] });
  assert.deepEqual(await journal.load(), { known: [], pending: [] });
  await fs.writeFile(path.join(directory, 'checkpoint.json'), '{"checkpoint":{},"sha256":"incorrecto"}');
  await assert.rejects(journal.load(), /corrupto/);
});
