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

                // Cargar registros iniciales
                cargarRegistros();
            } else {
                resultsList.innerHTML = '<div class="info-msg">No se encontró perfil de usuario.</div>';
            }
        } catch (e) {
            console.error("Error al obtener perfil usuario:", e);
            resultsList.innerHTML = `<div class="info-msg">Error al cargar perfil: ${e.message}</div>`;
        }
    });

    // 2. Cargar Registros
    let allLoadedData = [];
    async function cargarRegistros(isNextPage = false) {
        if (!isNextPage) {
            resultsList.innerHTML = '<div class="info-msg">Cargando...</div>';
            lastDoc = null;
            loadMoreContainer.style.display = 'none';
            allLoadedData = [];
        }

        try {
            let query = db.collection('RONDA_MANUAL');

            // Filtros obligatorios por Cliente y Unidad
            // NOTA: Según la información, en RONDA_MANUAL las claves son 'cliente' y 'unidad' (minúsculas)
            // pero los valores se guardan en mayúsculas (según capturas y lógica habitual)
            query = query.where('cliente', '==', userCliente)
                .where('unidad', '==', userUnidad);

            // Filtro por fecha (opcional)
            const dateVal = filterDateInput.value;
            if (dateVal) {
                // Rango de fecha para timestamp
                const start = new Date(dateVal + 'T00:00:00');
                const end = new Date(dateVal + 'T23:59:59');
                query = query.where('timestamp', '>=', start)
                    .where('timestamp', '<=', end);
                // Ordenar por timestamp
                query = query.orderBy('timestamp', 'desc');
            } else {
                // Orden por defecto
                query = query.orderBy('timestamp', 'desc');
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
                    resultsList.innerHTML = '<div class="info-msg">No se encontraron rondas manuales.</div>';
                } else {
                    // No hay más páginas
                    loadMoreContainer.style.display = 'none';
                }
                return;
            }

            lastDoc = snapshot.docs[snapshot.docs.length - 1];

            snapshot.forEach(doc => {
                const data = doc.data();
                allLoadedData.push(data);
                const card = crearCard(data);
                resultsList.appendChild(card);
            });

            // Mostrar botón "Cargar más" si trajimos el límite completo
            if (snapshot.docs.length === LIMIT) {
                loadMoreContainer.style.display = 'block';
            } else {
                loadMoreContainer.style.display = 'none';
            }

        } catch (error) {
            console.error("Error cargando rondas manuales:", error);
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

    // 3. Renderizar Card
    function crearCard(data) {
        const div = document.createElement('div');
        div.className = 'card-improved';

        let fechaTexto = data.fechaHora || 'Sin fecha';
        if (data.timestamp && data.timestamp.toDate) {
            fechaTexto = toDateTimeText(data.timestamp.toDate());
        }

        const nombrePunto = data.nombrePunto || 'Punto S/N';
        const unidad = data.unidad || (data.respuestas && data.respuestas.unidad) || '<span class="no-data">--</span>';

        // Lógica robusta para obtener el usuario (soporta estructura plana y anidada en 'respuestas')
        let usuario = data.usuario;

        // 1. Si no está en raíz, buscar en respuestas
        if (!usuario && data.respuestas && data.respuestas.usuario) {
            usuario = data.respuestas.usuario;
        }

        // 2. Fallback a email si no hay nombre (buscar en raiz y respuestas)
        if (!usuario) {
            if (data.usuarioEmail) {
                usuario = data.usuarioEmail;
            } else if (data.respuestas && data.respuestas.usuarioEmail) {
                usuario = data.respuestas.usuarioEmail;
            }
        }

        // 3. Si sigue vacío, mostrar mensaje
        if (!usuario) {
            usuario = '<span class="no-data">Sin usuario registrado</span>';
        }

        div.innerHTML = `
            <div class="card-header">
                <h3 class="card-title">
                    <i class="fas fa-map-marker-alt" style="color:var(--primary);"></i> 
                    ${nombrePunto}
                </h3>
                <span class="card-badge">
                    <i class="far fa-clock"></i> ${fechaTexto}
                </span>
            </div>
            
            <div class="card-body">
                <div class="info-grid">
                    <div class="info-item">
                        <span class="info-label">Unidad</span>
                        <div class="info-value">
                            <i class="fas fa-building" style="color:var(--theme-muted);"></i> ${unidad}
                        </div>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Usuario</span>
                        <div class="info-value">
                            <i class="fas fa-user-circle" style="color:var(--theme-muted);"></i> ${usuario}
                        </div>
                    </div>
                </div>

                ${data.foto ? `
                    <div class="card-image-container">
                        <img src="${data.foto}" class="card-image" loading="lazy" onclick="window.open('${data.foto}', '_blank')" alt="Evidencia fotográfica">
                    </div>
                ` : ''}
            </div>

            <div class="card-footer">
                <button class="btn-download btn-report">
                    <i class="fas fa-file-pdf" style="color:#e74c3c;"></i> Descargar Reporte
                </button>
            </div>
        `;

        div.querySelector('.btn-report').addEventListener('click', (e) => {
            e.stopPropagation();
            ReportService.generateAndUpload(data, 'RONDA_MANUAL', 'manual');
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
            ReportService.generateGeneralListReport(allLoadedData, 'RONDA_MANUAL', 'REPORTE GENERAL DE RONDAS MANUALES');
        });
    }

});
