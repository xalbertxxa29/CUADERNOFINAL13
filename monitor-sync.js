/**
 * monitor-sync.js - Monitor Global de Estado de Sincronización
 * Muestra un indicador tipo "WhatsApp" (1 check / 2 checks) en el menú.
 */

class SyncMonitor {
    constructor() {
        this.widget = null;
        this.iconContainer = null;
        this.textContainer = null;
        this.detailsModal = null;

        // Estado interno
        this.state = {
            online: navigator.onLine,
            pendingQueue: 0,
            pendingRonda: false,
            lastCheck: null
        };

        this.init();
    }

    async init() {
        this.createWidgetUI();
        this.createDetailsModal();
        this.bindEvents();

        // Iniciar bucle de monitoreo
        this.checkStatus();
        setInterval(() => this.checkStatus(), 5000); // Revisar cada 5s

        console.log('[SyncMonitor] Iniciado');
    }

    createWidgetUI() {
        const div = document.createElement('div');
        div.id = 'sync-status-widget';
        div.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(30, 30, 30, 0.95);
      border: 1px solid #444;
      border-radius: 20px;
      padding: 8px 15px;
      display: flex;
      align-items: center;
      gap: 10px;
      z-index: 9999;
      box-shadow: 0 4px 15px rgba(0,0,0,0.5);
      cursor: pointer;
      backdrop-filter: blur(5px);
      transition: all 0.3s ease;
    `;

        div.innerHTML = `
      <div id="sync-icon" style="font-size: 1.2em;"></div>
      <div id="sync-text" style="font-size: 0.9em; color: #ccc; font-weight: 500;">Iniciando...</div>
    `;

        document.body.appendChild(div);
        this.widget = div;
        this.iconContainer = div.querySelector('#sync-icon');
        this.textContainer = div.querySelector('#sync-text');

        div.addEventListener('click', () => this.showDetails());
    }

    createDetailsModal() {
        const modal = document.createElement('div');
        modal.id = 'sync-details-modal';
        modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.8); display: none; align-items: center;
      justify-content: center; z-index: 10000;
    `;

        modal.innerHTML = `
      <div style="background: #222; border: 1px solid #444; border-radius: 12px; padding: 25px; width: 90%; max-width: 350px;">
        <h3 style="color: white; margin: 0 0 15px 0;">Estado de Sincronización</h3>
        <div id="sync-details-content" style="color: #ccc; font-size: 0.95em; line-height: 1.6;"></div>
        <button id="close-sync-modal" style="
          margin-top: 20px; width: 100%; padding: 10px; background: #333;
          color: white; border: none; border-radius: 6px; font-weight: 600;
        ">Cerrar</button>
      </div>
    `;

        document.body.appendChild(modal);
        this.detailsModal = modal;

        modal.querySelector('#close-sync-modal').addEventListener('click', () => {
            modal.style.display = 'none';
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });
    }

    bindEvents() {
        window.addEventListener('online', () => {
            this.state.online = true;
            this.checkStatus();
        });
        window.addEventListener('offline', () => {
            this.state.online = false;
            this.checkStatus();
        });
    }

    async checkStatus() {
        this.state.online = navigator.onLine;

        // 1. Verificar Cola Offline (Incidencias, Cuaderno)
        try {
            if (window.OfflineQueue) {
                this.state.pendingQueue = await window.OfflineQueue.count();
            }
        } catch (e) { console.warn(e); }

        // 2. Verificar Rondas (si existe la lógica disponible)
        try {
            if (window.RONDA_STORAGE && window.rondaIdActual) { // rondaIdActual es global en ronda-v2.js, quizás no aquí
                // Lógica simplificada: si estamos offline y hay ronda en progreso, asumimos "pendiente"
                // Idealmente accederíamos a rondaSync.detectarCambios pero es asíncrono y complejo.
                // Por ahora, validaremos si hay items en cache que no han subido.
                // Pero para el MVP, usaremos la cola offline que es lo más crítico (fotos).
            }
        } catch (e) { }

        this.updateUI();
    }

    updateUI() {
        const { online, pendingQueue } = this.state;
        const totalPending = pendingQueue;

        if (totalPending === 0 && online) {
            // Estado: Todo Sincronizado
            this.iconContainer.innerHTML = '✅✅'; // Doble check
            this.textContainer.textContent = 'Sincronizado';
            this.textContainer.style.color = '#4ade80'; // Green
        } else {
            // Estado: Pendiente
            this.iconContainer.innerHTML = '☑️'; // Un check en caja (o reloj 🕒)
            this.textContainer.textContent = `Pendiente (${totalPending})`;
            this.textContainer.style.color = '#e2e8f0'; // White/Gray

            if (!online) {
                this.textContainer.textContent += ' • Offline';
                this.textContainer.style.color = '#f87171'; // Redish
            }
        }
    }

    showDetails() {
        const content = this.detailsModal.querySelector('#sync-details-content');
        const { online, pendingQueue } = this.state;

        let html = `
      <div style="margin-bottom: 10px;">
        <strong>Conexión:</strong> 
        <span style="color: ${online ? '#4ade80' : '#f87171'}">${online ? 'Online' : 'Offline'}</span>
      </div>
      <div style="margin-bottom: 10px;">
        <strong>Cola de Subida:</strong> ${pendingQueue} elementos
        <div style="font-size: 0.85em; color: #888;">(Incidencias, Cuaderno, Fotos)</div>
      </div>
    `;

        if (pendingQueue > 0) {
            html += `
        <div style="background: #334; padding: 10px; border-radius: 4px; margin-top: 10px; font-size: 0.9em;">
          ℹ️ Los registros se subirán automáticamente cuando recuperes la conexión. No cierres la sesión.
        </div>
      `;
        } else {
            html += `
        <div style="color: #4ade80; margin-top: 10px;">
          ¡Todo está al día! ✅✅
        </div>
      `;
        }

        content.innerHTML = html;
        this.detailsModal.style.display = 'flex';
    }
}

// Inicializar al cargar
document.addEventListener('DOMContentLoaded', () => {
    window.syncMonitor = new SyncMonitor();
});
