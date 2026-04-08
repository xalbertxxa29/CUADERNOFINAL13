// sync.js (v5) — Sincroniza cola al reconectar, con marcas de tiempo y lock
(function () {
  if (!('OfflineQueue' in window)) return;

  // ---- Guardas & helpers ----
  let isFlushing = false;
  let lastRunTs = 0;

  function dataURLtoBlob(u) {
    if (typeof u !== 'string' || !u.startsWith('data:')) return null;
    const a = u.split(','), m = a[0].match(/:(.*?);/)[1];
    const b = atob(a[1]); let n = b.length; const x = new Uint8Array(n);
    while (n--) x[n] = b.charCodeAt(n);
    return new Blob([x], { type: m });
  }

  async function uploadTo(storage, path, blobOrDataURL) {
    let blob = blobOrDataURL;
    if (!(blobOrDataURL instanceof Blob)) {
      const maybe = dataURLtoBlob(blobOrDataURL);
      if (!maybe) throw new Error('Invalid image payload');
      blob = maybe;
    }

    // Subir vía REST API (evita error storage/unknown del SDK)
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('Usuario no autenticado');
    const token = await user.getIdToken();
    const bucket = firebaseConfig.storageBucket;
    const encodedPath = encodeURIComponent(path);
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?uploadType=media&name=${encodedPath}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': blob.type || 'image/jpeg'
      },
      body: blob
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Upload failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media&token=${data.downloadTokens}`;
  }

  function pickBaseFolder(task) {
    // Prioriza 'kind'; compat con 'type' legacy
    const tag = (task?.kind || task?.type || '').toString();
    if (tag.includes('cuaderno')) return 'cuaderno';
    return 'incidencias'; // default
  }

  function nowLocalISO() {
    try { return new Date().toISOString(); } catch { return null; }
  }

  function deviceTZ() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  }

  // ---- Proceso principal ----
  async function flush() {
    console.log('[sync] 🔄 flush() llamado');

    // Debounce + lock
    if (isFlushing) {
      console.log('[sync] ⏸️ Ya hay una sincronización en progreso, saliendo');
      return;
    }
    if (!navigator.onLine) {
      console.log('[sync] 📡 Sin conexión, saliendo');
      return;
    }
    if (!firebase?.apps?.length) {
      console.log('[sync] ⚠️ Firebase no inicializado, saliendo');
      return;
    }

    const db = firebase.firestore?.();
    const storage = firebase.storage?.();
    if (!db || !storage) {
      console.log('[sync] ⚠️ Firestore o Storage no disponibles');
      return;
    }

    isFlushing = true;
    try {
      // Toma tareas (FIFO); compat con all() legacy
      const getTasks = window.OfflineQueue.takeAll || window.OfflineQueue.all;
      const tasks = await getTasks.call(window.OfflineQueue);

      console.log(`[sync] 📦 Tareas en cola: ${tasks?.length || 0}`);

      if (!Array.isArray(tasks) || !tasks.length) {
        console.log('[sync] ✅ No hay tareas pendientes');
        return;
      }

      // Mostrar feedback visual
      if (typeof UI !== 'undefined' && UI.showOverlay) {
        UI.showOverlay('Sincronizando datos offline...', `${tasks.length} pendiente(s)`);
      }
      console.log(`[sync] 🚀 Iniciando sincronización de ${tasks.length} tarea(s)`);

      let syncedCount = 0;

      for (const t of tasks) {
        const id = t.id;
        const baseFolder = pickBaseFolder(t);
        const stamp = Date.now();

        const docPath = t.docPath;
        const cliente = t.cliente;
        const unidad = t.unidad;

        // Campos soportados
        const fotoEmbedded = t.fotoEmbedded || t.foto_base64 || null;
        const firmaEmbedded = t.firmaEmbedded || t.firma_base64 || null;

        // ========== COMPORTAMIENTO ESPECIAL: Creación de documento completo ==========
        // Estos tipos NO requieren docPath porque crean documentos nuevos
        const isFullDocCreation = (t.kind && (
          t.kind === 'ronda-manual-full' ||
          t.kind === 'peatonal-full' ||
          t.kind === 'vehicular-full' ||
          t.kind === 'incidente-full'
        ));

        if (isFullDocCreation) {
          try {
            console.log(`[sync] Procesando ${t.kind}...`);
            const payload = { ...t.data };

            // Determinar colección destino
            let targetCollection = 'RONDA_MANUAL';
            if (t.kind === 'peatonal-full') targetCollection = 'ACCESO_PEATONAL';
            else if (t.kind === 'vehicular-full') targetCollection = 'ACCESO_VEHICULAR';
            else if (t.kind === 'incidente-full') targetCollection = 'INCIDENCIAS_REGISTRADAS';

            // Subir foto si viene en base64
            if (payload.foto && payload.foto.startsWith('data:')) {
              const folder = t.kind === 'ronda-manual-full' ? 'rondas_manuales' :
                t.kind === 'vehicular-full' ? 'acceso-vehicular' :
                  t.kind === 'incidente-full' ? 'incidencias' : 'misc';
              const url = await uploadTo(storage, `${folder}/${cliente}/${unidad}/${stamp}_foto.jpg`, payload.foto);
              payload.foto = url;
              console.log(`[sync] Foto subida: ${url}`);
            }

            // Subir fotoBase64 (vehicular)
            if (payload.fotoBase64 && payload.fotoBase64.startsWith('data:')) {
              const url = await uploadTo(storage, `acceso-vehicular/${cliente}/${unidad}/${stamp}_foto.jpg`, payload.fotoBase64);
              payload.fotoURL = url;
              delete payload.fotoBase64;
              console.log(`[sync] FotoBase64 subida: ${url}`);
            }

            // Subir fotoEmbedded (incidentes)
            if (payload.fotoEmbedded && payload.fotoEmbedded.startsWith('data:')) {
              const url = await uploadTo(storage, `incidencias/${cliente}/${unidad}/${stamp}_foto.jpg`, payload.fotoEmbedded);
              payload.fotoURL = url;
              delete payload.fotoEmbedded;
              console.log(`[sync] FotoEmbedded subida: ${url}`);
            }

            // Agregar timestamp de sincronización
            payload.sincronizadoEn = firebase.firestore.FieldValue.serverTimestamp();

            // Crear documento
            const docRef = await db.collection(targetCollection).add(payload);
            console.log(`[sync] ✅ Documento creado en ${targetCollection}: ${docRef.id}`);

            // Remover de la cola
            await window.OfflineQueue.remove?.(id);
            continue; // Siguiente tarea
          } catch (err) {
            console.error(`[sync] ❌ Error subiendo ${t.kind}:`, err);
            continue; // Reintentar en próxima ejecución
          }
        }

        // ========== VALIDACIÓN PARA TAREAS DE ACTUALIZACIÓN ==========
        // Solo las tareas que NO son creación de documentos requieren docPath
        if (!docPath || !cliente || !unidad) {
          console.warn('[sync] Tarea incompleta, se descarta:', t);
          await window.OfflineQueue.remove?.(id);
          continue;
        }

        // ========== LÓGICA DE ACTUALIZACIÓN PARA TAREAS NORMALES ==========
        const updates = {
          reconectado: true,
          reconectadoEn: firebase.firestore.FieldValue.serverTimestamp(),
          reconectadoLocalAt: nowLocalISO(),
          reconectadoDeviceTz: deviceTZ()
        };

        let changed = false;

        try {
          if (fotoEmbedded) {
            const url = await uploadTo(storage, `${baseFolder}/${cliente}/${unidad}/${stamp}_foto.jpg`, fotoEmbedded);
            updates.fotoURL = url;
            updates.fotoEmbedded = firebase.firestore.FieldValue.delete();
            changed = true;
          }

          if (firmaEmbedded) {
            const url = await uploadTo(storage, `${baseFolder}/${cliente}/${unidad}/${stamp}_firma.png`, firmaEmbedded);
            updates.firmaURL = url;
            updates.firmaEmbedded = firebase.firestore.FieldValue.delete();
            changed = true;
          }

          // Aplica cambios si hubo algo que actualizar
          if (changed) {
            await db.doc(docPath).set(updates, { merge: true });
          }

          // Si todo ok, borramos la tarea
          await window.OfflineQueue.remove?.(id);
          syncedCount++;
          console.log(`[sync] ✅ Tarea actualizada: ${id}`);
        } catch (e) {
          console.warn('[sync] Falló tarea, reintenta luego:', e);
        }
      }

      // Feedback final
      console.log(`[sync] 🎉 Sincronización completada: ${syncedCount}/${tasks.length} exitosas`);

      if (typeof UI !== 'undefined') {
        if (UI.hideOverlay) UI.hideOverlay();
        if (UI.toast && syncedCount > 0) {
          UI.toast(`✅ ${syncedCount} registro(s) sincronizado(s)`);
        }
      }

    } finally {
      isFlushing = false;
      lastRunTs = Date.now();
      console.log('[sync] 🔒 Lock liberado');
    }
  }

  // ---- Disparadores ----
  // Al cargar (si hay red)
  window.addEventListener('load', () => { if (navigator.onLine) flush(); });

  // Al volver la red
  window.addEventListener('online', () => flush());

  // Al volver a la app (WebView visible)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flush();
  });

  // Reintento periódico (1 min) para entornos donde 'online' no dispara
  setInterval(() => {
    // Evita espamear si corrió muy recientemente
    if (Date.now() - lastRunTs > 45_000) flush();
  }, 60_000);

  // Primer intento inmediato
  flush();
})();
