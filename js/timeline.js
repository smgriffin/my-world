// timeline.js — viewport state, logarithmic scale math, pan/zoom, hit detection
// render.js reads from this; never touches the canvas itself.

const Timeline = (() => {
  // ── Constants ────────────────────────────────────────────────────────────────
  const BIG_BANG_YEARS_AGO = 13_800_000_000;
  const NOW_YEARS_AGO = 0;

  // Log base used for the scale. log10 gives intuitive order-of-magnitude zoom.
  const LOG_BASE = Math.log(BIG_BANG_YEARS_AGO + 1);

  // ── State ─────────────────────────────────────────────────────────────────────
  // panX: logical canvas x of left edge (in pixels at current zoom)
  // zoom: pixels per log-unit
  let canvasWidth = window.innerWidth;
  let canvasHeight = window.innerHeight;

  // Default view: ~500 years of history, "Now" near the right edge.
  // This puts the opening view squarely in the modern era.
  const DEFAULT_SPAN   = 500;   // years visible on first load
  const RIGHT_MARGIN   = 0.08;  // fraction of width kept as breathing room on the right

  function initialZoom(w) {
    // We want log(DEFAULT_SPAN + 1) log-units to span (1 - 2*RIGHT_MARGIN) of the width
    return w * (1 - 2 * RIGHT_MARGIN) / Math.log(DEFAULT_SPAN + 1);
  }

  function initialPanX(w, z) {
    // Place dateToX(0) = "Now" at (1 - RIGHT_MARGIN) * w
    return LOG_BASE * z - w * (1 - RIGHT_MARGIN);
  }

  let zoom = initialZoom(canvasWidth);
  let panX = initialPanX(canvasWidth, zoom);

  let dirty = true;

  // ── Scale functions ───────────────────────────────────────────────────────────
  // yearsAgo → logical x pixel (0 = Big Bang, canvasWidth = now at initial zoom)
  function dateToX(yearsAgo) {
    const clamped = Math.max(0, Math.min(BIG_BANG_YEARS_AGO, yearsAgo));
    const logVal = Math.log(clamped + 1);
    const logMax = LOG_BASE;
    return (logMax - logVal) * zoom - panX;
  }

  // logical x pixel → yearsAgo, clamped to valid range
  function xToDate(x) {
    const logMax = LOG_BASE;
    const logVal = logMax - (x + panX) / zoom;
    const raw = Math.exp(logVal) - 1;
    return Math.max(0, Math.min(BIG_BANG_YEARS_AGO, raw));
  }

  // ── Resize ────────────────────────────────────────────────────────────────────
  function resize(w, h) {
    // Keep the date currently under the right-margin anchor point fixed during resize
    const anchorDate = xToDate(canvasWidth * (1 - RIGHT_MARGIN));
    canvasWidth  = w;
    canvasHeight = h;
    zoom = Math.max(zoom, initialZoom(w)); // never let resize push below default zoom
    // Re-anchor: the same date should remain at the right-margin position
    const logVal = Math.log(Math.max(1, anchorDate + 1));
    panX = (LOG_BASE - logVal) * zoom - w * (1 - RIGHT_MARGIN);
    clampPan();
    dirty = true;
  }

  // ── Pan ───────────────────────────────────────────────────────────────────────
  let isDragging = false;
  let dragStartX = 0;
  let dragStartPan = 0;
  let dragMoved = false;
  const DRAG_THRESHOLD = 4; // px — below this is a click, not a drag

  let onClickEntry = null; // set by attach()
  let clickTimer = null;   // used to suppress single-click on double-click
  let panEnabled = true;   // false in annotation mode — disables drag and click

  function setPanEnabled(v) { panEnabled = v; }

  function onMouseDown(e) {
    if (!panEnabled) return;
    isDragging = true;
    dragMoved = false;
    dragStartX = e.clientX;
    dragStartPan = panX;
  }

  function onMouseMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    if (Math.abs(dx) > DRAG_THRESHOLD) dragMoved = true;
    panX = dragStartPan - dx;
    clampPan();
    dirty = true;
  }

  function onMouseUp(e) {
    if (!panEnabled) { isDragging = false; dragMoved = false; return; }
    if (!dragMoved && onClickEntry) {
      // Delay single-click so a double-click can cancel it
      const cx = e.clientX, cy = e.clientY, shift = e.shiftKey;
      clickTimer = setTimeout(() => {
        clickTimer = null;
        onClickEntry(cx, cy, shift);
      }, 220);
    }
    isDragging = false;
    dragMoved = false;
  }

  // ── Zoom (wheel) ──────────────────────────────────────────────────────────────
  // Zoom anchored to cursor position so the date under the cursor stays fixed.
  const MAX_ZOOM = 1_000_000;

  function minZoom() {
    return canvasWidth / LOG_BASE / 8;
  }

  // Keep panX within bounds so we can't scroll off both ends of the timeline.
  function clampPan() {
    const overscroll = canvasWidth * 0.15;
    const panMin = -overscroll;
    const panMax = LOG_BASE * zoom - canvasWidth + overscroll;
    panX = Math.max(panMin, Math.min(panMax > panMin ? panMax : panMin, panX));
  }

  function onWheel(e) {
    e.preventDefault();
    const cursorX = e.clientX;
    const dateUnderCursor = xToDate(cursorX);

    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoom = Math.min(MAX_ZOOM, Math.max(minZoom(), zoom * factor));

    // Re-anchor: cursor should still point at dateUnderCursor
    const logVal = Math.log(Math.max(1, dateUnderCursor + 1));
    panX = (LOG_BASE - logVal) * zoom - cursorX;
    clampPan();
    dirty = true;
  }

  // ── Hit detection ─────────────────────────────────────────────────────────────
  // Returns the entry closest to screenX within threshold px, or null.
  function hitTest(entries, screenX, threshold = 12) {
    let best = null;
    let bestDist = threshold;
    for (const entry of entries) {
      const x = dateToX(entry.year);
      const dist = Math.abs(x - screenX);
      if (dist < bestDist) {
        bestDist = dist;
        best = entry;
      }
    }
    return best;
  }

  // ── Double-click zoom ─────────────────────────────────────────────────────────
  // Zooms in ~2.5× anchored to the clicked point, with a quick animated ease.
  let dblZoomRaf = null;

  function animateZoomTo(targetZoom, anchorX) {
    if (dblZoomRaf) cancelAnimationFrame(dblZoomRaf);
    const startZoom = zoom;
    const startPan  = panX;
    const dateAtAnchor = xToDate(anchorX);
    const steps = 18;
    let step = 0;

    function tick() {
      step++;
      const t = step / steps;
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
      zoom = startZoom + (targetZoom - startZoom) * ease;

      // Re-anchor to keep the clicked date under the cursor
      const logVal = Math.log(Math.max(1, dateAtAnchor + 1));
      panX = (LOG_BASE - logVal) * zoom - anchorX;
      clampPan();
      dirty = true;

      if (step < steps) {
        dblZoomRaf = requestAnimationFrame(tick);
      }
    }
    tick();
  }

  function onDblClick(e) {
    // Cancel the pending single-click so it doesn't open a modal
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    const targetZoom = Math.min(MAX_ZOOM, zoom * 2.5);
    animateZoomTo(targetZoom, e.clientX);
  }

  // ── Pan to date (animated) ────────────────────────────────────────────────────
  // Smoothly pans so that yearsAgo appears at the horizontal centre of the canvas.
  let panRaf = null;

  function panToDate(yearsAgo) {
    if (panRaf) cancelAnimationFrame(panRaf);
    const logVal    = Math.log(Math.max(1, yearsAgo + 1));
    const targetPan = (LOG_BASE - logVal) * zoom - canvasWidth / 2;
    const startPan  = panX;
    const steps     = 28;
    let   step      = 0;

    function tick() {
      step++;
      const t    = step / steps;
      const ease = 1 - Math.pow(1 - t, 4); // ease-out quart
      panX = startPan + (targetPan - startPan) * ease;
      clampPan();
      dirty = true;
      if (step < steps) panRaf = requestAnimationFrame(tick);
    }
    tick();
  }

  // ── Attach events ─────────────────────────────────────────────────────────────
  function attach(canvas, clickHandler) {
    onClickEntry = clickHandler || null;
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDblClick);
  }

  // ── Zone (for background) ─────────────────────────────────────────────────────
  // Returns current era zone name based on visible date range.
  function currentZone() {
    const leftDate  = xToDate(0);
    const rightDate = xToDate(canvasWidth);
    const visibleSpan = Math.abs(leftDate - rightDate);

    if (visibleSpan > 50_000_000)      return 'cosmic';
    if (visibleSpan > 10_000)          return 'geological';
    if (visibleSpan > 200)             return 'ancient';
    return 'modern';
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  return {
    get zoom()        { return zoom; },
    get panX()        { return panX; },
    get canvasWidth() { return canvasWidth; },
    get canvasHeight(){ return canvasHeight; },
    get dirty()       { return dirty; },
    clearDirty()      { dirty = false; },
    markDirty()       { dirty = true; },
    dateToX,
    xToDate,
    resize,
    attach,
    hitTest,
    currentZone,
    panToDate,
    setPanEnabled,
    LOG_BASE,
    BIG_BANG_YEARS_AGO,
  };
})();
