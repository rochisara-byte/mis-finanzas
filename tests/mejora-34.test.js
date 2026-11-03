const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const key = 'mis-finanzas-offline-v1';
const address = process.env.APP_URL || 'http://127.0.0.1:8767/';
const fixture = { version: 1, device: 'mejora-34-ficticia', revision: 0, updatedAt: '2026-11-02T12:00:00Z',
  accounts: [{ id: 'caja', name: 'Caja ficticia', type: 'cash', opening: 100000 }],
  lists: [{ id: 'lista', name: 'Lista ficticia' }], categories: ['Otros'], transactions: [], budgets: [], goals: [], debts: [], settings: {} };

async function run(width) {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
    await page.addInitScript(({ key, fixture }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(fixture)); }, { key, fixture });
    await page.route('https://accounts.google.com/**', route => route.abort());
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(address);
    const nav = width < 1024 ? '#nav' : '#desktopNav';
    const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    await page.locator(`${nav} [data-page="Listas"]`).click();
    assert.equal(await page.locator('.lists-main .item').count(), 3);
    assert.equal(await page.locator('.lists-smart .item').count(), 5);
    const boxes = await page.locator('.lists-main,.lists-smart,.wish-section').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
    if (width < 768) assert.ok(boxes[0].bottom <= boxes[1].top && boxes[1].bottom <= boxes[2].top);
    else assert.ok(Math.abs(boxes[0].top - boxes[1].top) < 20 && boxes[2].top >= boxes[0].bottom);
    if (process.env.CAPTURE_DIR) {
      fs.mkdirSync(process.env.CAPTURE_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.CAPTURE_DIR, `listas-${width}.png`) });
    }

    if (width < 1024) await page.locator('#add').click();
    const form = page.locator('#modal #form');
    await form.locator('#quickEntry').fill('Compra ficticia 1.234,56');
    await form.locator('.quick-details > summary').click();
    await form.locator('[name="notes"]').fill('Nota conservada');
    await form.locator('[data-action="catQuickAdd"]').click();
    assert.equal(await page.locator('.overlay').count(), 1);
    assert.equal(await page.locator('.context-panel').count(), 1);
    await page.locator('.context-panel [data-context-cancel]').last().click();
    assert.equal(await form.locator('#quickEntry').inputValue(), 'Compra ficticia 1.234,56');
    assert.equal(await form.locator('[name="notes"]').inputValue(), 'Nota conservada');
    assert.equal((await stored()).revision, 0);

    await form.locator('[data-action="catQuickAdd"]').click();
    await page.locator('.context-panel [name="contextName"]').fill('Otros');
    await page.locator('.context-panel [data-context-save]').click();
    assert.match(await page.locator('.context-error').textContent(), /Ya existe/);
    await page.locator('.context-panel [name="contextName"]').fill('Categoría nueva');
    await page.locator('.context-panel [data-context-icon="cart"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.CAPTURE_DIR) await page.screenshot({ path: path.join(process.env.CAPTURE_DIR, `creacion-contextual-${width}.png`) });
    await page.locator('.context-panel [data-context-save]').click();
    assert.equal(await form.locator('[name="category"]').inputValue(), 'Categoría nueva');
    assert.equal((await stored()).categoryIcons['Categoría nueva'], 'cart');

    await form.locator('[data-context-target="list"]').click();
    await page.locator('.context-panel [name="contextName"]').fill('Lista nueva');
    await page.locator('.context-panel [data-context-save]').click();
    const list = (await stored()).lists.find(x => x.name === 'Lista nueva');
    assert.equal(await form.locator('[name="list"]').inputValue(), list.id);

    await form.locator('[data-context-target="account"]').click();
    await page.locator('.context-panel [name="contextName"]').fill('Banco nuevo');
    await page.locator('.context-panel [name="contextType"]').selectOption('bank');
    await page.locator('.context-panel [name="contextValue"]').fill('2500');
    await page.locator('.context-panel [data-context-save]').click();
    const account = (await stored()).accounts.find(x => x.name === 'Banco nuevo');
    assert.equal(await form.locator('[name="account"]').inputValue(), account.id);
    assert.equal(account.opening, 2500);
    assert.equal((await stored()).transactions.length, 0);

    await form.locator('[data-context-target="linkTarget"]').click();
    await page.locator('.context-panel [name="contextName"]').fill('Meta nueva');
    await page.locator('.context-panel [name="contextValue"]').fill('6000');
    await page.locator('.context-panel [data-context-save]').click();
    const goal = (await stored()).goals.find(x => x.name === 'Meta nueva');
    assert.equal(await form.locator('[name="linkTarget"]').inputValue(), `goal:${goal.id}`);

    await form.locator('[data-context-target="wishPicker"]').click();
    await page.locator('.context-panel [name="contextName"]').fill('Deseo nuevo');
    await page.locator('.context-panel [name="contextValue"]').fill('1500');
    await page.locator('.context-panel [data-context-save]').click();
    const wish = (await stored()).wishes.find(x => x.name === 'Deseo nuevo');
    assert.equal(await form.locator('[name="wishPicker"]').inputValue(), wish.id);
    assert.equal(await form.locator('#quickEntry').inputValue(), 'Compra ficticia 1.234,56');
    assert.equal(await form.locator('[name="notes"]').inputValue(), 'Nota conservada');
    if (process.env.CAPTURE_DIR) await page.screenshot({ path: path.join(process.env.CAPTURE_DIR, `formulario-${width}.png`) });
    await form.locator('.quick-save').click();
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).transactions.length === 1, key);
    let db = await stored();
    assert.equal(db.transactions[0].amount, 1234.56);
    assert.equal(db.transactions[0].wishId, wish.id);
    assert.equal(db.transactions[0].subcategory, '');
    assert.equal(db.transactions[0].list, list.id);
    assert.equal(db.transactions[0].account, account.id);
    assert.equal(db.transactions[0].linkId, goal.id);
    assert.equal(db.transactions[0].notes, 'Nota conservada');
    assert.equal(await page.evaluate(() => total()), 101265.44);
    await page.reload();
    db = await stored();
    assert.equal(db.transactions.length, 1);
    assert.equal(db.categories.includes('Categoría nueva'), true);
    assert.equal(db.wishes[0].id, wish.id);
    await page.evaluate(id => transactionForm(id), db.transactions[0].id);
    assert.equal(await page.locator('#modal #quickEntry').inputValue(), 'Compra ficticia 1.234,56');
    assert.equal(await page.locator('#modal [name="category"]').inputValue(), 'Categoría nueva');
    await page.locator('#modal .quick-save').click();
    assert.equal((await stored()).transactions.length, 1);

    await page.evaluate(id => wishForm(id), wish.id);
    await page.locator('#modal [name="notes"]').fill('Descripción conservada');
    await page.locator('#modal [data-context-target="goalId"]').click();
    await page.locator('.context-panel [name="contextName"]').fill('Meta nueva');
    await page.locator('.context-panel [name="contextValue"]').fill('9000');
    await page.locator('.context-panel [data-context-save]').click();
    assert.match(await page.locator('.context-error').textContent(), /nombre nuevo/);
    await page.locator('.context-panel [name="contextName"]').fill('Meta del deseo');
    await page.locator('.context-panel [data-context-save]').click();
    const wishGoal = (await stored()).goals.find(x => x.name === 'Meta del deseo');
    assert.equal(await page.locator('#modal [name="goalId"]').inputValue(), wishGoal.id);
    assert.equal(await page.locator('#modal [name="notes"]').inputValue(), 'Descripción conservada');
    await page.locator('#modal [data-context-target="account"]').click();
    await page.locator('.context-panel [data-context-cancel]').last().click();
    assert.equal(await page.locator('#modal [name="estimate"]').inputValue(), '1500');
    await page.locator('#modal #form button[type="submit"]').click();
    assert.equal((await stored()).wishes.find(x => x.id === wish.id).goalId, wishGoal.id);

    await page.evaluate(() => addRecord('newBudget'));
    await page.locator('#modal [name="amount"]').fill('5000');
    await page.locator('#modal [data-action="catQuickAdd"]').click();
    await page.locator('.context-panel [name="contextName"]').fill('Presupuesto nuevo');
    await page.locator('.context-panel [data-context-save]').click();
    assert.equal(await page.locator('#modal [name="category"]').inputValue(), 'Presupuesto nuevo');
    assert.equal(await page.locator('#modal [name="amount"]').inputValue(), '5000');
    await page.locator('#modal #form button[type="submit"]').click();
    assert.equal((await stored()).budgets.find(x => x.category === 'Presupuesto nuevo').amount, 5000);

    await page.evaluate(id => transactionForm(id), db.transactions[0].id);
    await page.locator('#modal .quick-details > summary').click();
    await page.locator('#modal [data-context-target="linkTarget"]').click();
    await page.locator('.context-panel [name="contextLinkKind"]').selectOption('debt');
    await page.locator('.context-panel [name="contextName"]').fill('Deuda nueva');
    await page.locator('.context-panel [name="contextValue"]').fill('3000');
    await page.locator('.context-panel [data-context-save]').click();
    const debt = (await stored()).debts.find(x => x.name === 'Deuda nueva');
    assert.equal(await page.locator('#modal [name="linkTarget"]').inputValue(), `debt:${debt.id}`);
    assert.equal((await stored()).transactions.length, 1);
    await page.locator('#modal .quick-save').click();
    assert.equal((await stored()).transactions.length, 1);
    assert.equal((await stored()).transactions[0].linkId, debt.id);

    await page.locator(`${nav} [data-page="Análisis"]`).click();
    await page.locator(`[data-action="payDebt"][data-id="${debt.id}"]`).click();
    await page.locator('#modal [name="amount"]').fill('200');
    await page.locator('#modal [data-context-target="account"]').click();
    await page.locator('.context-panel [name="contextName"]').fill('Cuenta de abono');
    await page.locator('.context-panel [name="contextValue"]').fill('0');
    await page.locator('.context-panel [data-context-save]').click();
    const paymentAccount = (await stored()).accounts.find(x => x.name === 'Cuenta de abono');
    assert.equal(await page.locator('#modal [name="account"]').inputValue(), paymentAccount.id);
    assert.equal(await page.locator('#modal [name="amount"]').inputValue(), '200');
    assert.equal((await stored()).transactions.length, 1);
    await page.locator('#modal #form button[type="submit"]').click();
    assert.equal((await stored()).transactions.length, 2);
    assert.equal((await stored()).transactions[1].linkId, debt.id);

    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(() => saveFile());
    const backup = JSON.parse(fs.readFileSync(await (await downloadPromise).path(), 'utf8'));
    assert.equal(backup.wishes.find(x => x.id === wish.id).goalId, wishGoal.id);
    assert.equal(backup.transactions.length, 2);
    assert.equal(backup.accounts.find(x => x.id === paymentAccount.id).opening, 0);
    const chooserPromise = page.waitForEvent('filechooser');
    await page.evaluate(() => importFile());
    const chooser = await chooserPromise;
    page.once('dialog', dialog => dialog.accept());
    await chooser.setFiles({ name: 'respaldo-mejora-34-ficticio.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.waitForFunction(({ key, revision }) => JSON.parse(localStorage.getItem(key)).revision > revision, { key, revision: backup.revision });
    assert.equal((await stored()).wishes.find(x => x.id === wish.id).goalId, wishGoal.id);
    assert.equal((await stored()).transactions.length, 2);
    assert.deepEqual(errors, []);
    console.log(`ok - listas y creación contextual a ${width}px`);
  } finally { await browser.close(); }
}

(async () => { for (const width of [375, 1280]) await run(width); })().catch(error => { console.error(error); process.exitCode = 1; });
