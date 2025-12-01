// registros.js (v51) — Lista del CUADERNO.
// Muestra foto si existe (miniatura) y NO muestra firma. Incluye paginación y lightbox.
document.addEventListener('DOMContentLoaded', () => {
  // ---------- Firebase ----------
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db   = firebase.firestore();

  // ---------- UI wrapper ----------
  const UX = {
    show: (msg) => (window.UI && UI.showOverlay) ? UI.showOverlay(msg) : void 0,
    hide: () => (window.UI && UI.hideOverlay) ? UI.hideOverlay() : void 0,
    alert: (title, msg) => (window.UI && UI.alert) ? UI.alert(title, msg) : alert((title ? title + '\n\n' : '') + (msg || '')),
  };

  // ---------- DOM ----------
  const cont         = document.getElementById('registros-container');
  const fechaInput   = document.getElementById('fecha-filtro');
  const btnBuscar    = document.getElementById('buscar-btn');
  const btnLimpiar   = document.getElementById('limpiar-btn');
  const prevBtn      = document.getElementById('prev-btn');
  const nextBtn      = document.getElementById('next-btn');

  // Lightbox
  const lightbox       = document.getElementById('imageLightbox');
  const lightboxImg    = document.getElementById('lightboxImg');
  const lightboxClose  = document.querySelector('.lightbox-close');
  const lightboxBack   = document.querySelector('.lightbox-backdrop');

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
      const date = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
      return date ? date.toLocaleString('es-PE', { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit', year:'numeric' }) : '';
    } catch { return ''; }
  };

  const startEndOfDay = (yyyy_mm_dd) => {
    const start = new Date(`${yyyy_mm_dd}T00:00:00`);
    const end   = new Date(`${yyyy_mm_dd}T23:59:59.999`);
    return [start, end];
  };

  function buildQuery(direction, cursor) {
    const { CLIENTE, UNIDAD } = perfil;
    let ref;

    if (fechaInput.value) {
      const [start, end] = startEndOfDay(fechaInput.value);
      ref = db.collection('CUADERNO')
        .where('cliente', '==', CLIENTE)
        .where('unidad',  '==', UNIDAD)
        .where('timestamp', '>=', start)
        .where('timestamp', '<=', end)
        .orderBy('timestamp', 'desc')
        .limit(PAGE_SIZE);
    } else {
      ref = db.collection('CUADERNO')
        .where('cliente', '==', CLIENTE)
        .where('unidad',  '==', UNIDAD)
        .orderBy('timestamp', 'desc')
        .limit(PAGE_SIZE);
    }

    if (direction === 'next' && cursor) ref = ref.startAfter(cursor);
    if (direction === 'prev' && cursor) ref = ref.endBefore(cursor).limitToLast(PAGE_SIZE);
    return ref;
  }

  function resolveRegistradoPor(d) {
    if (d.usuario) return d.usuario;
    if (d.registradoPor?.nombre) return d.registradoPor.nombre;
    if (d.REGISTRADO_POR || d.registrado_por) return d.REGISTRADO_POR || d.registrado_por;
    if (d.nombres || d.apellidos) return `${d.nombres || ''} ${d.apellidos || ''}`.trim();
    if (d.userId) return d.userId;
    return '—';
  }

  function onlyPhotoHTML(data) {
    const url = data.fotoURL || data.foto || null;
    if (!url) return '';
    // Imagen miniatura (clase .registro-imagen controla tamaño)
    return `
      <div class="thumb-wrap" style="margin-top:10px;">
        <img src="${url}" class="registro-imagen" alt="Foto del registro" data-lightbox="true" loading="lazy">
      </div>`;
  }

  function cardRegistroHTML(data) {
    const fechaTxt = toDateTimeText(data.timestamp);
    const quien    = resolveRegistradoPor(data);
    const comentario = (data.comentario || '').replace(/\n/g, '<br>');
    const fotoHTML = onlyPhotoHTML(data);
    return `
      <article class="list-card">
        <div class="list-card-header">
          <span class="badge badge-gray">REGISTRO</span>
          <span class="muted">${fechaTxt}</span>
        </div>
        <div class="muted"><strong>Registrado por:</strong> ${quien}</div>
        <div style="margin-top:6px;">${comentario}</div>
        ${fotoHTML}
      </article>`;
  }

  function cardRelevoHTML(data) {
    const fechaTxt = toDateTimeText(data.timestamp);
    const comentario = (data.comentario || '').replace(/\n/g, '<br>');
    // v73: Mostrar nombre completo (en el objeto nombre) o fallback al id
    const sal = data.usuarioSaliente?.nombre || data.usuarioSaliente?.id || '';
    const ent = data.usuarioEntrante?.nombre || data.usuarioEntrante?.id || '';
    const quien = resolveRegistradoPor(data);
    const fotoHTML = onlyPhotoHTML(data);
    return `
      <article class="list-card">
        <div class="list-card-header">
          <span class="badge badge-purple">RELEVO</span>
          <span class="muted">${fechaTxt}</span>
        </div>
        <div class="muted"><strong>Saliente:</strong> ${sal} &nbsp; <strong>Entrante:</strong> ${ent}</div>
        <div class="muted"><strong>Registrado por:</strong> ${quien}</div>
        <div style="margin-top:6px;">${comentario}</div>
        ${fotoHTML}
      </article>`;
  }

  function render(docs) {
    if (!docs.length) {
      cont.innerHTML = `<p class="muted">Sin registros.</p>`;
      return;
    }
    const html = docs.map(d => {
      const data = d.data();
      return (data.tipoRegistro === 'RELEVO') ? cardRelevoHTML(data) : cardRegistroHTML(data);
    }).join('');
    cont.innerHTML = html;
  }

  // ---------- Carga / paginación ----------
  async function cargarRegistros(direction) {
    if (!perfil) return;
    UX.show('Cargando registros…');

    try {
      let cursor = null;
      if (direction === 'next') cursor = lastDoc;
      if (direction === 'prev') {
        if (pageStack.length > 1) {
          pageStack.pop();
          cursor = pageStack[pageStack.length - 1];
        } else { UX.hide(); return; }
      }

      const snap = await buildQuery(direction, cursor).get();

      if (snap.empty) {
        render([]);
        prevBtn.disabled = pageStack.length <= 1;
        nextBtn.disabled = true;
        UX.hide();
        return;
      }

      const first = snap.docs[0];
      const last  = snap.docs[snap.docs.length - 1];
      lastDoc = last;
      if (direction !== 'prev') pageStack.push(first);

      render(snap.docs);

      prevBtn.disabled = pageStack.length <= 1;
      nextBtn.disabled = snap.docs.length < PAGE_SIZE;
    } catch (e) {
      console.error('Error cargando registros:', e);
      cont.innerHTML = `<p class="muted">No se pudieron cargar los registros.</p>`;
    } finally {
      UX.hide();
    }
  }

  // ---------- Eventos ----------
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
