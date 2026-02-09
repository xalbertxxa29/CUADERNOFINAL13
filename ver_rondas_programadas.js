document.addEventListener('DOMContentLoaded', async () => {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const db = firebase.firestore();

    const resultsList = document.getElementById('results-list');
    const btnSearch = document.getElementById('btn-search');
    const btnClear = document.getElementById('btn-clear');
    const filterDateInput = document.getElementById('filter-date');
    const loadMoreContainer = document.getElementById('load-more-container');
    const btnLoadMore = document.getElementById('btn-load-more');

    let lastDoc = null;
    let isFilterActive = false;
    let userCliente = '';
    let userUnidad = '';
    const LIMIT = 20;

    // 1. Autenticación y Obtención de Perfil
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            window.location.href = 'index.html';
            return;
        }
        const userId = user.email.split('@')[0];
        try {
            const doc = await db.collection('USUARIOS').doc(userId).get();
            if (doc.exists) {
                const data = doc.data();
                userCliente = (data.CLIENTE || '').toUpperCase();
                userUnidad = (data.UNIDAD || '').toUpperCase();

                cargarRegistros();
            } else {
                resultsList.innerHTML = '<div class="info-msg">No se encontró perfil de usuario.</div>';
            }
        } catch (e) {
            console.error("Error al obtener perfil usuario:", e);
            resultsList.innerHTML = `<div class="info-msg">Error al cargar perfil: ${e.message}</div>`;
        }
    });

    // Variables globales para reporte
    let allLoadedData = [];

    // 2. Cargar Registros
    async function cargarRegistros(isNextPage = false) {
        if (!isNextPage) {
            resultsList.innerHTML = '<div class="info-msg">Cargando...</div>';
            lastDoc = null;
            loadMoreContainer.style.display = 'none';
            allLoadedData = []; // Reset on new search
        }

        try {
            let query = db.collection('RONDAS_COMPLETADAS');

            // Filtros obligatorios por Cliente y Unidad (claves minúscula según instrucciones, valores mayúscula)
            query = query.where('cliente', '==', userCliente)
                .where('unidad', '==', userUnidad);

            // Filtro por fecha (usando horarioInicio)
            const dateVal = filterDateInput.value;
            if (dateVal) {
                // Rango de fecha
                const start = new Date(dateVal + 'T00:00:00');
                const end = new Date(dateVal + 'T23:59:59');
                query = query.where('horarioInicio', '>=', start)
                    .where('horarioInicio', '<=', end);
                // Ordenar
                query = query.orderBy('horarioInicio', 'desc');
            } else {
                // Orden por defecto
                query = query.orderBy('horarioInicio', 'desc');
            }

            // Paginación
            if (isNextPage && lastDoc) {
                query = query.startAfter(lastDoc);
            }
            query = query.limit(LIMIT);

            const snapshot = await query.get();

            if (!isNextPage) {
                resultsList.innerHTML = '';
            }

            if (snapshot.empty) {
                if (!isNextPage) {
                    resultsList.innerHTML = '<div class="info-msg">No se encontraron rondas programadas.</div>';
                } else {
                    loadMoreContainer.style.display = 'none';
                }
                return;
            }

            lastDoc = snapshot.docs[snapshot.docs.length - 1];

            snapshot.forEach(doc => {
                const data = doc.data();
                allLoadedData.push(data); // Store for report
                const card = crearCard(data);
                resultsList.appendChild(card);
            });

            if (snapshot.docs.length === LIMIT) {
                loadMoreContainer.style.display = 'block';
            } else {
                loadMoreContainer.style.display = 'none';
            }

        } catch (error) {
            console.error("Error cargando rondas programadas:", error);
            let msg = error.message;
            if (msg.includes("requires an index")) {
                msg = "Falta índice en Firestore. Revisa la consola para el link de creación.";
            }
            if (!isNextPage) {
                resultsList.innerHTML = `<div class="info-msg" style="color:salmon;">Error: ${msg}</div>`;
            } else {
                alert("Error cargando más: " + msg);
            }
        }
    }

    // ... (rest of crearCard and helper functions remain same, update btnGeneralReport listener)

    // 3. Renderizar Card
    function crearCard(data) {
        const div = document.createElement('div');
        div.className = 'list-card';

        // Campos: nombre, estado, unidad, horarioInicio
        const nombre = data.nombre || 'Sin nombre';
        const estado = data.estado || 'Desconocido';
        const unidad = data.unidad || '--';

        let fechaTexto = 'Sin fecha';
        if (data.horarioInicio && data.horarioInicio.toDate) {
            fechaTexto = toDateTimeText(data.horarioInicio.toDate());
        }

        // Color del badge estado (usando clases de style.css si es posible o inline para especificidad)
        let badgeClass = 'badge-gray';
        if (estado === 'TERMINADA' || estado === 'REALIZADA') badgeClass = 'badge-info'; // Usamos info (azul) o custom green
        else if (estado === 'INCOMPLETA') badgeClass = 'badge-warning';
        else if (estado === 'NO REALIZADA') badgeClass = 'badge-gray'; // O rojo si definimos badge-danger

        // Override manual para colores específicos si style.css no tiene danger/success
        let badgeStyle = '';
        if (estado === 'TERMINADA' || estado === 'REALIZADA') badgeStyle = 'background:#d1fae5; color:#065f46;'; // Green
        if (estado === 'NO REALIZADA') badgeStyle = 'background:#fee2e2; color:#991b1b;'; // Red

        div.innerHTML = `
      <div class="list-card-head">
        <h3 class="list-card-title">${nombre}</h3>
        <span class="badge ${badgeClass}" style="${badgeStyle}">${estado}</span>
      </div>
      <div class="list-card-meta">
        <span class="chip"><i class="fas fa-clock"></i> ${fechaTexto}</span>
        <span class="chip"><i class="fas fa-building"></i> ${unidad}</span>
      </div>
      ${data.usuario ? `
      <div style="margin-top:0.6rem; font-size:0.9rem; color:var(--theme-text);">
        <strong>Usuario:</strong> ${data.usuario}
      </div>` : ''}
      <div style="margin-top:10px; border-top:1px solid #444; padding-top:8px; text-align:right;">
          <button class="btn-report" style="background:transparent; border:1px solid #666; color:var(--theme-text); border-radius:4px; padding:5px 10px; cursor:pointer;">
              <i class="fas fa-file-pdf" style="color:#e74c3c;"></i> Descargar Reporte
          </button>
      </div>
    `;

        div.querySelector('.btn-report').addEventListener('click', (e) => {
            e.stopPropagation();
            // Asegurar que tenemos puntos para el reporte
            ReportService.generateAndUpload(data, 'RONDA_PROGRAMADA', 'ronda');
        });

        return div;
    }

    // Helper Fecha
    function toDateTimeText(dateObj) {
        if (!dateObj) return "";
        const day = String(dateObj.getDate()).padStart(2, '0');
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const year = dateObj.getFullYear();
        const hours = String(dateObj.getHours()).padStart(2, '0');
        const minutes = String(dateObj.getMinutes()).padStart(2, '0');
        const seconds = String(dateObj.getSeconds()).padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
    }

    // Event Listeners
    btnSearch.addEventListener('click', () => {
        isFilterActive = true;
        cargarRegistros(false);
    });

    btnClear.addEventListener('click', () => {
        filterDateInput.value = '';
        isFilterActive = false;
        cargarRegistros(false);
    });

    btnLoadMore.addEventListener('click', () => {
        cargarRegistros(true);
    });

    const btnGeneral = document.getElementById('btnGeneralReport');
    if (btnGeneral) {
        btnGeneral.addEventListener('click', () => {
            if (allLoadedData.length === 0) {
                alert('No hay datos cargados para generar el reporte general.');
                return;
            }
            ReportService.generateGeneralListReport(allLoadedData, 'RONDA_PROGRAMADA', 'REPORTE GENERAL DE RONDAS PROGRAMADAS');
        });
    }
});
