const V = 'v76';
const PRECACHE = `precache-${V}`;
const RUNTIME = `runtime-${V}`;

// Lista de recursos CRÍTICOS para funcionamiento offline
const PRECACHE_URLS = [
  './',
  './index.html',
  './menu.html',
  './ronda.html',
  './style.css',
  './webview.css',
  './manifest.json',
  './auth.js',
  './firebase-config.js',
  './initFirebase.js',
  './menu.js',
  './ronda-v2.js',
  './ui.js',
  './webview.js',
  './offline-storage.js',
  './offline-queue.js',
  './sync.js',
  './monitor-sync.js',
  './imagenes/logo1.png',

  // Librerías Externas (CDNs) - Indispensables para que la app no rompa offline
  'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.2/umd/index.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.2.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/signature_pad@4.0.0/dist/signature_pad.umd.min.js',
  'https://www.gstatic.com/firebasejs/10.9.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.9.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore-compat.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(PRECACHE)
      .then(cache => {
        // cache.addAll es atómico, si uno falla, falla todo el precache.
        // Hacemos un intento best-effort para no bloquear la instalación si un CDN falla momentáneamente
        return Promise.all(
          PRECACHE_URLS.map(url => {
            return cache.add(url).catch(err => {
              console.warn('[SW] Falló precacheo de:', url, err);
            });
          })
        );
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  const currentCaches = [PRECACHE, RUNTIME];
  e.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (currentCaches.indexOf(cacheName) === -1) {
            console.log('[SW] Borrando caché antiguo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request: r } = e;
  const u = new URL(r.url);

  // Solo interceptar GET de nuestro origen o de los CDNs que usamos
  if (r.method !== 'GET') return;

  const isHTML = r.mode === 'navigate' || r.url.endsWith('.html');
  const isVideo = r.url.endsWith('.mp4') || r.destination === 'video';

  // Estrategia para HTML: Network First, luego Cache (para tener siempre la última versión si hay red)
  if (isHTML) {
    e.respondWith(
      fetch(r).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(RUNTIME).then(c => c.put(r, clone));
        }
        return res;
      }).catch(() => {
        return caches.match(r).then(c => {
          return c || caches.match('./index.html'); // Fallback final
        });
      })
    );
    return;
  }

  // Estrategia para Video: Cache First (si es posible) o Network directo sin guardar (para no llenar storage)
  // Normalmente video no se cachea en runtime por defecto a menos que sea critico
  if (isVideo) {
    return;
  }

  // Estrategia General: Stale-While-Revalidate ó Cache First con update background
  // Intentamos responder desde caché primero para velocidad
  e.respondWith(
    caches.match(r).then(cachedResponse => {
      // Fetch de red para actualizar caché en futuro (Stale-while-revalidate)
      const fetchPromise = fetch(r).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const clone = networkResponse.clone();
          caches.open(RUNTIME).then(c => c.put(r, clone));
        }
        return networkResponse;
      }).catch(err => {
        // Si red falla, no pasa nada, ya devolvimos caché si había
      });

      return cachedResponse || fetchPromise;
    })
  );
});
