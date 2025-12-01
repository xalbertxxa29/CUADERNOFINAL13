const V = 'v69';
const PRECACHE = `precache-${V}`;
const RUNTIME = `runtime-${V}`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((k) => Promise.all(k.filter(n => n !== PRECACHE && n !== RUNTIME).map(n => caches.delete(n)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request: r } = e;
  const u = new URL(r.url);
  
  if (u.origin !== self.location.origin || r.method !== 'GET') return;
  
  const isHTML = r.mode === 'navigate' || r.url.endsWith('.html');
  const isJS_CSS = r.url.endsWith('.js') || r.url.endsWith('.css');
  const isImg = /\.(png|jpg|jpeg|gif|svg|webp|ico|ttf|otf|woff|woff2)$/i.test(u.pathname);
  
  if (isHTML) {
    e.respondWith(
      fetch(r).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(RUNTIME).then(c => c.put(r, clone));
        }
        return res;
      }).catch(() => caches.match(r).then(c => c || caches.match('./index.html')))
    );
  } else if (isJS_CSS) {
    e.respondWith(
      caches.match(r).then(c => {
        const fp = fetch(r).then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(RUNTIME).then(ch => ch.put(r, clone));
          }
          return res;
        }).catch(() => c || new Response('Offline', {status: 503}));
        return c || fp;
      })
    );
  } else if (isImg) {
    e.respondWith(
      caches.match(r).then(c => {
        if (c) return c;
        return fetch(r).then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(RUNTIME).then(ch => ch.put(r, clone));
          }
          return res;
        }).catch(() => new Response('Not found', {status: 404}));
      })
    );
  } else {
    e.respondWith(
      fetch(r).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(RUNTIME).then(c => c.put(r, clone));
        }
        return res;
      }).catch(() => caches.match(r).catch(() => new Response('Offline', {status: 503})))
    );
  }
});
