import { CONFIG } from './config.js';
import { Logger } from './logger.js';
import { listPatterns, clonePatternCells, CATEGORY } from './patterns/index.js';
import { listRulesets, getRuleset, CompiledRuleset, CONWAY } from './rules/ruleset.js';
import './rules/extraRulesets.js';

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
    // Toroidal wrap in both axes.
    for (let y = 0; y < h; y++) {
      const yUp = (y - 1 + h) % h;
      const yDn = (y + 1) % h;
      for (let x = 0; x < w; x++) {
        const xLt = (x - 1 + w) % w;
        const xRt = (x + 1) % w;
        const n =
          cells[yUp * w + xLt] +
          cells[yUp * w + x] +
          cells[yUp * w + xRt] +
          cells[y * w + xLt] +
          cells[y * w + xRt] +
          cells[yDn * w + xLt] +
          cells[yDn * w + x] +
          cells[yDn * w + xRt];
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
  constructor({ pattern, canvas, gridSize, speed, rulesetId }) {
    this.pattern = pattern;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.gridSize = gridSize;
    this.speed = speed; // ticks per second
    this.rulesetId = rulesetId;
    this.sim = new ToroidalLifeSim(gridSize, gridSize, this._compileRule());
    this.sim.stampCentered(pattern.cells);
    this._accumMs = 0;
    this._paused = false;
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
    this.reset();
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
    if (this._paused || this.speed <= 0) return;
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
    ctx.shadowBlur = Math.max(2, cs * 0.4);
    const cells = this.sim.cells;
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        if (cells[y * this.gridSize + x]) {
          ctx.fillRect(x * cs + 1, y * cs + 1, cs - 2, cs - 2);
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
  gridSize: 20,
  speed: 10,
  rulesetId: 'conway',
};

export class PatternZoo {
  constructor({ game } = {}) {
    this.game = game;
    this.visible = false;
    this.previews = []; // active PatternPreview instances
    this.detailPreview = null;
    this.filterCategory = 'all';
    this.filterRuleset = 'all';
    this.filterTag = 'all';
    this.searchQuery = '';
    // Per-card defaults (user-adjustable globally).
    this.globalGridSize = ZOO_DEFAULTS.gridSize;
    this.globalSpeed = ZOO_DEFAULTS.speed;
    // Default the zoo preview ruleset to the currently active in-game ruleset.
    this.globalRuleset = CONFIG.ACTIVE_RULESET || ZOO_DEFAULTS.rulesetId;
    this._stashedSpeed = null;
    this._lastFrameTs = 0;
    this._rafHandle = null;
    this._buildDom();
    this._wireGlobalControls();
    this._bindGlobalKeys();
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
                  Category:
                  <select id="pz-filter-category" class="pz-select"></select>
                </label>
                <label>
                  Ruleset filter:
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
                  Preview ruleset:
                  <select id="pz-global-ruleset" class="pz-select"></select>
                </label>
                <label>
                  Grid size:
                  <input id="pz-global-grid" type="range" min="8" max="48" step="1"
                    style="width:120px;accent-color:#00ffff;vertical-align:middle;">
                  <span id="pz-global-grid-label" style="color:#00ffff;font-weight:bold;
                        min-width:32px;display:inline-block;">20</span>
                </label>
                <label>
                  Speed:
                  <input id="pz-global-speed" type="range" min="0" max="40" step="1"
                    style="width:120px;accent-color:#00ffff;vertical-align:middle;">
                  <span id="pz-global-speed-label" style="color:#00ffff;font-weight:bold;
                        min-width:48px;display:inline-block;">10/s</span>
                </label>
                <button id="pz-pause-all" class="pz-tool-btn">⏸ Pause All</button>
                <button id="pz-reset-all" class="pz-tool-btn">↺ Reset All</button>
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
    // Click outside content closes detail (but not the zoo).
    this.detailEl.addEventListener('click', (e) => {
      if (e.target === this.detailEl) this._closeDetail();
    });
    // Populate selects.
    this._populateFilters();
    this._populateGlobalRuleset();
  }

  _populateFilters() {
    const catSel = this.overlay.querySelector('#pz-filter-category');
    const ruleSel = this.overlay.querySelector('#pz-filter-ruleset');
    const tagSel = this.overlay.querySelector('#pz-filter-tag');
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
    for (const p of listPatterns()) {
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
      this.searchQuery = searchEl.value.trim().toLowerCase();
      this._rebuildGrid();
    });
    catSel.addEventListener('change', () => {
      this.filterCategory = catSel.value;
      this._rebuildGrid();
    });
    ruleSel.addEventListener('change', () => {
      this.filterRuleset = ruleSel.value;
      this._rebuildGrid();
    });
    tagSel.addEventListener('change', () => {
      this.filterTag = tagSel.value;
      this._rebuildGrid();
    });
  }

  _populateGlobalRuleset() {
    const sel = this.overlay.querySelector('#pz-global-ruleset');
    sel.innerHTML = '';
    for (const def of listRulesets()) {
      const opt = document.createElement('option');
      opt.value = def.id;
      opt.textContent = `${def.name} (${def.notation})`;
      sel.appendChild(opt);
    }
    sel.value = this.globalRuleset;
  }

  _wireGlobalControls() {
    const gridSlider = this.overlay.querySelector('#pz-global-grid');
    const gridLabel = this.overlay.querySelector('#pz-global-grid-label');
    const speedSlider = this.overlay.querySelector('#pz-global-speed');
    const speedLabel = this.overlay.querySelector('#pz-global-speed-label');
    const ruleSel = this.overlay.querySelector('#pz-global-ruleset');
    const pauseBtn = this.overlay.querySelector('#pz-pause-all');
    const resetBtn = this.overlay.querySelector('#pz-reset-all');
    gridSlider.value = String(this.globalGridSize);
    gridLabel.textContent = String(this.globalGridSize);
    speedSlider.value = String(this.globalSpeed);
    speedLabel.textContent = `${this.globalSpeed}/s`;
    gridSlider.addEventListener('input', () => {
      this.globalGridSize = parseInt(gridSlider.value, 10) || 20;
      gridLabel.textContent = String(this.globalGridSize);
      for (const p of this.previews) p.setGridSize(this.globalGridSize);
    });
    speedSlider.addEventListener('input', () => {
      this.globalSpeed = parseInt(speedSlider.value, 10) || 10;
      speedLabel.textContent = this.globalSpeed === 0 ? 'Paused' : `${this.globalSpeed}/s`;
      for (const p of this.previews) p.setSpeed(this.globalSpeed);
    });
    ruleSel.addEventListener('change', () => {
      this.globalRuleset = ruleSel.value;
      for (const p of this.previews) p.setRuleset(this.globalRuleset);
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
    });
  }

  // ── Show / hide ──────────────────────────────────────────────────
  show() {
    if (this.visible) return;
    this.visible = true;
    // Sync preview ruleset to current game ruleset.
    this.globalRuleset = CONFIG.ACTIVE_RULESET || this.globalRuleset;
    this._populateGlobalRuleset();
    for (const p of this.previews) p.setRuleset(this.globalRuleset);
    // Pause game.
    if (this.game) {
      this._stashedSpeed = CONFIG.SPEED_MULTIPLIER;
      CONFIG.SPEED_MULTIPLIER = 0;
      const lbl = document.getElementById('speed-label');
      if (lbl) lbl.textContent = 'PAUSED (zoo)';
    }
    this.overlay.classList.remove('hidden');
    this.overlay.removeAttribute('aria-hidden');
    this._rebuildGrid();
    this._startLoop();
  }

  hide() {
    if (!this.visible) return;
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
  _filteredPatterns() {
    let out = listPatterns();
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
    return out;
  }

  _rebuildGrid() {
    this._destroyPreviews();
    this.gridEl.innerHTML = '';
    const patterns = this._filteredPatterns();
    this.resultCountEl.textContent = `${patterns.length} pattern${patterns.length === 1 ? '' : 's'}`;
    if (patterns.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'pz-empty';
      empty.textContent = 'No patterns match the current filters.';
      this.gridEl.appendChild(empty);
      return;
    }
    for (const p of patterns) {
      this._buildCard(p);
    }
  }

  _buildCard(pattern) {
    const card = document.createElement('div');
    card.className = 'pz-card';
    card.dataset.id = pattern.id;
    const catLabel = this._categoryLabel(pattern.category);
    const periodLabel =
      pattern.period > 1 ? `p${pattern.period}` : pattern.period === 1 ? 'static' : '∞';
    const dirLabel = pattern.direction ? `→ ${pattern.direction}` : '';
    card.innerHTML = `
          <div class="pz-card-canvas-wrap">
            <canvas class="pz-card-canvas" width="160" height="160"></canvas>
          </div>
          <div class="pz-card-meta">
            <div class="pz-card-name">${this._escape(pattern.name)}</div>
            <div class="pz-card-tags">
              <span class="pz-tag pz-tag-cat pz-cat-${pattern.category}">${catLabel}</span>
              <span class="pz-tag pz-tag-period">${periodLabel}</span>
              ${dirLabel ? `<span class="pz-tag pz-tag-dir">${dirLabel}</span>` : ''}
            </div>
            <div class="pz-card-size">${pattern.width}×${pattern.height} · ${pattern.cells.length} cells</div>
          </div>
          <div class="pz-card-actions">
            <button class="pz-card-btn pz-card-reset" title="Reset preview">↺</button>
            <button class="pz-card-btn pz-card-pause" title="Pause preview">⏸</button>
            ${this.game ? '<button class="pz-card-btn pz-card-place" title="Load into game pattern editor">⊕ Use</button>' : ''}
          </div>
        `;
    const canvas = card.querySelector('.pz-card-canvas');
    const preview = new PatternPreview({
      pattern,
      canvas,
      gridSize: this.globalGridSize,
      speed: this.globalSpeed,
      rulesetId: this.globalRuleset,
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
        this._placeInGame(pattern);
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
    this.detailBodyEl.innerHTML = `
          <h2 class="pz-detail-title">${this._escape(pattern.name)}</h2>
          <div class="pz-detail-id">id: <code>${this._escape(pattern.id)}</code></div>
          <div class="pz-detail-layout">
            <div class="pz-detail-canvas-wrap">
              <canvas id="pz-detail-canvas" width="400" height="400"></canvas>
              <div class="pz-detail-controls">
                <label>
                  Ruleset:
                  <select id="pz-detail-ruleset" class="pz-select"></select>
                </label>
                <label>
                  Grid:
                  <input id="pz-detail-grid" type="range" min="10" max="80" step="1">
                  <span id="pz-detail-grid-label">30</span>
                </label>
                <label>
                  Speed:
                  <input id="pz-detail-speed" type="range" min="0" max="60" step="1">
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
              </div>
            </div>
            <div class="pz-detail-info">
              <div class="pz-detail-row"><strong>Category:</strong> ${this._categoryLabel(pattern.category)}</div>
              <div class="pz-detail-row"><strong>Period:</strong> ${pattern.period > 0 ? pattern.period : '∞ (chaotic)'}</div>
              ${pattern.direction ? `<div class="pz-detail-row"><strong>Direction:</strong> ${pattern.direction}</div>` : ''}
              <div class="pz-detail-row"><strong>Size:</strong> ${pattern.width} × ${pattern.height}</div>
              <div class="pz-detail-row"><strong>Cells:</strong> ${pattern.cells.length}</div>
              <div class="pz-detail-row"><strong>Rulesets:</strong> ${compatRules}</div>
              <div class="pz-detail-row"><strong>Tags:</strong> ${tagHtml}</div>
              ${sourceHtml}
              <div class="pz-detail-desc">${this._escape(pattern.description || '')}</div>
            </div>
          </div>
        `;
    const canvas = this.detailEl.querySelector('#pz-detail-canvas');
    // Detail preview state (independent of card defaults).
    const detailGrid = 30;
    const detailSpeed = 10;
    const detailRule = this.globalRuleset;
    this.detailPreview = new PatternPreview({
      pattern,
      canvas,
      gridSize: detailGrid,
      speed: detailSpeed,
      rulesetId: detailRule,
    });
    // Wire detail controls.
    const ruleSel = this.detailEl.querySelector('#pz-detail-ruleset');
    for (const def of listRulesets()) {
      const opt = document.createElement('option');
      opt.value = def.id;
      opt.textContent = `${def.name} (${def.notation})`;
      ruleSel.appendChild(opt);
    }
    ruleSel.value = detailRule;
    ruleSel.addEventListener('change', () => {
      this.detailPreview.setRuleset(ruleSel.value);
    });
    const gridSlider = this.detailEl.querySelector('#pz-detail-grid');
    const gridLabel = this.detailEl.querySelector('#pz-detail-grid-label');
    gridSlider.value = String(detailGrid);
    gridLabel.textContent = String(detailGrid);
    gridSlider.addEventListener('input', () => {
      const n = parseInt(gridSlider.value, 10) || 30;
      this.detailPreview.setGridSize(n);
      gridLabel.textContent = String(n);
    });
    const speedSlider = this.detailEl.querySelector('#pz-detail-speed');
    const speedLabel = this.detailEl.querySelector('#pz-detail-speed-label');
    speedSlider.value = String(detailSpeed);
    speedLabel.textContent = `${detailSpeed}/s`;
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
      placeBtn.addEventListener('click', () => this._placeInGame(pattern));
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
