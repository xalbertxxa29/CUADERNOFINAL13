/**
 * offline-sync.js - Sistema global de sincronización offline para fotos
 * Uso: Agregar fotos a cola offline, se sincronizan automáticamente cuando hay conexión
 */

class OfflinePhotoQueue {
  constructor(dbInstance, storageInstance) {
    this.db = dbInstance;
    this.storage = storageInstance;
    this.queue = [];
    this.syncing = false;
    this.IDB_NAME = 'ronda-photo-queue';
    this.IDB_STORE = 'pending-photos';
    
    // Listeners para sincronización automática
    window.addEventListener('online', () => this.syncQueue());
    setInterval(() => this.syncIfOnline(), 30000); // Reintentos cada 30s
  }

  // Abrir IndexedDB
  async openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.IDB_NAME, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.IDB_STORE)) {
          db.createObjectStore(this.IDB_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Guardar item en IndexedDB
  async saveToIndexedDB(item) {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.IDB_STORE, 'readwrite');
        const store = tx.objectStore(this.IDB_STORE);
        const request = store.put(item);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('IndexedDB save error:', err);
    }
  }

  // Obtener todos los items de IndexedDB
  async getAllFromIndexedDB() {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.IDB_STORE, 'readonly');
        const store = tx.objectStore(this.IDB_STORE);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('IndexedDB read error:', err);
      return [];
    }
  }

  // Eliminar item de IndexedDB
  async removeFromIndexedDB(id) {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.IDB_STORE, 'readwrite');
        const store = tx.objectStore(this.IDB_STORE);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('IndexedDB delete error:', err);
    }
  }

  // Convertir blob a ArrayBuffer
  async blobToArrayBuffer(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  }

  // Convertir ArrayBuffer a Blob
  arrayBufferToBlob(arrayBuffer, mimeType = 'image/jpeg') {
    return new Blob([arrayBuffer], { type: mimeType });
  }

  // Agregar foto a la cola
  async addPhoto(metadata, blob) {
    try {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const arrayBuffer = await this.blobToArrayBuffer(blob);
      
      const item = {
        id,
        metadata, // {docId, path, collectionName, urlField}
        blob: arrayBuffer,
        mimeType: blob.type,
        queuedAt: new Date().toISOString(),
        attempts: 0,
        maxAttempts: 5
      };
      
      this.queue.push(item);
      await this.saveToIndexedDB(item);
      
      console.log(`📷 Foto agregada a cola:`, id);
      
      // Intentar sincronizar si hay conexión
      this.syncIfOnline();
    } catch (err) {
      console.error('Error al agregar foto a cola:', err);
    }
  }

  // Sincronizar si hay conexión
  syncIfOnline() {
    if (navigator.onLine && !this.syncing) {
      this.syncQueue();
    }
  }

  // Sincronizar toda la cola
  async syncQueue() {
    if (this.syncing || !navigator.onLine) return;
    
    this.syncing = true;
    let synced = 0;
    let failed = 0;
    
    try {
      // Cargar items de IndexedDB
      const items = await this.getAllFromIndexedDB();
      
      if (items.length === 0) {
        this.syncing = false;
        return;
      }
      
      console.log(`⏳ Sincronizando ${items.length} fotos...`);
      
      for (const item of items) {
        if (!navigator.onLine) break; // Salir si se desconecta
        
        try {
          await this.uploadPhotoAndUpdateDoc(item);
          await this.removeFromIndexedDB(item.id);
          synced++;
          console.log(`✅ Foto sincronizada: ${item.id}`);
        } catch (err) {
          item.attempts++;
          
          if (item.attempts >= item.maxAttempts) {
            console.error(`❌ Foto descartada después de ${item.maxAttempts} intentos:`, item.id);
            await this.removeFromIndexedDB(item.id);
            failed++;
          } else {
            // Guardar con intentos incrementados
            await this.saveToIndexedDB(item);
            console.warn(`⚠️ Reintentando foto (${item.attempts}/${item.maxAttempts}):`, item.id);
          }
        }
      }
      
      if (synced > 0 || failed > 0) {
        console.log(`📊 Resumen: ${synced} sincronizadas, ${failed} fallidas`);
      }
    } catch (err) {
      console.error('Error durante sincronización:', err);
    } finally {
      this.syncing = false;
    }
  }

  // Subir foto y actualizar documento
  async uploadPhotoAndUpdateDoc(item) {
    const { metadata, blob, mimeType } = item;
    
    // Subir a Storage
    const blob2 = this.arrayBufferToBlob(blob, mimeType);
    const ref = this.storage.ref().child(metadata.path);
    
    console.log(`📤 Subiendo: ${metadata.path}`);
    await ref.put(blob2, { contentType: mimeType });
    const url = await ref.getDownloadURL();
    
    // Actualizar documento en Firestore
    console.log(`📝 Actualizando documento: ${metadata.docId}`);
    const updateData = {};
    updateData[metadata.urlField] = url;
    updateData['sincronizadoEn'] = new Date().toISOString();
    
    await this.db.collection(metadata.collectionName)
      .doc(metadata.docId)
      .update(updateData);
  }

  // Obtener cantidad de items en cola
  async getQueueSize() {
    const items = await this.getAllFromIndexedDB();
    return items.length;
  }

  // Limpiar cola (útil para testing)
  async clearQueue() {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.IDB_STORE, 'readwrite');
      const store = tx.objectStore(this.IDB_STORE);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

// Exportar para uso en otros archivos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OfflinePhotoQueue;
}
