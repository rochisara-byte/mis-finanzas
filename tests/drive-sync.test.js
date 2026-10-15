const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const KEY = 'mis-finanzas-offline-v1';
const BASE = 'mis-finanzas-google-drive-base-v1';

class Storage {
  constructor(seed = {}) { this.data = { ...seed }; }
  getItem(key) { return Object.hasOwn(this.data, key) ? this.data[key] : null; }
  setItem(key, value) { this.data[key] = String(value); }
  removeItem(key) { delete this.data[key]; }
}

class Element {
  constructor() {
    this.innerHTML = '';
    this.textContent = '';
    this.style = { setProperty() {}, removeProperty() {} };
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.dataset = {};
  }
  addEventListener() {}
  querySelector() { return new Element(); }
  querySelectorAll() { return []; }
  closest() { return null; }
  prepend() {}
  append() {}
  remove() {}
  setAttribute() {}
  focus() {}
}

function data(overrides = {}) {
  return {
    version: 1, device: 'dispositivo-ficticio', revision: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    accounts: [{ id: 'caja', name: 'Caja ficticia', type: 'cash', opening: 50 }],
    transactions: [{ id: 'mov-1', type: 'expense', title: 'Ejemplo', amount: 5,
      date: '2026-01-10', account: 'caja', status: 'pending', repeat: 'monthly', created: '2026-01-01T00:00:00.000Z',
      recurrenceRootId: 'mov-1', generatedNextId: 'mov-2' }],
    lists: [{ id: 'lista', name: 'Ejemplo' }], categories: ['Ejemplo'],
    budgets: [{ category: 'Ejemplo', amount: 10 }],
    debts: [{ id: 'deuda', name: 'Ejemplo', balance: 20 }],
    goals: [{ id: 'meta', name: 'Ejemplo', target: 30 }],
    settings: { cloudUrl: '', cloudKey: '', syncId: '', syncSecret: '', lastSync: '' },
    ...overrides,
  };
}

function response(body) {
  return { ok: true, status: 200, json: async () => body,
    text: async () => typeof body === 'string' ? body : JSON.stringify(body) };
}

function drive(files = []) {
  const copies = files.map(file => ({ ...file }));
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' });
    if (url.includes('/upload/drive/v3/files')) {
      const id = url.match(/\/files\/([^?]+)\?/i)?.[1];
      const raw = id ? options.body : options.body.split('\r\nContent-Type: application/json\r\n\r\n')[1].split('\r\n--')[0];
      if (id) copies.find(file => file.id === id).body = raw;
      else copies.push({ id: 'creada', modifiedTime: '2026-02-01T00:00:00Z', body: raw });
      return response({ id: id || 'creada' });
    }
    if (url.includes('?alt=media')) {
      const id = url.match(/\/files\/([^?]+)\?/i)[1];
      const file = copies.find(item => item.id === id);
      if (!file) throw Error('Archivo ficticio no encontrado');
      return response(file.body);
    }
    if (url.includes('/drive/v3/files?')) {
      const page = new URL(url).searchParams.get('pageToken');
      const items = page === 'second' ? copies.slice(1) : copies.slice(0, 1);
      return response({ files: items.map(file => ({ id: file.id,
        name: 'mis-finanzas-sync-v1.json', modifiedTime: file.modifiedTime })),
        nextPageToken: !page && copies.length > 1 ? 'second' : undefined });
    }
    throw Error('Solicitud inesperada: ' + url);
  };
  return { copies, calls, fetch };
}

function app(local, service, choices = [], storage = new Storage({ [KEY]: JSON.stringify(local) }), online = true) {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const alerts = [];
  const context = {
    console, localStorage: storage, fetch: service.fetch, crypto: webcrypto,
    TextEncoder, Blob, URL, Intl,
    navigator: { onLine: online }, location: { protocol: 'https:' },
    document: { body: new Element(), hidden: false, createElement: () => new Element(),
      getElementById: get, querySelector: get, querySelectorAll: () => [], addEventListener() {} },
    window: { addEventListener() {}, dispatchEvent() {} },
    Event: function Event(type) { this.type = type; },
    alert: message => alerts.push(message), confirm: () => choices.shift() ?? false,
    prompt: () => '', setTimeout: () => 1, clearTimeout() {}, setInterval() {},
  };
  vm.createContext(context);
  vm.runInContext(scripts[0], context);
  vm.runInContext(scripts[1].replace(/\n\}\)\(\);\s*$/, `
globalThis.__drive = { sync, normalizeRemote, remote, hash, dataHash, snapshot,
  setToken() { token = 'ficticio'; tokenExpires = Date.now() + 600000; },
  get conflict() { return conflict; } };
})();`), context);
  context.__drive.setToken();
  return { api: context.__drive, storage, alerts };
}

