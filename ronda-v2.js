// ronda-v2.js - Sistema mejorado de rondas con persistencia y QR
// Características:
// - ID documento = ID ronda (sin duplicados)
// - Guarda cada escaneo en Firebase inmediatamente
// - Sincronización en tiempo real WebView
// - Recupera ronda con cronómetro sincronizado al reiniciar navegador
// - Estados: EN_PROGRESO → TERMINADA/INCOMPLETA/NO_REALIZADA
// - Cache local + IndexedDB para WebView offline
// - Auto-termina si pasa tolerancia

const RONDA_STORAGE = {
  DB_NAME: 'ronda-sessions',
  STORE_NAME: 'ronda-cache',
  
  async openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async guardarEnCache(rondaId, rondaData) {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE_NAME, 'readwrite');
        const store = tx.objectStore(this.STORE_NAME);
        const request = store.put({ id: rondaId, data: rondaData, timestamp: Date.now() });
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.warn('Error en cache:', e);
    }
  },

  async obtenerDelCache(rondaId) {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE_NAME, 'readonly');
        const store = tx.objectStore(this.STORE_NAME);
        const request = store.get(rondaId);
        request.onsuccess = () => resolve(request.result?.data || null);
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.warn('Error obteniendo cache:', e);
      return null;
    }
  },

  async limpiarCache(rondaId) {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE_NAME, 'readwrite');
        const store = tx.objectStore(this.STORE_NAME);
        const request = store.delete(rondaId);
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.warn('Error limpiando cache:', e);
    }
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

  let currentUser = null;
  let userCtx = { email: '', uid: '', cliente: '', unidad: '', puesto: '', userId: '' };
  let rondaEnProgreso = null;
  let rondaManualEnProgreso = false;
  let scannerActivo = false;
  let animFrameId = null;
  let lastUpdateTime = Date.now();
  let codeReaderInstance = null;
  let tipoRondaSeleccionado = null;
  let rondaIdActual = null; // ID de la ronda EN_PROGRESO (igual al doc de Rondas_QR)

  // ===================== CREAR OVERLAY DE CARGA =====================
  function mostrarOverlay(mensaje = 'Procesando...') {
    const overlay = document.createElement('div');
    overlay.id = 'loading-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.8); display: flex; align-items: center;
      justify-content: center; z-index: 5000;
    `;
    
    overlay.innerHTML = `
      <div style="text-align: center;">
        <div style="width: 50px; height: 50px; border: 4px solid #444; border-top-color: #ef4444;
          border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 15px;"></div>
        <p style="color: white; font-size: 1.1em; margin: 0;">${mensaje}</p>
      </div>
      <style>
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
    `;
    
    document.body.appendChild(overlay);
    return overlay;
  }

  function ocultarOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.remove();
  }

  // ===================== AUTH =====================
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = 'index.html';
      return;
    }

    currentUser = user;
    userCtx.email = user.email;
    userCtx.uid = user.uid;
    const userId = user.email.split('@')[0];
    userCtx.userId = userId;

    try {
      const snap = await db.collection('USUARIOS').doc(userId).get();
      if (snap.exists) {
        const datos = snap.data();
        userCtx.cliente = (datos.CLIENTE || '').toUpperCase();
        userCtx.unidad = (datos.UNIDAD || '').toUpperCase();
        userCtx.puesto = datos.PUESTO || '';
        
        // Obtener nombre completo para búsqueda en BD
        const nombres = (datos.NOMBRES || '').trim();
        const apellidos = (datos.APELLIDOS || '').trim();
        const nombreCompleto = `${nombres} ${apellidos}`.trim();
        
        // Verificar si hay ronda EN_PROGRESO del usuario actual
        await verificarRondaEnProgreso(nombreCompleto);
        // Cargar rondas disponibles
        await cargarRondas();
      }
    } catch (e) {
      console.error('[Ronda] Error:', e);
    }
  });

  // ===================== VERIFICAR RONDA EN PROGRESO =====================
  async function verificarRondaEnProgreso(userId) {
    try {
      // Buscar rondas EN_PROGRESO del usuario actual en RONDAS_COMPLETADAS
      const query = db.collection('RONDAS_COMPLETADAS')
        .where('estado', '==', 'EN_PROGRESO')
        .where('usuario', '==', userId);
      
      const snapshot = await query.get();
      
      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        rondaEnProgreso = { ...doc.data() };
        rondaIdActual = doc.id; // El ID debe ser igual al documento de Rondas_QR
        
        console.log('[Ronda] Ronda recuperada:', rondaEnProgreso.nombre, 'ID:', rondaIdActual);
        
        // Guardar en cache local para acceso rápido
        await RONDA_STORAGE.guardarEnCache(rondaIdActual, rondaEnProgreso);
        
        // Verificar si ya pasó la tolerancia
        const ahoraMs = Date.now();
        const inicioMs = rondaEnProgreso.horarioInicio.toMillis ? 
          rondaEnProgreso.horarioInicio.toMillis() : 
          new Date(rondaEnProgreso.horarioInicio).getTime();
        const elapsedMs = ahoraMs - inicioMs;
        
        const toleranciaMs = 
          rondaEnProgreso.toleranciaTipo === 'horas'
            ? rondaEnProgreso.tolerancia * 3600000
            : rondaEnProgreso.tolerancia * 60000;
        
        if (elapsedMs > toleranciaMs) {
          console.log('[Ronda] Tolerancia expirada, terminando automáticamente...');
          await terminarRondaAuto();
        } else {
          mostrarRondaEnProgreso();
          iniciarCronometro();
        }
      } else {
        // Intentar recuperar del cache si no hay en Firebase
        const cacheData = await buscarRondaEnCachePorUsuario(userId);
        if (cacheData) {
          console.log('[Ronda] Ronda recuperada del cache local');
          rondaEnProgreso = cacheData.data;
          rondaIdActual = cacheData.id;
          mostrarRondaEnProgreso();
          iniciarCronometro();
        }
      }
    } catch (e) {
      console.error('[Ronda] Error verificando ronda:', e);
    }
  }

  // ===================== BUSCAR RONDA EN CACHE =====================
  async function buscarRondaEnCachePorUsuario(nombreCompleto) {
    try {
      const db = await RONDA_STORAGE.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(RONDA_STORAGE.STORE_NAME, 'readonly');
        const store = tx.objectStore(RONDA_STORAGE.STORE_NAME);
        const request = store.getAll();
        
        request.onsuccess = () => {
          const items = request.result;
          for (let item of items) {
            if (item.data?.usuario === nombreCompleto && item.data?.estado === 'EN_PROGRESO') {
              resolve({ id: item.id, data: item.data });
              return;
            }
          }
          resolve(null);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.warn('Error buscando en cache:', e);
      return null;
    }
  }

  // ===================== CARGAR RONDAS =====================
  async function cargarRondas() {
    const listDiv = document.getElementById('rondas-list');
    if (!listDiv) return;

    // Si hay ronda en progreso, no mostrar otras
    if (rondaEnProgreso) return;

    try {
      let snapshot = await db.collection('Rondas_QR').get();
      let rondasFiltradas = [];

      snapshot.forEach(doc => {
        const ronda = doc.data();
        if (
          (ronda.cliente || '').toUpperCase() === userCtx.cliente &&
          (ronda.unidad || '').toUpperCase() === userCtx.unidad
        ) {
          rondasFiltradas.push({ id: doc.id, ...ronda });
        }
      });

      if (rondasFiltradas.length === 0) {
        listDiv.innerHTML = '<p style="color:#999;">No hay rondas</p>';
        return;
      }

      listDiv.innerHTML = '';
      rondasFiltradas.forEach(ronda => {
        const card = crearCardRonda(ronda);
        listDiv.appendChild(card);
      });
    } catch (e) {
      console.error('[Ronda] Error cargando:', e);
    }
  }

  // ===================== CREAR CARD RONDA =====================
  function crearCardRonda(ronda) {
    const div = document.createElement('div');
    
    // Validar si la ronda puede iniciarse
    const validacion = validarRonda(ronda);
    const puedeIniciar = validacion.activa;
    const motivo = validacion.motivo;
    
    div.style.cssText = `
      background: ${puedeIniciar ? '#222' : '#3f3f3f'}; 
      border: 1px solid ${puedeIniciar ? '#333' : '#555'}; 
      border-radius: 8px; padding: 15px;
      margin: 10px 0; cursor: ${puedeIniciar ? 'pointer' : 'not-allowed'}; 
      transition: all 0.2s; opacity: ${puedeIniciar ? '1' : '0.6'};
    `;

    div.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong style="color: ${puedeIniciar ? '#fff' : '#999'}; font-size: 1.1em;">${ronda.nombre || 'Ronda'}</strong>
          <div style="font-size: 0.9em; color: ${puedeIniciar ? '#ccc' : '#666'}; margin-top: 5px;">
            🕒 ${ronda.horario || '--:--'} | ⏱️ ${ronda.tolerancia || '--'} ${ronda.toleranciaTipo || 'minutos'}
          </div>
          ${!puedeIniciar ? `<div style="font-size: 0.85em; color: #ff6b6b; margin-top: 8px;">⚠️ ${motivo}</div>` : ''}
        </div>
        <button style="
          background: ${puedeIniciar ? '#ef4444' : '#999'}; 
          color: white; border: none; padding: 8px 16px;
          border-radius: 4px; cursor: ${puedeIniciar ? 'pointer' : 'not-allowed'}; 
          font-weight: 500;
        " ${!puedeIniciar ? 'disabled' : ''}>${puedeIniciar ? 'Iniciar' : 'Inactiva'}</button>
      </div>
    `;

    if (puedeIniciar) {
      div.querySelector('button').addEventListener('click', () => iniciarRonda(ronda));
    }
    
    return div;
  }

  // ===================== VALIDAR RONDA =====================
  function validarRonda(ronda) {
    const ahora = new Date();
    const horaActualMs = ahora.getHours() * 3600000 + ahora.getMinutes() * 60000;
    
    let activa = false;
    let motivo = '';

    if (!ronda.frecuencia) {
      motivo = 'Frecuencia no configurada';
      return { activa: false, motivo };
    }

    if (ronda.frecuencia === 'diaria') {
      if (!ronda.horario) {
        motivo = 'Horario no configurado';
        return { activa: false, motivo };
      }

      const [horaStr, minStr] = ronda.horario.split(':');
      const horaIni = parseInt(horaStr) || 0;
      const minIni = parseInt(minStr) || 0;
      const inicioMs = horaIni * 3600000 + minIni * 60000;

      if (!ronda.tolerancia || !ronda.toleranciaTipo) {
        motivo = 'Tolerancia no configurada';
        return { activa: false, motivo };
      }

      const toleranciaMs = 
        ronda.toleranciaTipo === 'horas'
          ? ronda.tolerancia * 3600000
          : ronda.tolerancia * 60000;

      const finMs = inicioMs + toleranciaMs;

      if (horaActualMs < inicioMs) {
        const minutosFalta = Math.floor((inicioMs - horaActualMs) / 60000);
        motivo = `Comienza en ${minutosFalta} minutos`;
        return { activa: false, motivo };
      } else if (horaActualMs > finMs) {
        motivo = `Horario expirado`;
        return { activa: false, motivo };
      } else {
        activa = true;
      }
    } else {
      motivo = `Frecuencia "${ronda.frecuencia}" no soportada`;
      return { activa: false, motivo };
    }

    return { activa, motivo };
  }

  // ===================== INICIAR RONDA =====================
  // Función para generar ID único con timestamp
  function generarIdRondaConTimestamp(rondaId, horarioRonda) {
    const ahora = new Date();
    const año = ahora.getFullYear();
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    const día = String(ahora.getDate()).padStart(2, '0');
    
    // Extraer HH:MM del horario configurado (ej: "23:29" → "2329")
    const [horaStr, minStr] = (horarioRonda || '00:00').split(':');
    const horarioFormato = `${String(horaStr).padStart(2, '0')}${String(minStr).padStart(2, '0')}`;
    
    return `${rondaId}_${año}_${mes}_${día}_${horarioFormato}`;
  }

  async function iniciarRonda(ronda) {
    const overlay = mostrarOverlay('Iniciando ronda...');
    
    try {
      // ⚠️ ID del documento = ID de la ronda + fecha + horario configurado (evita sobrescrituras)
      const docId = generarIdRondaConTimestamp(ronda.id, ronda.horario); // Ej: ronda_1763785728711_2025-11-24_2329
      const ahora = firebase.firestore.Timestamp.now();

      // Obtener nombre completo del documento USUARIOS
      let nombreCompleto = userCtx.userId;
      try {
        const usuarioDoc = await db.collection('USUARIOS').doc(userCtx.userId).get();
        if (usuarioDoc.exists) {
          const datos = usuarioDoc.data();
          const nombres = (datos.NOMBRES || '').trim();
          const apellidos = (datos.APELLIDOS || '').trim();
          nombreCompleto = `${nombres} ${apellidos}`.trim();
          console.log('[Ronda] Nombre encontrado:', nombreCompleto);
        }
      } catch (e) {
        console.warn('[Ronda] No se pudo obtener nombre completo:', e);
      }

      const puntosRondaArray = Array.isArray(ronda.puntosRonda)
        ? ronda.puntosRonda
        : Object.values(ronda.puntosRonda || {});

      const puntosRegistrados = {};
      puntosRondaArray.forEach((punto, idx) => {
        puntosRegistrados[idx] = {
          nombre: punto.nombre || `Punto ${idx + 1}`,
          qrEscaneado: false,
          codigoQR: null,
          timestamp: null,
          respuestas: {},
          foto: null
        };
      });

      rondaEnProgreso = {
        nombre: ronda.nombre,
        rondaId: ronda.id,
        cliente: userCtx.cliente,
        unidad: userCtx.unidad,
        usuario: nombreCompleto,
        usuarioEmail: currentUser.email,
        horarioRonda: ronda.horario,
        horarioInicio: ahora,
        horarioTermino: null,
        estado: 'EN_PROGRESO',
        puntosRonda: puntosRondaArray,
        puntosRegistrados: puntosRegistrados,
        tolerancia: ronda.tolerancia,
        toleranciaTipo: ronda.toleranciaTipo
      };

      rondaIdActual = docId;

      // Guardar en RONDAS_COMPLETADAS con ID = ronda.id (sin duplicados)
      await db.collection('RONDAS_COMPLETADAS').doc(docId).set(rondaEnProgreso);
      
      // Guardar en cache local para acceso offline
      await RONDA_STORAGE.guardarEnCache(docId, rondaEnProgreso);

      console.log('[Ronda] Iniciada con ID:', docId);
      ocultarOverlay();
      mostrarRondaEnProgreso();
      iniciarCronometro();
    } catch (e) {
      console.error('[Ronda] Error iniciando:', e);
      ocultarOverlay();
      alert('Error: ' + e.message);
    }
  }

  // ===================== MOSTRAR RONDA EN PROGRESO =====================
  function mostrarRondaEnProgreso() {
    const listDiv = document.getElementById('rondas-list');
    if (!listDiv || !rondaEnProgreso) return;

    listDiv.innerHTML = '';

    const header = document.createElement('div');
    header.style.cssText = `
      background: #1a1a1a; border: 1px solid #444; border-radius: 8px; padding: 15px;
      margin-bottom: 20px;
    `;
    header.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong style="color: #fff; font-size: 1.2em;">${rondaEnProgreso.nombre}</strong>
          <div style="color: #999; margin-top: 5px;">Estado: EN PROGRESO</div>
        </div>
        <div>
          <div id="cronometro" style="font-size: 2em; font-weight: bold; color: #ef4444; font-family: monospace;">00:00:00</div>
          <button id="btn-terminar" style="
            background: #ef4444; color: white; border: none; padding: 8px 16px;
            border-radius: 4px; cursor: pointer; margin-top: 10px; width: 100%;
            font-weight: 600;
          ">Terminar Ronda</button>
        </div>
      </div>
    `;
    listDiv.appendChild(header);

    const puntosDiv = document.createElement('div');
    puntosDiv.id = 'puntos-container';
    
    Object.entries(rondaEnProgreso.puntosRegistrados).forEach(([idx, punto]) => {
      const qrEscaneado = punto.qrEscaneado;
      const tieneRespuestas = punto.respuestas && Object.keys(punto.respuestas).length > 0;
      const tieneFoto = punto.foto !== null && punto.foto !== undefined;
      
      const card = document.createElement('div');
      card.style.cssText = `
        background: ${qrEscaneado ? '#065f46' : '#222'}; 
        border: 1px solid ${qrEscaneado ? '#10b981' : '#333'};
        border-radius: 8px; padding: 15px; margin: 10px 0; 
        cursor: pointer; transition: all 0.2s;
      `;
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong style="color: #fff; font-size: 1.1em;">${punto.nombre}</strong>
            <div style="font-size: 0.9em; color: #ccc; margin-top: 5px;">
              ${qrEscaneado ? '✅ QR Escaneado' : '⏳ Pendiente'}
            </div>
            ${qrEscaneado ? `<div style="font-size: 0.85em; color: #10b981;">📱 ${punto.codigoQR}</div>` : ''}
            ${tieneRespuestas ? `<div style="font-size: 0.85em; color: #10b981;">📋 ${Object.keys(punto.respuestas).length} respuesta(s)</div>` : ''}
            ${tieneFoto ? `<div style="font-size: 0.85em; color: #10b981;">📷 Foto guardada</div>` : ''}
          </div>
          <button style="
            background: ${qrEscaneado ? '#10b981' : '#3b82f6'}; color: white; border: none; 
            padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 500;
          ">${qrEscaneado ? 'Completado' : 'Escanear'}</button>
        </div>
      `;

      if (!qrEscaneado) {
        card.querySelector('button').addEventListener('click', () => {
          // Obtener punto completo de puntosRonda usando el índice numérico
          const puntoCompleto = rondaEnProgreso.puntosRonda[parseInt(idx)];
          abrirEscaner(parseInt(idx), puntoCompleto);
        });
      }

      puntosDiv.appendChild(card);
    });

    listDiv.appendChild(puntosDiv);
    header.querySelector('#btn-terminar').addEventListener('click', terminarRonda);
  }

  // ===================== ABRIR ESCÁNER QR =====================
  function abrirEscaner(indice, punto) {
    if (scannerActivo) return;
    scannerActivo = true;

    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.95); display: flex; flex-direction: column;
      align-items: center; justify-content: center; z-index: 1000;
    `;

    modal.innerHTML = `
      <div style="color: white; text-align: center; margin-bottom: 20px;">
        <h2 style="margin: 0;">Escanear QR - ${punto.nombre}</h2>
        <p style="margin: 10px 0 0 0; color: #ccc;">Apunta la cámara al código QR</p>
      </div>
      <video id="scanner-video" autoplay playsinline style="width: 80%; max-width: 500px; border: 2px solid #ef4444; border-radius: 8px;"></video>
      <div style="display: flex; gap: 10px; margin-top: 20px;">
        <button id="retry-scanner" style="
          background: #3b82f6; color: white; border: none; padding: 10px 20px;
          border-radius: 4px; cursor: pointer; font-weight: 600;
        ">Reintentar</button>
        <button id="close-scanner" style="
          background: #666; color: white; border: none; padding: 10px 20px;
          border-radius: 4px; cursor: pointer; font-weight: 600;
        ">Cancelar</button>
      </div>
    `;

    document.body.appendChild(modal);

    iniciarVideoQR(indice, punto, modal);

    modal.querySelector('#close-scanner').addEventListener('click', () => {
      detenerVideoQR(modal);
      scannerActivo = false;
      if (modal && modal.parentNode) modal.remove();
      mostrarRondaEnProgreso();
    });

    modal.querySelector('#retry-scanner').addEventListener('click', () => {
      detenerVideoQR(modal);
      const video = modal.querySelector('#scanner-video');
      iniciarVideoQR(indice, punto, modal);
    });
  }

  // ===================== INICIAR VIDEO QR =====================
  async function iniciarVideoQR(indice, punto, modal) {
    try {
      const video = modal.querySelector('#scanner-video');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      // NO llamar a video.play() - ZXing lo maneja automáticamente

      // Detener cualquier lector anterior
      if (codeReaderInstance) {
        try {
          codeReaderInstance.reset();
        } catch (e) {}
      }

      const codeReader = new ZXing.BrowserMultiFormatReader();
      codeReaderInstance = codeReader;

      codeReader.decodeFromVideoDevice(undefined, video, (result, err) => {
        if (result) {
          procesarQR(result.getText(), indice, punto, modal);
        }
      });
    } catch (e) {
      console.error('[QR] Error:', e);
      alert('❌ Error de cámara');
      scannerActivo = false;
      if (modal && modal.parentNode) modal.remove();
    }
  }

  // ===================== PROCESAR QR =====================
  async function procesarQR(codigoQR, indice, punto, modal) {
    try {
      console.log('[QR] Procesando:', codigoQR);
      console.log('[QR] Punto:', punto.nombre);
      console.log('[QR] QR esperado:', punto.qrId);

      if (!punto.qrId) {
        console.error('[QR] El punto no tiene qrId configurado');
        alert('❌ Error: El punto no tiene QR configurado.');
        scannerActivo = false;
        return;
      }

      const esValido = codigoQR.trim() === punto.qrId.trim();
      
      if (!esValido) {
        console.error('[QR] RECHAZO - No coincide');
        mostrarErrorQR(indice, punto, modal);
        return;
      }

      console.log('[QR] ✅ QR VÁLIDO para', punto.nombre);

      const puntoCompleto = rondaEnProgreso.puntosRonda[indice];
      const tienePreguntas = puntoCompleto && puntoCompleto.questions && puntoCompleto.questions.length > 0;

      // Detener el scanner ANTES de procesar
      detenerVideoQR(modal);

      if (tienePreguntas) {
        if (modal) modal.remove();
        scannerActivo = false;
        mostrarFormularioPreguntas(codigoQR, indice, puntoCompleto);
      } else {
        const overlay = mostrarOverlay('Guardando punto...');
        await guardarPuntoEscaneado(codigoQR, indice, puntoCompleto);
        ocultarOverlay();
        if (modal) modal.remove();
        scannerActivo = false;
        mostrarRondaEnProgreso();
      }
    } catch (e) {
      console.error('[Ronda] Error registrando:', e);
      alert('Error: ' + e.message);
      scannerActivo = false;
    }
  }

  // ===================== MOSTRAR ERROR QR MODAL =====================
  function mostrarErrorQR(indice, punto, modal) {
    const errorOverlay = document.createElement('div');
    errorOverlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.85); display: flex; align-items: center;
      justify-content: center; z-index: 2000;
    `;

    const errorBox = document.createElement('div');
    errorBox.style.cssText = `
      background: #1a1a1a; border: 2px solid #ef4444; border-radius: 12px;
      padding: 40px; text-align: center; max-width: 350px;
      box-shadow: 0 10px 40px rgba(239, 68, 68, 0.3);
    `;

    errorBox.innerHTML = `
      <div style="font-size: 3em; margin-bottom: 20px;">❌</div>
      <h2 style="color: #ef4444; margin: 0 0 15px 0; font-size: 1.3em;">Código QR Incorrecto</h2>
      <p style="color: #ccc; margin: 0; font-size: 0.95em;">Por favor, intenta de nuevo.</p>
      <button id="retry-qr" style="
        background: #ef4444; color: white; border: none; padding: 12px 30px;
        border-radius: 6px; cursor: pointer; margin-top: 25px; font-weight: 600;
        font-size: 0.95em;
      ">Reintentar</button>
    `;

    errorOverlay.appendChild(errorBox);
    document.body.appendChild(errorOverlay);

    errorBox.querySelector('#retry-qr').addEventListener('click', () => {
      errorOverlay.remove();
      scannerActivo = false;
      // Reiniciar video del scanner
      if (modal && modal.parentNode) {
        const video = modal.querySelector('#scanner-video');
        if (video && video.srcObject) {
          video.srcObject.getTracks().forEach(track => track.stop());
        }
        iniciarVideoQR(indice, punto, modal);
      }
    });
  }

  // ===================== DETENER VIDEO QR =====================
  function detenerVideoQR(modal) {
    if (!modal) return;
    const video = modal.querySelector('#scanner-video');
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(track => track.stop());
    }
    if (codeReaderInstance) {
      try {
        codeReaderInstance.reset();
      } catch (e) {}
    }
  }

  // ===================== MOSTRAR FORMULARIO DE PREGUNTAS =====================
  function mostrarFormularioPreguntas(codigoQR, indice, punto) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.95); display: flex; flex-direction: column;
      align-items: center; justify-content: center; z-index: 1001; overflow-y: auto;
      padding: 20px 0;
    `;

    const container = document.createElement('div');
    container.style.cssText = `
      background: #1a1a1a; border: 1px solid #444; border-radius: 8px;
      padding: 25px; max-width: 500px; width: 90%; margin: auto;
      color: white;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `margin-bottom: 25px;`;
    header.innerHTML = `
      <h2 style="margin: 0; color: #fff; font-size: 1.3em;">${punto.nombre}</h2>
      <p style="margin: 8px 0 0 0; color: #ccc; font-size: 0.9em;">📝 Responde las preguntas</p>
    `;
    container.appendChild(header);

    // Preguntas
    const respuestasObj = {};
    let preguntas = punto.questions || {};

    // Si preguntas es array, convertir a objeto
    if (Array.isArray(preguntas)) {
      const preguntasObj = {};
      preguntas.forEach((p, idx) => {
        preguntasObj[idx] = p;
      });
      preguntas = preguntasObj;
    }

    const preguntasArray = Object.entries(preguntas);

    if (preguntasArray.length === 0) {
      container.innerHTML += '<p style="color: #999; text-align: center;">Sin preguntas</p>';
    } else {
      preguntasArray.forEach(([qKey, pregunta]) => {
        const fieldKey = `question_${qKey}`;
        respuestasObj[fieldKey] = '';

        const questionDiv = document.createElement('div');
        questionDiv.style.cssText = `margin-bottom: 20px;`;
        
        const label = document.createElement('label');
        label.style.cssText = `display: block; margin-bottom: 8px; color: #fff; font-weight: 500; font-size: 0.95em;`;
        
        // Extraer el texto de la pregunta de diferentes posibles campos
        let textoPreg = '';
        if (typeof pregunta === 'string') {
          textoPreg = pregunta;
        } else if (pregunta.pregunta) {
          textoPreg = pregunta.pregunta;
        } else if (pregunta.requireQuestion) {
          textoPreg = pregunta.requireQuestion;
        } else {
          textoPreg = JSON.stringify(pregunta).substring(0, 50);
        }
        
        label.textContent = textoPreg || `Pregunta ${qKey}`;
        questionDiv.appendChild(label);

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Respuesta...';
        input.dataset.fieldKey = fieldKey;
        input.style.cssText = `
          width: 100%; padding: 10px; background: #222; border: 1px solid #444;
          border-radius: 4px; color: #fff; font-size: 0.95em; box-sizing: border-box;
        `;
        input.addEventListener('input', (e) => {
          respuestasObj[fieldKey] = e.target.value;
        });
        questionDiv.appendChild(input);

        container.appendChild(questionDiv);
      });
    }

    // Sección de Foto
    const fotoDiv = document.createElement('div');
    fotoDiv.style.cssText = `margin-top: 25px; padding-top: 20px; border-top: 1px solid #444;`;
    
    const fotoLabel = document.createElement('label');
    fotoLabel.style.cssText = `display: block; margin-bottom: 12px; color: #fff; font-weight: 500; font-size: 0.95em;`;
    fotoLabel.textContent = '📷 Tomar Foto (Opcional)';
    fotoDiv.appendChild(fotoLabel);

    const fotoContainer = document.createElement('div');
    fotoContainer.style.cssText = `
      background: #222; border: 1px solid #444; border-radius: 4px; 
      padding: 12px; margin-bottom: 12px; min-height: 200px; display: flex;
      align-items: center; justify-content: center;
    `;
    
    const video = document.createElement('video');
    video.id = 'foto-video';
    video.style.cssText = `width: 100%; border-radius: 4px; display: none; max-height: 250px; object-fit: cover;`;
    video.autoplay = true;
    video.playsInline = true;
    fotoContainer.appendChild(video);

    const canvas = document.createElement('canvas');
    canvas.id = 'foto-canvas';
    canvas.style.cssText = `width: 100%; border-radius: 4px; display: none;`;
    canvas.style.maxHeight = '250px';
    fotoContainer.appendChild(canvas);

    const preview = document.createElement('img');
    preview.id = 'foto-preview';
    preview.style.cssText = `width: 100%; border-radius: 4px; display: none; max-height: 250px; object-fit: cover;`;
    fotoContainer.appendChild(preview);

    const placeholder = document.createElement('div');
    placeholder.style.cssText = `color: #999; font-size: 0.9em; text-align: center;`;
    placeholder.textContent = 'Sin foto capturada';
    placeholder.id = 'foto-placeholder';
    fotoContainer.appendChild(placeholder);

    fotoDiv.appendChild(fotoContainer);

    const fotoButtonsDiv = document.createElement('div');
    fotoButtonsDiv.style.cssText = `display: flex; gap: 8px; margin-bottom: 12px;`;

    const btnAbrirCamara = document.createElement('button');
    btnAbrirCamara.textContent = 'Abrir Cámara';
    btnAbrirCamara.style.cssText = `
      flex: 1; padding: 10px; background: #3b82f6; color: white; border: none;
      border-radius: 4px; cursor: pointer; font-weight: 500; font-size: 0.9em;
    `;
    btnAbrirCamara.addEventListener('click', () => {
      abrirCamaraFoto(video, placeholder);
    });
    fotoButtonsDiv.appendChild(btnAbrirCamara);

    const btnCapturar = document.createElement('button');
    btnCapturar.textContent = 'Capturar';
    btnCapturar.style.cssText = `
      flex: 1; padding: 10px; background: #ef4444; color: white; border: none;
      border-radius: 4px; cursor: pointer; font-weight: 500; font-size: 0.9em;
    `;
    btnCapturar.addEventListener('click', () => {
      capturarFoto(video, canvas, preview, placeholder);
    });
    fotoButtonsDiv.appendChild(btnCapturar);

    fotoDiv.appendChild(fotoButtonsDiv);
    container.appendChild(fotoDiv);

    // Botones de Acción
    const buttonsDiv = document.createElement('div');
    buttonsDiv.style.cssText = `display: flex; gap: 10px; margin-top: 25px;`;

    const btnGuardar = document.createElement('button');
    btnGuardar.textContent = 'Guardar';
    btnGuardar.style.cssText = `
      flex: 1; padding: 12px; background: #10b981; color: white; border: none;
      border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 0.95em;
    `;
    btnGuardar.addEventListener('click', async () => {
      const loadingOverlay = mostrarOverlay('Guardando punto...');
      try {
        const fotoBase64 = canvas.dataset.fotoBase64 || null;
        await guardarPuntoConRespuestas(codigoQR, indice, punto, respuestasObj, fotoBase64);
        ocultarOverlay();
        overlay.remove();
        mostrarRondaEnProgreso();
      } catch (e) {
        ocultarOverlay();
        console.error('[Foto] Error:', e);
      }
    });
    buttonsDiv.appendChild(btnGuardar);

    const btnCancelar = document.createElement('button');
    btnCancelar.textContent = 'Cancelar';
    btnCancelar.style.cssText = `
      flex: 1; padding: 12px; background: #666; color: white; border: none;
      border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 0.95em;
    `;
    btnCancelar.addEventListener('click', () => {
      if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
      }
      overlay.remove();
      mostrarRondaEnProgreso();
    });
    buttonsDiv.appendChild(btnCancelar);

    container.appendChild(buttonsDiv);
    overlay.appendChild(container);
    document.body.appendChild(overlay);
  }

  // ===================== ABRIR CÁMARA PARA FOTO =====================
  // ===================== ABRIR CÁMARA PARA FOTO =====================
  async function abrirCamaraFoto(video, placeholder) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      video.srcObject = stream;
      video.style.display = 'block';
      if (placeholder) placeholder.style.display = 'none';
    } catch (e) {
      console.error('[Foto] Error:', e);
      alert('❌ Error al acceder a la cámara');
    }
  }

  // ===================== CAPTURAR FOTO =====================
  function capturarFoto(video, canvas, preview, placeholder) {
    if (!video.srcObject) {
      alert('❌ Abre la cámara primero');
      return;
    }

    // Esperar un poco para que el video esté completamente listo
    setTimeout(() => {
      const ctx = canvas.getContext('2d');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      // Dibujar el video en el canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Convertir a base64
      try {
        const base64 = canvas.toDataURL('image/jpeg', 0.9);
        canvas.dataset.fotoBase64 = base64;

        // Mostrar preview
        preview.src = base64;
        preview.style.display = 'block';
        video.style.display = 'none';
        if (placeholder) placeholder.style.display = 'none';

        // Cerrar stream
        if (video.srcObject) {
          video.srcObject.getTracks().forEach(track => track.stop());
        }

        console.log('[Foto] ✅ Foto capturada - tamaño:', canvas.width, 'x', canvas.height);
      } catch (e) {
        console.error('[Foto] Error capturando:', e);
        alert('❌ Error al capturar la foto');
      }
    }, 200);
  }

  // ===================== GUARDAR PUNTO CON RESPUESTAS =====================
  async function guardarPuntoConRespuestas(codigoQR, indice, punto, respuestas, fotoBase64) {
    try {
      rondaEnProgreso.puntosRegistrados[indice] = {
        nombre: punto.nombre,
        qrEscaneado: true,
        codigoQR: codigoQR,
        timestamp: firebase.firestore.Timestamp.now(),
        respuestas: respuestas,
        foto: fotoBase64
      };

      // ⚠️ GUARDAR INMEDIATAMENTE EN FIREBASE
      await db.collection('RONDAS_COMPLETADAS').doc(rondaIdActual).update({
        puntosRegistrados: rondaEnProgreso.puntosRegistrados,
        ultimaActualizacion: firebase.firestore.Timestamp.now()
      });

      // Actualizar cache local
      await RONDA_STORAGE.guardarEnCache(rondaIdActual, rondaEnProgreso);

      console.log('[Ronda] Punto completado:', indice, '- Guardado en Firebase');
    } catch (e) {
      console.error('[Ronda] Error guardando:', e);
      alert('Error guardando punto: ' + e.message);
    }
  }

  // ===================== GUARDAR PUNTO SIN PREGUNTAS =====================
  async function guardarPuntoEscaneado(codigoQR, indice, punto) {
    try {
      rondaEnProgreso.puntosRegistrados[indice] = {
        nombre: punto.nombre,
        qrEscaneado: true,
        codigoQR: codigoQR,
        timestamp: firebase.firestore.Timestamp.now(),
        respuestas: {},
        foto: null
      };

      // ⚠️ GUARDAR INMEDIATAMENTE EN FIREBASE
      await db.collection('RONDAS_COMPLETADAS').doc(rondaIdActual).update({
        puntosRegistrados: rondaEnProgreso.puntosRegistrados,
        ultimaActualizacion: firebase.firestore.Timestamp.now()
      });

      // Actualizar cache local
      await RONDA_STORAGE.guardarEnCache(rondaIdActual, rondaEnProgreso);

      console.log('[Ronda] Punto marcado:', indice, '- Guardado en Firebase');
    } catch (e) {
      console.error('[Ronda] Error registrando:', e);
      alert('Error: ' + e.message);
    }
  }

  // ===================== CRONÓMETRO =====================
  // ===================== CRONÓMETRO OPTIMIZADO =====================
  function iniciarCronometro() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    lastUpdateTime = Date.now();

    function actualizarCronometro() {
      const ahora = Date.now();
      // Solo actualizar pantalla cada 500ms (en lugar de cada 1000ms)
      if (ahora - lastUpdateTime >= 500) {
        const inicioMs = rondaEnProgreso.horarioInicio.toMillis ? 
          rondaEnProgreso.horarioInicio.toMillis() : 
          new Date(rondaEnProgreso.horarioInicio).getTime();
        const elapsedMs = ahora - inicioMs;

        const horas = Math.floor(elapsedMs / 3600000);
        const minutos = Math.floor((elapsedMs % 3600000) / 60000);
        const segundos = Math.floor((elapsedMs % 60000) / 1000);

        const display = `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;
        const elem = document.querySelector('#cronometro');
        if (elem) elem.textContent = display;

        verificarTolerancia(elapsedMs);
        lastUpdateTime = ahora;
      }
      animFrameId = requestAnimationFrame(actualizarCronometro);
    }

    animFrameId = requestAnimationFrame(actualizarCronometro);
  }

  // ===================== VERIFICAR TOLERANCIA =====================
  function verificarTolerancia(elapsedMs) {
    if (!rondaEnProgreso) return;

    const toleranciaMs = 
      rondaEnProgreso.toleranciaTipo === 'horas'
        ? rondaEnProgreso.tolerancia * 3600000
        : rondaEnProgreso.tolerancia * 60000;

    if (elapsedMs > toleranciaMs) {
      console.log('[Ronda] Tolerancia excedida, auto-terminando...');
      terminarRondaAuto();
    }
  }

  // ===================== CALCULAR HORARIO TÉRMINO =====================
  function calcularHorarioTermino() {
    const inicioMs = rondaEnProgreso.horarioInicio.toMillis ? 
      rondaEnProgreso.horarioInicio.toMillis() : 
      new Date(rondaEnProgreso.horarioInicio).getTime();
    
    const toleranciaMs = 
      rondaEnProgreso.toleranciaTipo === 'horas'
        ? rondaEnProgreso.tolerancia * 3600000
        : rondaEnProgreso.tolerancia * 60000;

    const terminoMs = inicioMs + toleranciaMs;
    return new Date(terminoMs);
  }

  // ===================== DETERMINAR ESTADO DE LA RONDA =====================
  function determinarEstadoRonda() {
    const puntosRegistrados = Object.values(rondaEnProgreso.puntosRegistrados);
    const escaneados = puntosRegistrados.filter(p => p.qrEscaneado).length;
    const totales = puntosRegistrados.length;

    if (escaneados === 0) {
      return 'NO_REALIZADA';
    } else if (escaneados < totales) {
      return 'INCOMPLETA';
    } else {
      return 'TERMINADA';
    }
  }

  // ===================== TERMINAR RONDA AUTOMÁTICA =====================
  async function terminarRondaAuto() {
    if (!rondaEnProgreso || !rondaIdActual) return;

    try {
      if (animFrameId) cancelAnimationFrame(animFrameId);

      const estado = determinarEstadoRonda();
      const horarioTermino = firebase.firestore.Timestamp.fromDate(calcularHorarioTermino());

      // Guardar estado final en Firebase
      await db.collection('RONDAS_COMPLETADAS').doc(rondaIdActual).update({
        estado: estado,
        horarioTermino: horarioTermino
      });

      // Limpiar cache
      await RONDA_STORAGE.limpiarCache(rondaIdActual);

      mostrarResumen(estado);
      rondaEnProgreso = null;
      rondaIdActual = null;

      setTimeout(() => {
        location.href = 'menu.html';
      }, 5000);
    } catch (e) {
      console.error('[Ronda] Error terminando:', e);
    }
  }

  // ===================== TERMINAR RONDA (MANUAL) =====================
  async function terminarRonda() {
    if (!rondaEnProgreso || !rondaIdActual) return;

    const overlay = mostrarOverlay('Terminando ronda...');

    try {
      if (animFrameId) cancelAnimationFrame(animFrameId);

      const estado = determinarEstadoRonda();
      const horarioTermino = firebase.firestore.Timestamp.now();

      // Guardar estado final en Firebase
      await db.collection('RONDAS_COMPLETADAS').doc(rondaIdActual).update({
        estado: estado,
        horarioTermino: horarioTermino
      });

      // Limpiar cache
      await RONDA_STORAGE.limpiarCache(rondaIdActual);

      ocultarOverlay();
      mostrarResumen(estado);
      rondaEnProgreso = null;
      rondaIdActual = null;

      setTimeout(() => {
        location.href = 'menu.html';
      }, 5000);
    } catch (e) {
      console.error('[Ronda] Error terminando:', e);
      ocultarOverlay();
      alert('Error: ' + e.message);
    }
  }

  // ===================== MOSTRAR RESUMEN =====================
  function mostrarResumen(estado) {
    const listDiv = document.getElementById('rondas-list');
    if (!listDiv || !rondaEnProgreso) return;

    const puntosRegistrados = Object.values(rondaEnProgreso.puntosRegistrados);
    const marcados = puntosRegistrados.filter(p => p.qrEscaneado).length;
    const totales = puntosRegistrados.length;
    const noMarcados = puntosRegistrados.filter(p => !p.qrEscaneado);

    let estadoTexto = '';
    let estadoColor = '';
    let estadoIcono = '';

    if (estado === 'TERMINADA') {
      estadoTexto = 'Ronda Completada';
      estadoColor = '#10b981';
      estadoIcono = '✅';
    } else if (estado === 'INCOMPLETA') {
      estadoTexto = 'Ronda Incompleta';
      estadoColor = '#f97316';
      estadoIcono = '⚠️';
    } else if (estado === 'NO_REALIZADA') {
      estadoTexto = 'Ronda No Realizada';
      estadoColor = '#ef4444';
      estadoIcono = '❌';
    }

    let resumenHTML = `
      <div style="background: #1a1a1a; border: 1px solid #444; border-radius: 8px; padding: 30px; text-align: center;">
        <h2 style="color: ${estadoColor}; margin: 0;">
          ${estadoIcono} ${estadoTexto}
        </h2>
        <div style="font-size: 2em; color: #fff; margin: 20px 0; font-weight: bold;">
          ${marcados} / ${totales} Puntos Escaneados
        </div>
        <div style="background: #222; border-radius: 4px; padding: 12px; margin: 15px 0; color: #ccc; font-size: 0.9em;">
          Estado: <strong style="color: ${estadoColor};">${estado}</strong>
        </div>
    `;

    if (noMarcados.length > 0) {
      resumenHTML += `
        <div style="background: #3f2020; border: 1px solid #ef4444; border-radius: 4px; padding: 15px; margin: 20px 0; text-align: left;">
          <strong style="color: #ef4444; display: block; margin-bottom: 10px;">❌ Puntos NO escaneados:</strong>
          <ul style="margin: 0; padding-left: 20px; color: #ccc;">
      `;
      noMarcados.forEach(p => {
        resumenHTML += `<li>${p.nombre}</li>`;
      });
      resumenHTML += `
          </ul>
        </div>
      `;
    }

    resumenHTML += `
        <div style="color: #ccc; margin: 20px 0;">
          Redirigiendo a menú en 5 segundos...
        </div>
      </div>
    `;

    listDiv.innerHTML = resumenHTML;
  }

  // ===================== MOSTRAR MODAL DE SELECCIÓN DE TIPO DE RONDA =====================
  function mostrarModalTipoRonda() {
    const modal = document.getElementById('modal-tipo-ronda');
    if (modal) modal.style.display = 'flex';
  }

  function cerrarModalTipoRonda() {
    const modal = document.getElementById('modal-tipo-ronda');
    if (modal) modal.style.display = 'none';
  }

  // ===================== INICIAR RONDA MANUAL =====================
  function iniciarRondaManual() {
    cerrarModalTipoRonda();
    rondaManualEnProgreso = true;
    abrirScannerRondaManual();
  }

  // ===================== ABRIR SCANNER PARA RONDA MANUAL =====================
  function abrirScannerRondaManual() {
    if (scannerActivo) return;
    scannerActivo = true;

    const modal = document.createElement('div');
    modal.id = 'modal-ronda-manual-scanner';
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.95); display: flex; flex-direction: column;
      align-items: center; justify-content: center; z-index: 1000;
    `;

    modal.innerHTML = `
      <div style="color: white; text-align: center; margin-bottom: 20px;">
        <h2 style="margin: 0;">Escanear QR - Ronda Manual</h2>
        <p style="margin: 10px 0 0 0; color: #ccc;">Apunta la cámara al código QR</p>
      </div>
      <video id="manual-scanner-video" autoplay playsinline style="width: 80%; max-width: 500px; border: 2px solid #ef4444; border-radius: 8px;"></video>
      <div style="display: flex; gap: 10px; margin-top: 20px;">
        <button id="retry-manual-scanner" style="
          background: #3b82f6; color: white; border: none; padding: 10px 20px;
          border-radius: 4px; cursor: pointer; font-weight: 600;
        ">Reintentar</button>
        <button id="close-manual-scanner" style="
          background: #666; color: white; border: none; padding: 10px 20px;
          border-radius: 4px; cursor: pointer; font-weight: 600;
        ">Cancelar</button>
      </div>
    `;

    document.body.appendChild(modal);

    iniciarVideoQRManual(modal);

    modal.querySelector('#close-manual-scanner').addEventListener('click', () => {
      detenerVideoQR(modal);
      scannerActivo = false;
      rondaManualEnProgreso = false;
      if (modal && modal.parentNode) modal.remove();
      mostrarModalTipoRonda();
    });

    modal.querySelector('#retry-manual-scanner').addEventListener('click', () => {
      detenerVideoQR(modal);
      const video = modal.querySelector('#manual-scanner-video');
      iniciarVideoQRManual(modal);
    });
  }

  // ===================== INICIAR VIDEO QR PARA RONDA MANUAL =====================
  async function iniciarVideoQRManual(modal) {
    try {
      const video = modal.querySelector('#manual-scanner-video');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      // NO llamar a video.play() - ZXing lo maneja automáticamente

      // Detener cualquier lector anterior
      if (codeReaderInstance) {
        try {
          codeReaderInstance.reset();
        } catch (e) {}
      }

      const codeReader = new ZXing.BrowserMultiFormatReader();
      codeReaderInstance = codeReader;

      codeReader.decodeFromVideoDevice(undefined, video, (result, err) => {
        if (result) {
          procesarQRManual(result.getText(), modal);
        }
      });
    } catch (e) {
      console.error('[QR Manual] Error:', e);
      alert('❌ Error de cámara: ' + e.message);
      scannerActivo = false;
      rondaManualEnProgreso = false;
      if (modal && modal.parentNode) modal.remove();
    }
  }

  // ===================== OBTENER TODAS LAS RONDAS SIN LIMITE =====================
  async function obtenerTodasLasRondas() {
    const todasRondas = [];
    let ultimoDoc = null;
    const PAGE_SIZE = 100;

    while (true) {
      let query = db.collection('Rondas_QR').orderBy('__name__').limit(PAGE_SIZE);
      
      if (ultimoDoc) {
        query = query.startAfter(ultimoDoc);
      }

      const snapshot = await query.get();
      
      if (snapshot.empty) {
        break; // No hay más documentos
      }

      snapshot.forEach(doc => {
        todasRondas.push({ id: doc.id, data: doc.data() });
      });

      ultimoDoc = snapshot.docs[snapshot.docs.length - 1];

      if (snapshot.docs.length < PAGE_SIZE) {
        break; // Es la última página
      }
    }

    return todasRondas;
  }

  // ===================== OBTENER TODOS LOS QR CODES SIN LIMITE =====================
  async function obtenerTodosLosQRCodes() {
    const todosQRs = [];
    let ultimoDoc = null;
    const PAGE_SIZE = 100;

    while (true) {
      let query = db.collection('QR_CODES').orderBy('__name__').limit(PAGE_SIZE);
      
      if (ultimoDoc) {
        query = query.startAfter(ultimoDoc);
      }

      const snapshot = await query.get();
      
      if (snapshot.empty) {
        break; // No hay más documentos
      }

      snapshot.forEach(doc => {
        todosQRs.push({ id: doc.id, data: doc.data() });
      });

      ultimoDoc = snapshot.docs[snapshot.docs.length - 1];

      if (snapshot.docs.length < PAGE_SIZE) {
        break; // Es la última página
      }
    }

    return todosQRs;
  }

  // ===================== PROCESAR QR PARA RONDA MANUAL =====================
  async function procesarQRManual(codigoQR, modal) {
    try {
      console.log('[QR Manual] Procesando:', codigoQR);
      console.log('[QR Manual] Usuario contexto:', userCtx);

      // Detener el video
      detenerVideoQR(modal);

      const overlay = mostrarOverlay('Buscando QR en la base de datos...');

      // Obtener TODOS los QR_CODES sin límite
      const todosQRs = await obtenerTodosLosQRCodes();
      let qrEncontrado = null;
      
      console.log('[QR Manual] 📊 Total de QR_CODES en BD:', todosQRs.length);
      console.log('[QR Manual] 🔍 Comenzando búsqueda de QR...');
      console.log('[QR Manual] Buscando QR:', codigoQR.trim());
      console.log('[QR Manual] Usuario - Cliente:', userCtx.cliente, '| Unidad:', userCtx.unidad);
      console.log('[QR Manual] ⚠️ BUSCANDO EN COLECCIÓN QR_CODES');

      let qrsRevisados = 0;
      let datosDebug = [];
      
      todosQRs.forEach((doc, idx) => {
        const qrData = doc.data;
        qrsRevisados++;
        
        const qrId = doc.id;
        const qrLeido = codigoQR.trim();
        
        console.log(`\n[QR Manual] 📍 QR ${idx + 1}/${todosQRs.length} - ID: ${qrId}`);
        console.log(`  Datos: ${JSON.stringify(qrData).substring(0, 100)}...`);
        console.log(`  Comparando: "${qrLeido}" === "${qrId}" ? ${qrLeido === qrId}`);
        
        // Guardar debug de TODOS los QRs encontrados
        datosDebug.push({
          qrId: qrId,
          coincide: qrLeido === qrId,
          datos: qrData
        });
        
        if (qrLeido === qrId) {
          console.log('      ✅ ✅ ✅ QR COINCIDE!!! ✅ ✅ ✅');
          qrEncontrado = {
            qrId: qrId,
            nombre: qrData.nombre || qrData.name || qrData.nombrePunto || qrId,
            punto: qrData,
            cliente: qrData.cliente || userCtx.cliente,
            unidad: qrData.unidad || userCtx.unidad
          };
        }
      });

      console.log(`\n[QR Manual] 📊 Resumen de búsqueda:`);
      console.log(`  - Total de QR_CODES en BD: ${todosQRs.length}`);
      console.log(`  - QR_CODES revisados: ${qrsRevisados}`);

      ocultarOverlay();

      if (!qrEncontrado) {
        console.error('\n❌ [QR Manual] QR NO ENCONTRADO EN QR_CODES');
        console.error('[QR Manual] Se buscó el QR:', codigoQR.trim());
        console.error('[QR Manual] Total de QR_CODES revisados: ' + qrsRevisados);
        
        // Mostrar TODOS los QRs que existen para debugging
        console.error('\n[QR Manual] 📋 TODOS LOS QR_CODES EN LA BD:');
        datosDebug.forEach((item, i) => {
          console.error(`  ${i + 1}. QR ID: "${item.qrId}" | Coincide: ${item.coincide}`);
        });
        
        mostrarErrorQRManual(modal);
        return;
      }
      
      console.log('\n✅ [QR Manual] PUNTO ENCONTRADO:', qrEncontrado.nombre);
      
      // Buscar si tiene preguntas/datos adicionales
      const tienePreguntas = qrEncontrado.punto && qrEncontrado.punto.questions && Object.keys(qrEncontrado.punto.questions).length > 0;

      if (tienePreguntas) {
        if (modal) modal.remove();
        scannerActivo = false;
        mostrarFormularioRondaManualQR(codigoQR, qrEncontrado);
      } else {
        const overlay = mostrarOverlay('Guardando registro...');
        await guardarRegistroRondaManualQR(qrEncontrado, {}, null);
        ocultarOverlay();
        if (modal) modal.remove();
        scannerActivo = false;
        mostrarResumenRondaManual(qrEncontrado.nombre);
      }
    } catch (e) {
      console.error('[Ronda Manual] Error procesando:', e);
      alert('Error: ' + e.message);
      scannerActivo = false;
      rondaManualEnProgreso = false;
    }
  }

  // ===================== MOSTRAR ERROR QR PARA RONDA MANUAL =====================
  function mostrarErrorQRManual(modal) {
    const errorOverlay = document.createElement('div');
    errorOverlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.85); display: flex; align-items: center;
      justify-content: center; z-index: 2000;
    `;

    const errorBox = document.createElement('div');
    errorBox.style.cssText = `
      background: #1a1a1a; border: 2px solid #ef4444; border-radius: 12px;
      padding: 40px; text-align: center; max-width: 350px;
      box-shadow: 0 10px 40px rgba(239, 68, 68, 0.3);
    `;

    errorBox.innerHTML = `
      <div style="font-size: 3em; margin-bottom: 20px;">❌</div>
      <h2 style="color: #ef4444; margin: 0 0 15px 0; font-size: 1.3em;">Código QR No Válido</h2>
      <p style="color: #ccc; margin: 0; font-size: 0.95em;">Este QR no está registrado en tu cliente/unidad o no existe en el sistema.</p>
      <button id="retry-qr-manual" style="
        background: #ef4444; color: white; border: none; padding: 12px 30px;
        border-radius: 6px; cursor: pointer; margin-top: 25px; font-weight: 600;
        font-size: 0.95em;
      ">Reintentar</button>
    `;

    errorOverlay.appendChild(errorBox);
    document.body.appendChild(errorOverlay);

    errorBox.querySelector('#retry-qr-manual').addEventListener('click', () => {
      errorOverlay.remove();
      scannerActivo = false;
      // Reiniciar video del scanner
      if (modal && modal.parentNode) {
        const video = modal.querySelector('#manual-scanner-video');
        if (video && video.srcObject) {
          video.srcObject.getTracks().forEach(track => track.stop());
        }
        iniciarVideoQRManual(modal);
      }
    });
  }

  // ===================== MOSTRAR FORMULARIO PARA RONDA MANUAL - QR_CODES =====================
  function mostrarFormularioRondaManualQR(codigoQR, qrEncontrado) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.95); display: flex; flex-direction: column;
      align-items: center; justify-content: center; z-index: 1001; overflow-y: auto;
      padding: 20px 0;
    `;

    const container = document.createElement('div');
    container.style.cssText = `
      background: #1a1a1a; border: 1px solid #444; border-radius: 8px;
      padding: 25px; max-width: 500px; width: 90%; margin: auto;
      color: white;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `margin-bottom: 25px;`;
    header.innerHTML = `
      <h2 style="margin: 0; color: #fff; font-size: 1.3em;">${qrEncontrado.nombre}</h2>
      <p style="margin: 8px 0 0 0; color: #ccc; font-size: 0.9em;">📝 Registrar punto</p>
    `;
    container.appendChild(header);

    // Sección de Foto
    const fotoDiv = document.createElement('div');
    fotoDiv.style.cssText = `margin-top: 20px; padding-top: 20px; border-top: 1px solid #444;`;
    
    const fotoLabel = document.createElement('label');
    fotoLabel.style.cssText = `display: block; margin-bottom: 12px; color: #fff; font-weight: 500; font-size: 0.95em;`;
    fotoLabel.textContent = '📷 Tomar Foto (Opcional)';
    fotoDiv.appendChild(fotoLabel);

    const fotoContainer = document.createElement('div');
    fotoContainer.style.cssText = `
      background: #222; border: 1px solid #444; border-radius: 4px; 
      padding: 12px; margin-bottom: 12px; min-height: 200px; display: flex;
      align-items: center; justify-content: center;
    `;
    
    const video = document.createElement('video');
    video.id = 'foto-video-manual-qr';
    video.style.cssText = `width: 100%; border-radius: 4px; display: none; max-height: 250px; object-fit: cover;`;
    video.autoplay = true;
    video.playsInline = true;
    fotoContainer.appendChild(video);

    const canvas = document.createElement('canvas');
    canvas.id = 'foto-canvas-manual-qr';
    canvas.style.cssText = `width: 100%; border-radius: 4px; display: none;`;
    canvas.style.maxHeight = '250px';
    fotoContainer.appendChild(canvas);

    const preview = document.createElement('img');
    preview.id = 'foto-preview-manual-qr';
    preview.style.cssText = `width: 100%; border-radius: 4px; display: none; max-height: 250px; object-fit: cover;`;
    fotoContainer.appendChild(preview);

    const placeholder = document.createElement('div');
    placeholder.style.cssText = `color: #999; font-size: 0.9em; text-align: center;`;
    placeholder.textContent = 'Sin foto capturada';
    placeholder.id = 'foto-placeholder-manual-qr';
    fotoContainer.appendChild(placeholder);

    fotoDiv.appendChild(fotoContainer);

    const fotoButtonsDiv = document.createElement('div');
    fotoButtonsDiv.style.cssText = `display: flex; gap: 8px; margin-bottom: 12px;`;

    const btnAbrirCamara = document.createElement('button');
    btnAbrirCamara.textContent = 'Abrir Cámara';
    btnAbrirCamara.style.cssText = `
      flex: 1; padding: 10px; background: #3b82f6; color: white; border: none;
      border-radius: 4px; cursor: pointer; font-weight: 500; font-size: 0.9em;
    `;
    btnAbrirCamara.addEventListener('click', () => {
      abrirCamaraFoto(video, placeholder);
    });
    fotoButtonsDiv.appendChild(btnAbrirCamara);

    const btnCapturar = document.createElement('button');
    btnCapturar.textContent = 'Capturar';
    btnCapturar.style.cssText = `
      flex: 1; padding: 10px; background: #ef4444; color: white; border: none;
      border-radius: 4px; cursor: pointer; font-weight: 500; font-size: 0.9em;
    `;
    btnCapturar.addEventListener('click', () => {
      capturarFoto(video, canvas, preview, placeholder);
    });
    fotoButtonsDiv.appendChild(btnCapturar);

    fotoDiv.appendChild(fotoButtonsDiv);
    container.appendChild(fotoDiv);

    // Botones de Acción
    const buttonsDiv = document.createElement('div');
    buttonsDiv.style.cssText = `display: flex; gap: 10px; margin-top: 25px;`;

    const btnGuardar = document.createElement('button');
    btnGuardar.textContent = 'Guardar';
    btnGuardar.style.cssText = `
      flex: 1; padding: 12px; background: #10b981; color: white; border: none;
      border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 0.95em;
    `;
    btnGuardar.addEventListener('click', async () => {
      const loadingOverlay = mostrarOverlay('Guardando registro...');
      try {
        const fotoBase64 = canvas.dataset.fotoBase64 || null;
        await guardarRegistroRondaManualQR(qrEncontrado, {}, fotoBase64);
        ocultarOverlay();
        overlay.remove();
        mostrarResumenRondaManual(qrEncontrado.nombre);
      } catch (e) {
        ocultarOverlay();
        console.error('[Foto Manual QR] Error:', e);
      }
    });
    buttonsDiv.appendChild(btnGuardar);

    const btnCancelar = document.createElement('button');
    btnCancelar.textContent = 'Cancelar';
    btnCancelar.style.cssText = `
      flex: 1; padding: 12px; background: #666; color: white; border: none;
      border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 0.95em;
    `;
    btnCancelar.addEventListener('click', () => {
      if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
      }
      overlay.remove();
      mostrarModalTipoRonda();
    });
    buttonsDiv.appendChild(btnCancelar);

    container.appendChild(buttonsDiv);
    overlay.appendChild(container);
    document.body.appendChild(overlay);
  }

  // ===================== GUARDAR REGISTRO RONDA MANUAL - QR_CODES =====================
  async function guardarRegistroRondaManualQR(qrEncontrado, respuestas, fotoBase64) {
    try {
      const ahora = new Date();
      const fechaHora = ahora.toLocaleString('es-ES', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      // Obtener nombre completo del documento USUARIOS
      let nombreCompleto = userCtx.userId; // Fallback si no encuentra
      try {
        const usuarioDoc = await db.collection('USUARIOS').doc(userCtx.userId).get();
        if (usuarioDoc.exists) {
          const datos = usuarioDoc.data();
          const nombres = (datos.NOMBRES || '').trim();
          const apellidos = (datos.APELLIDOS || '').trim();
          nombreCompleto = `${nombres} ${apellidos}`.trim();
          
          console.log('[Ronda Manual QR] Nombre encontrado:', nombreCompleto);
        }
      } catch (e) {
        console.warn('[Ronda Manual QR] No se pudo obtener nombre completo:', e);
        // Continuar con el userId como fallback
      }

      const registro = {
        usuario: nombreCompleto,
        usuarioEmail: currentUser.email,
        cliente: qrEncontrado.cliente,
        unidad: qrEncontrado.unidad,
        puesto: userCtx.puesto,
        nombrePunto: qrEncontrado.nombre,
        qrId: qrEncontrado.qrId,
        respuestas: respuestas,
        foto: fotoBase64,
        fechaHora: fechaHora,
        timestamp: firebase.firestore.Timestamp.now(),
        tipo: 'ronda_manual_qr'
      };

      await db.collection('RONDA_MANUAL').add(registro);

      console.log('[Ronda Manual QR] Registro guardado:', registro);
    } catch (e) {
      console.error('[Ronda Manual QR] Error guardando:', e);
      alert('Error: ' + e.message);
    }
  }

  // ===================== MOSTRAR RESUMEN RONDA MANUAL =====================
  function mostrarResumenRondaManual(nombrePunto) {
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.95); display: flex; align-items: center;
      justify-content: center; z-index: 1002;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
      background: #1a1a1a; border: 2px solid #10b981; border-radius: 12px;
      padding: 40px; text-align: center; max-width: 350px;
      box-shadow: 0 10px 40px rgba(16, 185, 129, 0.3);
    `;

    content.innerHTML = `
      <div style="font-size: 3em; margin-bottom: 20px;">✅</div>
      <h2 style="color: #10b981; margin: 0 0 15px 0; font-size: 1.3em;">Punto Registrado</h2>
      <p style="color: #ccc; margin: 0 0 20px 0; font-size: 0.95em;">
        Se ha guardado el registro de <strong>${nombrePunto}</strong>
      </p>
      <button id="continuar-ronda-manual" style="
        background: #10b981; color: white; border: none; padding: 12px 30px;
        border-radius: 6px; cursor: pointer; margin-top: 15px; font-weight: 600;
        font-size: 0.95em; width: 100%;
      ">Escanear Otro QR</button>
      <button id="terminar-ronda-manual" style="
        background: #3b82f6; color: white; border: none; padding: 12px 30px;
        border-radius: 6px; cursor: pointer; margin-top: 10px; font-weight: 600;
        font-size: 0.95em; width: 100%;
      ">Volver al Menú</button>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    content.querySelector('#continuar-ronda-manual').addEventListener('click', () => {
      modal.remove();
      abrirScannerRondaManual();
    });

    content.querySelector('#terminar-ronda-manual').addEventListener('click', () => {
      modal.remove();
      rondaManualEnProgreso = false;
      location.href = 'menu.html';
    });
  }

  // ===================== MANEJADORES DE EVENTOS DEL MODAL =====================
  const btnRondaProgramada = document.getElementById('btn-ronda-programada');
  const btnRondaManual = document.getElementById('btn-ronda-manual');
  const btnCerrarModal = document.getElementById('btn-cerrar-modal');

  if (btnRondaProgramada) {
    btnRondaProgramada.addEventListener('click', () => {
      cerrarModalTipoRonda();
      tipoRondaSeleccionado = 'programada';
      cargarRondas();
    });
  }

  if (btnRondaManual) {
    btnRondaManual.addEventListener('click', () => {
      tipoRondaSeleccionado = 'manual';
      iniciarRondaManual();
    });
  }

  if (btnCerrarModal) {
    btnCerrarModal.addEventListener('click', () => {
      cerrarModalTipoRonda();
      location.href = 'menu.html';
    });
  }

  // Mostrar modal al cargar la página (dentro de DOMContentLoaded)
  mostrarModalTipoRonda();
});
