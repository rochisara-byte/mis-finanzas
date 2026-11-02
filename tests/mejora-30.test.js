const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const url = process.env.APP_URL || 'http://127.0.0.1:8767/';
const key = 'mis-finanzas-offline-v1';
const captureDir = process.env.CAPTURE_DIR;
const tx = (id, date, status, type, amount) => ({ id, date, status, type, amount,
  title: `Movimiento ficticio ${id}`, category: 'Servicios', account: 'cash',
  toAccount: type === 'transfer' ? 'bank' : '', list: 'home', repeat: id === 'late' ? 'monthly' : '',
  recurrenceAmount: id === 'late' ? 20 : undefined, created: '2026-11-01T12:00:00.000Z' });
const fixture = { version: 1, device: 'prueba-ficticia', revision: 0, updatedAt: '2026-11-01T00:00:00.000Z',
  accounts: [{ id: 'cash', name: 'Caja de prueba', type: 'cash', opening: 1000 },
    { id: 'bank', name: 'Banco de prueba', type: 'bank', opening: 500 }],
  lists: [{ id: 'home', name: 'Hogar de prueba' }], categories: ['Servicios'],
  budgets: [{ id: 'budget', category: 'Servicios', amount: 100 }],
  goals: [{ id: 'goal', name: 'Meta de prueba', target: 500, saved: 100 }],
  debts: [{ id: 'debt', name: 'Deuda de prueba', balance: 200 }], settings: {},
  transactions: [tx('late', '2026-11-10', 'pending', 'expense', 20),
    tx('late2', '2026-11-08', 'pending', 'expense', 5),
    tx('today', '2026-11-15', 'pending', 'expense', 15),
    tx('next', '2026-11-20', 'pending', 'expense', 30),
    tx('next2', '2026-11-22', 'pending', 'expense', 7),
    tx('paid', '2026-11-13', 'done', 'expense', 40),
    tx('income', '2026-11-14', 'done', 'income', 100),
    tx('transfer', '2026-11-15', 'done', 'transfer', 10)],
};

