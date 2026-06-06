import { CONFIG } from './config.js';
import { Logger } from './logger.js';
import { listPatterns, clonePatternCells, CATEGORY } from './patterns/index.js';
import { listRulesets, getRuleset, CompiledRuleset, CONWAY } from './rules/ruleset.js';
import './rules/extraRulesets.js';
import {
  loadCustomPatterns,
  loadCustomPatternMeta,
  onCustomPatternsChanged,
} from './patternCapture.js';
import { normalizeCells } from './patterns/library.js';

/**
 * PatternZoo: browse the pattern library with live toroidal previews.
 *
 * Architecture:
 *   - Grid panel showing all patterns matching current filters.
 *   - Each card has a tiny canvas running a toroidal Life simulation.
 *   - Filters: category, ruleset, tags, free-text search.
 *   - Per-card controls: speed, grid size, reset.
 *   - Clicking a card opens a detail view with a larger preview,
 *     full metadata, and a "Place in Game" button.
 *   - Custom (user-saved) patterns appear in the zoo with edit/delete
 *     actions that open the in-game pattern editor.
 *
 * All previews share a single rAF loop and tick at independent rates
 * driven by their own configured speed multiplier.
 */

// ─────────────────────────────────────────────────────────────────────
// ToroidalLifeSim — small reusable simulator for previews
// ─────────────────────────────────────────────────────────────────────

class ToroidalLifeSim {
  constructor(width, height, rule) {
    this.width = width;
    this.height = height;
    this.rule = rule;
    this.wrap = true; // set false for guns / open-boundary patterns
    this.cells = new Uint8Array(width * height);
    this.next = new Uint8Array(width * height);
    this.generation = 0;
  }

  setSize(width, height) {
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    this.cells = new Uint8Array(width * height);
    this.next = new Uint8Array(width * height);
    this.generation = 0;
  }

  setRule(rule) {
    this.rule = rule;
  }
  setWrap(wrap) {
    this.wrap = wrap;
  }

  clear() {
    this.cells.fill(0);
    this.generation = 0;
  }

  // Stamp a pattern centered in the grid.
  stampCentered(cells) {
    this.clear();
    if (!cells || cells.length === 0) return;
    let maxX = 0,
      maxY = 0;
    for (const [x, y] of cells) {
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const pw = maxX + 1;
    const ph = maxY + 1;
    const offX = Math.floor((this.width - pw) / 2);
    const offY = Math.floor((this.height - ph) / 2);
    for (const [x, y] of cells) {
      const px = (((x + offX) % this.width) + this.width) % this.width;
      const py = (((y + offY) % this.height) + this.height) % this.height;
      this.cells[py * this.width + px] = 1;
    }
  }

  tick() {
    const w = this.width;
    const h = this.height;
    const cells = this.cells;
    const next = this.next;
    const rule = this.rule;
    const wrap = this.wrap;
    for (let y = 0; y < h; y++) {
      const yUp = wrap ? (y - 1 + h) % h : y - 1;
      const yDn = wrap ? (y + 1) % h : y + 1;
      for (let x = 0; x < w; x++) {
        const xLt = wrap ? (x - 1 + w) % w : x - 1;
        const xRt = wrap ? (x + 1) % w : x + 1;
        let n = 0;
        // Sum the 3x3 Moore neighbourhood, skipping out-of-bounds cells
        // when wrapping is disabled.
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (!wrap && (ny < 0 || ny >= h)) continue;
          const row = wrap ? (ny + h) % h : ny;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            if (!wrap && (nx < 0 || nx >= w)) continue;
            const col = wrap ? (nx + w) % w : nx;
            n += cells[row * w + col];
          }
        }
        const alive = cells[y * w + x];
        let nextAlive;
        if (alive) nextAlive = rule.shouldSurvive(n) ? 1 : 0;
        else nextAlive = rule.shouldBirth(n) ? 1 : 0;
        next[y * w + x] = nextAlive;
      }
    }
    // Swap buffers.
    const tmp = this.cells;
    this.cells = next;
    this.next = tmp;
    this.generation++;
  }

  population() {
    let n = 0;
    for (let i = 0; i < this.cells.length; i++) n += this.cells[i];
    return n;
  }
}

// ─────────────────────────────────────────────────────────────────────
// PatternPreview — manages one card's canvas + sim
// ─────────────────────────────────────────────────────────────────────

class PatternPreview {
  constructor({ pattern, canvas, gridSize, speed, rulesetId, wrap }) {
    this.pattern = pattern;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.gridSize = gridSize;
    this.speed = speed; // ticks per second
    this.rulesetId = rulesetId;
    // Guns need open boundaries so emitted gliders don't wrap back and
    // interfere with the gun structure.
    this.wrap = wrap !== undefined ? wrap : pattern.category !== CATEGORY.GUN;
    this.sim = new ToroidalLifeSim(gridSize, gridSize, this._compileRule());
    this.sim.setWrap(this.wrap);
    this.sim.stampCentered(pattern.cells);
    this._accumMs = 0;
    this._paused = false;
    this._dragPaused = false;
    this.draw();
  }

  _compileRule() {
    const def = getRuleset(this.rulesetId) || CONWAY;
    return new CompiledRuleset(def);
  }

  setRuleset(id) {
    this.rulesetId = id;
    this.sim.setRule(this._compileRule());
    this.reset();
  }

  setGridSize(n) {
    this.gridSize = n;
    this.sim.setSize(n, n);
    this.sim.setWrap(this.wrap);
    this.reset();
  }

  // Temporary "drag pause" — separate from user-toggled pause so we can
  // restore the correct state when the drag ends.
  setDragPaused(p) {
    this._dragPaused = !!p;
  }

  setSpeed(s) {
    this.speed = s;
  }

  setPaused(p) {
    this._paused = p;
  }

  reset() {
    this.sim.stampCentered(this.pattern.cells);
    this.draw();
  }

  update(dtMs) {
    if (this._paused || this._dragPaused || this.speed <= 0) return;
    this._accumMs += dtMs;
    const period = 1000 / this.speed;
    let ticks = 0;
    while (this._accumMs >= period && ticks < 8) {
      this.sim.tick();
      this._accumMs -= period;
      ticks++;
    }
    if (ticks > 0) this.draw();
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cs = w / this.gridSize;
    // Background.
    ctx.fillStyle = '#000010';
    ctx.fillRect(0, 0, w, h);
    // Subtle grid lines (only if cells are big enough).
    if (cs >= 4) {
      ctx.strokeStyle = 'rgba(64, 64, 160, 0.15)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= this.gridSize; i++) {
        const p = i * cs + 0.5;
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, p);
        ctx.lineTo(w, p);
        ctx.stroke();
      }
    }
    // Cells with glow.
    ctx.fillStyle = '#00ff88';
    ctx.shadowColor = '#00ff88';
    const cells = this.sim.cells;
    // Adapt cell rendering to size so small cells stay visible.
    // - For tiny cells (cs < 3), draw full cell with no inset and boost glow.
    // - For medium cells, use a 1px inset.
    // - For large cells, use the original 2px inset for a clean grid look.
    let inset, drawSize;
    if (cs < 3) {
      inset = 0;
      drawSize = Math.max(1, cs);
    } else if (cs < 6) {
      inset = 0.5;
      drawSize = cs - 1;
    } else {
      inset = 1;
      drawSize = cs - 2;
    }
    // Boost glow for small cells so they remain visible against the dark bg.
    ctx.shadowBlur = cs < 4 ? Math.max(3, cs * 1.5) : Math.max(2, cs * 0.4);
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        if (cells[y * this.gridSize + x]) {
          ctx.fillRect(x * cs + inset, y * cs + inset, drawSize, drawSize);
        }
      }
    }
    ctx.shadowBlur = 0;
  }

  destroy() {
    // Nothing to do — GC will clean up. Method exists for symmetry.
  }
}

