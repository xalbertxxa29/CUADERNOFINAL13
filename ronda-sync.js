/**
 * ronda-sync.js - Sistema de sincronización para rondas en WebView
 * Sincroniza cambios cuando regresa conectividad
 * Se ejecuta en background para asegurar persistencia
 */

class RondaSync {
  constructor() {
    this.syncInProgress = false;
    this.initSync();
  }

  initSync() {
    // Listener de conectividad
    if (navigator.onLine !== undefined) {
      window.addEventListener('online', () => this.sincronizar());
      window.addEventListener('offline', () => console.log('[RondaSync] Modo offline'));
    }

    // Sincronizar cada 30 segundos si estamos online
    setInterval(() => {
      if (navigator.onLine && !this.syncInProgress) {
        this.sincronizar();
      }
    }, 30000);

    console.log('[RondaSync] ✓ Sistema de sincronización iniciado');
  }

  async sincronizar() {
    if (this.syncInProgress) return;
    this.syncInProgress = true;

    try {
      if (!firebase.apps.length) return;
      const db = firebase.firestore();
      const auth = firebase.auth();

      if (!auth.currentUser) {
        this.syncInProgress = false;
        return;
      }

      // Obtener nombre completo del usuario
      const userId = auth.currentUser.email.split('@')[0];
      let nombreCompleto = userId; // fallback
      
      try {
        const usuarioDoc = await db.collection('USUARIOS').doc(userId).get();
        if (usuarioDoc.exists) {
          const datos = usuarioDoc.data();
          const nombres = (datos.NOMBRES || '').trim();
          const apellidos = (datos.APELLIDOS || '').trim();
          nombreCompleto = `${nombres} ${apellidos}`.trim();
        }
      } catch (e) {
        console.warn('[RondaSync] No se pudo obtener nombre completo:', e);
      }
      
      // Buscar ronda EN_PROGRESO del usuario
      const query = db.collection('RONDAS_COMPLETADAS')
        .where('estado', '==', 'EN_PROGRESO')
        .where('usuario', '==', nombreCompleto);

      const snapshot = await query.get();
      
      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        const rondaId = doc.id;
        const rondaData = doc.data();

        // Intentar obtener del cache
        const cacheData = await RONDA_STORAGE.obtenerDelCache(rondaId);

        if (cacheData && cacheData.puntosRegistrados) {
          // Si hay cambios locales, sincronizar
          const cambios = this.detectarCambios(rondaData.puntosRegistrados, cacheData.puntosRegistrados);
          
          if (cambios.length > 0) {
            console.log('[RondaSync] Sincronizando', cambios.length, 'puntos');
            await db.collection('RONDAS_COMPLETADAS').doc(rondaId).update({
              puntosRegistrados: cacheData.puntosRegistrados,
              ultimaSincronizacion: firebase.firestore.Timestamp.now()
            });
          }
        }
      }
    } catch (e) {
      console.warn('[RondaSync] Error:', e.message);
    } finally {
      this.syncInProgress = false;
    }
  }

  detectarCambios(firebaseData, cacheData) {
    const cambios = [];
    
    Object.entries(cacheData || {}).forEach(([idx, cachePunto]) => {
      const fbPunto = firebaseData?.[idx];
      
      if (!fbPunto || 
          cachePunto.qrEscaneado !== fbPunto.qrEscaneado ||
          cachePunto.codigoQR !== fbPunto.codigoQR) {
        cambios.push(idx);
      }
    });

    return cambios;
  }
}

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.rondaSync = new RondaSync();
  });
} else {
  window.rondaSync = new RondaSync();
}
