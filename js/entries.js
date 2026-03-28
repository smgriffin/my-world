// entries.js — IndexedDB CRUD via Dexie.js

const Entries = (() => {
  const db = new Dexie('MyWorldDB');

  db.version(1).stores({
    entries: '++id, year, type, entryType',
  });

  // ── CRUD ──────────────────────────────────────────────────────────────────────
  async function getAll() {
    return db.entries.toArray();
  }

  async function add(entry) {
    const id = await db.entries.add(entry);
    return { ...entry, id };
  }

  async function update(id, changes) {
    await db.entries.update(id, changes);
  }

  async function remove(id) {
    await db.entries.delete(id);
  }

  async function get(id) {
    return db.entries.get(id);
  }

  // ── Export / Import ───────────────────────────────────────────────────────────
  async function exportHTML() {
    const all = await getAll();

    // Fetch local assets — works when served via HTTP; tells user if on file://
    async function tryFetch(path) {
      try {
        const r = await fetch(path);
        if (!r.ok) return '';
        return await r.text();
      } catch { return ''; }
    }

    const [css, jsTl, jsBg, jsEn, jsRe, jsSn] = await Promise.all([
      tryFetch('css/main.css'),
      tryFetch('js/timeline.js'),
      tryFetch('js/background.js'),
      tryFetch('js/entries.js'),
      tryFetch('js/render.js'),
      tryFetch('js/sound.js'),
    ]);

    if (!css && !jsTl) {
      alert('Static export requires the app to be served via HTTP (e.g. python3 -m http.server). ' +
            'Use Shift+E to export JSON instead, then share that file.');
      return;
    }

    // Stub entries.js — replaces DB with embedded data, no Dexie needed
    const stubEntries = `
const Entries = (() => {
  const _data = ${JSON.stringify(all, null, 2)};
  async function getAll() { return _data; }
  async function add() {}
  async function update() {}
  async function remove() {}
  async function get(id) { return _data.find(e => e.id === id); }
  async function exportJSON() {}
  async function importJSON() {}
  async function seedIfEmpty() {}
  return { getAll, add, update, remove, get, exportJSON, importJSON, seedIfEmpty };
})();`;

    const uiJs = await tryFetch('js/ui.js');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My World — Snapshot</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet">
  <style>${css}</style>
</head>
<body>
  <canvas id="canvas"></canvas>
  <div id="fab">
    <button id="sound-btn" title="Toggle sound (M)">♪</button>
    <button id="add-btn" title="Add entry (A)" style="display:none">+</button>
    <button id="cards-btn" title="Cards: hover only (C)">▤</button>
    <button id="help-btn" aria-label="Keyboard shortcuts">?
      <div id="hotkey-tooltip" role="tooltip">
        <div class="hotkey-row"><kbd>C</kbd><span>Toggle cards</span></div>
        <div class="hotkey-row"><kbd>M</kbd><span>Toggle sound</span></div>
        <div class="hotkey-row"><kbd>L</kbd><span>Toggle list</span></div>
        <div class="hotkey-row"><kbd>/</kbd><span>Search</span></div>
        <div class="hotkey-row"><kbd>Scroll</kbd><span>Zoom</span></div>
        <div class="hotkey-row"><kbd>Drag</kbd><span>Pan</span></div>
        <div class="hotkey-row"><kbd>Double-click</kbd><span>Zoom in</span></div>
      </div>
    </button>
  </div>
  <div id="card-layer"></div>
  <div id="lightbox" aria-hidden="true">
    <button id="lightbox-close" aria-label="Close">×</button>
    <img id="lightbox-img" src="" alt="">
  </div>
  <aside id="list-panel" class="collapsed">
    <div id="list-header">
      <span>Entries</span>
      <input type="text" id="search-input" placeholder="Search…" autocomplete="off" spellcheck="false">
    </div>
    <ul id="list-items"></ul>
  </aside>
  <input type="file" id="import-input" accept=".json" style="display:none">
  <!-- Read-only modal placeholder (required by ui.js init) -->
  <div id="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div id="modal-box">
      <div id="modal-header">
        <h2 id="modal-title">Entry</h2>
        <button id="modal-close" aria-label="Close">×</button>
      </div>
      <form id="modal-form" autocomplete="off">
        <div class="field"><label>Title</label><input name="title" type="text" required></div>
        <div class="field"><label>From</label><div class="date-row"><input name="fromValue" type="number" required min="0" step="any"><select name="fromUnit"><option value="CE">CE</option><option value="BCE">BCE</option><option value="ya">years ago</option><option value="kya">kya</option><option value="mya">mya</option><option value="bya">bya</option></select></div></div>
        <div class="field"><label>To</label><div class="date-row"><input name="toValue" type="number" min="0" step="any"><select name="toUnit"><option value="CE">CE</option><option value="BCE">BCE</option><option value="ya">years ago</option><option value="kya">kya</option><option value="mya">mya</option><option value="bya">bya</option></select></div></div>
        <div class="field-row"><div class="field"><label>Source</label><select name="type"><option value="historical">Historical</option><option value="personal">Personal</option></select></div><div class="field"><label>Type</label><select name="entryType"><option>Event</option><option>Person</option><option>Source</option><option>Location</option><option>Claim</option></select></div></div>
        <div class="field"><label>Summary</label><textarea name="summary"></textarea></div>
        <div class="field"><label>Notes</label><textarea name="notes"></textarea></div>
        <div class="field"><label>Tags</label><input name="tags" type="text"></div>
        <div class="field"><label>Connections</label><div id="connection-search-wrap"><input type="text" id="connection-search" placeholder="Search entries…" autocomplete="off"><ul id="connection-suggestions"></ul></div><div id="connection-chips"></div></div>
        <div class="field"><label>Photos &amp; Files</label><div id="attachment-zone"><span class="attachment-hint">Drop files here or <button type="button" id="attachment-browse">browse</button></span><input type="file" id="attachment-input" multiple accept="image/*,.pdf,.doc,.docx,.txt,.csv,.json" style="display:none"></div><div id="attachment-grid"></div></div>
        <div id="modal-actions">
          <button type="submit" class="btn-primary">Save</button>
          <button type="button" class="btn-ghost" id="modal-cancel-btn">Cancel</button>
          <button type="button" class="btn-danger" id="modal-delete" style="display:none">Delete</button>
        </div>
      </form>
    </div>
  </div>
  <script>${jsTl}</script>
  <script>${jsBg}</script>
  <script>${stubEntries}</script>
  <script>${jsRe}</script>
  <script>${jsSn}</script>
  <script>${uiJs}</script>
  <script>
    (async () => {
      const canvas = document.getElementById('canvas');
      function sizeCanvas() {
        canvas.width  = window.innerWidth;
        canvas.height = window.innerHeight;
        Timeline.resize(window.innerWidth, window.innerHeight);
      }
      sizeCanvas();
      window.addEventListener('resize', sizeCanvas);
      Timeline.attach(canvas, (screenX) => {
        const entry = Timeline.hitTest(Render.getEntries(), screenX);
        if (entry) UI.openEditModal(entry);
      });
      Render.init(canvas);
      await Entries.seedIfEmpty();
      UI.init();
      await UI.refresh();
      Sound.attachAutostart();
      document.getElementById('modal-cancel-btn').addEventListener('click', () => {
        document.getElementById('modal').classList.remove('open');
      });
    })();
  </script>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'my-world-snapshot.html';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportJSON() {
    const all = await getAll();
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my-world-export.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importJSON(file) {
    const text = await file.text();
    const entries = JSON.parse(text);
    await db.entries.clear();
    for (const e of entries) {
      const { id: _id, ...rest } = e;
      await db.entries.add(rest);
    }
  }

  // ── Seed data (only if DB is empty) ──────────────────────────────────────────
  async function seedIfEmpty() {
    const count = await db.entries.count();
    if (count > 0) return;

    const seeds = [
      {
        title: 'Big Bang',
        year: 13_800_000_000,
        yearEnd: null,
        type: 'historical',
        entryType: 'Event',
        summary: 'The origin of the observable universe — all matter, energy, space, and time emerge from an infinitely dense singularity.',
        image: '',
        notes: '',
        photos: [],
        links: [],
        tags: ['cosmology', 'origin'],
      },
      {
        title: 'Formation of Earth',
        year: 4_500_000_000,
        yearEnd: null,
        type: 'historical',
        entryType: 'Event',
        summary: 'Earth accretes from the solar nebula, becoming the third planet from the Sun.',
        image: '',
        notes: '',
        photos: [],
        links: [],
        tags: ['geology', 'earth'],
      },
      {
        title: 'First Life on Earth',
        year: 3_800_000_000,
        yearEnd: null,
        type: 'historical',
        entryType: 'Event',
        summary: 'Evidence of microbial life — earliest known prokaryotes appear in the fossil record.',
        image: '',
        notes: '',
        photos: [],
        links: [],
        tags: ['biology', 'evolution'],
      },
      {
        title: 'Cambrian Explosion',
        year: 538_000_000,
        yearEnd: 485_000_000,
        type: 'historical',
        entryType: 'Event',
        summary: 'A rapid diversification of animal life — most major animal phyla appear in the fossil record.',
        image: '',
        notes: '',
        photos: [],
        links: [],
        tags: ['evolution', 'biology'],
      },
      {
        title: 'Extinction of the Dinosaurs',
        year: 66_000_000,
        yearEnd: null,
        type: 'historical',
        entryType: 'Event',
        summary: 'The Cretaceous–Paleogene extinction event, triggered by the Chicxulub asteroid impact, wipes out non-avian dinosaurs.',
        image: '',
        notes: '',
        photos: [],
        links: [],
        tags: ['extinction', 'geology'],
      },
      {
        title: 'Homo sapiens emerges',
        year: 300_000,
        yearEnd: null,
        type: 'historical',
        entryType: 'Event',
        summary: 'Anatomically modern humans appear in Africa.',
        image: '',
        notes: '',
        photos: [],
        links: [],
        tags: ['human history', 'evolution'],
      },
      {
        title: 'Agricultural Revolution',
        year: 12_000,
        yearEnd: 10_000,
        type: 'historical',
        entryType: 'Event',
        summary: 'Humans transition from nomadic hunter-gatherer lifestyles to settled farming communities.',
        image: '',
        notes: '',
        photos: [],
        links: [],
        tags: ['human history', 'civilization'],
      },
      {
        title: 'Moon Landing',
        year: 55,
        yearEnd: null,
        type: 'historical',
        entryType: 'Event',
        summary: 'Apollo 11 lands on the Moon. Neil Armstrong and Buzz Aldrin walk on the lunar surface.',
        image: '',
        notes: '',
        photos: [],
        links: [],
        tags: ['space', 'modern'],
      },
    ];

    for (const s of seeds) {
      await db.entries.add(s);
    }
  }

  return { getAll, add, update, remove, get, exportHTML, exportJSON, importJSON, seedIfEmpty };
})();
