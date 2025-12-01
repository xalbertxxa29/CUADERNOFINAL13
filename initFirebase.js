// initFirebase.js (v69) — Firebase compat + offline robusto para WebView
// - Protección contra reinicialización múltiple
// - Persistencia Firestore con synchronizeTabs
// - Ajustes WebView (long polling) y undefined props
// - Warm-up de caché de consultas e imágenes
// - SW: registro y autoupdate

if (!window.__FIREBASE_INITIALIZED__) {
  window.__FIREBASE_INITIALIZED__ = true;

(function () {
  // --- App ---
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

  const auth    = firebase.auth();
  const db      = firebase.firestore();
  const storage = firebase.storage ? firebase.storage() : null;

  // --- Auth: sesión persistente ---
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(console.warn);

  document.addEventListener('visibilitychange', () => {
    // No forzar logout; Firebase restaura sola cuando hay storage disponible
    if (document.visibilityState === 'visible' && !auth.currentUser) {
      // noop
    }
  });

  // --- Firestore: settings WebView-friendly ---
  try {
    // Mejora compatibilidad en WebView y redes corporativas
    db.settings({
      ignoreUndefinedProperties: true,
      // Estos flags ayudan en ciertos WebView Android/proxies:
      experimentalAutoDetectLongPolling: true,
      useFetchStreams: false
    });
  } catch (e) {
    console.warn('[Firestore] settings warn:', e?.message || e);
  }

  // --- Firestore: persistencia offline (una sola vez) ---
  if (!window.__FIRESTORE_PERSISTENCE_ENABLED__) {
    window.__FIRESTORE_PERSISTENCE_ENABLED__ = true;
    (async () => {
      try {
        await firebase.firestore().enablePersistence({ synchronizeTabs: true });
        console.log('[Firestore] Persistencia habilitada.');
      } catch (err) {
        const code = err && err.code;
        if (code === 'failed-precondition') {
          // Otra pestaña/instancia ya posee la persistencia
          console.warn('[Firestore] Persistencia: otra instancia tiene el lock.');
        } else if (code === 'unimplemented') {
          console.warn('[Firestore] Persistencia no soportada.');
        } else {
          console.warn('[Firestore] Persistencia no disponible:', code, err);
        }
      }
    })();
  }

  // --- CACHEO GLOBAL DE PERFIL DE USUARIO (OPTIMIZACIÓN CRÍTICA) ---
  // Evita consultas repetidas al documento USUARIOS
  window.userProfileCache = null;
  window.getUserProfile = async function(userId, forceRefresh = false) {
    // Si hay cache y no forzamos refresh, devolverlo
    if (!forceRefresh && window.userProfileCache && window.userProfileCache.id === userId) {
      console.log(`[cache] Devolviendo perfil en caché para ${userId}`);
      return window.userProfileCache;
    }

    try {
      console.log(`[cache] Cargando perfil desde Firestore: ${userId}`);
      const doc = await db.collection('USUARIOS').doc(userId).get();
      if (doc.exists) {
        window.userProfileCache = { ...doc.data(), id: userId };
        console.log(`[cache] ✅ Perfil en caché para ${userId}`);
        return window.userProfileCache;
      }
    } catch (e) {
      console.error('[cache] Error cargando perfil:', e.message);
    }
    return null;
  };

  // Limpiar caché cuando el usuario cambia
  auth.onAuthStateChanged(user => {
    if (!user || !window.userProfileCache || window.userProfileCache.id !== (user.email.split('@')[0])) {
      window.userProfileCache = null;
    }
  });

  // --- Warm-up de caché (consultas + imágenes) ---
  async function warmFirestoreCache() {
    try {
      // Espera a usuario (si no hay, no precalienta)
      await new Promise((resolve) => {
        if (auth.currentUser) return resolve();
        const off = auth.onAuthStateChanged(() => { off(); resolve(); });
      });
      if (!auth.currentUser) return;

      const userId = (auth.currentUser.email || '').split('@')[0];
      if (!userId) return;

      const userDocRef = db.collection('USUARIOS').doc(userId);
      let profSnap = null;

      if (navigator.onLine) {
        profSnap = await userDocRef.get({ source: 'server' }).catch(() => null);
      }
      if (!profSnap) {
        profSnap = await userDocRef.get().catch(() => null);
      }
      if (!profSnap || !profSnap.exists) {
        console.warn('[warm] Sin perfil; no se precalienta.');
        return;
      }

      const data = profSnap.data() || {};
      const CLIENTE = data.CLIENTE;
      const UNIDAD  = data.UNIDAD;
      if (!CLIENTE || !UNIDAD) {
        console.warn('[warm] Perfil sin CLIENTE/UNIDAD; no se precalienta.');
        return;
      }

      // Precache de consultas típicas (se servirán desde cache si estás offline)
      const [per, tmp, cuaderno] = await Promise.all([
        db.collection('CONSIGNA_PERMANENTE')
          .where('cliente','==',CLIENTE).where('unidad','==',UNIDAD).limit(50).get().catch(() => ({ forEach: () => {} })),
        db.collection('CONSIGNA_TEMPORAL')
          .where('cliente','==',CLIENTE).where('unidad','==',UNIDAD).limit(50).get().catch(() => ({ forEach: () => {} })),
        db.collection('CUADERNO')
          .where('cliente','==',CLIENTE).where('unidad','==',UNIDAD)
          .orderBy('timestamp','desc').limit(30).get().catch(() => ({ forEach: () => {} })),
      ]);

      // Precache prudente de imágenes (máx 30)
      const urls = new Set();
      per.forEach(d => { const x=d.data && d.data(); if (x?.fotoURL) urls.add(x.fotoURL); });
      tmp.forEach(d => { const x=d.data && d.data(); if (x?.fotoURL) urls.add(x.fotoURL); });
      cuaderno.forEach(d => { const x=d.data && d.data(); if (x?.fotoURL) urls.add(x.fotoURL); });

      Array.from(urls).slice(0, 30).forEach(u => {
        try { fetch(u, { mode: 'no-cors', cache: 'force-cache' }); } catch {}
      });

      console.log('[warm] Caché de consultas + imágenes preparada');
    } catch (e) {
      console.warn('[warm] Error', e);
    }
  }

  if (document.readyState === 'complete') warmFirestoreCache();
  else window.addEventListener('load', () => warmFirestoreCache());

  // Exponer util por si quieres invocarla manualmente
  window.warmFirestoreCache = warmFirestoreCache;

  // --- Service Worker: registrar y auto-actualizar ---
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration().then(async (reg) => {
      try {
        if (!reg) {
          await navigator.serviceWorker.register('./sw.js');
          reg = await navigator.serviceWorker.getRegistration();
        }
        if (!reg) return;

        // Forzar activación inmediata del nuevo SW si ya está esperando
        if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');

        // Detectar SW nuevo e instalar
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && reg.waiting) {
              reg.waiting.postMessage('SKIP_WAITING');
            }
          });
        });
      } catch (e) {
        console.warn('[SW] No se pudo registrar/actualizar:', e);
      }
    });

    // Recargar cuando el nuevo SW toma control
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      setTimeout(() => window.location.reload(), 60);
    });
  }

  // --- Debug rápido en consola ---
  window.fb = { auth, db, storage };
})();

} // Cierre de if (!window.__FIREBASE_INITIALIZED__)
