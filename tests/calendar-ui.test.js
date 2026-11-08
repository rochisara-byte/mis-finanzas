const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const fixture = { version: 1, device: 'calendario-ficticio', revision: 1,
  accounts: [{ id: 'caja', name: 'Caja ficticia', type: 'cash', opening: 1000 }],
  lists: [], categories: ['Otros'], budgets: [], debts: [], goals: [], settings: {},
  transactions: [{ id: 'pago-ficticio', type: 'expense', title: 'Pago ficticio', amount: 100,
    date: '2026-11-20', account: 'caja', status: 'pending', created: '2026-10-20T00:00:00Z' }] };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

async function main() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!['index.html', 'calendar-sync.js', 'calendar-ui.js', 'sw.js', 'manifest.webmanifest',
      'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'].includes(name)) {
      response.writeHead(404);response.end();return;
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(name)] || 'application/octet-stream' });
    response.end(fs.readFileSync(path.join(root, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
  try {
    const base = `http://127.0.0.1:${server.address().port}/`;
    for (const width of [375, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 850 }, serviceWorkers: 'block' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('https://accounts.google.com/**', route => route.abort());
      await page.addInitScript(fixture => {
        localStorage.setItem('mis-finanzas-offline-v1', JSON.stringify(fixture));
        window.google = { accounts: { oauth2: { initTokenClient(options) {
          return { requestAccessToken() { options.callback({ error: 'access_denied' }); } };
        } } } };
      }, fixture);
      await page.goto(base + '?movimiento=pago-ficticio');
      await page.locator('.action-menu-head h2').waitFor();
      assert.equal(await page.locator('.action-menu-head h2').innerText(), 'Pago ficticio');
      await page.locator('.action-menu-close').click();
      await page.locator(`${width >= 1024 ? '#desktopNav' : '#nav'} [data-page="Listas"]`).click();
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('finanzas-open-movement', { detail: 'pago-ficticio' })));
      assert.equal(await page.locator('.action-menu-head h2').innerText(), 'Pago ficticio');
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('mis-finanzas-offline-v1')).transactions), fixture.transactions);
      await page.goto(base + '?movimiento=ausente');
      await page.locator('#calendarSettings[open]').waitFor();
      assert.equal(await page.locator('#calendarDrive').isVisible(), true);
      assert.match(await page.locator('#calendarStatus').innerText(), /no está en este dispositivo/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.CAPTURE_DIR) {
        fs.mkdirSync(process.env.CAPTURE_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.CAPTURE_DIR, `calendar-enlace-${width}.png`) });
      }
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`ok - enlaces de Calendar y acción de Drive a ${width}px`);
    }

    const consentContext = await browser.newContext({ serviceWorkers: 'block' });
    const consentPage = await consentContext.newPage();
    let acceptCreation = false, createdCalendar = false;
    const consentEvents = new Map();
    const consentCalls = [];
    consentPage.on('dialog', dialog => acceptCreation ? dialog.accept() : dialog.dismiss());
    await consentPage.route('https://accounts.google.com/**', route => route.abort());
    await consentPage.addInitScript(fixture => {
      localStorage.setItem('mis-finanzas-offline-v1', JSON.stringify(fixture));window.__calendarOauthRequests = 0;
      window.google = { accounts: { oauth2: { initTokenClient(options) {
        return { requestAccessToken() { if(options.scope==='https://www.googleapis.com/auth/calendar.app.created')window.__calendarOauthRequests++;options.callback({ access_token: 'token-ficticio', expires_in: 3600 }); } };
      } } } };
    }, fixture);
    await consentPage.route('https://www.googleapis.com/calendar/v3/**', async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      const parts = url.pathname.split('/').filter(Boolean);consentCalls.push({ method, path: url.pathname });
      const respond = (status, data = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' } });
      if (method === 'POST' && parts.length === 3) { createdCalendar = true;return respond(200, { id: 'cal-consent', summary: 'Mis Finanzas · Pagos', description: 'Calendario privado creado por Mis Finanzas (mis-finanzas-v27).' }); }
      if (parts.length === 4 && parts[3] === 'cal-consent' && method === 'GET') return respond(createdCalendar ? 200 : 404,
        { id: 'cal-consent', summary: 'Mis Finanzas · Pagos', description: 'Calendario privado creado por Mis Finanzas (mis-finanzas-v27).' });
      if (parts.length === 5 && parts[3] === 'cal-consent' && method === 'GET') return respond(200, { items: [] });
      if (parts.length === 5 && parts[3] === 'cal-consent' && method === 'POST') {
        const body = request.postDataJSON(), item = { ...body, status: 'confirmed', etag: '"1"' };consentEvents.set(item.id, item);return respond(200, item);
      }
      if (parts.length === 6 && parts[3] === 'cal-consent' && method === 'GET') return respond(consentEvents.has(parts[5]) ? 200 : 404, consentEvents.get(parts[5]));
      return respond(404);
    });
    await consentPage.goto(base);
    await consentPage.locator('#calendarConnectButton').click();
    await consentPage.locator('#calendarEnable').click();
    await consentPage.waitForFunction(() => document.querySelector('#calendarStatus').textContent.includes('Creación cancelada'));
    assert.equal(await consentPage.evaluate(() => window.__calendarOauthRequests), 0);
    assert.equal(await consentPage.evaluate(() => JSON.parse(localStorage.getItem('mis-finanzas-calendar-v1')).enabled), false);
    await consentPage.evaluate(() => {
      db.transactions.push({ id: 'posterior-cancelacion', type: 'expense', title: 'Guardado ficticio posterior', amount: 10, category: 'Otros', date: '2026-11-25', account: 'caja', status: 'pending' });persist();
      window.dispatchEvent(new Event('online'));
    });
    await consentPage.waitForTimeout(1500);
    await consentPage.locator('#calendarSync').click();
    assert.equal(consentCalls.length, 0);assert.equal(createdCalendar, false);
    acceptCreation = true;
    await consentPage.locator('#calendarEnable').click();
    await consentPage.waitForFunction(() => document.querySelector('#calendarStatus').textContent.startsWith('Al día:'));
    assert.equal(await consentPage.evaluate(() => window.__calendarOauthRequests), 1);
    assert.equal(consentCalls.filter(call => call.method === 'POST' && call.path.endsWith('/calendars')).length, 1);
    assert.equal(await consentPage.evaluate(() => JSON.parse(localStorage.getItem('mis-finanzas-calendar-v1')).enabled), true);
    await consentContext.close();
    console.log('ok - cancelar creación no autoriza ni habilita; guardados no crean y el reintento explícito sí');

    const linkContext = await browser.newContext({ serviceWorkers: 'block' });
    const linkPage = await linkContext.newPage(), linkCalls = [], linkEvents = new Map();
    await linkPage.route('https://accounts.google.com/**', route => route.abort());
    await linkPage.addInitScript(fixture => {
      localStorage.setItem('mis-finanzas-offline-v1', JSON.stringify(fixture));
      window.google = { accounts: { oauth2: { initTokenClient(options) {
        return { requestAccessToken() { options.callback({ access_token: 'token-ficticio', expires_in: 3600 }); } };
      } } } };
    }, fixture);
    await linkPage.route('https://www.googleapis.com/calendar/v3/**', async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method(), parts = url.pathname.split('/').filter(Boolean);
      linkCalls.push({ method, path: url.pathname });
      const respond = (status, data = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' } });
      if (parts.length === 4 && parts[3] === 'cal-linked' && method === 'GET') return respond(200,
        { id: 'cal-linked', summary: 'Mis Finanzas · Pagos', description: 'Calendario privado creado por Mis Finanzas (mis-finanzas-v27).' });
      if (parts.length === 5 && parts[3] === 'cal-linked' && method === 'GET') return respond(200, { items: [] });
      if (parts.length === 5 && parts[3] === 'cal-linked' && method === 'POST') {
        const body = request.postDataJSON(), item = { ...body, status: 'confirmed', etag: '"1"' };linkEvents.set(item.id, item);return respond(200, item);
      }
      if (parts.length === 6 && parts[3] === 'cal-linked' && method === 'GET') return respond(linkEvents.has(parts[5]) ? 200 : 404, linkEvents.get(parts[5]));
      return respond(404);
    });
    await linkPage.goto(base);await linkPage.locator('#calendarConnectButton').click();
    await linkPage.locator('#calendarExistingId').fill('cal-linked');await linkPage.locator('#calendarEnable').click();
    await linkPage.waitForFunction(() => JSON.parse(localStorage.getItem('mis-finanzas-calendar-v1')||'{}').calendarId === 'cal-linked');
    const linkedPrefs = await linkPage.evaluate(() => JSON.parse(localStorage.getItem('mis-finanzas-calendar-v1')));
    assert.equal(linkedPrefs.calendarId, 'cal-linked');assert.equal(linkedPrefs.enabled, true);
    assert.equal(linkCalls.some(call => call.method === 'POST' && call.path.endsWith('/calendars')), false);
    await linkContext.close();
    console.log('ok - vincular por ID habilita el calendario verificado sin crear otro');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
