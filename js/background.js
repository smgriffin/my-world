// background.js — immersive zone-based backgrounds
// All scene assets are precomputed once into offscreen canvases for performance.

const Background = (() => {

  let scene = null;

  function buildScene(w, h) {
    const s = { w, h };
    const area = w * h;

    // ── Star populations ─────────────────────────────────────────────────────────
    s.starsDust   = [];
    s.starsMid    = [];
    s.starsBright = [];

    for (let i = 0; i < area / 650; i++) {
      s.starsDust.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.2 + Math.random() * 0.35,
        a: 0.04 + Math.random() * 0.15,
        hue: Math.random(),
      });
    }
    for (let i = 0; i < area / 3200; i++) {
      s.starsMid.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.5 + Math.random() * 0.9,
        a: 0.26 + Math.random() * 0.42,
        hue: Math.random(),
      });
    }
    for (let i = 0; i < area / 14000; i++) {
      const r = 1.2 + Math.random() * 1.9;
      s.starsBright.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r,
        a: 0.68 + Math.random() * 0.32,
        flare: r > 2.2,
        hue: Math.random(),
      });
    }

    // ── Milky Way band ───────────────────────────────────────────────────────────
    // Concentrates extra stars along a diagonal band, plus galactic fog gradients.
    const MW_CX     = w * 0.50;
    const MW_CY     = h * 0.48;
    const MW_ANGLE  = -0.22;                          // radians from horizontal
    const MW_SPREAD = h * 0.16;
    const MW_LEN    = Math.sqrt(w * w + h * h) * 0.7;
    s.mwFog = { cx: MW_CX, cy: MW_CY, angle: MW_ANGLE, spread: MW_SPREAD, len: MW_LEN };

    s.mwStars = [];
    const cosMW = Math.cos(MW_ANGLE), sinMW = Math.sin(MW_ANGLE);
    for (let i = 0; i < area / 950; i++) {
      const along = (Math.random() - 0.5) * MW_LEN;
      // Box–Muller Gaussian for perpendicular spread
      const u1 = Math.random() + 1e-7;
      const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random());
      const perp  = gauss * MW_SPREAD * 0.30;

      const x = MW_CX + cosMW * along - sinMW * perp;
      const y = MW_CY + sinMW * along + cosMW * perp;
      if (x < -4 || x > w + 4 || y < -4 || y > h + 4) continue;

      s.mwStars.push({
        x, y,
        r: 0.2 + Math.random() * 0.45,
        a: 0.05 + Math.random() * 0.19,
        warm: Math.random() > 0.55,
      });
    }

    // ── Nebulae ─────────────────────────────────────────────────────────────────
    s.nebulae = [
      { x: w * 0.18, y: h * 0.38, r: w * 0.30, color: [18, 52, 120], a: 0.14 },
      { x: w * 0.72, y: h * 0.52, r: w * 0.26, color: [70, 28, 130], a: 0.12 },
      { x: w * 0.50, y: h * 0.22, r: w * 0.20, color: [12, 70, 100], a: 0.10 },
      { x: w * 0.82, y: h * 0.70, r: w * 0.18, color: [100, 32, 18],  a: 0.08 },
    ];

    // ── Geological strata ────────────────────────────────────────────────────────
    s.strata = [];
    const palette = [
      [28, 16,  6,  0.24],
      [14, 22, 10,  0.19],
      [36, 20,  8,  0.22],
      [10, 16, 24,  0.16],
      [32, 14,  6,  0.20],
      [16, 24, 14,  0.17],
      [24, 10,  8,  0.15],
    ];
    let sy = -20;
    for (let i = 0; i < palette.length; i++) {
      const thick = 60 + Math.random() * 120;
      sy += thick * (0.6 + Math.random() * 0.8);
      s.strata.push({ y: sy, thick, color: palette[i] });
    }

    // ── Precomputed grain canvases (drawn once, blitted each frame) ───────────────
    // Modern film grain
    s.modernGrain = _buildGrainCanvas(w, h, 4500, (rng) =>
      rng > 0.5 ? 'rgba(155,148,130,1)' : 'rgba(78,88,108,1)',
      [0.008, 0.018]);

    // Ancient warm parchment grain
    s.ancientGrain = _buildGrainCanvas(w, h, 3800, (rng) =>
      rng > 0.42 ? 'rgba(175,132,50,1)' : 'rgba(32,20,6,1)',
      [0.010, 0.022]);

    // Geological sediment grain (warm earthy tones)
    s.geoGrain = (() => {
      const oc = document.createElement('canvas');
      oc.width = w; oc.height = h;
      const gc = oc.getContext('2d');
      for (const st of s.strata) {
        const [r, g, b] = st.color;
        for (let i = 0; i < 140; i++) {
          const gx = Math.random() * w;
          const gy = st.y + (Math.random() - 0.5) * st.thick * 0.75;
          gc.globalAlpha = 0.025 + Math.random() * 0.055;
          gc.fillStyle = `rgba(${r + 22},${g + 13},${b + 7},1)`;
          gc.beginPath();
          gc.arc(gx, gy, 0.5 + Math.random() * 2.2, 0, Math.PI * 2);
          gc.fill();
        }
      }
      gc.globalAlpha = 1;
      return oc;
    })();

    return s;
  }

  function _buildGrainCanvas(w, h, count, colorFn, alphaRange) {
    const oc = document.createElement('canvas');
    oc.width = w; oc.height = h;
    const gc = oc.getContext('2d');
    for (let i = 0; i < count; i++) {
      const rng = Math.random();
      gc.globalAlpha = alphaRange[0] + rng * alphaRange[1];
      gc.fillStyle   = colorFn(rng);
      gc.beginPath();
      gc.arc(Math.random() * w, Math.random() * h, 0.4 + Math.random() * 0.7, 0, Math.PI * 2);
      gc.fill();
    }
    gc.globalAlpha = 1;
    return oc;
  }

  function ensureScene(w, h) {
    if (!scene || scene.w !== w || scene.h !== h) scene = buildScene(w, h);
  }

  // ── Star colour by spectral class ─────────────────────────────────────────────
  function starRGB(hue) {
    if (hue < 0.22) return '190,215,255'; // O/B — hot blue-white
    if (hue < 0.42) return '238,242,255'; // A/F — white
    if (hue < 0.62) return '255,244,198'; // G   — yellow (solar)
    if (hue < 0.80) return '255,216,155'; // K   — orange
    return                  '255,172,110'; // M   — cool red-orange
  }

  // ── Per-zone draw functions ───────────────────────────────────────────────────

  function drawCosmic(ctx, w, h) {
    // Base: deep space
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0,    '#000009');
    base.addColorStop(0.30, '#01001f');
    base.addColorStop(0.68, '#04012c');
    base.addColorStop(1,    '#020018');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    // Nebulae
    for (const n of scene.nebulae) {
      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
      const [r, gv, b] = n.color;
      g.addColorStop(0,    `rgba(${r},${gv},${b},${n.a})`);
      g.addColorStop(0.40, `rgba(${r},${gv},${b},${(n.a * 0.48).toFixed(3)})`);
      g.addColorStop(0.75, `rgba(${r},${gv},${b},${(n.a * 0.14).toFixed(3)})`);
      g.addColorStop(1,    `rgba(${r},${gv},${b},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // Milky Way fog — series of soft blobs along the band axis
    const mw     = scene.mwFog;
    const cosMW  = Math.cos(mw.angle);
    const sinMW  = Math.sin(mw.angle);
    const segs   = 8;
    for (let i = 0; i < segs; i++) {
      const t  = (i / (segs - 1) - 0.5);
      const fx = mw.cx + cosMW * t * mw.len;
      const fy = mw.cy + sinMW * t * mw.len;
      const fog = ctx.createRadialGradient(fx, fy, 0, fx, fy, mw.spread * 1.9);
      fog.addColorStop(0,   'rgba(128,148,212,0.040)');
      fog.addColorStop(0.5, 'rgba(98,118,175,0.018)');
      fog.addColorStop(1,   'rgba(78,98,155,0)');
      ctx.fillStyle = fog;
      ctx.fillRect(0, 0, w, h);
    }

    // Milky Way concentrated stars
    for (const s of scene.mwStars) {
      ctx.globalAlpha = s.a;
      ctx.fillStyle   = s.warm ? '#ffdfb0' : '#cce2ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Dust stars
    for (const s of scene.starsDust) {
      ctx.globalAlpha = s.a;
      ctx.fillStyle   = `rgb(${starRGB(s.hue)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Mid stars
    for (const s of scene.starsMid) {
      ctx.globalAlpha = s.a;
      ctx.fillStyle   = `rgb(${starRGB(s.hue)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Bright stars — halos + diffraction flares
    for (const s of scene.starsBright) {
      const col  = starRGB(s.hue);
      const halo = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 4.5);
      halo.addColorStop(0, `rgba(${col},${(s.a * 0.50).toFixed(2)})`);
      halo.addColorStop(1, `rgba(${col},0)`);
      ctx.globalAlpha = 1;
      ctx.fillStyle   = halo;
      ctx.fillRect(s.x - s.r * 5, s.y - s.r * 5, s.r * 10, s.r * 10);

      ctx.globalAlpha = s.a;
      ctx.fillStyle   = `rgb(${col})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();

      if (s.flare) {
        ctx.globalAlpha = s.a * 0.22;
        ctx.strokeStyle = `rgba(${col},1)`;
        ctx.lineWidth   = 0.55;
        const fl = s.r * 6.5;
        ctx.beginPath(); ctx.moveTo(s.x - fl, s.y); ctx.lineTo(s.x + fl, s.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s.x, s.y - fl); ctx.lineTo(s.x, s.y + fl); ctx.stroke();
      }
    }

    // Vignette — deepens corners so the centre of the sky reads as depth
    const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, h * 0.96);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,12,0.60)');
    ctx.globalAlpha = 1;
    ctx.fillStyle   = vig;
    ctx.fillRect(0, 0, w, h);
  }

  function drawGeological(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0,   '#060402');
    base.addColorStop(0.5, '#090604');
    base.addColorStop(1,   '#130a06');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    // Strata bands
    for (const st of scene.strata) {
      const [r, g, b, a] = st.color;
      const grad = ctx.createLinearGradient(0, st.y, 0, st.y + st.thick);
      grad.addColorStop(0,   `rgba(${r},${g},${b},0)`);
      grad.addColorStop(0.2, `rgba(${r},${g},${b},${a})`);
      grad.addColorStop(0.8, `rgba(${r},${g},${b},${a})`);
      grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, st.y, w, st.thick);
    }

    // Sediment grain (precomputed, single blit)
    ctx.globalAlpha = 1;
    ctx.drawImage(scene.geoGrain, 0, 0);

    // Geothermal glow at base
    const lava = ctx.createLinearGradient(0, h * 0.60, 0, h);
    lava.addColorStop(0, 'rgba(0,0,0,0)');
    lava.addColorStop(1, 'rgba(82,28,5,0.22)');
    ctx.fillStyle = lava;
    ctx.fillRect(0, 0, w, h);

    // Vignette
    const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.18, w / 2, h / 2, h * 0.88);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }

  function drawAncient(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0,   '#0e0904');
    base.addColorStop(0.5, '#120c05');
    base.addColorStop(1,   '#0b0703');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    // Primary candlelight glow — off-centre, warmer than before
    const warm = ctx.createRadialGradient(w * 0.46, h * 0.54, 0, w * 0.46, h * 0.54, w * 0.65);
    warm.addColorStop(0,    'rgba(118,56,8,0.24)');
    warm.addColorStop(0.32, 'rgba(88,38,6,0.13)');
    warm.addColorStop(0.65, 'rgba(55,22,5,0.06)');
    warm.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, w, h);

    // Secondary faint ember — gives the scene depth without a second candle
    const ember = ctx.createRadialGradient(w * 0.64, h * 0.35, 0, w * 0.64, h * 0.35, w * 0.32);
    ember.addColorStop(0,  'rgba(72,36,6,0.09)');
    ember.addColorStop(1,  'rgba(0,0,0,0)');
    ctx.fillStyle = ember;
    ctx.fillRect(0, 0, w, h);

    // Parchment grain (precomputed)
    ctx.globalAlpha = 0.75;
    ctx.drawImage(scene.ancientGrain, 0, 0);
    ctx.globalAlpha = 1;

    // Deep vignette
    const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.13, w / 2, h / 2, h * 0.82);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.66)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }

  function drawModern(ctx, w, h) {
    // Editorial dark: deep blue-black with faint warmth at the base
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0,   '#060810');
    base.addColorStop(0.5, '#08090e');
    base.addColorStop(1,   '#0c0a08');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    // Subtle atmospheric glow near the horizon (city, pre-dawn — grounded, not cosmic)
    const horizon = ctx.createRadialGradient(w * 0.50, h * 0.80, 0, w * 0.50, h * 0.80, w * 0.72);
    horizon.addColorStop(0,   'rgba(52,62,84,0.09)');
    horizon.addColorStop(0.55, 'rgba(30,38,54,0.04)');
    horizon.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = horizon;
    ctx.fillRect(0, 0, w, h);

    // Film grain — gives tactile depth like quality print paper
    ctx.globalAlpha = 0.62;
    ctx.drawImage(scene.modernGrain, 0, 0);
    ctx.globalAlpha = 1;

    // Editorial corner vignette
    const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.20, w / 2, h / 2, h * 0.94);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.48)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }

  const DRAW = {
    cosmic:     drawCosmic,
    geological: drawGeological,
    ancient:    drawAncient,
    modern:     drawModern,
  };

  function draw(ctx, zone, w, h) {
    ensureScene(w, h);
    ctx.globalAlpha = 1;
    (DRAW[zone] || drawModern)(ctx, w, h);
    ctx.globalAlpha = 1;
  }

  // ── Crossfade between zones ───────────────────────────────────────────────────
  let currentZone = null;
  let targetZone  = null;
  let blendT      = 1;
  const BLEND_SPEED = 0.018;

  function smoothstep(t) { return t * t * (3 - 2 * t); }

  function update(zone, ctx, w, h) {
    if (zone !== targetZone) {
      currentZone = targetZone || zone;
      targetZone  = zone;
      blendT      = 0;
    }

    if (blendT < 1) {
      draw(ctx, currentZone, w, h);
      ctx.save();
      ctx.globalAlpha = smoothstep(blendT);
      draw(ctx, targetZone, w, h);
      ctx.restore();
      ctx.globalAlpha = 1;
      blendT = Math.min(1, blendT + BLEND_SPEED);
      if (blendT < 1) Timeline.markDirty();
    } else {
      draw(ctx, targetZone, w, h);
    }
  }

  return { update };
})();
