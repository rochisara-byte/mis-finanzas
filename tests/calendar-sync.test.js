const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'calendar-sync.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const expense = (id, extra = {}) => ({ id, type: 'expense', title: `Pago ${id}`, amount: 1200,
  date: '2026-11-20', status: 'pending', ...extra });

function api() {
  const calendars = new Map(), events = new Map();
  let nextCalendar = 1, failPost = false, offline = false, calls = [], concurrentWrite = null, cancelledOnDelete = false, onPatch = null;
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status,
    async json() { return clone(body); } });
  const fetch = async (input, options = {}) => {
    if (offline) throw Error('Sin internet');
    const url = new URL(input), segments = url.pathname.split('/').filter(Boolean);
    const method = options.method || 'GET';
    calls.push({ method, path: url.pathname, headers: options.headers });
    if (url.pathname.endsWith('/users/me/calendarList')) {
      const all = [...calendars.values()];
      const offset = Number(url.searchParams.get('pageToken') || 0);
      return reply(200, { items: all.slice(offset, offset + 1),
        ...(offset + 1 < all.length ? { nextPageToken: String(offset + 1) } : {}) });
    }
    if (segments.join('/') === 'calendar/v3/calendars' && method === 'POST') {
      const item = { id: `cal-${nextCalendar++}`, accessRole: 'owner', ...JSON.parse(options.body) };
      calendars.set(item.id, item); events.set(item.id, new Map()); return reply(200, item);
    }
    const calendarId = decodeURIComponent(segments[3] || '');
    if (segments.length === 4 && segments[2] === 'calendars')
      return calendars.has(calendarId) ? reply(200, calendars.get(calendarId)) : reply(404, {});
    if (segments[4] !== 'events' || !events.has(calendarId)) return reply(404, {});
    const records = events.get(calendarId);
    if (segments.length === 5 && method === 'GET') {
      const all = [...records.values()], offset = Number(url.searchParams.get('pageToken') || 0);
      return reply(200, { items: all.slice(offset, offset + 1).map(clone),
        ...(offset + 1 < all.length ? { nextPageToken: String(offset + 1) } : {}) });
    }
    if (segments.length === 5 && method === 'POST') {
      const item = JSON.parse(options.body);
      if (records.has(item.id)) return reply(409, {});
      records.set(item.id, { ...item, etag: '"1"' });
      if (failPost) { failPost = false; throw Error('Respuesta perdida'); }
      return reply(200, records.get(item.id));
    }
    const id = decodeURIComponent(segments[5] || ''), old = records.get(id);
    if (!old) return reply(404, {});
    if (method === 'GET') return reply(200, old);
    if (concurrentWrite && (method === 'PATCH' || method === 'DELETE')) {
      records.set(id, { ...old, ...concurrentWrite, etag: '"99"' });
      concurrentWrite = null;
      return reply(412, {});
    }
    if (options.headers['If-Match'] !== old.etag) return reply(412, {});
    if (method === 'DELETE') { if (cancelledOnDelete) records.set(id, { ...old, status: 'cancelled' }); else records.delete(id); return reply(204, null); }
    if (method === 'PATCH') {
      const version = Number(old.etag.replace(/\D/g, '')) + 1;
      const item = { ...old, ...JSON.parse(options.body), etag: `"${version}"` };
      records.set(id, item);if (onPatch) { const hook = onPatch;onPatch = null;hook(); }return reply(200, item);
    }
    return reply(404, {});
  };
  return { fetch, calendars, events, calls,
    setOffline(value) { offline = value; }, loseNextPost() { failPost = true; },
    changeOnNextWrite(value) { concurrentWrite = value; },
    cancelledDeletes(value) { cancelledOnDelete = value; }, onNextPatch(hook) { onPatch = hook; } };
}