// ─────────────────────────────────────────────────────────────────────
// PatternZoo — main overlay UI
// ─────────────────────────────────────────────────────────────────────

const ZOO_DEFAULTS = {
  speed: 10,
  rulesetId: 'conway',
  pageSize: 24,
};
const PAGE_SIZE_OPTIONS = [12, 24, 48, 96, 200];
// Auto-sizing constants for preview grids.
const PREVIEW_PADDING = 6; // cells of padding around the pattern on each side
const PREVIEW_MIN_SIZE = 16;
const PREVIEW_MAX_SIZE = 64;
const DETAIL_PADDING = 10;
const DETAIL_MIN_SIZE = 20;
const DETAIL_MAX_SIZE = 80;
// Compute an auto grid size for a pattern. Prefers the observed
// `maxBounds` (peak bounding box during characterization) over the
// initial pattern footprint, so methuselahs / guns / puffers get a
// preview grid big enough to contain their evolution. Unbounded
// growth (width or height === -1) snaps to the max allowed size.
// Result = max(width, height) + 2*padding, clamped to [min, max].
function autoGridSize(pattern, padding, min, max) {
  let w = pattern.width || 1;
  let h = pattern.height || 1;
  if (pattern.maxBounds) {
    const mbw = pattern.maxBounds.width;
    const mbh = pattern.maxBounds.height;
    // -1 means unbounded — force grid to the max.
    if (mbw === -1 || mbh === -1) return max;
    if (Number.isFinite(mbw) && mbw > w) w = mbw;
    if (Number.isFinite(mbh) && mbh > h) h = mbh;
  }
  const dim = Math.max(w, h);
  const n = dim + padding * 2;
  return Math.max(min, Math.min(max, n));
}

export class PatternZoo {
  constructor({ game } = {}) {
    this.game = game;
    this.visible = false;
    this.previews = []; // active PatternPreview instances
    this.detailPreview = null;
    this._dragPauseDepth = 0; // number of sliders currently being dragged
    this.filterCategory = 'all';
    // Default ruleset filter to the currently active CA ruleset so users
    // see relevant patterns first. Falls back to 'all' if CONFIG isn't ready.
    this.filterRuleset = (CONFIG && CONFIG.ACTIVE_RULESET) || 'all';
    this.filterTag = 'all';
    this.filterSource = 'all'; // 'all' | 'builtin' | 'custom'
    this.searchQuery = '';
    // Picker mode: when set, clicking "place" in a card invokes the
    // callback instead of placing into the running game. Used by the
    // level designer (and potentially other tools) to pick a pattern.
    this._pickerMode = false;
    this._pickerCallback = null;
    this._pickerTitle = null;
    this._pickerCloseHandler = null;
    // Per-card default speed (user-adjustable globally). Grid size is
    // computed per-pattern based on its bounding box.
    this.globalSpeed = ZOO_DEFAULTS.speed;
    // Paging state.
    this.pageSize = ZOO_DEFAULTS.pageSize;
    this.currentPage = 0;
    this._filteredCache = null; // cached result of _filteredPatterns()
    this._customCache = null; // cached result of _getCustomPatterns()
    // Debounce timer for search input (so we don't rebuild on every keystroke).
    this._searchDebounceTimer = null;
    this._stashedSpeed = null;
    this._lastFrameTs = 0;
    this._rafHandle = null;
    this._buildDom();
    this._wireGlobalControls();
    this._bindGlobalKeys();
    // Refresh grid when custom patterns change (save/delete/rename).
    this._unsubCustomChange = onCustomPatternsChanged(() => {
      this._invalidateCache();
      if (this.visible) this._rebuildGrid();
    });
  }
  /**
   * Open the zoo as a modal pattern picker.
   *
   * @param {Object} opts
   * @param {string} [opts.title]    Optional banner text shown to the user.
   * @param {Function} opts.onPick   Called with the chosen pattern object,
   *                                 or `null` if the user cancels.
   * @param {Function} [opts.filter] Optional predicate to pre-filter patterns
   *                                 shown in the picker. When set, only
   *                                 patterns passing this predicate are
   *                                 displayed in the grid.
   * @param {string} [opts.categoryFilter] Optional category to pre-select
   *                                 in the category dropdown (e.g. 'spaceship').
   */
  pickPattern({ title = 'Select a pattern', onPick, filter, categoryFilter } = {}) {
    this._pickerMode = true;
    this._pickerCallback = typeof onPick === 'function' ? onPick : null;
    this._pickerTitle = title;
    this._pickerFilter = typeof filter === 'function' ? filter : null;
    // Pre-set category filter if provided.
    if (categoryFilter) {
      this.filterCategory = categoryFilter;
      // Sync the select element if it exists.
      const catSel = this.overlay && this.overlay.querySelector('#pz-filter-category');
      if (catSel) catSel.value = categoryFilter;
    }
    this.show();
    this._applyPickerUi();
  }
  _applyPickerUi() {
    // Update the subtitle to reflect picker intent.
    const sub = this.overlay.querySelector('#pattern-zoo-subtitle');
    if (sub && this._pickerMode && this._pickerTitle) {
      sub.textContent = `🎯 ${this._pickerTitle} — click "⊕ Use" on any pattern, or Close to cancel.`;
      sub.style.color = '#ffcc44';
    }
  }
  _restorePickerUi() {
    const sub = this.overlay.querySelector('#pattern-zoo-subtitle');
    if (sub) {
      sub.textContent =
        'Browse the library — click a pattern for details, or place it directly into the game.';
      sub.style.color = '';
    }
  }
  _finishPicker(pattern) {
    const cb = this._pickerCallback;
    this._pickerMode = false;
    this._pickerCallback = null;
    this._pickerTitle = null;
    this._pickerFilter = null;
    this._restorePickerUi();
    this.hide();
    if (cb) {
      try {
        cb(pattern || null);
      } catch (e) {
        Logger.error('[PatternZoo] pickPattern callback failed:', e);
      }
    }
  }

  // Invalidate cached filtered/custom lists. Call whenever filters change
  // or the underlying custom-pattern store mutates.
  _invalidateCache() {
    this._filteredCache = null;
    this._customCache = null;
  }

