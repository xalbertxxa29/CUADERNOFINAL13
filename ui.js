// ui.js (v51)
// Utilidades de UI reutilizables en toda la app.
// Expone window.UI: showOverlay, hideOverlay, progress, alert, createSearchableDropdown.

(function () {
  const UI = window.UI || {};

  // ---------------------------
  // Overlay global (cargando…) - anillos + logo + barra opcional
  // ---------------------------
  let overlayEl = null, overlayTitleEl = null, overlaySubEl = null, overlayBarEl = null, overlayCount = 0;

  function ensureOverlay() {
    if (overlayEl) return;

    overlayEl = document.createElement('div');
    overlayEl.id = 'app-overlay';
    overlayEl.setAttribute('aria-hidden', 'true');
    Object.assign(overlayEl.style, {
      position: 'fixed', inset: '0', display: 'none', zIndex: '9999',
      background: 'rgba(0,0,0,.50)', backdropFilter: 'blur(2px)',
      alignItems: 'center', justifyContent: 'center'
    });

    const box = document.createElement('div');
    box.className = 'neo-box';
    Object.assign(box.style, {
      width: 'min(520px, 92vw)', borderRadius: '18px',
      background: 'rgba(17,24,39,.85)', border: '1px solid rgba(255,255,255,.08)',
      boxShadow: '0 20px 60px rgba(0,0,0,.45)', padding: '20px',
      color: '#e9ecf7', display: 'grid', gap: '12px', justifyItems: 'center'
    });

    // --- Spinner con anillos y logo ---
    const spinner = document.createElement('div');
    spinner.className = 'neo-spinner';
    Object.assign(spinner.style, { position: 'relative', width: '84px', height: '84px', marginTop: '4px' });

    const logo = document.createElement('img');
    logo.alt = '';
    logo.src = 'imagenes/logo_192.png';            // si no existe, se oculta
    logo.onerror = () => { logo.style.display = 'none'; };
    Object.assign(logo.style, {
      position: 'absolute', inset: '50% auto auto 50%', transform: 'translate(-50%,-50%)',
      width: '38px', height: '38px', borderRadius: '50%', boxShadow: '0 0 0 2px rgba(0,0,0,.25)'
    });

    // 3 anillos en conic-gradient con distintos offsets/velocidades
    const mkRing = (className, dur, from, to) => {
      const r = document.createElement('div');
      r.className = className;
      Object.assign(r.style, {
        position: 'absolute', inset: '0', borderRadius: '50%',
        mask: 'radial-gradient(farthest-side, transparent calc(100% - 6px), #000 0)',
        background: `conic-gradient(var(--ring-color, #2dd4bf) ${from} ${to}, transparent ${to} 100%)`,
        animation: `neo-spin ${dur} linear infinite`
      });
      return r;
    };

    const ring1 = mkRing('ring-1', '1.2s', '0deg', '90deg');   // verde
    ring1.style.setProperty('--ring-color', '#30d158');
    ring1.style.filter = 'drop-shadow(0 0 6px rgba(48,209,88,.35))';

    const ring2 = mkRing('ring-2', '1.6s', '140deg', '230deg'); // azul
    ring2.style.setProperty('--ring-color', '#3ba0ff');
    ring2.style.animationDirection = 'reverse';
    ring2.style.filter = 'drop-shadow(0 0 6px rgba(59,160,255,.35))';

    const ring3 = mkRing('ring-3', '2.0s', '260deg', '330deg'); // amarillo
    ring3.style.setProperty('--ring-color', '#f5cd19');
    ring3.style.filter = 'drop-shadow(0 0 6px rgba(245,205,25,.35))';

    spinner.append(ring1, ring2, ring3, logo);

    // --- Título / subtítulo ---
    overlayTitleEl = document.createElement('div');
    overlayTitleEl.className = 'neo-title';
    Object.assign(overlayTitleEl.style, { fontSize: '1.05rem', fontWeight: '700', textAlign: 'center', marginTop: '6px' });
    overlayTitleEl.textContent = 'Cargando…';

    overlaySubEl = document.createElement('div');
    overlaySubEl.className = 'neo-sub';
    Object.assign(overlaySubEl.style, { fontSize: '.9rem', color: '#b9c0d4', textAlign: 'center', marginTop: '-2px' });
    overlaySubEl.textContent = '';

    // --- Barra de progreso (opcional/determinada) ---
    const progressWrap = document.createElement('div');
    progressWrap.className = 'neo-progress';
    Object.assign(progressWrap.style, {
      width: '100%', height: '6px', borderRadius: '6px',
      background: 'rgba(255,255,255,.12)', overflow: 'hidden', display: 'none'
    });

    const bar = document.createElement('div');
    Object.assign(bar.style, {
      width: '0%', height: '100%', background: 'linear-gradient(90deg,#30d158,#3ba0ff,#f5cd19)',
      transition: 'width .25s ease', willChange: 'width'
    });
    progressWrap.appendChild(bar);
    overlayBarEl = bar;

    // estilos clave
    const style = document.createElement('style');
    style.textContent = `
      @keyframes neo-spin { from{ transform: rotate(0deg);} to{ transform: rotate(360deg);} }
      @media (prefers-reduced-motion: reduce) {
        .neo-spinner .ring-1,.neo-spinner .ring-2,.neo-spinner .ring-3{ animation-duration: 2.4s !important; }
      }
      /* también estilos mínimos para dropdown items, como en v40 */
      .dropdown-item { padding:.4rem .55rem; cursor:pointer; }
      .dropdown-item:hover, .dropdown-item.active { background: rgba(255,255,255,.06); }
    `;

    box.append(spinner, overlayTitleEl, progressWrap, overlaySubEl);
    overlayEl.append(style, box);
    document.body.appendChild(overlayEl);

    // API interna para mostrar/ocultar barra
    overlayEl._setDeterminate = (enabled) => {
      progressWrap.style.display = enabled ? 'block' : 'none';
    };
  }

  UI.showOverlay = function (title, opts = {}) {
    ensureOverlay();
    overlayCount++;
    if (title) overlayTitleEl.textContent = title;
    if (opts.sub) overlaySubEl.textContent = opts.sub;
    if (Number.isFinite(opts.progress)) {
      UI.setOverlayProgress(opts.progress);
    } else {
      overlayEl._setDeterminate(false);
    }
    overlayEl.style.display = 'flex';
    overlayEl.setAttribute('aria-hidden', 'false');
  };

  UI.setOverlaySub = function (text = '') {
    if (!overlayEl) return;
    overlaySubEl.textContent = text || '';
  };

  UI.setOverlayProgress = function (value) {
    if (!overlayEl) return;
    // admite 0–1 o 0–100
    const pct = value <= 1 ? Math.max(0, Math.min(1, value)) * 100 : Math.max(0, Math.min(100, value));
    overlayEl._setDeterminate(true);
    overlayBarEl.style.width = pct + '%';
  };

  // atajo: también permite actualizar subtítulo
  UI.progress = function (value, sub) {
    if (typeof sub === 'string') UI.setOverlaySub(sub);
    UI.setOverlayProgress(value);
  };

  UI.hideOverlay = function () {
    if (!overlayEl) return;
    overlayCount = Math.max(overlayCount - 1, 0);
    if (overlayCount === 0) {
      overlayEl.style.display = 'none';
      overlayEl.setAttribute('aria-hidden', 'true');
      overlayTitleEl.textContent = 'Cargando…';
      overlaySubEl.textContent = '';
      overlayBarEl.style.width = '0%';
      overlayEl._setDeterminate(false);
    }
  };

  // ---------------------------
  // Alert modal simple (OK) — estilo alineado al overlay
  // ---------------------------
  let alertEl = null, alertOkBtn = null, alertTitleEl = null, alertMsgEl = null, alertOnClose = null;

  function ensureAlert() {
    if (alertEl) return;

    alertEl = document.createElement('div');
    alertEl.id = 'app-alert';
    Object.assign(alertEl.style, {
      position: 'fixed', inset: '0', zIndex: '10000', display: 'none',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,.50)', backdropFilter: 'blur(2px)'
    });

    const box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    Object.assign(box.style, {
      width: 'min(520px, 92vw)', background: '#0f152b',
      border: '1px solid rgba(255,255,255,.08)', borderRadius: '18px',
      boxShadow: '0 12px 36px rgba(0,0,0,.45)', padding: '18px'
    });

    alertTitleEl = document.createElement('h3');
    Object.assign(alertTitleEl.style, { margin: '0 0 .5rem', fontSize: '1.1rem' });

    alertMsgEl = document.createElement('div');
    Object.assign(alertMsgEl.style, { color: '#cfd4e5', fontSize: '.95rem', whiteSpace: 'pre-wrap' });

    const actions = document.createElement('div');
    Object.assign(actions.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '1rem' });

    alertOkBtn = document.createElement('button');
    alertOkBtn.className = 'btn-primary';
    alertOkBtn.textContent = 'OK';

    actions.appendChild(alertOkBtn);
    box.append(alertTitleEl, alertMsgEl, actions);
    alertEl.appendChild(box);
    document.body.appendChild(alertEl);

    function close() {
      alertEl.style.display = 'none';
      if (typeof alertOnClose === 'function') { const cb = alertOnClose; alertOnClose = null; cb(); }
    }
    alertOkBtn.addEventListener('click', close);
    alertEl.addEventListener('click', (e) => { if (e.target === alertEl) close(); });
    document.addEventListener('keydown', (e) => { if (alertEl.style.display !== 'none' && e.key === 'Escape') close(); });
  }

  UI.alert = function (title, message, onClose) {
    ensureAlert();
    alertTitleEl.textContent = title || 'Aviso';
    alertMsgEl.textContent = message || '';
    alertOnClose = onClose || null;
    alertEl.style.display = 'flex';
    setTimeout(() => alertOkBtn.focus(), 0); // accesibilidad
  };

  // ------------------------------------------------
  // Dropdown buscable (cliente/unidad/puesto)
  // ------------------------------------------------
  // Uso:
  // UI.createSearchableDropdown(inputEl, listEl, itemsArray, (value)=>{...})
  // Devuelve un objeto con método .update(newItems)
  UI.createSearchableDropdown = function (inputEl, listEl, items, onSelect) {
    if (!inputEl || !listEl) return;
    let data = Array.isArray(items) ? items.slice() : [];
    let open = false;
    let activeIndex = -1;

    // Asegurar estilos base del contenedor de lista
    listEl.style.display = 'none';
    listEl.style.maxHeight = '260px';
    listEl.style.overflow = 'auto';

    function render(query) {
      const q = String(query || '').toLowerCase();
      const filtered = data.filter(x => String(x).toLowerCase().includes(q)).slice(0, 80);
      listEl.innerHTML = filtered.map((x, i) =>
        `<div class="dropdown-item${i === activeIndex ? ' active' : ''}" data-idx="${i}" data-v="${escapeHtml(x)}">${escapeHtml(x)}</div>`
      ).join('');
      if (filtered.length) { listEl.style.display = 'block'; open = true; }
      else { listEl.style.display = 'none'; open = false; }
    }

    function close() { listEl.style.display = 'none'; open = false; activeIndex = -1; }

    function commitSelection(idx) {
      const itemsEls = listEl.querySelectorAll('.dropdown-item');
      const el = (idx != null) ? itemsEls[idx] : null;
      const val = el ? el.getAttribute('data-v') : inputEl.value.trim();
      if (!val) { close(); return; }
      inputEl.value = val;
      close();
      onSelect && onSelect(val);
    }

    inputEl.setAttribute('autocomplete', 'off');
    inputEl.addEventListener('input', () => { activeIndex = -1; render(inputEl.value); });
    inputEl.addEventListener('focus', () => { activeIndex = -1; render(inputEl.value); });
    inputEl.addEventListener('blur', () => { setTimeout(close, 120); });

    listEl.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.dropdown-item');
      if (!item) return;
      const idx = Number(item.getAttribute('data-idx'));
      commitSelection(idx);
      e.preventDefault();
    });

    inputEl.addEventListener('keydown', (e) => {
      const itemsEls = listEl.querySelectorAll('.dropdown-item');
      if (e.key === 'ArrowDown') {
        if (!open) { render(inputEl.value); return; }
        activeIndex = Math.min(activeIndex + 1, itemsEls.length - 1);
        updateActive(itemsEls);
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        if (!open) { render(inputEl.value); return; }
        activeIndex = Math.max(activeIndex - 1, 0);
        updateActive(itemsEls);
        e.preventDefault();
      } else if (e.key === 'Enter') {
        if (open) { commitSelection(activeIndex >= 0 ? activeIndex : null); e.preventDefault(); }
      } else if (e.key === 'Escape') {
        close(); e.preventDefault();
      }
    });

    function updateActive(itemsEls) {
      itemsEls.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
      const el = itemsEls[activeIndex];
      if (el) {
        const r = el.getBoundingClientRect();
        const pr = listEl.getBoundingClientRect();
        if (r.top < pr.top) el.scrollIntoView({ block: 'nearest' });
        if (r.bottom > pr.bottom) el.scrollIntoView({ block: 'nearest' });
      }
    }

    // API pública
    const api = {
      update(newItems) {
        data = Array.isArray(newItems) ? newItems.slice() : [];
        if (document.activeElement === inputEl) render(inputEl.value);
        else close();
      },
      close
    };
    return api;
  };

  function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }

  // Exponer
  window.UI = UI;
})();

// (Nota) Tu archivo anterior ya exponía window.UI y métodos como showOverlay/hideOverlay;
// este mantiene el mismo API para compatibilidad. :contentReference[oaicite:3]{index=3}

