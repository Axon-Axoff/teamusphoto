(() => {
  let navSeq = 0;           // increments for each nav attempt
  let lastSuccessSeq = 0;   // last nav that completed successfully
  let navAbort = null;      // AbortController for in-flight fetch
  let errorTimer = null;    // timer to delay error toast

  // --- CSRF helper
  function getCookie(name) {
    const m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return m ? decodeURIComponent(m.pop()) : null;
  }
  const csrftoken = getCookie('csrftoken');

  // --- Ensure we have a mount
  let mount = document.getElementById('photoDetailModalMount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'photoDetailModalMount';
    document.body.appendChild(mount);
    console.warn('#photoDetailModalMount was missing; created one at <body> end.');
  }

  // --- Build order + id->url map from the actual thumbnails on this page
  const idToUrl = new Map();
  const photoOrder = [];
  document.querySelectorAll('.js-open-photo').forEach(a => {
    const id = parseInt(a.dataset.photoId, 10);
    if (Number.isFinite(id)) {
      photoOrder.push(id);
      idToUrl.set(id, a.getAttribute('href'));
    }
  });

  let currentIndex = -1;
  let bsModal = null;

  async function fetchDetailHtml(url) {
    const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Fetch failed ${res.status} ${res.statusText}. Body: ${text.slice(0,200)}`);
    }
    if (!ct.includes('application/json')) {
      const snippet = await res.text().catch(() => '');
      throw new Error(`Expected JSON, got "${ct}". Possible login redirect. Snippet: ${snippet.slice(0,200)}`);
    }
    const data = await res.json();
    if (!data || typeof data.html !== 'string') {
      throw new Error('JSON missing "html" key.');
    }
    return data.html;
  }

  async function postForm(url, formEl) {
    const fd = new FormData(formEl);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRFToken': csrftoken
      },
      body: fd
    });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok) throw new Error(`POST failed ${res.status}`);
    if (!ct.includes('application/json')) throw new Error(`Expected JSON, got ${ct}`);
    const data = await res.json();
    return data; // <-- not data.html
  }

  function ensureCountEl(kind, photo_id, label) {
    // kind: 'fav' or 'comment'
    const cls = kind === 'fav' ? 'js-fav-count' : 'js-comment-count';
    let container = document.querySelector(`.${cls}[data-photo-id="${photo_id}"]`);
    if (!container) {
      // create it if it doesn't exist (e.g., you left the conditional rendering)
      const tile = document.querySelector(`.js-photo-tile[data-photo-id="${photo_id}"]`);
      const anchor = tile?.querySelector('a.js-open-photo');
      if (!anchor) return null;
      container = document.createElement('span');
      container.className = `date ${kind === 'fav' ? 'favorites' : 'comments'} ${cls}`;
      container.setAttribute('data-photo-id', String(photo_id));
      container.innerHTML = `<strong><nobr>*${label} (<span class="js-num">0</span>)</nobr></strong>`;
      anchor.appendChild(container);
    }
    return container.querySelector('.js-num');
  }

  function setCount(kind, photo_id, count) {
    // kind: 'fav' or 'comment'
    const sel = kind === 'fav'
      ? `.js-fav-count[data-photo-id="${photo_id}"]`
      : `.js-comment-count[data-photo-id="${photo_id}"]`;

    const container = document.querySelector(sel);
    if (!container) return;

    const numEl = container.querySelector('.js-num');
    if (numEl) numEl.textContent = count;

    // hide when zero, show otherwise
    container.classList.toggle('d-none', count === 0);
  }

  function patchListUI(delta) {
    const { photo_id, is_favorite, favorites_count, comments_count } = delta;

    setCount('fav', photo_id, favorites_count);
    setCount('comment', photo_id, comments_count);

    // optional: tile styling/indicator
    const tile = document.querySelector(`.js-photo-tile[data-photo-id="${photo_id}"]`);
    tile?.classList.toggle('is-favorite', !!is_favorite);
  }

  async function fetchDetailHtmlWithSignal(url, signal) {
    const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, signal });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!ct.includes('application/json')) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Expected JSON; got ${ct}. ${txt.slice(0,200)}`);
    }
    const data = await res.json();
    if (!data || typeof data.html !== 'string') throw new Error('Missing html in JSON.');
    return data.html;
  }

  function toastInModal(msg) {
    const modalEl = document.getElementById('photoDetailModal');
    if (!modalEl) return;
    let t = modalEl.querySelector('.js-modal-error');
    if (!t) {
      t = document.createElement('div');
      t.className = 'js-modal-error position-fixed top-0 start-50 translate-middle-x mt-3 px-3 py-2 rounded bg-danger text-white small';
      t.style.zIndex = '2000';
      modalEl.appendChild(t);
    }
    t.textContent = msg;
    t.hidden = false;
    setTimeout(() => { if (t) t.hidden = true; }, 1600);
  }

  // Simple in-memory cache so rapid nav feels instant
  // Cache HTML for instant back/forward
  const htmlCache = new Map();
  let spinnerTimer = null;

  function preloadImage(src) {
    return new Promise((resolve) => {
      if (!src) return resolve();
      const i = new Image();
      i.onload = i.onerror = () => resolve();
      i.src = src;
    });
  }

  async function getDetailHtml(id, url) {
    if (htmlCache.has(id)) return htmlCache.get(id);
    const html = await fetchDetailHtml(url); // your existing fetcher
    htmlCache.set(id, html);
    return html;
  }

  function showLoadingWithDelay(modalEl, on) {
    const content = modalEl.querySelector('.modal-content');
    if (!content) return;
    if (on) {
      clearTimeout(spinnerTimer);
      spinnerTimer = setTimeout(() => {
        if (content.querySelector('.js-modal-loading')) return;
        const veil = document.createElement('div');
        veil.className = 'js-modal-loading position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center';
        veil.style.background = 'rgba(0,0,0,.20)';
        veil.style.zIndex = '1061';
        veil.innerHTML = '<div class="spinner-border text-light" role="status" aria-label="Loading"></div>';
        content.appendChild(veil);
      }, 120); // only show if slow
    } else {
      clearTimeout(spinnerTimer);
      const veil = content.querySelector('.js-modal-loading');
      if (veil) veil.remove();
    }
  }

  // Cross-fade only the inner swappable area, after the next image is preloaded
  async function swapModalContentSmooth(modalEl, newHtml) {
    const oldSwap = modalEl.querySelector('.js-modal-swap');
    if (!oldSwap) throw new Error('Missing .js-modal-swap in current modal');

    const tmp = document.createElement('div');
    tmp.innerHTML = newHtml;

    const incomingSwap =
      tmp.querySelector('#photoDetailModal .js-modal-swap') ||
      tmp.querySelector('.js-modal-swap');

    if (!incomingSwap) throw new Error('Missing .js-modal-swap in new HTML');

    // Preload main image to avoid white flash
    const nextImg = incomingSwap.querySelector('img');
    if (nextImg?.src) {
      await preloadImage(nextImg.src);
    }

    // Stabilize height during swap to avoid layout jump
    oldSwap.style.minHeight = oldSwap.offsetHeight + 'px';

    // Fade out old, then replace and fade in new
    oldSwap.classList.remove('show');
    oldSwap.addEventListener('transitionend', () => {
      oldSwap.replaceWith(incomingSwap);
      // Ensure the new node has the fade classes
      incomingSwap.classList.add('swap-fade');
      // Start from 0 → 1
      requestAnimationFrame(() => {
        incomingSwap.classList.add('show');
        // release min-height after fade finishes
        incomingSwap.addEventListener('transitionend', () => {
          incomingSwap.style.minHeight = '';
        }, { once: true });
      });
    }, { once: true });
  }

  // (optional) warm the cache for adjacent items
  function preloadAround(idx, order, idToUrl) {
    const nextId = order[(idx + 1) % order.length];
    const prevId = order[(idx - 1 + order.length) % order.length];
    [nextId, prevId].forEach((pid) => {
      const url = idToUrl.get(pid);
      if (!url || htmlCache.has(pid)) return;
      fetchDetailHtml(url).then((html) => {
        htmlCache.set(pid, html);
        // warm the image too
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const img = tmp.querySelector('.js-modal-swap img');
        if (img?.src) preloadImage(img.src);
      }).catch(() => {});
    });
  }

  async function openByIndex(idx) {
    if (idx < 0 || idx >= photoOrder.length) return;
    const id  = photoOrder[idx];
    const url = idToUrl.get(id);
    if (!url) return;

    const existingModal = document.getElementById('photoDetailModal');

    // First open: mount the modal once
    if (!existingModal) {
      const html = await getDetailHtml(id, url);
      mount.innerHTML = html;

      const modalEl = document.getElementById('photoDetailModal');
      if (!modalEl) throw new Error('#photoDetailModal not found');

      if (bsModal) { bsModal.hide(); bsModal.dispose?.(); }
      bsModal = new bootstrap.Modal(modalEl, { backdrop: true, keyboard: true, focus: true });
      bsModal.show();

      // wire your existing events (prev/next, submit delegation, arrows)
      wireModalEvents(modalEl, url);

      currentIndex = idx;
      preloadAround(currentIndex, photoOrder, idToUrl);
      return;
    }

    // Modal is open: keep it open and cross-fade the inner content
    const modalEl = existingModal;
    try {
      showLoadingWithDelay(modalEl, true);
      const html = await getDetailHtml(id, url);
      await swapModalContentSmooth(modalEl, html);
      currentIndex = idx;
      preloadAround(currentIndex, photoOrder, idToUrl);
    } finally {
      showLoadingWithDelay(modalEl, false);
    }
  }

  function wireModalEvents(modalEl, currentUrl) {
    const prevBtn = modalEl.querySelector('#photoPrevBtn');
    const nextBtn = modalEl.querySelector('#photoNextBtn');

    prevBtn?.addEventListener('click', () => {
      openByIndex((currentIndex - 1 + photoOrder.length) % photoOrder.length);
    });
    nextBtn?.addEventListener('click', () => {
      openByIndex((currentIndex + 1) % photoOrder.length);
    });

    modalEl.addEventListener('submit', async (e) => {
      const form = e.target;
      if (!form.matches('.fav-form, .comment-form')) return;
      e.preventDefault();

      try {
        const data = await postForm(currentUrl, form); // <-- full JSON

        // Replace only the inner modal content so the modal stays open
        const tmp = document.createElement('div');
        tmp.innerHTML = data.html;
        const incoming = tmp.querySelector('#photoDetailModal .modal-content') || tmp.querySelector('.modal-content');
        const current = modalEl.querySelector('.modal-content');

        if (incoming && current) {
          current.replaceWith(incoming);
          wireModalEvents(modalEl, currentUrl); // rewire new buttons/forms
        } else {
          // fallback safe remount
          const inst = bootstrap.Modal.getInstance(modalEl);
          inst?.hide();
          modalEl.addEventListener('hidden.bs.modal', () => {
            mount.innerHTML = data.html;
            const fresh = document.getElementById('photoDetailModal');
            const newInst = new bootstrap.Modal(fresh);
            newInst.show();
            wireModalEvents(fresh, currentUrl);
          }, { once: true });
        }

        // 🔁 Update the list page in the background
        patchListUI(data);

      } catch (err) {
        handleError(err);
      }
    }, { passive: false });

    // Arrow keys while open (Bootstrap handles Esc)
    const onKey = (e) => {
      if (!document.body.classList.contains('modal-open')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); openByIndex((currentIndex - 1 + photoOrder.length) % photoOrder.length); }
      if (e.key === 'ArrowRight') { e.preventDefault(); openByIndex((currentIndex + 1) % photoOrder.length); }
    };
    modalEl.addEventListener('shown.bs.modal', () => document.addEventListener('keydown', onKey));
    modalEl.addEventListener('hide.bs.modal', () => document.removeEventListener('keydown', onKey));
  }

  // Intercept thumbnail clicks (strong prevention)
  document.addEventListener('click', (e) => {
    const a = e.target.closest('.js-open-photo');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

    const id = parseInt(a.dataset.photoId, 10);
    const idx = photoOrder.indexOf(id);
    if (idx === -1) { console.warn('Photo id not in current 24:', id); return; }

    openByIndex(idx)
  });

})();
