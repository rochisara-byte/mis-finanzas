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
    for (const width of [390, 1280]) {
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
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`ok - enlaces de Calendar y acción de Drive a ${width}px`);
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
