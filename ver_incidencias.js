// ver_incidencias.js (v1) — Lista de INCIDENCIAS_REGISTRADAS.
document.addEventListener('DOMContentLoaded', () => {
  // ---------- Firebase ----------
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

  // ---------- UI wrapper ----------
  const UX = {
    show: (msg) => (window.UI && UI.showOverlay) ? UI.showOverlay(msg) : void 0,
    hide: () => (window.UI && UI.hideOverlay) ? UI.hideOverlay() : void 0,
    alert: (title, msg) => (window.UI && UI.alert) ? UI.alert(title, msg) : alert((title ? title + '\n\n' : '') + (msg || '')),
  };

  // ---------- DOM ----------
  const cont = document.getElementById('incidencias-container');
  const fechaInput = document.getElementById('fecha-filtro');
  const btnBuscar = document.getElementById('buscar-btn');
  const btnLimpiar = document.getElementById('limpiar-btn');
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');

  // Lightbox
  const lightbox = document.getElementById('imageLightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxClose = document.querySelector('.lightbox-close');
  const lightboxBack = document.querySelector('.lightbox-backdrop');

  // ---------- Estado ----------
  const PAGE_SIZE = 10;
  let perfil = null;            // { CLIENTE, UNIDAD }
  let lastDoc = null;           // cursor para "siguiente"
  let pageStack = [];           // pila de primeros docs por página para retroceder

  // ---------- Sesión ----------
  auth.onAuthStateChanged(async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    try {
      const userId = user.email.split('@')[0];
      const d = await db.collection('USUARIOS').doc(userId).get();
      if (!d.exists) throw new Error('No se encontró tu perfil.');
      const { CLIENTE, UNIDAD } = d.data();
      perfil = { CLIENTE, UNIDAD };
      await cargarRegistros(); // primera página
    } catch (e) {
      console.error(e);
      UX.alert('Error', e.message || 'No se pudo cargar tu perfil.');
    }
  });

  // ---------- Utilidades ----------
  const toDateTimeText = (ts) => {
    try {
      const date = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : (typeof ts === 'number' ? new Date(ts) : null));
      if (!date) return '';

      // Forzar formato dd/mm/yyyy
      const d = date.getDate().toString().padStart(2, '0');
      const m = (date.getMonth() + 1).toString().padStart(2, '0');
      const y = date.getFullYear();

      // Forzar formato hh:mm:ss
      const hh = date.getHours().toString().padStart(2, '0');
      const mm = date.getMinutes().toString().padStart(2, '0');
      const ss = date.getSeconds().toString().padStart(2, '0');

      return `${d}/${m}/${y} ${hh}:${mm}:${ss}`;
    } catch { return ''; }
  };

  const startEndOfDay = (yyyy_mm_dd) => {
    const start = new Date(`${yyyy_mm_dd}T00:00:00`);
    const end = new Date(`${yyyy_mm_dd}T23:59:59.999`);
    return [start, end];
  };

  function buildQuery(direction, cursor) {
    const { CLIENTE, UNIDAD } = perfil;
    let ref;

    // Filtra por CLIENTE y UNIDAD para seguridad, igual que en registros.js
    // Muestra todas las incidencias de esa unidad.
    if (fechaInput.value) {
      const [start, end] = startEndOfDay(fechaInput.value);
      ref = db.collection('INCIDENCIAS_REGISTRADAS')
        .where('cliente', '==', CLIENTE)
        .where('unidad', '==', UNIDAD)
        .where('timestamp', '>=', start)
        .where('timestamp', '<=', end)
        .orderBy('timestamp', 'desc')
        .limit(PAGE_SIZE);
    } else {
      ref = db.collection('INCIDENCIAS_REGISTRADAS')
        .where('cliente', '==', CLIENTE)
        .where('unidad', '==', UNIDAD)
        .orderBy('timestamp', 'desc')
        .limit(PAGE_SIZE);
    }

    if (direction === 'next' && cursor) ref = ref.startAfter(cursor);
    if (direction === 'prev' && cursor) ref = ref.endBefore(cursor).limitToLast(PAGE_SIZE);
    return ref;
  }

  function resolveRegistradoPor(d) {
    return d.registradoPor || d.REGISTRADO_POR || '—';
  }

  function onlyPhotoHTML(data) {
    // Soporta fotoURL y fotoEmbedded (offline)
    const url = data.fotoURL || data.fotoEmbedded || data.foto || null;
    if (!url) return '';
    return `
      <div class="thumb-wrap" style="margin-top:10px;">
        <img src="${url}" class="registro-imagen" alt="Foto de incidencia" data-lightbox="true" loading="lazy">
      </div>`;
  }

  function cardIncidenciaHTML(data) {
    const fechaTxt = toDateTimeText(data.timestamp);
    const quien = resolveRegistradoPor(data);
    const comentario = (data.comentario || '').replace(/\n/g, '<br>');
    const fotoHTML = onlyPhotoHTML(data);

    // Campos específicos solicitados
    const estado = data.estado || '—';
    const unidad = data.unidad || '—';
    const categoria = data.tipoIncidente || '—';    // Categoria
    const subcat = data.detalleIncidente || '—'; // Subcategoria
    const nivelRiesgo = data.Nivelderiesgo || '—';

    // Badge color según estado/riesgo si se quisiera, por ahora genérico rojo

    return `
      <article class="list-card" style="border-left: 4px solid #e53e3e;">
        <div class="list-card-header">
          <span class="badge badge-red">INCIDENCIA</span>
          <span class="muted">${fechaTxt}</span>
        </div>
        
        <div style="font-size: 0.9rem; margin-bottom: 0.5rem; line-height: 1.5;">
          <div><strong>Registrado por:</strong> ${quien}</div>
          <div><strong>Estado:</strong> ${estado}</div>
          <div><strong>Unidad:</strong> ${unidad}</div>
          <div><strong>Categoría:</strong> ${categoria}</div>
          <div><strong>Subcategoría:</strong> ${subcat}</div>
          <div><strong>Nivel Riesgo:</strong> ${nivelRiesgo}</div>
        </div>

        <div style="background: #ffffff0d; padding: 8px; border-radius: 4px;">
            <strong>Comentario:</strong><br>${comentario}
        </div>
        
        ${fotoHTML}
      </article>`;
  }

  function render(docs) {
    cont.innerHTML = '';
    if (!docs.length) {
      cont.innerHTML = `<p class="muted">Sin incidencias registradas.</p>`;
      return;
    }
    docs.forEach(d => {
      const data = d.data();
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = cardIncidenciaHTML(data);
      const article = tempDiv.firstElementChild;

      // Add button
      const btnContainer = document.createElement('div');
      btnContainer.style.cssText = "margin-top:10px; border-top:1px solid #444; padding-top:8px; text-align:right;";
      btnContainer.innerHTML = `
          <button class="btn-report" style="background:transparent; border:1px solid #666; color:#ccc; border-radius:4px; padding:5px 10px; cursor:pointer;">
              <i class="fas fa-file-pdf" style="color:#e74c3c;"></i> Descargar Reporte
          </button>
        `;
      btnContainer.querySelector('button').addEventListener('click', (e) => {
        e.stopPropagation();
        ReportService.generateAndUpload(data, 'INCIDENCIA', 'incidencia');
      });

      article.appendChild(btnContainer);
      cont.appendChild(article);
    });
  }

  // ---------- Carga / paginación ----------
  // ---------- Carga / paginación ----------
  let allLoadedData = []; // Store loaded data

  async function cargarRegistros(direction) {
    if (!perfil) return;
    UX.show('Cargando incidencias…');

    try {
      let cursor = null;
      if (direction === 'next') cursor = lastDoc;
      if (direction === 'prev') {
        if (pageStack.length > 1) {
          pageStack.pop();
          cursor = pageStack[pageStack.length - 1];
        } else { UX.hide(); return; }
      }

      // Reset if not paging
      if (!direction) allLoadedData = [];

      const snap = await buildQuery(direction, cursor).get();

      if (snap.empty) {
        render([]);
        prevBtn.disabled = pageStack.length <= 1;
        nextBtn.disabled = true;
        UX.hide();
        return;
      }

      const first = snap.docs[0];
      const last = snap.docs[snap.docs.length - 1];
      lastDoc = last;
      if (direction !== 'prev') pageStack.push(first);

      // Add new data
      snap.docs.forEach(d => allLoadedData.push(d.data()));

      render(snap.docs);

      prevBtn.disabled = pageStack.length <= 1;
      nextBtn.disabled = snap.docs.length < PAGE_SIZE;
    } catch (e) {
      console.error('Error cargando incidencias:', e);
      cont.innerHTML = `<p class="muted">No se pudieron cargar las incidencias.</p>`;
    } finally {
      UX.hide();
    }
  }

  // ---------- Eventos ----------
  const btnGeneral = document.getElementById('btnGeneralReport');
  if (btnGeneral) {
    btnGeneral.addEventListener('click', () => {
      if (allLoadedData.length === 0) {
        UX.alert('Aviso', 'No hay datos cargados para generar el reporte general.');
        return;
      }
      ReportService.generateGeneralListReport(allLoadedData, 'INCIDENCIA', 'REPORTE GENERAL DE INCIDENCIAS');
    });
  }

  btnBuscar?.addEventListener('click', () => {
    pageStack = []; lastDoc = null; cargarRegistros();
  });
  btnLimpiar?.addEventListener('click', () => {
    fechaInput.value = ''; pageStack = []; lastDoc = null; cargarRegistros();
  });
  nextBtn?.addEventListener('click', () => cargarRegistros('next'));
  prevBtn?.addEventListener('click', () => cargarRegistros('prev'));

  // Lightbox
  cont?.addEventListener('click', (e) => {
    const img = e.target.closest('img[data-lightbox]');
    if (!img || !lightbox || !lightboxImg) return;
    lightboxImg.src = img.src;
    lightbox.removeAttribute('hidden');
  });
  lightboxClose?.addEventListener('click', () => lightbox.setAttribute('hidden', ''));
  lightboxBack?.addEventListener('click', () => lightbox.setAttribute('hidden', ''));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') lightbox?.setAttribute('hidden', ''); });
});