  // Get all custom patterns as pseudo-Pattern objects compatible with the
  // built-in registry shape, so the same rendering code works on both.
  _getCustomPatterns() {
    if (this._customCache) return this._customCache;
    const raw = loadCustomPatterns();
    const meta = loadCustomPatternMeta();
    const out = [];
    for (const [name, cells] of Object.entries(raw)) {
      if (!Array.isArray(cells) || cells.length === 0) continue;
      const m = meta[name] || {};
      const normalized = normalizeCells(cells);
      out.push({
        id: `custom:${name}`,
        _customName: name,
        _isCustom: true,
        name: `★ ${name}`,
        category: m.category || CATEGORY.MISC,
        cells: normalized.cells,
        width: normalized.width,
        height: normalized.height,
        period: m.period != null ? m.period : 1,
        rulesets: m.rulesets || ['*'],
        description: m.description || 'User-captured pattern.',
        tags: m.tags || ['custom'],
        direction: m.direction || null,
        source: m.source || 'User',
        createdAt: m.createdAt || null,
      });
    }
    this._customCache = out;
    return out;
  }
  // Determine which ruleset to use when previewing a pattern. Each pattern
  // is previewed using its native ruleset (the first explicit entry in
  // `pattern.rulesets`). Patterns marked universal (`*`) fall back to the
  // current ruleset filter (if any specific one is selected) or to the
  // game's active ruleset.
  _getNativeRulesetFor(pattern) {
    const rulesets = pattern.rulesets || [];
    for (const r of rulesets) {
      if (r && r !== '*') return r;
    }
    if (this.filterRuleset && this.filterRuleset !== 'all') return this.filterRuleset;
    return CONFIG.ACTIVE_RULESET || ZOO_DEFAULTS.rulesetId;
  }

