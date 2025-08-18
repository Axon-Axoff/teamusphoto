document.addEventListener('DOMContentLoaded', () => {
  // ---------------------------------------------------------------------------
  // CONFIG
  // ---------------------------------------------------------------------------
  const PAIRS = [
    ['id_people', 'dd_people'],
    ['id_tags',   'dd_tags'  ],
  ];
  const SPACER_TEXT  = '~~~~~~~~~~~~~~~~~~~~';
  const SPACER_COLOR = 'blue';

  // ---------------------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------------------
  const state = new Map(); // key by either inputId or selectId -> {inputEl, selectEl, termsUC}

  // Build per-pair state
  for (const [inputId, selectId] of PAIRS) {
    const inputEl  = document.getElementById(inputId);
    const selectEl = document.getElementById(selectId);
    if (!inputEl || !selectEl) continue;

    const termsUC = Array.from(selectEl.options).map(opt => opt.text);
    const bucket = { inputEl, selectEl, termsUC };
    state.set(inputId, bucket);
    state.set(selectId, bucket);

    // Events — mobile friendly:
    inputEl.addEventListener('input', onInputChange);
    inputEl.addEventListener('keydown', onInputKeydown);
    selectEl.addEventListener('change', onSelectChange);
  }

  // ---------------------------------------------------------------------------
  // EVENT HANDLERS
  // ---------------------------------------------------------------------------

  function onSelectChange(e) {
    const s = state.get(e.currentTarget.id);
    if (!s) return;

    const selected = s.selectEl.value;
    // Build current tokens
    const tokens = splitTokens(s.inputEl.value);

    // Last token = current search; replace if it matches something, else push
    const last = (tokens[tokens.length - 1] || '').trim();
    const inCatalog = s.termsUC.some(t => t.toLowerCase() === last.toLowerCase());

    if (inCatalog) {
      tokens[tokens.length - 1] = selected;
    } else {
      // Avoid duplicating an existing token
      if (!tokens.some(t => t.trim().toLowerCase() === selected.toLowerCase())) {
        // If last token is empty, replace it; else push new one
        if (last.length === 0) tokens[tokens.length - 1] = selected;
        else tokens.push(selected);
      }
    }

    s.inputEl.value = joinTokens(tokens, true); // keep trailing comma
    updateDropdown(e, s);                       // refresh options
    s.inputEl.focus?.();
  }

  function onInputKeydown(e) {
    // Enter selects the first visible option
    if (e.key === 'Enter') {
      e.preventDefault();
      const s = state.get(e.currentTarget.id);
      if (!s) return;
      const first = s.selectEl.options[0];
      if (first && !first.disabled) {
        s.selectEl.value = first.value;
        // Trigger the same path as a user selection
        const evt = new Event('change', { bubbles: true });
        s.selectEl.dispatchEvent(evt);
      }
    }
  }

  function onInputChange(e) {
    const s = state.get(e.currentTarget.id);
    if (!s) return;

    const tokens = splitTokens(s.inputEl.value);
    const search = (tokens[tokens.length - 1] || '').trim().toLowerCase();

    // Build remaining terms (not already picked)
    const pickedLC = new Set(tokens.map(t => t.trim().toLowerCase()).filter(Boolean));
    const remainingUC = s.termsUC.filter(t => !pickedLC.has(t.toLowerCase()));

    // Filter by search (prefix hits first, then other substring hits)
    let result = remainingUC;
    if (search.length > 0) {
      const prefixHits = [];
      const partialHits = [];
      for (const term of remainingUC) {
        const lc = term.toLowerCase().replace(/-/g, ' ');
        // If search has spaces, treat the whole term as one chunk; else split by spaces
        const chunks = search.includes(' ') ? [lc] : lc.split(/\s+/);
        let hasPartial = false, hasPrefix = false;
        for (const chunk of chunks) {
          const pos = chunk.indexOf(search);
          if (pos >= 0) {
            hasPartial = true;
            if (pos === 0) { hasPrefix = true; break; }
          }
        }
        if (hasPartial) {
          (hasPrefix ? prefixHits : partialHits).push(term);
        }
      }
      result = prefixHits;
      if (prefixHits.length && partialHits.length) {
        result = prefixHits.concat([SPACER_TEXT], partialHits);
      } else if (!prefixHits.length && partialHits.length) {
        result = partialHits;
      }
    }

    // Update the dropdown
    updateDropdown(e, s, result);
  }

  // ---------------------------------------------------------------------------
  // RENDER / HELPERS
  // ---------------------------------------------------------------------------

  function splitTokens(val) {
    // Split by commas, preserve an empty trailing token if the string ends with a comma
    const raw = String(val || '');
    const parts = raw.split(',');
    // Normalize: trim internal tokens but keep raw commas behavior
    return parts.map(p => p); // leave trimming decisions to callers
  }

  function joinTokens(tokens, trailingComma = false) {
    let out = tokens.join(',');
    if (trailingComma && !out.endsWith(',')) out += ',';
    return out;
  }

  function updateDropdown(evt, s, values = null) {
    const select = s.selectEl;
    const all = values ?? s.termsUC;

    // Current picks to exclude
    const used = splitTokens(s.inputEl.value).map(t => t.trim()).filter(Boolean);
    const usedLC = new Set(used.map(t => t.toLowerCase()));

    // Rebuild options list
    while (select.options.length) select.remove(0);

    for (const item of all) {
      // Spacer row
      if (item === SPACER_TEXT) {
        const opt = new Option(SPACER_TEXT, SPACER_TEXT);
        opt.disabled = true;
        opt.style.color = SPACER_COLOR;
        select.add(opt);
        continue;
      }
      // Skip already-used tokens (case-insensitive)
      if (usedLC.has(item.toLowerCase())) continue;

      select.add(new Option(item, item));
    }

    // If nothing to show, add a disabled "(no matches)" row for clarity
    if (select.options.length === 0) {
      const opt = new Option('(no matches)', '');
      opt.disabled = true;
      select.add(opt);
    }

    // Reset selection index so first real option is chosen on Enter
    // (Skip spacer if present)
    let firstEnabled = 0;
    if (select.options.length && select.options[0].disabled) firstEnabled = 1;
    select.selectedIndex = firstEnabled;
  }
});
