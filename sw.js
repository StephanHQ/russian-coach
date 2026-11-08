/* Russian Coach service worker: network first (always fresh when online), cache fallback (works offline). */
const CACHE = 'rc-v1';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './data/index.json', './data/profile.json', './data/deck.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(networkFirst(e, req, url));
});

async function networkFirst(event, req, url) {
  const cache = await caches.open(CACHE);
  const key = url.origin + url.pathname;
  const net = fetch(key, { cache: 'no-cache' }).then(res => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  });
  event.waitUntil(net.then(() => {}, () => {}));
  let cached = await cache.match(key);
  if (!cached && req.mode === 'navigate') cached = (await cache.match(new URL('./', self.location).href)) || (await cache.match(new URL('./index.html', self.location).href));
  if (!cached) return net.catch(() => new Response('Offline and not cached yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } }));
  // Prefer the network, but don't keep the user waiting more than 3.5 s when a cached copy exists.
  const timeout = new Promise(resolve => setTimeout(() => resolve(cached), 3500));
  return Promise.race([net.catch(() => cached), timeout]);
}
