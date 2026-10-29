const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const key = 'mis-finanzas-offline-v1';
const url = process.env.APP_URL || 'http://127.0.0.1:8766/';
const day = new Date().toLocaleDateString('en-CA');
const fixture = {
  version: 1, device: 'ficticio', revision: 0, updatedAt: new Date().toISOString(),
  accounts: [{ id: 'cash', name: 'Caja ficticia', type: 'cash', opening: 1000 }],
  lists: [{ id: 'home', name: 'Hogar ficticio' }], categories: ['Servicios', 'Otros'],
  budgets: [], goals: [], debts: [], settings: {},
  transactions: [
    { id: 'r1', type: 'expense', title: 'Servicio ficticio', amount: 80, recurrenceAmount: 100,
      category: 'Servicios', date: day, account: 'cash', list: 'home', status: 'pending', repeat: 'monthly',
      created: new Date().toISOString() },
    { id: 'past', type: 'income', title: 'Ingreso ficticio', amount: 200, category: 'Otros',
      date: day, account: 'cash', status: 'done', repeat: '', completedAt: new Date().toISOString(),
      created: new Date().toISOString() },
  ],
};

async function run(width) {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://accounts.google.com/**', route => route.abort());
    await page.addInitScript(({ key, fixture }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(fixture));
    }, { key, fixture });
    await page.goto(url);
    assert.equal(await page.locator('#main .transaction').count(), 1);
    await page.locator('#agendaPeriod').selectOption('7');
    await page.reload();
    assert.equal(await page.locator('#agendaPeriod').inputValue(), '7');
    await page.locator('.transaction[data-id="r1"] [data-action="toggle"]').click();
    const records = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)).transactions, key);
    let all = await records();
    assert.equal(all.find(t => t.id === 'r1').amount, 80);
    const next = all.find(t => t.recurrenceParentId === 'r1');
    assert.equal(next.amount, 100);
    assert.equal(await page.locator('.agenda-section').last().textContent().then(s => s.includes('Completados')), true);
    await page.locator('[data-action="undoMovement"]').click();
    all = await records();
    assert.equal(all.find(t => t.id === 'r1').status, 'pending');
    assert.equal(all.length, 3);
    await page.locator('.transaction[data-id="r1"] [data-action="toggle"]').click();
    assert.equal((await records()).length, 3);
    await page.locator('[data-action="showHistory"]').click();
    assert.equal(await page.locator('.transaction[data-id="past"]').count(), 1);
    await page.locator('.transaction[data-id="r1"] [data-action="actions"]').click();
    await page.locator('[data-action="edit"][data-id="r1"]').click();
    await page.locator('#modal .quick-details > summary').click();
    await page.locator('#modal .recurrence-habitual > summary').click();
    await page.locator('#modal [name="recurrenceAmount"]').fill('120');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#modal .quick-save').click();
    await page.waitForFunction(({ key, id }) => JSON.parse(localStorage.getItem(key)).transactions.find(t => t.id === id)?.amount === 120,
      { key, id: next.id });
    all = await records();
    assert.equal(all.find(t => t.id === 'r1').amount, 80);
    assert.equal(all.find(t => t.id === next.id).amount, 120);
    await page.locator('#historyStatus').selectOption('pending');
    assert.equal(await page.locator('.transaction[data-id="past"]').count(), 0);
    await page.reload();
    assert.equal((await records()).length, 3);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`ok - agenda, pago, reversión, historial y recarga a ${width}px`);
  } finally { await browser.close(); }
}

(async () => { await run(390); await run(1280); })().catch(error => { console.error(error); process.exitCode = 1; });