function device(shared, initial = [], allowConditionalMutations = true, initialState = {}, oauth = {}) {
  let transactions = clone(initial), saved = clone(initialState), requests = 0;
  const win = { location: { href: 'https://ejemplo.test/mis-finanzas/' }, navigator: { onLine: true },
    google: { accounts: { oauth2: { initTokenClient(options) {
      assert.equal(options.scope, 'https://www.googleapis.com/auth/calendar.app.created');
      return { requestAccessToken() { requests++;if(oauth.request)oauth.request(options);else options.callback({ access_token: 'ficticio', expires_in: 3600 }); } };
    } } } } };
  vm.runInNewContext(script, { window: win, fetch: shared.fetch, URL, URLSearchParams, Date, TextEncoder, Intl,
    setTimeout: oauth.setTimeout || setTimeout, clearTimeout: oauth.clearTimeout || clearTimeout });
  const engine = win.MisFinanzasCalendar.create({ clientId: 'cliente-ficticio',
    readTransactions: () => clone(transactions), loadState: () => clone(saved),
    saveState: value => { saved = clone(value); }, allowConditionalMutations });
  return { engine, win, get transactions() { return transactions; }, set transactions(value) { transactions = clone(value); },
    get saved() { return clone(saved); }, get requests() { return requests; } };
}

