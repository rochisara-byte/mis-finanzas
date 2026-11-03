const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const key = 'mis-finanzas-offline-v1';
const url = process.env.APP_URL || 'http://127.0.0.1:8767/';
const movement = (id, date, type = 'expense', category = 'Otros') => ({ id, type, title: `Movimiento ficticio ${id}`, amount: 10, date, account: 'cash', category, status: 'done', created: `${date}T12:00:00Z` });
const fixture = { version: 1, device: 'historial-ficticio', revision: 0, updatedAt: '2026-11-02T00:00:00Z',
  accounts: [{ id: 'cash', name: 'Caja ficticia', type: 'cash', opening: 2000 }], lists: [], categories: ['Otros', 'Servicios'], budgets: [], goals: [], debts: [], settings: {},
  transactions: [
    ...Array.from({ length: 95 }, (_, i) => movement(`nov-${i}`, '2026-11-02')),
    movement('nov-otro', '2026-11-01'),
    movement('oct-1', '2026-10-30'),
    movement('oct-2', '2026-10-30', 'income', 'Servicios'),
    movement('sep-1', '2026-09-05'),
    movement('sep-2', '2026-09-04'),
    movement('older-1', '2025-12-31'),
    movement('older-2', '2025-12-30'),
  ] };

async function run(width) {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    await page.clock.install({ time: new Date('2026-11-02T12:00:00Z') });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('https://accounts.google.com/**', route => route.abort());
    await page.addInitScript(({ key, fixture }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(fixture)); }, { key, fixture });
    await page.goto(url);
    const capture = async name => { if (!process.env.CAPTURE_DIR) return; fs.mkdirSync(process.env.CAPTURE_DIR, { recursive: true }); if (await page.locator('#driveToastDismiss').isVisible()) await page.locator('#driveToastDismiss').click(); await page.screenshot({ path: path.join(process.env.CAPTURE_DIR, `${name}-${width}.png`), fullPage: width >= 1024 }); };
    const months = page.locator('.history-month .month-toggle');
    const dates = page.locator('.history-date .date-toggle');
    await page.locator('[data-action="showHistory"]').click();
    assert.deepEqual(await months.locator('span').allTextContents(), ['Noviembre 2026', 'Octubre 2026', 'Septiembre 2026']);
    assert.deepEqual(await months.evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-expanded'))), ['true', 'false', 'false']);
    assert.deepEqual(await dates.allTextContents().then(a => a.map(s => s.match(/\d{2}\/\d{2}\/\d{4}/)?.[0])), ['02/11/2026', '01/11/2026', '30/10/2026', '05/09/2026', '04/09/2026']);
    assert.equal(await dates.locator('xpath=..').count(), 5);
    assert.equal(await page.locator('.history-date .date-toggle[aria-expanded="true"]').count(), 1);
    assert.match(await months.nth(0).textContent(), /96 movimientos/);
    assert.match(await dates.nth(0).textContent(), /95 movimientos/);
    assert.equal(await page.locator('.history-date .transaction').count(), 100);
    await page.locator('[data-month="history-month:2026-10"]').click();
    await page.locator('[data-month="history-month:2026-09"]').click();
    await page.locator('[data-date="history:2026-10-30"]').click();
    await page.locator('[data-date="history:2026-09-05"]').click();
    assert.equal(await page.locator('.history-month .month-toggle[aria-expanded="true"]').count(), 3);
    assert.equal(await page.locator('.history-date .date-toggle[aria-expanded="true"]').count(), 3);
    await page.locator('[data-month="history-month:2026-11"]').click();
    await page.locator('#historyCategory').selectOption('Servicios');
    assert.deepEqual(await months.locator('span').allTextContents(), ['Octubre 2026']);
    assert.match(await months.first().textContent(), /1 movimiento/);
    await page.locator('#historyCategory').selectOption('');
    assert.equal(await page.locator('[data-month="history-month:2026-11"]').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('[data-month="history-month:2026-10"]').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('[data-date="history:2026-09-05"]').getAttribute('aria-expanded'), 'true');
    await page.locator('#searchToggle').click();
    await page.locator('#search').fill('oct-1');
    assert.deepEqual(await months.locator('span').allTextContents(), ['Octubre 2026']);
    await page.locator('#search').fill('');
    await page.locator('[data-action="moreHistory"]').click();
    assert.deepEqual(await months.locator('span').allTextContents(), ['Noviembre 2026', 'Octubre 2026', 'Septiembre 2026', 'Diciembre 2025']);
    assert.equal(await page.locator('[data-month="history-month:2025-12"]').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.history-month').count(), 4);
    assert.equal(await page.locator('.history-date .transaction').count(), 102);
    await page.locator('[data-month="history-month:2025-12"]').click();
    await page.locator('[data-date="history:2025-12-31"]').click();
    assert.equal(await page.locator('.history-date .date-toggle[aria-expanded="true"]').count(), 4);
    const nav = width < 1024 ? '#nav' : '#desktopNav';
    await page.locator(`${nav} [data-page="Cuentas"]`).click();
    await page.locator(`${nav} [data-page="Inicio"]`).click();
    await page.locator('[data-action="showHistory"]').click();
    assert.equal(await page.locator('.history-month .month-toggle[aria-expanded="true"]').count(), 1);
    assert.equal(await page.locator('.history-date .date-toggle[aria-expanded="true"]').count(), 1);
    await page.evaluate(key => { const db = JSON.parse(localStorage.getItem(key)); db.transactions = db.transactions.filter(t => ['nov-0','nov-otro','oct-1','oct-2','sep-1','sep-2'].includes(t.id)); localStorage.setItem(key, JSON.stringify(db)); }, key);
    await page.reload();
    await page.locator('[data-action="showHistory"]').click();
    await capture('historial-compacto');
    await page.locator('[data-month="history-month:2026-10"]').click();
    await page.locator('[data-month="history-month:2026-09"]').click();
    await page.locator('[data-date="history:2026-10-30"]').click();
    await page.locator('[data-date="history:2026-09-05"]').click();
    await capture('historial-expandido');
    await page.evaluate(key => { const db = JSON.parse(localStorage.getItem(key)); db.transactions = [db.transactions[0]]; localStorage.setItem(key, JSON.stringify(db)); }, key);
    await page.reload();
    await page.locator('[data-action="showHistory"]').click();
    assert.equal(await months.count(), 1); assert.equal(await dates.count(), 1);
    await page.evaluate(key => { const db = JSON.parse(localStorage.getItem(key)); db.transactions = []; localStorage.setItem(key, JSON.stringify(db)); }, key);
    await page.reload();
    await page.locator('[data-action="showHistory"]').click();
    assert.equal(await months.count(), 0);
    assert.match(await page.locator('.movements .empty').textContent(), /Sin movimientos/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`ok - historial mensual a ${width}px`);
  } finally { await browser.close(); }
}

(async () => { for (const width of [375, 1280]) await run(width); })().catch(error => { console.error(error); process.exitCode = 1; });
