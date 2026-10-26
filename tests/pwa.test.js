const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const key = 'mis-finanzas-offline-v1';
const files = new Map([
  ['', ['index.html', 'text/html; charset=utf-8']],
  ['index.html', ['index.html', 'text/html; charset=utf-8']],
  ['manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['icons/icon-192.png', ['icons/icon-192.png', 'image/png']],
  ['icons/icon-512.png', ['icons/icon-512.png', 'image/png']],
  ['icons/icon-maskable-512.png', ['icons/icon-maskable-512.png', 'image/png']],
]);
const fixture = {
  version: 1, device: 'dispositivo-pwa-ficticio', revision: 1,
  updatedAt: '2026-10-26T12:00:00.000Z',
  accounts: [{ id: 'caja', name: 'Caja ficticia', type: 'cash', opening: 50000 }],
  lists: [{ id: 'lista', name: 'Lista ficticia' }],
  categories: ['Otros'], transactions: [], budgets: [], goals: [], debts: [], settings: {},
};

function serverForTest() {
  const state = { version: 1, failAsset: false };
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const name = pathname.startsWith('/mis-finanzas/') ? pathname.slice('/mis-finanzas/'.length) : null;
    const entry = files.get(name);
    if (!entry) { response.writeHead(404); response.end(); return; }
    if (state.failAsset && name === 'icons/icon-maskable-512.png') {
      response.writeHead(503); response.end('Fallo ficticio de descarga'); return;
    }
    let body = fs.readFileSync(path.join(root, entry[0]));
    if (name === 'sw.js') {
      body = Buffer.from(body.toString().replace('const CACHE_VERSION = 1;',
        `const CACHE_VERSION = ${state.version};`));
    }
    response.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-store' });
    response.end(body);
  });
  return { server, state };
}

async function observeUpdate(page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const settled = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('La actualización del worker no terminó')), 12000);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' || worker.state === 'redundant') {
            clearTimeout(timeout);
            resolve(worker.state);
          }
        });
      }, { once: true });
    });
    await registration.update();
    return settled;
  });
}

async function stored(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
}

