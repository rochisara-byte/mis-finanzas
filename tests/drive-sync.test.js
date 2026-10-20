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
  after() {}
  append() {}
  remove() {}
  setAttribute(name, value) { (this.attributes ||= {})[name] = value; }
  getAttribute(name) { return this.attributes?.[name] ?? null; }
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
  const copies = files.map(file => ({ name: 'mis-finanzas-sync-v1.json', ...file }));
  const calls = [];
  const service = { copies, calls, failCreate: false, failPatch: false, corruptCreated: false, corruptPatched: false, corruptPatchedSettings: false };
  const fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' });
    if (url.includes('/upload/drive/v3/files')) {
      const id = url.match(/\/files\/([^?]+)\?/i)?.[1];
      if (id && service.failPatch) throw Error('Fallo ficticio al actualizar archivo principal');
      if (!id && service.failCreate) throw Error('Fallo ficticio al crear respaldo');
      const raw = id ? options.body : options.body.split('\r\nContent-Type: application/json\r\n\r\n')[1].split('\r\n--')[0];
      if (id) copies.find(file => file.id === id).body = service.corruptPatched ? JSON.stringify(data({ revision: 999 }))
        : service.corruptPatchedSettings ? JSON.stringify({ ...JSON.parse(raw), settings: { ...JSON.parse(raw).settings, syncId: 'otro-ajuste-ficticio' } }) : raw;
      else {
        const metadata = JSON.parse(options.body.split('\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n')[1].split('\r\n--')[0]);
        copies.push({ id: `creada-${copies.length}`, name: metadata.name,
          modifiedTime: '2026-02-01T00:00:00Z', body: service.corruptCreated ? '{dañado' : raw });
      }
      return response({ id: id || copies.at(-1).id });
    }
    if (url.includes('?alt=media')) {
      const id = url.match(/\/files\/([^?]+)\?/i)[1];
      const file = copies.find(item => item.id === id);
      if (!file) throw Error('Archivo ficticio no encontrado');
      return response(file.body);
    }
    if (url.includes('/drive/v3/files?')) {
      const mainFiles = copies.filter(file => file.name === 'mis-finanzas-sync-v1.json');
      const page = new URL(url).searchParams.get('pageToken');
      const items = page === 'second' ? mainFiles.slice(1) : mainFiles.slice(0, 1);
      return response({ files: items.map(file => ({ id: file.id,
        name: file.name, modifiedTime: file.modifiedTime })),
        nextPageToken: !page && mainFiles.length > 1 ? 'second' : undefined });
    }
    throw Error('Solicitud inesperada: ' + url);
  };
  service.fetch = fetch;
  return service;
}

function app(local, service, choices = [], storage = new Storage({ [KEY]: JSON.stringify(local) }), online = true, auth = null) {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const alerts = [];
  const confirmations = [];
  const events = {};
  const timers = [];
  const requests = [];
  const google = auth && { accounts: { oauth2: { initTokenClient(options) {
    return { requestAccessToken(request) {
      requests.push(request);
      if (auth.result === 'success') options.callback({ access_token: 'token-ficticio', expires_in: auth.expires_in ?? 3500 });
      else if (auth.result === 'denied') options.callback({ error: 'access_denied' });
      else if (auth.result === 'interrupted') options.error_callback({ type: 'popup_closed' });
    } };
  } } } };
  const context = {
    console, localStorage: storage, fetch: service.fetch, crypto: webcrypto,
    TextEncoder, Blob, URL, Intl,
    navigator: { onLine: online }, location: { protocol: 'https:' },
    document: { body: new Element(), hidden: false, createElement: () => new Element(),
      getElementById: get, querySelector: get, querySelectorAll: () => [], addEventListener(name, fn) { events[name] = fn; } },
    window: { google, addEventListener(name, fn) { events[name] = fn; }, dispatchEvent() {} }, google,
    Event: function Event(type) { this.type = type; },
    alert: message => alerts.push(message), confirm: message => { confirmations.push(message); return choices.shift() ?? false; },
    prompt: () => '', setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {}, setInterval() {},
  };
  vm.createContext(context);
  vm.runInContext(scripts[0], context);
  vm.runInContext(scripts[1].replace(/\n\}\)\(\);\s*$/, `
globalThis.__drive = { sync, authorize, reconnectSilently, normalizeRemote, remote, hash, dataHash, snapshot,
  setToken() { token = 'ficticio'; tokenExpires = Date.now() + 600000; },
  expireToken() { tokenExpires = 0; },
  get conflict() { return conflict; }, get status() { return lastStatus; },
  get feedback() { return { barHidden: driveBar.hidden, barText: driveBarLabel.textContent,
    toastHidden: driveToast.hidden, toastText: driveToastMessage.textContent,
    toastRole: driveToast.getAttribute('role'), toastKey,
    dismiss: () => driveToastDismiss.onclick(), action: () => driveToastAction.onclick() }; } };
})();`), context);
  if (!auth) context.__drive.setToken();
  return { api: context.__drive, storage, alerts, confirmations, get, events, timers, requests, context };
}

