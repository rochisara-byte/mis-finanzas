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
  let nextCalendar = 1, failPost = false, offline = false, calls = [], concurrentWrite = null, cancelledOnDelete = false, onPatch = null, hideList = false;
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status,
    async json() { return clone(body); } });
  const fetch = async (input, options = {}) => {
    if (offline) throw Error('Sin internet');
    const url = new URL(input), segments = url.pathname.split('/').filter(Boolean);
    const method = options.method || 'GET';
    calls.push({ method, path: url.pathname, headers: options.headers,
      body: options.body ? JSON.parse(options.body) : undefined });
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
      const all = hideList ? [] : [...records.values()].filter(item => item.status !== 'cancelled');
      hideList = false;
      const offset = Number(url.searchParams.get('pageToken') || 0);
      return reply(200, { items: all.slice(offset, offset + 1).map(clone),
        ...(offset + 1 < all.length ? { nextPageToken: String(offset + 1) } : {}) });
    }
    if (segments.length === 5 && method === 'POST') {
      const item = JSON.parse(options.body);
      if (records.has(item.id)) return reply(409, {});
      records.set(item.id, { ...item, status: item.status || 'confirmed', etag: '"1"' });
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
    if (method === 'DELETE') {
      if (cancelledOnDelete) {
        const version = Number(old.etag.replace(/\D/g, '')) + 1;
        records.set(id, { ...old, status: 'cancelled', etag: `"${version}"` });
      } else records.delete(id);
      return reply(204, null);
    }
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
    cancelledDeletes(value) { cancelledOnDelete = value; }, hideNextList() { hideList = true; },
    onNextPatch(hook) { onPatch = hook; } };
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

