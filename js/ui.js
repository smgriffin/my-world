// ui.js — modal, list panel, search, keyboard shortcuts

const UI = (() => {
  let modal, modalForm, modalTitle, modalClose, modalDelete;
  let listPanel, listItems, searchInput;
  let soundBtn, addBtn, importInput;
  let attachmentZone, attachmentInput, attachmentGrid;
  let lightbox, lightboxImg;
  let cardLayer, cardsBtnEl, annotateBtnEl;
  let canvasEl; // stored at init for connect/annotation use

  let editingId = null;
  let searchQuery = '';
  let pendingAttachments = []; // { id, name, type, data }
  let modalCurrentStep = 0;
  let wikiImageUrl = null;     // hero image URL set by Wikipedia autocomplete
  let wikiSuggestEl = null;
  let wikiDebounceTimer = null;

  // ── Connect mode ─────────────────────────────────────────────────────────────
  let connectSourceEntry = null;

  function handleConnectClick(entry) {
    if (!connectSourceEntry) {
      connectSourceEntry = entry;
      Render.setConnectSource(entry.id);
    } else if (connectSourceEntry.id === entry.id) {
      cancelConnect();
    } else {
      completeConnect(entry);
    }
  }

  function cancelConnect() {
    connectSourceEntry = null;
    Render.setConnectSource(null);
    if (canvasEl) canvasEl.style.cursor = '';
  }

  async function completeConnect(target) {
    const src = connectSourceEntry;
    cancelConnect();
    const existingLinks = src.links || [];
    if (existingLinks.some(l => l.toId === target.id)) return; // already connected
    await Entries.update(src.id, { ...src, links: [...existingLinks, { toId: target.id, label: '' }] });
    await refresh();
    Render.triggerMarkerDrop(src.id);
    Render.triggerMarkerDrop(target.id);
  }

  // ── Annotation mode ───────────────────────────────────────────────────────────
  let annotating       = false;
  let annotTool        = 'pen'; // 'pen' | 'text' | 'line'
  let annotDrawing     = false;
  let annotLivePoints  = [];
  let lineStart          = null;  // {x,y} first click for line tool
  let textAnchor         = null;  // {x,y} canvas position for text placement
  let imagePlacementPos  = null;  // {x,y} canvas position pending image pick
  let annToolbarEl, annTextOverlayEl, annTextCursorEl, annImageInputEl;

  // ── Card layer ────────────────────────────────────────────────────────────────
  let cardsAlwaysOn  = false;
  let hoverCardEl    = null;
  let hoverCardEntId = null;
  const alwaysOnCards = new Map(); // entryId → cardEl
  let lastCardZoom   = -1;
  let lastCardPanX   = -1;

  const CARD_W       = 220;
  const CARD_AXIS_H  = 48;   // matches render.js AXIS_H
  const CARD_ABOVE   = 38;   // px above axis where card bottom lands (keeps stem above the label)
  const LAYOUT_W     = { compact: 220, article: 260, feature: 320 };

  // ── Card resize handle ────────────────────────────────────────────────────────
  function addResizeHandle(cardEl, entryId) {
    const LAYOUT_ORDER  = ['compact', 'article', 'feature'];
    const THRESHOLDS    = [240, 290]; // midpoints between layout widths

    const handle = document.createElement('div');
    handle.className = 'card-resize-handle';
    cardEl.appendChild(handle);

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX      = e.clientX;
      const startLayout = cardEl.dataset.layout || 'compact';
      const startW      = LAYOUT_W[startLayout];
      let   curLayout   = startLayout;

      cardEl.classList.add('resizing');
      handle.setPointerCapture(e.pointerId);

      function onMove(ev) {
        const tentW    = startW + (ev.clientX - startX);
        const newLayout = tentW < THRESHOLDS[0] ? 'compact'
                        : tentW < THRESHOLDS[1] ? 'article'
                        : 'feature';
        if (newLayout !== curLayout) {
          LAYOUT_ORDER.forEach(l => cardEl.classList.remove(`layout-${l}`));
          cardEl.classList.add(`layout-${newLayout}`);
          cardEl.style.width    = LAYOUT_W[newLayout] + 'px';
          cardEl.dataset.layout = newLayout;
          curLayout = newLayout;
        }
      }

      async function onUp() {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup',   onUp);
        cardEl.classList.remove('resizing');
        if (curLayout !== startLayout) {
          const entry = Render.getEntries().find(en => en.id === entryId);
          if (entry) {
            await Entries.update(entryId, { ...entry, layout: curLayout });
            await refresh();
          }
        }
      }

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup',   onUp);
    });
  }

  function buildCardEl(entry) {
    const layout = entry.layout || 'compact';
    const el = document.createElement('div');
    el.className = `entry-card layout-${layout}`;
    el.dataset.id     = entry.id;
    el.dataset.layout = layout;

    const dateStr = entry.yearEnd
      ? `${formatYear(entry.year, entry.fromMonth, entry.fromDay, entry.fromHour, entry.fromMin)} – ${formatYear(entry.yearEnd, entry.toMonth, entry.toDay, entry.toHour, entry.toMin)}`
      : formatYear(entry.year, entry.fromMonth, entry.fromDay, entry.fromHour, entry.fromMin);

    const tagsHtml = (entry.tags || []).length
      ? `<div class="entry-card-tags">${entry.tags.map(t => {
          const col = Render.tagColor(t);
          const isActive = Render.getTagFilter() === t;
          return `<span class="entry-card-tag${isActive ? ' active' : ''}" data-tag="${t}" style="--tag-color:${col}">${t}</span>`;
        }).join('')}</div>`
      : '';

    if (layout === 'compact') {
      el.innerHTML = `
        <div class="entry-card-date">${dateStr}</div>
        <div class="entry-card-title">${entry.title}</div>
        ${entry.summary ? `<div class="entry-card-summary">${entry.summary}</div>` : ''}
        ${tagsHtml}
      `;
    } else {
      const photos  = entry.photos || [];
      const heroRaw = photos.find(p => typeof p === 'string' || (p.type && p.type.startsWith('image/')));
      const heroSrc = heroRaw ? (typeof heroRaw === 'string' ? heroRaw : heroRaw.data)
                              : (entry.image || null);
      el.innerHTML = `
        ${heroSrc ? `<div class="card-hero"><img src="${heroSrc}" alt=""></div>` : ''}
        <div class="card-body">
          <div class="entry-card-date">${dateStr}</div>
          <div class="entry-card-title">${entry.title}</div>
          ${entry.summary ? `<div class="entry-card-summary">${entry.summary}</div>` : ''}
          ${tagsHtml}
        </div>
      `;
    }

    el.addEventListener('click', (e) => {
      const tagEl = e.target.closest('.entry-card-tag');
      if (tagEl) {
        e.stopPropagation();
        setTagFilter(tagEl.dataset.tag);
        return;
      }
      openEditModal(entry);
    });
    addResizeHandle(el, entry.id);
    return el;
  }

  // ── Tag filter ────────────────────────────────────────────────────────────────
  let tagFilterPillEl = null;

  function setTagFilter(tag) {
    const current = Render.getTagFilter();
    const newTag = (current === tag) ? null : tag; // toggle off if same
    Render.setTagFilter(newTag);
    updateTagFilterPill(newTag);
    // Re-render list with filter
    renderList(Render.getEntries());
  }

  function updateTagFilterPill(tag) {
    if (!tagFilterPillEl) return;
    if (!tag) {
      tagFilterPillEl.textContent = '';
      tagFilterPillEl.classList.remove('active');
      return;
    }
    const col = Render.tagColor(tag);
    tagFilterPillEl.innerHTML =
      `<span style="color:${col}">● ${tag}</span><button class="tag-filter-clear" title="Clear filter">×</button>`;
    tagFilterPillEl.classList.add('active');
    tagFilterPillEl.querySelector('.tag-filter-clear').addEventListener('click', () => setTagFilter(null));
  }

  function placeCard(cardEl, x) {
    const layout     = cardEl.dataset.layout || 'compact';
    const w          = LAYOUT_W[layout] || CARD_W;
    const screenW    = window.innerWidth;
    const axisY      = Timeline.canvasHeight - CARD_AXIS_H;
    const cardBottom = axisY - CARD_ABOVE;

    let left = x - w / 2;
    left = Math.max(8, Math.min(screenW - w - 8, left));

    cardEl.style.left   = `${left}px`;
    cardEl.style.top    = '';
    cardEl.style.bottom = `${window.innerHeight - cardBottom}px`;

    const stemPx = Math.max(10, Math.min(w - 10, x - left));
    cardEl.style.setProperty('--stem-left', `${stemPx}px`);
  }

  function showHoverCard(entry, x) {
    if (cardsAlwaysOn) return;
    if (hoverCardEntId === entry.id && hoverCardEl) return;
    hideHoverCard();
    hoverCardEntId = entry.id;
    hoverCardEl    = buildCardEl(entry);
    cardLayer.appendChild(hoverCardEl);
    placeCard(hoverCardEl, x);
  }

  function hideHoverCard() {
    if (hoverCardEl) { hoverCardEl.remove(); hoverCardEl = null; hoverCardEntId = null; }
  }

  // Greedy left-to-right filter: keeps only entries spaced ≥ their card width apart.
  function deoverlapCards(singles) {
    if (!singles.length) return singles;
    const sorted = [...singles].sort((a, b) => a.x - b.x);
    const out = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const prevW = LAYOUT_W[(out[out.length - 1].entry.layout || 'compact')] || CARD_W;
      if (sorted[i].x - out[out.length - 1].x >= prevW + 10) out.push(sorted[i]);
    }
    return out;
  }

  function rebuildAlwaysOnCards() {
    const singles   = deoverlapCards(Render.getVisibleSingles());
    const visibleIds = new Set(singles.map(s => s.entry.id));

    for (const [id, el] of alwaysOnCards) {
      if (!visibleIds.has(id)) { el.remove(); alwaysOnCards.delete(id); }
    }
    for (const { entry, x } of singles) {
      let el = alwaysOnCards.get(entry.id);
      if (!el) {
        el = buildCardEl(entry);
        cardLayer.appendChild(el);
        alwaysOnCards.set(entry.id, el);
      }
      placeCard(el, x);
    }
  }

  function clearAlwaysOnCards() {
    for (const el of alwaysOnCards.values()) el.remove();
    alwaysOnCards.clear();
  }

  function cardsAlwaysOnLoop() {
    if (!cardsAlwaysOn) return;
    if (Timeline.zoom !== lastCardZoom || Timeline.panX !== lastCardPanX) {
      lastCardZoom = Timeline.zoom;
      lastCardPanX = Timeline.panX;
      rebuildAlwaysOnCards();
    }
    requestAnimationFrame(cardsAlwaysOnLoop);
  }

  function setCardsAlwaysOn(on) {
    cardsAlwaysOn = on;
    cardsBtnEl.classList.toggle('active', on);
    cardsBtnEl.title = on ? 'Cards: always on (C)' : 'Cards: hover only (C)';
    Render.setConnectionsVisible(on);
    if (on) {
      hideHoverCard();
      lastCardZoom = -1;
      cardsAlwaysOnLoop();
    } else {
      clearAlwaysOnCards();
    }
  }

  // ── Connections ──────────────────────────────────────────────────────────────
  let pendingConnections = []; // { toId, label }
  let connSearchEl, connSuggestEl, connChipsEl;

  function renderConnectionChips() {
    connChipsEl.innerHTML = '';
    for (const conn of pendingConnections) {
      const all    = Render.getEntries();
      const target = all.find(e => e.id === conn.toId);
      if (!target) continue;

      const chip = document.createElement('div');
      chip.className = 'connection-chip';
      chip.innerHTML = `
        <span>${target.title}</span>
        <button type="button" class="connection-chip-remove" data-id="${conn.toId}">×</button>
      `;
      chip.querySelector('.connection-chip-remove').addEventListener('click', () => {
        pendingConnections = pendingConnections.filter(c => c.toId !== conn.toId);
        renderConnectionChips();
      });
      connChipsEl.appendChild(chip);
    }
  }

  function showConnectionSuggestions(query) {
    const q   = query.toLowerCase().trim();
    const all = Render.getEntries();
    const existing = new Set(pendingConnections.map(c => c.toId));
    // Exclude self (editingId) and already-connected entries
    const matches = all.filter(e =>
      e.id !== editingId &&
      !existing.has(e.id) &&
      (!q || e.title.toLowerCase().includes(q))
    ).slice(0, 8);

    connSuggestEl.innerHTML = '';
    if (!matches.length) { connSuggestEl.classList.remove('open'); return; }

    for (const e of matches) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${e.title}</span><span class="sug-year">${formatYear(e.year)}</span>`;
      li.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); // don't blur the input before we handle click
        pendingConnections.push({ toId: e.id, label: '' });
        renderConnectionChips();
        connSearchEl.value = '';
        connSuggestEl.classList.remove('open');
      });
      connSuggestEl.appendChild(li);
    }
    connSuggestEl.classList.add('open');
  }

  // ── Attachments ───────────────────────────────────────────────────────────────
  function mediaCategory(type) {
    if (type.startsWith('image/')) return 'image';
    if (type.startsWith('video/')) return 'video';
    if (type.startsWith('audio/')) return 'audio';
    return 'document';
  }

  function resizeImage(file, maxDim = 900) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width  * scale);
        const h = Math.round(img.height * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve({ dataUrl: c.toDataURL('image/jpeg', 0.74), naturalW: w, naturalH: h });
      };
      img.src = url;
    });
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function addFiles(fileList) {
    for (const file of fileList) {
      const data = await readFileAsDataURL(file);
      pendingAttachments.push({
        id:   `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        type: file.type || 'application/octet-stream',
        data,
      });
    }
    renderAttachmentGrid();
  }

  function removeAttachment(id) {
    pendingAttachments = pendingAttachments.filter(a => a.id !== id);
    renderAttachmentGrid();
  }

  // ── Drag-to-reorder attachments ───────────────────────────────────────────────
  let draggingAttId = null;

  function setupDrag(el, att) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      draggingAttId = att.id;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => el.classList.add('dragging'), 0);
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      draggingAttId = null;
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drop-target');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop-target');
      if (!draggingAttId || draggingAttId === att.id) return;
      const fromIdx = pendingAttachments.findIndex(a => a.id === draggingAttId);
      const toIdx   = pendingAttachments.findIndex(a => a.id === att.id);
      if (fromIdx === -1 || toIdx === -1) return;
      // Only allow reorder within the same media category
      if (mediaCategory(pendingAttachments[fromIdx].type) !== mediaCategory(att.type)) return;
      const arr = [...pendingAttachments];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      pendingAttachments = arr;
      renderAttachmentGrid();
    });
  }

  function buildRemoveBtn(id) {
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'attachment-remove';
    rm.textContent = '×';
    rm.addEventListener('click', (e) => { e.stopPropagation(); removeAttachment(id); });
    return rm;
  }

  function buildImageThumb(att) {
    const wrap = document.createElement('div');
    wrap.className = 'attachment-thumb';
    const img = document.createElement('img');
    img.src = att.data; img.alt = att.name;
    img.addEventListener('click', () => openLightbox(att.data));
    wrap.appendChild(img);
    wrap.appendChild(buildRemoveBtn(att.id));
    setupDrag(wrap, att);
    return wrap;
  }

  function buildVideoTile(att) {
    const wrap = document.createElement('div');
    wrap.className = 'attachment-file';
    const icon = document.createElement('div');
    icon.className = 'attachment-file-icon';
    icon.textContent = '▶';
    const name = document.createElement('div');
    name.className = 'attachment-file-name';
    name.textContent = att.name;
    wrap.appendChild(icon);
    wrap.appendChild(name);
    wrap.appendChild(buildRemoveBtn(att.id));
    setupDrag(wrap, att);
    return wrap;
  }

  function buildAudioRow(att) {
    const wrap = document.createElement('div');
    wrap.className = 'attachment-audio';
    const left = document.createElement('div');
    left.className = 'attachment-audio-left';
    const icon = document.createElement('span');
    icon.className = 'attachment-audio-icon';
    icon.textContent = '♪';
    const name = document.createElement('span');
    name.className = 'attachment-file-name';
    name.textContent = att.name;
    left.appendChild(icon);
    left.appendChild(name);
    const player = document.createElement('audio');
    player.src = att.data;
    player.controls = true;
    player.className = 'attachment-audio-player';
    wrap.appendChild(left);
    wrap.appendChild(player);
    wrap.appendChild(buildRemoveBtn(att.id));
    setupDrag(wrap, att);
    return wrap;
  }

  function buildDocRow(att) {
    const wrap = document.createElement('div');
    wrap.className = 'attachment-file';
    const icon = document.createElement('div');
    icon.className = 'attachment-file-icon';
    icon.textContent = fileIcon(att.type);
    const name = document.createElement('div');
    name.className = 'attachment-file-name';
    name.textContent = att.name;
    wrap.appendChild(icon);
    wrap.appendChild(name);
    wrap.appendChild(buildRemoveBtn(att.id));
    setupDrag(wrap, att);
    return wrap;
  }

  function renderAttachmentGrid() {
    attachmentGrid.innerHTML = '';
    if (!pendingAttachments.length) return;

    const groups = { image: [], video: [], audio: [], document: [] };
    for (const att of pendingAttachments) groups[mediaCategory(att.type)].push(att);

    const labels = { image: 'Images', video: 'Video', audio: 'Audio', document: 'Documents' };

    for (const cat of ['image', 'video', 'audio', 'document']) {
      const items = groups[cat];
      if (!items.length) continue;

      const section = document.createElement('div');
      section.className = 'attachment-section';

      const hdr = document.createElement('div');
      hdr.className = 'attachment-section-header';
      hdr.textContent = items.length > 1 ? `${labels[cat]} (${items.length})` : labels[cat];
      section.appendChild(hdr);

      if (cat === 'image' || cat === 'video') {
        const grid = document.createElement('div');
        grid.className = 'attachment-tile-grid';
        for (const att of items) {
          grid.appendChild(cat === 'image' ? buildImageThumb(att) : buildVideoTile(att));
        }
        section.appendChild(grid);
      } else if (cat === 'audio') {
        for (const att of items) section.appendChild(buildAudioRow(att));
      } else {
        const grid = document.createElement('div');
        grid.className = 'attachment-tile-grid';
        for (const att of items) grid.appendChild(buildDocRow(att));
        section.appendChild(grid);
      }

      attachmentGrid.appendChild(section);
    }
  }

  function fileIcon(type) {
    if (type.includes('pdf'))  return '📄';
    if (type.includes('word') || type.includes('doc')) return '📝';
    if (type.includes('sheet') || type.includes('csv')) return '📊';
    if (type.includes('json')) return '{ }';
    if (type.includes('text')) return '📃';
    return '📎';
  }

  // ── Lightbox ──────────────────────────────────────────────────────────────────
  function openLightbox(src) {
    lightboxImg.src = src;
    lightbox.classList.add('open');
    lightbox.setAttribute('aria-hidden', 'false');
  }

  function closeLightbox() {
    lightbox.classList.remove('open');
    lightbox.setAttribute('aria-hidden', 'true');
    lightboxImg.src = '';
  }

  // ── Date conversion ───────────────────────────────────────────────────────────
  const CURRENT_YEAR = new Date().getFullYear();

  function toYearsAgo(value, unit) {
    const v = parseFloat(value);
    switch (unit) {
      case 'CE':  return Math.max(0, CURRENT_YEAR - v);
      case 'BCE': return v + CURRENT_YEAR;
      case 'ya':  return v;
      case 'kya': return v * 1_000;
      case 'mya': return v * 1_000_000;
      case 'bya': return v * 1_000_000_000;
      default:    return v;
    }
  }

  const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

  // Returns a precise yearsAgo value using actual calendar math when month/day/time are known.
  // This is what gets stored as entry.year — it's what positions the marker on the log scale.
  // Without this, every event in 2025 lands at the same x pixel regardless of zoom level.
  function toPreciseYearsAgo(ceYearVal, month, day, hour, min) {
    const m  = month ? parseInt(month) - 1 : 0;
    const d  = day   ? parseInt(day)       : 1;
    const h  = hour  ? parseInt(hour)      : 0;
    const mn = min   ? parseInt(min)       : 0;
    const eventDate = new Date(parseInt(ceYearVal), m, d, h, mn, 0, 0);
    return Math.max(0, (Date.now() - eventDate) / MS_PER_YEAR);
  }

  // Returns {value, unit} for pre-populating the edit form.
  // Uses actual Date math for CE years so sub-year precision values
  // (e.g. 0.241 yearsAgo = Dec 31 last year) recover the correct calendar year.
  function fromYearsAgo(yearsAgo) {
    if (yearsAgo == null) return { value: '', unit: 'CE' };
    if (yearsAgo <= CURRENT_YEAR + 1) {
      const date = new Date(Date.now() - yearsAgo * MS_PER_YEAR);
      const yr   = date.getFullYear();
      if (yr >= 1) return { value: yr, unit: 'CE' };
      return { value: 1 - yr, unit: 'BCE' };
    }
    if (yearsAgo < 10_000)        return { value: Math.round(yearsAgo),                    unit: 'ya' };
    if (yearsAgo < 1_000_000)     return { value: +(yearsAgo / 1_000).toPrecision(4),      unit: 'kya' };
    if (yearsAgo < 1_000_000_000) return { value: +(yearsAgo / 1_000_000).toPrecision(4),  unit: 'mya' };
    return { value: +(yearsAgo / 1_000_000_000).toPrecision(4), unit: 'bya' };
  }

  // ── List panel ────────────────────────────────────────────────────────────────
  function renderList(entries) {
    const tagFilter = Render.getTagFilter();
    const filtered = entries.filter(e =>
      (!searchQuery ||
        e.title.toLowerCase().includes(searchQuery) ||
        (e.summary || '').toLowerCase().includes(searchQuery) ||
        (e.tags || []).some(t => t.toLowerCase().includes(searchQuery))
      ) &&
      (!tagFilter || (e.tags || []).includes(tagFilter))
    );

    filtered.sort((a, b) => a.year - b.year);

    listItems.innerHTML = '';
    for (const entry of filtered) {
      const li = document.createElement('li');
      li.className = 'list-item';
      li.dataset.id = entry.id;
      li.innerHTML = `
        <span class="list-item-year">${formatYear(entry.year, entry.fromMonth, entry.fromDay, entry.fromHour, entry.fromMin)}</span>
        <span class="list-item-title">${entry.title}</span>
      `;
      li.addEventListener('click', () => openEditModal(entry));
      listItems.appendChild(li);
    }
  }

  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function formatYear(yearsAgo, month, day, hour, min) {
    if (yearsAgo == null) return '';
    if (yearsAgo === 0)   return 'Today';
    const ceYear = CURRENT_YEAR - yearsAgo;

    if (ceYear > 0) {
      const yr = Math.round(ceYear);
      if (month) {
        const mo = MONTH_NAMES[parseInt(month) - 1];
        let base = day ? `${mo} ${parseInt(day)}, ${yr}` : `${mo} ${yr}`;
        if (hour != null && hour !== '') {
          const h = String(parseInt(hour)).padStart(2, '0');
          const m = min != null && min !== '' ? String(parseInt(min)).padStart(2, '0') : '00';
          base += ` ${h}:${m}`;
        }
        return base;
      }
      return yr.toString();
    }

    const bce = Math.abs(Math.round(ceYear));
    if (bce >= 1_000_000_000) return `${(bce / 1e9).toFixed(2)}B BCE`;
    if (bce >= 1_000_000)     return `${(bce / 1e6).toFixed(2)}M BCE`;
    if (bce >= 1_000)         return `${(bce / 1000).toFixed(1)}k BCE`;
    return `${bce} BCE`;
  }

  function toggleListPanel() {
    const isOpen = !listPanel.classList.contains('collapsed');
    if (isOpen) {
      // Clear search when closing the panel
      if (searchInput && searchInput.value) {
        searchInput.value = '';
        searchQuery = '';
        Render.setSearchQuery('');
        renderList(Render.getEntries());
        searchInput.blur();
      }
      // Closing: apply ease-in class first, then collapse
      listPanel.classList.add('closing');
      listPanel.classList.add('collapsed');
      listPanel.addEventListener('transitionend', () => {
        listPanel.classList.remove('closing');
      }, { once: true });
    } else {
      // Opening: spring easing (default transition)
      listPanel.classList.remove('collapsed');
    }
  }

  // ── Modal step & picker helpers ───────────────────────────────────────────────
  function goToModalStep(step) {
    const prev = document.getElementById(`modal-step-${modalCurrentStep}`);
    const next = document.getElementById(`modal-step-${step}`);
    if (!next || prev === next) return;
    if (prev) prev.classList.remove('active', 'step-back');
    next.classList.remove('active', 'step-back');
    if (step < modalCurrentStep) next.classList.add('step-back');
    next.classList.add('active');
    document.querySelectorAll('.step-dot').forEach((dot, i) => {
      dot.classList.toggle('active', i === step);
    });
    modalCurrentStep = step;
    // Populate connection suggestions when landing on details step
    if (step === 1 && connSuggestEl) showConnectionSuggestions('');
  }

  function setPickerValue(pickerId, hiddenInputId, value) {
    const picker = document.getElementById(pickerId);
    const hidden = document.getElementById(hiddenInputId);
    if (!picker || !hidden) return;
    picker.querySelectorAll('[data-value]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === value);
    });
    hidden.value = value;
  }

  function setToDateExpanded(expanded) {
    const section = document.getElementById('to-date-section');
    const btn     = document.getElementById('to-date-toggle-btn');
    if (!section || !btn) return;
    section.classList.toggle('open', expanded);
    btn.textContent = expanded ? '− Remove end date' : '+ Span to end date';
    if (!expanded) {
      if (modalForm.elements['toValue'])  modalForm.elements['toValue'].value  = '';
      if (modalForm.elements['toMonth'])  modalForm.elements['toMonth'].value  = '';
      if (modalForm.elements['toDay'])    modalForm.elements['toDay'].value    = '';
      if (modalForm.elements['toHour'])   modalForm.elements['toHour'].value   = '';
      if (modalForm.elements['toMin'])    modalForm.elements['toMin'].value    = '';
      const toPrecEl = document.getElementById('to-precision');
      if (toPrecEl) toPrecEl.classList.remove('visible');
      const toTimeEl = document.getElementById('to-time');
      if (toTimeEl) toTimeEl.classList.remove('visible');
    }
  }

  // ── Modal ─────────────────────────────────────────────────────────────────────
  function updateDatePrecision(unitEl, precisionEl, timeEl) {
    if (!precisionEl) return;
    const show = unitEl.value === 'CE';
    precisionEl.classList.toggle('visible', show);
    if (timeEl) timeEl.classList.toggle('visible', show);
    if (!show) {
      const sel = precisionEl.querySelector('select');
      const inp = precisionEl.querySelector('input');
      if (sel) sel.value = '';
      if (inp) inp.value = '';
      if (timeEl) {
        timeEl.querySelectorAll('input').forEach(i => { i.value = ''; });
      }
    }
  }

  function openAddModal() {
    editingId = null;
    pendingAttachments = [];
    pendingConnections = [];
    wikiImageUrl = null;
    modalTitle.textContent = 'Add Entry';
    modalDelete.style.display = 'none';
    modalForm.reset();
    modalForm.elements['fromUnit'].value = 'CE';
    modalForm.elements['toUnit'].value   = 'CE';
    updateDatePrecision(modalForm.elements['fromUnit'], document.getElementById('from-precision'), document.getElementById('from-time'));
    updateDatePrecision(modalForm.elements['toUnit'],   document.getElementById('to-precision'),   document.getElementById('to-time'));
    setPickerValue('entry-type-picker', 'f-entryType', 'Event');
    setPickerValue('layout-picker',      'f-layout',    'compact');
    setPickerValue('source-type-picker', 'f-type',      'historical');
    setToDateExpanded(false);
    goToModalStep(0);
    if (connSearchEl) connSearchEl.value = '';
    renderAttachmentGrid();
    renderConnectionChips();
    modal.classList.add('open');
    if (canvasEl) canvasEl.style.pointerEvents = 'none';
    setTimeout(() => document.getElementById('f-title')?.focus(), 60);
  }

  function openEditModal(entry) {
    editingId = entry.id;
    pendingAttachments = (entry.photos || []).map(p =>
      typeof p === 'string'
        ? { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: 'image', type: 'image/jpeg', data: p }
        : { ...p }
    );
    pendingConnections = (entry.links || [])
      .filter(l => l && l.toId != null)
      .map(l => ({ ...l }));
    modalTitle.textContent = 'Edit Entry';
    modalDelete.style.display = '';

    const from = fromYearsAgo(entry.year);
    const to   = fromYearsAgo(entry.yearEnd);

    modalForm.elements['title'].value     = entry.title     || '';
    modalForm.elements['fromValue'].value = from.value;
    modalForm.elements['fromUnit'].value  = from.unit;
    modalForm.elements['toValue'].value   = to.value;
    modalForm.elements['toUnit'].value    = to.unit;
    modalForm.elements['summary'].value   = entry.summary   || '';
    modalForm.elements['notes'].value     = entry.notes     || '';
    modalForm.elements['tags'].value      = (entry.tags || []).join(', ');
    if (modalForm.elements['fromMonth']) modalForm.elements['fromMonth'].value = entry.fromMonth || '';
    if (modalForm.elements['fromDay'])   modalForm.elements['fromDay'].value   = entry.fromDay   || '';
    if (modalForm.elements['toMonth'])   modalForm.elements['toMonth'].value   = entry.toMonth   || '';
    if (modalForm.elements['toDay'])     modalForm.elements['toDay'].value     = entry.toDay     || '';
    if (modalForm.elements['fromHour'])  modalForm.elements['fromHour'].value  = entry.fromHour  || '';
    if (modalForm.elements['fromMin'])   modalForm.elements['fromMin'].value   = entry.fromMin   || '';
    if (modalForm.elements['toHour'])    modalForm.elements['toHour'].value    = entry.toHour    || '';
    if (modalForm.elements['toMin'])     modalForm.elements['toMin'].value     = entry.toMin     || '';
    updateDatePrecision(modalForm.elements['fromUnit'], document.getElementById('from-precision'), document.getElementById('from-time'));
    updateDatePrecision(modalForm.elements['toUnit'],   document.getElementById('to-precision'),   document.getElementById('to-time'));
    setPickerValue('entry-type-picker', 'f-entryType', entry.entryType || 'Event');
    setPickerValue('layout-picker',      'f-layout',    entry.layout    || 'compact');
    setPickerValue('source-type-picker', 'f-type',      entry.type      || 'historical');
    setToDateExpanded(!!entry.yearEnd);
    goToModalStep(0);

    if (connSearchEl) connSearchEl.value = '';
    renderAttachmentGrid();
    renderConnectionChips();
    modal.classList.add('open');
    if (canvasEl) canvasEl.style.pointerEvents = 'none';
  }

  function closeModal() {
    modal.classList.remove('open');
    if (canvasEl) canvasEl.style.pointerEvents = '';
    editingId = null;
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    const f = modalForm.elements;

    const fromCE    = f['fromUnit'].value === 'CE';
    const toCE      = f['toUnit'].value   === 'CE';
    const fromMonth = fromCE && f['fromMonth'] ? (f['fromMonth'].value || null) : null;
    const fromDay   = fromCE && f['fromDay']   ? (f['fromDay'].value   || null) : null;
    const fromHour  = fromCE && f['fromHour']  ? (f['fromHour'].value  || null) : null;
    const fromMin   = fromCE && f['fromMin']   ? (f['fromMin'].value   || null) : null;
    const toMonth   = toCE   && f['toMonth']   ? (f['toMonth'].value   || null) : null;
    const toDay     = toCE   && f['toDay']     ? (f['toDay'].value     || null) : null;
    const toHour    = toCE   && f['toHour']    ? (f['toHour'].value    || null) : null;
    const toMin     = toCE   && f['toMin']     ? (f['toMin'].value     || null) : null;

    // Use calendar-precise positioning when month is known (CE only).
    // This ensures events on different days in the same year land at different
    // x positions on the timeline and separate correctly as the user zooms in.
    const year = (fromCE && fromMonth)
      ? toPreciseYearsAgo(f['fromValue'].value, fromMonth, fromDay, fromHour, fromMin)
      : toYearsAgo(f['fromValue'].value, f['fromUnit'].value);

    const yearEnd = f['toValue'].value
      ? ((toCE && toMonth)
          ? toPreciseYearsAgo(f['toValue'].value, toMonth, toDay, toHour, toMin)
          : toYearsAgo(f['toValue'].value, f['toUnit'].value))
      : null;

    const entry = {
      title:     f['title'].value.trim(),
      year,
      yearEnd,
      fromMonth,
      fromDay,
      fromHour,
      fromMin,
      toMonth,
      toDay,
      toHour,
      toMin,
      type:      f['type'].value,
      entryType: f['entryType'].value,
      layout:    f['layout'].value || 'compact',
      summary:   f['summary'].value.trim(),
      notes:     f['notes'].value.trim(),
      tags:      f['tags'].value.split(',').map(t => t.trim()).filter(Boolean),
      image:     wikiImageUrl || '',
      photos:    [...pendingAttachments],
      links:     [...pendingConnections],
    };

    let savedId = editingId;
    if (editingId != null) {
      await Entries.update(editingId, entry);
    } else {
      const saved = await Entries.add(entry);
      savedId = saved.id;
    }

    closeModal();
    await refresh();

    // Micro-interaction: pan to the saved entry and drop the marker
    if (savedId != null) {
      Timeline.panToDate(entry.year);
      Render.triggerMarkerDrop(savedId);
    }
  }

  async function handleDelete() {
    if (editingId == null) return;
    await Entries.remove(editingId);
    closeModal();
    await refresh();
  }

  // ── Refresh ───────────────────────────────────────────────────────────────────
  async function refresh() {
    const all = await Entries.getAll();
    Render.setEntries(all);
    renderList(all);
    if (cardsAlwaysOn) { lastCardZoom = -1; rebuildAlwaysOnCards(); }
  }

  // ── Snapshot ──────────────────────────────────────────────────────────────────
  function snapshotTimeline() {
    const canvas = document.getElementById('canvas');
    const link   = document.createElement('a');
    link.download = `my-world-${new Date().toISOString().slice(0, 10)}.png`;
    link.href    = canvas.toDataURL('image/png');
    link.click();
  }

  // ── Sound ─────────────────────────────────────────────────────────────────────
  function updateSoundBtn() {
    soundBtn.classList.toggle('muted', Sound.isMuted());
    soundBtn.title = Sound.isMuted() ? 'Unmute sound (M)' : 'Mute sound (M)';
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  // A — add entry
  // L — toggle list panel
  // / — focus search (opens panel if closed)
  // M — toggle sound
  // Shift+E — export JSON
  // Shift+I — trigger import
  function handleKeydown(e) {
    // Don't fire shortcuts when typing in an input
    const tag = document.activeElement.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (inInput) return;
    if (modal.classList.contains('open')) return;

    switch (e.key) {
      case 'a':
      case 'A':
        openAddModal();
        break;
      case 'l':
      case 'L':
        toggleListPanel();
        break;
      case '/':
        e.preventDefault();
        if (listPanel.classList.contains('collapsed')) listPanel.classList.remove('collapsed');
        searchInput.focus();
        searchInput.select();
        break;
      case 'm':
      case 'M':
        Sound.toggle();
        updateSoundBtn();
        break;
      case 'c':
      case 'C':
        setCardsAlwaysOn(!cardsAlwaysOn);
        break;
      case 'n':
      case 'N':
        setAnnotationMode(!annotating);
        break;
      case 'Backspace':
        if (annotating) { Annotations.removeLast(); Timeline.markDirty(); }
        break;
      case 'S':
        if (e.shiftKey) snapshotTimeline();
        break;
      case 'E':
        if (e.shiftKey) Entries.exportJSON();
        break;
      case 'H':
        if (e.shiftKey) Entries.exportHTML();
        break;
      case 'I':
        if (e.shiftKey) importInput.click();
        break;
      case 'Escape':
        if (annotating) { setAnnotationMode(false); return; }
        if (connectSourceEntry) { cancelConnect(); return; }
        if (Render.getTagFilter()) { setTagFilter(null); return; }
        if (!listPanel.classList.contains('collapsed')) toggleListPanel();
        break;
    }
  }

  // ── Wikipedia autocomplete ────────────────────────────────────────────────────
  let wikiHighlightIdx = -1; // keyboard-nav position in suggestion list

  function hideWikiSuggestions() {
    if (wikiSuggestEl) wikiSuggestEl.classList.remove('open');
    wikiHighlightIdx = -1;
  }

  function wikiItems() {
    return wikiSuggestEl ? Array.from(wikiSuggestEl.querySelectorAll('li')) : [];
  }

  function setWikiHighlight(idx) {
    const items = wikiItems();
    items.forEach((li, i) => li.classList.toggle('wiki-active', i === idx));
    wikiHighlightIdx = idx;
    if (items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
  }

  async function fetchWikiSuggestions(query) {
    if (!query || query.length < 2) { hideWikiSuggestions(); return; }
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=6&format=json&origin=*`;
      const res = await fetch(url);
      const [, titles] = await res.json();
      if (!wikiSuggestEl) return;
      wikiSuggestEl.innerHTML = '';
      wikiHighlightIdx = -1;
      if (!titles.length) { hideWikiSuggestions(); return; }
      for (const title of titles) {
        const li = document.createElement('li');
        li.textContent = title;
        li.addEventListener('mousedown', (e) => { e.preventDefault(); selectWikiEntry(title); });
        wikiSuggestEl.appendChild(li);
      }
      wikiSuggestEl.classList.add('open');
    } catch { hideWikiSuggestions(); }
  }

  // Parse a Wikidata time value string like "+1969-07-20T00:00:00Z" or "-0066-01-01T00:00:00Z"
  // Returns { ceYear, month, day } or null.
  function parseWikidate(timeStr) {
    if (!timeStr) return null;
    const m = timeStr.match(/^([+-])(\d+)-(\d{2})-(\d{2})/);
    if (!m) return null;
    const sign   = m[1] === '-' ? -1 : 1;
    const year   = sign * parseInt(m[2], 10);
    const month  = parseInt(m[3], 10) || null;
    const day    = parseInt(m[4], 10) || null;
    return { ceYear: year, month: month || null, day: day || null };
  }

  // Fill one date section of the modal from a parsed wikidate.
  function fillDateFields(prefix, parsed) {
    if (!parsed) return;
    const { ceYear, month, day } = parsed;
    const unitEl  = modalForm.elements[`${prefix}Unit`];
    const valueEl = modalForm.elements[`${prefix}Value`];
    if (!unitEl || !valueEl) return;

    if (ceYear > 0) {
      unitEl.value  = 'CE';
      valueEl.value = ceYear;
      if (month && modalForm.elements[`${prefix}Month`])
        modalForm.elements[`${prefix}Month`].value = month;
      if (day && modalForm.elements[`${prefix}Day`])
        modalForm.elements[`${prefix}Day`].value = day;
    } else {
      unitEl.value  = 'BCE';
      valueEl.value = Math.abs(ceYear);
    }
    updateDatePrecision(unitEl,
      document.getElementById(`${prefix === 'from' ? 'from' : 'to'}-precision`),
      document.getElementById(`${prefix === 'from' ? 'from' : 'to'}-time`));
  }

  async function selectWikiEntry(title) {
    hideWikiSuggestions();
    const titleEl = document.getElementById('f-title');
    if (titleEl) titleEl.value = title;

    try {
      // Single request: summary, image, and wikibase item id
      const wpUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=extracts|pageimages|pageprops&exintro=1&exsentences=3&piprop=original&ppprop=wikibase_item&format=json&origin=*`;
      const wpRes  = await fetch(wpUrl);
      const wpData = await wpRes.json();
      const pages  = wpData.query?.pages || {};
      const page   = Object.values(pages)[0];
      if (!page) return;

      // Fill summary
      if (page.extract) {
        const summaryEl = document.getElementById('f-summary');
        if (summaryEl && !summaryEl.value) {
          const div = document.createElement('div');
          div.innerHTML = page.extract;
          summaryEl.value = (div.textContent || '').slice(0, 500).trim();
        }
      }

      // Store hero image URL
      if (page.original?.source) wikiImageUrl = page.original.source;

      // Fetch dates from Wikidata
      const qid = page.pageprops?.wikibase_item;
      if (!qid) return;

      const wdUrl  = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
      const wdRes  = await fetch(wdUrl);
      const wdData = await wdRes.json();
      const entity = wdData.entities?.[qid];
      if (!entity) return;

      const claims = entity.claims || {};

      // Date properties in priority order:
      // P585=point in time, P571=inception, P569=birth, P580=start time, P582=end time, P570=death
      function firstTime(pid) {
        const arr = claims[pid];
        if (!arr || !arr.length) return null;
        return arr[0]?.mainsnak?.datavalue?.value?.time || null;
      }

      const pointInTime = firstTime('P585');
      const inception   = firstTime('P571');
      const birth       = firstTime('P569');
      const startTime   = firstTime('P580');
      const endTime     = firstTime('P582');
      const death       = firstTime('P570');

      // Choose the most relevant "from" date
      const fromRaw = pointInTime || inception || birth || startTime;
      // "to" date only if it's a span
      const toRaw   = (!pointInTime && !birth) ? (endTime || death) : null;

      const fromParsed = parseWikidate(fromRaw);
      const toParsed   = parseWikidate(toRaw);

      if (fromParsed) {
        fillDateFields('from', fromParsed);
      }
      if (toParsed) {
        setToDateExpanded(true);
        fillDateFields('to', toParsed);
      }

    } catch { /* network error — skip */ }
  }

  function initWikiAutocomplete() {
    wikiSuggestEl = document.getElementById('wiki-suggestions');
    const titleEl = document.getElementById('f-title');
    if (!titleEl || !wikiSuggestEl) return;

    titleEl.addEventListener('input', (e) => {
      wikiImageUrl = null;
      clearTimeout(wikiDebounceTimer);
      wikiDebounceTimer = setTimeout(() => fetchWikiSuggestions(e.target.value.trim()), 300);
    });

    titleEl.addEventListener('keydown', (e) => {
      const items = wikiItems();
      if (!items.length || !wikiSuggestEl.classList.contains('open')) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setWikiHighlight(Math.min(wikiHighlightIdx + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setWikiHighlight(Math.max(wikiHighlightIdx - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (wikiHighlightIdx >= 0 && items[wikiHighlightIdx]) {
          selectWikiEntry(items[wikiHighlightIdx].textContent);
        }
      } else if (e.key === 'Escape') {
        hideWikiSuggestions();
      }
    });

    titleEl.addEventListener('blur', () => { setTimeout(hideWikiSuggestions, 200); });
    titleEl.addEventListener('focus', (e) => {
      if (e.target.value.trim().length >= 2) fetchWikiSuggestions(e.target.value.trim());
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────────
  function init() {
    modal            = document.getElementById('modal');
    modalForm        = document.getElementById('modal-form');
    modalTitle       = document.getElementById('modal-title');
    modalClose       = document.getElementById('modal-close');
    modalDelete      = document.getElementById('modal-delete');
    listPanel        = document.getElementById('list-panel');
    listItems        = document.getElementById('list-items');
    searchInput      = document.getElementById('search-input');
    soundBtn         = document.getElementById('sound-btn');
    addBtn           = document.getElementById('add-btn');
    importInput      = document.getElementById('import-input');
    attachmentZone   = document.getElementById('attachment-zone');
    attachmentInput  = document.getElementById('attachment-input');
    attachmentGrid   = document.getElementById('attachment-grid');
    lightbox         = document.getElementById('lightbox');
    lightboxImg      = document.getElementById('lightbox-img');
    cardLayer        = document.getElementById('card-layer');
    cardsBtnEl       = document.getElementById('cards-btn');
    annotateBtnEl    = document.getElementById('annotate-btn');
    connSearchEl     = document.getElementById('connection-search');
    connSuggestEl    = document.getElementById('connection-suggestions');
    connChipsEl      = document.getElementById('connection-chips');
    canvasEl         = document.getElementById('canvas');
    tagFilterPillEl  = document.getElementById('tag-filter-pill');

    addBtn.addEventListener('click', openAddModal);
    initWikiAutocomplete();
    cardsBtnEl.addEventListener('click', () => setCardsAlwaysOn(!cardsAlwaysOn));
    annotateBtnEl.addEventListener('click', () => setAnnotationMode(!annotating));

    // ── Connection search ─────────────────────────────────────────────────────
    connSearchEl.addEventListener('input', (e) => showConnectionSuggestions(e.target.value));
    connSearchEl.addEventListener('focus', (e) => showConnectionSuggestions(e.target.value));
    connSearchEl.addEventListener('blur',  () => {
      setTimeout(() => connSuggestEl.classList.remove('open'), 150);
    });
    modalClose.addEventListener('click', closeModal);
    modalDelete.addEventListener('click', handleDelete);
    modalForm.addEventListener('submit', handleFormSubmit);

    // ── Step navigation ───────────────────────────────────────────────────────
    document.getElementById('modal-next-btn').addEventListener('click', () => goToModalStep(1));
    document.getElementById('modal-back-btn').addEventListener('click', () => goToModalStep(0));
    document.querySelectorAll('.step-dot').forEach((dot, i) => {
      dot.addEventListener('click', () => goToModalStep(i));
    });

    // ── Entry type picker ─────────────────────────────────────────────────────
    document.getElementById('entry-type-picker').querySelectorAll('.type-opt').forEach(btn => {
      btn.addEventListener('click', () =>
        setPickerValue('entry-type-picker', 'f-entryType', btn.dataset.value));
    });

    // ── Layout picker ─────────────────────────────────────────────────────────
    document.getElementById('layout-picker').querySelectorAll('.layout-opt').forEach(btn => {
      btn.addEventListener('click', () =>
        setPickerValue('layout-picker', 'f-layout', btn.dataset.value));
    });

    // ── Source type toggle ────────────────────────────────────────────────────
    document.getElementById('source-type-picker').querySelectorAll('.toggle-opt').forEach(btn => {
      btn.addEventListener('click', () =>
        setPickerValue('source-type-picker', 'f-type', btn.dataset.value));
    });

    // ── End date toggle ───────────────────────────────────────────────────────
    document.getElementById('to-date-toggle-btn').addEventListener('click', () => {
      const section = document.getElementById('to-date-section');
      setToDateExpanded(!section.classList.contains('open'));
    });

    // ── Attachment zone events ────────────────────────────────────────────────
    attachmentZone.addEventListener('click', () => attachmentInput.click());
    document.getElementById('attachment-browse').addEventListener('click', (e) => {
      e.stopPropagation();
      attachmentInput.click();
    });

    attachmentInput.addEventListener('change', (e) => {
      if (e.target.files.length) {
        addFiles(e.target.files);
        e.target.value = '';
      }
    });

    attachmentZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      attachmentZone.classList.add('drag-over');
    });
    attachmentZone.addEventListener('dragleave', () => {
      attachmentZone.classList.remove('drag-over');
    });
    attachmentZone.addEventListener('drop', (e) => {
      e.preventDefault();
      attachmentZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });

    // ── Lightbox events ───────────────────────────────────────────────────────
    lightbox.addEventListener('click', (e) => {
      if (e.target !== lightboxImg) closeLightbox();
    });
    document.getElementById('lightbox-close').addEventListener('click', closeLightbox);

    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      Render.setSearchQuery(searchQuery);
      renderList(Render.getEntries());
    });

    // / or Escape while search is focused → clear and close
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === '/') {
        e.preventDefault();
        e.stopPropagation();
        searchInput.value = '';
        searchQuery = '';
        Render.setSearchQuery('');
        renderList(Render.getEntries());
        searchInput.blur();
        if (!listPanel.classList.contains('collapsed')) toggleListPanel();
      }
    });

    soundBtn.addEventListener('click', () => {
      Sound.toggle();
      updateSoundBtn();
    });

    importInput.addEventListener('change', async (e) => {
      if (e.target.files[0]) {
        await Entries.importJSON(e.target.files[0]);
        await refresh();
        e.target.value = '';
      }
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (lightbox.classList.contains('open')) { closeLightbox(); return; }
        if (modal.classList.contains('open'))    { closeModal();    return; }
      }
      handleKeydown(e);
    });

    // ── Canvas interaction — hover cards, cursor, connect, annotation ─────────
    canvasEl.addEventListener('mousemove', (e) => {
      // Pen tool: record live stroke
      if (annotating && annotDrawing && annotTool === 'pen') {
        annotLivePoints.push({ x: e.clientX, y: e.clientY });
        Render.setLiveAnnotation([...annotLivePoints]);
        return;
      }
      // Line tool: live preview from first point to cursor
      if (annotating && annotTool === 'line' && lineStart) {
        Render.setLiveAnnotation([lineStart, { x: e.clientX, y: e.clientY }]);
      }

      const entry = Timeline.hitTest(Render.getEntries(), e.clientX, 20);

      // Cursor
      if (annotating) {
        canvasEl.style.cursor = 'crosshair';
      } else if (connectSourceEntry) {
        canvasEl.style.cursor = (entry && entry.id !== connectSourceEntry.id) ? 'cell' : 'crosshair';
      } else {
        canvasEl.style.cursor = entry ? 'pointer' : '';
      }

      // Hover cards
      if (!cardsAlwaysOn && !annotating) {
        if (entry) showHoverCard(entry, Timeline.dateToX(entry.year));
        else hideHoverCard();
      }
    });

    canvasEl.addEventListener('mouseleave', () => {
      if (!cardsAlwaysOn) hideHoverCard();
      if (!connectSourceEntry && !annotating) canvasEl.style.cursor = '';
    });

    // Annotation: tool interactions on mousedown
    canvasEl.addEventListener('mousedown', (e) => {
      if (!annotating || e.button !== 0) return;
      if (annotTool === 'pen') {
        annotDrawing    = true;
        annotLivePoints = [{ x: e.clientX, y: e.clientY }];
        Timeline.markDirty();
      } else if (annotTool === 'text') {
        showTextOverlay(e.clientX, e.clientY);
      } else if (annotTool === 'image') {
        imagePlacementPos = { x: e.clientX, y: e.clientY };
        annImageInputEl.click();
      } else if (annotTool === 'line') {
        if (!lineStart) {
          lineStart = { x: e.clientX, y: e.clientY };
          Render.setLiveAnnotation([lineStart, lineStart]);
        } else {
          const x2 = e.clientX, y2 = e.clientY;
          Annotations.add({
            type:         'line',
            x1year:       Timeline.xToDate(lineStart.x),
            x1yFraction:  lineStart.y / Timeline.canvasHeight,
            x2year:       Timeline.xToDate(x2),
            x2yFraction:  y2 / Timeline.canvasHeight,
          });
          lineStart = null;
          Render.setLiveAnnotation(null);
          Timeline.markDirty();
        }
      }
    });

    // Annotation: commit pen stroke on mouseup (window-level for releases outside canvas)
    window.addEventListener('mouseup', () => {
      if (!annotating || !annotDrawing || annotTool !== 'pen') return;
      annotDrawing = false;
      if (annotLivePoints.length > 1) {
        Annotations.add({
          points: annotLivePoints.map(p => ({
            year:      Timeline.xToDate(p.x),
            yFraction: p.y / Timeline.canvasHeight,
          })),
        });
      }
      annotLivePoints = [];
      Render.setLiveAnnotation(null);
    });

    // ── Annotation toolbar ────────────────────────────────────────────────────
    annToolbarEl     = document.getElementById('annotation-toolbar');
    annTextOverlayEl = document.getElementById('ann-text-overlay');
    annTextCursorEl  = document.getElementById('ann-text-cursor');
    annImageInputEl  = document.getElementById('ann-image-input');

    for (const btn of annToolbarEl.querySelectorAll('.ann-tool')) {
      btn.addEventListener('click', () => {
        annotTool = btn.id === 'ann-tool-pen'   ? 'pen'
                  : btn.id === 'ann-tool-text'  ? 'text'
                  : btn.id === 'ann-tool-image' ? 'image'
                  : 'line';
        annToolbarEl.querySelectorAll('.ann-tool').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        lineStart = null;
        Render.setLiveAnnotation(null);
        if (annotTool !== 'text') hideTextOverlay();
      });
    }

    annImageInputEl.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file || !imagePlacementPos) { imagePlacementPos = null; return; }
      const pos = imagePlacementPos;
      imagePlacementPos = null;
      const { dataUrl, naturalW, naturalH } = await resizeImage(file);
      Annotations.add({
        type:      'image',
        year:      Timeline.xToDate(pos.x),
        yFraction: pos.y / Timeline.canvasHeight,
        data:      dataUrl,
        naturalW,
        naturalH,
        displayH:  0.20,
      });
      Timeline.markDirty();
    });

    document.getElementById('ann-undo').addEventListener('click', () => {
      Annotations.removeLast();
      Timeline.markDirty();
    });
    document.getElementById('ann-clear').addEventListener('click', () => {
      Annotations.removeAll();
      Timeline.markDirty();
    });

    annTextCursorEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const text = annTextCursorEl.textContent.trim();
        if (text && textAnchor) {
          Annotations.add({
            type:      'text',
            year:      Timeline.xToDate(textAnchor.x),
            yFraction: textAnchor.y / Timeline.canvasHeight,
            text,
            fontSize:  13,
          });
          Timeline.markDirty();
        }
        hideTextOverlay();
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        hideTextOverlay();
      }
    });

    // ── Date precision show/hide ──────────────────────────────────────────────
    const fromUnitEl = modalForm.elements['fromUnit'];
    const toUnitEl   = modalForm.elements['toUnit'];
    const fromPrecEl = document.getElementById('from-precision');
    const toPrecEl   = document.getElementById('to-precision');
    const fromTimeEl = document.getElementById('from-time');
    const toTimeEl   = document.getElementById('to-time');
    fromUnitEl.addEventListener('change', () => updateDatePrecision(fromUnitEl, fromPrecEl, fromTimeEl));
    toUnitEl.addEventListener('change',   () => updateDatePrecision(toUnitEl,   toPrecEl,   toTimeEl));

    // ── Export / import menu ──────────────────────────────────────────────────
    const exportBtnWrap = document.getElementById('export-btn-wrap');
    const exportMenu    = document.getElementById('export-menu');

    document.getElementById('export-btn').addEventListener('click', () => {
      exportMenu.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!exportBtnWrap.contains(e.target)) exportMenu.classList.remove('open');
    });
    document.getElementById('export-snapshot').addEventListener('click', () => {
      exportMenu.classList.remove('open');
      snapshotTimeline();
    });
    document.getElementById('export-json').addEventListener('click', () => {
      exportMenu.classList.remove('open');
      Entries.exportJSON();
    });
    document.getElementById('import-json-btn').addEventListener('click', () => {
      exportMenu.classList.remove('open');
      importInput.click();
    });
  }

  function setAnnotationMode(on) {
    annotating = on;
    Timeline.setPanEnabled(!on);
    annotateBtnEl.classList.toggle('active', on);
    annotateBtnEl.title = on ? 'Stop annotating (N)' : 'Annotate (N)';
    if (annToolbarEl) annToolbarEl.classList.toggle('visible', on);
    if (canvasEl) canvasEl.style.cursor = on ? 'crosshair' : '';
    if (!on) {
      annotDrawing      = false;
      annotLivePoints   = [];
      lineStart         = null;
      imagePlacementPos = null;
      Render.setLiveAnnotation(null);
      hideTextOverlay();
    }
    if (on) hideHoverCard();
  }

  function showTextOverlay(x, y) {
    if (!annTextOverlayEl) return;
    textAnchor = { x, y };
    annTextOverlayEl.style.left    = x + 'px';
    annTextOverlayEl.style.top     = y + 'px';
    annTextOverlayEl.style.display = 'block';
    annTextCursorEl.textContent    = '';
    annTextCursorEl.focus();
  }

  function hideTextOverlay() {
    if (annTextOverlayEl) annTextOverlayEl.style.display = 'none';
    textAnchor = null;
  }

  return { init, refresh, openEditModal, handleConnectClick };
})();