async function run(width) {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    await page.clock.install({ time: new Date('2026-11-15T12:00:00Z') });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://accounts.google.com/**', route => route.abort());
    await page.addInitScript(({ key, fixture }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(fixture));
      window.google = { accounts: { oauth2: { initTokenClient(options) {
        return { requestAccessToken() { options.callback({ error: 'access_denied' }); } };
      } } } };
    }, { key, fixture });
    await page.goto(url);
    const original = await page.evaluate(key => localStorage.getItem(key), key);
    const capture = async name => { if (!captureDir) return; fs.mkdirSync(captureDir, { recursive: true });
      if (await page.locator('#driveToastDismiss').isVisible()) await page.locator('#driveToastDismiss').click();
      await page.screenshot({ path: path.join(captureDir, `${name}-${width}.png`), fullPage: true }); };
    const nav = width >= 1024 ? '#desktopNav' : '#nav';
    assert.equal(await page.locator('.agenda-group').count(), 3);
    assert.equal(await page.locator('.agenda-group .month-group').count(), 2);
    assert.equal(await page.locator('[data-month="late:2026-11"]').count(), 1);
    assert.equal(await page.locator('[data-month="next:2026-11"]').count(), 1);
    assert.equal(await page.locator('.agenda-group .transaction').count(), 5);
    assert.equal(await page.locator('.agenda-group').first().locator('.date-group').count(), 2);
    assert.equal(await page.locator('.agenda-completed [data-action="toggleCompleted"]').getAttribute('aria-expanded'), 'false');
    for (const selector of ['.agenda-main-head', '.agenda-completed-toggle']) {
      assert.equal(await page.locator(selector).evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
      assert.equal(await page.locator(selector).evaluate(el => getComputedStyle(el).borderBottomWidth), '2px');
    }
    assert.equal(await page.locator('.agenda-main-head select').count(), 0);
    assert.equal(await page.locator('.filters-panel #agendaPeriod').count(), 1);
    assert.equal(await page.locator('.agenda-history').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(243, 245, 249)');
    assert.equal(await page.locator('.agenda-pending-toggle').getAttribute('aria-expanded'), 'true');
    await page.locator('.agenda-pending-toggle').click();
    assert.equal(await page.locator('.agenda-groups').isVisible(), false);
    assert.equal(await page.locator('.agenda-pending-toggle span').textContent(), '5');
    await page.locator('.agenda-pending-toggle').click();
    assert.equal(await page.locator('.agenda-group').count(), 3);
    await page.locator('.agenda-completed-toggle').click();
    assert.equal(await page.locator('.agenda-completed-body .transaction').count(), 3);
    await page.locator('.agenda-completed-toggle').click();
    assert.equal(await page.locator('.agenda-completed-body').count(), 0);
    await page.locator('[data-group="next:"]').click();
    assert.equal(await page.locator('.agenda-group').last().locator('.transaction').first().isVisible(), false);
    assert.equal(await page.locator('[data-group="late:"]').getAttribute('aria-expanded'), 'true');
    await page.locator('[data-group="next:"]').click();
    await page.locator('[data-group="today:"]').click();
    assert.equal(await page.locator('.agenda-group').nth(1).locator('.transaction').first().isVisible(), false);
    await page.locator('[data-group="today:"]').click();
    await capture('inicio');

    const late = page.locator('.agenda-group').first();
    await late.locator('[data-action="toggleMonth"]').click();
    assert.equal(await late.locator('.month-group-body').isVisible(), false);
    assert.equal(await page.locator('[data-month="next:2026-11"]').getAttribute('aria-expanded'), 'true');
    await page.locator('.agenda-group').last().locator('[data-action="toggleDate"]').first().click();
    assert.equal(await page.locator('.agenda-group').last().locator('.date-group-body').first().isVisible(), false);
    assert.equal(await page.locator('.agenda-group').last().locator('.date-group-body').last().isVisible(), true);
    await page.locator('[data-action="showHistory"]').click();
    assert.equal(await page.locator('.agenda-history.active').getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('#main .transaction').count(), 8);
    await page.locator('[data-action="showAgenda"]').click();
    assert.equal(await page.locator('[data-month="late:2026-11"]').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.agenda-group').last().locator('[data-action="toggleDate"]').first().getAttribute('aria-expanded'), 'false');
    await page.locator('[data-filter="Gastos"]').click();
    assert.equal(await page.locator('[data-month="late:2026-11"]').getAttribute('aria-expanded'), 'false');
    await page.locator('[data-filter="Todos"]').click();
    await page.locator('#searchToggle').click();
    await page.locator('#search').pressSequentially('Movimiento ficticio');
    assert.equal(await page.locator('#agendaPeriod').count(), 1);
    assert.equal(await page.locator('.agenda-main-head select').count(), 0);
    await page.locator('#agendaPeriod').selectOption('7');
    assert.equal(await page.locator('.agenda-group .transaction').count(), 4);
    assert.equal(await page.locator('.agenda-group').first().locator('.transaction').count(), 2);
    assert.equal(await page.locator('#search').inputValue(), 'Movimiento ficticio');
    assert.equal(await page.locator('#search').evaluate(el => document.activeElement === el), true);
    assert.equal(await page.locator('#search').evaluate(el => el.selectionStart), 'Movimiento ficticio'.length);
    assert.equal(await page.locator('.filters-panel').evaluate(el => el.open), true);
    assert.equal(await page.locator('[data-month="late:2026-11"]').getAttribute('aria-expanded'), 'false');
    await page.locator('#agendaPeriod').selectOption('30');
    assert.equal(await page.locator('.agenda-group .transaction').count(), 5);
    await page.locator('#agendaPeriod').selectOption('all');
    assert.equal(await page.locator('.agenda-group .transaction').count(), 5);
    assert.equal(await page.locator('#search').evaluate(el => document.activeElement === el), true);
    await page.locator('#search').pressSequentially(' today');
    assert.equal(await page.locator('.filters-panel').evaluate(el => el.open), true);
    assert.equal(await page.locator('#main .transaction').count(), 1);
    await page.locator('#search').fill('');

    await page.locator(`${nav} [data-page="Análisis"]`).click();
    assert.equal(await page.locator('.analysis-actions .chip').count(), 4);
    assert.equal(await page.locator('.forecast-strip>div').count(), 3);
    assert.equal(await page.locator('.forecast-strip strong').nth(0).textContent().then(s => s.includes('40')), true);
    assert.equal(await page.locator('.forecast-strip strong').nth(1).textContent().then(s => s.includes('77')), true);
    assert.equal(await page.locator('.forecast-strip strong').nth(2).textContent().then(s => s.includes('117')), true);
    assert.equal(await page.locator('.analysis-actions .chip.active').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(38, 53, 79)');
    const expenseColor = await page.locator('#main>.grid .metric:nth-child(2) b').evaluate(el => getComputedStyle(el).color);
    const incomeColor = await page.locator('#main>.grid .metric:nth-child(1) b').evaluate(el => getComputedStyle(el).color);
    assert.equal(expenseColor, 'rgb(216, 78, 112)');
    assert.equal(incomeColor, 'rgb(22, 140, 114)');
    assert.equal(await page.locator('.budget-row').count(), 2);
    assert.equal(await page.locator('.budget-row .progress i').nth(0).evaluate(el => getComputedStyle(el).backgroundColor),
      await page.locator('.budget-row .progress i').nth(1).evaluate(el => getComputedStyle(el).backgroundColor));
    assert.match(await page.locator('#main').textContent(), /Meta de prueba/);
    assert.match(await page.locator('#main').textContent(), /Deuda de prueba/);
    assert.equal(await page.locator('.debt-progress').getAttribute('aria-valuenow'), '0');
    await capture('analisis');
    await page.locator('[data-action="showMetricDetail"][data-detail="doneMonth"]').click();
    assert.equal(await page.locator('#metric-detail-display').isVisible(), true);
    assert.match(await page.locator('#metric-detail-list').textContent(), /Movimiento ficticio paid/);
    await page.locator('[data-action="showMetricDetail"][data-detail="pendingMonth"]').click();
    assert.match(await page.locator('#metric-detail-list').textContent(), /Movimiento ficticio late/);
    await page.locator('[data-action="showMetricDetail"][data-detail="allMonth"]').click();
    assert.match(await page.locator('#metric-detail-list').textContent(), /Movimiento ficticio next/);
    await page.locator('[data-action="editBudget"]').click();
    assert.equal(await page.locator('#form[data-form="edit-budget"]').count(), 1);
    await page.locator('#modal [data-action="close"]').first().click();
    await page.locator('[data-action="addGoal"]').click();
    assert.equal(await page.locator('#form[data-form="linked-payment"]').count(), 1);
    await page.locator('#modal [data-action="close"]').first().click();
    await page.locator('[data-action="payDebt"]').click();
    assert.equal(await page.locator('#form[data-form="linked-payment"]').count(), 1);
    await page.locator('#modal [data-action="close"]').first().click();
    await page.locator(`${nav} [data-page="Inicio"]`).click();
    assert.equal(await page.locator('[data-month="late:2026-11"]').getAttribute('aria-expanded'), 'false');
    await page.locator('.transaction[data-id="today"] [data-action="actions"]').click();
    await page.locator('[data-action="edit"][data-id="today"]').click();
    await page.locator('#modal .quick-close').click();
    await page.locator('.agenda-group').first().locator('[data-action="toggleMonth"]').click();
    await page.locator('.transaction[data-id="late"] [data-action="actions"]').click();
    await page.locator('[data-action="edit"][data-id="late"]').click();
    await page.locator('#modal .quick-details > summary').click();
    assert.equal(await page.locator('#modal .recurrence-habitual summary svg').count(), 1);
    await page.locator('#modal .quick-close').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), original);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`ok - Mejora 30 a ${width}px`);
  } finally { await browser.close(); }
}

