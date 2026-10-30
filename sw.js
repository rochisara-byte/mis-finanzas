const CACHE_VERSION = 8;
const SHELL_DIGEST = '84b4a85b666d5ee791584be7b608e026a400ad0587fee890c28d3f7c46de0ffc';
const SHELL_CACHE = `mis-finanzas-shell-v${CACHE_VERSION}`;
const SHELL_PREFIX = 'mis-finanzas-shell-v';
const root = new URL('./', self.registration.scope);
const index = new URL('index.html', root);
const shellUrls = [
  root,
  index,
  new URL('manifest.webmanifest', root),
  new URL('icons/icon-192.png', root),
  new URL('icons/icon-512.png', root),
  new URL('icons/icon-maskable-512.png', root),
];
const staticUrls = new Set(shellUrls.slice(2).map(url => url.href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(shellUrls.map(url => new Request(url, { cache: 'reload' })));
  })());
  // No skipWaiting: an open financial session keeps its current app shell.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(SHELL_PREFIX) && name !== SHELL_CACHE)
      .map(name => caches.delete(name)));
  })());
  // No clients.claim: a page switches versions only after its next navigation.
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' && (url.pathname === root.pathname || url.pathname === index.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      return await cache.match(index.href) || await cache.match(root.href) || fetch(request);
    })());
    return;
  }

  if (!url.search && staticUrls.has(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      return await cache.match(request) || fetch(request);
    })());
  }
});
