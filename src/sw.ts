// App-shell service worker (built by scripts/build-web.mjs to dist-web/sw.js, unhashed).
// - install: precache every built file (list injected at build time); activate immediately.
// - /assets/* (hashed, immutable): cache first.
// - navigations: network first, cache fallback, so the app opens offline.
// - never touches /api/*, non-GET requests or other origins (Firebase, the files Worker).

declare const __PRECACHE__: string[];
declare const __VERSION__: string;

interface SwEvent extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface SwFetchEvent extends SwEvent {
  request: Request;
  respondWith(r: Response | Promise<Response>): void;
}
interface SwScope {
  location: Location;
  clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', cb: (e: SwEvent) => void): void;
  addEventListener(type: 'fetch', cb: (e: SwFetchEvent) => void): void;
}

const sw = self as unknown as SwScope;
const PREFIX = 'chronos-web-';
const CACHE = PREFIX + __VERSION__;
const SHELL = '/';

sw.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(__PRECACHE__))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

async function networkFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) await cache.put(SHELL, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(SHELL);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

sw.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    e.respondWith(networkFirst(request));
  } else {
    e.respondWith(cacheFirst(request));
  }
});
