const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const appUrl = process.env.APP_URL || 'http://127.0.0.1:8765/';
const captureDir = process.env.CAPTURE_DIR;
const key = 'mis-finanzas-offline-v1';

const fixture = {
  version: 1, device: 'dispositivo-ficticio', revision: 1,
  updatedAt: '2026-10-20T09:00:00.000Z',
  accounts: [
    { id: 'caja', name: 'Caja ficticia', type: 'cash', opening: 850000 },
    { id: 'banco', name: 'Banco ficticio', type: 'bank', opening: 1250000 },
  ],
  lists: [
    { id: 'hogar', name: 'Hogar ficticio' },
    { id: 'proyectos', name: 'Proyectos ficticios' },
  ],
  categories: ['Alimentación', 'Transporte', 'Vivienda', 'Otros'],
  transactions: [
    { id: 'ingreso-1', type: 'income', title: 'Ingreso de ejemplo', amount: 220000,
      date: '2026-10-18', account: 'banco', status: 'done', category: 'Otros', list: 'proyectos', created: '2026-10-18T10:00:00Z' },
    { id: 'gasto-1', type: 'expense', title: 'Compra de ejemplo', amount: 35000,
      date: '2026-10-19', account: 'caja', status: 'done', category: 'Alimentación', list: 'hogar', created: '2026-10-19T10:00:00Z' },
    { id: 'pendiente-1', type: 'expense', title: 'Pago ficticio pendiente', amount: 48000,
      date: '2026-10-25', account: 'banco', status: 'pending', category: 'Vivienda', repeat: 'monthly',
      list: 'hogar', created: '2026-10-20T08:00:00Z' },
  ],
  budgets: [{ id: 'presupuesto-1', category: 'Alimentación', amount: 150000 }],
  goals: [{ id: 'meta-1', name: 'Meta ficticia', target: 500000, saved: 50000 }],
  debts: [{ id: 'deuda-1', name: 'Deuda ficticia', balance: 90000 }],
  settings: {},
};

async function pageFor(browser, width, height = 900) {
  const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://accounts.google.com/**', route => route.abort());
  await page.addInitScript(({ key, fixture }) => {
    localStorage.setItem(key, JSON.stringify(fixture));
    window.google = { accounts: { oauth2: { initTokenClient(options) {
      return { requestAccessToken() { options.callback({ error: 'access_denied' }); } };
    } } } };
  }, { key, fixture });
  await page.goto(appUrl);
  await page.locator('#main').waitFor();
  return { page, errors };
}

async function records(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)).transactions, key);
}

