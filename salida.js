// salida.js v51 — Lista ABIERTO y registra salida con iframe (offline)
document.addEventListener('DOMContentLoaded', () => {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db   = firebase.firestore();

  const $ = s => document.querySelector(s);
  const cont = $('#lista-salidas');
  const modal = $('#detalle-modal');
  const iframe = $('#detalle-iframe');

  // Redirige a login si no hay sesión
  let currentUser = null;
  auth.onAuthStateChanged(user => { 
    if (!user) window.location.href = 'index.html';
    currentUser = user; // v73: Guardar usuario actual
  });

  // Util para fechas/horas
  const pad = n => String(n).padStart(2, '0');
  const nowLocalStrings = () => {
    const d = new Date();
    return {
      fecha: `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,
      hora:  `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    };
  };
  function diffHHMM(fechaIni, horaIni, fechaFin, horaFin) {
    // fechas en formato YYYY-MM-DD, hh:mm:ss (local)
    const [Y1,M1,D1] = fechaIni.split('-').map(Number);
    const [h1,m1,s1] = (horaIni||'00:00:00').split(':').map(Number);
    const [Y2,M2,D2] = fechaFin.split('-').map(Number);
    const [h2,m2,s2] = (horaFin||'00:00:00').split(':').map(Number);
    const t1 = new Date(Y1, M1-1, D1, h1, m1, s1).getTime();
    const t2 = new Date(Y2, M2-1, D2, h2, m2, s2).getTime();
    let ms = Math.max(0, t2 - t1);
    const totalMin = Math.round(ms / 60000);
    const hh = Math.floor(totalMin / 60);
    const mm = totalMin % 60;
    return `${hh}:${pad(mm)}`;
  }

  // Carga lista de documentos ABIERTO
  async function cargarAbiertos() {
    cont.innerHTML = '<div class="muted">Cargando…</div>';
    try {
      // Solo where, sin orderBy (mejor para offline/evitar índices)
      const qs = await db.collection('ACCESO_PEATONAL').where('ESTADO','==','ABIERTO').get();
      if (qs.empty) {
        cont.innerHTML = '<div class="muted">No hay accesos abiertos.</div>';
        return;
      }
      // Render
      const frag = document.createDocumentFragment();
      qs.forEach(doc => {
        const d = doc.data();
        const item = document.createElement('button');
        item.className = 'list-item';
        item.style.textAlign = 'left';
        item.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:.75rem;">
            <div>
              <div class="title">${(d.NOMBRES_COMPLETOS||'').toUpperCase()}</div>
              <div class="muted">${d.TIPO_DOCUMENTO || ''}: ${d.NUMERO_DOCUMENTO || ''} · ${d.TIPO_ACCESO || ''} · ${d.EMPRESA || ''}</div>
            </div>
            <div class="muted" style="white-space:nowrap;">${d.FECHA_INGRESO || ''} ${d.HORA_INGRESO || ''}</div>
          </div>`;
        item.addEventListener('click', () => abrirDetalle(doc.id, d));
        frag.appendChild(item);
      });
      cont.innerHTML = '';
      cont.appendChild(frag);
    } catch (e) {
      console.error(e);
      cont.innerHTML = '<div class="muted">No se pudo cargar la lista.</div>';
    }
  }

  cargarAbiertos();

  // Abre modal iframe con la ficha
  function abrirDetalle(id, d) {
  const infoHtml = `
    <!doctype html>
    <html lang="es" data-theme="dark">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
      <link rel="stylesheet" href="style.css?v=51">
      <link rel="stylesheet" href="webview.css?v=51">
      <style>
        /* Forzar contraste alto dentro del iframe */
        :root{ color-scheme: dark; }
        body, .card { color:#e9ecf7 !important; }
        .grid div, .grid div strong { color:#e9ecf7 !important; }
        .muted { color: rgba(255,255,255,.8) !important; }
      </style>
    </head>
    <body>
      <div class="page" style="padding:1rem;">
        <div class="card" style="max-width:none;">
          <h3 style="margin-top:0;">Detalle de Acceso</h3>
          <div class="grid" style="gap:.5rem;">
            <div><strong>Tipo Acceso:</strong> ${d.TIPO_ACCESO||''}</div>
            <div><strong>Empresa:</strong> ${d.EMPRESA||''}</div>
            <div><strong>Tipo Doc:</strong> ${d.TIPO_DOCUMENTO||''}</div>
            <div><strong>N° Doc:</strong> ${d.NUMERO_DOCUMENTO||''}</div>
            <div><strong>Nombres:</strong> ${d.NOMBRES_COMPLETOS||''}</div>
            <div><strong>Motivo:</strong> ${d.MOTIVO||''}</div>
            <div><strong>Área:</strong> ${d.AREA||''}</div>
            <div><strong>Ingreso:</strong> ${d.FECHA_INGRESO||''} ${d.HORA_INGRESO||''}</div>
            <div><strong>Cliente / Unidad:</strong> ${d.CLIENTE||''} / ${d.UNIDAD||''}</div>
            <div><strong>Estado:</strong> ${d.ESTADO||''}</div>
          </div>
          <div class="button-group" style="margin-top:1rem;justify-content:flex-end;">
            <button id="btn-cerrar" class="btn-secondary">Cerrar</button>
            <button id="btn-salida" class="btn-primary">Salida</button>
          </div>
        </div>
      </div>
      <script>
        document.getElementById('btn-cerrar').addEventListener('click', () => {
          parent.postMessage({type:'cerrarDetalle'}, '*');
        });
        document.getElementById('btn-salida').addEventListener('click', () => {
          parent.postMessage({type:'registrarSalida', docId:'${id}'}, '*');
        });
      <\/script>
    </body>
    </html>
  `;
  iframe.srcdoc = infoHtml;
  modal.style.display = 'flex';
}


  // Cerrar modal
  function cerrarModal() {
    modal.style.display = 'none';
    iframe.removeAttribute('srcdoc');
    iframe.setAttribute('src', 'about:blank');
  }
  modal.addEventListener('click', e => { if (e.target === modal) cerrarModal(); });

  // Escucha acciones del iframe
  window.addEventListener('message', async (e) => {
    const data = e.data || {};
    if (data.type === 'cerrarDetalle') {
      cerrarModal();
      return;
    }
    if (data.type === 'registrarSalida' && data.docId) {
      const { fecha, hora } = nowLocalStrings();
      try {
        UI.showOverlay('Registrando salida…');

        // Leer documento para calcular estadía
        const ref = db.collection('ACCESO_PEATONAL').doc(data.docId);
        const snap = await ref.get();
        const d = snap.data() || {};
        const estadia = diffHHMM(d.FECHA_INGRESO || fecha, d.HORA_INGRESO || hora, fecha, hora);

        // v73: Obtener nombre completo del usuario que registra salida
        let usuarioSalida = currentUser?.email || 'DESCONOCIDO';
        try {
          const userId = currentUser?.email.split('@')[0];
          const userSnap = await db.collection('USUARIOS').doc(userId).get();
          if (userSnap.exists) {
            const userData = userSnap.data();
            usuarioSalida = `${userData.NOMBRES || ''} ${userData.APELLIDOS || ''}`.trim().toUpperCase();
          }
        } catch (e) {
          console.warn('No se pudo obtener nombre del usuario:', e);
        }

        await ref.set({
          ESTADO: 'CERRADO',
          FECHA_SALIDA: fecha,
          HORA_FIN: hora,
          ESTADIA: estadia,
          // v73: Guardar usuario que registra salida
          USUARIO_SALIDA: usuarioSalida,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        UI.hideOverlay();
        UI.alert('Salida registrada', 'El registro fue cerrado correctamente.', () => {
          cerrarModal();
          cargarAbiertos(); // refresca la lista
        });
      } catch (err) {
        console.error(err);
        UI.hideOverlay();
        UI.alert('Error', 'No se pudo registrar la salida. Intente nuevamente.');
      }
    }
  });
});
