// report-service.js
// Servicio de generación de reportes PDF y subida a Firebase Storage

const ReportService = {
    // Configuración
    logoUrl: 'imagenes/logo.png', // Ajustar si la ruta es diferente

    // Utilidad para cargar imagen como Data URL
    async getBase64ImageFromUrl(imageUrl) {
        try {
            const res = await fetch(imageUrl);
            const blob = await res.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (e) {
            console.warn('Error cargando imagen para reporte:', e);
            return null;
        }
    },

    // Generar PDF y Subir
    async generateAndUpload(docData, type, filenamePrefix) {
        // Mostrar loading
        this.showLoading('Generando reporte PDF...');

        try {
            // 1. Crear documento PDF
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            // Cargar logo
            const logoBase64 = await this.getBase64ImageFromUrl(this.logoUrl);

            // Delegar al generador específico según tipo
            switch (type) {
                case 'RONDA_PROGRAMADA':
                    await this.buildRondaProgramadaReport(doc, docData, logoBase64);
                    break;
                case 'CONSIGNA':
                    await this.buildConsignaReport(doc, docData, logoBase64);
                    break;
                case 'INCIDENCIA':
                    await this.buildIncidenciaReport(doc, docData, logoBase64);
                    break;
                case 'PEATONAL':
                    await this.buildPeatonalReport(doc, docData, logoBase64);
                    break;
                case 'VEHICULAR':
                    await this.buildVehicularReport(doc, docData, logoBase64);
                    break;
                case 'RONDA_MANUAL':
                    await this.buildRondaManualReport(doc, docData, logoBase64);
                    break;
                default:
                    await this.buildGenericReport(doc, docData, logoBase64);
            }

            // 2. Convertir a Blob
            const pdfBlob = doc.output('blob');

            // 3. Subir a Storage
            this.updateLoading('Subiendo reporte a la nube...');
            const storageRef = firebase.storage().ref();
            // Nombre único: reportes/temp_{timestamp}_{random}.pdf
            const fileName = `reportes/${filenamePrefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}.pdf`;
            const fileRef = storageRef.child(fileName);

            await fileRef.put(pdfBlob);

            // 4. Obtener URL
            this.updateLoading('Obteniendo enlace...');
            const url = await fileRef.getDownloadURL();

            // 5. Mostrar Modal con Link
            this.hideLoading();
            this.showLinkModal(url);

        } catch (e) {
            console.error(e);
            this.hideLoading();
            this.showToast('Error generando o subiendo: ' + e.message, 'error');
        }
    },

    // --- Reporte Rondas Programadas (Estilo Dashboard) ---
    async buildRondaProgramadaReport(doc, data, logo) {
        const pageWidth = doc.internal.pageSize.width;
        let y = 15;

        // Header
        if (logo) doc.addImage(logo, 'PNG', 15, 10, 30, 30); // Logo izq
        doc.setFontSize(16);
        doc.setTextColor(41, 75, 126); // Azul
        doc.text('REPORTE DE RONDA', pageWidth / 2, 25, { align: 'center' });

        // Linea
        y = 45;

        // Información General
        doc.setFontSize(12);
        doc.setTextColor(41, 75, 126);
        doc.text('INFORMACIÓN GENERAL', 15, y);
        y += 5;
        doc.setDrawColor(100);

        const infoX1 = 15;
        const infoX2 = pageWidth / 2 + 5;

        doc.setFontSize(10);
        doc.setTextColor(80);

        // Columna 1
        this.addKeyValue(doc, 'Cliente:', (data.cliente || '').toUpperCase(), infoX1, y);
        this.addKeyValue(doc, 'Unidad:', (data.unidad || '').toUpperCase(), infoX1, y + 7);
        this.addKeyValue(doc, 'Ronda:', (data.nombre || '').toUpperCase(), infoX1, y + 14);

        // Columna 2
        const estadoColor = (data.estado === 'TERMINADA' || data.estado === 'REALIZADA') ? [0, 128, 0] : [200, 0, 0];
        this.addKeyValue(doc, 'Estado:', (data.estado || 'PENDIENTE').toUpperCase(), infoX2, y, estadoColor);

        // Parse fecha
        let fechaStr = '--/--/----';
        let horaStr = '--:--';
        if (data.horarioInicio) {
            let d = data.horarioInicio.toDate ? data.horarioInicio.toDate() : new Date(data.horarioInicio);
            fechaStr = d.toLocaleDateString();
            horaStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        this.addKeyValue(doc, 'Fecha:', fechaStr, infoX2, y + 7);
        this.addKeyValue(doc, 'Hora Inicio:', horaStr, infoX2, y + 14);

        y += 25;

        // Resumen Puntos (Izquierda) y Gráfico (Derecha) -> Simple aproximación
        doc.setFontSize(12);
        doc.setTextColor(41, 75, 126);
        doc.text('RESUMEN DE PUNTOS DE CONTROL', 15, y);
        y += 8;

        // Calcular stats
        const total = data.puntosRonda ? data.puntosRonda.length : 0;
        // Contar registrados
        let registrados = 0;
        if (data.puntosRegistrados) {
            registrados = Object.values(data.puntosRegistrados).filter(p => p.qrEscaneado).length;
        }
        const sinRegistrar = total - registrados;
        const porc = total > 0 ? ((registrados / total) * 100).toFixed(0) : 0;

        // Tabla Resumen
        const startYResumen = y;
        this.addKeyValue(doc, 'Total Puntos:', String(total), 15, y, [41, 128, 185], 80); y += 7;
        this.addKeyValue(doc, 'Registrados:', String(registrados), 15, y, [39, 174, 96], 80); y += 7;
        this.addKeyValue(doc, 'Sin Registrar:', String(sinRegistrar), 15, y, [192, 57, 43], 80);

        // Gráfico Donut (Simulado con arcos o círculos)
        // Centro del gráfico
        const chartX = 150;
        const chartY = startYResumen + 10;
        const radius = 18;

        // Dibujar círculo base (Rojo/Gris)
        doc.setFillColor(231, 76, 60); // Rojo
        doc.circle(chartX, chartY, radius, 'F');

        // Si hay registrados, "pintar" la parte proporcional verde es dificil sin canvas context.
        // Simplificación: Círculo Verde si 100%, ó visual simple.
        // Usaremos líneas gruesas para simular arco es muy complejo en jsPDF raw.
        // Hack: Si > 0, pintar círculo verde encima? No, eso llena todo.
        // Mejor: Círculo verde grande = Registrados, Círculo rojo = Sin registrar? No.
        // Solución elegante simple: Un círculo con el porcentaje en medio.

        // Fondo gris
        doc.setFillColor(230, 230, 230);
        doc.circle(chartX, chartY, radius, 'F');

        // "Progreso" (Verde)
        // jsPDF no tiene arc() simple con fill. Usaremos setLineWidth y lines.
        // O mejor, dibujamos un pastel simple usando triangles? Muy complejo.
        // Usaré un cuadrado de color verde o rojo que represente el estado global.
        // O mejor, el texto grande del porcentaje.

        doc.setFillColor(registrados > 0 ? 46 : 200, registrados > 0 ? 204 : 50, registrados > 0 ? 113 : 50); // Verde o gris
        // Dibujamos un 'pie slice' es dificil. 
        // Vamos a dibujar simplemente un círculo del color del estado mayoritario y un agujero blanco.
        const colorChart = (registrados === total) ? [46, 204, 113] : [231, 76, 60];
        doc.setFillColor(...colorChart);
        doc.circle(chartX, chartY, radius, 'F');

        // Agujero (Donut)
        doc.setFillColor(255, 255, 255);
        doc.circle(chartX, chartY, radius * 0.6, 'F');

        // Texto centro
        doc.setFontSize(14);
        doc.setTextColor(44, 62, 80);
        doc.text(`${porc}%`, chartX, chartY + 2, { align: 'center' });

        // Leyenda
        y = chartY + radius + 10;
        doc.setFillColor(46, 204, 113); doc.circle(chartX - 25, y, 2, 'F');
        doc.setFontSize(9); doc.setTextColor(80); doc.text(`Registrados ${registrados}`, chartX - 20, y + 1);

        y += 5;
        doc.setFillColor(231, 76, 60); doc.circle(chartX - 25, y, 2, 'F');
        doc.text(`Sin Registrar ${sinRegistrar}`, chartX - 20, y + 1);

        y = Math.max(y + 10, startYResumen + 40);

        // Detalle de Puntos
        doc.setFontSize(12);
        doc.setTextColor(41, 75, 126);
        doc.text('DETALLE DE PUNTOS DE CONTROL', 15, y);
        y += 5;

        // Tabla
        const columns = ["#", "PUNTO", "ESTADO", "HORA"];
        const rows = [];

        if (data.puntosRegistrados) {
            Object.keys(data.puntosRegistrados).sort((a, b) => Number(a) - Number(b)).forEach((key, i) => {
                const p = data.puntosRegistrados[key];
                const estado = p.qrEscaneado ? 'Registrado' : 'Pendiente';

                let horaPunto = '--:--';
                if (p.timestamp) {
                    let d = p.timestamp.toDate ? p.timestamp.toDate() : new Date(p.timestamp);
                    horaPunto = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }

                rows.push([parseInt(key) + 1, p.nombre, estado, horaPunto]);
            });
        }

        doc.autoTable({
            startY: y,
            head: [columns],
            body: rows,
            theme: 'striped',
            headStyles: { fillColor: [41, 75, 126] },
            styles: { fontSize: 9 },
            columnStyles: {
                0: { cellWidth: 15 }, // #
                1: { cellWidth: 'auto' }, // Punto
                2: { cellWidth: 30, textColor: [39, 174, 96] }, // Estado (verde por defecto, ajustar luego si pendiente)
                3: { cellWidth: 25 } // Hora
            },
            didParseCell: function (data) {
                if (data.section === 'body' && data.column.index === 2) {
                    if (data.cell.raw === 'Pendiente') {
                        data.cell.styles.textColor = [192, 57, 43];
                    }
                }
            }
        });
    },

    // --- Reporte General de Lista (Tabla) ---
    // --- Reporte General de Lista (Tabla) ---
    async generateGeneralListReport(dataList, type, title) {
        this.showLoading('Generando reporte general...');
        try {
            const { jsPDF } = window.jspdf;
            const isRondaProg = (type === 'RONDA_PROGRAMADA');
            const orientation = isRondaProg ? 'portrait' : 'landscape';
            const doc = new jsPDF({ orientation });
            const logoBase64 = await this.getBase64ImageFromUrl(this.logoUrl);

            if (isRondaProg) {
                // Generar reporte detallado por cada item (concatenado)
                for (let i = 0; i < dataList.length; i++) {
                    if (i > 0) doc.addPage();
                    await this.buildRondaProgramadaReport(doc, dataList[i], logoBase64);
                }
            } else {
                if (logoBase64) doc.addImage(logoBase64, 'PNG', 15, 10, 25, 25);
                doc.setFontSize(16); doc.setTextColor(41, 75, 126);
                doc.text(title, doc.internal.pageSize.width / 2, 25, { align: 'center' });

                doc.setFontSize(10); doc.setTextColor(100);
                doc.text(`Fecha de emisión: ${new Date().toLocaleString()}`, 15, 40);
                doc.text(`Total de registros: ${dataList.length}`, 15, 45);

                let columns = [];
                let body = [];

                if (type === 'RONDA_PROGRAMADA') {
                    // Fallback or unreachable now
                } else if (type === 'INCIDENCIA') {
                    columns = ['Fecha', 'Cliente', 'Unidad', 'Tipo', 'Nivel', 'Registrado Por'];
                    body = dataList.map(d => [
                        this.fmtDate(d.timestamp), d.cliente, d.unidad, d.tipoIncidente, d.Nivelderiesgo, d.registradoPor || d.REGISTRADO_POR
                    ]);
                } else if (type === 'VEHICULAR') {
                    columns = ['Placa', 'Conductor', 'Vehículo', 'Estado', 'Ingreso', 'Salida'];
                    body = dataList.map(d => [
                        d.placa, d.nombres, `${d.marca} ${d.modelo}`, d.estado, d.fechaIngreso, d.fechaSalida || '-'
                    ]);
                } else if (type === 'PEATONAL') {
                    columns = ['Nombre', 'Empresa', 'Tipo', 'Motivo', 'Ingreso', 'Salida'];
                    body = dataList.map(d => [
                        d.NOMBRES_COMPLETOS, d.EMPRESA, d.TIPO_ACCESO, d.MOTIVO, d.FECHA_INGRESO ? `${d.FECHA_INGRESO} ${d.HORA_INGRESO}` : '', d.FECHA_SALIDA ? `${d.FECHA_SALIDA} ${d.HORA_FIN}` : '-'
                    ]);
                } else if (type === 'CONSIGNA') {
                    columns = ['Fecha', 'Tipo', 'Título', 'Puesto', 'Vigencia'];
                    body = dataList.map(d => [
                        this.fmtDate(d.timestamp), d.tipo, d.titulo, d.puesto || 'General', d.inicio ? `${this.fmtDateStr(d.inicio)} al ${this.fmtDateStr(d.fin)}` : 'Indefinida'
                    ]);
                } else if (type === 'RONDA_MANUAL') {
                    columns = ['Fecha', 'Punto', 'Usuario', 'Unidad', 'Comentario'];
                    body = dataList.map(d => [
                        d.fechaHora, d.nombrePunto, d.usuario, d.unidad, d.comentario
                    ]);
                }

                doc.autoTable({
                    startY: 50,
                    head: [columns],
                    body: body,
                    theme: 'striped',
                    headStyles: { fillColor: [41, 75, 126] },
                    styles: { fontSize: 8 },
                });
            }

            // Subida
            const pdfBlob = doc.output('blob');
            this.updateLoading('Subiendo reporte general...');
            const storageRef = firebase.storage().ref();
            const fileName = `reportes/general_${type.toLowerCase()}_${Date.now()}_${Math.floor(Math.random() * 1000)}.pdf`;
            const fileRef = storageRef.child(fileName);

            await fileRef.put(pdfBlob);
            this.updateLoading('Obteniendo enlace...');
            const url = await fileRef.getDownloadURL();
            this.hideLoading();
            this.showLinkModal(url);

        } catch (e) {
            console.error(e);
            this.hideLoading();
            this.showToast('Error: ' + e.message, 'error');
        }
    },

    // --- Reporte Genérico (Incidencias, Veh, Pea, etc) ---
    async buildGenericReport(doc, data, logo) {
        if (logo) doc.addImage(logo, 'PNG', 15, 10, 20, 20);
        doc.setFontSize(18);
        doc.text('REPORTE DE OPERACIONES', 105, 20, { align: 'center' });

        doc.setFontSize(11);
        doc.text(`Generado: ${new Date().toLocaleString()}`, 105, 28, { align: 'center' });

        let y = 40;

        // Imprimir todas las keys/values
        const keys = Object.keys(data).filter(k =>
            k !== 'timestamp' && k !== 'foto' && k !== 'fotoURL' && k !== 'fotoEmbedded' && typeof data[k] !== 'object'
        );

        doc.autoTable({
            startY: y,
            body: keys.map(k => [k.toUpperCase(), String(data[k] || '')]),
            theme: 'grid',
            bodyStyles: { lineColor: [200, 200, 200] },
        });

        // Add Image if exists
        const imgUrl = data.foto || data.fotoURL;
        if (imgUrl) {
            try {
                const imgData = await this.getBase64ImageFromUrl(imgUrl);
                if (imgData) {
                    let finalY = doc.lastAutoTable.finalY + 10;
                    if (finalY > 230) { doc.addPage(); finalY = 20; }

                    doc.setFontSize(10);
                    doc.setTextColor(50);
                    doc.text("EVIDENCIA FOTOGRÁFICA", 15, finalY);
                    // Add image slightly down
                    // Max width 100, max height 80
                    doc.addImage(imgData, 'JPEG', 15, finalY + 5, 80, 60);
                }
            } catch (e) { console.log('Error adding image', e); }
        }
    },

    // ... Implementaciones específicas simples
    async buildIncidenciaReport(doc, data, logo) {
        if (logo) doc.addImage(logo, 'PNG', 15, 10, 25, 25);
        doc.setFontSize(16); doc.setTextColor(200, 0, 0);
        doc.text('REPORTE DE INCIDENCIA', 105, 20, { align: 'center' });

        const rows = [
            ['Fecha', this.fmtDate(data.timestamp)],
            ['Registrado Por', data.registradoPor || data.REGISTRADO_POR],
            ['Cliente', data.cliente],
            ['Unidad', data.unidad],
            ['Nivel Riesgo', data.Nivelderiesgo],
            ['Categoría', data.tipoIncidente],
            ['Detalle', data.detalleIncidente],
            ['Comentario', data.comentario]
        ];

        doc.autoTable({
            startY: 40,
            body: rows,
            theme: 'striped',
            styles: { fontSize: 10, cellPadding: 4 },
            columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } }
        });

        // Add Image
        const imgUrl = data.foto || data.fotoURL;
        if (imgUrl) {
            await this.addImageToDoc(doc, imgUrl);
        }
    },

    async buildVehicularReport(doc, data, logo) {
        if (logo) doc.addImage(logo, 'PNG', 15, 10, 25, 25);
        doc.setFontSize(16); doc.setTextColor(230, 126, 34); // Naranja
        doc.text('CONTROL VEHICULAR', 105, 20, { align: 'center' });

        const rows = [
            ['Placa', data.placa || ''],
            ['Conductor', data.nombres || ''],
            ['DNI', data.dni || ''],
            ['Vehículo', `${data.marca} ${data.modelo} ${data.color}`],
            ['Estado', (data.estado || '').toUpperCase()],
            ['Fecha Ingreso', data.fechaIngreso],
            ['Fecha Salida', data.fechaSalida || '-'],
            ['Obs. Ingreso', data.observaciones],
            ['Obs. Salida', data.comentarioSalida]
        ];
        doc.autoTable({
            startY: 40,
            body: rows,
            theme: 'grid',
            columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } }
        });

        // Add Image
        const imgUrl = data.foto || data.fotoURL;
        if (imgUrl) {
            await this.addImageToDoc(doc, imgUrl);
        }
    },

    async buildPeatonalReport(doc, data, logo) {
        if (logo) doc.addImage(logo, 'PNG', 15, 10, 25, 25);
        doc.setFontSize(16); doc.setTextColor(41, 128, 185); // Azul
        doc.text('ACCESO PEATONAL', 105, 20, { align: 'center' });

        const rows = [
            ['Nombre', data.NOMBRES_COMPLETOS || ''],
            ['Empresa', data.EMPRESA || ''],
            ['Tipo', data.TIPO_ACCESO || ''],
            ['Motivo', data.MOTIVO || ''],
            ['Area', data.AREA || ''],
            ['Ingreso', `${data.FECHA_INGRESO} ${data.HORA_INGRESO}`],
            ['Salida', data.FECHA_SALIDA ? `${data.FECHA_SALIDA} ${data.HORA_FIN}` : '-'],
            ['Registrado Por', data.USUARIO]
        ];
        doc.autoTable({
            startY: 40,
            body: rows,
            theme: 'grid',
            columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } }
        });

        // Add Image
        const imgUrl = data.foto || data.fotoURL;
        if (imgUrl) {
            await this.addImageToDoc(doc, imgUrl);
        }
    },

    async buildConsignaReport(doc, data, logo) {
        if (logo) doc.addImage(logo, 'PNG', 15, 10, 25, 25);
        doc.setFontSize(16); doc.setTextColor(50, 50, 50);
        doc.text('REPORTE DE CONSIGNA', 105, 20, { align: 'center' });

        const rows = [
            ['Tipo', data.tipo],
            ['Título', data.titulo],
            ['Descripción', data.descripcion],
            ['Puesto', data.puesto || 'General'],
            ['Fecha Registro', this.fmtDate(data.timestamp)],
            ['Vigencia', data.inicio ? `${this.fmtDateStr(data.inicio)} al ${this.fmtDateStr(data.fin)}` : 'Indefinida']
        ];
        doc.autoTable({
            startY: 40,
            body: rows,
            theme: 'plain',
            columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 } }
        });

        // Add Image
        const imgUrl = data.foto || data.fotoURL;
        if (imgUrl) {
            await this.addImageToDoc(doc, imgUrl);
        }
    },

    async buildRondaManualReport(doc, data, logo) {
        if (logo) doc.addImage(logo, 'PNG', 15, 10, 25, 25);
        doc.setFontSize(16); doc.setTextColor(46, 204, 113);
        doc.text('RONDA MANUAL', 105, 20, { align: 'center' });

        const rows = [
            ['Punto', data.nombrePunto],
            ['Fecha/Hora', data.fechaHora],
            ['Usuario', data.usuario],
            ['Unidad', data.unidad],
            ['Comentarios', data.comentario || '']
        ];
        doc.autoTable({
            startY: 40,
            body: rows,
            theme: 'striped',
            columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 } }
        });

        // Add Image
        const imgUrl = data.foto || data.fotoURL;
        if (imgUrl) {
            await this.addImageToDoc(doc, imgUrl);
        }
    },

    // Helper para añadir imagen común
    async addImageToDoc(doc, imgUrl) {
        try {
            const imgData = await this.getBase64ImageFromUrl(imgUrl);
            if (imgData) {
                let finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : 150;

                // Si queda poco espacio, nueva página
                if (finalY > 200) {
                    doc.addPage();
                    finalY = 20;
                }

                doc.setFontSize(10);
                doc.setTextColor(50);
                doc.text("EVIDENCIA FOTOGRÁFICA", 15, finalY);

                // Add image (Max width 80mm, height 60mm)
                doc.addImage(imgData, 'JPEG', 15, finalY + 5, 80, 60);
            }
        } catch (e) {
            console.warn('No se pudo añadir la imagen al reporte', e);
        }
    },

    // Helpers
    addKeyValue(doc, key, value, x, y, colorVal = [0, 0, 0], offset = 40) {
        doc.setTextColor(100);
        doc.setFont("helvetica", "bold");
        doc.text(key, x, y);
        doc.setTextColor(...colorVal);
        doc.setFont("helvetica", "normal");
        doc.text(value, x + offset, y);
        // underline line?
        doc.setDrawColor(200);
        doc.line(x, y + 1, x + offset + 60, y + 1);
    },

    fmtDate(ts) {
        if (!ts) return '';
        try {
            const d = ts.toDate ? ts.toDate() : new Date(ts);
            return d.toLocaleString();
        } catch (e) { return String(ts); }
    },

    fmtDateStr(d) {
        if (!d) return '';
        // Asume string YYYY-MM-DD o Date
        return d;
    },

    // --- UI Helpers ---
    showToast(msg, type = 'success') {
        let toast = document.getElementById('report-toast');
        if (toast) toast.remove();

        toast = document.createElement('div');
        toast.id = 'report-toast';
        const color = type === 'success' ? '#10b981' : '#ef4444';
        const icon = type === 'success' ? '<i class="fas fa-check-circle"></i>' : '<i class="fas fa-exclamation-circle"></i>';

        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%) translateY(100px);
            background: #1f2937;
            color: #fff;
            padding: 12px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            gap: 12px;
            z-index: 11000;
            opacity: 0;
            transition: all 0.3s cubic-bezier(0.68, -0.55, 0.27, 1.55);
            border-left: 4px solid ${color};
            font-family: sans-serif;
            font-size: 0.95rem;
        `;
        toast.innerHTML = `${icon} <span>${msg}</span>`;
        document.body.appendChild(toast);

        // Animate in
        requestAnimationFrame(() => {
            toast.style.transform = 'translateX(-50%) translateY(0)';
            toast.style.opacity = '1';
        });

        // Hide after 3s
        setTimeout(() => {
            toast.style.transform = 'translateX(-50%) translateY(100px)';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    showLoading(msg) {
        let overlay = document.getElementById('report-loading');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'report-loading';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;';
            overlay.innerHTML = '<div class="spinner" style="border:4px solid #f3f3f3;border-top:4px solid #3498db;border-radius:50%;width:40px;height:40px;animation:spin 1s linear infinite;margin-bottom:15px;"></div><div id="report-msg" style="font-size:1.2rem;"></div><style>@keyframes spin {0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); }}</style>';
            document.body.appendChild(overlay);
        }
        overlay.querySelector('#report-msg').innerText = msg;
        overlay.style.display = 'flex';
    },

    // ... existing updateLoading/hideLoading ... 

    updateLoading(msg) {
        const el = document.getElementById('report-msg');
        if (el) el.innerText = msg;
    },

    hideLoading() {
        const overlay = document.getElementById('report-loading');
        if (overlay) overlay.style.display = 'none';
    },

    showLinkModal(url) {
        let modal = document.getElementById('report-link-modal');
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = 'report-link-modal';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px);';

        modal.innerHTML = `
            <div style="background:#1e1e1e; padding:2rem; border-radius:12px; max-width:90%; width:400px; text-align:center; color:#eee; box-shadow: 0 10px 25px rgba(0,0,0,0.5); border:1px solid #333;">
                <div style="margin-bottom:1.5rem;">
                    <i class="fas fa-check-circle" style="font-size:3rem; color:#10b981;"></i>
                </div>
                <h3 style="margin:0 0 0.5rem 0; color:#fff;">Reporte Generado</h3>
                <p style="margin:0 0 1.5rem 0; color:#aaa; font-size:0.9rem;">El documento está listo. Copia el enlace para compartirlo.</p>
                
                <div style="position:relative; margin-bottom:1.5rem;">
                    <div style="display:flex; background:#2d2d2d; border-radius:6px; border:1px solid #444; overflow:hidden;">
                        <input type="text" id="report-url-input" readonly 
                            style="flex:1; background:transparent; border:none; color:#fff; padding:10px 12px; font-size:0.9rem; outline:none;" />
                        <button id="copy-btn-input" 
                            style="background:#3b82f6; color:white; border:none; padding:0 15px; cursor:pointer; font-weight:500; transition:background 0.2s;">
                            <i class="fas fa-copy"></i>
                        </button>
                    </div>
                </div>
                
                <div style="display:flex; gap:10px; justify-content:stretch;">
                    <button id="btn-copy-main"
                        style="flex:1; background:#2d2d2d; border:1px solid #444; color:#fff; padding:10px; border-radius:6px; cursor:pointer; font-weight:500; transition:all 0.2s;">
                        <i class="fas fa-copy"></i> Copiar enlace
                    </button>
                    <button onclick="document.getElementById('report-link-modal').style.display='none'" 
                        style="flex:1; background:#ef4444; border:none; color:white; padding:10px; border-radius:6px; cursor:pointer; font-weight:500; transition:all 0.2s;">
                        Cerrar
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Hover
        const btns = modal.querySelectorAll('button');
        btns.forEach(btn => {
            btn.onmouseover = () => { if (btn.id !== 'copy-btn-input' && btn.id !== 'btn-copy-main') btn.style.filter = 'brightness(1.2)'; }
            btn.onmouseout = () => { if (btn.id !== 'copy-btn-input' && btn.id !== 'btn-copy-main') btn.style.filter = 'brightness(1)'; }
        });

        // Copy Helper
        const doCopy = () => {
            const input = document.getElementById('report-url-input');
            input.select();
            if (navigator.clipboard) {
                navigator.clipboard.writeText(input.value)
                    .then(() => ReportService.showToast('Enlace copiado al portapapeles', 'success'))
                    .catch(() => ReportService.showToast('No se pudo copiar automáticamente', 'error'));
            } else {
                document.execCommand('copy');
                ReportService.showToast('Enlace copiado al portapapeles', 'success');
            }
        };

        modal.querySelector('#copy-btn-input').onclick = doCopy;
        modal.querySelector('#btn-copy-main').onclick = doCopy;

        document.getElementById('report-url-input').value = url;
    }
};
