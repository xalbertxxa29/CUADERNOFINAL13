// sync.js (v5) — Sincroniza cola al reconectar, con marcas de tiempo y lock
(function () {
  if (!('OfflineQueue' in window)) return;

  // ---- Guardas & helpers ----
  let isFlushing = false;
  let lastRunTs  = 0;

  function dataURLtoBlob(u) {
    if (typeof u !== 'string' || !u.startsWith('data:')) return null;
    const a = u.split(','), m = a[0].match(/:(.*?);/)[1];
    const b = atob(a[1]); let n = b.length; const x = new Uint8Array(n);
    while (n--) x[n] = b.charCodeAt(n);
    return new Blob([x], { type: m });
  }

  async function uploadTo(storage, path, blobOrDataURL) {
    const ref = storage.ref().child(path);

    let blob = blobOrDataURL;
    if (!(blobOrDataURL instanceof Blob)) {
      const maybe = dataURLtoBlob(blobOrDataURL);
      if (!maybe) throw new Error('Invalid image payload');
      blob = maybe;
    }

    await ref.put(blob);
    return await ref.getDownloadURL();
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
    // Debounce + lock
    if (isFlushing) return;
    if (!navigator.onLine) return;
    if (!firebase?.apps?.length) return;

    const db      = firebase.firestore?.();
    const storage = firebase.storage?.();
    if (!db || !storage) return;

    isFlushing = true;
    try {
      // Toma tareas (FIFO); compat con all() legacy
      const getTasks = window.OfflineQueue.takeAll || window.OfflineQueue.all;
      const tasks = await getTasks.call(window.OfflineQueue);
      if (!Array.isArray(tasks) || !tasks.length) return;

      for (const t of tasks) {
        const id        = t.id;
        const baseFolder= pickBaseFolder(t);
        const stamp     = Date.now();

        const docPath   = t.docPath;
        const cliente   = t.cliente;
        const unidad    = t.unidad;

        // Campos soportados
        const fotoEmbedded  = t.fotoEmbedded  || t.foto_base64 || null;
        const firmaEmbedded = t.firmaEmbedded || t.firma_base64 || null;

        // Validaciones mínimas
        if (!docPath || !cliente || !unidad) {
          // Tarea mal formada → la descartamos para no bloquear la cola
          console.warn('[sync] Tarea incompleta, se descarta:', t);
          await window.OfflineQueue.remove?.(id);
          continue;
        }

        const updates = {
          // marcas de reconexión
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
          } else {
            // Aun si no subimos nada, podemos dejar trazas de reconexión (opcional).
            // Descomenta si deseas marcar reconexión siempre:
            // await db.doc(docPath).set(updates, { merge: true });
          }

          // Si todo ok, borramos la tarea
          await window.OfflineQueue.remove?.(id);
        } catch (e) {
          // si falla, lo dejamos para el próximo intento
          console.warn('[sync] Falló tarea, reintenta luego:', e);
        }
      }
    } finally {
      isFlushing = false;
      lastRunTs = Date.now();
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
