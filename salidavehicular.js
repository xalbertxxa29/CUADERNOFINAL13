// salidavehicular.js (v69) - Salida Vehicular
// Patrón idéntico a peatonal.js para consistencia
document.addEventListener('DOMContentLoaded', () => {
  // Firebase ya debe estar inicializado por initFirebase.js
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

  let currentUser = null;
  let userData = null;
  let vehiculosData = {}; // Almacenar datos para modal

  // Estado de sesión
  let userCtx = { email: '', uid: '', cliente: '', unidad: '', puesto: '', nombreCompleto: '' };

  // Obtener usuario autenticado y sus datos
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = 'index.html';
      return;
    }

    currentUser = user;
    userCtx.email = user.email;
    userCtx.uid = user.uid;

    // Obtener datos del usuario desde offline storage primero
    try {
      if (window.OfflineStorage) {
        userData = await window.OfflineStorage.getUserData();
        if (userData && userData.cliente && userData.unidad && userData.puesto) {
          userCtx.cliente = userData.cliente;
          userCtx.unidad = userData.unidad;
          userCtx.puesto = userData.puesto;
          console.log('✓ Datos del usuario obtenidos de OfflineStorage');
          cargarVehiculos();
          return;
        }
      }
    } catch (e) {
      console.warn('No se pudo cargar datos de OfflineStorage:', e.message);
    }

    // Si no están en offline storage, obtener de Firestore
    try {
      const userId = user.email.split('@')[0];
      const snap = await db.collection('USUARIOS').doc(userId).get();
      
      if (snap.exists) {
        const datos = snap.data();
        userCtx.cliente = datos.CLIENTE || datos.cliente || '';
        userCtx.unidad = datos.UNIDAD || datos.unidad || '';
        userCtx.puesto = datos.PUESTO || datos.puesto || '';
        // v73: Guardar nombre completo
        userCtx.nombreCompleto = `${datos.NOMBRES || ''} ${datos.APELLIDOS || ''}`.trim().toUpperCase();
        
        console.log('✓ Datos del usuario obtenidos de Firestore', userCtx);
        
        // Guardar en offline storage para próxima vez
        if (window.OfflineStorage && userCtx.cliente && userCtx.unidad) {
          try {
            await window.OfflineStorage.setUserData({
              email: user.email,
              userId: userId,
              nombres: datos.NOMBRES || datos.nombres || '',
              apellidos: datos.APELLIDOS || datos.apellidos || '',
              cliente: userCtx.cliente,
              unidad: userCtx.unidad,
              puesto: userCtx.puesto
            });
          } catch (e) {
            console.warn('No se pudo guardar en OfflineStorage:', e.message);
          }
        }
        
        cargarVehiculos();
      } else {
        console.warn('Perfil de usuario no encontrado en Firestore');
        document.getElementById('vehiculos-list').innerHTML = '<p style="color:red;">Perfil de usuario no configurado</p>';
      }
    } catch (e) {
      console.error('Error obteniendo datos del usuario:', e);
      document.getElementById('vehiculos-list').innerHTML = '<p style="color:red;">Error al cargar datos del usuario</p>';
    }
  });

  // Cargar vehículos
  async function cargarVehiculos() {
    console.log('🚗 Iniciando carga de vehículos con:', userCtx);
    
    if (!userCtx.cliente || !userCtx.unidad || !userCtx.puesto) {
      const listDiv = document.getElementById('vehiculos-list');
      const msg = `Faltan datos: cliente=${userCtx.cliente}, unidad=${userCtx.unidad}, puesto=${userCtx.puesto}`;
      console.warn('⚠️', msg);
      listDiv.innerHTML = `<p style="text-align:center; padding:20px; color:red;">${msg}</p>`;
      return;
    }

    const listDiv = document.getElementById('vehiculos-list');
    listDiv.innerHTML = '<p style="text-align:center; padding:20px;">Cargando...</p>';

    try {
      const query = db.collection('ACCESO_VEHICULAR')
        .where('cliente', '==', userCtx.cliente)
        .where('unidad', '==', userCtx.unidad)
        .where('puesto', '==', userCtx.puesto)
        .where('estado', '==', 'ingreso');

      console.log('📋 Ejecutando query con filtros:', {
        cliente: userCtx.cliente,
        unidad: userCtx.unidad,
        puesto: userCtx.puesto,
        estado: 'ingreso'
      });

      const snapshot = await query.get();

      console.log('📊 Query result:', snapshot.size, 'documentos encontrados');

      if (snapshot.empty) {
        listDiv.innerHTML = '<p style="text-align:center; padding:20px; color:#999;">No hay vehículos registrados para salida</p>';
        return;
      }

      listDiv.innerHTML = '';
      snapshot.forEach(doc => {
        const data = doc.data();
        vehiculosData[doc.id] = { docId: doc.id, ...data };

        const card = document.createElement('div');
        card.className = 'vehiculo-card';
        card.innerHTML = `
          <div class="vehiculo-info">
            <div style="margin-bottom:10px;">
              <strong>Placa:</strong> ${data.placa || 'N/A'}
            </div>
            <div style="margin-bottom:10px;">
              <strong>Marca:</strong> ${data.marca || 'N/A'} - <strong>Modelo:</strong> ${data.modelo || 'N/A'}
            </div>
            <div style="margin-bottom:10px;">
              <strong>Color:</strong> ${data.color || 'N/A'}
            </div>
            <div style="margin-bottom:10px;">
              <strong>DNI:</strong> ${data.dni || 'N/A'} - <strong>Nombre:</strong> ${data.nombres || 'N/A'}
            </div>
            ${data.observaciones ? `<div style="margin-bottom:10px;"><strong>Observaciones:</strong> ${data.observaciones}</div>` : ''}
            <div style="margin-bottom:10px; font-size:0.9em; color:#999;">
              Ingreso: ${new Date(data.fechaIngreso).toLocaleString('es-ES')}
            </div>
          </div>
          <button class="btn-dar-salida" data-doc-id="${doc.id}">
            Dar Salida
          </button>
        `;
        listDiv.appendChild(card);
      });

      console.log('✓ Se cargaron', snapshot.size, 'vehículos');

      // Agregar event listeners a botones
      document.querySelectorAll('.btn-dar-salida').forEach(btn => {
        btn.addEventListener('click', abrirModalSalida);
      });

    } catch (error) {
      console.error('❌ Error cargando vehículos:', error);
      listDiv.innerHTML = `<p style="text-align:center; color:red; padding:20px;">Error: ${error.message}</p>`;
    }
  }

  // Modal Salida
  function abrirModalSalida(e) {
    const docId = e.target.dataset.docId;
    const vehiculo = vehiculosData[docId];

    if (!vehiculo) return;

    // Mostrar datos en el modal
    document.getElementById('modal-placa').textContent = vehiculo.placa || 'N/A';
    document.getElementById('modal-marca-modelo').textContent = `${vehiculo.marca || 'N/A'} ${vehiculo.modelo || 'N/A'}`;
    document.getElementById('modal-dni-nombre').textContent = `${vehiculo.dni || 'N/A'} - ${vehiculo.nombres || 'N/A'}`;
    
    // Mostrar imagen si existe
    const imgElement = document.getElementById('modal-foto');
    const imgTextElement = document.getElementById('modal-foto-text');
    
    if (vehiculo.fotoURL && vehiculo.fotoURL.trim()) {
      imgElement.src = vehiculo.fotoURL;
      imgElement.style.display = 'block';
      imgTextElement.style.display = 'none';
      // Manejo de error de imagen
      imgElement.onerror = () => {
        imgElement.style.display = 'none';
        imgTextElement.style.display = 'block';
        imgTextElement.textContent = 'No se pudo cargar la imagen';
      };
    } else {
      imgElement.style.display = 'none';
      imgTextElement.style.display = 'block';
      imgTextElement.textContent = 'Sin foto disponible';
    }
    
    document.getElementById('comentario-salida').value = '';
    
    // Mostrar modal
    const modal = document.getElementById('modal-salida');
    modal.style.display = 'flex';

    // Botón Cancelar
    document.getElementById('btn-cancelar-salida').onclick = () => {
      modal.style.display = 'none';
    };

    // Botón Dar Salida
    document.getElementById('btn-confirmar-salida').onclick = async () => {
      await guardarSalida(docId);
      modal.style.display = 'none';
      cargarVehiculos(); // Recargar lista
    };
  }

  // Guardar salida
  async function guardarSalida(docId) {
    const comentario = document.getElementById('comentario-salida').value.trim();

    if (UI?.showOverlay) UI.showOverlay('Registrando salida...');

    try {
      await db.collection('ACCESO_VEHICULAR').doc(docId).update({
        estado: 'salida',
        fechaSalida: firebase.firestore.FieldValue.serverTimestamp(),
        comentarioSalida: comentario,
        // v73: Guardar nombre completo del usuario de salida
        usuarioSalida: userCtx.nombreCompleto,
        usuarioSalidaEmail: currentUser.email,
        usuarioSalidaUid: currentUser.uid
      });

      if (UI?.hideOverlay) UI.hideOverlay();

      if (UI?.alert) {
        UI.alert('Éxito', 'Salida registrada correctamente.');
      } else {
        alert('Salida registrada correctamente');
      }
    } catch (error) {
      if (UI?.hideOverlay) UI.hideOverlay();
      console.error('Error guardando salida:', error);
      if (UI?.alert) {
        UI.alert('Error', 'No fue posible registrar la salida: ' + error.message);
      } else {
        alert('Error: ' + error.message);
      }
    }
  }

  // Botón Atrás
  document.getElementById('btn-atras')?.addEventListener('click', () => {
    window.location.href = 'menu.html';
  });
});