async function main() {
  const shared = api(), first = device(shared, [expense('uno'), expense('futuro', { repeat: 'monthly', recurrenceParentId: 'uno' })]);
  assert.equal((await first.engine.reconcile()).skipped, 'disabled');
  await first.engine.authorize();
  let result = await first.engine.reconcile();
  assert.equal(result.created, 2);
  assert.equal((await first.engine.reconcile()).created, 0);
  assert.equal(shared.calendars.size, 1);
  const calendarId = [...shared.calendars.keys()][0], records = shared.events.get(calendarId);
  assert.equal(shared.calls.some(call => call.path.endsWith('/users/me/calendarList')), false);
  assert.equal(records.size, 2);
  assert.match([...records.values()][0].id, /^[0-9a-v]{5,1024}$/);
  assert.throws(() => first.win.MisFinanzasCalendar.eventId('x'.repeat(600)), /demasiado largo/);
  const old = clone(first.transactions[0]);
  first.transactions = [expense('uno', { title: 'Pago editado', amount: 1400, date: '2026-11-21' }), first.transactions[1]];
  first.engine.noteChange('uno', old, first.transactions[0]);
  result = await first.engine.reconcile();assert.equal(result.updated, 1);
  assert.match(records.get(first.win.MisFinanzasCalendar.eventId('uno')).summary, /Pago editado/);
  const edited = clone(first.transactions[0]);
  first.transactions = [expense('uno', { status: 'done' }), first.transactions[1]];
  first.engine.noteChange('uno', edited, first.transactions[0]);
  result = await first.engine.reconcile();assert.equal(result.removed, 1);assert.equal(records.size, 1);
  assert.ok(records.has(first.win.MisFinanzasCalendar.eventId('futuro')));
  first.transactions = [expense('uno'), first.transactions[1]];first.engine.noteCreate('uno');
  result = await first.engine.reconcile();assert.equal(result.created, 1);
  result = await first.engine.reconcile();assert.equal(result.created, 0);
  const beforeDelete = clone(first.transactions[0]);
  first.transactions = [expense('uno', { deleted: true }), first.transactions[1]];
  first.engine.noteChange('uno', beforeDelete, first.transactions[0]);
  assert.equal((await first.engine.reconcile()).removed, 1);
  console.log('ok - crear, editar, pagar, recurrencia futura, revertir, borrar y reintentar');

  const second = device(shared, [expense('futuro', { repeat: 'monthly', recurrenceParentId: 'uno' })], true, { calendarId });
  await second.engine.authorize();
  assert.equal((await second.engine.reconcile()).removed, 0);
  assert.equal(records.size, 1);
  const beforePayment = clone(second.transactions[0]);
  second.transactions = [expense('futuro', { status: 'done' })];
  second.engine.noteChange('futuro', beforePayment, second.transactions[0]);
  const remote = records.get(second.win.MisFinanzasCalendar.eventId('futuro'));
  records.set(remote.id, { ...remote, summary: 'Cambio remoto', etag: '"2"' });
  result = await second.engine.reconcile();assert.equal(result.conflicts, 1);assert.equal(result.removed, 0);
  assert.equal(records.size, 1);
  const stale = device(shared, [expense('uno')], true, { calendarId });
  await stale.engine.authorize();
  result = await stale.engine.reconcile();
  assert.equal(result.created, 0);assert.equal(result.conflicts, 1);
  console.log('ok - dos dispositivos no borran ausentes ni cambios concurrentes');

  const third = device(shared, [expense('offline')], true, { calendarId });
  third.engine.noteCreate('offline');
  await third.engine.authorize();
  third.win.navigator.onLine = false;shared.setOffline(true);
  assert.equal((await third.engine.reconcile()).skipped, 'offline');
  const restarted = device(shared, third.transactions, true, third.saved);
  shared.setOffline(false);await restarted.engine.authorize();
  shared.loseNextPost();await assert.rejects(restarted.engine.reconcile(), /Respuesta perdida/);
  assert.equal((await restarted.engine.reconcile()).created, 0);
  assert.equal([...records.values()].filter(x => x.extendedProperties.private.movementId === 'offline').length, 1);
  const locked = device(shared, [expense('offline', { amount: 1300 })], false, { calendarId });
  await locked.engine.authorize();
  locked.engine.noteChange('offline', expense('offline'), locked.transactions[0]);
  const writesBefore = shared.calls.filter(x => x.method === 'PATCH').length;
  assert.equal((await locked.engine.reconcile()).conflicts, 1);
  assert.equal(shared.calls.filter(x => x.method === 'PATCH').length, writesBefore);
  restarted.engine.setReminders([20160, 0], restarted.transactions);
  assert.equal((await restarted.engine.reconcile()).updated, 1);
  const downloadedPayment = device(shared, [expense('offline', { status: 'done' })], true, { calendarId });
  await downloadedPayment.engine.authorize();
  assert.equal((await downloadedPayment.engine.reconcile()).conflicts, 1);
  assert.ok(records.has(downloadedPayment.win.MisFinanzasCalendar.eventId('offline')));
  assert.throws(() => restarted.engine.setReminders([40321], restarted.transactions), /hasta cinco/);
  await restarted.engine.authorize();
  assert.equal(restarted.requests, 2);
  assert.ok(shared.calls.some(call => call.method === 'PATCH' && call.headers['If-Match']));
  console.log('ok - offline, respuesta perdida, paginación, recordatorios y escritura condicional');

  const editing = device(shared, [expense('offline')], true, { calendarId, reminders: [20160, 0] });
  await editing.engine.authorize();
  editing.transactions = [expense('offline', { title: 'Edición ficticia' })];
  editing.engine.noteChange('offline', expense('offline'), editing.transactions[0]);
  shared.changeOnNextWrite({ summary: 'Edición desde otro dispositivo' });
  result = await editing.engine.reconcile();
  assert.equal(result.conflicts, 1);assert.equal(result.updated, 0);
  assert.equal(records.get(editing.win.MisFinanzasCalendar.eventId('offline')).summary, 'Edición desde otro dispositivo');
  assert.ok(editing.saved.ops.offline);
  assert.equal((await editing.engine.reconcile()).conflicts, 1);

  const deleting = device(shared, [expense('delete-race')], true, { calendarId });
  deleting.engine.noteCreate('delete-race');
  await deleting.engine.authorize();
  assert.equal((await deleting.engine.reconcile()).created, 1);
  deleting.transactions = [expense('delete-race', { status: 'done' })];
  deleting.engine.noteChange('delete-race', expense('delete-race'), deleting.transactions[0]);
  shared.changeOnNextWrite({ summary: 'Pago modificado en otro dispositivo' });
  result = await deleting.engine.reconcile();
  assert.equal(result.conflicts, 1);assert.equal(result.removed, 0);
  assert.equal(records.get(deleting.win.MisFinanzasCalendar.eventId('delete-race')).summary, 'Pago modificado en otro dispositivo');
  assert.ok(deleting.saved.ops['delete-race']);
  console.log('ok - HTTP 412 conserva edición, eliminación e intención local para revisión');

  const fresh = api(), pending = device(fresh, [expense('sin-red')]);
  pending.engine.noteCreate('sin-red');
  pending.transactions = [expense('sin-red', { date: '2026-11-22', amount: 2500 })];
  pending.engine.noteChange('sin-red', expense('sin-red'), pending.transactions[0]);
  assert.ok(pending.saved.createIds['sin-red']);
  await pending.engine.authorize();
  assert.equal((await pending.engine.reconcile()).created, 1);
  const freshId = pending.engine.calendarId;
  assert.equal(fresh.events.get(freshId).get(pending.win.MisFinanzasCalendar.eventId('sin-red')).start.date, '2026-11-22');
  assert.equal(fresh.calls.some(call => call.path.endsWith('/users/me/calendarList')), false);
  const linked = device(fresh, [], true);
  await linked.engine.authorize();await linked.engine.attachCalendar(freshId);
  assert.equal((await linked.engine.reconcile()).created, 0);
  assert.equal(fresh.calendars.size, 1);
  console.log('ok - alta corregida sin conexión y vinculación con permiso limitado');

  const paid = clone(pending.transactions[0]);
  pending.transactions = [{ ...paid, status: 'done' }];pending.engine.noteChange('sin-red', paid, pending.transactions[0]);
  fresh.cancelledDeletes(true);
  assert.equal((await pending.engine.reconcile()).removed, 1);
  assert.equal(pending.saved.ops['sin-red'], undefined);
  console.log('ok - DELETE verificado con estado cancelled');

  const race = api(), editingDuringPatch = device(race, [expense('edicion')]);
  await editingDuringPatch.engine.authorize();await editingDuringPatch.engine.reconcile();
  const oldRace = clone(editingDuringPatch.transactions[0]);
  editingDuringPatch.transactions = [expense('edicion', { amount: 2200 })];
  editingDuringPatch.engine.noteChange('edicion', oldRace, editingDuringPatch.transactions[0]);
  race.onNextPatch(() => {
    const editedRace = clone(editingDuringPatch.transactions[0]);
    editingDuringPatch.transactions = [{ ...editedRace, status: 'done' }];
    editingDuringPatch.engine.noteChange('edicion', editedRace, editingDuringPatch.transactions[0]);
  });
  result = await editingDuringPatch.engine.reconcile();
  assert.equal(result.updated, 1);assert.equal(result.pending, true);
  assert.equal(editingDuringPatch.saved.ops.edicion.desired, null);
  assert.equal((await editingDuringPatch.engine.reconcile()).removed, 1);
  assert.equal(race.events.get(editingDuringPatch.engine.calendarId).size, 0);
  console.log('ok - pago durante PATCH preserva la operación posterior');

  const restored = api(), restoreDevice = device(restored, [expense('restaurado')]);
  await restoreDevice.engine.authorize();await restoreDevice.engine.reconcile();
  restoreDevice.transactions = [expense('restaurado', { amount: 3000 })];
  restoreDevice.engine.noteChange('restaurado', expense('restaurado'), restoreDevice.transactions[0]);
  restoreDevice.engine.noteReplacement();
  assert.equal((await restoreDevice.engine.reconcile()).conflicts, 1);
  assert.equal(restored.events.get(restoreDevice.engine.calendarId).size, 1);
  console.log('ok - reemplazo de copia bloquea operaciones anteriores para revisión');

  const denied = device(api(), [], true, {}, { request(options) { options.error_callback({ type: 'popup_closed' }); } });
  await assert.rejects(denied.engine.authorize(), /popup_closed/);
  await assert.rejects(denied.engine.authorize(), /popup_closed/);
  assert.equal(denied.requests, 2);
  const blocked = device(api(), [], true, {}, { request() { throw Error('Ventana bloqueada'); } });
  await assert.rejects(blocked.engine.authorize(), /Ventana bloqueada/);
  await assert.rejects(blocked.engine.authorize(), /Ventana bloqueada/);
  assert.equal(blocked.requests, 2);
  let lateCallback;
  const timedOut = device(api(), [], true, {}, { request(options) { lateCallback = options.callback; },
    setTimeout(callback) { queueMicrotask(callback);return 1; }, clearTimeout() {} });
  await assert.rejects(timedOut.engine.authorize(), /no respondió/);
  lateCallback({ access_token: 'tardío', expires_in: 3600 });
  assert.equal(timedOut.engine.authorized, false);
  await assert.rejects(timedOut.engine.authorize(), /no respondió/);
  assert.equal(timedOut.requests, 2);
  console.log('ok - OAuth cancelado, bloqueado o caducado permite reintentar');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
