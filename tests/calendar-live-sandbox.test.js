const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const pageHtml = fs.readFileSync(path.join(__dirname, 'calendar-live-sandbox.html'));
  const server = http.createServer((request, response) => {
    if (request.url !== '/') { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });response.end(pageHtml);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const writes = [];
    const calendars = new Map([['existing', { id: 'existing', summary: 'Personal', description: 'No tocar' }]]);
    const events = new Map();
    await page.addInitScript(() => {
      window.google = { accounts: { oauth2: { initTokenClient(options) {
        return { requestAccessToken() { options.callback({ access_token: 'ficticio', expires_in: 3600, scope: options.scope }); } };
      } } } };
    });
    await page.route('https://accounts.google.com/**', route => route.abort());
    await page.route('https://www.googleapis.com/calendar/v3/**', async route => {
      const request = route.request(), url = new URL(request.url());
      const parts = url.pathname.split('/').filter(Boolean);
      const method = request.method(), calendarId = parts[3], eventId = parts[5];
      const body = request.postDataJSON() || {};
      const respond = (status, data = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' } });
      if (method !== 'GET') writes.push({ method, calendarId, path: url.pathname });
      if (method === 'POST' && parts.length === 3) {
        calendars.set('ensayo', { id: 'ensayo', ...body });events.set('ensayo', new Map());return respond(200, calendars.get('ensayo'));
      }
      if (parts.length === 4) {
        if (method === 'GET') return respond(calendars.has(calendarId) ? 200 : 404, calendars.get(calendarId));
        if (method === 'DELETE') { calendars.delete(calendarId);events.delete(calendarId);return respond(204); }
      }
      if (parts.length === 5 && method === 'POST') {
        events.get(calendarId).set('ficticio', { id: 'ficticio', etag: '"1"', ...body });
        return respond(200, events.get(calendarId).get('ficticio'));
      }
      if (parts.length === 6) {
        const old = events.get(calendarId)?.get(eventId);
        if (!old) return respond(404);
        if (method === 'GET') return respond(200, old);
        if (request.headers()['if-match'] !== old.etag) return respond(412);
        if (method === 'PATCH') {
          const next = { ...old, ...body, etag: '"2"' };events.get(calendarId).set(eventId, next);return respond(200, next);
        }
        if (method === 'DELETE') { events.get(calendarId).delete(eventId);return respond(204); }
      }
      return respond(404);
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('#start').click();
    await page.waitForFunction(() => document.querySelector('#log').textContent.includes('RESULTADO: ambas condiciones'));
    assert.equal(await page.locator('#start').isDisabled(), true);
    assert.equal(calendars.has('existing'), true);
    assert.ok(writes.every(x => !x.calendarId || x.calendarId === 'ensayo'));
    await page.reload();
    assert.equal(await page.locator('#start').isDisabled(), true);
    await page.locator('#cleanup').click();
    await page.waitForFunction(() => document.querySelector('#log').textContent.includes('Calendario temporal eliminado'));
    assert.equal(calendars.has('ensayo'), false);
    assert.equal(calendars.has('existing'), true);
    assert.equal(await page.locator('#start').isEnabled(), true);
    await page.close();
    console.log('ok - ensayo, bloqueo de duplicados, recarga y limpieza solo del calendario temporal');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