async function test(name, run) {
  await run();
  console.log('ok - ' + name);
}

async function main() {
  await test('descarga válida y conservación de cuentas, movimientos, deudas, metas y recurrencias', async () => {
    const local = data();
    const remote = data({ accounts: [{ id: 'banco', name: 'Banco ficticio', type: 'bank', opening: 100 }],
      transactions: [data().transactions[0], { ...data().transactions[0], id: 'mov-2',
        recurrenceParentId: 'mov-1', recurrenceRootId: 'mov-1', generatedNextId: '' }],
      debts: [{ id: 'deuda', name: 'Ejemplo', balance: 40 }],
      goals: [{ id: 'meta', name: 'Ejemplo', target: 60 }] });
    const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
    const instance = app(local, service);
    instance.storage.setItem(BASE, await instance.api.hash(instance.api.snapshot()));
    await instance.api.sync();
    const saved = JSON.parse(instance.storage.getItem(KEY));
    assert.equal(saved.accounts[0].id, 'banco', JSON.stringify({ alerts: instance.alerts, calls: service.calls, base: instance.storage.getItem(BASE), conflict: instance.api.conflict }));
    assert.equal(saved.transactions[1].recurrenceParentId, 'mov-1');
    assert.deepEqual(saved.debts, remote.debts);
    assert.deepEqual(saved.goals, remote.goals);
    assert.equal(instance.storage.getItem(BASE), await instance.api.dataHash(instance.api.normalizeRemote(remote)));
    const reopened = app(saved, service, [], instance.storage);
    assert.equal(JSON.parse(reopened.storage.getItem(KEY)).transactions.length, 2);
  });

  await test('rechaza JSON corrupto y colecciones esenciales dañadas sin cambiar datos locales', async () => {
    for (const body of ['{incompleto', JSON.stringify({ ...data(), transactions: null }),
      JSON.stringify({ ...data(), transactions: [{ id: 'x' }] })]) {
      const local = data();
      const service = drive([{ id: 'rota', modifiedTime: '2026-01-02T00:00:00Z', body }]);
      const instance = app(local, service);
      await instance.api.sync(true);
      assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
      assert.equal(instance.storage.getItem(BASE), null);
      assert.equal(service.calls.filter(call => call.method !== 'GET').length, 0);
      assert.equal(instance.alerts.length, 1);
    }
  });

  await test('recupera copia antigua con colecciones opcionales ausentes', async () => {
    const legacy = data();
    delete legacy.version;
    delete legacy.goals;
    delete legacy.debts;
    delete legacy.budgets;
    delete legacy.lists;
    const instance = app(data(), drive([{ id: 'antigua', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify({ data: legacy }) }]));
    const normalized = await instance.api.remote();
    assert.equal(normalized.version, 1);
    assert.equal(normalized.transactions.length, 1);
    assert.deepEqual(Array.from(normalized.debts), []);
  });

  await test('copia antigua sin ajustes no provoca conflictos repetidos tras la descarga', async () => {
    const local = data({ settings: { cloudUrl: 'https://example.invalid', cloudKey: 'ficticia', syncId: 'dispositivo-local', syncSecret: 'ficticio' } });
    const old = data({ revision: 3 });
    delete old.settings;
    const service = drive([{ id: 'antigua', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(old) }]);
    const instance = app(local, service);
    instance.storage.setItem(BASE, await instance.api.hash(instance.api.snapshot()));
    await instance.api.sync();
    assert.equal(JSON.parse(instance.storage.getItem(KEY)).revision, 3);
    assert.equal(JSON.parse(instance.storage.getItem(KEY)).settings.syncId, 'dispositivo-local');
    await instance.api.sync();
    assert.equal(instance.api.conflict, false);
  });

  await test('conflicto conserva ambas copias al cancelar o rechazar la segunda confirmación', async () => {
    for (const choices of [[], [true, false]]) {
      const local = data({ revision: 2 });
      const remote = data({ revision: 3 });
      const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
      const instance = app(local, service, choices);
      await instance.api.sync(true);
      assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
      assert.equal(service.copies[0].body, JSON.stringify(remote));
      assert.equal(instance.api.conflict, true);
    }
  });

  await test('conflicto confirmado utiliza Drive y conserva ajustes locales heredados', async () => {
    const local = data({ revision: 2, settings: { cloudUrl: 'https://example.invalid', cloudKey: 'ficticia', syncId: 'ejemplo', syncSecret: 'ficticio' } });
    const remote = data({ revision: 3 });
    const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
    const instance = app(local, service, [true, true]);
    await instance.api.sync(true);
    const saved = JSON.parse(instance.storage.getItem(KEY));
    assert.equal(saved.revision, 3);
    assert.equal(saved.settings.syncId, 'ejemplo');
    assert.equal(service.copies[0].body, JSON.stringify(remote));
  });

  await test('selecciona la copia más reciente aunque la API entregue primero la antigua', async () => {
    const old = data({ revision: 1 });
    const latest = data({ revision: 3 });
    const service = drive([
      { id: 'vieja', modifiedTime: '2026-01-01T00:00:00Z', body: JSON.stringify(old) },
      { id: 'nueva', modifiedTime: '2026-01-03T00:00:00Z', body: JSON.stringify(latest) },
    ]);
    const instance = app(old, service);
    instance.storage.setItem(BASE, await instance.api.hash(instance.api.snapshot()));
    await instance.api.sync();
    assert.equal(JSON.parse(instance.storage.getItem(KEY)).revision, 3);
    assert.equal(service.copies.length, 2);
  });

  await test('pide confirmación si Drive reduce colecciones aunque la base local coincida', async () => {
    const local = data();
    const empty = data({ revision: 2, transactions: [], debts: [], goals: [] });
    const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(empty) }]);
    const instance = app(local, service);
    instance.storage.setItem(BASE, await instance.api.hash(instance.api.snapshot()));
    await instance.api.sync();
    assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
    assert.equal(instance.api.conflict, true);
  });

  await test('no sube una copia local ilegible ni reemplaza Drive', async () => {
    const local = data();
    const remote = data({ revision: 2 });
    const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
    const instance = app(local, service);
    instance.storage.setItem(KEY, '{local dañado');
    await instance.api.sync(true);
    assert.equal(instance.storage.getItem(KEY), '{local dañado');
    assert.equal(service.copies[0].body, JSON.stringify(remote));
    assert.equal(service.calls.length, 0);
  });

  await test('aborta la descarga cuando cambian datos locales durante la lectura', async () => {
    const local = data();
    const changed = data({ revision: 4 });
    const remote = data({ revision: 3 });
    const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
    const originalFetch = service.fetch;
    let storage;
    service.fetch = async (url, options) => {
      if (url.includes('?alt=media') && storage.getItem(KEY) === JSON.stringify(local)) storage.setItem(KEY, JSON.stringify(changed));
      return originalFetch(url, options);
    };
    const instance = app(local, service);
    storage = instance.storage;
    instance.storage.setItem(BASE, await instance.api.hash(instance.api.snapshot()));
    await instance.api.sync(true);
    assert.equal(instance.storage.getItem(KEY), JSON.stringify(changed));
    assert.equal(service.copies[0].body, JSON.stringify(remote));
    assert.equal(instance.alerts.length, 1);
  });

  await test('subida normal conserva la copia local y verifica lo almacenado en Drive', async () => {
    const remote = data();
    const local = data({ revision: 2 });
    const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
    const instance = app(local, service);
    instance.storage.setItem(BASE, await instance.api.hash(instance.api.normalizeRemote(remote)));
    await instance.api.sync();
    assert.equal(JSON.parse(service.copies[0].body).revision, 2);
    assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
    assert.equal(instance.storage.getItem(BASE), await instance.api.dataHash(instance.api.snapshot()));
  });

  await test('no usa una copia antigua cuando la más reciente está dañada', async () => {
    const local = data();
    const service = drive([
      { id: 'vieja', modifiedTime: '2026-01-01T00:00:00Z', body: JSON.stringify(data({ revision: 2 })) },
      { id: 'nueva', modifiedTime: '2026-01-03T00:00:00Z', body: 'incompleto' },
    ]);
    const instance = app(local, service);
    await instance.api.sync(true);
    assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
    assert.equal(service.copies.length, 2);
  });

  await test('sin conexión no lee ni sobrescribe Google Drive', async () => {
    const local = data();
    const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(data({ revision: 2 })) }]);
    const instance = app(local, service, [], undefined, false);
    await instance.api.sync();
    assert.equal(service.calls.length, 0);
    assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
  });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
