/**
 * image-optimizer.js (v1) - Compresión centralizada de imágenes
 * 
 * Uso:
 *   const compressed = await ImageOptimizer.compress(file);
 *   const dataURL = await ImageOptimizer.toDataURL(file);
 *   const blob = await ImageOptimizer.toBlob(file);
 */

window.ImageOptimizer = {
  /**
   * Configuraciones predefinidas por tipo de contenido
   */
  presets: {
    consigna: {
      maxSizeMB: 0.3,        // 300KB - Consignas normales
      maxWidthOrHeight: 1024,
      quality: 0.8
    },
    temporalAlerta: {
      maxSizeMB: 0.4,        // 400KB - Temporales con alertas
      maxWidthOrHeight: 1280,
      quality: 0.85
    },
    incidente: {
      maxSizeMB: 0.35,       // 350KB - Incidentes
      maxWidthOrHeight: 1024,
      quality: 0.8
    },
    miniatura: {
      maxSizeMB: 0.15,       // 150KB - Miniaturas/preview
      maxWidthOrHeight: 512,
      quality: 0.75
    }
  },

  /**
   * Comprime una imagen con las opciones especificadas
   * @param {File} file - Archivo de imagen
   * @param {string|object} optionsOrPreset - Nombre de preset o objeto con opciones
   * @returns {Promise<File>} Archivo comprimido
   */
  async compress(file, optionsOrPreset = 'consigna') {
    if (!file) {
      console.warn('[ImageOptimizer] No file provided');
      return null;
    }

    // Si es string, usar preset; si es objeto, usar como opciones
    let options = optionsOrPreset;
    if (typeof optionsOrPreset === 'string') {
      options = this.presets[optionsOrPreset] || this.presets.consigna;
    }

    const compressionOptions = {
      maxSizeMB: options.maxSizeMB || 0.3,
      maxWidthOrHeight: options.maxWidthOrHeight || 1024,
      useWebWorker: true,
      fileType: 'image/jpeg',
      initialQuality: options.quality || 0.8
    };

    try {
      console.log(`[ImageOptimizer] Comprimiendo ${file.name} (${(file.size / 1024).toFixed(2)}KB)...`);
      const compressed = await imageCompression(file, compressionOptions);
      console.log(`[ImageOptimizer] ✅ Comprimido a ${(compressed.size / 1024).toFixed(2)}KB (-${(100 * (1 - compressed.size / file.size)).toFixed(1)}%)`);
      return compressed;
    } catch (e) {
      console.error('[ImageOptimizer] Error comprimiendo:', e);
      // Fallback: devolver el original
      console.warn('[ImageOptimizer] Usando imagen original como fallback');
      return file;
    }
  },

  /**
   * Convierte archivo a DataURL (para embedding en Firestore)
   * @param {File} file - Archivo de imagen
   * @param {string|object} optionsOrPreset - Preset o opciones de compresión
   * @returns {Promise<string>} DataURL de la imagen comprimida
   */
  async toDataURL(file, optionsOrPreset = 'consigna') {
    const compressed = await this.compress(file, optionsOrPreset);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(compressed || file);
    });
  },

  /**
   * Convierte archivo a Blob (para subir a Storage)
   * @param {File} file - Archivo de imagen
   * @param {string|object} optionsOrPreset - Preset o opciones de compresión
   * @returns {Promise<Blob>} Blob comprimido
   */
  async toBlob(file, optionsOrPreset = 'consigna') {
    const compressed = await this.compress(file, optionsOrPreset);
    if (compressed instanceof Blob) return compressed;
    return file; // Fallback
  },

  /**
   * Valida si un archivo es imagen válida
   * @param {File} file - Archivo a validar
   * @returns {boolean}
   */
  isValidImage(file) {
    if (!file) return false;
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    return validTypes.includes(file.type);
  },

  /**
   * Obtiene información de una imagen
   * @param {File} file - Archivo de imagen
   * @returns {Promise<object>} { width, height, naturalSize }
   */
  async getImageInfo(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          resolve({
            width: img.width,
            height: img.height,
            naturalSize: file.size,
            type: file.type
          });
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  /**
   * Redimensiona una imagen a dimensiones específicas
   * @param {File} file - Archivo de imagen
   * @param {number} maxWidth - Ancho máximo
   * @param {number} maxHeight - Alto máximo
   * @returns {Promise<File>}
   */
  async resize(file, maxWidth = 1024, maxHeight = 1024) {
    const options = {
      maxSizeMB: 0.5,
      maxWidthOrHeight: Math.max(maxWidth, maxHeight),
      useWebWorker: true,
      fileType: 'image/jpeg'
    };

    try {
      return await imageCompression(file, options);
    } catch (e) {
      console.error('[ImageOptimizer] Error redimensionando:', e);
      return file;
    }
  }
};

console.log('[ImageOptimizer] ✅ Cargado. Uso: await ImageOptimizer.compress(file, "consigna")');