  // ── DOM construction ─────────────────────────────────────────────
  _buildDom() {
    // Overlay container.
    const overlay = document.createElement('div');
    overlay.id = 'pattern-zoo-overlay';
    overlay.className = 'overlay hidden';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
          <div id="pattern-zoo-content">
            <div id="pattern-zoo-header">
              <h1 id="pattern-zoo-title">🦓 Pattern Zoo</h1>
              <p id="pattern-zoo-subtitle">Browse the library — click a pattern for details, or place it directly into the game.</p>
            </div>
            <div id="pattern-zoo-toolbar">
              <div class="pz-filter-row">
                <label>
                  Search:
                  <input id="pz-search" type="text" placeholder="name, id, tag..."
                    style="background:#0a0a20;color:#e0e0ff;border:1px solid #4040a0;
                           padding:5px 8px;font-family:inherit;font-size:12px;
                           border-radius:3px;width:160px;">
                </label>
                 <label>
                   Source:
                   <select id="pz-filter-source" class="pz-select">
                     <option value="all">All Sources</option>
                     <option value="builtin">Built-in Only</option>
                     <option value="custom">★ My Patterns Only</option>
                   </select>
                 </label>
                <label>
                  Category:
                  <select id="pz-filter-category" class="pz-select"></select>
                </label>
                <label>
                   Ruleset:
                  <select id="pz-filter-ruleset" class="pz-select"></select>
                </label>
                <label>
                  Tag:
                  <select id="pz-filter-tag" class="pz-select"></select>
                </label>
                <span id="pz-result-count" style="color:#8080a0;font-size:11px;
                      margin-left:auto;align-self:center;"></span>
              </div>
              <div class="pz-global-row">
                <label>
                  Speed:
                  <input id="pz-global-speed" type="range" min="0" max="300" step="1"
                    style="width:120px;accent-color:#00ffff;vertical-align:middle;">
                  <span id="pz-global-speed-label" style="color:#00ffff;font-weight:bold;
                        min-width:48px;display:inline-block;">10/s</span>
                </label>
                <button id="pz-pause-all" class="pz-tool-btn">⏸ Pause All</button>
                <button id="pz-reset-all" class="pz-tool-btn">↺ Reset All</button>
                 <button id="pz-new-pattern" class="pz-tool-btn" style="color:#ffcc44;border-color:#ffcc44;">+ New Pattern</button>
              </div>
               <div class="pz-page-row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px;">
                 <button id="pz-page-first" class="pz-tool-btn" title="First page">⏮</button>
                 <button id="pz-page-prev" class="pz-tool-btn" title="Previous page">◀</button>
                 <span id="pz-page-indicator" style="color:#e0e0ff;font-size:12px;min-width:140px;text-align:center;">Page 1 / 1</span>
                 <button id="pz-page-next" class="pz-tool-btn" title="Next page">▶</button>
                 <button id="pz-page-last" class="pz-tool-btn" title="Last page">⏭</button>
                 <label style="margin-left:12px;">
                   Per page:
                   <select id="pz-page-size" class="pz-select"></select>
                 </label>
                 <button id="pz-page-jump-btn" class="pz-tool-btn" title="Jump to page">Go to…</button>
               </div>
            </div>
            <div id="pattern-zoo-grid"></div>
            <div id="pattern-zoo-footer">
              <button id="pattern-zoo-close-button">Close</button>
            </div>
          </div>
          <div id="pattern-zoo-detail" class="hidden">
            <div id="pz-detail-content">
              <button id="pz-detail-back">← Back to Zoo</button>
              <div id="pz-detail-body"></div>
            </div>
          </div>
        `;
    const container = document.getElementById('game-container') || document.body;
    container.appendChild(overlay);
    this.overlay = overlay;
    this.gridEl = overlay.querySelector('#pattern-zoo-grid');
    this.detailEl = overlay.querySelector('#pattern-zoo-detail');
    this.detailBodyEl = overlay.querySelector('#pz-detail-body');
    this.resultCountEl = overlay.querySelector('#pz-result-count');
    // Wire core buttons.
    overlay.querySelector('#pattern-zoo-close-button').addEventListener('click', () => this.hide());
    overlay.querySelector('#pz-detail-back').addEventListener('click', () => this._closeDetail());
    overlay
      .querySelector('#pz-new-pattern')
      .addEventListener('click', () => this._openEditorForNew());
    // Click outside content closes detail (but not the zoo).
    this.detailEl.addEventListener('click', (e) => {
      if (e.target === this.detailEl) this._closeDetail();
    });
    // Populate selects.
    this._populateFilters();
    this._populatePageSizeSelect();
    this._wirePagingControls();
  }
  _populatePageSizeSelect() {
    const sel = this.overlay.querySelector('#pz-page-size');
    if (!sel) return;
    sel.innerHTML = '';
    for (const n of PAGE_SIZE_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = String(n);
      sel.appendChild(opt);
    }
    sel.value = String(this.pageSize);
    sel.addEventListener('change', () => {
      this.pageSize = parseInt(sel.value, 10) || ZOO_DEFAULTS.pageSize;
      this.currentPage = 0;
      this._rebuildGrid();
    });
  }
  _wirePagingControls() {
    const firstBtn = this.overlay.querySelector('#pz-page-first');
    const prevBtn = this.overlay.querySelector('#pz-page-prev');
    const nextBtn = this.overlay.querySelector('#pz-page-next');
    const lastBtn = this.overlay.querySelector('#pz-page-last');
    const jumpBtn = this.overlay.querySelector('#pz-page-jump-btn');
    firstBtn.addEventListener('click', () => this._goToPage(0));
    prevBtn.addEventListener('click', () => this._goToPage(this.currentPage - 1));
    nextBtn.addEventListener('click', () => this._goToPage(this.currentPage + 1));
    lastBtn.addEventListener('click', () => this._goToPage(this._pageCount() - 1));
    jumpBtn.addEventListener('click', () => {
      const total = this._pageCount();
      const input = window.prompt(`Jump to page (1 - ${total}):`, String(this.currentPage + 1));
      if (!input) return;
      const n = parseInt(input, 10);
      if (!isNaN(n)) this._goToPage(n - 1);
    });
  }
  _pageCount() {
    const total = this._getFilteredPatterns().length;
    return Math.max(1, Math.ceil(total / this.pageSize));
  }
  _goToPage(idx) {
    const pageCount = this._pageCount();
    const clamped = Math.max(0, Math.min(pageCount - 1, idx));
    if (clamped === this.currentPage) return;
    this.currentPage = clamped;
    this._rebuildGrid();
  }

  _populateFilters() {
    const catSel = this.overlay.querySelector('#pz-filter-category');
    const ruleSel = this.overlay.querySelector('#pz-filter-ruleset');
    const tagSel = this.overlay.querySelector('#pz-filter-tag');
    const sourceSel = this.overlay.querySelector('#pz-filter-source');
    // Category options.
    catSel.innerHTML = '<option value="all">All Categories</option>';
    const catLabels = {
      [CATEGORY.STILL_LIFE]: 'Still Lifes',
      [CATEGORY.OSCILLATOR]: 'Oscillators',
      [CATEGORY.SPACESHIP]: 'Spaceships',
      [CATEGORY.GUN]: 'Guns',
      [CATEGORY.METHUSELAH]: 'Methuselahs',
      [CATEGORY.PUFFER]: 'Puffers',
      [CATEGORY.MISC]: 'Misc / Game',
    };
    for (const c of Object.values(CATEGORY)) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = catLabels[c] || c;
      catSel.appendChild(opt);
    }
    // Ruleset filter options (which patterns declare compatibility).
    ruleSel.innerHTML = '<option value="all">All Rulesets</option>';
    for (const def of listRulesets()) {
      const opt = document.createElement('option');
      opt.value = def.id;
      opt.textContent = `${def.name} (${def.notation})`;
      ruleSel.appendChild(opt);
    }
    // Tags: collect all unique tags from the library.
    const tagSet = new Set();
    const allForTags = [...listPatterns(), ...this._getCustomPatterns()];
    for (const p of allForTags) {
      for (const t of p.tags) tagSet.add(t);
    }
    const tags = Array.from(tagSet).sort();
    tagSel.innerHTML = '<option value="all">All Tags</option>';
    for (const t of tags) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      tagSel.appendChild(opt);
    }
    // Wire filter change events.
    const searchEl = this.overlay.querySelector('#pz-search');
    searchEl.addEventListener('input', () => {
      // Debounce: avoid rebuilding the grid on every keystroke when the
      // pattern database is large.
      if (this._searchDebounceTimer) clearTimeout(this._searchDebounceTimer);
      this._searchDebounceTimer = setTimeout(() => {
        this.searchQuery = searchEl.value.trim().toLowerCase();
        this._invalidateCache();
        this.currentPage = 0;
        this._rebuildGrid();
      }, 150);
    });
    catSel.addEventListener('change', () => {
      this.filterCategory = catSel.value;
      this._invalidateCache();
      this.currentPage = 0;
      this._rebuildGrid();
    });
    ruleSel.addEventListener('change', () => {
      this.filterRuleset = ruleSel.value;
      this._userChangedRulesetFilter = true;
      this._invalidateCache();
      this.currentPage = 0;
      this._rebuildGrid();
    });
    tagSel.addEventListener('change', () => {
      this.filterTag = tagSel.value;
      this._invalidateCache();
      this.currentPage = 0;
      this._rebuildGrid();
    });
    sourceSel.addEventListener('change', () => {
      this.filterSource = sourceSel.value;
      this._invalidateCache();
      this.currentPage = 0;
      this._rebuildGrid();
    });
  }

  _wireGlobalControls() {
    const speedSlider = this.overlay.querySelector('#pz-global-speed');
    const speedLabel = this.overlay.querySelector('#pz-global-speed-label');
    const pauseBtn = this.overlay.querySelector('#pz-pause-all');
    const resetBtn = this.overlay.querySelector('#pz-reset-all');
    speedSlider.value = String(this.globalSpeed);
    speedLabel.textContent = `${this.globalSpeed}/s`;
    this._attachDragPause(speedSlider);
    speedSlider.addEventListener('input', () => {
      this.globalSpeed = parseInt(speedSlider.value, 10) || 10;
      speedLabel.textContent = this.globalSpeed === 0 ? 'Paused' : `${this.globalSpeed}/s`;
      for (const p of this.previews) p.setSpeed(this.globalSpeed);
    });
    this._allPaused = false;
    pauseBtn.addEventListener('click', () => {
      this._allPaused = !this._allPaused;
      for (const p of this.previews) p.setPaused(this._allPaused);
      pauseBtn.textContent = this._allPaused ? '▶ Resume All' : '⏸ Pause All';
    });
    resetBtn.addEventListener('click', () => {
      for (const p of this.previews) p.reset();
    });
  }
  // Attach handlers to a range input so the previews pause while the
  // user is actively dragging the thumb. This avoids the visual flicker
  // caused by re-stamping the pattern on every intermediate value.
  _attachDragPause(slider) {
    if (!slider || slider._pzDragPauseWired) return;
    slider._pzDragPauseWired = true;
    const begin = () => this._beginDragPause();
    const end = () => this._endDragPause();
    slider.addEventListener('pointerdown', begin);
    slider.addEventListener('pointerup', end);
    slider.addEventListener('pointercancel', end);
    // Keyboard interaction (arrow keys) — pause for the duration of the
    // key press so rapid repeats also stay smooth.
    slider.addEventListener('keydown', begin);
    slider.addEventListener('keyup', end);
    // Safety net: if the pointer leaves the window mid-drag, end the pause.
    slider.addEventListener('blur', end);
  }
  _beginDragPause() {
    this._dragPauseDepth++;
    if (this._dragPauseDepth === 1) {
      for (const p of this.previews) p.setDragPaused(true);
      if (this.detailPreview) this.detailPreview.setDragPaused(true);
    }
  }
  _endDragPause() {
    if (this._dragPauseDepth <= 0) return;
    this._dragPauseDepth--;
    if (this._dragPauseDepth === 0) {
      for (const p of this.previews) p.setDragPaused(false);
      if (this.detailPreview) this.detailPreview.setDragPaused(false);
    }
  }

  _bindGlobalKeys() {
    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      // ESC closes detail first, then zoo.
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!this.detailEl.classList.contains('hidden')) {
          this._closeDetail();
        } else {
          this.hide();
        }
        return;
      }
      // Slash focuses search.
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        const search = this.overlay.querySelector('#pz-search');
        if (search) search.focus();
      }
      // Paging shortcuts (only when detail view is closed and focus is
      // not in a text field).
      const inField =
        document.activeElement &&
        (document.activeElement.tagName === 'INPUT' ||
          document.activeElement.tagName === 'SELECT' ||
          document.activeElement.tagName === 'TEXTAREA');
      if (inField) return;
      if (!this.detailEl.classList.contains('hidden')) return;
      if (e.key === 'PageDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        this._goToPage(this.currentPage + 1);
      } else if (e.key === 'PageUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        this._goToPage(this.currentPage - 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        this._goToPage(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        this._goToPage(this._pageCount() - 1);
      }
    });
  }

  // ── Show / hide ──────────────────────────────────────────────────
  show() {
    if (this.visible) return;
    this.visible = true;
    // Refresh the default ruleset filter to match the current active
    // ruleset every time the zoo opens (config may have changed).
    if (!this._pickerMode) {
      const activeRuleset = (CONFIG && CONFIG.ACTIVE_RULESET) || 'all';
      // Only override if user hasn't customized the filter yet, or if
      // it's still on default 'all'. We respect explicit user choices.
      if (this.filterRuleset === 'all' || !this._userChangedRulesetFilter) {
        this.filterRuleset = activeRuleset;
      }
    }
    // Refresh custom-pattern cache in case the store changed while hidden.
    this._invalidateCache();
    // Pause game.
    if (this.game) {
      this._stashedSpeed = CONFIG.SPEED_MULTIPLIER;
      CONFIG.SPEED_MULTIPLIER = 0;
      const lbl = document.getElementById('speed-label');
      if (lbl) lbl.textContent = 'PAUSED (zoo)';
    }
    this.overlay.classList.remove('hidden');
    this.overlay.removeAttribute('aria-hidden');
    // Sync the ruleset select to reflect our default.
    const ruleSel = this.overlay.querySelector('#pz-filter-ruleset');
    if (ruleSel) ruleSel.value = this.filterRuleset;
    this._rebuildGrid();
    this._startLoop();
  }

  hide() {
    if (!this.visible) return;
    // If hiding while a picker was open and we didn't already finalize
    // (e.g. user clicked the Close button), treat it as a cancel.
    if (this._pickerMode && this._pickerCallback) {
      const cb = this._pickerCallback;
      this._pickerMode = false;
      this._pickerCallback = null;
      this._pickerTitle = null;
      this._pickerFilter = null;
      this._restorePickerUi();
      try {
        cb(null);
      } catch (e) {
        Logger.error('[PatternZoo] pickPattern cancel callback failed:', e);
      }
    }
    this.visible = false;
    this._closeDetail();
    this._stopLoop();
    this._destroyPreviews();
    this.overlay.classList.add('hidden');
    this.overlay.setAttribute('aria-hidden', 'true');
    if (this.game && this._stashedSpeed != null) {
      CONFIG.SPEED_MULTIPLIER = this._stashedSpeed;
      this._stashedSpeed = null;
      if (this.game._applySpeedFromSlider) this.game._applySpeedFromSlider();
    }
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  isVisible() {
    return this.visible;
  }

  // ── Grid building ────────────────────────────────────────────────
  // Returns the cached filtered list, computing it on first access.
  _getFilteredPatterns() {
    if (this._filteredCache) return this._filteredCache;
    this._filteredCache = this._filteredPatterns();
    return this._filteredCache;
  }

  _filteredPatterns() {
    const builtins = listPatterns();
    const customs = this._getCustomPatterns();
    let out;
    if (this.filterSource === 'builtin') out = builtins;
    else if (this.filterSource === 'custom') out = customs;
    else out = [...builtins, ...customs];
    if (this.filterCategory !== 'all') {
      out = out.filter((p) => p.category === this.filterCategory);
    }
    if (this.filterRuleset !== 'all') {
      out = out.filter((p) => p.rulesets.includes('*') || p.rulesets.includes(this.filterRuleset));
    }
    if (this.filterTag !== 'all') {
      out = out.filter((p) => p.tags.includes(this.filterTag));
    }
    if (this.searchQuery) {
      const q = this.searchQuery;
      out = out.filter(
        (p) =>
          p.id.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    // Apply picker filter last so it can override anything.
    if (this._pickerMode && this._pickerFilter) {
      out = out.filter(this._pickerFilter);
    }
    return out;
  }

  _rebuildGrid() {
    this._destroyPreviews();
    this.gridEl.innerHTML = '';
    const allPatterns = this._getFilteredPatterns();
    const total = allPatterns.length;
    const pageCount = Math.max(1, Math.ceil(total / this.pageSize));
    // Clamp current page (filter may have shrunk the list).
    if (this.currentPage >= pageCount) this.currentPage = pageCount - 1;
    if (this.currentPage < 0) this.currentPage = 0;
    const start = this.currentPage * this.pageSize;
    const end = Math.min(start + this.pageSize, total);
    const pageSlice = allPatterns.slice(start, end);
    // Update result count + page indicator.
    if (total === 0) {
      this.resultCountEl.textContent = '0 patterns';
    } else {
      this.resultCountEl.textContent = `${total} pattern${total === 1 ? '' : 's'} · showing ${start + 1}–${end}`;
    }
    this._updatePagingUI(pageCount, total);
    if (total === 0) {
      const empty = document.createElement('div');
      empty.className = 'pz-empty';
      empty.textContent = 'No patterns match the current filters.';
      this.gridEl.appendChild(empty);
      return;
    }
    // Only build cards for the current page — this is the big win for
    // large databases. Each card has its own canvas + simulator, so we
    // avoid creating hundreds/thousands of them at once.
    for (const p of pageSlice) {
      this._buildCard(p);
    }
    // Scroll grid back to top on page change.
    this.gridEl.scrollTop = 0;
  }
  _updatePagingUI(pageCount, total) {
    const indicator = this.overlay.querySelector('#pz-page-indicator');
    const firstBtn = this.overlay.querySelector('#pz-page-first');
    const prevBtn = this.overlay.querySelector('#pz-page-prev');
    const nextBtn = this.overlay.querySelector('#pz-page-next');
    const lastBtn = this.overlay.querySelector('#pz-page-last');
    const jumpBtn = this.overlay.querySelector('#pz-page-jump-btn');
    if (indicator) {
      indicator.textContent =
        total === 0 ? 'No results' : `Page ${this.currentPage + 1} / ${pageCount}`;
    }
    const atFirst = this.currentPage <= 0;
    const atLast = this.currentPage >= pageCount - 1;
    if (firstBtn) firstBtn.disabled = atFirst;
    if (prevBtn) prevBtn.disabled = atFirst;
    if (nextBtn) nextBtn.disabled = atLast;
    if (lastBtn) lastBtn.disabled = atLast;
    if (jumpBtn) jumpBtn.disabled = pageCount <= 1;
  }

  _buildCard(pattern) {
    const card = document.createElement('div');
    card.className = 'pz-card';
    if (pattern._isCustom) card.classList.add('pz-card-custom');
    card.dataset.id = pattern.id;
    const catLabel = this._categoryLabel(pattern.category);
    const periodLabel =
      pattern.period > 1 ? `p${pattern.period}` : pattern.period === 1 ? 'static' : '∞';
    const dirLabel = pattern.direction ? `→ ${pattern.direction}` : '';
    const customBadge = pattern._isCustom
      ? '<span class="pz-tag pz-tag-custom">★ CUSTOM</span>'
      : '';
    const linkBadge = pattern.link
      ? '<span class="pz-tag pz-tag-link" title="Has reference link" style="color:#66ccff;border-color:#66ccff;">🔗</span>'
      : '';
    // Characterization badges.
    let charBadges = '';
    if (pattern.extinct) {
      charBadges +=
        '<span class="pz-tag" title="Pattern dies out" style="color:#ff6666;border-color:#ff6666;">💀 extinct</span>';
    }
    if (pattern.unbounded) {
      charBadges +=
        '<span class="pz-tag" title="Grows without bound" style="color:#ff66ff;border-color:#ff66ff;">∞ unbounded</span>';
    }
    if (pattern.stabilizedAt != null && !pattern.extinct && !pattern.unbounded) {
      charBadges += `<span class="pz-tag" title="Stabilizes at generation ${pattern.stabilizedAt}" style="color:#88ff88;border-color:#88ff88;">⚖ gen ${pattern.stabilizedAt}</span>`;
    }
    card.innerHTML = `
          <div class="pz-card-canvas-wrap">
            <canvas class="pz-card-canvas" width="160" height="160"></canvas>
          </div>
          <div class="pz-card-meta">
            <div class="pz-card-name">${this._escape(pattern.name)}</div>
            <div class="pz-card-tags">
               ${customBadge}
              <span class="pz-tag pz-tag-cat pz-cat-${pattern.category}">${catLabel}</span>
              <span class="pz-tag pz-tag-period">${periodLabel}</span>
              ${dirLabel ? `<span class="pz-tag pz-tag-dir">${dirLabel}</span>` : ''}
               ${linkBadge}
               ${charBadges}
            </div>
            <div class="pz-card-size">${pattern.width}×${pattern.height} · ${pattern.cells.length} cells</div>
          </div>
          <div class="pz-card-actions">
            <button class="pz-card-btn pz-card-reset" title="Reset preview">↺</button>
            <button class="pz-card-btn pz-card-pause" title="Pause preview">⏸</button>
             ${pattern._isCustom ? '<button class="pz-card-btn pz-card-edit" title="Edit in pattern editor">✏ Edit</button>' : ''}
             ${pattern._isCustom ? '<button class="pz-card-btn pz-card-delete" title="Delete custom pattern">🗑</button>' : ''}
            ${this.game ? '<button class="pz-card-btn pz-card-place" title="Load into game pattern editor">⊕ Use</button>' : ''}
          </div>
        `;
    const canvas = card.querySelector('.pz-card-canvas');
    const cardGridSize = autoGridSize(pattern, PREVIEW_PADDING, PREVIEW_MIN_SIZE, PREVIEW_MAX_SIZE);
    const preview = new PatternPreview({
      pattern,
      canvas,
      gridSize: cardGridSize,
      speed: this.globalSpeed,
      rulesetId: this._getNativeRulesetFor(pattern),
      wrap: pattern.category !== CATEGORY.GUN,
    });
    if (this._allPaused) preview.setPaused(true);
    this.previews.push(preview);
    card._preview = preview;
    // Card click → detail view (but ignore clicks on action buttons).
    card.addEventListener('click', (e) => {
      if (e.target.closest('.pz-card-actions')) return;
      this._openDetail(pattern);
    });
    // Per-card buttons.
    card.querySelector('.pz-card-reset').addEventListener('click', (e) => {
      e.stopPropagation();
      preview.reset();
    });
    const pauseBtn = card.querySelector('.pz-card-pause');
    pauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      preview._paused = !preview._paused;
      pauseBtn.textContent = preview._paused ? '▶' : '⏸';
    });
    const placeBtn = card.querySelector('.pz-card-place');
    if (placeBtn) {
      placeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this._pickerMode) {
          this._finishPicker(pattern);
        } else {
          this._placeInGame(pattern);
        }
      });
    }
    const editBtn = card.querySelector('.pz-card-edit');
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openEditorForPattern(pattern);
      });
    }
    const delBtn = card.querySelector('.pz-card-delete');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._deleteCustomPattern(pattern);
      });
    }
    this.gridEl.appendChild(card);
  }

  _categoryLabel(cat) {
    const labels = {
      [CATEGORY.STILL_LIFE]: 'Still Life',
      [CATEGORY.OSCILLATOR]: 'Oscillator',
      [CATEGORY.SPACESHIP]: 'Spaceship',
      [CATEGORY.GUN]: 'Gun',
      [CATEGORY.METHUSELAH]: 'Methuselah',
      [CATEGORY.PUFFER]: 'Puffer',
      [CATEGORY.MISC]: 'Misc',
    };
    return labels[cat] || cat;
  }
  // Open the in-game pattern editor pre-loaded with a custom pattern.
  // The editor will be opened in "edit mode" so saving updates the existing
  // pattern rather than creating a new one.
  _openEditorForPattern(pattern) {
    if (!this.game || !this.game.drawTools) return;
    const dt = this.game.drawTools;
    // Load pattern cells into the editor.
    dt.loadPatternIntoEditor(
      pattern.cells,
      pattern._customName || null,
      pattern._isCustom ? 'edit' : 'view'
    );
    // Open the editor on top of the zoo. The editor has a higher z-index
    // than the zoo, so it will appear above. We intentionally keep the
    // zoo open so closing the editor returns the user to the zoo rather
    // than back to the game.
    dt._openEditorPanel();
  }
  _openEditorForNew() {
    if (!this.game || !this.game.drawTools) return;
    const dt = this.game.drawTools;
    dt.loadPatternIntoEditor([], null, 'new');
    dt._openEditorPanel();
  }
  _deleteCustomPattern(pattern) {
    if (!pattern._isCustom || !pattern._customName) return;
    if (!window.confirm(`Delete custom pattern "${pattern._customName}"?`)) return;
    if (this.game && this.game.patternCapture) {
      this.game.patternCapture.deleteSaved(pattern._customName);
      // _rebuildGrid will be triggered automatically via the change subscription.
    }
  }

  _escape(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c]
    );
  }

  _destroyPreviews() {
    for (const p of this.previews) p.destroy();
    this.previews = [];
    if (this.detailPreview) {
      this.detailPreview.destroy();
      this.detailPreview = null;
    }
  }

  // ── Detail view ──────────────────────────────────────────────────
  _openDetail(pattern) {
    this.detailEl.classList.remove('hidden');
    const compatRules = pattern.rulesets.includes('*')
      ? '<em>All rulesets</em>'
      : pattern.rulesets
          .map((rid) => {
            const def = getRuleset(rid);
            return def ? `${def.name} (${def.notation})` : rid;
          })
          .join(', ');
    const tagHtml =
      pattern.tags.length > 0
        ? pattern.tags.map((t) => `<span class="pz-tag">${this._escape(t)}</span>`).join(' ')
        : '<em>—</em>';
    const sourceHtml = pattern.source
      ? `<div class="pz-detail-row"><strong>Source:</strong> ${this._escape(pattern.source)}</div>`
      : '';
    // Author row (from RLE #O metadata).
    const authorHtml = pattern.author
      ? `<div class="pz-detail-row"><strong>Author:</strong> ${this._escape(pattern.author)}</div>`
      : '';
    // Characterization block — only render if we have at least one field.
    const hasCharacterization =
      pattern.maxBounds != null ||
      pattern.maxPopulation != null ||
      pattern.finalPopulation != null ||
      pattern.stabilizedAt != null ||
      pattern.extinct ||
      pattern.unbounded;
    let characterizationHtml = '';
    if (hasCharacterization) {
      const rows = [];
      if (pattern.maxBounds) {
        const mb = pattern.maxBounds;
        const w = mb.width === -1 ? '∞' : mb.width;
        const h = mb.height === -1 ? '∞' : mb.height;
        rows.push(`<div class="pz-detail-row"><strong>Max bounds:</strong> ${w} × ${h}</div>`);
      }
      if (pattern.maxPopulation != null) {
        rows.push(
          `<div class="pz-detail-row"><strong>Peak population:</strong> ${pattern.maxPopulation}</div>`
        );
      }
      if (pattern.finalPopulation != null) {
        rows.push(
          `<div class="pz-detail-row"><strong>Final population:</strong> ${pattern.finalPopulation}</div>`
        );
      }
      if (pattern.stabilizedAt != null) {
        rows.push(
          `<div class="pz-detail-row"><strong>Stabilized at:</strong> generation ${pattern.stabilizedAt}</div>`
        );
      }
      const flags = [];
      if (pattern.extinct) flags.push('<span style="color:#ff6666;">💀 extinct</span>');
      if (pattern.unbounded) flags.push('<span style="color:#ff66ff;">∞ unbounded growth</span>');
      if (flags.length > 0) {
        rows.push(
          `<div class="pz-detail-row"><strong>Behavior:</strong> ${flags.join(' · ')}</div>`
        );
      }
      characterizationHtml = `
           <div class="pz-detail-characterization" style="margin-top:12px;padding:10px;background:rgba(64,128,255,0.06);border:1px solid rgba(102,153,255,0.3);border-radius:4px;">
             <strong style="color:#88aaff;display:block;margin-bottom:6px;">📊 Characterization</strong>
             ${rows.join('')}
           </div>`;
    }
    // Link(s) — render as clickable anchors opening in a new tab.
    const renderLink = (url) => {
      const safe = this._escape(url);
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer"
               style="color:#66ccff;text-decoration:underline;word-break:break-all;">${safe}</a>`;
    };
    let linkHtml = '';
    if (pattern.link) {
      linkHtml = `<div class="pz-detail-row"><strong>Link:</strong> ${renderLink(pattern.link)}</div>`;
    }
    if (pattern.extraLinks && pattern.extraLinks.length > 0) {
      const extras = pattern.extraLinks.map(renderLink).join('<br>');
      linkHtml += `<div class="pz-detail-row"><strong>More:</strong> ${extras}</div>`;
    }
    const customControls = pattern._isCustom
      ? `<div class="pz-detail-custom-controls" style="margin-top:14px;padding:10px;background:rgba(255,204,68,0.08);border:1px solid #ffcc44;border-radius:4px;">
            <strong style="color:#ffcc44;">★ Custom Pattern</strong>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
              <button id="pz-detail-edit-custom" class="pz-tool-btn" style="color:#ffcc44;border-color:#ffcc44;">✏ Edit in Editor</button>
              <button id="pz-detail-delete-custom" class="pz-tool-btn" style="color:#ff6666;border-color:#ff6666;">🗑 Delete</button>
              <button id="pz-detail-rename-custom" class="pz-tool-btn">Rename</button>
            </div>
          </div>`
      : '';
    const detailRule = this._getNativeRulesetFor(pattern);
    const detailRuleDef = getRuleset(detailRule);
    const detailRuleLabel = detailRuleDef
      ? `${detailRuleDef.name} (${detailRuleDef.notation})`
      : detailRule;
    this.detailBodyEl.innerHTML = `
          <h2 class="pz-detail-title">${this._escape(pattern.name)}</h2>
          <div class="pz-detail-id">id: <code>${this._escape(pattern.id)}</code></div>
          <div class="pz-detail-layout">
            <div class="pz-detail-canvas-wrap">
              <canvas id="pz-detail-canvas" width="400" height="400"></canvas>
              <div class="pz-detail-controls">
                 <span style="color:#8080a0;font-size:11px;">
                   Previewed with <strong style="color:#00ffff;">${this._escape(detailRuleLabel)}</strong>
                 </span>
                <label>
                  Speed:
                  <input id="pz-detail-speed" type="range" min="0" max="300" step="1">
                  <span id="pz-detail-speed-label">10/s</span>
                </label>
                <button id="pz-detail-reset" class="pz-tool-btn">↺ Reset</button>
                <button id="pz-detail-pause" class="pz-tool-btn">⏸ Pause</button>
                <button id="pz-detail-step" class="pz-tool-btn">▷ Step</button>
                ${this.game ? '<button id="pz-detail-place" class="pz-tool-btn pz-detail-place-btn">⊕ Place in Game</button>' : ''}
              </div>
              <div class="pz-detail-stats">
                <span>Generation: <strong id="pz-detail-gen">0</strong></span>
                <span>Population: <strong id="pz-detail-pop">0</strong></span>
               ${pattern.category === CATEGORY.GUN ? '<span style="color:#ffaa44;font-size:10px;">⚠ Open boundary (no wrap)</span>' : ''}
              </div>
            </div>
            <div class="pz-detail-info">
              <div class="pz-detail-row"><strong>Category:</strong> ${this._categoryLabel(pattern.category)}</div>
              <div class="pz-detail-row"><strong>Period:</strong> ${pattern.period > 0 ? pattern.period : '∞ (chaotic)'}</div>
              ${pattern.direction ? `<div class="pz-detail-row"><strong>Direction:</strong> ${pattern.direction}</div>` : ''}
              <div class="pz-detail-row"><strong>Size:</strong> ${pattern.width} × ${pattern.height}</div>
              <div class="pz-detail-row"><strong>Cells:</strong> ${pattern.cells.length}</div>
              <div class="pz-detail-row"><strong>Rulesets:</strong> ${compatRules}</div>
             ${authorHtml}
              <div class="pz-detail-row"><strong>Tags:</strong> ${tagHtml}</div>
              ${sourceHtml}
             ${linkHtml}
              <div class="pz-detail-desc">${this._escape(pattern.description || '')}</div>
               ${characterizationHtml}
               ${customControls}
            </div>
          </div>
        `;
    const canvas = this.detailEl.querySelector('#pz-detail-canvas');
    // Detail preview state — grid auto-sized to fit the pattern with padding.
    const detailGrid = autoGridSize(pattern, DETAIL_PADDING, DETAIL_MIN_SIZE, DETAIL_MAX_SIZE);
    const detailSpeed = 10;
    this.detailPreview = new PatternPreview({
      pattern,
      canvas,
      gridSize: detailGrid,
      speed: detailSpeed,
      rulesetId: detailRule,
      wrap: pattern.category !== CATEGORY.GUN,
    });
    const speedSlider = this.detailEl.querySelector('#pz-detail-speed');
    const speedLabel = this.detailEl.querySelector('#pz-detail-speed-label');
    speedSlider.value = String(detailSpeed);
    speedLabel.textContent = `${detailSpeed}/s`;
    this._attachDragPause(speedSlider);
    speedSlider.addEventListener('input', () => {
      const v = parseInt(speedSlider.value, 10) || 0;
      this.detailPreview.setSpeed(v);
      speedLabel.textContent = v === 0 ? 'Paused' : `${v}/s`;
    });
    const resetBtn = this.detailEl.querySelector('#pz-detail-reset');
    resetBtn.addEventListener('click', () => this.detailPreview.reset());
    const pauseBtn = this.detailEl.querySelector('#pz-detail-pause');
    pauseBtn.addEventListener('click', () => {
      this.detailPreview._paused = !this.detailPreview._paused;
      pauseBtn.textContent = this.detailPreview._paused ? '▶ Resume' : '⏸ Pause';
    });
    const stepBtn = this.detailEl.querySelector('#pz-detail-step');
    stepBtn.addEventListener('click', () => {
      this.detailPreview.sim.tick();
      this.detailPreview.draw();
    });
    const placeBtn = this.detailEl.querySelector('#pz-detail-place');
    if (placeBtn) {
      placeBtn.addEventListener('click', () => {
        if (this._pickerMode) {
          this._finishPicker(pattern);
        } else {
          this._placeInGame(pattern);
        }
      });
    }
    // Wire custom-pattern controls.
    const editCustomBtn = this.detailEl.querySelector('#pz-detail-edit-custom');
    if (editCustomBtn) {
      editCustomBtn.addEventListener('click', () => {
        this._closeDetail();
        this._openEditorForPattern(pattern);
      });
    }
    const delCustomBtn = this.detailEl.querySelector('#pz-detail-delete-custom');
    if (delCustomBtn) {
      delCustomBtn.addEventListener('click', () => {
        this._deleteCustomPattern(pattern);
        this._closeDetail();
      });
    }
    const renameBtn = this.detailEl.querySelector('#pz-detail-rename-custom');
    if (renameBtn) {
      renameBtn.addEventListener('click', () => {
        const newName = window.prompt(`Rename "${pattern._customName}" to:`, pattern._customName);
        if (!newName || newName === pattern._customName) return;
        if (this.game && this.game.patternCapture) {
          const ok = this.game.patternCapture.renamePattern(pattern._customName, newName.trim());
          if (ok) {
            this._closeDetail();
          } else {
            window.alert(`Could not rename — "${newName}" may already exist.`);
          }
        }
      });
    }
    // Live stats update (uses our main rAF loop).
    this._detailPattern = pattern;
  }

  _closeDetail() {
    if (this.detailPreview) {
      this.detailPreview.destroy();
      this.detailPreview = null;
    }
    this._detailPattern = null;
    this.detailEl.classList.add('hidden');
    this.detailBodyEl.innerHTML = '';
  }

  // ── Place pattern into the running game ──────────────────────────
  _placeInGame(pattern) {
    if (!this.game) return;
    try {
      const input = this.game.input;
      const drawTools = this.game.drawTools;
      if (!input) {
        Logger.warn('[PatternZoo] No input manager — cannot place pattern.');
        return;
      }
      // Load the pattern into the input manager.
      input.setPattern(clonePatternCells(pattern.id) || pattern.cells);
      input.patternRotation = 0;
      input.patternFlipH = false;
      input.patternFlipV = false;
      // Switch to pattern mode (if drawTools is wired up).
      if (drawTools && drawTools.setMode) {
        drawTools.setMode('pattern');
        // Refresh the editor mini-canvas if visible.
        if (drawTools._drawEditor) {
          drawTools.editorCells.clear();
          const offsets = input.getPatternOffsets();
          const editorSize = drawTools.editorSize || 16;
          let pw = 0,
            ph = 0;
          for (const [x, y] of offsets) {
            if (x + 1 > pw) pw = x + 1;
            if (y + 1 > ph) ph = y + 1;
          }
          const offX = Math.floor((editorSize - pw) / 2);
          const offY = Math.floor((editorSize - ph) / 2);
          for (const [x, y] of offsets) {
            const px = x + offX;
            const py = y + offY;
            if (px >= 0 && px < editorSize && py >= 0 && py < editorSize) {
              drawTools.editorCells.add(`${px},${py}`);
            }
          }
          drawTools._activePresetName = pattern.id;
          drawTools._editorDirty = false;
          if (drawTools._syncPresetCombobox) drawTools._syncPresetCombobox();
          drawTools._drawEditor();
        }
      }
      // Visual confirmation.
      if (this.game.renderer && this.game.grid) {
        this.game.renderer.addBigFloater(
          Math.floor(this.game.grid.width / 2),
          Math.floor(this.game.grid.height / 3),
          `⊕ LOADED: ${pattern.name}`,
          '#00ffcc',
          1.5
        );
      }
      Logger.info(`[PatternZoo] Loaded pattern "${pattern.id}" into input.`);
      this.hide();
    } catch (e) {
      Logger.error('[PatternZoo] Failed to place pattern:', e);
    }
  }

  // ── Animation loop ───────────────────────────────────────────────
  _startLoop() {
    this._lastFrameTs = performance.now();
    const loop = (ts) => {
      if (!this.visible) return;
      const dt = ts - this._lastFrameTs;
      this._lastFrameTs = ts;
      for (const p of this.previews) p.update(dt);
      if (this.detailPreview) {
        this.detailPreview.update(dt);
        this._updateDetailStats();
      }
      this._rafHandle = requestAnimationFrame(loop);
    };
    this._rafHandle = requestAnimationFrame(loop);
  }

  _stopLoop() {
    if (this._rafHandle) {
      cancelAnimationFrame(this._rafHandle);
      this._rafHandle = null;
    }
  }

  _updateDetailStats() {
    if (!this.detailPreview) return;
    const genEl = this.detailEl.querySelector('#pz-detail-gen');
    const popEl = this.detailEl.querySelector('#pz-detail-pop');
    if (genEl) genEl.textContent = String(this.detailPreview.sim.generation);
    if (popEl) popEl.textContent = String(this.detailPreview.sim.population());
  }
}
