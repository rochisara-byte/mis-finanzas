const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const address = process.env.APP_URL || 'http://127.0.0.1:8767/';
const key = 'mis-finanzas-offline-v1';
const fixture = { version: 1, device: 'calendar-puente-ficticio', revision: 1, updatedAt: '2026-11-02T12:00:00Z',
  accounts: [{ id: 'caja', name: 'Caja ficticia', type: 'cash', opening: 5000 }],
  lists: [{ id: 'lista', name: 'Lista ficticia' }], categories: ['Otros'], budgets: [{ id: 'presupuesto', category: 'Otros', amount: 3000 }],
  goals: [], debts: [], wishes: [{ id: 'deseo', name: 'Deseo ficticio', estimate: 2000, kind: 'product', category: 'Otros' }], settings: {},
  transactions: [{ id: 'pago', type: 'expense', title: 'Pago ficticio', amount: 1200, category: 'Otros', date: '2026-11-20',
    account: 'caja', status: 'pending', repeat: '', wishId: '', created: '2026-11-02T12:00:00Z' }] };

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 375, height: 850 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.route('https://accounts.google.com/**', route => route.abort());
    await page.addInitScript(({ key, fixture }) => {
      localStorage.setItem(key, JSON.stringify(fixture));
      const events = new Map(), calls = [];
      window.__calendarFake = { events, calls };
      window.google = { accounts: { oauth2: { initTokenClient(options) {
        return { requestAccessToken() { options.callback({ access_token: 'token-ficticio', expires_in: 3600 }); } };
      } } } };
      const original = window.fetch.bind(window);
      const reply = (status, value) => new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
      window.fetch = async (input, options = {}) => {
        const url = new URL(input);
        if (!url.href.startsWith('https://www.googleapis.com/calendar/v3/')) return original(input, options);
        const method = options.method || 'GET', parts = url.pathname.split('/').filter(Boolean);
        calls.push({ method, path: url.pathname, ifMatch: options.headers?.['If-Match'],
          body: options.body ? JSON.parse(options.body) : undefined });
        if (url.pathname.endsWith('/users/me/calendarList')) return reply(200, { items: [] });
        if (parts.length === 3 && parts[2] === 'calendars' && method === 'POST') return reply(200, { id: 'cal-ficticio' });
        if (parts.length === 4 && parts[2] === 'calendars') return reply(200, { id: 'cal-ficticio', summary: 'Mis Finanzas · Pagos', description: 'Calendario privado creado por Mis Finanzas (mis-finanzas-v27).' });
        if (parts.length === 5 && method === 'GET') return reply(200, { items: [...events.values()].filter(item => item.status !== 'cancelled') });
        if (parts.length === 5 && method === 'POST') {
          const item = JSON.parse(options.body);
          if (events.has(item.id)) return reply(409, {});
          events.set(item.id, { ...item, status: item.status || 'confirmed', etag: '"1"' }); return reply(200, events.get(item.id));
        }
        const id = decodeURIComponent(parts[5] || ''), old = events.get(id);
        if (!old) return reply(404, {});
        if (method === 'GET') return reply(200, old);
        if (options.headers?.['If-Match'] !== old.etag) return reply(412, {});
        if (method === 'DELETE') {
          const version = Number(old.etag.replace(/\D/g, '')) + 1;
          events.set(id, { ...old, status: 'cancelled', etag: `"${version}"` });
          return reply(204, null);
        }
        if (method === 'PATCH') {
          const version = Number(old.etag.replace(/\D/g, '')) + 1;
          const item = { ...old, ...JSON.parse(options.body), etag: `"${version}"` };
          events.set(id, item); return reply(200, item);
        }
        return reply(404, {});
      };
    }, { key, fixture });
    await page.goto(address);
    const secondTab = await context.newPage();
    await secondTab.goto(address);
    await page.locator('#calendarConnectButton').click();
    await page.locator('#calendarEnable').click();
    await page.waitForFunction(() => [...window.__calendarFake.events.values()].filter(item => item.status !== 'cancelled').length === 1);
    assert.equal(await page.evaluate(() => window.__calendarFake.calls.some(call => call.path.endsWith('/users/me/calendarList'))), false);
    assert.equal(await page.evaluate(() => total()), 5000);
    await page.locator('#calendarClose').click();

    await page.evaluate(() => transactionForm('pago'));
    await page.locator('#modal #quickEntry').fill('Pago editado 1400');
    await page.locator('#modal .quick-save').click();
    await page.waitForFunction(() => [...window.__calendarFake.events.values()].find(item => item.status !== 'cancelled')?.summary.includes('Pago editado'));
    assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).transactions[0].amount, key), 1400);
    assert.equal(await page.evaluate(() => total()), 5000);

    await page.evaluate(() => mark('pago'));
    await page.waitForFunction(() => [...window.__calendarFake.events.values()].filter(item => item.status !== 'cancelled').length === 0);
    assert.equal(await page.evaluate(() => [...window.__calendarFake.events.values()][0]?.status), 'cancelled');
    assert.equal(await page.evaluate(() => total()), 3600);
    await page.evaluate(() => mark('pago'));
    await page.waitForFunction(() => [...window.__calendarFake.events.values()].filter(item => item.status !== 'cancelled').length === 1);
    assert.equal(await page.evaluate(() => [...window.__calendarFake.events.values()][0]?.status), 'confirmed');
    assert.equal(await page.evaluate(() => window.__calendarFake.calls.some(call => call.method === 'PATCH' && call.ifMatch && call.body?.status === 'confirmed')), true);
    assert.equal(await page.evaluate(() => total()), 5000);

    await page.evaluate(() => { const t = db.transactions.find(x => x.id === 'pago');t.repeat = 'monthly';t.recurrenceAmount = t.amount;persist(); });
    await page.evaluate(() => mark('pago'));
    await page.waitForFunction(() => {
      const values = [...window.__calendarFake.events.values()].filter(item => item.status !== 'cancelled');
      return values.length === 1 && values[0].extendedProperties.private.movementId !== 'pago';
    });
    const result = await page.evaluate(key => ({ db: JSON.parse(localStorage.getItem(key)), events: [...window.__calendarFake.events.values()].filter(item => item.status !== 'cancelled'), calls: window.__calendarFake.calls }), key);
    const child = result.db.transactions.find(t => t.recurrenceParentId === 'pago');
    assert.ok(child);
    assert.equal(result.events[0].extendedProperties.private.movementId, child.id);
    assert.match(result.events[0].description, new RegExp(encodeURIComponent(child.id)));

    await page.context().setOffline(true);
    await page.evaluate(id => transactionForm(id), child.id);
    await page.locator('#modal #quickEntry').fill('Pago sin conexión 1400');
    await page.locator('#modal .quick-save').click();
    assert.equal(await page.evaluate(() => [...window.__calendarFake.events.values()].find(item => item.status !== 'cancelled').summary.includes('Pago sin conexión')), false);
    await page.context().setOffline(false);
    await page.waitForFunction(() => [...window.__calendarFake.events.values()].find(item => item.status !== 'cancelled')?.summary.includes('Pago sin conexión'));

    await page.evaluate(id => transactionForm(id), child.id);
    await page.locator('#modal .quick-details > summary').click();
    await page.locator('#modal [name="repeat"]').selectOption('custom');
    await page.locator('#modal [name="repeatEvery"]').fill('2');
    await page.locator('#modal [name="repeatUnit"]').selectOption('months');
    await page.locator('#modal .quick-save').click();
    await page.evaluate(id => mark(id), child.id);
    await page.waitForFunction(id => {
      const values = [...window.__calendarFake.events.values()].filter(item => item.status !== 'cancelled');
      return values.length === 1 && values[0].extendedProperties.private.movementId !== id;
    }, child.id);
    const later = await page.evaluate(key => ({ db: JSON.parse(localStorage.getItem(key)), events: [...window.__calendarFake.events.values()].filter(item => item.status !== 'cancelled') }), key);
    const grandchild = later.db.transactions.find(t => t.recurrenceParentId === child.id);
    assert.ok(grandchild);
    assert.equal(grandchild.wishId, '');
    assert.equal(later.events[0].extendedProperties.private.movementId, grandchild.id);
    assert.equal(later.events[0].start.date, grandchild.date);
    assert.equal(later.db.transactions.filter(t => t.recurrenceParentId === child.id).length, 1);
    assert.equal(result.db.wishes[0].id, 'deseo');
    assert.equal(result.db.budgets[0].amount, 3000);
    assert.equal(result.db.lists[0].id, 'lista');
    assert.ok(result.calls.filter(call => ['PATCH', 'DELETE'].includes(call.method)).every(call => call.ifMatch));
    const eventBeforeRestore = later.events[0].id;
    await page.context().setOffline(true);
    await page.evaluate(id => { const item = db.transactions.find(t => t.id === id);item.amount += 50;persist(); }, grandchild.id);
    await page.evaluate(id => { const item = db.transactions.find(t => t.id === id);item.status = 'done';window.dispatchEvent(new CustomEvent('finanzas-data-replaced', { detail: { transactions: db.transactions } }));persist(); }, grandchild.id);
    await page.context().setOffline(false);
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(id => window.__calendarFake.events.has(id), eventBeforeRestore), true);
    assert.equal(await page.evaluate(id => JSON.parse(localStorage.getItem('mis-finanzas-calendar-v1')).reviewIds[id], grandchild.id), true);
    console.log('ok - reemplazo de copia no borra recordatorio anterior');

    await secondTab.evaluate(() => { db.transactions.push({ id: 'segunda-pestana', type: 'expense', title: 'Desde otra pestaña', amount: 10, category: 'Otros', date: '2026-11-25', account: 'caja', status: 'pending' });persist(); });
    const prefs = await secondTab.evaluate(() => JSON.parse(localStorage.getItem('mis-finanzas-calendar-v1')));
    assert.equal(prefs.calendarId, 'cal-ficticio');
    assert.equal(prefs.enabled, true);
    assert.equal(prefs.createIds['segunda-pestana'], true);
    console.log('ok - segunda pestaña conserva ID y conexión al guardar una operación');
    await secondTab.close();
    assert.deepEqual(errors, []);
    console.log('ok - formulario, offline, pago, reversión y recurrencias llegan a Calendar sin alterar vínculos');
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
