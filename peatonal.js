// peatonal.js v51 — Acceso Peatonal (offline OK)
document.addEventListener('DOMContentLoaded', () => {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db   = firebase.firestore();

  const $ = s => document.querySelector(s);
  const form = $('#peatonal-form');
  const tipoAcceso = $('#tipoAcceso');
  const empresa = $('#empresa');
  const tipoDocumento = $('#tipoDocumento');
  const numeroDocumento = $('#numeroDocumento');
  const nombres = $('#nombres');
  const motivo = $('#motivo');
  const area = $('#area');
  const docHelp = $('#docHelp');

  // Estado de sesión → para tomar CLIENTE/UNIDAD/USUARIO
  let userCtx = { id: '', cliente: '', unidad: '', nombreCompleto: '' };

  auth.onAuthStateChanged(async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    try {
      const id = user.email.split('@')[0];
      const snap = await db.collection('USUARIOS').doc(id).get();
      if (snap.exists) {
        const d = snap.data();
        userCtx = { 
          id, 
          cliente: d.CLIENTE || '', 
          unidad: d.UNIDAD || '',
          // v73: Guardar nombre completo
          nombreCompleto: `${d.NOMBRES || ''} ${d.APELLIDOS || ''}`.trim().toUpperCase()
        };
      } else {
        userCtx = { id, cliente: '', unidad: '', nombreCompleto: id };
      }
    } catch (e) { console.error(e); }
  });

  // Reglas del documento según tipo
  function applyDocRules() {
    if (tipoDocumento.value === 'DNI') {
      numeroDocumento.value = numeroDocumento.value.replace(/\D/g, '').slice(0, 8);
      numeroDocumento.setAttribute('maxlength','8');
      numeroDocumento.setAttribute('minlength','8');
      numeroDocumento.setAttribute('inputmode','numeric');
      numeroDocumento.setAttribute('pattern','^[0-9]{8}$');
      docHelp.textContent = 'DNI: exactamente 8 dígitos.';
    } else if (tipoDocumento.value === 'PASAPORTE') {
      numeroDocumento.value = numeroDocumento.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9);
      numeroDocumento.setAttribute('maxlength','9');
      numeroDocumento.setAttribute('minlength','9');
      numeroDocumento.setAttribute('inputmode','text');
      numeroDocumento.setAttribute('pattern','^[A-Z0-9]{9}$');
      docHelp.textContent = 'PASAPORTE: exactamente 9 caracteres alfanuméricos.';
    } else {
      numeroDocumento.removeAttribute('maxlength');
      numeroDocumento.removeAttribute('minlength');
      numeroDocumento.removeAttribute('pattern');
      docHelp.textContent = 'Para DNI: 8 dígitos. Para PASAPORTE: 9 alfanuméricos.';
    }
  }

  tipoDocumento.addEventListener('change', applyDocRules);
  numeroDocumento.addEventListener('input', applyDocRules);

  // Uppercase helpers (solo letras)
  const toUpperIfText = v => (v ?? '').toString().toUpperCase().trim();

  // Enviar
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Validaciones básicas
    if (!tipoAcceso.value || !empresa.value || !tipoDocumento.value || !numeroDocumento.value ||
        !nombres.value || !motivo.value || !area.value) {
      UI.alert('Campos incompletos', 'Todos los campos son obligatorios.'); return;
    }
    // Reglas de documento
    applyDocRules();
    const pat = new RegExp(numeroDocumento.getAttribute('pattern') || '.*');
    if (!pat.test(numeroDocumento.value)) {
      UI.alert('N° Documento inválido', docHelp.textContent); return;
    }

    // Fecha/hora local (requerido)
    const now = new Date();
    const pad = n => String(n).padStart(2,'0');
    const fechaIngreso = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
    const horaIngreso  = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const payload = {
      TIPO_ACCESO: toUpperIfText(tipoAcceso.value),
      EMPRESA: toUpperIfText(empresa.value),
      TIPO_DOCUMENTO: toUpperIfText(tipoDocumento.value),
      NUMERO_DOCUMENTO: tipoDocumento.value === 'DNI'
        ? numeroDocumento.value // 8 dígitos
        : numeroDocumento.value.toUpperCase(), // 9 alfanum
      NOMBRES_COMPLETOS: toUpperIfText(nombres.value),
      MOTIVO: toUpperIfText(motivo.value),
      AREA: toUpperIfText(area.value),

      ESTADO: 'ABIERTO',
      FECHA_INGRESO: fechaIngreso,
      HORA_INGRESO: horaIngreso,
      FECHA_SALIDA: '',
      HORA_FIN: '',
      ESTADIA: '',

      CLIENTE: toUpperIfText(userCtx.cliente),
      UNIDAD: toUpperIfText(userCtx.unidad),
      USUARIO_ID: toUpperIfText(userCtx.id),
      // v73: Guardar nombre completo del usuario que registra
      USUARIO: userCtx.nombreCompleto,

      // extra por robustez: server timestamp
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    UI.showOverlay('Guardando…');
    try {
      await db.collection('ACCESO_PEATONAL').add(payload);
      UI.hideOverlay();
      UI.alert('Éxito', 'Registro guardado correctamente.', () => {
        window.location.href = 'menu.html';
      });
    } catch (err) {
      console.error(err);
      UI.hideOverlay();
      UI.alert('Error', 'No se pudo guardar. Intente nuevamente.');
    }
  });
});
