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
  let annotDrawing     = false;
  let annotLivePoints  = [];

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

  function buildCardEl(entry) {
    const layout = entry.layout || 'compact';
    const el = document.createElement('div');
    el.className = `entry-card layout-${layout}`;
    el.dataset.id     = entry.id;
    el.dataset.layout = layout;

    const dateStr = entry.yearEnd
      ? `${formatYear(entry.year)} – ${formatYear(entry.yearEnd)}`
      : formatYear(entry.year);

    const tagsHtml = (entry.tags || []).length
      ? `<div class="entry-card-tags">${entry.tags.map(t =>
          `<span class="entry-card-tag">${t}</span>`).join('')}</div>`
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
      const heroSrc = heroRaw ? (typeof heroRaw === 'string' ? heroRaw : heroRaw.data) : null;
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

    el.addEventListener('click', () => openEditModal(entry));
    return el;
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

  // Returns {value, unit} for pre-populating the edit form
  function fromYearsAgo(yearsAgo) {
    if (yearsAgo == null) return { value: '', unit: 'CE' };
    if (yearsAgo <= CURRENT_YEAR) {
      const ceYear = CURRENT_YEAR - yearsAgo;
      if (ceYear >= 1) return { value: Math.round(ceYear), unit: 'CE' };
      return { value: Math.round(-ceYear + 1), unit: 'BCE' };
    }
    if (yearsAgo < 10_000)       return { value: Math.round(yearsAgo),                 unit: 'ya' };
    if (yearsAgo < 1_000_000)    return { value: +(yearsAgo / 1_000).toPrecision(4),   unit: 'kya' };
    if (yearsAgo < 1_000_000_000) return { value: +(yearsAgo / 1_000_000).toPrecision(4), unit: 'mya' };
    return { value: +(yearsAgo / 1_000_000_000).toPrecision(4), unit: 'bya' };
  }

  // ── List panel ────────────────────────────────────────────────────────────────
  function renderList(entries) {
    const filtered = entries.filter(e =>
      !searchQuery ||
      e.title.toLowerCase().includes(searchQuery) ||
      (e.summary || '').toLowerCase().includes(searchQuery) ||
      (e.tags || []).some(t => t.toLowerCase().includes(searchQuery))
    );

    filtered.sort((a, b) => a.year - b.year);

    listItems.innerHTML = '';
    for (const entry of filtered) {
      const li = document.createElement('li');
      li.className = 'list-item';
      li.dataset.id = entry.id;
      li.innerHTML = `
        <span class="list-item-year">${formatYear(entry.year)}</span>
        <span class="list-item-title">${entry.title}</span>
      `;
      li.addEventListener('click', () => openEditModal(entry));
      listItems.appendChild(li);
    }
  }

  function formatYear(yearsAgo) {
    if (yearsAgo == null) return '';
    if (yearsAgo === 0)   return 'Today';
    const ceYear = CURRENT_YEAR - yearsAgo;

    if (ceYear > 0) return Math.round(ceYear).toString();

    const bce = Math.abs(Math.round(ceYear));
    if (bce >= 1_000_000_000) return `${(bce / 1e9).toFixed(2)}B BCE`;
    if (bce >= 1_000_000)     return `${(bce / 1e6).toFixed(2)}M BCE`;
    if (bce >= 1_000)         return `${(bce / 1000).toFixed(1)}k BCE`;
    return `${bce} BCE`;
  }

  function toggleListPanel() {
    const isOpen = !listPanel.classList.contains('collapsed');
    if (isOpen) {
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

  // ── Modal ─────────────────────────────────────────────────────────────────────
  function openAddModal() {
    editingId = null;
    pendingAttachments = [];
    pendingConnections = [];
    modalTitle.textContent = 'Add Entry';
    modalDelete.style.display = 'none';
    modalForm.reset();
    modalForm.elements['fromUnit'].value = 'CE';
    modalForm.elements['toUnit'].value   = 'CE';
    if (connSearchEl) connSearchEl.value = '';
    renderAttachmentGrid();
    renderConnectionChips();
    modal.classList.add('open');
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
    modalForm.elements['type'].value      = entry.type      || 'historical';
    modalForm.elements['entryType'].value = entry.entryType || 'Event';
    modalForm.elements['summary'].value   = entry.summary   || '';
    modalForm.elements['notes'].value     = entry.notes     || '';
    modalForm.elements['tags'].value      = (entry.tags || []).join(', ');
    modalForm.elements['layout'].value   = entry.layout   || 'compact';

    if (connSearchEl) connSearchEl.value = '';
    renderAttachmentGrid();
    renderConnectionChips();
    modal.classList.add('open');
  }

  function closeModal() {
    modal.classList.remove('open');
    editingId = null;
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    const f = modalForm.elements;

    const entry = {
      title:     f['title'].value.trim(),
      year:      toYearsAgo(f['fromValue'].value, f['fromUnit'].value),
      yearEnd:   f['toValue'].value ? toYearsAgo(f['toValue'].value, f['toUnit'].value) : null,
      type:      f['type'].value,
      entryType: f['entryType'].value,
      layout:    f['layout'].value || 'compact',
      summary:   f['summary'].value.trim(),
      notes:     f['notes'].value.trim(),
      tags:      f['tags'].value.split(',').map(t => t.trim()).filter(Boolean),
      image:     '',
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
        if (!listPanel.classList.contains('collapsed')) toggleListPanel();
        break;
    }
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

    addBtn.addEventListener('click', openAddModal);
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
      renderList(Render.getEntries());
      Timeline.markDirty();
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
      // Annotation drawing
      if (annotating && annotDrawing) {
        annotLivePoints.push({ x: e.clientX, y: e.clientY });
        Render.setLiveAnnotation([...annotLivePoints]);
        return;
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

    // Annotation: start stroke on mousedown
    canvasEl.addEventListener('mousedown', (e) => {
      if (!annotating || e.button !== 0) return;
      annotDrawing    = true;
      annotLivePoints = [{ x: e.clientX, y: e.clientY }];
      Timeline.markDirty();
    });

    // Annotation: commit stroke on mouseup (window-level to catch releases outside canvas)
    window.addEventListener('mouseup', () => {
      if (!annotating || !annotDrawing) return;
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
  }

  function setAnnotationMode(on) {
    annotating = on;
    Timeline.setPanEnabled(!on);
    annotateBtnEl.classList.toggle('active', on);
    annotateBtnEl.title = on ? 'Stop annotating (N)' : 'Annotate (N)';
    if (canvasEl) canvasEl.style.cursor = on ? 'crosshair' : '';
    if (!on) {
      annotDrawing    = false;
      annotLivePoints = [];
      Render.setLiveAnnotation(null);
    }
    if (on) hideHoverCard();
  }

  return { init, refresh, openEditModal, handleConnectClick };
})();
