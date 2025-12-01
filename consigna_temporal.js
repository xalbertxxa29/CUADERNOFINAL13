// consigna_temporal.js (v51) — robusto y a prueba de ids distintos
document.addEventListener('DOMContentLoaded', () => {
  // ---------- Firebase ----------
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth    = firebase.auth();
  const db      = firebase.firestore();
  const storage = firebase.storage();

  // ---------- UI helpers ----------
  const UX = {
    show: (m) => (window.UI && UI.showOverlay) ? UI.showOverlay(m) : void 0,
    hide: () => (window.UI && UI.hideOverlay) ? UI.hideOverlay() : void 0,
    alert: (t, m, cb) => (window.UI && UI.alert) ? UI.alert(t, m, cb) : (alert(`${t||'Aviso'}\n\n${m||''}`), cb && cb()),
  };

  // ---------- DOM safe getters ----------
  const $ = (sel) => document.querySelector(sel);
  const byId = (...ids) => {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) return el;
    }
    return null;
  };

  // Intenta múltiples ids comunes para cada campo
  const form            = byId('consigna-temporal-form','consigna_form','consignaTemporalForm') || $('form');
  const tituloEl        = byId('titulo','titulo-temporal','titulo_input');
  const descripcionEl   = byId('descripcion','descripcion-temporal','descripcion_input','comentario');
  const inicioEl        = byId('inicio','fecha-inicio','fechaInicio','inicio_input');
  const finEl           = byId('fin','fecha-fin','fechaFin','fin_input');
  const fotoInput       = byId('foto-input','foto','foto_temporal','fotoInput');
  const fotoPreview     = byId('foto-preview','preview','preview-img');
  const canvas          = byId('firma-canvas','canvas-firma','firma');
  const clearBtn        = byId('clear-firma','limpiar-firma','btnClearFirma');

  // Validación de elementos críticos
  function need(el, name) {
    if (!el) throw new Error(`Falta el campo/elemento: ${name}. Verifica el id en consigna_temporal.html`);
    return el;
  }
  need(form,'formulario');
  need(tituloEl,'Título');
  need(descripcionEl,'Descripción');
  need(inicioEl,'Fecha de inicio');
  need(finEl,'Fecha de fin');
  need(canvas,'Canvas de firma');

  // ---------- Firma ----------
  const sigPad = new SignaturePad(canvas, { backgroundColor: 'rgb(255,255,255)' });

  function resizeCanvas() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const cssH = parseFloat(getComputedStyle(canvas).height) || 200;
    const cssW = canvas.clientWidth || canvas.offsetWidth || 300;
    canvas.width  = Math.floor(cssW * ratio);
    canvas.height = Math.floor(cssH * ratio);
    canvas.getContext('2d').scale(ratio, ratio);
    sigPad.clear();
  }
  window.addEventListener('resize', resizeCanvas);
  setTimeout(resizeCanvas, 60);
  clearBtn && clearBtn.addEventListener('click', () => sigPad.clear());

  // ---------- Foto opcional ----------
  let pendingPhoto = null;
  fotoInput && fotoInput.addEventListener('change', async () => {
    const f = fotoInput.files && fotoInput.files[0];
    if (!f) { pendingPhoto=null; if (fotoPreview){ fotoPreview.hidden=true; fotoPreview.src=''; } return; }
    try{
      UX.show('Procesando imagen…');
      // Usar el ImageOptimizer centralizado para compresión consistente
      pendingPhoto = await ImageOptimizer.compress(f, 'consigna');
      if (fotoPreview){ fotoPreview.src = URL.createObjectURL(pendingPhoto); fotoPreview.hidden = false; }
    } catch(e){
      console.error(e);
      pendingPhoto = null;
      if (fotoPreview){ fotoPreview.hidden=true; fotoPreview.src=''; }
      UX.alert('Aviso', 'No se pudo procesar la imagen seleccionada.');
    } finally { UX.hide(); }
  });

  // ---------- Utils ----------
  function dataURLtoBlob(u){
    const a=u.split(','),m=a[0].match(/:(.*?);/)[1];
    const b=atob(a[1]);let n=b.length;const x=new Uint8Array(n);
    while(n--)x[n]=b.charCodeAt(n);
    return new Blob([x],{type:m});
  }
  function blobToDataURL(blob){
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }
  async function uploadTo(p, blob){
    const ref = storage.ref().child(p);
    await ref.put(blob);
    return await ref.getDownloadURL();
  }

  // dd/mm/yyyy o yyyy-mm-dd -> Date a las 00:00
  function parseDateInput(val){
    const s = String(val || '').trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00`);
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`);
    const d = new Date(s);
    return isNaN(d) ? null : new Date(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T00:00:00`);
  }

  // ---------- Sesión ----------
  let profile = null;
  auth.onAuthStateChanged(async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    const userId = user.email.split('@')[0];
    const doc = await db.collection('USUARIOS').doc(userId).get().catch(()=>null);
    if (!doc || !doc.exists) { UX.alert('Error','No se encontró tu perfil.', () => window.location.href='menu.html'); return; }
    profile = doc.data();
  });

  // ---------- Guardar ----------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const titulo = (tituloEl.value || '').trim();
    const descripcion = (descripcionEl.value || '').trim();
    const ini = parseDateInput(inicioEl.value);
    const fin = parseDateInput(finEl.value);

    if (!titulo) return UX.alert('Aviso','Ingresa el título.');
    if (!descripcion) return UX.alert('Aviso','Ingresa la descripción.');
    if (!ini || !fin) return UX.alert('Aviso','Revisa las fechas de inicio y fin.');
    if (fin < ini)  return UX.alert('Aviso','La fecha de fin no puede ser menor a la de inicio.');

    if (!profile) return UX.alert('Error','Tu perfil no está cargado todavía. Intenta de nuevo.');

    UX.show('Guardando consigna temporal…');

    try {
      const { CLIENTE, UNIDAD, PUESTO, NOMBRES, APELLIDOS } = profile || {};
      const registradoPor = `${NOMBRES || ''} ${APELLIDOS || ''}`.trim() || null;
      const stamp = Date.now();

      // Foto
      let fotoURL = null, fotoEmbedded = null;
      if (pendingPhoto) {
        try {
          if (!navigator.onLine) throw new Error('offline');
          fotoURL = await uploadTo(`consignas/temporal/${CLIENTE}/${UNIDAD}/${stamp}_foto.jpg`, pendingPhoto);
        } catch {
          fotoEmbedded = await blobToDataURL(pendingPhoto);
        }
      }

      // Firma
      let firmaURL = null, firmaEmbedded = null;
      if (!sigPad.isEmpty()) {
        const firmaBlob = dataURLtoBlob(sigPad.toDataURL('image/png'));
        try {
          if (!navigator.onLine) throw new Error('offline');
          firmaURL = await uploadTo(`consignas/temporal/${CLIENTE}/${UNIDAD}/${stamp}_firma.png`, firmaBlob);
        } catch {
          firmaEmbedded = await blobToDataURL(firmaBlob);
        }
      }

      await db.collection('CONSIGNA_TEMPORAL').add({
        cliente: CLIENTE,
        unidad: UNIDAD,
        puesto: PUESTO || null,
        registradoPor,
        titulo,
        descripcion,
        inicio: ini,
        fin: fin,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        ...(fotoURL ? { fotoURL } : {}),
        ...(firmaURL ? { firmaURL } : {}),
        ...(fotoEmbedded ? { fotoEmbedded } : {}),
        ...(firmaEmbedded ? { firmaEmbedded } : {}),
      });

      UX.hide();
      UX.alert('Éxito','Consigna temporal guardada.', () => window.location.href='menu.html');
    } catch (err) {
      console.error(err);
      UX.hide();
      UX.alert('Error', err.message || 'No fue posible guardar la consigna temporal.');
    }
  });
});
