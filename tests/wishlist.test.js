const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const url = process.env.APP_URL || 'http://127.0.0.1:8767/';
const key = 'mis-finanzas-offline-v1';
const fixture = { version: 1, device: 'deseos-ficticios', revision: 0,
  updatedAt: '2026-11-01T00:00:00.000Z',
  accounts: [{ id: 'cash', name: 'Caja ficticia', type: 'cash', opening: 1000 }],
  lists: [{ id: 'home', name: 'Hogar ficticio' }], categories: ['Servicios', 'Otros'],
  transactions: [], budgets: [{ id: 'budget', category: 'Servicios', amount: 500 }],
  goals: [{ id: 'goal', name: 'Meta ficticia', target: 500, saved: 100 }], debts: [], settings: {} };

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
    const nav = width >= 1024 ? '#desktopNav' : '#nav';
    const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    const capture = async name => { if (!process.env.CAPTURE_DIR) return;
      fs.mkdirSync(process.env.CAPTURE_DIR, { recursive: true });
      if (await page.locator('#driveToastDismiss').isVisible()) await page.locator('#driveToastDismiss').click();
      await page.screenshot({ path: path.join(process.env.CAPTURE_DIR, `${name}-${width}.png`), fullPage: true }); };
    const wishMenu = async id => page.locator(`.wish-row[data-wish-id="${id}"] [data-action="wishMenu"]`).click();
    const createWish = async (name, estimate) => {
      await page.locator('[data-action="newWish"]').click();
      await page.locator('#form [name="name"]').fill(name);
      await page.locator('#form [name="estimate"]').fill(String(estimate));
      await page.locator('#form [name="category"]').selectOption('Servicios');
      await page.locator('#form [name="subcategory"]').fill('Equipo');
      await page.locator('#form [name="list"]').selectOption('home');
      await page.locator('#form [name="goalId"]').selectOption('goal');
      await page.locator('#form [name="account"]').selectOption('cash');
      assert.match(await page.locator('#wishBudgetInfo').textContent(), /500/);
      await page.locator('#form button[type="submit"]').click();
      return (await stored()).wishes.at(-1).id;
    };

    await page.locator(`${nav} [data-page="Listas"]`).click();
    assert.equal(await page.locator('.wish-entry').count(), 1);
    await page.locator('.wish-entry').click();
    assert.equal(await page.locator('.wish-row').count(), 0);
    const id = await createWish('Bicicleta ficticia', 300);
    assert.equal((await stored()).transactions.length, 0);
    assert.match(await page.locator('.wish-summary').textContent(), /300/);
    assert.match(await page.locator('.wish-row').textContent(), /Meta ficticia/);
    assert.match(await page.locator('.wish-row').textContent(), /100/);
    await wishMenu(id);
    await page.locator('[data-action="editWish"]').click();
    await page.locator('#form [name="estimate"]').fill('320');
    await page.locator('#form button[type="submit"]').click();
    assert.equal((await stored()).wishes.length, 1);
    assert.equal((await stored()).wishes[0].estimate, 320);
    await page.locator('#wishSearch').fill('no existe');
    assert.equal(await page.locator('.wish-row').count(), 0);
    await page.locator('#wishSearch').fill('bicicleta');
    assert.equal(await page.locator('.wish-row').count(), 1);
    await page.locator('#wishSearch').fill('');
    await page.locator('[data-wish-filter="bought"]').click();
    assert.equal(await page.locator('.wish-row').count(), 0);
    await page.locator('[data-wish-filter="pending"]').click();
    assert.equal(await page.locator('.wish-row').count(), 1);
    await capture('lista');
    await page.locator('[data-wish-filter="all"]').click();

    if (width < 1024) await page.locator('#add').click();
    else assert.equal(await page.locator('#modal[data-inline-quick="true"] .wish-picker').count(), 1);
    const quick = page.locator('#modal #form');
    await quick.locator('.quick-details > summary').click();
    await quick.locator('[name="wishPicker"]').selectOption(id);
    assert.equal(await quick.locator('[name="wishId"]').inputValue(), id);
    assert.equal(await quick.locator('#quickEntry').inputValue(), 'Bicicleta ficticia 320');
    assert.equal(await quick.locator('[name="category"]').inputValue(), 'Servicios');
    assert.equal(await quick.locator('[name="subcategory"]').inputValue(), 'Equipo');
    await quick.locator('#quickEntry').fill('Bicicleta ficticia 350');
    await quick.locator('.quick-save').click();
    let db = await stored();
    assert.equal(db.transactions.length, 1);
    assert.equal(db.transactions[0].wishId, id);
    assert.equal(db.transactions[0].amount, 350);
    assert.equal(db.transactions[0].type, 'expense');
    assert.equal(db.goals[0].saved, 100);
    assert.match(await page.locator('.wish-row').textContent(), /Comprado/);
    assert.match(await page.locator('.wish-row').textContent(), /Real.*350/);
    assert.equal(await page.locator('.wish-summary').textContent().then(s => s.includes('0 pendientes')), true);

    await wishMenu(id);
    await page.locator('[data-action="wishMovement"]').click();
    await page.locator('#modal #quickEntry').fill('Bicicleta ficticia 360');
    await page.locator('#modal .quick-save').click();
    db = await stored();
    assert.equal(db.transactions.length, 1);
    assert.equal(db.transactions[0].amount, 360);
    await page.locator(`${nav} [data-page="Análisis"]`).click();
    assert.match(await page.locator('.analysis-tracking-column').first().textContent(), /360/);
    await page.locator(`${nav} [data-page="Inicio"]`).click();
    assert.match(await page.locator('.summary-grid').textContent(), /640/);
    await page.locator('[data-action="showHistory"]').click();
    await page.locator(`.transaction[data-id="${db.transactions[0].id}"] [data-action="actions"]`).click();
    await page.locator('[data-action="edit"]').click();
    await page.locator('#modal #quickEntry').fill('Bicicleta ficticia 370');
    await page.locator('#modal .quick-save').click();
    db = await stored();
    assert.equal(db.transactions.length, 1);
    assert.equal(db.transactions[0].amount, 370);
    await page.locator(`${nav} [data-page="Listas"]`).click();
    await page.locator('.wish-entry').click();
    assert.match(await page.locator('.wish-row').textContent(), /Real.*370/);

    await wishMenu(id);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-action="revertWish"]').click();
    db = await stored();
    assert.equal(db.transactions.length, 1);
    assert.equal(db.transactions[0].status, 'pending');
    assert.match(await page.locator('.wish-row').textContent(), /Compra planificada/);
    assert.match(await page.locator('.wish-summary').textContent(), /320/);
    await wishMenu(id);
    await page.locator('[data-action="purchaseWish"]').click();
    assert.equal(await page.locator('#modal #form [name="status"]').inputValue(), 'done');
    await capture('compra');
    await page.locator('#modal .quick-save').click();
    assert.equal((await stored()).transactions.length, 1);
    await page.reload();
    assert.equal((await stored()).wishes.length, 1);
    await page.locator(`${nav} [data-page="Listas"]`).click();
    await page.locator('.wish-entry').click();
    assert.match(await page.locator('.wish-row').textContent(), /Comprado/);

    if (width < 1024) await page.locator('#add').click();
    await page.locator('#modal #quickEntry').fill('Otra compra ficticia 20');
    await page.locator('#modal [name="wishId"]').evaluate((input, wishId) => { input.value = wishId; }, id);
    await page.locator('#modal .quick-save').click();
    assert.match(await page.locator('#modal #saveNotice').textContent(), /ya tiene un movimiento/);
    assert.equal((await stored()).transactions.length, 1);
    if (width < 1024) await page.locator('#modal .quick-close').click();

    const plannedId = await createWish('Servicio ficticio', 90);
    await wishMenu(plannedId);
    await page.locator('[data-action="purchaseWish"]').click();
    await page.locator('#modal [name="status"]').selectOption('pending');
    await page.locator('#modal [name="date"]').fill('2026-11-20');
    await page.locator('#modal .quick-save').click();
    db = await stored();
    assert.equal(db.transactions.length, 2);
    assert.equal(db.transactions.find(t => t.wishId === plannedId).status, 'pending');
    assert.match(await page.locator(`.wish-row[data-wish-id="${plannedId}"]`).textContent(), /Compra planificada/);
    assert.match(await page.locator('.wish-summary').textContent(), /90/);
    await wishMenu(plannedId);
    await page.locator('[data-action="purchaseWish"]').click();
    await page.locator('#modal .quick-save').click();
    db = await stored();
    assert.equal(db.transactions.length, 2);
    assert.equal(db.transactions.find(t => t.wishId === plannedId).status, 'done');

    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(() => saveFile());
    const download = await downloadPromise;
    const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(backup.wishes.length, 2);
    assert.equal(backup.transactions.length, 2);
    const importBackup = async copy => {
      const chooserPromise = page.waitForEvent('filechooser');
      await page.evaluate(() => importFile());
      const chooser = await chooserPromise;
      await chooser.setFiles({ name: 'respaldo-ficticio.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(copy)) });
    };
    const revisionBeforeImport = (await stored()).revision;
    page.once('dialog', dialog => dialog.accept());
    await importBackup(backup);
    await page.waitForFunction(({ key, revision }) => JSON.parse(localStorage.getItem(key)).revision > revision, { key, revision: revisionBeforeImport });
    assert.equal((await stored()).transactions.length, 2);
    const beforeInvalid = JSON.stringify(await stored());
    const invalid = structuredClone(backup);
    invalid.transactions.push({ ...invalid.transactions[1], id: 'duplicado-ficticio' });
    page.once('dialog', dialog => dialog.accept());
    await importBackup(invalid);
    assert.equal(JSON.stringify(await stored()), beforeInvalid);

    await page.locator(`${nav} [data-page="Inicio"]`).click();
    await page.locator('[data-action="showHistory"]').click();
    await page.locator(`.transaction[data-id="${db.transactions[0].id}"] [data-action="actions"]`).click();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-action="delete"]').click();
    assert.equal((await stored()).transactions[0].deleted, true);
    await page.locator(`${nav} [data-page="Listas"]`).click();
    await page.locator('.wish-entry').click();
    assert.match(await page.locator(`.wish-row[data-wish-id="${id}"]`).textContent(), /Pendiente/);
    await wishMenu(id);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-action="deleteWish"]').click();
    assert.equal((await stored()).wishes.find(w => w.id === id).deleted, true);
    assert.equal((await stored()).transactions.length, 2);
    await page.context().setOffline(true);
    const offlineId = await createWish('Deseo sin internet', 40);
    assert.equal((await stored()).wishes.find(w => w.id === offlineId).estimate, 40);
    await page.context().setOffline(false);
    await page.reload();
    await page.locator(`${nav} [data-page="Listas"]`).click();
    await page.locator('.wish-entry').click();
    assert.equal(await page.locator(`.wish-row[data-wish-id="${offlineId}"]`).count(), 1);
    const recurringId = await createWish('Suscripción ficticia', 25);
    await wishMenu(recurringId);
    await page.locator('[data-action="purchaseWish"]').click();
    await page.locator('#modal [name="repeat"]').selectOption('monthly');
    await page.locator('#modal .quick-save').click();
    db = await stored();
    const recurringPurchase = db.transactions.find(t => t.wishId === recurringId);
    assert.equal(recurringPurchase.repeat, 'monthly');
    assert.equal(db.transactions.filter(t => t.wishId === recurringId).length, 1);
    assert.equal(db.transactions.find(t => t.recurrenceParentId === recurringPurchase.id)?.wishId, '');
    await page.evaluate(id => mark(id), recurringPurchase.id);
    await page.evaluate(id => mark(id), recurringPurchase.id);
    db = await stored();
    assert.equal(db.transactions.filter(t => t.wishId === recurringId).length, 1);
    assert.equal(db.transactions.filter(t => t.recurrenceParentId === recurringPurchase.id).length, 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`ok - deseos, compra, edición, reversión y recarga a ${width}px`);
  } finally { await browser.close(); }
}

(async () => { for (const width of [375, 1280]) await run(width); })().catch(error => {
  console.error(error); process.exitCode = 1;
});