async function resolve(instance, choice) {
  const result = instance.api.sync(true);
  const id = { local: 'driveKeepLocal', remote: 'driveUseRemote', cancel: 'driveConflictCancel' }[choice];
  for (let attempt = 0; attempt < 200 && !instance.get(id).onclick; attempt++) await new Promise(done => setTimeout(done, 1));
  assert.equal(typeof instance.get(id).onclick, 'function', `Debe abrirse el diálogo de conflicto: ${JSON.stringify(instance.alerts)} ${instance.get('modal').innerHTML.slice(0, 160)}`);
  instance.get(id).onclick();
  await result;
}

async function test(name, run) {
  await run();
  console.log('ok - ' + name);
}

async function main() {
  await test('descarga válida y conservación de cuentas, movimientos, deudas, metas y recurrencias', async () => {
    const local = data();
    const remote = data({ accounts: [...local.accounts, { id: 'banco', name: 'Banco ficticio', type: 'bank', opening: 100 }],
      transactions: [data().transactions[0], { ...data().transactions[0], id: 'mov-2',
        recurrenceParentId: 'mov-1', recurrenceRootId: 'mov-1', generatedNextId: '' }],
      debts: [...local.debts, { id: 'deuda-2', name: 'Otro ejemplo', balance: 40 }],
      goals: [...local.goals, { id: 'meta-2', name: 'Otro ejemplo', target: 60 }] });
    const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
    const instance = app(local, service, [true, true]);
    instance.storage.setItem(BASE, await instance.api.hash(instance.api.snapshot()));
    await resolve(instance, 'remote');
    const saved = JSON.parse(instance.storage.getItem(KEY));
    assert.equal(saved.accounts[1].id, 'banco');
    assert.deepEqual(saved.transactions[0], local.transactions[0]);
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
    const instance = app(local, service, [true, true]);
    instance.storage.setItem(BASE, await instance.api.hash(instance.api.snapshot()));
    await resolve(instance, 'remote');
    assert.equal(JSON.parse(instance.storage.getItem(KEY)).revision, 3);
    assert.equal(JSON.parse(instance.storage.getItem(KEY)).settings.syncId, 'dispositivo-local');
    await instance.api.sync();
    assert.equal(instance.api.conflict, false);
  });

  await test('conflicto conserva ambas copias al cancelar o rechazar la segunda confirmación', async () => {
    for (const scenario of [{ choice: 'cancel', answers: [] }, { choice: 'remote', answers: [true, false] }]) {
      const local = data({ revision: 2 });
      const remote = data({ revision: 3 });
      const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
      const instance = app(local, service, scenario.answers);
      await resolve(instance, scenario.choice);
      assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
      assert.equal(service.copies[0].body, JSON.stringify(remote));
      assert.equal(instance.api.conflict, true);
    }
  });

  await test('conflicto confirmado utiliza Drive y conserva ajustes locales heredados', async () => {
    const local = data({ revision: 2, settings: { cloudUrl: 'https://example.invalid', cloudKey: 'ficticia', syncId: 'ejemplo', syncSecret: 'ficticio', lastSync: 'registro-local', preference: 'local' } });
    const remote = data({ revision: 3, settings: { ...data().settings, lastSync: 'registro-remoto', preference: 'remota' } });
    const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
    const instance = app(local, service, [true, true]);
    await resolve(instance, 'remote');
    const saved = JSON.parse(instance.storage.getItem(KEY));
    assert.equal(saved.revision, 3);
    assert.equal(saved.settings.syncId, 'ejemplo');
    assert.equal(saved.settings.lastSync, 'registro-local');
    assert.equal(saved.settings.preference, 'local');
    assert.equal(service.copies[0].body, JSON.stringify(remote));
    assert.equal(instance.confirmations.length, 2);
  });

  await test('preserva ajustes locales modificados mientras se descarga Drive', async () => {
    const local = data();
    const remote = data({ revision: 3 });
    const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
    let storage;
    const originalFetch = service.fetch;
    service.fetch = async (url, options) => {
      if (url.includes('?alt=media') && storage) {
        const current = JSON.parse(storage.getItem(KEY));
        current.settings.syncId = 'ajuste-ficticio-nuevo';
        storage.setItem(KEY, JSON.stringify(current));
      }
      return originalFetch(url, options);
    };
    const instance = app(local, service, [true, true]);
    storage = instance.storage;
    instance.storage.setItem(BASE, await instance.api.dataHash(instance.api.snapshot()));
    await resolve(instance, 'remote');
    const saved = JSON.parse(instance.storage.getItem(KEY));
    assert.equal(saved.revision, 3);
    assert.equal(saved.settings.syncId, 'ajuste-ficticio-nuevo');
  });

  await test('selecciona la copia más reciente aunque la API entregue primero la antigua', async () => {
    const old = data({ revision: 1 });
    const latest = data({ revision: 3 });
    const service = drive([
      { id: 'vieja', modifiedTime: '2026-01-01T00:00:00Z', body: JSON.stringify(old) },
      { id: 'nueva', modifiedTime: '2026-01-03T00:00:00Z', body: JSON.stringify(latest) },
    ]);
    const instance = app(old, service, [true, true]);
    instance.storage.setItem(BASE, await instance.api.hash(instance.api.snapshot()));
    await resolve(instance, 'remote');
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

  await test('no descarga automáticamente movimientos con el mismo conteo e importe o ID diferente', async () => {
    for (const transaction of [
      { ...data().transactions[0], amount: 99 },
      { ...data().transactions[0], id: 'mov-ajeno' },
      { ...data().transactions[0], generatedNextId: 'otra-ocurrencia' },
    ]) {
      const local = data();
      const remote = data({ revision: 3, transactions: [transaction] });
      const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
      const instance = app(local, service);
      instance.storage.setItem(BASE, await instance.api.dataHash(instance.api.snapshot()));
      await instance.api.sync();
      assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
      assert.equal(instance.api.conflict, true);
      assert.equal(service.copies[0].body, JSON.stringify(remote));
      await resolve(instance, 'cancel');
      assert.equal(instance.confirmations.length, 0);
      assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
      assert.equal(service.copies[0].body, JSON.stringify(remote));
    }
  });

  await test('no descarga eliminaciones remotas aunque se agreguen otros registros', async () => {
    const local = data();
    const remote = data({ revision: 3, transactions: [
      { ...local.transactions[0], id: 'mov-nuevo-1' },
      { ...local.transactions[0], id: 'mov-nuevo-2' },
    ] });
    const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
    const instance = app(local, service);
    instance.storage.setItem(BASE, await instance.api.hash(instance.api.snapshot()));
    await instance.api.sync();
    assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
    assert.equal(instance.api.conflict, true);
  });

  await test('una base ausente o antigua no autoriza una descarga divergente', async () => {
    for (const base of [null, '0'.repeat(64), 'hash-de-otra-copia']) {
      const local = data();
      const remote = data({ revision: 3, transactions: [{ ...local.transactions[0], amount: 99 }] });
      const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
      const instance = app(local, service);
      if (base !== null) instance.storage.setItem(BASE, base);
      await instance.api.sync();
      assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
      assert.equal(instance.storage.getItem(BASE), base);
      assert.equal(instance.api.conflict, true);
    }
  });

  await test('una base antigua coincidente tampoco permite sustituciones del mismo tamaño', async () => {
    const local = data();
    const remote = data({ revision: 3, accounts: [{ ...local.accounts[0], opening: 999 }] });
    const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
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
    const instance = app(local, service, [true, true]);
    storage = instance.storage;
    instance.storage.setItem(BASE, await instance.api.hash(instance.api.snapshot()));
    await resolve(instance, 'remote');
    assert.equal(instance.storage.getItem(KEY), JSON.stringify(changed));
    assert.equal(service.copies[0].body, JSON.stringify(remote));
    assert.equal(instance.alerts.length, 1);
  });

  await test('subida normal conserva la copia local y verifica lo almacenado en Drive', async () => {
    const remote = data();
    const local = data({ revision: 2 });
    const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
    const instance = app(local, service, [true, true]);
    instance.storage.setItem(BASE, await instance.api.hash(instance.api.normalizeRemote(remote)));
    await instance.api.sync();
    assert.equal(instance.api.conflict, true);
    assert.equal(service.calls.filter(call => call.method !== 'GET').length, 0);
    await resolve(instance, 'local');
    assert.equal(JSON.parse(service.copies[0].body).revision, 2);
    assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
    assert.equal(instance.storage.getItem(BASE), await instance.api.dataHash(instance.api.snapshot()));
    assert.equal(instance.confirmations.length, 2);
    assert.equal(service.copies.length, 2);
    assert.match(service.copies[1].name, /^mis-finanzas-respaldo-/);
    assert.equal(service.copies[1].body, JSON.stringify(remote));
    assert.match(instance.alerts[0], /copia anterior sigue disponible/);
    await instance.api.sync();
    assert.equal(instance.api.conflict, false);
  });

  await test('primera sincronización sin archivo remoto crea solo el principal y verifica su lectura', async () => {
    const local = data();
    const service = drive();
    const instance = app(local, service);
    await instance.api.sync();
    assert.equal(service.copies.length, 1);
    assert.equal(service.copies[0].name, 'mis-finanzas-sync-v1.json');
    assert.deepEqual(JSON.parse(service.copies[0].body).transactions, local.transactions);
    assert.equal(instance.storage.getItem(BASE), await instance.api.dataHash(instance.api.snapshot()));
  });

  await test('conservar este dispositivo guarda todos los registros y vínculos de recurrencia', async () => {
    const baseMovement = data().transactions[0];
    const local = data({ revision: 4,
      accounts: [...data().accounts, { id: 'banco', name: 'Banco ficticio', type: 'bank', opening: 10 }],
      transactions: [baseMovement,
        { ...baseMovement, id: 'mov-2', recurrenceParentId: 'mov-1', recurrenceRootId: 'mov-1', generatedNextId: '', status: 'done' },
        { ...baseMovement, id: 'transferencia', type: 'transfer', toAccount: 'banco', amount: 12, status: 'done', repeat: '' },
        { ...baseMovement, id: 'aporte-meta', linkKind: 'goal', linkId: 'meta', status: 'done', repeat: '' },
        { ...baseMovement, id: 'abono-deuda', linkKind: 'debt', linkId: 'deuda', status: 'done', repeat: '' },
        { ...baseMovement, id: 'eliminado', deleted: true, repeat: '' }] });
    const remote = data({ revision: 2, transactions: [{ ...data().transactions[0], amount: 99 }] });
    const service = drive([{ id: 'principal', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
    const instance = app(local, service, [true, true]);
    await resolve(instance, 'local');
    const uploaded = JSON.parse(service.copies[0].body);
    assert.deepEqual(uploaded.accounts, local.accounts);
    assert.deepEqual(uploaded.transactions, local.transactions);
    assert.deepEqual(uploaded.budgets, local.budgets);
    assert.deepEqual(uploaded.debts, local.debts);
    assert.deepEqual(uploaded.goals, local.goals);
    assert.equal(service.copies[1].body, JSON.stringify(remote));
    assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
  });

  await test('cancelar o rechazar cualquiera de las dos confirmaciones locales no escribe en Drive', async () => {
    for (const scenario of [{ choice: 'cancel', answers: [] }, { choice: 'local', answers: [false] },
      { choice: 'local', answers: [true, false] }]) {
      const local = data({ revision: 4 });
      const remote = data({ revision: 2 });
      const service = drive([{ id: 'principal', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
      const instance = app(local, service, scenario.answers);
      await resolve(instance, scenario.choice);
      assert.equal(service.copies.length, 1);
      assert.equal(service.copies[0].body, JSON.stringify(remote));
      assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
      assert.equal(instance.api.conflict, true);
    }
  });

  await test('fallo al crear o verificar respaldo no actualiza el archivo principal', async () => {
    for (const failure of ['failCreate', 'corruptCreated']) {
      const local = data({ revision: 4 });
      const remote = data({ revision: 2 });
      const service = drive([{ id: 'principal', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
      service[failure] = true;
      const instance = app(local, service, [true, true]);
      await resolve(instance, 'local');
      assert.equal(service.copies[0].body, JSON.stringify(remote));
      assert.equal(service.calls.filter(call => call.method === 'PATCH').length, 0);
      assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
      assert.equal(instance.storage.getItem(BASE), null);
      assert.equal(instance.api.conflict, true);
      assert.equal(instance.alerts.length, 1);
    }
  });

  await test('cambio local después del respaldo aborta antes de actualizar Drive', async () => {
    const local = data({ revision: 4 });
    const changed = data({ revision: 5 });
    const remote = data({ revision: 2 });
    const service = drive([{ id: 'principal', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
    const originalFetch = service.fetch;
    let storage;
    service.fetch = async (url, options) => {
      const result = await originalFetch(url, options);
      if (options?.method === 'POST') storage.setItem(KEY, JSON.stringify(changed));
      return result;
    };
    const instance = app(local, service, [true, true]);
    storage = instance.storage;
    await resolve(instance, 'local');
    assert.equal(instance.storage.getItem(KEY), JSON.stringify(changed));
    assert.equal(service.copies[0].body, JSON.stringify(remote));
    assert.equal(service.copies[1].body, JSON.stringify(remote));
    assert.equal(service.calls.filter(call => call.method === 'PATCH').length, 0);
  });

  await test('cambio remoto después del respaldo aborta antes de actualizar el principal', async () => {
    const local = data({ revision: 4 });
    const remote = data({ revision: 2 });
    const changed = data({ revision: 5 });
    const service = drive([{ id: 'principal', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
    const originalFetch = service.fetch;
    service.fetch = async (url, options) => {
      const result = await originalFetch(url, options);
      if (options?.method === 'POST') service.copies[0].body = JSON.stringify(changed);
      return result;
    };
    const instance = app(local, service, [true, true]);
    await resolve(instance, 'local');
    assert.equal(service.copies[0].body, JSON.stringify(changed));
    assert.equal(service.copies[1].body, JSON.stringify(remote));
    assert.equal(service.calls.filter(call => call.method === 'PATCH').length, 0);
    assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
  });

  await test('fallo al subir o verificar después de subir mantiene el respaldo y la base sin cambios', async () => {
    for (const failure of ['failPatch', 'corruptPatched', 'corruptPatchedSettings']) {
      const local = data({ revision: 4 });
      const remote = data({ revision: 2 });
      const service = drive([{ id: 'principal', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
      service[failure] = true;
      const instance = app(local, service, [true, true]);
      await resolve(instance, 'local');
      assert.equal(service.copies[1].body, JSON.stringify(remote));
      assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
      assert.equal(instance.storage.getItem(BASE), null);
      assert.equal(instance.api.conflict, true);
      assert.equal(instance.alerts.length, 1);
      if (failure === 'failPatch') assert.equal(service.copies[0].body, JSON.stringify(remote));
    }
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

  await test('recarga recupera autorización sin pantalla y queda al día si las copias coinciden', async () => {
    const local = data();
    const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(local) }]);
    const instance = app(local, service, [], undefined, true, { result: 'success' });
    await instance.timers.find(timer => timer.delay === 0).fn();
    await instance.api.reconnectSilently();
    assert.equal(instance.api.status, 'Drive · Al día');
    assert.equal(instance.requests.length, 1);
    assert.equal(instance.requests[0].prompt, 'none');
    assert.equal(service.calls.filter(call => call.method !== 'GET').length, 0);
    assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
    assert.equal(instance.storage.getItem('mis-finanzas-google-drive-token'), null);
  });

  await test('autorización denegada o interrumpida requiere conexión sin modificar copias', async () => {
    for (const result of ['denied', 'interrupted']) {
      const local = data();
      const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(local) }]);
      const instance = app(local, service, [], undefined, true, { result });
      await instance.api.reconnectSilently();
      assert.equal(instance.api.status, 'Drive · Requiere conexión');
      assert.equal(instance.requests[0].prompt, 'none');
      assert.equal(instance.alerts.length, 0);
      assert.equal(service.calls.length, 0);
      assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
      await instance.api.reconnectSilently();
      assert.equal(instance.requests.length, 1);
    }
  });

  await test('conexión manual solicita cuenta solo después de la acción explícita', async () => {
    const instance = app(data(), drive([]), [], undefined, true, { result: 'success' });
    assert.equal(instance.requests.length, 0);
    await instance.api.authorize(true);
    assert.equal(instance.requests.length, 1);
    assert.equal(instance.requests[0].prompt, 'select_account');
  });

  await test('token caducado no se reutiliza ni dispara otra autorización automática', async () => {
    const local = data();
    const instance = app(local, drive([]), [], undefined, true, { result: 'success', expires_in: 1 });
    await instance.api.reconnectSilently();
    assert.equal(instance.api.status, 'Drive · Requiere conexión');
    await instance.api.reconnectSilently();
    assert.equal(instance.requests.length, 1);
  });

  await test('sesión caducada tras sincronizar muestra conexión requerida', async () => {
    const local = data();
    const instance = app(local, drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(local) }]), [], undefined, true, { result: 'success' });
    await instance.api.reconnectSilently();
    assert.equal(instance.api.status, 'Drive · Al día');
    instance.api.expireToken();
    await instance.api.sync(false);
    assert.equal(instance.api.status, 'Drive · Requiere conexión');
    assert.equal(instance.requests.length, 1);
  });

  await test('con autorización recuperada muestra pendiente al guardar hasta sincronizar', async () => {
    const local = data();
    const instance = app(local, drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(local) }]), [], undefined, true, { result: 'success' });
    await instance.api.reconnectSilently();
    instance.events['finanzas-local-save']();
    assert.equal(instance.api.status, 'Drive · Pendiente');
  });

  await test('arranque sin conexión espera online antes del único intento silencioso', async () => {
    const local = data();
    const instance = app(local, drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(local) }]), [], undefined, false, { result: 'success' });
    await instance.api.reconnectSilently();
    assert.equal(instance.requests.length, 0);
    instance.context.navigator.onLine = true;
    await instance.events.online();
    assert.equal(instance.requests.length, 1);
    assert.equal(instance.api.status, 'Drive · Al día');
  });

  await test('conflicto permanece pendiente tras reconexión silenciosa', async () => {
    const local = data();
    const remote = data({ transactions: [{ ...local.transactions[0], amount: 15 }] });
    const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
    const instance = app(local, service, [], undefined, true, { result: 'success' });
    await instance.api.reconnectSilently();
    assert.equal(instance.api.status, 'Drive · Conflicto pendiente');
    assert.equal(instance.api.conflict, true);
    assert.equal(service.calls.filter(call => call.method !== 'GET').length, 0);
    assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
  });

  await test('inicio y recarga: conexión requerida sin aviso de éxito prematuro', async () => {
    const local = data();
    const instance = app(local, drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(local) }]), [], undefined, true, { result: 'success' });
    assert.equal(instance.api.status, 'Drive · Requiere conexión');
    assert.equal(instance.api.feedback.barHidden, true);
    assert.equal(instance.api.feedback.toastHidden, true);
    await instance.api.reconnectSilently();
    assert.equal(instance.api.status, 'Drive · Al día');
    assert.equal(instance.api.feedback.toastHidden, true);
    assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
  });

  await test('reconexión fallida deja aviso accesible sin modificar las copias', async () => {
    const local = data();
    const service = drive([{ id: 'uno', body: JSON.stringify(local) }]);
    const instance = app(local, service, [], undefined, true, { result: 'denied' });
    await instance.api.reconnectSilently();
    assert.equal(instance.api.status, 'Drive · Requiere conexión');
    assert.match(instance.api.feedback.toastText, /requiere conexión/);
    assert.equal(instance.api.feedback.toastRole, 'alert');
    assert.equal(instance.api.feedback.barHidden, true);
    assert.equal(service.calls.length, 0);
    assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
  });

  await test('sincronización manual verificada muestra éxito y la periódica no lo repite', async () => {
    const local = data();
    const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(local) }]);
    const instance = app(local, service);
    await instance.api.sync(true);
    assert.equal(instance.api.status, 'Drive · Al día');
    assert.equal(instance.api.feedback.barHidden, true);
    assert.equal(instance.api.feedback.toastRole, 'status');
    assert.match(instance.api.feedback.toastText, /verificada/);
    assert.ok(instance.timers.some(timer => timer.delay === 4200));
    instance.api.feedback.dismiss();
    await instance.api.sync(false);
    assert.equal(instance.api.feedback.toastHidden, true);
    assert.equal(service.calls.filter(call => call.method !== 'GET').length, 0);
  });

  await test('conflicto y cancelación mantienen aviso y ambas copias', async () => {
    const local = data();
    const remote = data({ transactions: [{ ...local.transactions[0], amount: 12 }] });
    const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: JSON.stringify(remote) }]);
    const instance = app(local, service);
    await instance.api.sync(false);
    assert.equal(instance.api.feedback.barText, 'Drive · Conflicto pendiente');
    assert.equal(instance.api.feedback.toastKey, 'conflict');
    assert.equal(instance.api.feedback.toastRole, 'alert');
    instance.events['finanzas-refresh-drive-status']();
    assert.equal(instance.api.feedback.toastKey, 'conflict');
    await resolve(instance, 'cancel');
    assert.equal(instance.api.status, 'Drive · Conflicto pendiente');
    assert.equal(instance.api.feedback.toastKey, 'conflict');
    assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
    assert.equal(service.copies[0].body, JSON.stringify(remote));
  });

  await test('error de sincronización y cambios pendientes dejan aviso persistente', async () => {
    const local = data();
    const service = drive([{ id: 'uno', modifiedTime: '2026-01-02T00:00:00Z', body: '{dañado' }]);
    const instance = app(local, service);
    instance.events['finanzas-local-save']();
    await instance.api.sync(false);
    assert.equal(instance.api.status, 'Drive · Pendiente');
    assert.equal(instance.api.feedback.barHidden, false);
    assert.equal(instance.api.feedback.toastKey, 'sync-error');
    assert.equal(instance.api.feedback.toastRole, 'alert');
    instance.events['finanzas-refresh-drive-status']();
    assert.equal(instance.api.feedback.toastKey, 'sync-error');
    assert.equal(instance.storage.getItem(KEY), JSON.stringify(local));
  });

  await test('sin internet y cambios pendientes informa sin acceder a Drive', async () => {
    const local = data();
    const service = drive([]);
    const instance = app(local, service, [], undefined, false);
    instance.events['finanzas-local-save']();
    assert.equal(instance.api.status, 'Drive · Sin internet');
    assert.equal(instance.api.feedback.barHidden, false);
    assert.equal(instance.api.feedback.toastKey, 'offline');
    assert.equal(service.calls.length, 0);
  });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
