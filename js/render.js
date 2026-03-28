// render.js — owns the canvas context, rAF loop, and all drawing.
// Reads state from Timeline. Never mutates Timeline state.

const Render = (() => {
  let canvas, ctx;
  let entries = [];

  const CLUSTER_RADIUS = 18;
  const GOLD  = '#c9a84c';
  const WHITE = '#e8e2d4';
  const DIM   = 'rgba(232,226,212,0.4)';
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

  // ── Clustering ────────────────────────────────────────────────────────────────
  function cluster(entries) {
    const groups = [];
    const used = new Set();
    for (let i = 0; i < entries.length; i++) {
      if (used.has(i)) continue;
      const group = [entries[i]];
      used.add(i);
      const xi = Timeline.dateToX(entries[i].year);
      for (let j = i + 1; j < entries.length; j++) {
        if (used.has(j)) continue;
        const xj = Timeline.dateToX(entries[j].year);
        if (Math.abs(xi - xj) < CLUSTER_RADIUS) { group.push(entries[j]); used.add(j); }
      }
      groups.push(group);
    }
    return groups;
  }

  // ── Axis ──────────────────────────────────────────────────────────────────────
  function drawAxis() {
    const w = Timeline.canvasWidth;
    const h = Timeline.canvasHeight;
    const axisY = h - AXIS_H;

    ctx.strokeStyle = 'rgba(201,168,76,0.25)';
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

      ctx.strokeStyle = 'rgba(201,168,76,0.18)';
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

    ctx.strokeStyle = 'rgba(201,168,76,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x, axisY - 60);
    ctx.lineTo(x, axisY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(201,168,76,0.55)';
    ctx.font = '9px "Cinzel", serif';
    ctx.textAlign = 'center';
    ctx.fillText('NOW', x, axisY - 66);
  }

  // ── Draw a single marker ──────────────────────────────────────────────────────
  function drawMarker(entry, x, showLabel = true) {
    const h = Timeline.canvasHeight;
    const axisY = h - AXIS_H;
    const isHovered = hoveredEntry && hoveredEntry.id === entry.id;

    // Drop animation offset
    const dropY = getMarkerDropOffset(entry.id);
    const markerY = axisY - 2 + dropY;

    // Hover glow — soft radial pulse
    if (isHovered) {
      const pulse = 0.14 + 0.10 * Math.sin(performance.now() / 700);
      const glow = ctx.createRadialGradient(x, markerY, 0, x, markerY, 22);
      glow.addColorStop(0,   `rgba(201,168,76,${(pulse * 2).toFixed(3)})`);
      glow.addColorStop(0.5, `rgba(201,168,76,${pulse.toFixed(3)})`);
      glow.addColorStop(1,   'rgba(201,168,76,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - 24, markerY - 24, 48, 48);
    }

    // Span bar
    if (entry.yearEnd) {
      const x2 = Timeline.dateToX(entry.yearEnd);
      ctx.fillStyle = isHovered ? 'rgba(201,168,76,0.32)' : 'rgba(201,168,76,0.14)';
      ctx.fillRect(Math.min(x, x2), axisY - 5, Math.abs(x2 - x), 5);
    }

    // Diamond
    const size = isHovered ? 7 : 5;
    ctx.fillStyle = isHovered ? GOLD : 'rgba(201,168,76,0.72)';
    ctx.save();
    ctx.translate(x, markerY);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.restore();

    // Label — always visible when hovered; suppressed when too close to neighbour
    if (showLabel || isHovered) {
      const labelY = isHovered ? axisY - 20 : axisY - 14;
      ctx.font = `11px "Cinzel", serif`;
      ctx.fillStyle = isHovered ? WHITE : DIM;
      ctx.textAlign = 'center';
      ctx.globalAlpha = isHovered ? 1 : 0.85;
      ctx.fillText(entry.title, x, labelY + dropY);
      ctx.globalAlpha = 1;
    }
  }

  // ── Draw cluster badge ────────────────────────────────────────────────────────
  function drawCluster(group, x) {
    const h = Timeline.canvasHeight;
    const axisY = h - AXIS_H;
    const r = 10;

    ctx.fillStyle = 'rgba(201,168,76,0.18)';
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
        ctx.strokeStyle = isHot ? 'rgba(201,168,76,0.60)' : 'rgba(201,168,76,0.18)';
        ctx.lineWidth   = isHot ? 1.5 : 0.8;
        ctx.setLineDash(isHot ? [] : [3, 5]);
        ctx.stroke();
        ctx.setLineDash([]);

        if (link.label && arcH > 18) {
          ctx.fillStyle   = isHot ? 'rgba(201,168,76,0.65)' : 'rgba(201,168,76,0.28)';
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

    // Update hovered entry based on current mouse position
    hoveredEntry = Timeline.hitTest(entries, mouseX, 20);

    // Connection arcs drawn before markers so markers sit on top
    drawConnections();

    // Sort groups left-to-right for label collision detection
    const groups = cluster(entries);
    groups.sort((a, b) => {
      const ax = a.reduce((s, e) => s + Timeline.dateToX(e.year), 0) / a.length;
      const bx = b.reduce((s, e) => s + Timeline.dateToX(e.year), 0) / b.length;
      return ax - bx;
    });

    ctx.font = '11px "Cinzel", serif'; // prime for measureText
    let lastLabelRight = -Infinity;

    for (const group of groups) {
      const avgX = group.reduce((sum, e) => sum + Timeline.dateToX(e.year), 0) / group.length;
      if (avgX < -60 || avgX > w + 60) continue;
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
  }

  // ── rAF loop ──────────────────────────────────────────────────────────────────
  // Clear dirty BEFORE draw so that animations triggered inside draw() persist.
  function loop() {
    const needsContinuousFrame =
      markerAnims.size > 0 ||
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
    Timeline.markDirty();
  }

  function getEntries() { return entries; }

  // Returns [{entry, x}] for non-clustered, on-screen entries — used by UI for card layer.
  function getVisibleSingles() {
    const w = Timeline.canvasWidth;
    const groups = cluster(entries);
    const result = [];
    for (const group of groups) {
      if (group.length !== 1) continue;
      const entry = group[0];
      const x = Timeline.dateToX(entry.year);
      if (x < -60 || x > w + 60) continue;
      result.push({ entry, x });
    }
    return result;
  }

  return { init, setEntries, getEntries, triggerMarkerDrop, getVisibleSingles };
})();
