// background.js — real-image zone backgrounds with canvas star overlay
// Images are preloaded once; draw() blits them directly — zero per-frame allocation.

const Background = (() => {

  // ── Image registry ────────────────────────────────────────────────────────────
  const IMAGES = {
    cosmic:     'assets/backgrounds/cosmic.jpg',
    geological: 'assets/backgrounds/geological.jpg',
    ancient:    'assets/backgrounds/ancient.jpg',
    modern:     'assets/backgrounds/modern.jpg',
  };

  const loaded = {}; // zone → HTMLImageElement (set after preload)
  let preloadPromise = null;

  function preload() {
    if (preloadPromise) return preloadPromise;
    preloadPromise = Promise.all(
      Object.entries(IMAGES).map(([zone, src]) =>
        new Promise((resolve) => {
          const img   = new Image();
          img.onload  = () => { loaded[zone] = img; resolve(); };
          img.onerror = () => { loaded[zone] = null;  resolve(); }; // graceful fallback
          img.src     = src;
        })
      )
    );
    return preloadPromise;
  }

  // ── Sparse star overlay (80 stars — depth layer, not primary visual) ──────────
  let sparseStars = null;

  function buildSparseStars(w, h) {
    const stars = [];
    for (let i = 0; i < 80; i++) {
      const hue = Math.random();
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.4 + Math.random() * 1.4,
        a: 0.30 + Math.random() * 0.55,
        flare: Math.random() > 0.88,
        rgb: hue < 0.25 ? '190,215,255'
           : hue < 0.55 ? '245,242,235'
           : hue < 0.78 ? '255,228,168'
           :               '255,175,110',
      });
    }
    return stars;
  }

  function ensureStars(w, h) {
    if (!sparseStars || sparseStars._w !== w || sparseStars._h !== h) {
      sparseStars = buildSparseStars(w, h);
      sparseStars._w = w;
      sparseStars._h = h;
    }
  }

  // ── Per-zone draw ─────────────────────────────────────────────────────────────

  function drawCosmic(ctx, w, h) {
    const img = loaded.cosmic;
    if (img) {
      // Cover the canvas, centred, preserving aspect ratio
      const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const sw    = img.naturalWidth  * scale;
      const sh    = img.naturalHeight * scale;
      const sx    = (w - sw) / 2;
      const sy    = (h - sh) / 2;
      ctx.drawImage(img, sx, sy, sw, sh);
    } else {
      // Fallback: pure deep-space gradient
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#000009'); g.addColorStop(1, '#020018');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }

    // Dark overlay to ensure timeline markers remain legible (0.40 opacity)
    ctx.fillStyle = 'rgba(0,0,0,0.40)';
    ctx.fillRect(0, 0, w, h);

    // 80 sparse stars — subtle depth layer on top of the photo
    ensureStars(w, h);
    for (const s of sparseStars) {
      if (s.flare) {
        const halo = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 4);
        halo.addColorStop(0, `rgba(${s.rgb},${(s.a * 0.5).toFixed(2)})`);
        halo.addColorStop(1, `rgba(${s.rgb},0)`);
        ctx.fillStyle = halo;
        ctx.fillRect(s.x - s.r * 4, s.y - s.r * 4, s.r * 8, s.r * 8);
        // Cross flare
        ctx.globalAlpha = s.a * 0.20;
        ctx.strokeStyle = `rgba(${s.rgb},1)`;
        ctx.lineWidth   = 0.5;
        const fl = s.r * 6;
        ctx.beginPath(); ctx.moveTo(s.x - fl, s.y); ctx.lineTo(s.x + fl, s.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s.x, s.y - fl); ctx.lineTo(s.x, s.y + fl); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.globalAlpha = s.a;
      ctx.fillStyle   = `rgb(${s.rgb})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Vignette — deepens corners so the centre reads as depth
    const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.22, w / 2, h / 2, h * 0.95);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,10,0.55)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }

  function drawGeological(ctx, w, h) {
    const img = loaded.geological;
    if (img) {
      const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const sw    = img.naturalWidth  * scale;
      const sh    = img.naturalHeight * scale;
      ctx.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh);
    } else {
      ctx.fillStyle = '#090604'; ctx.fillRect(0, 0, w, h);
    }

    // Warm dark overlay — pulls back the photograph so markers pop
    ctx.fillStyle = 'rgba(4,3,2,0.52)';
    ctx.fillRect(0, 0, w, h);

    // Geothermal glow at base
    const lava = ctx.createLinearGradient(0, h * 0.58, 0, h);
    lava.addColorStop(0, 'rgba(0,0,0,0)');
    lava.addColorStop(1, 'rgba(60,22,4,0.18)');
    ctx.fillStyle = lava;
    ctx.fillRect(0, 0, w, h);

    // Vignette
    const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.18, w / 2, h / 2, h * 0.90);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.60)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }

  function drawAncient(ctx, w, h) {
    const img = loaded.ancient;
    if (img) {
      const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const sw    = img.naturalWidth  * scale;
      const sh    = img.naturalHeight * scale;
      ctx.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh);
    } else {
      ctx.fillStyle = '#0e0904'; ctx.fillRect(0, 0, w, h);
    }

    // Deep warm overlay: darkens parchment to the right contrast
    ctx.fillStyle = 'rgba(8,5,2,0.68)';
    ctx.fillRect(0, 0, w, h);

    // Candlelight warmth — single off-centre glow
    const warm = ctx.createRadialGradient(w * 0.46, h * 0.52, 0, w * 0.46, h * 0.52, w * 0.68);
    warm.addColorStop(0,    'rgba(120,60,8,0.20)');
    warm.addColorStop(0.40, 'rgba(80,36,5,0.10)');
    warm.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, w, h);

    // Vignette
    const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.14, w / 2, h / 2, h * 0.84);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.64)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }

  function drawModern(ctx, w, h) {
    const img = loaded.modern;
    if (img) {
      // Modern texture is small and seamlessly tileable — tile it
      const pat = ctx.createPattern(img, 'repeat');
      if (pat) {
        ctx.fillStyle = pat;
        ctx.globalAlpha = 0.28; // very subtle — just kills flat black
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }
    }

    // Primary dark field on top
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0,   'rgba(6,8,14,0.90)');
    base.addColorStop(0.5, 'rgba(8,9,13,0.88)');
    base.addColorStop(1,   'rgba(10,9,8,0.88)');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    // Faint horizon glow — grounded, editorial
    const horizon = ctx.createRadialGradient(w * 0.50, h * 0.82, 0, w * 0.50, h * 0.82, w * 0.70);
    horizon.addColorStop(0,    'rgba(48,58,80,0.08)');
    horizon.addColorStop(0.55, 'rgba(28,36,52,0.04)');
    horizon.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = horizon;
    ctx.fillRect(0, 0, w, h);

    // Corner vignette
    const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.22, w / 2, h / 2, h * 0.96);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.46)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }

  const DRAW = { cosmic: drawCosmic, geological: drawGeological, ancient: drawAncient, modern: drawModern };

  function draw(ctx, zone, w, h) {
    ctx.globalAlpha = 1;
    (DRAW[zone] || drawModern)(ctx, w, h);
    ctx.globalAlpha = 1;
  }

  // ── Crossfade between zones ───────────────────────────────────────────────────
  // Offscreen canvas for blending: draw outgoing zone into it, then alpha-composite
  // the incoming zone on top. Avoids drawing each scene twice to the main canvas.
  let blendCanvas = null, blendCtx = null;
  let currentZone = null;
  let targetZone  = null;
  let blendT      = 1;
  const BLEND_SPEED = 0.018; // ~55 frames ≈ ~0.9s — cinematic descent

  function smoothstep(t) { return t * t * (3 - 2 * t); }

  function ensureBlendCanvas(w, h) {
    if (!blendCanvas || blendCanvas.width !== w || blendCanvas.height !== h) {
      blendCanvas       = document.createElement('canvas');
      blendCanvas.width  = w;
      blendCanvas.height = h;
      blendCtx           = blendCanvas.getContext('2d');
    }
  }

  function update(zone, ctx, w, h) {
    if (zone !== targetZone) {
      currentZone = targetZone || zone;
      targetZone  = zone;
      blendT      = 0;
    }

    if (blendT >= 1) {
      draw(ctx, targetZone, w, h);
      return;
    }

    // Draw outgoing zone to main canvas
    draw(ctx, currentZone, w, h);

    // Draw incoming zone to offscreen canvas, then composite onto main canvas
    ensureBlendCanvas(w, h);
    blendCtx.clearRect(0, 0, w, h);
    draw(blendCtx, targetZone, w, h);

    ctx.save();
    ctx.globalAlpha = smoothstep(blendT);
    ctx.drawImage(blendCanvas, 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;

    blendT = Math.min(1, blendT + BLEND_SPEED);
    if (blendT < 1) Timeline.markDirty();
  }

  return { preload, update };
})();
