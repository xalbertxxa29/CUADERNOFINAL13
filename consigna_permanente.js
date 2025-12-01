// consigna_permanente.js (v51) — Guarda registradoPor y puesto. Offline-friendly.
document.addEventListener('DOMContentLoaded', () => {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth    = firebase.auth();
  const db      = firebase.firestore();
  const storage = firebase.storage();

  const UX = {
    show: (m) => (window.UI && UI.showOverlay) ? UI.showOverlay(m) : void 0,
    hide: () => (window.UI && UI.hideOverlay) ? UI.hideOverlay() : void 0,
    alert: (t, m, cb) => (window.UI && UI.alert) ? UI.alert(t, m, cb) : (alert(`${t}\n\n${m||''}`), cb && cb())
  };

  // DOM
  const form        = document.getElementById('consigna-permanente-form');
  const tituloEl    = document.getElementById('titulo');
  const descripcionEl = document.getElementById('descripcion');
  const fotoInput   = document.getElementById('foto-input');
  const fotoPreview = document.getElementById('foto-preview');
  const canvas      = document.getElementById('firma-canvas');
  const clearBtn    = document.getElementById('clear-firma');

  // Firma
  const sigPad = new SignaturePad(canvas, { backgroundColor: 'rgb(255,255,255)' });
  function resizeCanvas() {
    const r = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * r;
    canvas.height = canvas.offsetHeight * r;
    canvas.getContext('2d').scale(r, r);
    sigPad.clear();
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  clearBtn?.addEventListener('click', () => sigPad.clear());

  // Imagen
  let pendingPhoto = null;
  fotoInput?.addEventListener('change', async () => {
    const f = fotoInput.files && fotoInput.files[0];
    if (!f) { pendingPhoto=null; fotoPreview.hidden=true; fotoPreview.src=''; return; }
    try {
      UX.show('Procesando imagen…');
      const opt = { maxSizeMB:0.5, maxWidthOrHeight:1280, useWebWorker:true, fileType:'image/jpeg' };
      pendingPhoto = await imageCompression(f, opt);
      fotoPreview.src = URL.createObjectURL(pendingPhoto);
      fotoPreview.hidden = false;
    } catch (e) {
      console.error(e);
      UX.alert('Aviso','No se pudo procesar la imagen.');
      pendingPhoto = null; fotoPreview.hidden = true; fotoPreview.src = '';
    } finally { UX.hide(); }
  });

  // Utils
  function dataURLtoBlob(u){
    const a=u.split(','),m=a[0].match(/:(.*?);/)[1];
    const b=atob(a[1]);let n=b.length;const x=new Uint8Array(n);
    while(n--)x[n]=b.charCodeAt(n);
    return new Blob([x],{type:m});
  }
  const blobToDataURL = (blob) => new Promise((res, rej) => {
    const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(blob);
  });
  async function uploadTo(p,blob){
    const ref=storage.ref().child(p);
    await ref.put(blob);
    return await ref.getDownloadURL();
  }

  // Perfil
  let profile = null;
  auth.onAuthStateChanged(async (user) => {
    if (!user) { window.location.href='index.html'; return; }
    const userId = user.email.split('@')[0];
    const doc = await db.collection('USUARIOS').doc(userId).get().catch(()=>null);
    if (!doc || !doc.exists) { UX.alert('Error','No se encontró tu perfil.'); window.location.href='menu.html'; return; }
    profile = doc.data(); // { CLIENTE, UNIDAD, PUESTO, NOMBRES, APELLIDOS, ... }
  });

  // Guardar
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const titulo = (tituloEl.value||'').trim();
    const descripcion = (descripcionEl.value||'').trim();
    if (!titulo || !descripcion) { UX.alert('Aviso','Completa título y descripción.'); return; }
    if (!profile) { UX.alert('Error','Perfil no cargado.'); return; }

    UX.show('Guardando consigna…');
    try {
      const { CLIENTE, UNIDAD, PUESTO, NOMBRES, APELLIDOS } = profile;
      const stamp = Date.now();

      let fotoURL=null, fotoEmbedded=null;
      if (pendingPhoto) {
        try {
          if (!navigator.onLine) throw new Error('offline');
          fotoURL = await uploadTo(`consignas/permanente/${CLIENTE}/${UNIDAD}/${stamp}_foto.jpg`, pendingPhoto);
        } catch {
          fotoEmbedded = await blobToDataURL(pendingPhoto);
        }
      }

      let firmaURL=null, firmaEmbedded=null;
      if (!sigPad.isEmpty()) {
        const firmaBlob = dataURLtoBlob(sigPad.toDataURL('image/png'));
        try {
          if (!navigator.onLine) throw new Error('offline');
          firmaURL = await uploadTo(`consignas/permanente/${CLIENTE}/${UNIDAD}/${stamp}_firma.png`, firmaBlob);
        } catch {
          firmaEmbedded = await blobToDataURL(firmaBlob);
        }
      }

      await db.collection('CONSIGNA_PERMANENTE').add({
        cliente: CLIENTE,
        unidad: UNIDAD,
        puesto: PUESTO || null,                                // NUEVO (si no lo tenías)
        registradoPor: `${NOMBRES||''} ${APELLIDOS||''}`.trim(),// NUEVO
        titulo,
        descripcion,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        ...(fotoURL ? { fotoURL } : {}),
        ...(firmaURL ? { firmaURL } : {}),
        ...(fotoEmbedded ? { fotoEmbedded } : {}),
        ...(firmaEmbedded ? { firmaEmbedded } : {}),
      });

      UX.hide();
      UX.alert('Éxito','Consigna permanente guardada.', () => window.location.href='menu.html');
    } catch (err) {
      console.error(err);
      UX.hide();
      UX.alert('Error', err.message || 'No se pudo guardar la consigna.');
    }
  });
});