async function main() {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox'] });
  try {
    if (captureDir) fs.mkdirSync(captureDir, { recursive: true });
    for (const width of [320, 390, 768, 1024, 1280, 1440]) {
      const { page, errors } = await pageFor(browser, width);
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        sidebar: getComputedStyle(document.querySelector('#desktopNav')).display !== 'none',
        bottom: getComputedStyle(document.querySelector('#nav')).display !== 'none',
        quick: document.querySelector('#modal').dataset.inlineQuick === 'true',
        fab: getComputedStyle(document.querySelector('#add')).display !== 'none',
      }));
      assert.equal(layout.overflow, false, `desbordamiento horizontal a ${width}px`);
      assert.equal(layout.sidebar, width >= 1024);
      assert.equal(layout.bottom, width < 1024);
      assert.equal(layout.quick, width >= 1024);
      assert.equal(layout.fab, width < 1024);
      assert.deepEqual(errors, []);
      if (width >= 1024) {
        const feedback = await page.evaluate(() => {
          const toast = document.querySelector('#driveToast');
          const panel = document.querySelector('#modal').getBoundingClientRect();
          return toast.hidden || toast.getBoundingClientRect().right <= panel.left;
        });
        assert.equal(feedback, true, `el aviso de Drive no debe tapar el registro a ${width}px`);
        for (const section of ['Listas', 'Cuentas']) {
          await page.locator(`#desktopNav [data-page="${section}"]`).click();
          const geometry = await page.evaluate(section => {
            const main = document.querySelector('#main');
            const lists = [...main.querySelectorAll(':scope > .flat-list')];
            const first = section === 'Listas' ? lists[0] : main.querySelector('.total-account');
            const second = section === 'Listas' ? lists[1] : lists[0];
            const panel = document.querySelector('#modal').getBoundingClientRect();
            const rect = element => {
              const box = element.getBoundingClientRect();
              return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
            };
            const clipped = [...main.querySelectorAll('.flat-list .item')].some(item => {
              const box = item.getBoundingClientRect();
              const parent = item.parentElement.getBoundingClientRect();
              return box.left < parent.left - 1 || box.right > parent.right + 1 || item.scrollWidth > item.clientWidth + 1;
            });
            return { first: rect(first), second: rect(second), panelLeft: panel.left,
              clipped, firstPadding: parseFloat(getComputedStyle(lists[0]).paddingBottom),
              newAccount: section === 'Cuentas' ? rect(main.querySelector('.new-account')) : null };
          }, section);
          assert.equal(geometry.clipped, false, `${section}: tarjeta cortada a ${width}px`);
          assert.ok(geometry.second.right <= geometry.panelLeft, `${section}: invade el panel a ${width}px`);
          assert.equal(geometry.firstPadding, 0, `${section}: espacio móvil residual a ${width}px`);
          if (width >= 1280) {
            assert.ok(geometry.first.right < geometry.second.left, `${section}: columnas superpuestas a ${width}px`);
          } else {
            assert.ok(geometry.first.bottom <= geometry.second.top, `${section}: bloques superpuestos a ${width}px`);
          }
          if (section === 'Cuentas') {
            assert.ok(geometry.second.bottom <= geometry.newAccount.top, `Cuenta nueva superpuesta a ${width}px`);
          }
        }
      }
      if (width === 320) {
        await page.locator('#add').click();
        const sheetFits = await page.evaluate(() => {
          const box = document.querySelector('#modal .sheet').getBoundingClientRect();
          return box.left >= 0 && box.right <= innerWidth;
        });
        assert.equal(sheetFits, true);
        await page.locator('#modal .quick-close').click();
      }
      if (captureDir) {
        const dismiss = page.locator('#driveToast:not([hidden]) #driveToastDismiss');
        if (await dismiss.count()) await dismiss.click();
      }
      if (width === 390 && captureDir) await page.screenshot({ path: path.join(captureDir, 'movil.png') });
      if (width === 1280 && captureDir) {
        for (const section of ['Inicio', 'Listas', 'Cuentas', 'Análisis']) {
          await page.locator(`#desktopNav [data-page="${section}"]`).click();
          const name = section === 'Análisis' ? 'analisis' : section.toLowerCase();
          await page.screenshot({ path: path.join(captureDir, `${name}.png`) });
        }
      }
      await page.close();
      console.log(`ok - distribución ${width}px`);
    }

    const { page, errors } = await pageFor(browser, 1280);
    for (const section of ['Listas', 'Cuentas', 'Análisis']) {
      await page.locator(`#desktopNav [data-page="${section}"]`).click();
      assert.equal(await page.locator(`#desktopNav [data-page="${section}"]`).getAttribute('aria-label'), section);
      assert.equal(await page.locator(`#desktopNav [data-page="${section}"]`).getAttribute('aria-current'), 'page');
      assert.equal(await page.locator('#modal[data-inline-quick=true] #form').count(), 1);
    }
    await page.locator('#quickEntry').fill('Borrador ficticio 12000');
    await page.locator('#settings').click();
    assert.equal(await page.locator('#modal[data-inline-quick=false] #form').count(), 1);
    await page.locator('#modal [data-action="close"]').first().click();
    assert.equal(await page.locator('#quickEntry').inputValue(), 'Borrador ficticio 12000');
    const before = (await records(page)).length;
    await page.locator('#quickEntry').fill('Compra ficticia 12000');
    await page.locator('#modal .quick-save').evaluate(button => { button.click(); button.click(); });
    await page.waitForFunction(({ key, count }) => JSON.parse(localStorage.getItem(key)).transactions.length === count + 1,
      { key, count: before });
    const added = (await records(page)).filter(item => item.title === 'Compra ficticia');
    assert.equal(added.length, 1, 'el doble clic no debe crear duplicados');
    assert.equal(added[0].amount, 12000);
    assert.equal(await page.locator('#desktopNav [data-page="Análisis"]').getAttribute('class').then(s => s.includes('active')), true);
    assert.equal(await page.locator('#modal[data-inline-quick=true] #form').count(), 1);
    await page.locator('#modal [name="type"]').selectOption('income');
    await page.locator('#quickEntry').fill('Ingreso ficticio 9000');
    await page.locator('#modal .quick-save').click();
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).transactions.some(t => t.title === 'Ingreso ficticio'), key);
    assert.equal((await records(page)).filter(t => t.title === 'Ingreso ficticio' && t.type === 'income').length, 1);
    await page.locator('#modal [name="type"]').selectOption('transfer');
    await page.locator('#quickEntry').fill('Traslado ficticio 1000');
    await page.locator('#modal .quick-details summary').click();
    await page.locator('#modal [name="toAccount"]').selectOption('banco');
    await page.locator('#modal .quick-save').click();
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).transactions.some(t => t.title === 'Traslado ficticio'), key);
    assert.equal((await records(page)).filter(t => t.title === 'Traslado ficticio' && t.type === 'transfer' && t.toAccount === 'banco').length, 1);
    await page.locator('#desktopNav [data-page="Inicio"]').click();
    await page.locator('.transaction[data-id="gasto-1"] [data-action="actions"]').click();
    await page.locator('[data-action="edit"][data-id="gasto-1"]').click();
    assert.equal(await page.locator('#modal[data-inline-quick=false] .quick-head').count(), 1);
    await page.locator('#modal .quick-close').click();
    assert.equal(await page.locator('#modal[data-inline-quick=true] #form').count(), 1);
    await page.locator('#searchToggle').click();
    await page.locator('#search').fill('Compra de ejemplo');
    assert.equal(await page.locator('#main .transaction').count(), 1);
    assert.equal(await page.locator('#modal[data-inline-quick=true] #form').count(), 1);
    await page.locator('#desktopNav [data-page="Listas"]').click();
    await page.locator('[data-action="newList"]').first().click();
    assert.equal(await page.locator('#modal[data-inline-quick=false] #form').count(), 1);
    await page.locator('#form [name="name"]').fill('Lista de prueba');
    await page.locator('#form button[type="submit"]').click();
    assert.equal(await page.locator('#modal[data-inline-quick=true] #form').count(), 1);
    assert.equal(await page.locator('#main').textContent().then(s => s.includes('Lista de prueba')), true);
    assert.equal(await page.locator('#modal [name="list"]').textContent().then(s => s.includes('Lista de prueba')), true);
    await page.locator('#desktopNav [data-page="Cuentas"]').click();
    await page.locator('[data-action="newAccount"]').click();
    await page.locator('#form [name="name"]').fill('Cuenta de prueba');
    await page.locator('#form [name="opening"]').fill('0');
    await page.locator('#form button[type="submit"]').click();
    assert.equal(await page.locator('#modal [name="account"]').textContent().then(s => s.includes('Cuenta de prueba')), true);
    await page.locator('#settings').click();
    await page.locator('[data-action="manageCategories"]').click();
    await page.locator('[data-action="addCategory"]').click();
    await page.locator('#categoryNameInput').fill('Categoría ficticia');
    await page.locator('#saveCategoryEditor').click();
    assert.equal(await page.locator('#modal .category-manager').textContent().then(s => s.includes('Categoría ficticia')), true);
    assert.equal(await page.locator('#modal[data-inline-quick=true]').count(), 0);
    await page.locator('#modal [data-action="close"]').click();
    assert.equal(await page.locator('#modal[data-inline-quick=true] #form').count(), 1);
    assert.deepEqual(errors, []);
    await page.close();
    console.log('ok - navegación, guardado único y retorno al registro rápido');

    const mobile = await pageFor(browser, 390);
    await mobile.page.locator('#add').click();
    assert.equal(await mobile.page.locator('#modal[data-inline-quick=false] #form').count(), 1);
    await mobile.page.locator('#quickEntry').fill('Gasto móvil ficticio 7000');
    await mobile.page.locator('#modal .quick-save').click();
    await mobile.page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).transactions.some(t => t.title === 'Gasto móvil ficticio'), key);
    assert.equal((await records(mobile.page)).filter(t => t.title === 'Gasto móvil ficticio').length, 1);
    assert.deepEqual(mobile.errors, []);
    await mobile.page.close();
    console.log('ok - registro móvil sin cambios');

    const responsive = await pageFor(browser, 1280);
    const original = await records(responsive.page);
    await responsive.page.setViewportSize({ width: 768, height: 900 });
    await responsive.page.waitForFunction(() => document.querySelector('#modal #form') === null);
    assert.equal(await responsive.page.locator('#modal #form').count(), 0);
    assert.equal(await responsive.page.locator('#nav').isVisible(), true);
    await responsive.page.setViewportSize({ width: 1280, height: 900 });
    await responsive.page.waitForFunction(() => document.querySelector('#modal').dataset.inlineQuick === 'true');
    assert.equal(await responsive.page.locator('#modal[data-inline-quick=true] #form').count(), 1);
    assert.deepEqual(await records(responsive.page), original);
    assert.deepEqual(responsive.errors, []);
    await responsive.page.close();
    console.log('ok - cambio de tamaño sin modificar registros');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
