// annotations.js — freehand strokes stored in localStorage.
// Strokes are saved in timeline-space (year, yFraction) so they track
// correctly when you pan or zoom.

const Annotations = (() => {
  const KEY = 'my-world-annotations';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch { return []; }
  }

  function persist(items) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); }
    catch { /* storage full — silently ignore */ }
  }

  let items = load();

  function getAll() { return items; }

  function add(stroke) {
    stroke.id = `ann-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    items.push(stroke);
    persist(items);
    return stroke;
  }

  function removeLast() {
    if (!items.length) return;
    items.pop();
    persist(items);
  }

  function removeAll() {
    items = [];
    persist(items);
  }

  return { getAll, add, removeLast, removeAll };
})();
