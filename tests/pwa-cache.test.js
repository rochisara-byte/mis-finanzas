const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const assets = [
  'index.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];
const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function metadata(source, oldAssets) {
  const version = source.match(/const CACHE_VERSION = (\d+);/);
  const digest = source.match(/const SHELL_DIGEST = '([a-f0-9]{64})';/);
  assert.ok(version && (digest || oldAssets), 'El worker debe declarar versión y huella del shell');
  return { version: Number(version[1]), digest: digest ? digest[1] : shellDigest(oldAssets) };
}

function shellDigest(readAsset) {
  const hash = createHash('sha256');
  for (const asset of assets) {
    hash.update(asset);
    hash.update('\0');
    hash.update(readAsset(asset));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function requireNewVersion(current, previous) {
  if (current.digest !== previous.digest) {
    assert.ok(current.version > previous.version,
      'El shell cambió: incrementa CACHE_VERSION en sw.js');
  }
}

const current = metadata(worker);
const actual = shellDigest(asset => fs.readFileSync(path.join(root, asset)));
assert.equal(current.digest, actual,
  'El contenido del shell cambió: actualiza SHELL_DIGEST e incrementa CACHE_VERSION');

const shellBlock = worker.match(/const shellUrls = \[([\s\S]*?)\];/);
assert.ok(shellBlock, 'No se encontró la lista de recursos precargados');
const listed = [...shellBlock[1].matchAll(/new URL\('([^']+)', root\)/g)].map(match => match[1]);
assert.deepEqual(listed, assets.slice(1), 'Actualiza la prueba si cambian los recursos precargados');
assert.match(shellBlock[1], /\broot\s*,\s*index\s*,/, 'El shell debe precargar la entrada y el HTML');

// Compare with the last committed worker while editing, or its predecessor after commit.
const committed = git('show', 'HEAD:sw.js');
let previousSource = committed;
let previousRef = 'HEAD';
if (worker === committed) {
  const revisions = git('log', '-2', '--format=%H', '--', 'sw.js').trim().split('\n');
  if (revisions.length > 1) {
    previousRef = revisions[1];
    previousSource = git('show', `${previousRef}:sw.js`);
  }
}
requireNewVersion(current, metadata(previousSource,
  asset => execFileSync('git', ['show', `${previousRef}:${asset}`], { cwd: root })));

assert.throws(() => requireNewVersion(
  { version: current.version, digest: '0'.repeat(64) }, current), /incrementa CACHE_VERSION/);
console.log('ok - huella del shell y aumento obligatorio de CACHE_VERSION');

const handlers = new Map();
vm.runInNewContext(worker, {
  URL,
  self: {
    registration: { scope: 'https://ejemplo.test/mis-finanzas/' },
    location: { origin: 'https://ejemplo.test' },
    addEventListener(type, handler) { handlers.set(type, handler); },
  },
});
const fetchHandler = handlers.get('fetch');
assert.equal(typeof fetchHandler, 'function');
for (const url of [
  'https://accounts.google.com/gsi/client',
  'https://accounts.google.com/o/oauth2/v2/auth',
  'https://oauth2.googleapis.com/token',
  'https://www.googleapis.com/drive/v3/files',
  'https://ejemplo.test/mis-finanzas/drive/v3/files',
]) {
  let intercepted = false;
  fetchHandler({ request: { method: 'GET', mode: 'cors', url }, respondWith() { intercepted = true; } });
  assert.equal(intercepted, false, `El worker no debe interceptar ${url}`);
}
console.log('ok - OAuth y Google Drive no son interceptados por el worker');
