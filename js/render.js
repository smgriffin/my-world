// render.js — owns the canvas context, rAF loop, and all drawing.
// Reads state from Timeline. Never mutates Timeline state.

const Render = (() => {
  let canvas, ctx;
  let entries = [];

  // CLUSTER_RADIUS: minimum screen-pixel gap between two independent markers.
  // Must be large enough that markers at this distance don't visually collide.
  // ~65px = width of a short label ("Big Bang", "Apollo 11") + padding.
  // Entries closer than this merge into a numbered cluster badge.
  const CLUSTER_RADIUS = 65;
  const GOLD  = '#E8962A';
  const WHITE = '#EDE8DC';
  const DIM   = 'rgba(237,232,220,0.72)';
  const AXIS_H = 48;

  // ── Tag colours ───────────────────────────────────────────────────────────────
  const TAG_PALETTE = [
    '#E8962A', // gold
    '#4FC3F7', // sky blue
    '#81C784', // sage green
    '#F06292', // rose
    '#CE93D8', // lavender
    '#80CBC4', // teal
    '#FFB74D', // amber
    '#AED581', // lime
    '#90CAF9', // cornflower
    '#EF9A9A', // blush
  ];

  function tagColor(tag) {
    let h = 0;
    for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
    return TAG_PALETTE[h % TAG_PALETTE.length];
  }

  function entryColor(entry) {
    const tags = entry.tags || [];
    return tags.length ? tagColor(tags[0]) : GOLD;
  }

  // ── Tag filter ────────────────────────────────────────────────────────────────
  let activeTagFilter = null;

  function setTagFilter(tag) {
    activeTagFilter = tag || null;
    Timeline.markDirty();
  }

  function getTagFilter() { return activeTagFilter; }

  // ── Search filter ─────────────────────────────────────────────────────────────
  let activeSearch = '';

  function setSearchQuery(q) {
    activeSearch = q || '';
    Timeline.markDirty();
  }

  function entryMatchesSearch(entry) {
    if (!activeSearch) return true;
    const q = activeSearch.toLowerCase();
    return entry.title.toLowerCase().includes(q) ||
      (entry.summary || '').toLowerCase().includes(q) ||
      (entry.tags || []).some(t => t.toLowerCase().includes(q));
  }

  // ── Date label helper ─────────────────────────────────────────────────────────
  const CURRENT_YEAR = new Date().getFullYear();
  const MS_PER_YEAR  = 365.25 * 24 * 3600 * 1000;
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function yearsAgoToDate(yearsAgo) {
    return new Date(Date.now() - yearsAgo * MS_PER_YEAR);
  }

  function yearsAgoToLabel(yearsAgo, visibleSpan) {
    if (yearsAgo <= 0) return 'Today';

    // Sub-day: show HH:MM
    if (visibleSpan < 1 / 365.25) {
      const d = yearsAgoToDate(yearsAgo);
      return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }

    // Sub-week: show "Mar 15 14:00"
    if (visibleSpan < 7 / 365.25) {
      const d = yearsAgoToDate(yearsAgo);
      const time = d.getHours() !== 0 ? ` ${String(d.getHours()).padStart(2,'0')}:00` : '';
      return `${MON[d.getMonth()]} ${d.getDate()}${time}`;
    }

    // Sub-year: show "Mar 15" or "Mar YYYY"
    if (visibleSpan < 1) {
      const d = yearsAgoToDate(yearsAgo);
      return visibleSpan < 2 / 12
        ? `${MON[d.getMonth()]} ${d.getDate()}`
        : `${MON[d.getMonth()]} ${d.getFullYear()}`;
    }

    // 1–200 years: show CE year
    if (visibleSpan <= 200) {
      const ceYear = CURRENT_YEAR - yearsAgo;
      if (ceYear > 0) return Math.round(ceYear).toString();
    }

    // Wide view: always use compact relative labels so distant ticks
    // don't show confusing CE years like "1025" next to "1 Bya".
    if (yearsAgo >= 1_000_000_000) return `${+(yearsAgo / 1e9).toPrecision(2)} Bya`;
    if (yearsAgo >= 1_000_000)     return `${+(yearsAgo / 1e6).toPrecision(2)} Mya`;
    if (yearsAgo >= 10_000)        return `${+(yearsAgo / 1e3).toPrecision(2)} kya`;

    // 200–10 000 years: show BCE/CE year
    const ceYear = CURRENT_YEAR - yearsAgo;
    if (ceYear > 0) return Math.round(ceYear).toString();
    return `${Math.abs(Math.round(ceYear))} BCE`;
  }

  // ── Marker drop animations ────────────────────────────────────────────────────
  // entryId → { startTime, duration }
  const markerAnims = new Map();

  function triggerMarkerDrop(entryId) {
    markerAnims.set(entryId, { startTime: performance.now(), duration: 720 });
    Timeline.markDirty();
  }

  // Elastic ease-out spring: settles at 1, overshoots slightly
  function springEase(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return 1 - Math.exp(-7 * t) * Math.cos(13 * t);
  }

  function getMarkerDropOffset(entryId) {
    const anim = markerAnims.get(entryId);
    if (!anim) return 0;
    const t = (performance.now() - anim.startTime) / anim.duration;
    if (t >= 1) { markerAnims.delete(entryId); return 0; }
    return -52 * (1 - springEase(t)); // starts 52px above, settles to 0
  }

  // ── Hover state ───────────────────────────────────────────────────────────────
  let hoveredEntry = null;
  let mouseX = -999;
  let mouseY = -999;

  // ── Connect mode ─────────────────────────────────────────────────────────────
  let connectSourceId = null;

  function setConnectSource(id) {
    connectSourceId = id;
    Timeline.markDirty();
  }

  // ── Connection visibility (driven by cards-always-on mode) ───────────────────
  let connectionsVisible = false;

  function setConnectionsVisible(on) {
    connectionsVisible = on;
    Timeline.markDirty();
  }

  // ── Annotation image cache ────────────────────────────────────────────────────
  // Keyed by annotation id. null = loading in progress; HTMLImageElement = ready.
  const annotImageCache = new Map();

  // ── Live annotation (screen coords — current stroke being drawn) ──────────────
  let liveAnnotationPoints = null; // [{x,y}] screen coords

  // ── Sorted entry cache ────────────────────────────────────────────────────────
  // entries sorted by year (ascending = left on screen) — rebuilt only when entries change.
  let sortedEntries = [];
  let entriesVersion = 0; // bumped by setEntries

  // Per-frame x-position cache: avoids re-calling dateToX for same entry twice.
  // Keyed by entry id, valid for the current draw call only.
  let xCache = new Map();

  function cachedX(entry) {
    let x = xCache.get(entry.id);
    if (x === undefined) { x = Timeline.dateToX(entry.year); xCache.set(entry.id, x); }
    return x;
  }

  // ── Label-width cache ─────────────────────────────────────────────────────────
  // measureText is fast but called many times per frame; cache by title string.
  const labelWidthCache = new Map();
  function labelWidth(title) {
    let w = labelWidthCache.get(title);
    if (w === undefined) {
      w = ctx ? ctx.measureText(title).width : title.length * 7;
      labelWidthCache.set(title, w);
    }
    return w;
  }

  // ── Clustering — label-aware O(n) sweep ───────────────────────────────────────
  // Entries are absorbed into a cluster whenever their label would overlap the
  // previous group's label (or badge). This guarantees zero label collisions
  // regardless of title length, without a separate suppression pass.
  // MIN_GAP is the breathing room between adjacent labels/badges.
  const MIN_GAP = 10;
  const BADGE_HALF = 14; // half-width of a cluster badge circle

  function cluster(visible) {
    if (!visible.length) return [];
    if (ctx) ctx.font = '11px "Cinzel", serif'; // prime measureText

    const groups = [];
    let group   = [visible[0]];
    let gx      = cachedX(visible[0]);
    // Right edge of the current group's visual footprint
    let gRight  = gx + labelWidth(visible[0].title) / 2;

    for (let i = 1; i < visible.length; i++) {
      const x    = cachedX(visible[i]);
      const hw   = labelWidth(visible[i].title) / 2;
      const lft  = x - hw; // left edge of this entry's label

      if (lft < gRight + MIN_GAP) {
        // Would overlap — absorb into current cluster
        group.push(visible[i]);
        // Recalculate centroid
        gx = 0; for (const e of group) gx += cachedX(e); gx /= group.length;
        // Cluster badge is compact; its right edge is just gx + BADGE_HALF
        gRight = gx + BADGE_HALF;
      } else {
        groups.push(group);
        group  = [visible[i]];
        gx     = x;
        gRight = x + hw;
      }
    }
    groups.push(group);
    return groups;
  }

  // ── Axis ──────────────────────────────────────────────────────────────────────
  function drawAxis() {
    const w = Timeline.canvasWidth;
    const h = Timeline.canvasHeight;
    const axisY = h - AXIS_H;

    ctx.strokeStyle = 'rgba(232,150,42,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, axisY);
    ctx.lineTo(w, axisY);
    ctx.stroke();

    const MIN_PX     = 90; // minimum screen px between tick labels
    const leftDate   = Timeline.xToDate(0);
    const rightDate  = Timeline.xToDate(w);
    const visibleSpan = Math.abs(leftDate - rightDate);

    let tickValues = [];

    if (visibleSpan > 200) {
      // ── Log-space ticks ────────────────────────────────────────────────────
      // Candidates: 1, 2, 5 × 10^n for all n. These are evenly spaced on the
      // log scale so they spread naturally across the full timeline without
      // clustering near the present.
      const cands = [];
      for (let exp = 0; exp <= 10; exp++) {
        const base = Math.pow(10, exp);
        for (const mult of [1, 2, 5]) {
          const v = mult * base;
          if (v >= rightDate && v <= leftDate) cands.push(v);
        }
      }
      // Sort descending (large yearsAgo = left side of canvas first)
      cands.sort((a, b) => b - a);

      // Walk left→right, keeping only ticks with enough screen spacing
      let lastX = -Infinity;
      for (const v of cands) {
        const x = Timeline.dateToX(v);
        if (x < -20 || x > w + 20) continue;
        if (x >= lastX + MIN_PX) {
          tickValues.push(v);
          lastX = x;
        }
      }
    } else {
      // ── Linear ticks for zoomed-in views (days / months / years) ──────────
      const minInterval = MIN_PX * (rightDate + 1) / Timeline.zoom;
      const NICE = [
        1 / (365.25 * 24 * 2), 1 / (365.25 * 24), 2 / (365.25 * 24),
        6 / (365.25 * 24), 12 / (365.25 * 24),
        1 / 365.25, 2 / 365.25, 7 / 365.25, 14 / 365.25,
        1 / 12, 1 / 4, 1 / 2,
        1, 2, 5, 10, 20, 50, 100, 200,
      ];
      const tickInterval = NICE.find(i => i >= minInterval) ?? NICE[NICE.length - 1];
      const start = Math.ceil(rightDate  / tickInterval) * tickInterval;
      const end   = Math.floor(leftDate / tickInterval) * tickInterval;
      if (isFinite(start) && isFinite(end) && end >= start) {
        for (let t = start; t <= end && tickValues.length < 20; t += tickInterval) {
          tickValues.push(t);
        }
      }
    }

    // ── Draw ticks and labels ──────────────────────────────────────────────
    ctx.fillStyle = DIM;
    ctx.font = '11px "Cormorant Garamond", serif';
    ctx.textAlign = 'center';

    for (const t of tickValues) {
      const x = Timeline.dateToX(t);
      if (x < -20 || x > w + 20) continue;

      ctx.strokeStyle = 'rgba(232,150,42,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, axisY - 5);
      ctx.lineTo(x, axisY + 3);
      ctx.stroke();

      ctx.fillText(yearsAgoToLabel(t, visibleSpan), x, axisY + 16);
    }
  }

  // ── Viewport indicator ───────────────────────────────────────────────────────
  // Shows the visible date range in the top-right corner.
  function drawViewportIndicator() {
    const w           = Timeline.canvasWidth;
    const leftDate    = Timeline.xToDate(0);
    const rightDate   = Timeline.xToDate(w);
    const visibleSpan = Math.abs(leftDate - rightDate);

    const leftLabel  = yearsAgoToLabel(leftDate,  visibleSpan);
    const rightLabel = yearsAgoToLabel(rightDate, visibleSpan);
    const label      = leftLabel === rightLabel ? leftLabel : `${rightLabel} — ${leftLabel}`;

    ctx.save();
    ctx.font      = '10px "Cinzel", serif';
    ctx.fillStyle = 'rgba(237,232,220,0.22)';
    ctx.textAlign = 'right';
    ctx.fillText(label, w - 16, 22);
    ctx.restore();
  }

  // ── Today marker ─────────────────────────────────────────────────────────────
  function drawTodayMarker() {
    const w = Timeline.canvasWidth;
    const h = Timeline.canvasHeight;
    const axisY = h - AXIS_H;
    const x = Timeline.dateToX(0);
    if (x < -40 || x > w + 40) return;

    ctx.strokeStyle = 'rgba(232,150,42,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x, axisY - 60);
    ctx.lineTo(x, axisY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(232,150,42,0.55)';
    ctx.font = '9px "Cinzel", serif';
    ctx.textAlign = 'center';
    ctx.fillText('NOW', x, axisY - 66);
  }

  // ── Draw a single marker ──────────────────────────────────────────────────────
  function drawMarker(entry, x, showLabel = true) {
    const h = Timeline.canvasHeight;
    const axisY = h - AXIS_H;
    const isHovered  = hoveredEntry && hoveredEntry.id === entry.id;
    const isSource   = connectSourceId === entry.id;

    // Dim entries that don't match active tag filter or search query
    const isFiltered = (activeTagFilter && !(entry.tags || []).includes(activeTagFilter))
                    || (activeSearch && !entryMatchesSearch(entry));
    if (isFiltered) ctx.globalAlpha = 0.18;

    const color = entryColor(entry);

    // Drop animation offset
    const dropY = getMarkerDropOffset(entry.id);
    const markerY = axisY - 2 + dropY;

    // Connect-source ring — strong pulsing halo
    if (isSource) {
      const pulse = 0.18 + 0.12 * Math.sin(performance.now() / 400);
      const [r, g, b] = hexToRgb(color);
      const ring = ctx.createRadialGradient(x, markerY, 0, x, markerY, 32);
      ring.addColorStop(0,   `rgba(${r},${g},${b},${(pulse * 2.2).toFixed(3)})`);
      ring.addColorStop(0.5, `rgba(${r},${g},${b},${pulse.toFixed(3)})`);
      ring.addColorStop(1,   `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = ring;
      ctx.fillRect(x - 32, markerY - 32, 64, 64);
    } else if (isHovered) {
      // Hover glow — soft radial pulse
      const pulse = 0.14 + 0.10 * Math.sin(performance.now() / 700);
      const [r, g, b] = hexToRgb(color);
      const glow = ctx.createRadialGradient(x, markerY, 0, x, markerY, 22);
      glow.addColorStop(0,   `rgba(${r},${g},${b},${(pulse * 2).toFixed(3)})`);
      glow.addColorStop(0.5, `rgba(${r},${g},${b},${pulse.toFixed(3)})`);
      glow.addColorStop(1,   `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(x - 24, markerY - 24, 48, 48);
    }

    // Span bar
    if (entry.yearEnd) {
      const x2 = Timeline.dateToX(entry.yearEnd);
      const [r, g, b] = hexToRgb(color);
      ctx.fillStyle = (isHovered || isSource) ? `rgba(${r},${g},${b},0.32)` : `rgba(${r},${g},${b},0.14)`;
      ctx.fillRect(Math.min(x, x2), axisY - 5, Math.abs(x2 - x), 5);
    }

    // Diamond — larger and bright white when it's the connect source
    const size = isSource ? 9 : isHovered ? 7 : 5;
    ctx.fillStyle = isSource ? WHITE : isHovered ? color : color + 'B8'; // B8 ≈ 72% opacity
    ctx.save();
    ctx.translate(x, markerY);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.restore();

    // Label
    if (showLabel || isHovered || isSource) {
      const labelY = (isHovered || isSource) ? axisY - 20 : axisY - 14;
      ctx.font = `11px "Cinzel", serif`;
      ctx.fillStyle = (isHovered || isSource) ? WHITE : DIM;
      ctx.textAlign = 'center';
      ctx.globalAlpha = isFiltered ? 0.18 : (isHovered || isSource) ? 1 : 0.85;
      ctx.fillText(entry.title, x, labelY + dropY);
      ctx.globalAlpha = 1;
    }

    if (isFiltered) ctx.globalAlpha = 1;
  }

  // Convert hex color (#RRGGBB) to [r, g, b]
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // ── Draw cluster badge ────────────────────────────────────────────────────────
  function drawCluster(group, x) {
    const h = Timeline.canvasHeight;
    const axisY = h - AXIS_H;
    const r = 10;

    ctx.fillStyle = 'rgba(232,150,42,0.18)';
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, axisY - r - 2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = GOLD;
    ctx.font = 'bold 10px "Cinzel", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(group.length, x, axisY - r - 2);
    ctx.textBaseline = 'alphabetic';
  }

  // ── Empty state ───────────────────────────────────────────────────────────────
  function drawEmptyState() {
    const w = Timeline.canvasWidth;
    const h = Timeline.canvasHeight;
    const axisY = h - AXIS_H;

    // Subtle reticle on the axis centre
    const cx = w / 2;
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, axisY, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 14, axisY);
    ctx.lineTo(cx + 14, axisY);
    ctx.stroke();

    ctx.globalAlpha = 0.13;
    ctx.fillStyle = GOLD;
    ctx.font = '10px "Cinzel", serif';
    ctx.textAlign = 'center';
    ctx.letterSpacing = '0.2em';
    ctx.fillText('YOUR WORLD BEGINS HERE', cx, axisY - 28);
    ctx.restore();
  }

  // ── Connection arcs ───────────────────────────────────────────────────────────
  function drawConnections() {
    const h     = Timeline.canvasHeight;
    const w     = Timeline.canvasWidth;
    const axisY = h - AXIS_H;
    const idMap = new Map(entries.map(e => [e.id, e]));

    for (const entry of entries) {
      if (!entry.links || !entry.links.length) continue;
      const x1 = Timeline.dateToX(entry.year);

      for (const link of entry.links) {
        if (!link.toId) continue;
        // Draw each arc only once: lower id draws it
        if (entry.id > link.toId) continue;

        const target = idMap.get(link.toId);
        if (!target) continue;
        const x2 = Timeline.dateToX(target.year);

        // Skip arcs entirely off-screen
        if (Math.max(x1, x2) < -60 || Math.min(x1, x2) > w + 60) continue;

        const isHot = hoveredEntry &&
          (hoveredEntry.id === entry.id || hoveredEntry.id === target.id);

        const midX    = (x1 + x2) / 2;
        const dist    = Math.abs(x2 - x1);
        const arcH    = Math.min(dist * 0.28, 110);
        const cpY     = axisY - 6 - arcH;

        ctx.beginPath();
        ctx.moveTo(x1, axisY - 5);
        ctx.quadraticCurveTo(midX, cpY, x2, axisY - 5);
        ctx.strokeStyle = isHot            ? 'rgba(232,150,42,0.72)'
                        : connectionsVisible ? 'rgba(232,150,42,0.42)'
                        : 'rgba(232,150,42,0.14)';
        ctx.lineWidth   = isHot ? 1.5 : connectionsVisible ? 1.1 : 0.7;
        ctx.setLineDash(isHot || connectionsVisible ? [] : [3, 5]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Endpoint dots when connections are highlighted
        if (connectionsVisible || isHot) {
          const dotAlpha = isHot ? 0.75 : 0.40;
          ctx.fillStyle = `rgba(232,150,42,${dotAlpha})`;
          ctx.beginPath(); ctx.arc(x1, axisY - 5, 2.5, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x2, axisY - 5, 2.5, 0, Math.PI * 2); ctx.fill();
        }

        if (link.label && arcH > 18) {
          ctx.fillStyle   = isHot ? 'rgba(232,150,42,0.72)' : 'rgba(232,150,42,0.38)';
          ctx.font        = '8px "Cinzel", serif';
          ctx.textAlign   = 'center';
          ctx.globalAlpha = 1;
          ctx.fillText(link.label, midX, cpY - 4);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // ── Main draw ─────────────────────────────────────────────────────────────────
  function draw() {
    const w    = Timeline.canvasWidth;
    const h    = Timeline.canvasHeight;
    const zone = Timeline.currentZone();

    Background.update(zone, ctx, w, h);
    Sound.applyZone(zone);
    drawTodayMarker();
    drawAxis();
    drawViewportIndicator();

    if (entries.length === 0) {
      drawEmptyState();
      return;
    }

    // Reset per-frame x-cache
    xCache = new Map();

    // Update hovered entry (use sorted array + binary search via hitTest)
    hoveredEntry = Timeline.hitTest(entries, mouseX, 20);

    // Viewport cull: only pass entries whose x is on-screen (+/- 80px margin)
    // sortedEntries is pre-sorted by year; since year maps monotonically to x
    // (larger year = further left), we can binary-search for the visible window.
    const leftDate  = Timeline.xToDate(w + 80);
    const rightDate = Timeline.xToDate(-80);
    // Binary search for first entry with year >= leftDate
    let lo = 0, hi = sortedEntries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sortedEntries[mid].year < leftDate) lo = mid + 1; else hi = mid;
    }
    const visStart = lo;
    // Binary search for last entry with year <= rightDate
    lo = 0; hi = sortedEntries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sortedEntries[mid].year <= rightDate) lo = mid + 1; else hi = mid;
    }
    const visible = sortedEntries.slice(visStart, lo);

    // Connection arcs (only between visible entries + their direct targets)
    drawConnections();

    // Cluster visible entries — O(n) sweep (sorted by year = sorted by x)
    // sortedEntries is descending year (left=old, right=new on log scale),
    // but x increases left→right as year decreases. Reverse for sweep.
    const visibleForCluster = [...visible].reverse();
    const groups = cluster(visibleForCluster);

    // Clustering guarantees no label collisions — draw everything unconditionally.
    for (const group of groups) {
      let sumX = 0;
      for (const e of group) sumX += cachedX(e);
      const avgX = sumX / group.length;

      if (group.length === 1) {
        drawMarker(group[0], avgX, true);
      } else {
        drawCluster(group, avgX);
      }
    }

    // ── Connect mode rubber-band ──────────────────────────────────────────────
    if (connectSourceId && mouseX > 0) {
      const src = entries.find(e => e.id === connectSourceId);
      if (src) {
        const sx = Timeline.dateToX(src.year);
        const axisY = h - AXIS_H;
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = 'rgba(232,150,42,0.70)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, axisY - 5);
        ctx.lineTo(mouseX, mouseY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // ── Annotations ──────────────────────────────────────────────────────────
    drawAnnotations();
  }

  // ── Annotation drawing ────────────────────────────────────────────────────────
  function setLiveAnnotation(points) {
    liveAnnotationPoints = points;
    Timeline.markDirty();
  }

  function drawAnnotations() {
    const h   = Timeline.canvasHeight;
    const all = Annotations.getAll();

    ctx.save();
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    for (const ann of all) {
      const color = ann.color || 'rgba(232,150,42,0.80)';
      const sw    = ann.strokeWidth || 1.5;

      if (ann.type === 'text') {
        if (!ann.text) continue;
        const x = Timeline.dateToX(ann.year);
        const y = ann.yFraction * h;
        ctx.font      = `${ann.fontSize || 13}px "Cinzel", serif`;
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
        ctx.fillText(ann.text, x, y);

      } else if (ann.type === 'line') {
        const x1 = Timeline.dateToX(ann.x1year);
        const y1 = ann.x1yFraction * h;
        const x2 = Timeline.dateToX(ann.x2year);
        const y2 = ann.x2yFraction * h;
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth   = sw;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

      } else if (ann.type === 'image') {
        if (!ann.data) continue;
        const screenX = Timeline.dateToX(ann.year);
        const screenY = ann.yFraction * h;

        if (!annotImageCache.has(ann.id)) {
          // Kick off async load; skip draw this frame
          annotImageCache.set(ann.id, null);
          const imgEl = new Image();
          imgEl.onload = () => { annotImageCache.set(ann.id, imgEl); Timeline.markDirty(); };
          imgEl.src = ann.data;
          continue;
        }
        const imgEl = annotImageCache.get(ann.id);
        if (!imgEl) continue; // still loading

        const dispH   = (ann.displayH || 0.20) * h;
        const aspect  = imgEl.naturalWidth / imgEl.naturalHeight;
        const dispW   = dispH * aspect;
        const left    = screenX - dispW / 2;
        const top     = screenY - dispH / 2;

        ctx.save();
        ctx.drawImage(imgEl, left, top, dispW, dispH);
        ctx.strokeStyle = 'rgba(232,150,42,0.32)';
        ctx.lineWidth   = 1;
        ctx.strokeRect(left, top, dispW, dispH);
        ctx.restore();

      } else {
        // Freehand stroke
        if (!ann.points || ann.points.length < 2) continue;
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth   = sw;
        const pts = ann.points;
        ctx.moveTo(Timeline.dateToX(pts[0].year), pts[0].yFraction * h);
        for (let i = 1; i < pts.length - 1; i++) {
          const x1 = Timeline.dateToX(pts[i].year);
          const y1 = pts[i].yFraction * h;
          const x2 = Timeline.dateToX(pts[i + 1].year);
          const y2 = pts[i + 1].yFraction * h;
          ctx.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(Timeline.dateToX(last.year), last.yFraction * h);
        ctx.stroke();
      }
    }

    // Live stroke / line preview (raw screen coords — not yet committed)
    if (liveAnnotationPoints && liveAnnotationPoints.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(232,150,42,0.80)';
      ctx.lineWidth   = 1.5;
      const lp = liveAnnotationPoints;
      // If exactly 2 points it's a line preview; otherwise smooth stroke
      if (lp.length === 2) {
        ctx.moveTo(lp[0].x, lp[0].y);
        ctx.lineTo(lp[1].x, lp[1].y);
      } else {
        ctx.moveTo(lp[0].x, lp[0].y);
        for (let i = 1; i < lp.length - 1; i++) {
          const mx = (lp[i].x + lp[i + 1].x) / 2;
          const my = (lp[i].y + lp[i + 1].y) / 2;
          ctx.quadraticCurveTo(lp[i].x, lp[i].y, mx, my);
        }
        ctx.lineTo(lp[lp.length - 1].x, lp[lp.length - 1].y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  // ── rAF loop ──────────────────────────────────────────────────────────────────
  // Clear dirty BEFORE draw so that animations triggered inside draw() persist.
  function loop() {
    const needsContinuousFrame =
      markerAnims.size > 0 ||
      connectSourceId !== null ||
      hoveredEntry !== null;

    if (Timeline.dirty || needsContinuousFrame) {
      Timeline.clearDirty();
      draw();
    }
    requestAnimationFrame(loop);
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');

    // Track mouse for hover detection
    canvas.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      Timeline.markDirty();
    });
    canvas.addEventListener('mouseleave', () => {
      mouseX = -999;
      mouseY = -999;
      hoveredEntry = null;
      Timeline.markDirty();
    });

    requestAnimationFrame(loop);
  }

  function setEntries(newEntries) {
    entries = newEntries;
    // Keep a sorted copy (ascending year = old→recent) for O(log n) viewport culling
    sortedEntries = [...newEntries].sort((a, b) => a.year - b.year);
    entriesVersion++;
    Timeline.markDirty();
  }

  function getEntries() { return entries; }

  // Binary search helpers (operate on sortedEntries, ascending year)
  function lowerBound(minYear) {
    let lo = 0, hi = sortedEntries.length;
    while (lo < hi) { const m = (lo + hi) >>> 1; if (sortedEntries[m].year < minYear) lo = m + 1; else hi = m; }
    return lo;
  }
  function upperBound(maxYear) {
    let lo = 0, hi = sortedEntries.length;
    while (lo < hi) { const m = (lo + hi) >>> 1; if (sortedEntries[m].year <= maxYear) lo = m + 1; else hi = m; }
    return lo;
  }

  // Returns [{entry, x}] for non-clustered, on-screen entries — used by UI for card layer.
  // Uses the same label-aware clustering as the draw loop so cards and markers agree.
  function getVisibleSingles() {
    const w          = Timeline.canvasWidth;
    const recentDate = Timeline.xToDate(w + 60);
    const oldDate    = Timeline.xToDate(-60);
    const visible    = sortedEntries.slice(lowerBound(recentDate), upperBound(oldDate));
    const tmpCache   = new Map();
    const cx = e => { let v = tmpCache.get(e.id); if (v == null) { v = Timeline.dateToX(e.year); tmpCache.set(e.id, v); } return v; };

    const forCluster = [...visible].reverse();
    if (!forCluster.length) return [];

    const groups = [];
    let group  = [forCluster[0]];
    let gx     = cx(forCluster[0]);
    let gRight = gx + labelWidth(forCluster[0].title) / 2;

    for (let i = 1; i < forCluster.length; i++) {
      const x   = cx(forCluster[i]);
      const hw  = labelWidth(forCluster[i].title) / 2;
      if ((x - hw) < gRight + MIN_GAP) {
        group.push(forCluster[i]);
        gx = 0; for (const e of group) gx += cx(e); gx /= group.length;
        gRight = gx + BADGE_HALF;
      } else {
        groups.push(group); group = [forCluster[i]]; gx = x; gRight = x + hw;
      }
    }
    groups.push(group);

    return groups.filter(g => g.length === 1).map(g => ({ entry: g[0], x: cx(g[0]) }));
  }

  return { init, setEntries, getEntries, triggerMarkerDrop, getVisibleSingles, setConnectSource, setLiveAnnotation, setConnectionsVisible, setTagFilter, getTagFilter, tagColor, setSearchQuery };
})();
