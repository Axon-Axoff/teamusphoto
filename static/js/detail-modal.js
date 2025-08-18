(() => {
  'use strict';

  // Prevent double-binding
  if (window.__photoModalBound) return;
  window.__photoModalBound = true;

  // =========================
  // Config / selectors
  // =========================
  const THUMB_SELECTOR = '.js-open-photo';
  const TILE_SELECTOR  = '.js-photo-tile';
  const MODAL_ID       = 'photoDetailModal';   // id on the Bootstrap modal root
  const SWAP_SELECTOR  = '.js-modal-swap';     // inner swappable area (inside .modal-body)
  const PREV_ID        = 'photoPrevBtn';
  const NEXT_ID        = 'photoNextBtn';

  // =========================
  // State
  // =========================
  const idToUrl = new Map();
  const order   = [];
  let currentIndex = -1;

  let bsModal = null;                // Bootstrap modal instance
  const htmlCache = new Map();       // id -> { html, comments_count, favorites_count, ... }
  let spinnerTimer = null;           // delayed spinner
  let navSeq = 0;                    // navigation attempt sequence
  let navAbort = null;               // AbortController for inflight fetches

  // Ensure a mount exists for the photo detail modal
  let mount = document.getElementById('photoDetailModalMount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'photoDetailModalMount';
    document.body.appendChild(mount);
  }

  // Ensure a mount exists for the activity modal
  let activityMount = document.getElementById('activityModalMount');
  if (!activityMount) {
    activityMount = document.createElement('div');
    activityMount.id = 'activityModalMount';
    document.body.appendChild(activityMount);
  }

  // =========================
  // CSRF helpers (Django)
  // =========================
  function getCookie(name) {
    const m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return m ? decodeURIComponent(m.pop()) : null;
  }
  // Prefer default name; optionally allow legacy name
  function getCsrfToken() {
    return getCookie('csrftoken') || getCookie('csrftoken_v2');
  }

  // =========================
  // Build / rebuild mapping from DOM
  // =========================
  function rebuildOrderFromDOM() {
    idToUrl.clear();
    order.length = 0;
    document.querySelectorAll(THUMB_SELECTOR).forEach(a => {
      const id = parseInt(a.dataset.photoId, 10);
      if (Number.isFinite(id)) {
        order.push(id);
        idToUrl.set(id, a.getAttribute('href'));
      }
    });
  }
  function indexForAnchor(a) {
    const id = parseInt(a.dataset.photoId, 10);
    if (!Number.isFinite(id)) return -1;
    let idx = order.indexOf(id);
    if (idx === -1) { rebuildOrderFromDOM(); idx = order.indexOf(id); }
    return idx;
  }
  // Initial build
  rebuildOrderFromDOM();
  if (order.length === 0) return;

  // =========================
  // Fetch utilities
  // =========================
  async function fetchJSON(url, { signal } = {}) {
    const res = await fetch(url, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
      signal
    });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText} :: ${text.slice(0,200)}`);
    }
    if (!ct.includes('application/json')) {
      const text = await res.text().catch(() => '');
      throw new Error(`Expected JSON; got ${ct}. ${text.slice(0,200)}`);
    }
    return res.json();
  }

  async function fetchDetailHTML(url, { signal } = {}) {
    const data = await fetchJSON(url, { signal });
    if (!data || typeof data.html !== 'string') throw new Error('Response missing "html"');
    return data; // { html, photo_id?, comments_count?, favorites_count?, ... }
  }

  async function postForm(url, formEl) {
    const fd = new FormData(formEl);
    const token = getCsrfToken();
    if (!token) throw new Error('No CSRF cookie present.');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRFToken': token
      },
      credentials: 'same-origin',
      body: fd
    });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`POST ${res.status} ${res.statusText} :: ${text.slice(0,200)}`);
    }
    if (!ct.includes('application/json')) throw new Error(`Expected JSON; got ${ct}`);
    const data = await res.json();
    if (!data || typeof data.html !== 'string') throw new Error('Response missing "html"');
    return data; // { html, photo_id, is_favorite, favorites_count, comments_count }
  }

  // =========================
  // Cache helpers / preload
  // =========================
  function preloadImage(src) {
    return new Promise(resolve => {
      if (!src) return resolve();
      const i = new Image();
      i.onload = i.onerror = resolve;
      i.src = src;
    });
  }

  function preloadAround(idx) {
    if (!order.length) return;
    const ids = [
      order[(idx + 1) % order.length],
      order[(idx - 1 + order.length) % order.length]
    ];
    ids.forEach(async (pid) => {
      const url = idToUrl.get(pid);
      if (!url || htmlCache.has(pid)) return;
      try {
        const data = await fetchDetailHTML(url);
        htmlCache.set(pid, data);
        const tmp = document.createElement('div');
        tmp.innerHTML = data.html;
        const img = tmp.querySelector(`${SWAP_SELECTOR} img`);
        if (img?.src) preloadImage(img.src);
      } catch { /* ignore preload errors */ }
    });
  }

  // Read current list-tile counts (to decide if cache is stale)
  function readTileCounts(photoId) {
    const cEl = document.querySelector(`.js-comment-count[data-photo-id="${photoId}"] .js-num`);
    const fEl = document.querySelector(`.js-fav-count[data-photo-id="${photoId}"] .js-num`);
    const c = cEl ? parseInt(cEl.textContent || '0', 10) : null;
    const f = fEl ? parseInt(fEl.textContent || '0', 10) : null;
    return { comments: Number.isFinite(c) ? c : null, favorites: Number.isFinite(f) ? f : null };
  }
  function sameCount(a, b) {
    if (a == null || b == null) return true;     // if either unknown, don't invalidate cache
    return Number(a) === Number(b);
  }
  async function getDetailEnsuringFreshness(id, url, { signal } = {}) {
    const tileCounts = readTileCounts(id);             // {comments, favorites} or nulls
    const cached = htmlCache.get(id);
    if (cached &&
        sameCount(cached.comments_count, tileCounts.comments) &&
        sameCount(cached.favorites_count, tileCounts.favorites)) {
      return cached;
    }
    const fresh = await fetchDetailHTML(url, { signal }); // { html, comments_count, favorites_count, ... }
    htmlCache.set(id, fresh);
    return fresh;
  }

  // =========================
  // UI helpers
  // =========================
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
      }, 120); // show only if slow
    } else {
      clearTimeout(spinnerTimer);
      const veil = content.querySelector('.js-modal-loading');
      if (veil) veil.remove();
    }
  }

  function toastInModal(msg) {
    const modalEl = document.getElementById(MODAL_ID);
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

  // Cross-fade only SWAP_SELECTOR area; fallback to replacing .modal-content
  async function swapModalContentSmooth(modalEl, newHTML) {
    const oldSwap = modalEl.querySelector(SWAP_SELECTOR);
    const tmp = document.createElement('div');
    tmp.innerHTML = newHTML;

    const incomingSwap =
      tmp.querySelector(`#${MODAL_ID} ${SWAP_SELECTOR}`) ||
      tmp.querySelector(SWAP_SELECTOR);

    if (!oldSwap || !incomingSwap) {
      // Fallback: replace entire .modal-content
      const incomingContent = tmp.querySelector(`#${MODAL_ID} .modal-content`) || tmp.querySelector('.modal-content');
      const currentContent  = modalEl.querySelector('.modal-content');
      if (incomingContent && currentContent) currentContent.replaceWith(incomingContent);
      return;
    }

    // Preload image
    const nextImg = incomingSwap.querySelector('img');
    if (nextImg?.src) await preloadImage(nextImg.src);

    // Keep height stable while fading
    oldSwap.style.minHeight = oldSwap.offsetHeight + 'px';

    // Fade out old, replace, fade in new
    oldSwap.classList.remove('show');
    oldSwap.addEventListener('transitionend', () => {
      oldSwap.replaceWith(incomingSwap);
      incomingSwap.classList.add('swap-fade');
      requestAnimationFrame(() => {
        incomingSwap.classList.add('show');
        incomingSwap.addEventListener('transitionend', () => {
          incomingSwap.style.minHeight = '';
        }, { once: true });
      });
    }, { once: true });
  }

  // Update counts/indicator on the underlying list tile
  function setCount(kind, photoId, count) {
    const sel = kind === 'fav'
      ? `.js-fav-count[data-photo-id="${photoId}"]`
      : `.js-comment-count[data-photo-id="${photoId}"]`;
    const el = document.querySelector(sel);
    if (!el) return;
    const num = el.querySelector('.js-num');
    if (num) num.textContent = String(count);
    el.classList.toggle('d-none', count === 0);
  }

  function patchListUI(delta) {
    const { photo_id, is_favorite, favorites_count, comments_count } = delta;
    if (typeof photo_id !== 'number' && typeof photo_id !== 'string') return;
    setCount('fav', photo_id, favorites_count ?? 0);
    setCount('comment', photo_id, comments_count ?? 0);
    const tile = document.querySelector(`${TILE_SELECTOR}[data-photo-id="${photo_id}"]`);
    tile?.classList.toggle('is-favorite', !!is_favorite);
  }

  // Ensure any backdrop/body lock is fully cleared and remove modal DOM
  function hardTeardownModal(modalEl) {
    try {
      document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
      document.body.classList.remove('modal-open');
      document.body.style.removeProperty('padding-right');
    } catch {}
    modalEl.remove();
    if (mount && !mount.firstChild) mount.style.pointerEvents = 'none';
  }

  // ======== Layering for stacked modals ========
  const Z_INDEX = {
    activity: { modal: 2000, backdrop: 1990 },
    detail:   { modal: 3000, backdrop: 2990 },
  };

  document.addEventListener('show.bs.modal', (e) => {
    const modal = e.target;
    if (modal.id === 'photoDetailModal') {
      modal.style.zIndex = String(Z_INDEX.detail.modal);
    } else if (modal.id === 'activityModal') {
      modal.style.zIndex = String(Z_INDEX.activity.modal);
    }
  });

  // Set backdrop z-index after Bootstrap inserts it
  document.addEventListener('shown.bs.modal', (e) => {
    const modal = e.target;
    const backs = document.querySelectorAll('.modal-backdrop');
    const bd = backs[backs.length - 1]; // the one just added for this modal
    if (!bd) return;

    if (modal.id === 'photoDetailModal') {
      bd.style.zIndex = String(Z_INDEX.detail.backdrop);
    } else if (modal.id === 'activityModal') {
      bd.style.zIndex = String(Z_INDEX.activity.backdrop);
    }
  });

  // =========================
  // Core: open / navigate
  // =========================
  async function openByIndex(idx) {
    if (idx < 0 || idx >= order.length) return;

    const seq = ++navSeq;
    if (navAbort) navAbort.abort();
    navAbort = new AbortController();

    const id  = order[idx];
    const url = idToUrl.get(id);
    if (!url) return;

    const modalElExisting = document.getElementById(MODAL_ID);

    // First open: mount and wire once
    if (!modalElExisting) {
      try {
        const data = await getDetailEnsuringFreshness(id, url, { signal: navAbort.signal });
        if (seq !== navSeq) return; // superseded

        mount.innerHTML = data.html;
        mount.style.pointerEvents = 'auto';

        const modalEl = document.getElementById(MODAL_ID);
        if (!modalEl) throw new Error(`#${MODAL_ID} not found`);

        if (bsModal) { bsModal.hide(); bsModal.dispose?.(); }
        bsModal = new bootstrap.Modal(modalEl, { backdrop: true, keyboard: true, focus: true });
        bsModal.show();

        // Wire events once per open life (delegated)
        wireModalEvents(modalEl);

        // Hard teardown when fully hidden
        modalEl.addEventListener('hidden.bs.modal', () => {
          hardTeardownModal(modalEl);
          bsModal = null;
        }, { once: true });

        // record current
        currentIndex = idx;
        modalEl.setAttribute('data-photo-id', String(id));

        // Warm next/prev
        preloadAround(currentIndex);
      } catch (err) {
        if (err.name !== 'AbortError' && seq === navSeq) {
          console.error(err);
          toastInModal('Sorry, could not load that photo.');
        }
      }
      return;
    }

    // Modal already open → keep open, swap content smoothly
    const modalEl = modalElExisting;
    try {
      showLoadingWithDelay(modalEl, true);
      const data = await getDetailEnsuringFreshness(id, url, { signal: navAbort.signal });
      if (seq !== navSeq) return; // superseded

      await swapModalContentSmooth(modalEl, data.html);
      currentIndex = idx;
      modalEl.setAttribute('data-photo-id', String(id));
      preloadAround(currentIndex);
    } catch (err) {
      if (err.name !== 'AbortError' && seq === navSeq) {
        console.error(err);
        toastInModal('Sorry, could not load that photo.');
      }
    } finally {
      showLoadingWithDelay(modalEl, false);
    }
  }

  // =========================
  // Event wiring (delegated; wired once)
  // =========================
  function wireModalEvents(modalEl) {
    if (modalEl.dataset.wired === '1') return;
    modalEl.dataset.wired = '1';

    // Prev / Next (delegated so it survives content swaps)
    modalEl.addEventListener('click', (e) => {
      const prev = e.target.closest(`#${PREV_ID}`);
      if (prev) {
        e.preventDefault();
        openByIndex((currentIndex - 1 + order.length) % order.length);
        return;
      }
      const next = e.target.closest(`#${NEXT_ID}`);
      if (next) {
        e.preventDefault();
        openByIndex((currentIndex + 1) % order.length);
      }
    });

    // Submit delegation (favorites / add comment / delete comment / edit comment)
    modalEl.addEventListener('submit', async (e) => {
      const form = e.target;
      if (!form.matches('.fav-form, .comment-form, .comment-delete-form, .comment-edit-form')) return;
      e.preventDefault();

      try {
        // Default to current photo detail URL; allow form-specific action (e.g., delete/edit endpoints)
        const id = parseInt(modalEl.getAttribute('data-photo-id'), 10);
        let url = idToUrl.get(id);
        const actionUrl = form.getAttribute('action');
        if (actionUrl) url = actionUrl;

        const data = await postForm(url, form);

        // Refresh modal content in-place
        await swapModalContentSmooth(modalEl, data.html);

        // Keep id up to date
        const newId = Number(data.photo_id ?? id);
        modalEl.setAttribute('data-photo-id', String(newId));

        // Reflect counts on the underlying list tile
        patchListUI(data);

        // Update cache for this photo to prevent showing stale comments on quick reopen
        if (Number.isFinite(newId)) {
          htmlCache.set(newId, data);   // data should include { html, comments_count, favorites_count, ... }
        }
      } catch (err) {
        console.error(err);
        toastInModal('Sorry, could not update that.');
      }
    }, { passive: false });

    // Arrow keys while open
    const onKey = (e) => {
      if (!document.body.classList.contains('modal-open')) return;
      if (e.key === 'ArrowLeft')  { e.preventDefault(); openByIndex((currentIndex - 1 + order.length) % order.length); }
      if (e.key === 'ArrowRight') { e.preventDefault(); openByIndex((currentIndex + 1) % order.length); }
    };
    modalEl.addEventListener('shown.bs.modal', () => document.addEventListener('keydown', onKey));
    modalEl.addEventListener('hide.bs.modal',   () => document.removeEventListener('keydown', onKey));
  }

  // =========================
  // Intercept thumbnail clicks
  // =========================
  document.addEventListener('click', (e) => {
    const a = e.target.closest(THUMB_SELECTOR);
    if (!a) return;

    const idx = indexForAnchor(a);

    if (idx !== -1) {
      // Handle via modal → block navigation
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();

      openByIndex(idx).catch((err) => {
        console.error('[modal open failed, falling back to navigation]', err);
        // Fail-safe: let the click behave like a normal link if something breaks
        window.location.href = a.href;
      });
      return;
    }

    // Not one of the current 24 (or mapping failed) → allow normal navigation
  }, { capture: true });

  // =========================
  // Recent Activity modal
  // =========================
  async function openActivityModal() {
    try {
      const data = await fetchJSON('/photo/activity/');
      activityMount.innerHTML = data.html;

      const el = document.getElementById('activityModal');
      const m = new bootstrap.Modal(el, { backdrop: true, keyboard: true, focus: true });
      m.show();

      el.addEventListener('hidden.bs.modal', () => {
        // hard remove so it never blocks clicks
        el.remove();
        document.querySelectorAll('.modal-backdrop').forEach(x => x.remove());
        document.body.classList.remove('modal-open');
        document.body.style.removeProperty('padding-right');
      }, { once: true });
    } catch (err) {
      console.error(err);
    }
  }

  // Wire the Recent Activity button
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#recentActivityBtn');
    if (!btn) return;
    e.preventDefault();
    openActivityModal();
  });

})();