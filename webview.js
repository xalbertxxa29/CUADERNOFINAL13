// webview.js — helpers universales para WebView

(function(){
  // 1) Fijar --vh real (evita “corte” de 100vh en móviles y barras dinámicas)
  const setVH = () => {
    const vh = window.visualViewport ? window.visualViewport.height * 0.01 : window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  };
  setVH();
  window.addEventListener('resize', setVH);
  window.addEventListener('orientationchange', () => setTimeout(setVH, 250));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', setVH);
  }

  // 2) Evitar que el teclado tape inputs/botones (Android+iOS)
  const ensureVisible = (el) => {
    try {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch {}
  };
  document.addEventListener('focusin', (e) => {
    const target = e.target;
    if (/(input|textarea|select)/i.test(target.tagName)) {
      setTimeout(() => ensureVisible(target), 100);
    }
  });

  // 3) Arreglar firma en canvas (redimensionar correctamente con DPR)
  window.addEventListener('resize', () => {
    document.querySelectorAll('canvas#firma-canvas').forEach((canvas) => {
      const sigPad = canvas._signaturePadInstance; // si lo guardas tú
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const { width } = canvas.getBoundingClientRect();
      // Mantiene altura CSS (p.ej. 180px)
      const height = parseFloat(getComputedStyle(canvas).height);
      canvas.width  = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      const ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);
      if (sigPad && sigPad.clear) sigPad.clear();
    });
  });

  // 4) Ajuste rápido para iframes internos
  window.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === 'resize-iframe' && typeof ev.data.height === 'number') {
      try {
        const frame = document.querySelector(`iframe[name="${ev.data.name}"]`) || document.getElementById(ev.data.id || '');
        if (frame) frame.style.minHeight = `${ev.data.height}px`;
      } catch {}
    }
  }, { passive: true });

  // 5) Back nativo del WebView → simular “Atrás” si existe
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const lb = document.getElementById('imageLightbox');
      if (lb && !lb.hasAttribute('hidden')) { lb.setAttribute('hidden',''); return; }
      if (history.length > 1) history.back();
    }
  });

  // 6) File input captura (mejor consistencia)
  document.querySelectorAll('input[type="file"][accept*="image"]').forEach(inp => {
    // Android a veces necesita 'environment' explícito
    if (!inp.hasAttribute('capture')) inp.setAttribute('capture', 'environment');
  });

})();
