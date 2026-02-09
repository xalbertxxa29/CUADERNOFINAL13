// ver_consignas.js (v51) - Fusionado con lógica funcional del usuario.
document.addEventListener('DOMContentLoaded', () => {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

  // --- UI & DOM ---
  const container = document.getElementById('consignas-container');
  const lb = document.getElementById('imageLightbox');
  const lbImg = document.getElementById('lightboxImg');
  const lbClose = document.querySelector('.lightbox-close');
  const lbBackdrop = document.querySelector('.lightbox-backdrop');

  const UX = {
    show: (m) => (window.UI && UI.showOverlay) ? UI.showOverlay(m) : void 0,
    hide: () => (window.UI && UI.hideOverlay) ? UI.hideOverlay() : void 0,
    alert: (t, m) => (window.UI && UI.alert) ? UI.alert(t, m) : alert(`${t || ''}\n\n${m || ''}`),
  };

  // --- Helpers de formato y datos (del código funcional) ---
  const esc = (s) => (s ?? '').toString().replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const fmtDateTime = (ts) => {
    try {
      const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
      return d ? d.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    } catch { return ''; }
  };
  const fmtDate = (ts) => {
    try {
      const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
      return d ? d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
    } catch { return ''; }
  };
  const getMillis = (ts) => {
    if (!ts) return 0;
    if (ts.toMillis) return ts.toMillis();
    if (ts instanceof Date) return ts.getTime();
    const d = new Date(ts);
    return isNaN(d) ? 0 : d.getTime();
  };

  // --- Lógica de filtrado de fechas (del código funcional, adaptada a los nombres de campo) ---
  function isTemporalActiva(docData) {
    const now = new Date();
    // Los nombres de campo 'inicio' y 'fin' son los de tu base de datos
    const start = docData.inicio?.toDate ? docData.inicio.toDate() : (docData.inicio ? new Date(docData.inicio) : null);
    const endRaw = docData.fin?.toDate ? docData.fin.toDate() : (docData.fin ? new Date(docData.fin) : null);

    if (!endRaw) {
      if (start && now < start) return false; // Aún no ha empezado
      return true; // Si ya empezó y no tiene fin, está activa.
    }

    // El fin es inclusivo hasta las 23:59:59 de ese día
    const end = new Date(endRaw.getFullYear(), endRaw.getMonth(), endRaw.getDate(), 23, 59, 59, 999);

    if (start && now < start) return false; // La consigna aún no ha comenzado.
    if (now > end) return false; // La consigna ya ha expirado.

    return true;
  }

  // --- Renderizado de tarjetas (con el estilo visual de tu app) ---
  function card(item) {
    const isTemporal = item.tipo === 'TEMPORAL';
    return `
      <article class="list-card">
        <div class="list-card-header">
          <span class="badge ${isTemporal ? 'badge-info' : 'badge-gray'}">${esc(item.tipo)}</span>
          <span class="muted">${fmtDateTime(item.timestamp) || ''}</span>
        </div>
        <h3 class="list-card-title" style="margin:2px 0 6px;">${esc(item.titulo)}</h3>
        ${item.registradoPor ? `<div class="muted"><strong>Registrado por:</strong> ${esc(item.registradoPor)}</div>` : ''}
        ${item.descripcion ? `<p class="list-card-desc" style="margin-top:6px;">${esc(item.descripcion)}</p>` : ''}
        ${isTemporal ? `<p class="muted" style="margin-top:4px;">Vigencia: ${fmtDate(item.inicio)} → ${fmtDate(item.fin)}</p>` : ''}
        ${item.fotoURL ? `
          <div class="thumb-wrap" style="margin-top:8px;">
            <img src="${item.fotoURL}" alt="Foto de consigna" class="registro-imagen" data-lightbox="true" loading="lazy">
          </div>` : ''}
        ${item.puesto ? `<div style="margin-top:8px;"><span class="chip">${esc(item.puesto)}</span></div>` : ''}
      </article>
    `;
  }

  function renderList(items) {
    container.innerHTML = '';
    if (!items.length) {
      container.innerHTML = `<p class="muted">No hay consignas disponibles.</p>`;
      return;
    }

    items.forEach(item => {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = card(item); // card returns string
      const article = tempDiv.firstElementChild;

      // Add button logic
      const btnContainer = document.createElement('div');
      btnContainer.style.cssText = "margin-top:10px; border-top:1px solid #eee; padding-top:8px; text-align:right;";
      btnContainer.innerHTML = `
          <button class="btn-report" style="background:transparent; border:1px solid #ccc; color:#555; border-radius:4px; padding:5px 10px; cursor:pointer;">
              <i class="fas fa-file-pdf" style="color:#e74c3c;"></i> Descargar Reporte
          </button>
        `;

      btnContainer.querySelector('button').addEventListener('click', (e) => {
        e.stopPropagation();
        ReportService.generateAndUpload(item, 'CONSIGNA', 'consigna');
      });

      article.appendChild(btnContainer);
      container.appendChild(article);
    });

    // Re-attach lightbox listeners locally if needed, or use delegation
    container.querySelectorAll('[data-lightbox]').forEach(img => {
      img.addEventListener('click', () => {
        if (!lb || !lbImg) return;
        lbImg.src = img.src;
        lb.removeAttribute('hidden');
      });
    });
  }

  // --- Carga de datos ---
  async function loadConsignas(user) {
    try {
      UX.show('Cargando consignas…');
      const userId = user.email.split('@')[0];
      const prof = await db.collection('USUARIOS').doc(userId).get();
      if (!prof.exists) throw new Error('No se encontró el perfil del usuario.');

      const { CLIENTE, UNIDAD } = prof.data();
      const query = (col) => db.collection(col).where('cliente', '==', CLIENTE).where('unidad', '==', UNIDAD).get();

      const [permsSnap, tempsSnap] = await Promise.all([query('CONSIGNA_PERMANENTE'), query('CONSIGNA_TEMPORAL')]);

      const permanentes = permsSnap.docs.map(d => {
        const x = d.data();
        return {
          tipo: 'PERMANENTE',
          titulo: x.titulo || 'Consigna',
          descripcion: x.descripcion || '',
          timestamp: x.timestamp || null,
          registradoPor: x.registradoPor || 'S/N',
          puesto: x.puesto || null,
          fotoURL: x.fotoURL || x.fotoEmbedded || null,
        };
      });

      const temporales = tempsSnap.docs.map(d => d.data())
        .filter(isTemporalActiva)
        .map(x => ({
          tipo: 'TEMPORAL',
          titulo: x.titulo || 'Consigna',
          descripcion: x.descripcion || '',
          timestamp: x.timestamp || null,
          inicio: x.inicio || null,
          fin: x.fin || null,
          registradoPor: x.registradoPor || 'S/N',
          puesto: x.puesto || null,
          fotoURL: x.fotoURL || x.fotoEmbedded || null,
        }));

      const all = [...permanentes, ...temporales].sort((a, b) => getMillis(b.timestamp) - getMillis(a.timestamp));

      // Listener Reporte General
      const btnGeneral = document.getElementById('btnGeneralReport');
      if (btnGeneral) {
        // Remover listener previo para evitar duplicados si se llama varias veces (aunque load es onAuth)
        const newBtn = btnGeneral.cloneNode(true);
        btnGeneral.parentNode.replaceChild(newBtn, btnGeneral);

        newBtn.addEventListener('click', () => {
          if (!all.length) {
            UX.alert('Aviso', 'No hay consignas para reportar.');
            return;
          }
          ReportService.generateGeneralListReport(all, 'CONSIGNA', 'REPORTE GENERAL DE CONSIGNAS');
        });
      }

      renderList(all);

    } catch (err) {
      console.error(err);
      UX.alert('Error', err.message || 'No fue posible cargar las consignas.');
    } finally {
      UX.hide();
    }
  }

  auth.onAuthStateChanged((u) => u ? loadConsignas(u) : (window.location.href = 'index.html'));

  const closeLb = () => lb?.setAttribute('hidden', '');
  lbClose?.addEventListener('click', closeLb);
  lbBackdrop?.addEventListener('click', closeLb);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLb(); });
});