async function main() {
  const { server, state } = serverForTest();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${server.address().port}/mis-finanzas/`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-finanzas-pwa-'));
  const browserOptions = { headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox'], viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' };
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, browserOptions);
    await context.route('https://accounts.google.com/**', route => route.abort());
    await context.addInitScript(({ key, fixture }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(fixture));
      window.google = { accounts: { oauth2: { initTokenClient(options) {
        return { requestAccessToken() { options.callback({ error: 'access_denied' }); } };
      } } } };
    }, { key, fixture });
    let page = context.pages()[0] || await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(address);

    const manifestUrl = new URL('manifest.webmanifest', address);
    const manifestResponse = await page.request.get(manifestUrl.href);
    assert.equal(manifestResponse.ok(), true);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.name, 'Mis Finanzas');
    assert.equal(manifest.lang, 'es');
    assert.equal(manifest.display, 'standalone');
    assert.equal(new URL(manifest.start_url, manifestUrl).pathname, '/mis-finanzas/');
    assert.equal(new URL(manifest.scope, manifestUrl).pathname, '/mis-finanzas/');
    for (const icon of manifest.icons) {
      const iconResponse = await page.request.get(new URL(icon.src, manifestUrl).href);
      assert.equal(iconResponse.ok(), true);
      const png = await iconResponse.body();
      assert.equal(png.subarray(1, 4).toString(), 'PNG');
      const size = Number(icon.sizes.split('x')[0]);
      assert.equal(png.readUInt32BE(16), size);
      assert.equal(png.readUInt32BE(20), size);
    }
    assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
    const cdp = await context.newCDPSession(page);
    const browserManifest = await cdp.send('Page.getAppManifest');
    assert.equal(browserManifest.errors.length, 0);
    assert.equal(new URL(browserManifest.url).pathname, '/mis-finanzas/manifest.webmanifest');
    console.log('ok - manifest, ruta GitHub Pages e iconos de instalación');

    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    assert.equal(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL.endsWith('/mis-finanzas/sw.js')), true);
    const installability = await cdp.send('Page.getInstallabilityErrors');
    assert.deepEqual(installability.installabilityErrors, []);
    const cacheUrls = await page.evaluate(async () => {
      const keys = await caches.keys();
      const cache = await caches.open(keys.find(name => name.startsWith('mis-finanzas-shell-v')));
      return (await cache.keys()).map(request => request.url);
    });
    assert.equal(cacheUrls.length, 6);
    assert.ok(cacheUrls.every(url => url.startsWith(address)));
    assert.ok(cacheUrls.every(url => !/googleapis|accounts\.google/.test(url)));
    await context.route('https://www.googleapis.com/**', route => route.fulfill({
      status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: '{"files":[]}',
    }));
    const mockedDrive = await page.evaluate(() => fetch('https://www.googleapis.com/drive/v3/files?test=ficticio').then(response => response.json()));
    assert.equal(mockedDrive.files.length, 0);
    const afterDrive = await page.evaluate(async () => {
      const cache = await caches.open('mis-finanzas-shell-v1');
      return (await cache.keys()).map(request => request.url);
    });
    assert.deepEqual(afterDrive, cacheUrls);
    assert.deepEqual(errors, []);
    console.log('ok - worker activo y caché limitado al shell propio');

    await context.setOffline(true);
    const offlineResponse = await page.reload();
    assert.equal(offlineResponse.fromServiceWorker(), true);
    for (const section of ['Inicio', 'Listas', 'Cuentas', 'Análisis']) {
      await page.locator(`#nav [data-page="${section}"]`).click();
      assert.equal(await page.locator(`#nav [data-page="${section}"]`).getAttribute('class').then(value => value.includes('active')), true);
    }
    await page.locator('#add').click();
    await page.locator('#quickEntry').fill('Compra ficticia sin conexión 1700');
    await page.locator('#modal .quick-save').click();
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).transactions.length === 1, key);
    const saved = await stored(page);
    assert.equal(saved.transactions[0].amount, 1700);
    await page.close();
    page = await context.newPage();
    const reopened = await page.goto(address);
    assert.equal(reopened.fromServiceWorker(), true);
    assert.deepEqual(await stored(page), saved);
    if (process.env.CAPTURE_DIR) {
      fs.mkdirSync(process.env.CAPTURE_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.CAPTURE_DIR, 'offline-mobile.png') });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({ path: path.join(process.env.CAPTURE_DIR, 'offline-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 });
    }
    console.log('ok - apertura, navegación y guardado sin conexión tras cerrar y reabrir');

    await context.setOffline(false);
    state.version = 2;
    state.failAsset = true;
    assert.equal(await observeUpdate(page), 'redundant');
    assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting), null);
    await context.setOffline(true);
    const interrupted = await page.reload();
    assert.equal(interrupted.fromServiceWorker(), true);
    assert.deepEqual(await stored(page), saved);
    console.log('ok - instalación interrumpida conserva la versión anterior y los datos');

    await context.setOffline(false);
    state.version = 3;
    state.failAsset = false;
    assert.equal(await observeUpdate(page), 'installed');
    assert.equal(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting), true);
    assert.deepEqual(await stored(page), saved);
    await page.close();
    page = await context.newPage();
    await page.goto(address);
    await page.waitForFunction(async () => (await navigator.serviceWorker.ready).active.state === 'activated');
    const cacheNames = await page.evaluate(() => caches.keys());
    assert.ok(cacheNames.includes('mis-finanzas-shell-v3'));
    assert.ok(!cacheNames.includes('mis-finanzas-shell-v1'));
    assert.deepEqual(await stored(page), saved);
    await context.setOffline(true);
    assert.equal((await page.reload()).fromServiceWorker(), true);
    assert.deepEqual(await stored(page), saved);
    console.log('ok - actualización completa mantiene registros y funciona sin conexión');

    await context.setOffline(false);
    await context.close();
    context = await chromium.launchPersistentContext(profile, { ...browserOptions,
      args: ['--no-sandbox', '--host-resolver-rules=MAP accounts.google.com ~NOTFOUND', `--app=${address}`] });
    await context.route('https://accounts.google.com/**', route => route.abort());
    await context.addInitScript(() => {
      window.google = { accounts: { oauth2: { initTokenClient(options) {
        return { requestAccessToken() { options.callback({ error: 'access_denied' }); } };
      } } } };
    });
    page = context.pages()[0] || await context.newPage();
    await page.reload();
    assert.equal(await page.evaluate(() => matchMedia('(display-mode: standalone)').matches), true);
    assert.deepEqual(await stored(page), saved);
    await context.setOffline(true);
    assert.equal((await page.reload()).fromServiceWorker(), true);
    assert.deepEqual(await stored(page), saved);
    if (process.env.CAPTURE_DIR) {
      await page.screenshot({ path: path.join(process.env.CAPTURE_DIR, 'app-mode-mobile.png') });
    }
    console.log('ok - ventana independiente simulada tras reiniciar navegador');
  } finally {
    if (context) await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
