const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const key = 'mis-finanzas-offline-v1';
const url = process.env.APP_URL || 'http://127.0.0.1:8767/';
const fixture = { version: 1, device: 'prueba-ficticia', revision: 0, updatedAt: '2026-11-02T00:00:00Z',
  accounts: [{ id: 'bank', name: 'Banco ficticio', type: 'bank', opening: 5000 }, { id: 'cash', name: 'Efectivo ficticio', type: 'cash', opening: 100 }, { id: 'credit', name: 'Crédito ficticio', type: 'credit', opening: 700 }],
  lists: [], categories: ['Otros'], budgets: [], goals: [{ id: 'goal', name: 'Meta ficticia', target: 1000, saved: 0 }], debts: [], settings: {}, transactions: [
    { id: 'old', type: 'expense', title: 'Anterior', amount: 50, date: '2026-10-29', account: 'bank', status: 'done', created: '2026-10-29T00:00:00Z' },
    { id: 'mid', type: 'income', title: 'Medio', amount: 20, date: '2026-10-30', account: 'cash', status: 'done', created: '2026-10-30T00:00:00Z' },
    { id: 'latest', type: 'transfer', title: 'Traspaso', amount: 200, date: '2026-11-01', account: 'bank', toAccount: 'cash', status: 'done', created: '2026-11-01T00:00:00Z' },
    { id: 'pending', type: 'expense', title: 'Sin pagar', amount: 80, date: '2026-11-02', account: 'bank', status: 'pending', created: '2026-11-02T00:00:00Z' },
    { id: 'deleted', type: 'expense', title: 'Borrado', amount: 500, date: '2026-10-31', account: 'bank', status: 'done', deleted: true, created: '2026-10-31T00:00:00Z' },
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
    const capture = async name => { if (!process.env.CAPTURE_DIR) return; fs.mkdirSync(process.env.CAPTURE_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.CAPTURE_DIR, `${name}-${width}.png`), fullPage: true }); };
    const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    assert.equal(await page.locator('.summary-grid .metric').first().textContent().then(s => s.includes('5.070')), true);
    await page.locator('[data-action="showHistory"]').click();
    assert.deepEqual(await page.locator('.date-toggle').allTextContents().then(a => a.map(s => s.match(/\d{4}-\d{2}-\d{2}/)?.[0])), ['2026-11-02', '2026-11-01', '2026-10-30', '2026-10-29']);
    assert.deepEqual(await page.locator('.date-toggle').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-expanded'))), ['true', 'false', 'false', 'false']);
    await capture('historial');
    await page.locator('[data-date="history:2026-10-30"]').click();
    await page.locator('[data-date="history:2026-10-29"]').click();
    assert.equal(await page.locator('.date-toggle[aria-expanded="true"]').count(), 3);
    await page.locator('#historyType').selectOption('expense');
    assert.equal(await page.locator('[data-date="history:2026-10-29"]').getAttribute('aria-expanded'), 'true');
    await page.locator('#historyType').selectOption('');
    const nav = width < 1024 ? '#nav' : '#desktopNav';
    await page.locator(`${nav} [data-page="Cuentas"]`).click();
    await page.locator(`${nav} [data-page="Inicio"]`).click();
    await page.locator('[data-action="showHistory"]').click();
    assert.equal(await page.locator('.date-toggle[aria-expanded="true"]').count(), 1);
    await page.locator('[data-action="showAgenda"]').click();
    await page.locator('[data-action="showHistory"]').click();
    assert.deepEqual(await page.locator('.date-toggle').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-expanded'))), ['true', 'false', 'false', 'false']);
    await page.locator('[data-action="showAgenda"]').click();
    if (width < 1024) await page.locator('#add').click();
    const entry = page.locator('#modal #quickEntry');
    await entry.fill('Pago 1500');
    assert.equal(await entry.inputValue(), 'Pago 1.500');
    await entry.pressSequentially('0');
    assert.equal(await entry.inputValue(), 'Pago 15.000');
    await entry.evaluate(el => el.setSelectionRange(7, 7));
    await entry.press('5');
    assert.equal(await entry.inputValue(), 'Pago 155.000');
    await entry.fill('Pago 1250000,25');
    assert.equal(await entry.inputValue(), 'Pago 1.250.000,25');
    await entry.evaluate(el => el.setSelectionRange(7, 7));
    await entry.press('Backspace');
    assert.equal(await entry.inputValue(), 'Pago 250.000,25');
    await entry.fill('Pago 1250000,25');
    await entry.evaluate(el => el.setSelectionRange(0, 0));
    await page.locator('.emoji-open').click();
    await capture('emoji-selector');
    await page.locator('.emoji-choice[aria-label="sonrisa feliz"]').click();
    assert.equal(await entry.inputValue(), '😀Pago 1.250.000,25');
    await entry.evaluate(el => el.setSelectionRange(4, 4));
    await page.locator('.emoji-open').click();
    await page.locator('[data-emoji-category="Compras"]').click();
    await page.locator('.emoji-choice[aria-label="regalo"]').click();
    assert.match(await entry.inputValue(), /Pa🎁go/);
    await page.locator('.emoji-open').click();
    await page.locator('.emoji-search').fill('piel');
    await page.locator('.emoji-choice[aria-label="saludo mano piel"]').click();
    assert.match(await entry.inputValue(), /👋🏽/);
    await entry.evaluate(el => { const at = el.value.lastIndexOf(' '); el.setSelectionRange(at, at); });
    await page.locator('.emoji-open').click();
    await page.locator('.emoji-search').fill('programadora');
    await page.locator('.emoji-choice[aria-label="programadora trabajo"]').click();
    assert.match(await entry.inputValue(), /👩‍💻 1\.250\.000,25$/);
    await page.locator('#modal .quick-details > summary').click();
    await page.locator('#modal [name="repeat"]').selectOption('monthly');
    await page.locator('#modal .recurrence-habitual > summary').click();
    const habitual = page.locator('#modal [name="recurrenceAmount"]');
    await habitual.fill('25000,50');
    assert.equal(await habitual.inputValue(), '25.000,50');
    await capture('importe');
    await page.locator('#modal .quick-save').click();
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).transactions.length >= 7, key);
    const db = await saved();
    const created = db.transactions.find(t => t.id !== 'old' && t.id !== 'mid' && t.id !== 'latest' && t.id !== 'pending' && t.id !== 'deleted');
    assert.ok(created);
    assert.equal(created.amount, 1250000.25);
    assert.equal(created.recurrenceAmount, 25000.5);
    assert.match(created.title, /😀Pa🎁👋🏽go👩‍💻/);
    assert.equal(db.transactions.find(t => t.recurrenceParentId === created.id)?.amount, 25000.5);
    await page.reload();
    assert.equal((await saved()).transactions.find(t => t.id === created.id).title, created.title);
    if (width < 1024) await page.locator('#add').click();
    await page.locator('#modal [name="type"]').selectOption('transfer');
    await page.locator('#modal #quickEntry').fill('Traspaso ficticio 2500,75');
    assert.equal(await page.locator('#modal #quickEntry').inputValue(), 'Traspaso ficticio 2.500,75');
    await page.locator('#modal .quick-details > summary').click();
    await page.locator('#modal [name="toAccount"]').selectOption('cash');
    await page.locator('#modal .quick-save').click();
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).transactions.some(t => t.title === 'Traspaso ficticio'), key);
    assert.equal((await saved()).transactions.find(t => t.title === 'Traspaso ficticio').amount, 2500.75);
    await page.locator(`${nav} [data-page="Análisis"]`).click();
    await page.locator('[data-action="addGoal"]').click();
    const linked = page.locator('#modal #form[data-form="linked-payment"] [name="amount"]');
    await linked.fill('12500,50');
    assert.equal(await linked.inputValue(), '12.500,50');
    await page.locator('#modal #form[data-form="linked-payment"] button[type="submit"]').click();
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).transactions.some(t => t.linkId === 'goal'), key);
    assert.equal((await saved()).transactions.find(t => t.linkId === 'goal').amount, 12500.5);
    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(() => saveFile());
    const backup = JSON.parse(fs.readFileSync(await (await downloadPromise).path(), 'utf8'));
    assert.equal(backup.transactions.find(t => t.id === created.id).title, created.title);
    const chooserPromise = page.waitForEvent('filechooser');
    await page.evaluate(() => importFile());
    const chooser = await chooserPromise;
    page.once('dialog', dialog => dialog.accept());
    await chooser.setFiles({ name: 'respaldo-ficticio.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.waitForFunction(({ key, id, title }) => JSON.parse(localStorage.getItem(key)).transactions.find(t => t.id === id)?.title === title, { key, id: created.id, title: created.title });
    assert.deepEqual(errors, []);
    console.log(`ok - Mejora 32 a ${width}px`);
  } finally { await browser.close(); }
}

(async () => { for (const width of [375, 1280]) await run(width); })().catch(error => { console.error(error); process.exitCode = 1; });
