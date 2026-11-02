const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    let requests = 0; page.on('request', req => { if (!req.url().startsWith('file:')) requests++; });
    await page.goto((process.env.APP_URL || 'http://127.0.0.1:8767/') + 'tests/saldo-diagnostico.html');
    requests = 0;
    const copy = { accounts: [
      { id: 'bank', name: 'Banco ficticio', type: 'bank', opening: 1000 },
      { id: 'cash', name: 'Efectivo ficticio', type: 'cash', opening: 100 },
      { id: 'card', name: 'Crédito ficticio', type: 'credit', opening: 900 } ], transactions: [
      { id: 'a', type: 'income', title: 'Ingreso', amount: 300, date: '2026-11-01', account: 'bank', status: 'done' },
      { id: 'b', type: 'expense', title: 'Gasto', amount: 50, date: '2026-11-01', account: 'bank', status: 'done' },
      { id: 'c', type: 'transfer', title: 'Traspaso', amount: 200, date: '2026-11-02', account: 'bank', toAccount: 'cash', status: 'done' },
      { id: 'd', type: 'expense', title: 'Pendiente', amount: 99, date: '2026-11-02', account: 'cash', status: 'pending' },
      { id: 'e', type: 'expense', title: 'Borrado', amount: 99, date: '2026-11-02', account: 'cash', status: 'done', deleted: true },
    ] };
    await page.locator('#file').setInputFiles({ name: 'copia-ficticia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(copy)) });
    assert.match(await page.locator('#summary').textContent(), /1.050/);
    assert.match(await page.locator('#summary').textContent(), /1.350/);
    assert.equal(await page.locator('#records tr').count(), 4);
    await page.locator('#account').selectOption('cash');
    assert.match(await page.locator('#summary').textContent(), /300/);
    assert.equal(await page.locator('#records tr').count(), 2);
    assert.equal(requests, 0);
    console.log('ok - diagnóstico local de solo lectura, saldos y exclusiones');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
