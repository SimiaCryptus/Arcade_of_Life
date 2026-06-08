// "Tools & Patterns" tab: lets the level author restrict which
// drawing tools and pattern presets are exposed to the player.

import { listPatterns } from '../patterns/index.js';

const TOOL_DEFS = [
  { id: 'freehand', name: '✏ Freehand', desc: 'Click-and-drag drawing' },
  { id: 'line', name: '📏 Line', desc: 'Straight-line tool' },
  { id: 'pattern', name: '🧬 Pattern', desc: 'Stamp pre-built patterns' },
  { id: 'fill', name: '🪣 Fill', desc: 'Region fill with patterns' },
];

export function buildToolsPanel(d) {
  const toggleListEl = d.overlay.querySelector('#ld-tool-toggle-list');
  if (!toggleListEl) return null;
  toggleListEl.innerHTML = '';
  const toolCheckboxes = {};
  for (const def of TOOL_DEFS) {
    const row = document.createElement('div');
    row.className = 'ld-tool-toggle-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = `ld-tool-${def.id}`;
    cb.checked = !!d.allowedTools[def.id];
    cb.addEventListener('change', () => {
      d.allowedTools[def.id] = cb.checked;
      d._setStatus(`Tool "${def.name}" ${cb.checked ? 'enabled' : 'disabled'}.`, 'ok');
    });
    const label = document.createElement('label');
    label.htmlFor = `ld-tool-${def.id}`;
    label.innerHTML = `<strong>${def.name}</strong> <span style="color:#8080a0;">— ${def.desc}</span>`;
    row.appendChild(cb);
    row.appendChild(label);
    toggleListEl.appendChild(row);
    toolCheckboxes[def.id] = cb;
  }
  // Pattern allow-list controls.
  const allowAllBtn = d.overlay.querySelector('#ld-pattern-allow-all');
  const allowNoneBtn = d.overlay.querySelector('#ld-pattern-allow-none');
  const filterInput = d.overlay.querySelector('#ld-pattern-filter');
  const refresh = () => refreshPatternAllowList(d);
  allowAllBtn.addEventListener('click', () => {
    const patterns = listPatterns();
    d.allowedPatterns = new Set(patterns.map((p) => p.id));
    refresh();
    d._setStatus(`Allowed ${d.allowedPatterns.size} pattern(s).`, 'ok');
  });
  allowNoneBtn.addEventListener('click', () => {
    d.allowedPatterns.clear();
    refresh();
    d._setStatus('Cleared pattern allow-list (= all allowed).', 'ok');
  });
  filterInput.addEventListener('input', () => {
    d._patternFilterQuery = filterInput.value.toLowerCase();
    refresh();
  });
  refresh();
  return {
    toolCheckboxes,
    syncFromState: () => {
      for (const [k, cb] of Object.entries(toolCheckboxes)) {
        cb.checked = !!d.allowedTools[k];
      }
      refresh();
    },
  };
}

export function refreshPatternAllowList(d) {
  const listEl = d.overlay.querySelector('#ld-pattern-allow-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  const q = d._patternFilterQuery || '';
  let patterns = listPatterns();
  if (q) {
    patterns = patterns.filter(
      (p) =>
        p.id.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.tags && p.tags.some((t) => t.toLowerCase().includes(q)))
    );
  }
  const MAX = 300;
  const limited = patterns.slice(0, MAX);
  for (const p of limited) {
    const row = document.createElement('div');
    row.className = 'ld-pattern-allow-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = `ld-allow-${p.id}`;
    cb.checked = d.allowedPatterns.has(p.id);
    cb.addEventListener('change', () => {
      if (cb.checked) d.allowedPatterns.add(p.id);
      else d.allowedPatterns.delete(p.id);
    });
    const label = document.createElement('label');
    label.htmlFor = `ld-allow-${p.id}`;
    label.innerHTML = `<strong>${escapeHtml(p.name)}</strong> <span style="color:#8080a0;font-size:10px;">[${p.category}]</span>`;
    row.appendChild(cb);
    row.appendChild(label);
    listEl.appendChild(row);
  }
  if (patterns.length > MAX) {
    const more = document.createElement('div');
    more.style.cssText = 'color:#8080a0;font-style:italic;padding:6px;font-size:11px;';
    more.textContent = `... and ${patterns.length - MAX} more (use filter to narrow)`;
    listEl.appendChild(more);
  }
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
