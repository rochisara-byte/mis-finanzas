const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const dataKey = 'mis-finanzas-offline-v1';
const prefsKey = 'mis-finanzas-projection-v1';
const fixture = {
  version: 1, device: 'prueba-proyeccion', revision: 1, updatedAt: '2026-10-20T00:00:00Z',
  accounts: [{ id: 'caja', name: 'Caja ficticia', type: 'cash', opening: 1000 },
    { id: 'banco', name: 'Banco ficticio', type: 'bank', opening: 0 }],
  lists: [], categories: ['Otros'], budgets: [], goals: [], debts: [], settings: {},
  transactions: [
    { id: 'ingreso', type: 'income', amount: 200, status: 'done', account: 'caja', date: '2026-01-10' },
    { id: 'gasto', type: 'expense', amount: 100, status: 'done', account: 'caja', date: '2026-01-10' },
    { id: 'traspaso', type: 'transfer', amount: 40, status: 'done', account: 'caja', toAccount: 'banco', date: '2026-01-10' },
    { id: 'pendiente', type: 'expense', amount: 50, status: 'pending', account: 'caja', date: '2026-10-20' },
    { id: 'esperado', type: 'income', amount: 80, status: 'pending', account: 'caja', date: '2026-10-20' },
    { id: 'eliminado', type: 'expense', amount: 999, status: 'pending', deleted: true, account: 'caja', date: '2026-10-20' },
  ],
};
fixture.transactions.forEach(t => { t.created = '2026-01-10T00:00:00Z'; t.title = `Movimiento ${t.id}`; });

async function controls(page) {
  await page.locator('.projection-details summary').click();
  return { projection: page.locator('#proj'), until: page.locator('#until') };
}

async function projected(page) {
  return Number((await page.locator('.summary-grid .metric').nth(2).locator('b').innerText()).replace(/\D/g, ''));
}

async function main() {
  const server = http.createServer((request, response) => {
    if (new URL(request.url, 'http://localhost').pathname !== '/') {
      response.writeHead(404); response.end(); return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(fs.readFileSync(path.join(root, 'index.html')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox'] });
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('https://accounts.google.com/**', route => route.abort());
      await page.addInitScript(({ dataKey, fixture }) => {
        if (!localStorage.getItem(dataKey)) localStorage.setItem(dataKey, JSON.stringify(fixture));
      }, { dataKey, fixture });
      const url = `http://127.0.0.1:${server.address().port}/`;
      await page.goto(url);
      await page.locator('#main').waitFor();
      let c = await controls(page);
      assert.equal(await c.projection.inputValue(), 'conservative');
      const defaultUntil = await c.until.inputValue();
      assert.equal(defaultUntil, await page.evaluate(() => {
        const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0).toLocaleDateString('en-CA');
      }));
      await c.until.fill('2030-12-31');
      await c.until.dispatchEvent('change');
      c = await controls(page);
      await c.projection.selectOption('expected');
      assert.equal(await projected(page), 1130);
      await page.reload();
      c = await controls(page);
      assert.equal(await c.projection.inputValue(), 'expected');
      assert.equal(await c.until.inputValue(), '2030-12-31');
      assert.equal(await projected(page), 1130);
      assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), dataKey), fixture);

      await c.projection.selectOption('conservative');
      assert.equal(await projected(page), 1050);
      c = await controls(page);
      await c.until.fill('2020-01-01');
      await c.until.dispatchEvent('change');
      assert.equal(await projected(page), 1100);
      await page.reload();
      assert.equal(await projected(page), 1100);
      assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), dataKey), fixture);

      await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ projection: 'incorrecta', until: '2030-12-31' })), prefsKey);
      await page.reload();
      c = await controls(page);
      assert.equal(await c.projection.inputValue(), 'conservative');
      assert.equal(await c.until.inputValue(), '2030-12-31');
      await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ projection: 'expected', until: '2026-02-30' })), prefsKey);
      await page.reload();
      c = await controls(page);
      assert.equal(await c.projection.inputValue(), 'expected');
      assert.equal(await c.until.inputValue(), defaultUntil);
      await page.evaluate(key => localStorage.setItem(key, '{incompleto'), prefsKey);
      await page.reload();
      c = await controls(page);
      assert.equal(await c.projection.inputValue(), 'conservative');
      assert.equal(await c.until.inputValue(), defaultUntil);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`ok - preferencias, recarga, valores inválidos y cálculos a ${width}px`);
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
