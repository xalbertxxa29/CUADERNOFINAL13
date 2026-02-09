// ver_vehicular.js (v1) — Lista de ACCESO_VEHICULAR.
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
    const cont = document.getElementById('vehicular-container');
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
            await cargarRegistros();
        } catch (e) {
            console.error(e);
            UX.alert('Error', e.message || 'No se pudo cargar tu perfil.');
        }
    });

    const toDateTimeText = (ts) => {
        try {
            const date = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : (typeof ts === 'number' ? new Date(ts) : null));
            if (!date) return String(ts || '');

            // Forzar formato dd/mm/yyyy
            const d = date.getDate().toString().padStart(2, '0');
            const m = (date.getMonth() + 1).toString().padStart(2, '0');
            const y = date.getFullYear();

            // Forzar formato hh:mm:ss
            const hh = date.getHours().toString().padStart(2, '0');
            const mm = date.getMinutes().toString().padStart(2, '0');
            const ss = date.getSeconds().toString().padStart(2, '0');

            return `${d}/${m}/${y} ${hh}:${mm}:${ss}`;
        } catch { return String(ts || ''); }
    };

    function buildQuery(direction, cursor) {
        const { CLIENTE, UNIDAD } = perfil;
        // Imagen dice "cliente": "DIVEMOTOR" (minúscula 'cliente'), "unidad": "LURÍN..." (minúscula 'unidad')
        // Aunque en ACCESO_PEATONAL parecía todo mayúscula. 
        // Revisando imagen 2 y 3:
        // ACCESO_PEATONAL (img 2) -> CLIENTE (Mayús)
        // ACCESO_VEHICULAR (img 3) -> cliente (Minús)
        // Hay inconsistencia en la BBDD. Usaré minúsculas para VEHICULAR basado en la imagen 3.

        let ref = db.collection('ACCESO_VEHICULAR')
            .where('cliente', '==', CLIENTE)
            .where('unidad', '==', UNIDAD);

        if (fechaInput.value) {
            // Imagen 3 no muestra un campo de fecha 'limpio' como FECHA_INGRESO "yyyy-mm-dd", 
            // muestra fechaIngreso: "19 de enero de 2026 ...". Es un string complejo.
            // Y timestamp: 1768833... (number).
            // Filtrar por string complejo "19 de enero de..." con un input type="date" ("2026-01-19") es IMPOSIBLE directamente.
            // USARÉ EL CAMPO timestamp numeric para filtrar por rango si es posible.

            const startOfDay = new Date(fechaInput.value + 'T00:00:00').getTime();
            const endOfDay = new Date(fechaInput.value + 'T23:59:59').getTime();

            // La imagen muestra timestamp: 1768833367478. Esto está en milisegundos.
            // Firestore soporta filtrar números.
            ref = ref.where('timestamp', '>=', startOfDay).where('timestamp', '<=', endOfDay);
            ref = ref.orderBy('timestamp', 'desc');
        } else {
            ref = ref.orderBy('timestamp', 'desc');
        }

        ref = ref.limit(PAGE_SIZE);

        if (direction === 'next' && cursor) ref = ref.startAfter(cursor);
        if (direction === 'prev' && cursor) ref = ref.endBefore(cursor).limitToLast(PAGE_SIZE);
        return ref;
    }

    function onlyPhotoHTML(data) {
        const url = data.fotoURL || null; // Imagen 3 muestra fotoURL
        if (!url) return '';
        return `
      <div class="thumb-wrap" style="margin-top:10px;">
        <img src="${url}" class="registro-imagen" alt="Foto vehicular" data-lightbox="true" loading="lazy">
      </div>`;
    }

    function cardVehicularHTML(data) {
        // Fields: puesto, nombres, marca, modelo, placa, color, fechaIngreso, fechaSalida, 
        // estado, dni, observaciones, comentarioSalida, usuario, usuarioSalida y fotoURL.

        // fechaIngreso y fechaSalida en la imagen son strings largos "19 de enero...".
        // Usaremos esos strings para mostrar.

        // Si no existen, intentamos formatear el timestamp si estuviera disponible.
        const fIngreso = data.fechaIngreso || toDateTimeText(data.timestamp);
        const fSalida = data.fechaSalida || '';

        const estado = data.estado || '—';
        const nombre = data.nombres || '—';
        const placa = data.placa || '—';
        const marca = data.marca || '';
        const modelo = data.modelo || '';
        const color = data.color || '';
        const vehiculo = `${marca} ${modelo} ${color}`.trim();

        const dni = data.dni || '—';
        const obs = data.observaciones || '—';
        const comSalida = data.comentarioSalida || '—';

        const usuarioIngreso = data.usuario || '—';
        const usuarioSalida = data.usuarioSalida || '—';

        const fotoHTML = onlyPhotoHTML(data);

        // Badge
        let badgeClass = 'badge-gray';
        if (estado === 'ingreso') badgeClass = 'badge-green'; // img 3 dice estado: "salida" (minúsculas)
        if (estado === 'salida') badgeClass = 'badge-red';

        return `
       <article class="list-card" style="border-left: 4px solid #ed8936;">
        <div class="list-card-header">
          <span class="badge ${badgeClass}">${estado.toUpperCase()}</span>
          <span class="muted">${placa}</span>
        </div>
        
        <div style="font-size: 1rem; font-weight: 600; margin-bottom: 4px;">${nombre}</div>
        <div class="muted" style="margin-bottom: 8px;">${vehiculo} (DNI ${dni})</div>

        <div style="font-size: 0.9rem; margin-bottom: 0.5rem; line-height: 1.5;">
          <div><strong>Ingreso:</strong> ${fIngreso}</div>
           ${fSalida ? `<div><strong>Salida:</strong> ${fSalida}</div>` : ''}
          <div style="margin-top:4px;"><strong>Obs. Ingreso:</strong> ${obs}</div>
          ${comSalida !== 'Sin comentario.' && comSalida !== '—' ? `<div><strong>Obs. Salida:</strong> ${comSalida}</div>` : ''}
          
          <div style="margin-top:8px; font-size: 0.85rem; color: #aaa;">
             <div><strong>Reg. Ingreso:</strong> ${usuarioIngreso}</div>
             ${usuarioSalida !== '—' ? `<div><strong>Reg. Salida:</strong> ${usuarioSalida}</div>` : ''}
          </div>
        </div>
        
        ${fotoHTML}
      </article>`;
    }

    function render(docs) {
        cont.innerHTML = '';
        if (!docs.length) {
            cont.innerHTML = `<p class="muted">Sin registros vehiculares.</p>`;
            return;
        }
        docs.forEach(d => {
            const data = d.data();
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = cardVehicularHTML(data);
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
                ReportService.generateAndUpload(data, 'VEHICULAR', 'vehicular');
            });
            article.appendChild(btnContainer);
            cont.appendChild(article);
        });
    }

    // ---------- Carga / paginación ----------
    let allLoadedData = [];

    async function cargarRegistros(direction) {
        if (!perfil) return;
        UX.show('Cargando historial vehicular…');

        try {
            let cursor = null;
            if (direction === 'next') cursor = lastDoc;
            if (direction === 'prev') {
                if (pageStack.length > 1) {
                    pageStack.pop();
                    cursor = pageStack[pageStack.length - 1];
                } else { UX.hide(); return; }
            }

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

            snap.docs.forEach(d => allLoadedData.push(d.data()));

            render(snap.docs);

            prevBtn.disabled = pageStack.length <= 1;
            nextBtn.disabled = snap.docs.length < PAGE_SIZE;
        } catch (e) {
            console.error('Error cargando vehicular:', e);
            let msg = 'No se pudieron cargar los registros.';
            if (e.message.includes('index')) {
                msg = '<i class="fas fa-exclamation-triangle" style="color:orange;"></i> Falta índice en Firebase.<br><br>' +
                    '<span style="font-size:0.9rem">Abre la consola del navegador (F12) y busca el enlace para crearlo.</span>';
            } else {
                msg += `<br><br><small style="color:#f87171">${e.message}</small>`;
            }
            cont.innerHTML = `<div style="text-align:center; padding:2rem;">${msg}</div>`;
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
            ReportService.generateGeneralListReport(allLoadedData, 'VEHICULAR', 'REPORTE GENERAL VEHICULAR');
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