async function cancelledScenario(id) {
  const shared = api(), current = device(shared, [expense(id)]);
  await current.engine.authorize();assert.equal((await current.engine.reconcile()).created, 1);
  const calendarId = current.engine.calendarId, records = shared.events.get(calendarId), eventId = current.win.MisFinanzasCalendar.eventId(id);
  const before = clone(current.transactions[0]);
  current.transactions = [{ ...before, status: 'done' }];current.engine.noteChange(id, before, current.transactions[0]);
  shared.cancelledDeletes(true);assert.equal((await current.engine.reconcile()).removed, 1);
  assert.equal(records.get(eventId).status, 'cancelled');
  return { shared, current, calendarId, records, eventId };
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

  const revivedScenario = await cancelledScenario('revivir');
  const paidForReversal = clone(revivedScenario.current.transactions[0]);
  revivedScenario.current.transactions = [{ ...paidForReversal, status: 'pending' }];
  revivedScenario.current.engine.noteChange('revivir', paidForReversal, revivedScenario.current.transactions[0]);
  result = await revivedScenario.current.engine.reconcile();
  const revivedEvent = revivedScenario.records.get(revivedScenario.eventId);
  assert.equal(result.created, 1);assert.equal(result.conflicts, 0);assert.equal(revivedEvent.status, 'confirmed');
  assert.equal(revivedEvent.extendedProperties.private.source, 'mis-finanzas-v27');
  assert.equal(revivedEvent.extendedProperties.private.movementId, 'revivir');
  assert.equal(revivedEvent.summary, revivedScenario.current.win.MisFinanzasCalendar.event(revivedScenario.current.transactions[0]).summary);
  console.log('ok - reversión restaura una lápida cancelled y verifica estado, contenido y marcador');

  const restorePatch = revivedScenario.shared.calls.find(call => call.method === 'PATCH' && call.body?.status === 'confirmed');
  assert.ok(restorePatch);assert.equal(restorePatch.headers['If-Match'], '"2"');
  assert.equal(restorePatch.body.extendedProperties.private.movementId, 'revivir');
  console.log('ok - restauración usa PATCH condicional con el ETag vigente');

  const verificationScenario = await cancelledScenario('verificacion');
  verificationScenario.shared.onNextPatch(() => {
    const item = verificationScenario.records.get(verificationScenario.eventId);
    verificationScenario.records.set(verificationScenario.eventId, { ...item, status: 'cancelled', etag: '"4"' });
  });
  const paidBeforeVerification = clone(verificationScenario.current.transactions[0]);
  verificationScenario.current.transactions = [{ ...paidBeforeVerification, status: 'pending' }];
  verificationScenario.current.engine.noteChange('verificacion', paidBeforeVerification, verificationScenario.current.transactions[0]);
  result = await verificationScenario.current.engine.reconcile();
  assert.equal(result.created, 0);assert.equal(result.conflicts, 1);assert.equal(result.pending, true);
  assert.equal(verificationScenario.records.get(verificationScenario.eventId).status, 'cancelled');
  assert.equal(verificationScenario.current.saved.createIds.verificacion, true);
  console.log('ok - una verificación todavía cancelled no informa created y conserva el alta');

  const staleRestore = await cancelledScenario('restore-412');
  staleRestore.shared.changeOnNextWrite({ summary: 'Cambio concurrente durante restauración' });
  const paidBefore412 = clone(staleRestore.current.transactions[0]);
  staleRestore.current.transactions = [{ ...paidBefore412, status: 'pending' }];
  staleRestore.current.engine.noteChange('restore-412', paidBefore412, staleRestore.current.transactions[0]);
  result = await staleRestore.current.engine.reconcile();
  assert.equal(result.created, 0);assert.equal(result.conflicts, 1);assert.equal(result.pending, true);
  assert.equal(staleRestore.current.saved.createIds['restore-412'], true);
  assert.equal(staleRestore.records.get(staleRestore.eventId).status, 'cancelled');
  console.log('ok - HTTP 412 al restaurar conserva la intención y la lápida remota');

  const missingEtag = await cancelledScenario('sin-etag');
  const tombstoneWithoutEtag = clone(missingEtag.records.get(missingEtag.eventId));delete tombstoneWithoutEtag.etag;
  missingEtag.records.set(missingEtag.eventId, tombstoneWithoutEtag);
  const patchesBeforeMissingEtag = missingEtag.shared.calls.filter(call => call.method === 'PATCH').length;
  const paidWithoutEtag = clone(missingEtag.current.transactions[0]);
  missingEtag.current.transactions = [{ ...paidWithoutEtag, status: 'pending' }];
  missingEtag.current.engine.noteChange('sin-etag', paidWithoutEtag, missingEtag.current.transactions[0]);
  result = await missingEtag.current.engine.reconcile();
  assert.equal(result.created, 0);assert.equal(result.conflicts, 1);assert.equal(result.pending, true);
  assert.equal(missingEtag.current.saved.createIds['sin-etag'], true);
  assert.equal(missingEtag.shared.calls.filter(call => call.method === 'PATCH').length, patchesBeforeMissingEtag);
  console.log('ok - lápida sin ETag queda pendiente sin intentar una escritura insegura');

  const lostRestore = await cancelledScenario('restore-perdida');
  lostRestore.shared.onNextPatch(() => { throw Error('Respuesta perdida al restaurar'); });
  const paidBeforeLostResponse = clone(lostRestore.current.transactions[0]);
  lostRestore.current.transactions = [{ ...paidBeforeLostResponse, status: 'pending' }];
  lostRestore.current.engine.noteChange('restore-perdida', paidBeforeLostResponse, lostRestore.current.transactions[0]);
  await assert.rejects(lostRestore.current.engine.reconcile(), /Respuesta perdida al restaurar/);
  assert.equal(lostRestore.records.get(lostRestore.eventId).status, 'confirmed');
  assert.equal(lostRestore.current.saved.createIds['restore-perdida'], true);
  result = await lostRestore.current.engine.reconcile();
  assert.equal(result.created, 0);assert.equal(result.conflicts, 0);
  assert.equal(lostRestore.current.saved.createIds['restore-perdida'], undefined);
  console.log('ok - respuesta perdida al restaurar se recupera sin duplicar ni repetir PATCH');

  const activeDuplicate = api(), activeOwner = device(activeDuplicate, [expense('duplicado-activo')]);
  await activeOwner.engine.authorize();assert.equal((await activeOwner.engine.reconcile()).created, 1);
  const activeFollower = device(activeDuplicate, [expense('duplicado-activo')], true, { calendarId: activeOwner.engine.calendarId });
  activeFollower.engine.noteCreate('duplicado-activo');await activeFollower.engine.authorize();activeDuplicate.hideNextList();
  result = await activeFollower.engine.reconcile();
  assert.equal(result.created, 1);assert.equal(result.conflicts, 0);
  assert.equal(activeFollower.saved.createIds['duplicado-activo'], undefined);
  console.log('ok - HTTP 409 activo e íntegro conserva la recuperación idempotente');

  const markerCollision = api(), markerOwner = device(markerCollision, [expense('marcador-ajeno')]);
  await markerOwner.engine.authorize();await markerOwner.engine.reconcile();
  const markerRecords = markerCollision.events.get(markerOwner.engine.calendarId), markerId = markerOwner.win.MisFinanzasCalendar.eventId('marcador-ajeno');
  const markerEvent = markerRecords.get(markerId);
  markerRecords.set(markerId, { ...markerEvent, extendedProperties: { private: { source: 'otro-origen', movementId: 'marcador-ajeno' } } });
  const markerFollower = device(markerCollision, [expense('marcador-ajeno')], true, { calendarId: markerOwner.engine.calendarId });
  markerFollower.engine.noteCreate('marcador-ajeno');await markerFollower.engine.authorize();
  result = await markerFollower.engine.reconcile();
  assert.equal(result.created, 0);assert.equal(result.conflicts, 1);assert.equal(result.pending, true);
  assert.equal(markerFollower.saved.createIds['marcador-ajeno'], true);
  console.log('ok - HTTP 409 activo con marcador ajeno no se acepta como creación propia');

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