async function runDense(width) {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    await page.clock.install({ time: new Date('2026-11-15T12:00:00Z') });
    const dense = structuredClone(fixture);
    dense.budgets = Array.from({ length: 6 }, (_, i) => ({ id: `budget-${i}`, category: `Prueba ${i}`, amount: 100 }));
    dense.goals = Array.from({ length: 6 }, (_, i) => ({ id: `goal-${i}`, name: `Meta ficticia ${i}`, target: 100, saved: 0 }));
    dense.debts = Array.from({ length: 6 }, (_, i) => ({ id: `debt-${i}`, name: `Deuda ficticia ${i}`, balance: i === 5 ? null : 200 }));
    dense.transactions.push(tx('dec', '2026-12-01', 'pending', 'expense', 10));
    dense.transactions.push(tx('jan', '2027-01-01', 'pending', 'expense', 10));
    dense.transactions.push({ ...tx('abono', '2026-11-14', 'done', 'expense', 50), linkKind: 'debt', linkId: 'debt-0' });
    await page.addInitScript(({ key, dense }) => localStorage.setItem(key, JSON.stringify(dense)), { key, dense });
    await page.goto(url);
    await page.locator('#searchToggle').click();
    await page.locator('#agendaPeriod').selectOption('all');
    assert.deepEqual(await page.locator('[data-group="next:"] + .agenda-group-body .month-toggle span').allTextContents(),
      ['noviembre de 2026', 'diciembre de 2026', 'enero de 2027']);
    await page.locator('[data-month="next:2026-12"]').click();
    assert.equal(await page.locator('[data-month="next:2026-12"]').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('[data-month="next:2026-11"]').getAttribute('aria-expanded'), 'true');
    await page.locator('[data-group="next:"]').click();
    assert.equal(await page.locator('.agenda-group').last().locator('.transaction:visible').count(), 0);
    await page.locator('[data-group="next:"]').click();
    assert.equal(await page.locator('.agenda-group').last().locator('.transaction').count(), 4);
    const nav = width >= 1024 ? '#desktopNav' : '#nav';
    await page.locator(`${nav} [data-page="Análisis"]`).click();
    assert.equal(await page.locator('.analysis-tracking-column').count(), 3);
    for (const section of await page.locator('.analysis-tracking-column').all()) {
      assert.equal(await section.locator(':scope > .budget-row:visible,:scope > .item:visible').count(), 3);
      await section.locator('.analysis-more').click();
      assert.equal(await section.locator(':scope > .budget-row:visible,:scope > .item:visible').count(), 6);
      await section.locator('.analysis-more').click();
      assert.equal(await section.locator(':scope > .budget-row:visible,:scope > .item:visible').count(), 3);
    }
    assert.equal(await page.locator('.debt-progress').count(), 5);
    assert.equal(await page.locator('.debt-progress').first().getAttribute('aria-valuenow'), '25');
    assert.equal(await page.locator('.analysis-tracking-column').last().locator('[data-action="payDebt"]').count(), 6);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.close();
    const empty = structuredClone(fixture);
    empty.budgets = [];
    const blank = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    await blank.addInitScript(({ key, empty }) => localStorage.setItem(key, JSON.stringify(empty)), { key, empty });
    await blank.goto(url);
    await blank.locator(`${nav} [data-page="Análisis"]`).click();
    const emptyBox = blank.locator('.analysis-tracking-column').first().locator('.empty');
    assert.equal(await emptyBox.isVisible(), true);
    assert.ok((await emptyBox.boundingBox()).height < 60);
    await blank.close();
    console.log(`ok - revisión densa y estado vacío a ${width}px`);
  } finally { await browser.close(); }
}

(async () => { for (const width of [375, 1280]) { await run(width); await runDense(width); } })().catch(error => {
  console.error(error); process.exitCode = 1;
});
