// render.js — owns the canvas context, rAF loop, and all drawing.
// Reads state from Timeline. Never mutates Timeline state.

const Render = (() => {
  let canvas, ctx;
  let entries = [];

  const CLUSTER_RADIUS = 18;
  const GOLD  = '#E8962A';
  const WHITE = '#EDE8DC';
  const DIM   = 'rgba(237,232,220,0.72)';
  const AXIS_H = 48;

  // ── Date label helper ─────────────────────────────────────────────────────────
  // Converts internal "years ago" to an actual calendar year label.
  const CURRENT_YEAR = new Date().getFullYear();

  function yearsAgoToLabel(yearsAgo) {
    if (yearsAgo === 0) return 'Today';
    const ceYear = CURRENT_YEAR - yearsAgo;

    if (ceYear > 0) {
      // CE — no suffix needed, context is obvious from increasing numbers
      return Math.round(ceYear).toString();
    }

    // BCE
    const bce = Math.abs(Math.round(ceYear));
    if (bce >= 1_000_000_000) return `${(bce / 1e9).toFixed(1)}B BCE`;
    if (bce >= 1_000_000)     return `${Math.round(bce / 1e6)}M BCE`;
    if (bce >= 10_000)        return `${Math.round(bce / 1000)}k BCE`;
    return `${bce} BCE`;
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

  // ── Clustering — O(n) sweep on pre-sorted entries ─────────────────────────────
  // Because entries are sorted by year (which maps monotonically to x), we only
  // need a single left-to-right pass: when the next entry's x is within
  // CLUSTER_RADIUS of the current group centroid, absorb it.
  function cluster(visible) {
    if (!visible.length) return [];
    const groups = [];
    let group = [visible[0]];
    let groupX = cachedX(visible[0]);

    for (let i = 1; i < visible.length; i++) {
      const x = cachedX(visible[i]);
      if (Math.abs(x - groupX) < CLUSTER_RADIUS) {
        group.push(visible[i]);
        // Update running centroid
        groupX = (groupX * (group.length - 1) + x) / group.length;
      } else {
        groups.push(group);
        group  = [visible[i]];
        groupX = x;
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

    const MIN_TICK_PX = 90;
    const leftDate  = Timeline.xToDate(0);
    const rightDate = Timeline.xToDate(w);
    const minInterval = MIN_TICK_PX * (leftDate + 1) / Timeline.zoom;

    const NICE = [
      1, 2, 5, 10, 20, 50, 100, 200, 500,
      1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5,
      1e6, 2e6, 5e6, 1e7, 2e7, 5e7, 1e8, 2e8, 5e8,
      1e9, 2e9, 5e9, 1e10,
    ];
    const tickInterval = NICE.find(i => i >= minInterval) ?? NICE[NICE.length - 1];

    const start = Math.ceil(rightDate / tickInterval) * tickInterval;
    const end   = Math.floor(leftDate / tickInterval) * tickInterval;
    if (!isFinite(start) || !isFinite(end) || end < start) return;

    ctx.fillStyle = DIM;
    ctx.font = '11px "Cormorant Garamond", serif';
    ctx.textAlign = 'center';

    let tickCount = 0;
    for (let t = start; t <= end && tickCount < 30; t += tickInterval, tickCount++) {
      const x = Timeline.dateToX(t);
      if (x < -40 || x > w + 40) continue;

      ctx.strokeStyle = 'rgba(232,150,42,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, axisY - 5);
      ctx.lineTo(x, axisY + 3);
      ctx.stroke();

      const label = yearsAgoToLabel(t);

      ctx.fillText(label, x, axisY + 16);
    }
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

    // Drop animation offset
    const dropY = getMarkerDropOffset(entry.id);
    const markerY = axisY - 2 + dropY;

    // Connect-source ring — strong pulsing amber halo
    if (isSource) {
      const pulse = 0.18 + 0.12 * Math.sin(performance.now() / 400);
      const ring = ctx.createRadialGradient(x, markerY, 0, x, markerY, 32);
      ring.addColorStop(0,   `rgba(232,150,42,${(pulse * 2.2).toFixed(3)})`);
      ring.addColorStop(0.5, `rgba(232,150,42,${pulse.toFixed(3)})`);
      ring.addColorStop(1,   'rgba(232,150,42,0)');
      ctx.fillStyle = ring;
      ctx.fillRect(x - 32, markerY - 32, 64, 64);
    } else if (isHovered) {
      // Hover glow — soft radial pulse
      const pulse = 0.14 + 0.10 * Math.sin(performance.now() / 700);
      const glow = ctx.createRadialGradient(x, markerY, 0, x, markerY, 22);
      glow.addColorStop(0,   `rgba(232,150,42,${(pulse * 2).toFixed(3)})`);
      glow.addColorStop(0.5, `rgba(232,150,42,${pulse.toFixed(3)})`);
      glow.addColorStop(1,   'rgba(232,150,42,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - 24, markerY - 24, 48, 48);
    }

    // Span bar
    if (entry.yearEnd) {
      const x2 = Timeline.dateToX(entry.yearEnd);
      ctx.fillStyle = (isHovered || isSource) ? 'rgba(232,150,42,0.32)' : 'rgba(232,150,42,0.14)';
      ctx.fillRect(Math.min(x, x2), axisY - 5, Math.abs(x2 - x), 5);
    }

    // Diamond — larger and bright white when it's the connect source
    const size = isSource ? 9 : isHovered ? 7 : 5;
    ctx.fillStyle = isSource ? WHITE : isHovered ? GOLD : 'rgba(232,150,42,0.72)';
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
      ctx.globalAlpha = (isHovered || isSource) ? 1 : 0.85;
      ctx.fillText(entry.title, x, labelY + dropY);
      ctx.globalAlpha = 1;
    }
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
        ctx.strokeStyle = isHot ? 'rgba(232,150,42,0.60)' : 'rgba(232,150,42,0.18)';
        ctx.lineWidth   = isHot ? 1.5 : 0.8;
        ctx.setLineDash(isHot ? [] : [3, 5]);
        ctx.stroke();
        ctx.setLineDash([]);

        if (link.label && arcH > 18) {
          ctx.fillStyle   = isHot ? 'rgba(232,150,42,0.65)' : 'rgba(232,150,42,0.28)';
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

    ctx.font = '11px "Cinzel", serif'; // prime measureText
    let lastLabelRight = -Infinity;

    for (const group of groups) {
      // avgX using cached positions
      let sumX = 0;
      for (const e of group) sumX += cachedX(e);
      const avgX = sumX / group.length;

      if (group.length === 1) {
        const entry  = group[0];
        const textW  = ctx.measureText(entry.title).width;
        const lLeft  = avgX - textW / 2;
        const showLabel = lLeft > lastLabelRight + 6;
        if (showLabel) lastLabelRight = avgX + textW / 2;
        drawMarker(entry, avgX, showLabel);
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
    const h    = Timeline.canvasHeight;
    const all  = Annotations.getAll();

    ctx.save();
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    for (const ann of all) {
      if (!ann.points || ann.points.length < 2) continue;
      ctx.beginPath();
      ctx.strokeStyle = ann.color || 'rgba(232,150,42,0.60)';
      ctx.lineWidth   = ann.strokeWidth || 1.5;

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

    // Live stroke (raw screen coords — not yet committed)
    if (liveAnnotationPoints && liveAnnotationPoints.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(232,150,42,0.80)';
      ctx.lineWidth   = 1.5;
      const lp = liveAnnotationPoints;
      ctx.moveTo(lp[0].x, lp[0].y);
      for (let i = 1; i < lp.length - 1; i++) {
        const mx = (lp[i].x + lp[i + 1].x) / 2;
        const my = (lp[i].y + lp[i + 1].y) / 2;
        ctx.quadraticCurveTo(lp[i].x, lp[i].y, mx, my);
      }
      ctx.lineTo(lp[lp.length - 1].x, lp[lp.length - 1].y);
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
  function getVisibleSingles() {
    const w           = Timeline.canvasWidth;
    const recentDate  = Timeline.xToDate(w + 60);
    const oldDate     = Timeline.xToDate(-60);
    const visible     = sortedEntries.slice(lowerBound(recentDate), upperBound(oldDate));
    const tmpCache    = new Map();
    const tmpCachedX  = e => { let v = tmpCache.get(e.id); if (v == null) { v = Timeline.dateToX(e.year); tmpCache.set(e.id, v); } return v; };
    // Cluster expects left-to-right order (descending year on log scale)
    const forCluster  = [...visible].reverse();
    // Inline cluster using tmpCachedX
    const groups = [];
    if (forCluster.length) {
      let group = [forCluster[0]], gx = tmpCachedX(forCluster[0]);
      for (let i = 1; i < forCluster.length; i++) {
        const x = tmpCachedX(forCluster[i]);
        if (Math.abs(x - gx) < CLUSTER_RADIUS) { group.push(forCluster[i]); gx = (gx * (group.length - 1) + x) / group.length; }
        else { groups.push(group); group = [forCluster[i]]; gx = x; }
      }
      groups.push(group);
    }
    return groups.filter(g => g.length === 1).map(g => ({ entry: g[0], x: tmpCachedX(g[0]) }));
  }

  return { init, setEntries, getEntries, triggerMarkerDrop, getVisibleSingles, setConnectSource, setLiveAnnotation };
})();
