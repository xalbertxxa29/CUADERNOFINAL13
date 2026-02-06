const V = 'v77';
const PRECACHE = `precache-${V}`;
const RUNTIME = `runtime-${V}`;

// Lista de recursos CRÍTICOS para funcionamiento offline
const PRECACHE_URLS = [
  './',
  './index.html',
  './menu.html',
  './ronda.html',
  './registrar_incidente.html',
  './style.css',
  './webview.css',
  './ronda.css',
  './manifest.json',

  // Scripts Core
  './auth.js',
  './firebase-config.js',
  './initFirebase.js',
  './menu.js',
  './ronda-v2.js',
  './registrar_incidente.js',
  './ui.js',
  './webview.js',
  './image-optimizer.js',
  './offline-storage.js',
  './offline-queue.js',
  './sync.js',
  './monitor-sync.js',
  './offline-sync.js',
  './ronda-sync.js',

  // Páginas y Scripts adicionales
  './accesovehicular.html', './accesovehicular.js',
  './add_cliente_unidad.html',
  './add_puesto.html',
  './add_unidad.html',
  './consigna_permanente.html', './consigna_permanente.js',
  './consigna_temporal.html', './consigna_temporal.js',
  './ingresar_consigna.html',
  './ingresar_informacion.html', './ingresar_informacion.js',
  './peatonal.html', './peatonal.js',
  './registros.html', './registros.js',
  './salida.html', './salida.js',
  './salidavehicular.html', './salidavehicular.js',
  './ver_consignas.html', './ver_consignas.js',
  './ver_incidencias.html', './ver_incidencias.js',
  './ver_peatonal.html', './ver_peatonal.js',
  './ver_rondas_manuales.html', './ver_rondas_manuales.js',
  './ver_rondas_programadas.html', './ver_rondas_programadas.js',
  './ver_vehicular.html', './ver_vehicular.js',

  // Imágenes
  './imagenes/logo1.png',

  // Librerías Externas (CDNs) - Indispensables para que la app no rompa offline
  'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.2/umd/index.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.2.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/signature_pad@4.0.0/dist/signature_pad.umd.min.js',
  'https://unpkg.com/browser-image-compression@2.0.2/dist/browser-image-compression.js',
  'https://www.gstatic.com/firebasejs/10.9.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.9.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.9.0/firebase-storage-compat.js'
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
