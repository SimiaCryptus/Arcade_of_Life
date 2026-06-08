import { CONFIG } from './config.js';
import { Logger } from './logger.js';
import {
  listLevels,
  saveLevel,
  deleteLevel,
  getLevel,
  onLevelsChanged,
  importLevelJSON,
} from './levels.js';
import { listRulesets, getRuleset, getNeighborhood } from './rules/index.js';
import { getTopology } from './topology.js';
import { listPatterns } from './patterns/index.js';
import { SETTING_DEFS, BOOLEAN_SETTING_DEFS } from './settings.js';

/**
 * LevelDesigner: full-screen overlay for crafting custom scenarios.
 *
 * Modes:
 *   - 'city'    : place city blocks
 *   - 'defense' : paint pre-built defense cells
 *   - 'base'    : place enemy base markers (fortress/bunker/cruiser)
 *   - 'erase'   : remove anything under cursor
 *
 * The designer renders its own canvas (independent of the live game)
 * showing the work-in-progress level. On save, it serializes to the
 * levels store and (optionally) launches the game in that level.
 */

const DESIGNER_MODE = {
  CITY: 'city',
  DEFENSE: 'defense',
  BASE: 'base',
  PATTERN: 'pattern',
  SPAWNER: 'spawner',
  LINE: 'line',
  FILL: 'fill',
};

export class LevelDesigner {
  constructor({ game } = {}) {
    this.game = game;
    this.visible = false;
    this.mode = DESIGNER_MODE.DEFENSE;
    this.baseKind = 'fortress';
    this.brushSize = 1;
    // Line mode style options.
    this.lineWidth = 1;
    this.dashPattern = 'solid';
    // Fill mode options.
    this.fillPattern = 'solid';
    // Line drawing state.
    this._lineStart = null;
    this._linePreview = null;
    // Fill drawing state.
    this._fillStart = null;
    this._fillPreview = null;
    // Hover position for previews (in grid coords).
    this._hoverCell = null;
    // Designer grid state — independent of live game grid.
    this.gridWidth = 120;
    this.gridHeight = 80;
    this.cellSize = 6;
    // Current topology id ('square' | 'hex' | 'tri'), derived from
    // the selected ruleset's neighborhood.
    this.topologyId = 'square';
    this.cities = []; // {x, y, width, height}
    this.defenseCells = new Set(); // "x,y" keys
    this.enemyCells = new Set(); // "x,y" keys — enemy-aligned living cells
    this.barrierCells = new Set(); // "x,y" keys — static barrier tiles
    this.fireCells = new Set(); // "x,y" keys — static fire tiles
    // Paint target for freehand / line / fill tools.
    // 'defense' paints into defenseCells; 'barrier' paints into
    // barrierCells; 'fire' paints into fireCells; 'enemy' paints into
    // enemyCells; 'erase' removes anything under the brush.
    this.paintTarget = 'defense';
    // Wrap settings.
    this.wrapVerticalShift = 0;
    // Bases from the zoo. Each entry is
    // {patternId, x, y, cells:[[dx,dy],...], width, height, name}.
    this.bases = [];
    // Missile spawn points (also zoo-sourced patterns). Each entry is
    // {patternId, x, y, cells, width, height, name, interval?}.
    this.spawners = [];
    // Currently-selected stamp pattern for the PATTERN tool.
    // {id, cells, width, height, name} or null.
    this._stampPattern = null;
    // Currently-selected base pattern for the BASE tool.
    this._basePattern = null;
    // Currently-selected spawner pattern for the SPAWNER tool.
    this._spawnerPattern = null;
    // Currently-selected city pattern (visual only — game logic still
    // treats cities as rectangular blocks for purposes of "city cell"
    // detection by the simulation).
    this._cityPattern = null;
    this.currentLevelName = null;
    this.ruleset = 'conway';
    this.description = '';
    this._stashedSpeed = null;
    this._isDragging = false;
    // Enemy ruleset for asymmetric levels. null = symmetric with this.ruleset.
    this.enemyRuleset = null;
    // Tool enable/disable state for this level. Maps DRAW_MODE id → bool.
    this.allowedTools = {
      freehand: true,
      line: true,
      pattern: true,
      fill: true,
    };
    // Allowed pattern preset ids (from the zoo). Empty Set = allow all.
    this.allowedPatterns = new Set();
    // Color theme overrides. Empty object = use defaults.
    this.colorTheme = {};
    // Full settings snapshot for this level. Initialized from CONFIG.
    this.levelSettings = this._captureCurrentSettings();
    this._buildDom();
    this._wireEvents();
    // Refresh level list when storage changes.
    this._unsubLevels = onLevelsChanged(() => {
      if (this.visible) this._refreshLevelList();
    });
  }

  // ── DOM construction ──────────────────────────────────────────
  _buildDom() {
    const overlay = document.createElement('div');
    overlay.id = 'level-designer-overlay';
    overlay.className = 'overlay hidden';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
          <div id="level-designer-content">
            <div id="ld-header">
              <h1 id="ld-title">🛠 Level Designer</h1>
              <p id="ld-subtitle">Craft custom scenarios — place cities, defenses, and enemy bases.</p>
            </div>
            <div id="ld-tabs">
              <button class="ld-tab active" data-tab="map">🗺 Map</button>
              <button class="ld-tab" data-tab="tools">🛠 Tools & Patterns</button>
              <button class="ld-tab" data-tab="theme">🎨 Color Theme</button>
              <button class="ld-tab" data-tab="settings">⚙ Settings</button>
            </div>
            <div id="ld-tab-map" class="ld-tab-panel active">
            <div id="ld-toolbar">
              <div class="ld-tool-group">
                <label>Tool:</label>
                 <button class="ld-mode-btn active" data-mode="defense" title="Paint cells (defense or barrier — choose below)">✏ Draw</button>
                 <button class="ld-mode-btn" data-mode="line" title="Straight line">📏 Line</button>
                 <button class="ld-mode-btn" data-mode="fill" title="Region fill">🪣 Fill</button>
                  <button class="ld-mode-btn" data-mode="pattern" title="Stamp pattern from Zoo (uses selected ink type)">🧬 Pattern</button>
                  <button class="ld-mode-btn" data-mode="city" title="Place city">🏙 City</button>
                  <button class="ld-mode-btn" data-mode="base" title="Stamp pattern from Zoo as enemy base">⚔ Base</button>
                  <button class="ld-mode-btn" data-mode="spawner" title="Place missile spawn point (pattern from Zoo)">🚀 Spawner</button>
               </div>
                <div class="ld-tool-group" id="ld-paint-target-group">
                 <label>Ink:</label>
                 <div class="ld-target-switch">
                   <button class="ld-target-btn active" data-target="defense" title="Paint living defense cells (cyan) — follow the cellular automaton rules">
                     <span class="ld-target-icon">✏</span>
                     <span class="ld-target-label">
                       <span class="ld-target-name">Defense</span>
                       <span class="ld-target-desc">Living cells</span>
                     </span>
                   </button>
                    <button class="ld-target-btn" data-target="enemy" title="Paint enemy-aligned living cells (red) — follow the enemy ruleset">
                      <span class="ld-target-icon">☠</span>
                      <span class="ld-target-label">
                        <span class="ld-target-name">Enemy</span>
                        <span class="ld-target-desc">Hostile cells</span>
                      </span>
                    </button>
                   <button class="ld-target-btn" data-target="barrier" title="Paint static barrier tiles (gray) — never change, block missiles, partition the board">
                     <span class="ld-target-icon">🧱</span>
                     <span class="ld-target-label">
                       <span class="ld-target-name">Barrier</span>
                       <span class="ld-target-desc">Static walls</span>
                     </span>
                   </button>
                  <button class="ld-target-btn" data-target="fire" title="Paint static FIRE tiles (orange) — never change, destroy missiles, act as live neighbors for Life rules">
                    <span class="ld-target-icon">🔥</span>
                    <span class="ld-target-label">
                      <span class="ld-target-name">Fire</span>
                      <span class="ld-target-desc">Active static</span>
                    </span>
                  </button>
                   <button class="ld-target-btn" data-target="erase" title="Erase — remove any cells, barriers, fire, cities, bases, and spawners under the brush">
                     <span class="ld-target-icon">🧹</span>
                     <span class="ld-target-label">
                       <span class="ld-target-name">Erase</span>
                       <span class="ld-target-desc">Remove all</span>
                     </span>
                   </button>
                 </div>
               </div>
               <div class="ld-tool-group" id="ld-pattern-selector" style="display:none;">
                 <label>Stamp:</label>
                 <span id="ld-pattern-name" style="color:#00ffcc;font-weight:bold;min-width:120px;display:inline-block;">— none —</span>
                 <button id="ld-pick-pattern-btn" class="ld-btn">🦓 Pick from Zoo</button>
                 <button id="ld-rotate-pattern-btn" class="ld-btn" title="Rotate 90° CW">↻</button>
                 <button id="ld-flip-pattern-btn" class="ld-btn" title="Flip horizontally">⇋</button>
               </div>
                <div class="ld-tool-group" id="ld-base-selector" style="display:none;">
                  <label>Base:</label>
                  <span id="ld-base-name" style="color:#ff8888;font-weight:bold;min-width:120px;display:inline-block;">— none —</span>
                  <button id="ld-pick-base-btn" class="ld-btn">🦓 Pick from Zoo</button>
                  <button id="ld-rotate-base-btn" class="ld-btn" title="Rotate 90° CW">↻</button>
                  <button id="ld-flip-base-btn" class="ld-btn" title="Flip horizontally">⇋</button>
                </div>
                <div class="ld-tool-group" id="ld-spawner-selector" style="display:none;">
                  <label>Spawner:</label>
                  <span id="ld-spawner-name" style="color:#ffaa66;font-weight:bold;min-width:120px;display:inline-block;">— none —</span>
                  <button id="ld-pick-spawner-btn" class="ld-btn">🦓 Pick from Zoo</button>
                  <button id="ld-rotate-spawner-btn" class="ld-btn" title="Rotate 90° CW">↻</button>
                  <button id="ld-flip-spawner-btn" class="ld-btn" title="Flip horizontally">⇋</button>
                </div>
                <div class="ld-tool-group" id="ld-city-selector" style="display:none;">
                  <label>City:</label>
                  <span id="ld-city-name" style="color:#ffff88;font-weight:bold;min-width:120px;display:inline-block;">— default block —</span>
                  <button id="ld-pick-city-btn" class="ld-btn">🦓 Pick from Zoo</button>
                  <button id="ld-clear-city-btn" class="ld-btn" title="Reset to default rectangular city">↺ Default</button>
                </div>
                <div class="ld-tool-group" id="ld-line-tools" style="display:none;">
                  <label>Width:</label>
                  <input id="ld-line-width" type="range" min="1" max="8" step="1" value="1" />
                  <span id="ld-line-width-label">1</span>
                  <label>Dash:</label>
                  <select id="ld-line-dash">
                    <option value="solid">Solid</option>
                    <option value="dashed">Dashed</option>
                    <option value="dotted">Dotted</option>
                    <option value="sparse">Sparse</option>
                  </select>
                </div>
                <div class="ld-tool-group" id="ld-fill-tools" style="display:none;">
                  <label>Fill:</label>
                  <select id="ld-fill-pattern">
                    <option value="solid">Solid</option>
                    <option value="checker">Checker</option>
                    <option value="stripes_h">Stripes (h)</option>
                    <option value="stripes_v">Stripes (v)</option>
                    <option value="diagonal">Diagonal</option>
                    <option value="dots_sparse">Dots (sparse)</option>
                    <option value="dots_dense">Dots (dense)</option>
                    <option value="grid">Grid</option>
                    <option value="cross">Cross</option>
                    <option value="random50">Random 50%</option>
                    <option value="random25">Random 25%</option>
                  </select>
               </div>
              <div class="ld-tool-group">
                <label>Brush:</label>
                <input id="ld-brush-size" type="range" min="1" max="8" step="1" value="1" />
                <span id="ld-brush-label">1</span>
              </div>
              <div class="ld-tool-group">
                <label>Grid:</label>
                <input id="ld-grid-w" type="number" min="60" max="400" step="10" value="120" title="Width" />
                <span>×</span>
                <input id="ld-grid-h" type="number" min="40" max="300" step="10" value="80" title="Height" />
                <button id="ld-resize-btn" class="ld-btn">Resize</button>
              </div>
              <div class="ld-tool-group">
                <button id="ld-clear-btn" class="ld-btn ld-btn-danger">Clear All</button>
              </div>
            </div>
            <div id="ld-main">
              <div id="ld-canvas-wrap">
                <canvas id="ld-canvas"></canvas>
              </div>
              <div id="ld-sidebar">
                <div class="ld-section">
                  <h3>📝 Metadata</h3>
                  <label>Name: <input id="ld-name" type="text" maxlength="40" placeholder="my level" /></label>
                  <label>Description:
                    <textarea id="ld-desc" rows="3" maxlength="200" placeholder="A custom scenario..."></textarea>
                  </label>
                  <label>Ruleset: <select id="ld-ruleset"></select></label>
                  <p id="ld-ruleset-desc" style="font-size:11px;color:#a0a0c0;font-style:italic;margin:4px 0 0;"></p>
                    <label>Enemy Ruleset:
                      <select id="ld-enemy-ruleset" title="Optional: separate ruleset for enemy missile cells (empty = symmetric with defender)"></select>
                    </label>
                    <p id="ld-enemy-ruleset-desc" style="font-size:11px;color:#ff8888;font-style:italic;margin:4px 0 0;">
                      When set, enemy missile cells evolve under this ruleset while defenses use the ruleset above.
                    </p>
                </div>
                <div class="ld-section">
                  <h3>🔄 Toroidal Wrap</h3>
                  <p style="font-size:11px;color:#a0a0c0;font-style:italic;margin:0 0 6px;">
                    Vertical shift applied when patterns wrap around the east/west edges. 
                    Set to 0 for a normal torus. Positive values offset wrapping cells downward,
                    negative upward. Useful for Klein-bottle-like topologies.
                  </p>
                  <label>Wrap Vertical Shift (cells):
                    <input id="ld-wrap-shift" type="number" min="-100" max="100" step="1" value="0" />
                  </label>
                </div>
                <div class="ld-section">
                  <h3>ℹ Spawning</h3>
                  <p style="font-size:11px;color:#a0a0c0;font-style:italic;margin:0;">
                    Place 🚀 Spawner markers on the map to define where missiles emit. 
                    Each spawner can use any pattern from the Pattern Zoo. Spawning
                    is fully driven by placed spawners — there are no default waves.
                  </p>
                  <div style="margin-top:8px;">
                    <label>Default interval (ms):
                      <input id="ld-spawner-interval" type="number" min="100" max="60000" step="100" value="2000" />
                    </label>
                    <label>Default emit limit (0 = ∞):
                      <input id="ld-spawner-emit-limit" type="number" min="0" max="9999" step="1" value="0" />
                    </label>
                    <label>Default initial delay (ms):
                      <input id="ld-spawner-initial-delay" type="number" min="0" max="60000" step="100" value="2000" />
                    </label>
                    <label title="Halo cells around spawn footprint that must be clear before next emission. Larger patterns (e.g. copperhead) need more clearance to avoid collisions with previous emissions.">Default padding (halo cells):
                      <input id="ld-spawner-padding" type="number" min="0" max="20" step="1" value="1" />
                    </label>
                    <p style="font-size:10px;color:#888;margin:4px 0 0;">
                      These values are applied to new spawners as you place them.
                      Existing spawners keep their original config.
                    </p>
                    <button id="ld-apply-spawner-defaults" class="ld-btn" style="margin-top:4px;">
                      Apply to All Existing Spawners
                    </button>
                  </div>
                </div>
                <div class="ld-section">
                  <h3>📊 Stats</h3>
                  <div class="ld-stats">
                    <div>Cities: <strong id="ld-stat-cities">0</strong></div>
                    <div>City cells: <strong id="ld-stat-city-cells">0</strong></div>
                    <div>Defense cells: <strong id="ld-stat-defense">0</strong></div>
                     <div>Enemy cells: <strong id="ld-stat-enemy">0</strong></div>
                     <div>Barriers: <strong id="ld-stat-barriers">0</strong></div>
                      <div>Fire: <strong id="ld-stat-fire">0</strong></div>
                    <div>Bases: <strong id="ld-stat-bases">0</strong></div>
                    <div>Spawners: <strong id="ld-stat-spawners">0</strong></div>
                     <div>Base cells: <strong id="ld-stat-enemy-cells">0</strong></div>
                  </div>
                  <div class="ld-thresholds-hint" style="margin-top:8px;font-size:11px;color:#a0a0c0;font-style:italic;">
                    Victory triggers when enemy cells ≤ <strong id="ld-stat-victory-thresh">0</strong>.<br>
                    Defeat triggers when city cells ≤ <strong id="ld-stat-defeat-thresh">0</strong>.
                  </div>
                </div>
                <div class="ld-section">
                  <h3>💾 Saved Levels</h3>
                  <select id="ld-level-select" size="6"></select>
                  <div class="ld-button-row">
                    <button id="ld-load-btn" class="ld-btn">Load</button>
                    <button id="ld-delete-btn" class="ld-btn ld-btn-danger">Delete</button>
                  </div>
                </div>
              </div>
            </div>
            </div>
            <div id="ld-tab-tools" class="ld-tab-panel">
              <div id="ld-tools-panel">
                <p class="ld-settings-intro">
                  Configure which drawing tools and patterns are available to the
                  player during this level. Useful for tutorials or challenges.
                </p>
                <div class="setting-section-header">Allowed Drawing Tools</div>
                <div id="ld-tool-toggle-list" class="ld-tool-toggle-list"></div>
                <div class="setting-section-header">Allowed Patterns</div>
                <p class="ld-settings-intro">
                  Select which patterns appear in the Pattern tool's preset dropdown.
                  Leave all unchecked to allow every pattern. Custom patterns are
                  always allowed.
                </p>
                <div class="ld-pattern-controls">
                  <button id="ld-pattern-allow-all" class="ld-btn">Allow All</button>
                  <button id="ld-pattern-allow-none" class="ld-btn">Clear Selection</button>
                  <input id="ld-pattern-filter" type="text" placeholder="filter by name..." />
                </div>
                <div id="ld-pattern-allow-list" class="ld-pattern-allow-list"></div>
              </div>
            </div>
            <div id="ld-tab-theme" class="ld-tab-panel">
              <div id="ld-theme-panel">
                <p class="ld-settings-intro">
                  Customize the visual theme of this level. Leave a field blank
                  (clear it) to use the default. Colors accept any valid CSS
                  color (hex like <code>#00ff88</code>, names like <code>cyan</code>,
                  or <code>rgba(...)</code>).
                </p>
                <div class="ld-settings-actions">
                  <button id="ld-theme-reset" class="ld-btn ld-btn-danger">↺ Reset Theme</button>
                  <button id="ld-theme-randomize" class="ld-btn" style="color:#ff80ff;border-color:#ff80ff;">🎲 Randomize</button>
                  <button id="ld-theme-preview" class="ld-btn">👁 Live Preview</button>
                </div>
                <div id="ld-theme-list"></div>
              </div>
            </div>
            <div id="ld-tab-settings" class="ld-tab-panel">
              <div id="ld-settings-panel">
                <p class="ld-settings-intro">
                  These settings override the global game configuration when this level is played.
                  All values are captured into the level file and applied at level start.
                </p>
                <div class="ld-settings-actions">
                  <button id="ld-settings-copy-current" class="ld-btn">📋 Copy Current Game Settings</button>
                  <button id="ld-settings-reset" class="ld-btn ld-btn-danger">↺ Reset to Defaults</button>
                </div>
                <div id="ld-settings-list"></div>
              </div>
            </div>
            <div id="ld-footer">
              <button id="ld-save-btn" class="ld-btn ld-btn-primary">💾 Save Level</button>
              <button id="ld-play-btn" class="ld-btn ld-btn-primary">▶ Save & Play</button>
              <button id="ld-export-btn" class="ld-btn">📤 Export JSON</button>
              <button id="ld-import-btn" class="ld-btn">📥 Import JSON</button>
              <button id="ld-close-btn" class="ld-btn">Close</button>
              <span id="ld-status"></span>
            </div>
          </div>
        `;
    const container = document.getElementById('game-container') || document.body;
    container.appendChild(overlay);
    this.overlay = overlay;
    this.canvas = overlay.querySelector('#ld-canvas');
    this.ctx = this.canvas.getContext('2d');
    this._populateRulesets();
    this._buildSettingsPanel();
    this._resizeCanvas();
  }

  _populateRulesets() {
    const sel = this.overlay.querySelector('#ld-ruleset');
    sel.innerHTML = '';
    for (const def of listRulesets()) {
      const opt = document.createElement('option');
      opt.value = def.id;
      opt.textContent = `${def.name} (${def.notation})`;
      opt.title = def.description || '';
      sel.appendChild(opt);
    }
    sel.value = 'conway';
    this._updateRulesetDesc();
    // Populate enemy ruleset select (with "same as defender" option).
    const enemySel = this.overlay.querySelector('#ld-enemy-ruleset');
    if (enemySel) {
      enemySel.innerHTML = '';
      const optNone = document.createElement('option');
      optNone.value = '';
      optNone.textContent = '— Same as defender (symmetric) —';
      enemySel.appendChild(optNone);
      for (const def of listRulesets()) {
        const opt = document.createElement('option');
        opt.value = def.id;
        opt.textContent = `${def.name} (${def.notation})`;
        opt.title = def.description || '';
        enemySel.appendChild(opt);
      }
      enemySel.value = '';
    }
  }
  _updateRulesetDesc() {
    const sel = this.overlay.querySelector('#ld-ruleset');
    const descEl = this.overlay.querySelector('#ld-ruleset-desc');
    if (!sel || !descEl) return;
    const def = listRulesets().find((d) => d.id === sel.value);
    descEl.textContent = def ? def.description || '' : '';
  }
  // Recompute the active topology from the selected ruleset's
  // neighborhood. Falls back to 'square' for exotic rules.
  _updateTopologyFromRuleset() {
    let topologyId = 'square';
    try {
      const def = getRuleset(this.ruleset);
      if (def && def.neighborhood && !def._exoticType) {
        const nbhd = getNeighborhood(def.neighborhood);
        if (nbhd && nbhd.topology) topologyId = nbhd.topology;
      }
    } catch (e) {
      // Default to square.
    }
    if (topologyId !== this.topologyId) {
      this.topologyId = topologyId;
      this._resizeCanvas();
    } else {
      // Topology unchanged but neighborhood may have. Re-resize anyway
      // so the renderer gets a fresh canvas-size computation for the
      // new neighborhood shape (e.g. switching between Euclidean radii).
      this._resizeCanvas();
      this._draw();
    }
  }

  _resizeCanvas() {
    // Fit the designer canvas to the wrap with reasonable cell size.
    const wrap = this.overlay.querySelector('#ld-canvas-wrap');
    if (!wrap) return;
    const maxW = Math.min(wrap.clientWidth || 800, 1200);
    const maxH = Math.min(wrap.clientHeight || 600, 800);
    const topology = getTopology(this.topologyId);
    // Estimate cell size for the current topology.
    if (this.topologyId === 'hex') {
      // For hex: width per row ≈ √3/2 * cs * (w + 0.5 for odd rows),
      // height ≈ 1.5*(cs/2)*(h-1) + cs = 0.75*cs*(h-1) + cs.
      // Solve for cs to fit both bounds.
      const SQRT3 = Math.sqrt(3);
      const csByW = Math.floor(maxW / ((SQRT3 / 2) * (this.gridWidth + 0.5)));
      const csByH = Math.floor(maxH / (0.75 * (this.gridHeight - 1) + 1));
      this.cellSize = Math.max(3, Math.min(csByW, csByH, 16));
      const dims = topology.canvasSize(this.gridWidth, this.gridHeight, this.cellSize);
      this.canvas.width = Math.ceil(dims.w);
      this.canvas.height = Math.ceil(dims.h);
    } else if (this.topologyId === 'tri') {
      // Tri grid: 2 triangles per (x,y) cell. Stride is ~cs*0.5 horizontally.
      const csByW = Math.floor(maxW / (this.gridWidth * 0.5 + 0.5));
      const csByH = Math.floor((maxH * 2) / (this.gridHeight * Math.sqrt(3)));
      this.cellSize = Math.max(3, Math.min(csByW, csByH, 18));
      const dims = topology.canvasSize(this.gridWidth, this.gridHeight, this.cellSize);
      this.canvas.width = Math.ceil(dims.w);
      this.canvas.height = Math.ceil(dims.h);
    } else {
      const sizeByW = Math.floor(maxW / this.gridWidth);
      const sizeByH = Math.floor(maxH / this.gridHeight);
      this.cellSize = Math.max(2, Math.min(sizeByW, sizeByH, 12));
      this.canvas.width = this.gridWidth * this.cellSize;
      this.canvas.height = this.gridHeight * this.cellSize;
    }
    this._draw();
  }

  // ── Event wiring ──────────────────────────────────────────────
  _wireEvents() {
    const ov = this.overlay;
    // Tab switching.
    ov.querySelectorAll('.ld-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        ov.querySelectorAll('.ld-tab').forEach((b) => b.classList.toggle('active', b === btn));
        ov.querySelectorAll('.ld-tab-panel').forEach((p) => {
          p.classList.toggle('active', p.id === `ld-tab-${target}`);
        });
        // Resize canvas when switching back to map tab in case layout changed.
        if (target === 'map') {
          requestAnimationFrame(() => this._resizeCanvas());
        }
        // Build dynamic content on first open.
        if (target === 'tools') this._buildToolsPanel();
        if (target === 'theme') this._buildThemePanel();
      });
    });
    // Mode buttons.
    ov.querySelectorAll('.ld-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        // Defense-in-depth: ignore if this is a paint-target button that
        // happens to also have ld-mode-btn for styling.
        if (!btn.dataset.mode) return;
        this.mode = btn.dataset.mode;
        ov.querySelectorAll('.ld-mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
        ov.querySelector('#ld-pattern-selector').style.display =
          this.mode === DESIGNER_MODE.PATTERN ? 'flex' : 'none';
        ov.querySelector('#ld-base-selector').style.display =
          this.mode === DESIGNER_MODE.BASE ? 'flex' : 'none';
        ov.querySelector('#ld-spawner-selector').style.display =
          this.mode === DESIGNER_MODE.SPAWNER ? 'flex' : 'none';
        const citySel = ov.querySelector('#ld-city-selector');
        if (citySel) {
          citySel.style.display = this.mode === DESIGNER_MODE.CITY ? 'flex' : 'none';
        }
        ov.querySelector('#ld-line-tools').style.display =
          this.mode === DESIGNER_MODE.LINE ? 'flex' : 'none';
        ov.querySelector('#ld-fill-tools').style.display =
          this.mode === DESIGNER_MODE.FILL ? 'flex' : 'none';
        // Paint target ("ink") applies to all cell-painting tools.
        const usesPaintTarget =
          this.mode === DESIGNER_MODE.DEFENSE ||
          this.mode === DESIGNER_MODE.LINE ||
          this.mode === DESIGNER_MODE.FILL ||
          this.mode === DESIGNER_MODE.PATTERN;
        ov.querySelector('#ld-paint-target-group').style.display = usesPaintTarget
          ? 'flex'
          : 'none';
        // Cancel any in-progress line/fill drag when switching modes.
        this._lineStart = null;
        this._linePreview = null;
        this._fillStart = null;
        this._fillPreview = null;
        this._draw();
      });
    });
    // Paint-target toggle buttons (Defense vs Barrier).
    ov.querySelectorAll('.ld-target-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.paintTarget = btn.dataset.target;
        ov.querySelectorAll('.ld-target-btn').forEach((b) =>
          b.classList.toggle('active', b === btn)
        );
        this._draw();
      });
    });
    // Pattern-stamp picker buttons (defense pattern).
    ov.querySelector('#ld-pick-pattern-btn').addEventListener('click', () => {
      this._openZooForPattern('defense');
    });
    ov.querySelector('#ld-rotate-pattern-btn').addEventListener('click', () => {
      this._rotateStamp('defense');
    });
    ov.querySelector('#ld-flip-pattern-btn').addEventListener('click', () => {
      this._flipStamp('defense');
    });
    // Base pattern picker.
    ov.querySelector('#ld-pick-base-btn').addEventListener('click', () => {
      this._openZooForPattern('base');
    });
    ov.querySelector('#ld-rotate-base-btn').addEventListener('click', () => {
      this._rotateStamp('base');
    });
    ov.querySelector('#ld-flip-base-btn').addEventListener('click', () => {
      this._flipStamp('base');
    });
    // Spawner pattern picker.
    ov.querySelector('#ld-pick-spawner-btn').addEventListener('click', () => {
      this._openZooForPattern('spawner');
    });
    ov.querySelector('#ld-rotate-spawner-btn').addEventListener('click', () => {
      this._rotateStamp('spawner');
    });
    ov.querySelector('#ld-flip-spawner-btn').addEventListener('click', () => {
      this._flipStamp('spawner');
    });
    // City pattern picker (visual only).
    const pickCityBtn = ov.querySelector('#ld-pick-city-btn');
    const clearCityBtn = ov.querySelector('#ld-clear-city-btn');
    if (pickCityBtn) {
      pickCityBtn.addEventListener('click', () => this._openZooForPattern('city'));
    }
    if (clearCityBtn) {
      clearCityBtn.addEventListener('click', () => {
        this._cityPattern = null;
        const lbl = this.overlay.querySelector('#ld-city-name');
        if (lbl) lbl.textContent = '— default block —';
        this._setStatus('City pattern reset to default rectangle.', 'ok');
        this._draw();
      });
    }
    // Line tool controls.
    const lineWidthInput = ov.querySelector('#ld-line-width');
    const lineWidthLabel = ov.querySelector('#ld-line-width-label');
    lineWidthInput.addEventListener('input', () => {
      this.lineWidth = parseInt(lineWidthInput.value, 10) || 1;
      lineWidthLabel.textContent = String(this.lineWidth);
    });
    ov.querySelector('#ld-line-dash').addEventListener('change', (e) => {
      this.dashPattern = e.target.value;
    });
    // Fill tool controls.
    ov.querySelector('#ld-fill-pattern').addEventListener('change', (e) => {
      this.fillPattern = e.target.value;
    });
    // Brush size.
    const brushInput = ov.querySelector('#ld-brush-size');
    const brushLabel = ov.querySelector('#ld-brush-label');
    brushInput.addEventListener('input', () => {
      this.brushSize = parseInt(brushInput.value, 10) || 1;
      brushLabel.textContent = String(this.brushSize);
    });
    // Grid resize.
    ov.querySelector('#ld-resize-btn').addEventListener('click', () => {
      const w = parseInt(ov.querySelector('#ld-grid-w').value, 10) || 120;
      const h = parseInt(ov.querySelector('#ld-grid-h').value, 10) || 80;
      if (!confirm(`Resize grid to ${w}×${h}? This may clip existing content.`)) return;
      this.gridWidth = Math.max(60, Math.min(400, w));
      this.gridHeight = Math.max(40, Math.min(300, h));
      this._clipContent();
      this._resizeCanvas();
      // Update slider ranges that depend on grid size.
      const bzInput = ov.querySelector('#ld-set-BASE_ZONE_HEIGHT');
      if (bzInput) {
        const newMax = Math.max(20, Math.floor(this.gridHeight * 0.6));
        bzInput.max = String(newMax);
      }
    });
    // Wrap shift input.
    const wrapShiftInput = ov.querySelector('#ld-wrap-shift');
    if (wrapShiftInput) {
      wrapShiftInput.addEventListener('input', (e) => {
        this.wrapVerticalShift = parseInt(e.target.value, 10) || 0;
      });
    }
    // Spawner default config inputs.
    const spawnerIntervalInput = ov.querySelector('#ld-spawner-interval');
    const spawnerLimitInput = ov.querySelector('#ld-spawner-emit-limit');
    const spawnerDelayInput = ov.querySelector('#ld-spawner-initial-delay');
    const spawnerPaddingInput = ov.querySelector('#ld-spawner-padding');
    this._defaultSpawnerInterval = 2000;
    this._defaultSpawnerEmitLimit = 0;
    this._defaultSpawnerInitialDelay = 2000;
    this._defaultSpawnerPadding = 1;
    if (spawnerIntervalInput) {
      spawnerIntervalInput.addEventListener('input', (e) => {
        this._defaultSpawnerInterval = Math.max(100, parseInt(e.target.value, 10) || 2000);
      });
    }
    if (spawnerLimitInput) {
      spawnerLimitInput.addEventListener('input', (e) => {
        this._defaultSpawnerEmitLimit = Math.max(0, parseInt(e.target.value, 10) || 0);
      });
    }
    if (spawnerDelayInput) {
      spawnerDelayInput.addEventListener('input', (e) => {
        this._defaultSpawnerInitialDelay = Math.max(0, parseInt(e.target.value, 10) || 0);
      });
    }
    if (spawnerPaddingInput) {
      spawnerPaddingInput.addEventListener('input', (e) => {
        this._defaultSpawnerPadding = Math.max(0, parseInt(e.target.value, 10) || 0);
      });
    }
    const applyDefaultsBtn = ov.querySelector('#ld-apply-spawner-defaults');
    if (applyDefaultsBtn) {
      applyDefaultsBtn.addEventListener('click', () => {
        if (this.spawners.length === 0) {
          this._setStatus('No spawners placed yet.', 'err');
          return;
        }
        if (
          !confirm(
            `Apply current defaults to all ${this.spawners.length} placed spawner(s)?\n` +
              `Interval: ${this._defaultSpawnerInterval}ms\n` +
              `Emit limit: ${this._defaultSpawnerEmitLimit || '∞'}\n` +
              `Initial delay: ${this._defaultSpawnerInitialDelay}ms\n` +
              `Padding: ${this._defaultSpawnerPadding}`
          )
        )
          return;
        for (const sp of this.spawners) {
          sp.interval = this._defaultSpawnerInterval;
          sp.emitLimit = this._defaultSpawnerEmitLimit;
          sp.initialDelay = this._defaultSpawnerInitialDelay;
          sp.padding = this._defaultSpawnerPadding;
        }
        this._setStatus(`✓ Updated ${this.spawners.length} spawner(s).`, 'ok');
      });
    }
    // Clear all.
    ov.querySelector('#ld-clear-btn').addEventListener('click', () => {
      if (!confirm('Clear all cities, defenses, enemy cells, barriers, fire, and bases?')) return;
      this.cities = [];
      this.defenseCells.clear();
      this.enemyCells.clear();
      this.barrierCells.clear();
      this.fireCells.clear();
      this.bases = [];
      this.spawners = [];
      this._draw();
      this._updateStats();
    });
    // Canvas pointer events.
    this.canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    this.canvas.addEventListener('pointerleave', () => {
      this._hoverCell = null;
      this._draw();
    });
    window.addEventListener('pointerup', () => {
      // Commit line / fill on release.
      if (this._lineStart && this._linePreview) {
        this._commitCellsToTarget(this._linePreview);
        this._lineStart = null;
        this._linePreview = null;
      }
      if (this._fillStart && this._fillPreview) {
        this._commitCellsToTarget(this._fillPreview);
        this._fillStart = null;
        this._fillPreview = null;
      }
      this._isDragging = false;
      this._draw();
      this._updateStats();
    });
    // Metadata inputs.
    ov.querySelector('#ld-desc').addEventListener('input', (e) => {
      this.description = e.target.value;
    });
    ov.querySelector('#ld-ruleset').addEventListener('change', (e) => {
      this.ruleset = e.target.value;
      this._updateRulesetDesc();
      // Mirror into settings snapshot so it's saved consistently.
      if (this.levelSettings) this.levelSettings.ACTIVE_RULESET = e.target.value;
      // Force topology refresh and canvas rebuild. Switching to/from
      // Euclidean (non-Moore) neighborhoods needs both the topology
      // recompute and a canvas-size recompute even though both might
      // produce identical results — the renderer needs a clean redraw.
      const oldTopology = this.topologyId;
      this._updateTopologyFromRuleset();
      // Force resize+redraw even if topology didn't change, to flush
      // any stale neighborhood-derived canvas state.
      this._resizeCanvas();
      this._draw();
    });
    // Enemy ruleset selector.
    const enemySel = ov.querySelector('#ld-enemy-ruleset');
    if (enemySel) {
      enemySel.addEventListener('change', (e) => {
        this.enemyRuleset = e.target.value || null;
        if (this.levelSettings) {
          this.levelSettings.ENEMY_RULESET = this.enemyRuleset;
        }
      });
    }
    // Footer buttons.
    ov.querySelector('#ld-save-btn').addEventListener('click', () => this._save());
    ov.querySelector('#ld-play-btn').addEventListener('click', () => this._saveAndPlay());
    ov.querySelector('#ld-export-btn').addEventListener('click', () => this._exportJSON());
    ov.querySelector('#ld-import-btn').addEventListener('click', () => this._importJSON());
    // Add a "Copy Share URL" button dynamically next to export/import.
    const exportBtn = ov.querySelector('#ld-export-btn');
    if (exportBtn && !ov.querySelector('#ld-share-url-btn')) {
      const shareBtn = document.createElement('button');
      shareBtn.id = 'ld-share-url-btn';
      shareBtn.className = 'ld-btn';
      shareBtn.textContent = '🔗 Copy Share URL';
      shareBtn.title =
        'Copy a URL that loads this level when opened. ' +
        'You must host the JSON yourself (e.g. GitHub Gist raw URL).';
      shareBtn.addEventListener('click', () => this._promptShareUrl());
      exportBtn.parentNode.insertBefore(shareBtn, exportBtn.nextSibling);
    }
    ov.querySelector('#ld-close-btn').addEventListener('click', () => this.hide());
    ov.querySelector('#ld-load-btn').addEventListener('click', () => this._loadSelected());
    ov.querySelector('#ld-delete-btn').addEventListener('click', () => this._deleteSelected());
    // Settings panel buttons.
    const copyBtn = ov.querySelector('#ld-settings-copy-current');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        this.levelSettings = this._captureCurrentSettings();
        this._syncSettingsPanelFromState();
        this._setStatus('Captured current game settings.', 'ok');
      });
    }
    const resetBtn = ov.querySelector('#ld-settings-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (
          !confirm(
            'Reset all level settings to game defaults? This will discard custom settings for this level.'
          )
        )
          return;
        this.levelSettings = this._defaultSettings();
        this._syncSettingsPanelFromState();
        this._setStatus('Settings reset to defaults.', 'ok');
      });
    }
    // ESC closes.
    window.addEventListener('keydown', (e) => {
      if (this.visible && e.key === 'Escape') {
        e.preventDefault();
        this.hide();
        return;
      }
      if (!this.visible) return;
      // Don't fire hotkeys while typing in an input/textarea/select.
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      // Mode hotkeys.
      const modeKeys = {
        d: DESIGNER_MODE.DEFENSE,
        l: DESIGNER_MODE.LINE,
        f: DESIGNER_MODE.FILL,
        c: DESIGNER_MODE.CITY,
        p: DESIGNER_MODE.PATTERN,
        b: DESIGNER_MODE.BASE,
        s: DESIGNER_MODE.SPAWNER,
      };
      const k = e.key.toLowerCase();
      if (modeKeys[k]) {
        e.preventDefault();
        this._selectModeButton(modeKeys[k]);
        return;
      }
      // Quick ink-target switch with 'e' for Erase.
      if (k === 'e') {
        e.preventDefault();
        this._selectPaintTarget('erase');
        return;
      }
      // Rotate / flip current stamp.
      if (k === 'r') {
        e.preventDefault();
        if (this.mode === DESIGNER_MODE.PATTERN) this._rotateStamp('defense');
        else if (this.mode === DESIGNER_MODE.BASE) this._rotateStamp('base');
        else if (this.mode === DESIGNER_MODE.SPAWNER) this._rotateStamp('spawner');
        return;
      }
      if (k === 'x') {
        e.preventDefault();
        if (this.mode === DESIGNER_MODE.PATTERN) this._flipStamp('defense');
        else if (this.mode === DESIGNER_MODE.BASE) this._flipStamp('base');
        else if (this.mode === DESIGNER_MODE.SPAWNER) this._flipStamp('spawner');
        return;
      }
      // Brush size +/-.
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        const brushInput = this.overlay.querySelector('#ld-brush-size');
        if (brushInput) {
          const cur = parseInt(brushInput.value, 10) || 1;
          const max = parseInt(brushInput.max, 10) || 8;
          brushInput.value = String(Math.min(max, cur + 1));
          brushInput.dispatchEvent(new Event('input'));
        }
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        const brushInput = this.overlay.querySelector('#ld-brush-size');
        if (brushInput) {
          const cur = parseInt(brushInput.value, 10) || 1;
          const min = parseInt(brushInput.min, 10) || 1;
          brushInput.value = String(Math.max(min, cur - 1));
          brushInput.dispatchEvent(new Event('input'));
        }
        return;
      }
      // Ctrl+S save shortcut.
      if (k === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this._save();
        return;
      }
    });
  }
  // Programmatically click a mode button to switch tools.
  _selectModeButton(mode) {
    const btn = this.overlay.querySelector(`.ld-mode-btn[data-mode="${mode}"]`);
    if (btn) btn.click();
  }

  // ── Pointer drawing ───────────────────────────────────────────
  _getCell(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width / rect.width;
    const sy = this.canvas.height / rect.height;
    const px = (e.clientX - rect.left) * sx;
    const py = (e.clientY - rect.top) * sy;
    let x, y;
    if (this.topologyId === 'hex' || this.topologyId === 'tri') {
      const topology = getTopology(this.topologyId);
      const result = topology.pixelToCell(px, py, this.cellSize);
      x = result.x;
      y = result.y;
    } else {
      x = Math.floor(px / this.cellSize);
      y = Math.floor(py / this.cellSize);
    }
    if (x < 0 || x >= this.gridWidth || y < 0 || y >= this.gridHeight) return null;
    return { x, y };
  }

  _onPointerDown(e) {
    e.preventDefault();
    this._isDragging = true;
    const cell = this._getCell(e);
    if (!cell) return;
    this._hoverCell = cell;
    if (this.mode === DESIGNER_MODE.LINE) {
      this._lineStart = cell;
      this._linePreview = [];
      this._draw();
      return;
    }
    if (this.mode === DESIGNER_MODE.FILL) {
      this._fillStart = cell;
      this._fillPreview = [];
      this._draw();
      return;
    }
    this._applyAtCell(cell.x, cell.y);
  }

  _onPointerMove(e) {
    const cell = this._getCell(e);
    this._hoverCell = cell;
    // Line preview (while dragging).
    if (this._isDragging && this.mode === DESIGNER_MODE.LINE && this._lineStart && cell) {
      this._linePreview = this._computeLine(this._lineStart.x, this._lineStart.y, cell.x, cell.y);
      this._draw();
      return;
    }
    // Fill preview (while dragging).
    if (this._isDragging && this.mode === DESIGNER_MODE.FILL && this._fillStart && cell) {
      this._fillPreview = this._computeFillRect(
        this._fillStart.x,
        this._fillStart.y,
        cell.x,
        cell.y
      );
      this._draw();
      return;
    }
    // Preview-only hover modes — always redraw so the cursor preview moves.
    if (
      this.mode === DESIGNER_MODE.PATTERN ||
      this.mode === DESIGNER_MODE.BASE ||
      this.mode === DESIGNER_MODE.SPAWNER ||
      this.mode === DESIGNER_MODE.CITY
    ) {
      this._draw();
    }
    if (!this._isDragging) return;
    if (!cell) return;
    // For city/base placement we don't drag (single-click).
    if (
      this.mode === DESIGNER_MODE.CITY ||
      this.mode === DESIGNER_MODE.BASE ||
      this.mode === DESIGNER_MODE.PATTERN ||
      this.mode === DESIGNER_MODE.SPAWNER
    )
      return;
    this._applyAtCell(cell.x, cell.y);
  }

  _applyAtCell(x, y) {
    switch (this.mode) {
      case DESIGNER_MODE.CITY:
        this._placeCity(x, y);
        break;
      case DESIGNER_MODE.DEFENSE:
        this._paintBrush(x, y, true);
        break;
      case DESIGNER_MODE.BASE:
        this._stampBaseAt(x, y);
        break;
      case DESIGNER_MODE.PATTERN:
        this._stampPatternAt(x, y);
        break;
      case DESIGNER_MODE.SPAWNER:
        this._stampSpawnerAt(x, y);
        break;
    }
    this._draw();
    this._updateStats();
  }

  _placeCity(x, y) {
    // If a city pattern is selected, use its bounding box; otherwise
    // fall back to the default rectangular city (CITY_WIDTH × CITY_HEIGHT).
    const pattern = this._cityPattern;
    const w = pattern ? pattern.width : CONFIG.CITY_WIDTH || 5;
    const h = pattern ? pattern.height : CONFIG.CITY_HEIGHT || 3;
    const cx = Math.max(0, Math.min(this.gridWidth - w, x - Math.floor(w / 2)));
    const cy = Math.max(0, Math.min(this.gridHeight - h, y - Math.floor(h / 2)));
    // Prevent overlap.
    for (const c of this.cities) {
      if (cx < c.x + c.width && cx + w > c.x && cy < c.y + c.height && cy + h > c.y) {
        return;
      }
    }
    const city = { x: cx, y: cy, width: w, height: h };
    if (pattern) {
      city.patternId = pattern.id;
      city.patternName = pattern.name;
      // Store the pattern cells so the level retains the visual shape.
      city.cells = pattern.cells.map(([dx, dy]) => [dx, dy]);
    }
    this.cities.push(city);
  }

  _paintBrush(x, y, add) {
    const r = Math.floor(this.brushSize / 2);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || px >= this.gridWidth || py < 0 || py >= this.gridHeight) continue;
        if (add) {
          this._paintCell(px, py);
        } else {
          this._eraseCellOnly(px, py);
        }
      }
    }
    // Erase target also removes cities/bases/spawners under the brush.
    if (add && this.paintTarget === 'erase') {
      this._eraseStructuresAt(x, y);
    }
  }
  // Get the Set corresponding to a paint-target id, or null for 'erase'.
  _getTargetSet(target) {
    switch (target) {
      case 'defense':
        return this.defenseCells;
      case 'enemy':
        return this.enemyCells;
      case 'barrier':
        return this.barrierCells;
      case 'fire':
        return this.fireCells;
      default:
        return null;
    }
  }
  // Paint a single cell using the current paint target. Cell-paint
  // targets are mutually exclusive (defense/enemy/barrier/fire) — adding
  // one removes the others at the same cell. 'erase' removes from all.
  _paintCell(x, y) {
    const key = `${x},${y}`;
    const allSets = [this.defenseCells, this.enemyCells, this.barrierCells, this.fireCells];
    if (this.paintTarget === 'erase') {
      for (const s of allSets) s.delete(key);
      return;
    }
    const targetSet = this._getTargetSet(this.paintTarget);
    if (!targetSet) return;
    targetSet.add(key);
    for (const s of allSets) {
      if (s !== targetSet) s.delete(key);
    }
  }
  // Remove cell ink (defense/enemy/barrier/fire) at a single cell.
  _eraseCellOnly(x, y) {
    const key = `${x},${y}`;
    this.defenseCells.delete(key);
    this.enemyCells.delete(key);
    this.barrierCells.delete(key);
    this.fireCells.delete(key);
  }
  // Remove cities/bases/spawners whose bounding box contains (x, y).
  _eraseStructuresAt(x, y) {
    this.cities = this.cities.filter(
      (c) => !(x >= c.x && x < c.x + c.width && y >= c.y && y < c.y + c.height)
    );
    this.bases = this.bases.filter(
      (pb) => !(x >= pb.x && x < pb.x + pb.width && y >= pb.y && y < pb.y + pb.height)
    );
    this.spawners = this.spawners.filter(
      (sp) => !(x >= sp.x && x < sp.x + sp.width && y >= sp.y && y < sp.y + sp.height)
    );
  }
  // Apply a list of [x, y] cells to the current paint target. Used by
  // line- and fill-tool commit handlers.
  _commitCellsToTarget(cells) {
    for (const [x, y] of cells) {
      this._paintCell(x, y);
    }
    if (this.paintTarget === 'erase') {
      // Also remove structures under any erased cell.
      for (const [x, y] of cells) {
        this._eraseStructuresAt(x, y);
      }
    }
  }
  // Programmatically click an ink/paint-target button.
  _selectPaintTarget(target) {
    const btn = this.overlay.querySelector(`.ld-target-btn[data-target="${target}"]`);
    if (btn) btn.click();
  }

  // Compute cells for a Bresenham line from (x0,y0) to (x1,y1) using
  // current brush width and dash pattern. Returns a list of [x,y].
  _computeLine(x0, y0, x1, y1) {
    const out = [];
    const seen = new Set();
    const w = this.lineWidth;
    const half = Math.floor(w / 2);
    const dashSpec = { solid: null, dashed: [2, 2], dotted: [1, 2], sparse: [1, 4] }[
      this.dashPattern
    ];
    const dashScale = Math.max(1, w);
    let dashCounter = 0;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0,
      y = y0;
    while (true) {
      let emit = true;
      if (dashSpec) {
        const on = dashSpec[0] * dashScale;
        const off = dashSpec[1] * dashScale;
        emit = dashCounter % (on + off) < on;
      }
      dashCounter++;
      if (emit) {
        if (w <= 1) {
          const key = `${x},${y}`;
          if (!seen.has(key) && x >= 0 && x < this.gridWidth && y >= 0 && y < this.gridHeight) {
            seen.add(key);
            out.push([x, y]);
          }
        } else {
          for (let by = -half; by <= half; by++) {
            for (let bx = -half; bx <= half; bx++) {
              const px = x + bx;
              const py = y + by;
              const key = `${px},${py}`;
              if (
                !seen.has(key) &&
                px >= 0 &&
                px < this.gridWidth &&
                py >= 0 &&
                py < this.gridHeight
              ) {
                seen.add(key);
                out.push([px, py]);
              }
            }
          }
        }
      }
      if (x === x1 && y === y1) break;
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
    return out;
  }
  // Compute cells for a fill rectangle using the current fill pattern.
  _computeFillRect(x0, y0, x1, y1) {
    const fillFns = {
      solid: () => true,
      checker: (x, y) => ((x + y) & 1) === 0,
      stripes_h: (_x, y) => (y & 1) === 0,
      stripes_v: (x) => (x & 1) === 0,
      diagonal: (x, y) => (x + y) % 3 === 0,
      dots_sparse: (x, y) => x % 3 === 0 && y % 3 === 0,
      dots_dense: (x, y) => x % 2 === 0 && y % 2 === 0,
      grid: (x, y) => x % 4 === 0 || y % 4 === 0,
      cross: (x, y) => x % 4 === 0 && y % 4 === 0,
      random50: () => Math.random() < 0.5,
      random25: () => Math.random() < 0.25,
    };
    const fn = fillFns[this.fillPattern] || fillFns.solid;
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const out = [];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (x < 0 || x >= this.gridWidth || y < 0 || y >= this.gridHeight) continue;
        if (fn(x - minX, y - minY)) out.push([x, y]);
      }
    }
    return out;
  }
  // ── Zoo pattern stamping ──────────────────────────────────────
  /**
   * Open the PatternZoo as a modal picker. `target` is either
   * 'defense' (stamp into defenseCells), 'base' (register as a
   * base entry), or 'spawner' (register as a missile spawner).
   */
  _openZooForPattern(target) {
    if (!this.game || !this.game.patternZoo) {
      this._setStatus('Pattern Zoo unavailable.', 'err');
      return;
    }
    const titles = {
      base: 'Pick an enemy base pattern',
      spawner: 'Pick a missile spawner pattern',
      defense: 'Pick a pattern to stamp as defense cells',
      city: 'Pick a visual pattern for cities',
    };
    const title = titles[target] || titles.defense;
    let filter = null;
    // Hide our overlay while the zoo is shown — both use the same overlay
    // layer, so we restore on completion.
    this.overlay.classList.add('hidden');
    this.game.patternZoo.pickPattern({
      title,
      filter,
      categoryFilter: target === 'spawner' ? 'spaceship' : null,
      onPick: (pattern) => {
        // Re-show the designer overlay.
        this.overlay.classList.remove('hidden');
        if (!pattern) {
          this._setStatus('Pattern selection cancelled.', 'err');
          return;
        }
        this._adoptPickedPattern(pattern, target);
      },
    });
  }
  _adoptPickedPattern(pattern, target) {
    // Normalize the pattern into a flat list of [dx, dy] offsets, plus bbox.
    const cells = (pattern.cells || []).map(([x, y]) => [x | 0, y | 0]);
    if (cells.length === 0) {
      this._setStatus('Pattern has no cells.', 'err');
      return;
    }
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [x, y] of cells) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const normalized = cells.map(([x, y]) => [x - minX, y - minY]);
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const stamp = {
      id: pattern.id,
      name: pattern.name || pattern.id,
      cells: normalized,
      width,
      height,
    };
    if (target === 'base') {
      this._basePattern = stamp;
      const lbl = this.overlay.querySelector('#ld-base-name');
      if (lbl) lbl.textContent = stamp.name;
    } else if (target === 'spawner') {
      this._spawnerPattern = stamp;
      const lbl = this.overlay.querySelector('#ld-spawner-name');
      if (lbl) lbl.textContent = stamp.name;
    } else if (target === 'city') {
      this._cityPattern = stamp;
      const lbl = this.overlay.querySelector('#ld-city-name');
      if (lbl) lbl.textContent = stamp.name;
      this._draw();
    } else {
      this._stampPattern = stamp;
      const lbl = this.overlay.querySelector('#ld-pattern-name');
      if (lbl) lbl.textContent = stamp.name;
    }
    this._setStatus(`✓ Selected "${stamp.name}" (${width}×${height}).`, 'ok');
  }
  _rotateStamp(target) {
    const stamp =
      target === 'base'
        ? this._basePattern
        : target === 'spawner'
          ? this._spawnerPattern
          : this._stampPattern;
    if (!stamp) {
      this._setStatus('Pick a pattern first.', 'err');
      return;
    }
    // Rotate 90° clockwise: (x, y) → (h-1-y, x)
    const h = stamp.height;
    const rotated = stamp.cells.map(([x, y]) => [h - 1 - y, x]);
    stamp.cells = rotated;
    const newW = stamp.height;
    const newH = stamp.width;
    stamp.width = newW;
    stamp.height = newH;
    this._setStatus(`Rotated "${stamp.name}" → ${stamp.width}×${stamp.height}.`, 'ok');
    this._draw();
  }
  _flipStamp(target) {
    const stamp =
      target === 'base'
        ? this._basePattern
        : target === 'spawner'
          ? this._spawnerPattern
          : this._stampPattern;
    if (!stamp) {
      this._setStatus('Pick a pattern first.', 'err');
      return;
    }
    const w = stamp.width;
    stamp.cells = stamp.cells.map(([x, y]) => [w - 1 - x, y]);
    this._setStatus(`Flipped "${stamp.name}".`, 'ok');
    this._draw();
  }
  _stampPatternAt(x, y) {
    if (!this._stampPattern) {
      this._setStatus('Pick a pattern first (🦓 button).', 'err');
      return;
    }
    const stamp = this._stampPattern;
    // Center the stamp on the cursor.
    const offX = x - Math.floor(stamp.width / 2);
    const offY = y - Math.floor(stamp.height / 2);
    const cells = [];
    for (const [dx, dy] of stamp.cells) {
      const px = offX + dx;
      const py = offY + dy;
      if (px < 0 || px >= this.gridWidth || py < 0 || py >= this.gridHeight) continue;
      cells.push([px, py]);
    }
    this._commitCellsToTarget(cells);
  }
  _stampBaseAt(x, y) {
    if (!this._basePattern) {
      this._setStatus('Pick a base pattern first (🦓 button).', 'err');
      return;
    }
    const stamp = this._basePattern;
    // Center the stamp footprint on the cursor; anchor stored is top-left.
    const ax = x - Math.floor(stamp.width / 2);
    const ay = y - Math.floor(stamp.height / 2);
    // Clip-test: skip if completely out of bounds.
    if (ax + stamp.width <= 0 || ay + stamp.height <= 0) return;
    if (ax >= this.gridWidth || ay >= this.gridHeight) return;
    // Prevent exact overlap with another base at the same anchor.
    for (const pb of this.bases) {
      if (pb.x === ax && pb.y === ay && pb.patternId === stamp.id) return;
    }
    this.bases.push({
      patternId: stamp.id,
      name: stamp.name,
      x: ax,
      y: ay,
      width: stamp.width,
      height: stamp.height,
      cells: stamp.cells.map(([dx, dy]) => [dx, dy]),
    });
  }
  _stampSpawnerAt(x, y) {
    if (!this._spawnerPattern) {
      this._setStatus('Pick a spawner pattern first (🦓 button).', 'err');
      return;
    }
    const stamp = this._spawnerPattern;
    const ax = x - Math.floor(stamp.width / 2);
    const ay = y - Math.floor(stamp.height / 2);
    if (ax + stamp.width <= 0 || ay + stamp.height <= 0) return;
    if (ax >= this.gridWidth || ay >= this.gridHeight) return;
    // Prevent exact overlap with another spawner at the same anchor.
    for (const sp of this.spawners) {
      if (sp.x === ax && sp.y === ay && sp.patternId === stamp.id) return;
    }
    this.spawners.push({
      patternId: stamp.id,
      name: stamp.name,
      x: ax,
      y: ay,
      width: stamp.width,
      height: stamp.height,
      cells: stamp.cells.map(([dx, dy]) => [dx, dy]),
      // Use the currently-configured defaults from the sidebar.
      interval: this._defaultSpawnerInterval || 2000,
      emitLimit: this._defaultSpawnerEmitLimit || 0,
      initialDelay:
        this._defaultSpawnerInitialDelay != null
          ? this._defaultSpawnerInitialDelay
          : this._defaultSpawnerInterval || 2000,
      padding: this._defaultSpawnerPadding != null ? this._defaultSpawnerPadding : 1,
    });
  }

  _clipContent() {
    this.cities = this.cities.filter(
      (c) => c.x + c.width <= this.gridWidth && c.y + c.height <= this.gridHeight
    );
    const newDefense = new Set();
    for (const key of this.defenseCells) {
      const [x, y] = key.split(',').map(Number);
      if (x < this.gridWidth && y < this.gridHeight) newDefense.add(key);
    }
    this.defenseCells = newDefense;
    const newEnemy = new Set();
    for (const key of this.enemyCells) {
      const [x, y] = key.split(',').map(Number);
      if (x < this.gridWidth && y < this.gridHeight) newEnemy.add(key);
    }
    this.enemyCells = newEnemy;
    const newBarriers = new Set();
    for (const key of this.barrierCells) {
      const [x, y] = key.split(',').map(Number);
      if (x < this.gridWidth && y < this.gridHeight) newBarriers.add(key);
    }
    this.barrierCells = newBarriers;
    const newFire = new Set();
    for (const key of this.fireCells) {
      const [x, y] = key.split(',').map(Number);
      if (x < this.gridWidth && y < this.gridHeight) newFire.add(key);
    }
    this.fireCells = newFire;
    this.bases = this.bases.filter(
      (pb) => pb.x + pb.width <= this.gridWidth && pb.y + pb.height <= this.gridHeight
    );
    this.spawners = this.spawners.filter(
      (sp) => sp.x + sp.width <= this.gridWidth && sp.y + sp.height <= this.gridHeight
    );
  }

  // ── Rendering ─────────────────────────────────────────────────
  _draw() {
    const ctx = this.ctx;
    const cs = this.cellSize;
    const w = this.canvas.width;
    const h = this.canvas.height;
    // Resolve theme colors with overrides.
    const theme = (k, fallback) => {
      if (this.colorTheme && this.colorTheme[k]) return this.colorTheme[k];
      return CONFIG.COLORS[k] || fallback;
    };
    // Background.
    ctx.fillStyle = theme('BACKGROUND', '#000010');
    ctx.fillRect(0, 0, w, h);
    // Grid lines / cell outlines.
    if (cs >= 4) {
      if (this.topologyId === 'square') {
        ctx.strokeStyle = 'rgba(64, 64, 160, 0.15)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= this.gridWidth; i++) {
          const x = i * cs + 0.5;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let i = 0; i <= this.gridHeight; i++) {
          const y = i * cs + 0.5;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
      } else {
        // Hex/Tri: draw cell outlines.
        this._drawTopologyGrid(ctx);
      }
    }
    // Draw zone tint (informational). Pull values from the level's own
    // settings if present, so the designer accurately reflects what the
    // player will see when the level is loaded.
    const settings = this.levelSettings || {};
    const dzFrac =
      settings.DRAW_ZONE_FRACTION != null
        ? settings.DRAW_ZONE_FRACTION
        : CONFIG.DRAW_ZONE_FRACTION || 0.5;
    const rearH =
      settings.REAR_DEAD_ZONE_HEIGHT != null
        ? settings.REAR_DEAD_ZONE_HEIGHT
        : CONFIG.REAR_DEAD_ZONE_HEIGHT || 2;
    const baseZoneH =
      settings.BASE_ZONE_HEIGHT != null ? settings.BASE_ZONE_HEIGHT : CONFIG.BASE_ZONE_HEIGHT || 12;
    const topDeadMax =
      settings.RETURN_FIRE_ZONE_MAX_Y != null
        ? settings.RETURN_FIRE_ZONE_MAX_Y
        : CONFIG.RETURN_FIRE_ZONE_MAX_Y || 4;
    const dzMinY = Math.floor(this.gridHeight * (1 - dzFrac));
    const dzMaxY = this.gridHeight - rearH - 1;
    // Top dead zone (rows 0..topDeadMax, where nothing spawns).
    ctx.fillStyle = 'rgba(80, 80, 80, 0.10)';
    ctx.fillRect(0, 0, w, (topDeadMax + 1) * cs);
    // Base zone band.
    const bzMinY = topDeadMax + 1;
    const bzMaxY = Math.min(bzMinY + baseZoneH - 1, dzMinY - 1);
    if (bzMaxY >= bzMinY) {
      ctx.fillStyle = 'rgba(255, 180, 60, 0.08)';
      ctx.fillRect(0, bzMinY * cs, w, (bzMaxY - bzMinY + 1) * cs);
    }
    // Drawable region tint.
    ctx.fillStyle = 'rgba(0, 255, 136, 0.04)';
    ctx.fillRect(0, dzMinY * cs, w, (dzMaxY - dzMinY + 1) * cs);
    // Rear dead zone tint.
    ctx.fillStyle = 'rgba(255, 80, 80, 0.06)';
    ctx.fillRect(0, (dzMaxY + 1) * cs, w, rearH * cs);
    // Boundary lines for each zone.
    ctx.lineWidth = 1.5;
    // Top dead zone bottom border.
    ctx.strokeStyle = 'rgba(120, 120, 120, 0.5)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, (topDeadMax + 1) * cs + 0.5);
    ctx.lineTo(w, (topDeadMax + 1) * cs + 0.5);
    ctx.stroke();
    // Wrap visualization: draw arrows at east/west edges showing the shift.
    if (this.wrapVerticalShift && this.wrapVerticalShift !== 0) {
      ctx.strokeStyle = 'rgba(255, 200, 80, 0.6)';
      ctx.setLineDash([2, 2]);
      // Display direction is inverted: when going off the east edge,
      // positive shift values move the wrap target DOWN.
      const shiftPx = -this.wrapVerticalShift * cs;
      // East edge arrow indicator.
      ctx.beginPath();
      ctx.moveTo(w - 4, (this.gridHeight * cs) / 2);
      ctx.lineTo(w - 4, (this.gridHeight * cs) / 2 + shiftPx);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 200, 80, 0.85)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(
        `wrap +${this.wrapVerticalShift}`,
        w - 8,
        (this.gridHeight * cs) / 2 + shiftPx + 12
      );
      ctx.setLineDash([]);
    }
    // Base zone bottom border.
    if (bzMaxY >= bzMinY) {
      ctx.strokeStyle = 'rgba(255, 180, 60, 0.6)';
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(0, (bzMaxY + 1) * cs + 0.5);
      ctx.lineTo(w, (bzMaxY + 1) * cs + 0.5);
      ctx.stroke();
    }
    // Draw zone top border.
    ctx.strokeStyle = 'rgba(0, 255, 200, 0.6)';
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(0, dzMinY * cs + 0.5);
    ctx.lineTo(w, dzMinY * cs + 0.5);
    ctx.stroke();
    // Rear dead zone top border.
    ctx.strokeStyle = 'rgba(255, 80, 80, 0.6)';
    ctx.beginPath();
    ctx.moveTo(0, (dzMaxY + 1) * cs + 0.5);
    ctx.lineTo(w, (dzMaxY + 1) * cs + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    // Zone labels.
    if (cs >= 3) {
      ctx.font = `bold ${Math.max(9, Math.min(12, cs * 1.4))}px monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(180, 180, 180, 0.7)';
      ctx.fillText('▲ TOP DEAD ZONE', 4, 2);
      if (bzMaxY >= bzMinY) {
        ctx.fillStyle = 'rgba(255, 180, 60, 0.85)';
        ctx.fillText('◆ BASE ZONE', 4, bzMinY * cs + 2);
      }
      ctx.fillStyle = 'rgba(0, 255, 200, 0.85)';
      ctx.fillText('▼ DRAW ZONE', 4, dzMinY * cs + 2);
      if (rearH > 0) {
        ctx.fillStyle = 'rgba(255, 100, 100, 0.85)';
        ctx.fillText('▲ REAR DEAD ZONE', 4, (dzMaxY + 1) * cs + 2);
      }
    }
    // Barriers — static stone-gray tiles. Drawn before defenses so live
    // defense glow paints over them on the rare chance of overlap.
    const barrierColor = (this.colorTheme && this.colorTheme.CELL_BARRIER) || '#a0a0a0';
    for (const key of this.barrierCells) {
      const [x, y] = key.split(',').map(Number);
      this._fillCell(ctx, x, y, barrierColor);
    }
    // Fire — static glowing tiles. Animated subtle glow.
    const fireColor = (this.colorTheme && this.colorTheme.CELL_FIRE) || '#ff6622';
    ctx.shadowColor = fireColor;
    ctx.shadowBlur = 5;
    for (const key of this.fireCells) {
      const [x, y] = key.split(',').map(Number);
      this._fillCell(ctx, x, y, fireColor);
    }
    ctx.shadowBlur = 0;
    // Defense cells.
    ctx.fillStyle = '#00ff88';
    for (const key of this.defenseCells) {
      const [x, y] = key.split(',').map(Number);
      this._fillCell(ctx, x, y, '#00ff88');
    }
    // Enemy cells (red/orange, distinct from bases).
    const enemyColor = (this.colorTheme && this.colorTheme.CELL_ENEMY) || '#ff3344';
    ctx.shadowColor = enemyColor;
    ctx.shadowBlur = 4;
    for (const key of this.enemyCells) {
      const [x, y] = key.split(',').map(Number);
      this._fillCell(ctx, x, y, enemyColor);
    }
    ctx.shadowBlur = 0;
    // Cities.
    const cityColor = (this.colorTheme && this.colorTheme.CELL_CITY) || '#ffff60';
    ctx.shadowColor = cityColor;
    ctx.shadowBlur = 6;
    for (const c of this.cities) {
      if (c.cells && Array.isArray(c.cells)) {
        // Pattern-shaped city: render only the live cells.
        for (const [dx, dy] of c.cells) {
          this._fillCell(ctx, c.x + dx, c.y + dy, cityColor);
        }
      } else {
        for (let dy = 0; dy < c.height; dy++) {
          for (let dx = 0; dx < c.width; dx++) {
            this._fillCell(ctx, c.x + dx, c.y + dy, cityColor);
          }
        }
      }
    }
    ctx.shadowBlur = 0;
    // Bases — draw cells with a red/orange tint plus a bbox outline.
    for (const pb of this.bases) {
      // Outline (only for square; hex/tri skip bbox).
      if (this.topologyId === 'square') {
        ctx.strokeStyle = 'rgba(255, 120, 60, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(pb.x * cs, pb.y * cs, pb.width * cs, pb.height * cs);
        ctx.setLineDash([]);
      }
      // Cells.
      ctx.shadowColor = '#ff7733';
      ctx.shadowBlur = 4;
      for (const [dx, dy] of pb.cells) {
        const px = pb.x + dx;
        const py = pb.y + dy;
        this._fillCell(ctx, px, py, '#ff7733');
      }
      ctx.shadowBlur = 0;
      // Tiny label above bounding box.
      if (cs >= 4 && pb.name) {
        ctx.fillStyle = '#ffaa66';
        ctx.font = `bold ${Math.max(8, Math.min(12, cs * 1.2))}px monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        const labelPos = this._cellPixelPos(pb.x, pb.y);
        ctx.fillText(pb.name, labelPos.px + 2, labelPos.py - 1);
      }
    }
    // Spawners — magenta/purple tint with double-outline.
    for (const sp of this.spawners) {
      if (this.topologyId === 'square') {
        ctx.strokeStyle = 'rgba(255, 100, 220, 0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 2]);
        ctx.strokeRect(sp.x * cs, sp.y * cs, sp.width * cs, sp.height * cs);
        ctx.setLineDash([]);
      }
      ctx.shadowColor = '#ff66cc';
      ctx.shadowBlur = 5;
      for (const [dx, dy] of sp.cells) {
        const px = sp.x + dx;
        const py = sp.y + dy;
        this._fillCell(ctx, px, py, '#ff66cc');
      }
      ctx.shadowBlur = 0;
      if (cs >= 4 && sp.name) {
        ctx.fillStyle = '#ffaaee';
        ctx.font = `bold ${Math.max(8, Math.min(12, cs * 1.2))}px monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        const labelPos = this._cellPixelPos(sp.x, sp.y);
        const limitStr = sp.emitLimit > 0 ? `×${sp.emitLimit}` : '∞';
        const intervalSec = ((sp.interval || 2000) / 1000).toFixed(1);
        const paddingStr = sp.padding != null && sp.padding !== 1 ? ` p${sp.padding}` : '';
        ctx.fillText(
          `🚀 ${sp.name} ${limitStr} @${intervalSec}s${paddingStr}`,
          labelPos.px + 2,
          labelPos.py - 1
        );
      }
    }
    // ── Previews ──────────────────────────────────────────
    this._drawPreviews();
  }
  // Fill a single cell using the current topology.
  _fillCell(ctx, x, y, color) {
    const cs = this.cellSize;
    if (this.topologyId === 'square') {
      ctx.fillStyle = color;
      ctx.fillRect(x * cs + 1, y * cs + 1, Math.max(1, cs - 2), Math.max(1, cs - 2));
      return;
    }
    const topology = getTopology(this.topologyId);
    if (this.topologyId === 'tri') {
      // Tri: draw both up & down triangles at (x, y).
      for (let o = 0; o < 2; o++) {
        const verts = topology.cellPolygon(x, y, cs, o);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(verts[0][0], verts[0][1]);
        for (let v = 1; v < verts.length; v++) ctx.lineTo(verts[v][0], verts[v][1]);
        ctx.closePath();
        ctx.fill();
      }
      return;
    }
    // Hex.
    const verts = topology.cellPolygon(x, y, cs);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(verts[0][0], verts[0][1]);
    for (let v = 1; v < verts.length; v++) ctx.lineTo(verts[v][0], verts[v][1]);
    ctx.closePath();
    ctx.fill();
  }
  // Get the top-left pixel position of a cell (for label placement).
  _cellPixelPos(x, y) {
    const cs = this.cellSize;
    if (this.topologyId === 'square') {
      return { px: x * cs, py: y * cs };
    }
    const topology = getTopology(this.topologyId);
    if (this.topologyId === 'tri') {
      return topology.cellToPixel(x, y, cs, 0);
    }
    return topology.cellToPixel(x, y, cs);
  }
  // Draw outlines for the current topology.
  _drawTopologyGrid(ctx) {
    const cs = this.cellSize;
    const topology = getTopology(this.topologyId);
    ctx.strokeStyle = 'rgba(64, 64, 160, 0.18)';
    ctx.lineWidth = 1;
    if (this.topologyId === 'hex') {
      for (let r = 0; r < this.gridHeight; r++) {
        for (let q = 0; q < this.gridWidth; q++) {
          const verts = topology.cellPolygon(q, r, cs);
          ctx.beginPath();
          ctx.moveTo(verts[0][0], verts[0][1]);
          for (let v = 1; v < verts.length; v++) ctx.lineTo(verts[v][0], verts[v][1]);
          ctx.closePath();
          ctx.stroke();
        }
      }
    } else if (this.topologyId === 'tri') {
      for (let y = 0; y < this.gridHeight; y++) {
        for (let x = 0; x < this.gridWidth; x++) {
          for (let o = 0; o < 2; o++) {
            const verts = topology.cellPolygon(x, y, cs, o);
            ctx.beginPath();
            ctx.moveTo(verts[0][0], verts[0][1]);
            for (let v = 1; v < verts.length; v++) ctx.lineTo(verts[v][0], verts[v][1]);
            ctx.closePath();
            ctx.stroke();
          }
        }
      }
    }
  }
  // Render hover/drag previews on top of committed content.
  _drawPreviews() {
    const ctx = this.ctx;
    const cs = this.cellSize;
    const hover = this._hoverCell;
    const pulse = 0.55 + 0.15 * Math.sin(performance.now() / 200);
    // Pick a preview color tuple based on the active paint target.
    const previewRgbByTarget = {
      defense: '0, 255, 200',
      enemy: '255, 60, 80',
      barrier: '180, 180, 180',
      fire: '255, 120, 40',
      erase: '255, 80, 80',
    };
    const cellPreviewRgb = previewRgbByTarget[this.paintTarget] || previewRgbByTarget.defense;
    const isErase = this.paintTarget === 'erase';
    // Line preview (during drag).
    if (this.mode === DESIGNER_MODE.LINE && this._linePreview && this._linePreview.length > 0) {
      for (const [x, y] of this._linePreview) {
        this._fillCell(ctx, x, y, `rgba(${cellPreviewRgb}, ${pulse})`);
      }
      return;
    }
    // Fill preview (during drag).
    if (this.mode === DESIGNER_MODE.FILL && this._fillPreview && this._fillPreview.length > 0) {
      const fillRgb = cellPreviewRgb;
      for (const [x, y] of this._fillPreview) {
        this._fillCell(ctx, x, y, `rgba(${fillRgb}, ${pulse * 0.8})`);
      }
      return;
    }
    if (!hover) return;
    // Pattern stamp preview (defense pattern).
    if (this.mode === DESIGNER_MODE.PATTERN && this._stampPattern) {
      const stamp = this._stampPattern;
      const offX = hover.x - Math.floor(stamp.width / 2);
      const offY = hover.y - Math.floor(stamp.height / 2);
      for (const [dx, dy] of stamp.cells) {
        const px = offX + dx;
        const py = offY + dy;
        if (px < 0 || px >= this.gridWidth || py < 0 || py >= this.gridHeight) continue;
        this._fillCell(ctx, px, py, `rgba(${cellPreviewRgb}, ${pulse})`);
      }
      // Bounding box (only for square topology).
      if (this.topologyId === 'square') {
        ctx.strokeStyle = `rgba(${cellPreviewRgb}, ${pulse * 0.7})`;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(offX * cs, offY * cs, stamp.width * cs, stamp.height * cs);
        ctx.setLineDash([]);
      }
      return;
    }
    // Base stamp preview.
    if (this.mode === DESIGNER_MODE.BASE && this._basePattern) {
      const stamp = this._basePattern;
      const offX = hover.x - Math.floor(stamp.width / 2);
      const offY = hover.y - Math.floor(stamp.height / 2);
      for (const [dx, dy] of stamp.cells) {
        const px = offX + dx;
        const py = offY + dy;
        if (px < 0 || px >= this.gridWidth || py < 0 || py >= this.gridHeight) continue;
        this._fillCell(ctx, px, py, `rgba(255, 119, 51, ${pulse})`);
      }
      if (this.topologyId === 'square') {
        ctx.strokeStyle = `rgba(255, 120, 60, ${pulse * 0.8})`;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(offX * cs, offY * cs, stamp.width * cs, stamp.height * cs);
        ctx.setLineDash([]);
      }
      return;
    }
    // Spawner stamp preview.
    if (this.mode === DESIGNER_MODE.SPAWNER && this._spawnerPattern) {
      const stamp = this._spawnerPattern;
      const offX = hover.x - Math.floor(stamp.width / 2);
      const offY = hover.y - Math.floor(stamp.height / 2);
      for (const [dx, dy] of stamp.cells) {
        const px = offX + dx;
        const py = offY + dy;
        if (px < 0 || px >= this.gridWidth || py < 0 || py >= this.gridHeight) continue;
        this._fillCell(ctx, px, py, `rgba(255, 102, 204, ${pulse})`);
      }
      if (this.topologyId === 'square') {
        ctx.strokeStyle = `rgba(255, 100, 220, ${pulse * 0.8})`;
        ctx.setLineDash([4, 2]);
        ctx.lineWidth = 2;
        ctx.strokeRect(offX * cs, offY * cs, stamp.width * cs, stamp.height * cs);
        ctx.setLineDash([]);
      }
      return;
    }
    // City placement preview (5×3 block).
    if (this.mode === DESIGNER_MODE.CITY) {
      const pattern = this._cityPattern;
      const cw = pattern ? pattern.width : CONFIG.CITY_WIDTH || 5;
      const ch = pattern ? pattern.height : CONFIG.CITY_HEIGHT || 3;
      const cx = Math.max(0, Math.min(this.gridWidth - cw, hover.x - Math.floor(cw / 2)));
      const cy = Math.max(0, Math.min(this.gridHeight - ch, hover.y - Math.floor(ch / 2)));
      if (pattern && pattern.cells) {
        for (const [dx, dy] of pattern.cells) {
          this._fillCell(ctx, cx + dx, cy + dy, `rgba(255, 255, 96, ${pulse * 0.8})`);
        }
      } else {
        for (let dy = 0; dy < ch; dy++) {
          for (let dx = 0; dx < cw; dx++) {
            this._fillCell(ctx, cx + dx, cy + dy, `rgba(255, 255, 96, ${pulse * 0.6})`);
          }
        }
      }
      if (this.topologyId === 'square') {
        ctx.strokeStyle = `rgba(255, 255, 96, ${pulse})`;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(cx * cs, cy * cs, cw * cs, ch * cs);
      }
      return;
    }
    // Defense brush preview (freehand mode).
    if (this.mode === DESIGNER_MODE.DEFENSE) {
      const r = Math.floor(this.brushSize / 2);
      const brushRgb = cellPreviewRgb;
      const alphaScale = isErase ? 1.0 : 0.6;
      if (this.topologyId === 'square') {
        ctx.strokeStyle = `rgba(${brushRgb}, ${pulse * alphaScale})`;
        ctx.lineWidth = isErase ? 1.5 : 1;
        ctx.strokeRect((hover.x - r) * cs, (hover.y - r) * cs, (r * 2 + 1) * cs, (r * 2 + 1) * cs);
      } else {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const px = hover.x + dx;
            const py = hover.y + dy;
            if (px < 0 || px >= this.gridWidth || py < 0 || py >= this.gridHeight) continue;
            this._fillCell(ctx, px, py, `rgba(${brushRgb}, ${pulse * 0.3})`);
          }
        }
      }
      return;
    }
  }

  _updateStats() {
    const ov = this.overlay;
    ov.querySelector('#ld-stat-cities').textContent = String(this.cities.length);
    ov.querySelector('#ld-stat-defense').textContent = String(this.defenseCells.size);
    const enEl = ov.querySelector('#ld-stat-enemy');
    if (enEl) enEl.textContent = String(this.enemyCells.size);
    ov.querySelector('#ld-stat-bases').textContent = String(this.bases.length);
    const spEl = ov.querySelector('#ld-stat-spawners');
    if (spEl) spEl.textContent = String(this.spawners.length);
    const baEl = ov.querySelector('#ld-stat-barriers');
    if (baEl) baEl.textContent = String(this.barrierCells.size);
    const fiEl = ov.querySelector('#ld-stat-fire');
    if (fiEl) fiEl.textContent = String(this.fireCells.size);
    // Compute aggregate city cell count from all placed cities.
    let cityCells = 0;
    for (const c of this.cities) {
      if (Array.isArray(c.cells)) {
        cityCells += c.cells.length;
      } else {
        cityCells += c.width * c.height;
      }
    }
    const ccEl = ov.querySelector('#ld-stat-city-cells');
    if (ccEl) ccEl.textContent = String(cityCells);
    // Aggregate enemy cells from bases (designed bases stamp MISSILE cells).
    let enemyCells = 0;
    for (const b of this.bases) {
      enemyCells += Array.isArray(b.cells) ? b.cells.length : 0;
    }
    const ecEl = ov.querySelector('#ld-stat-enemy-cells');
    if (ecEl) ecEl.textContent = String(enemyCells);
    // Update threshold display.
    const vthEl = ov.querySelector('#ld-stat-victory-thresh');
    const dthEl = ov.querySelector('#ld-stat-defeat-thresh');
    if (vthEl) {
      const v =
        this.levelSettings && this.levelSettings.VICTORY_ENEMY_THRESHOLD != null
          ? this.levelSettings.VICTORY_ENEMY_THRESHOLD
          : CONFIG.VICTORY_ENEMY_THRESHOLD || 0;
      vthEl.textContent = String(v);
    }
    if (dthEl) {
      const v =
        this.levelSettings && this.levelSettings.DEFEAT_CITY_THRESHOLD != null
          ? this.levelSettings.DEFEAT_CITY_THRESHOLD
          : CONFIG.DEFEAT_CITY_THRESHOLD || 0;
      dthEl.textContent = String(v);
    }
  }

  // ── Save / Load / Export ──────────────────────────────────────
  _serialize() {
    const out = {
      name: this.currentLevelName || 'untitled',
      createdAt: Date.now(),
      gridWidth: this.gridWidth,
      gridHeight: this.gridHeight,
      cities: this.cities.map((c) => {
        const out = { x: c.x, y: c.y, width: c.width, height: c.height };
        if (c.patternId) out.patternId = c.patternId;
        if (c.patternName) out.patternName = c.patternName;
        if (Array.isArray(c.cells)) out.cells = c.cells.map(([dx, dy]) => [dx, dy]);
        return out;
      }),
      defenses: Array.from(this.defenseCells).map((k) => k.split(',').map(Number)),
      enemies: Array.from(this.enemyCells).map((k) => k.split(',').map(Number)),
      barriers: Array.from(this.barrierCells).map((k) => k.split(',').map(Number)),
      fire: Array.from(this.fireCells).map((k) => k.split(',').map(Number)),
      bases: this.bases.map((pb) => ({
        patternId: pb.patternId,
        name: pb.name,
        x: pb.x,
        y: pb.y,
        width: pb.width,
        height: pb.height,
        cells: pb.cells.map(([dx, dy]) => [dx, dy]),
      })),
      spawners: this.spawners.map((sp) => ({
        patternId: sp.patternId,
        name: sp.name,
        x: sp.x,
        y: sp.y,
        width: sp.width,
        height: sp.height,
        cells: sp.cells.map(([dx, dy]) => [dx, dy]),
        interval: sp.interval || 2000,
        emitLimit: sp.emitLimit || 0,
        initialDelay: sp.initialDelay != null ? sp.initialDelay : sp.interval || 2000,
        padding: sp.padding != null ? sp.padding : 1,
      })),
      ruleset: this.ruleset,
      enemyRuleset: this.enemyRuleset || null,
      description: this.description,
      settings: JSON.parse(JSON.stringify(this.levelSettings || {})),
      allowedTools: { ...this.allowedTools },
      allowedPatterns: Array.from(this.allowedPatterns),
      colorTheme: { ...this.colorTheme },
      wrapVerticalShift: this.wrapVerticalShift | 0,
    };
    // Diagnostic: log age-related settings being saved.
    const s = out.settings || {};
    Logger.info(
      `[LevelDesigner] _serialize "${out.name}": ` +
        `UNLIMITED_CELL_AGE=${s.UNLIMITED_CELL_AGE}, ` +
        `DEFENSE_AGE_FRIENDLY=${s.DEFENSE_AGE_FRIENDLY}, ` +
        `UNLIMITED_DEF_AGE_FRIENDLY=${s.UNLIMITED_DEF_AGE_FRIENDLY}, ` +
        `DEFENSE_AGE_ENEMY=${s.DEFENSE_AGE_ENEMY}, ` +
        `UNLIMITED_DEF_AGE_ENEMY=${s.UNLIMITED_DEF_AGE_ENEMY}, ` +
        `MISSILE_AGE_FRIENDLY=${s.MISSILE_AGE_FRIENDLY}, ` +
        `UNLIMITED_MISS_AGE_FRIENDLY=${s.UNLIMITED_MISS_AGE_FRIENDLY}, ` +
        `MISSILE_AGE_ENEMY=${s.MISSILE_AGE_ENEMY}, ` +
        `UNLIMITED_MISS_AGE_ENEMY=${s.UNLIMITED_MISS_AGE_ENEMY}`
    );
    return out;
  }

  _deserialize(level) {
    this.gridWidth = level.gridWidth || 120;
    this.gridHeight = level.gridHeight || 80;
    this.cities = (level.cities || []).map((c) => {
      const city = { x: c.x, y: c.y, width: c.width, height: c.height };
      if (c.patternId) city.patternId = c.patternId;
      if (c.patternName) city.patternName = c.patternName;
      if (Array.isArray(c.cells)) city.cells = c.cells.map(([dx, dy]) => [dx, dy]);
      return city;
    });
    this.defenseCells = new Set((level.defenses || []).map(([x, y]) => `${x},${y}`));
    this.enemyCells = new Set((level.enemies || []).map(([x, y]) => `${x},${y}`));
    this.barrierCells = new Set((level.barriers || []).map(([x, y]) => `${x},${y}`));
    this.fireCells = new Set((level.fire || []).map(([x, y]) => `${x},${y}`));
    // Migration: accept both new "bases" (zoo-pattern shape) and old
    // legacy "patternBases" key; the old "bases" with {kind, x, y} are
    // no longer supported and skipped.
    const rawBases = level.patternBases || level.bases || [];
    this.bases = rawBases
      .filter((b) => Array.isArray(b.cells)) // skip legacy {kind,x,y} bases
      .map((pb) => ({
        patternId: pb.patternId,
        name: pb.name || pb.patternId,
        x: pb.x,
        y: pb.y,
        width: pb.width,
        height: pb.height,
        cells: (pb.cells || []).map(([dx, dy]) => [dx, dy]),
      }));
    this.spawners = (level.spawners || []).map((sp) => ({
      patternId: sp.patternId,
      name: sp.name || sp.patternId,
      x: sp.x,
      y: sp.y,
      width: sp.width,
      height: sp.height,
      cells: (sp.cells || []).map(([dx, dy]) => [dx, dy]),
      interval: sp.interval || 2000,
      emitLimit: sp.emitLimit || 0,
      initialDelay: sp.initialDelay != null ? sp.initialDelay : sp.interval || 2000,
      padding: sp.padding != null ? sp.padding : 1,
    }));
    this.ruleset = level.ruleset || 'conway';
    this.enemyRuleset = level.enemyRuleset || null;
    this.description = level.description || '';
    this.currentLevelName = level.name;
    // Load settings; if the level pre-dates settings support, fall back to defaults.
    this.levelSettings =
      level.settings && typeof level.settings === 'object'
        ? { ...this._defaultSettings(), ...level.settings }
        : this._defaultSettings();
    // Load allowed tools (default = all allowed).
    this.allowedTools = {
      freehand: true,
      line: true,
      pattern: true,
      fill: true,
    };
    if (level.allowedTools && typeof level.allowedTools === 'object') {
      for (const k of Object.keys(this.allowedTools)) {
        if (typeof level.allowedTools[k] === 'boolean') {
          this.allowedTools[k] = level.allowedTools[k];
        }
      }
    }
    // Load allowed patterns (empty = all allowed).
    this.allowedPatterns = new Set(
      Array.isArray(level.allowedPatterns) ? level.allowedPatterns : []
    );
    // Load color theme.
    this.colorTheme =
      level.colorTheme && typeof level.colorTheme === 'object' ? { ...level.colorTheme } : {};
    // Wrap settings.
    this.wrapVerticalShift = level.wrapVerticalShift | 0;
    this._syncUIFromState();
    this._resizeCanvas();
    this._updateStats();
  }

  _syncUIFromState() {
    const ov = this.overlay;
    ov.querySelector('#ld-name').value = this.currentLevelName || '';
    ov.querySelector('#ld-desc').value = this.description;
    ov.querySelector('#ld-ruleset').value = this.ruleset;
    this._updateRulesetDesc();
    this._updateTopologyFromRuleset();
    const enemySel = ov.querySelector('#ld-enemy-ruleset');
    if (enemySel) enemySel.value = this.enemyRuleset || '';
    ov.querySelector('#ld-grid-w').value = this.gridWidth;
    ov.querySelector('#ld-grid-h').value = this.gridHeight;
    const wrapInp = ov.querySelector('#ld-wrap-shift');
    if (wrapInp) wrapInp.value = this.wrapVerticalShift;
    this._syncSettingsPanelFromState();
    this._syncToolsPanelFromState();
    this._syncThemePanelFromState();
  }

  _save() {
    const name = (this.overlay.querySelector('#ld-name').value || '').trim();
    if (!name) {
      this._setStatus('Name required.', 'err');
      return false;
    }
    if (this.cities.length === 0) {
      if (!confirm('No cities placed. The level will be unwinnable. Save anyway?')) return false;
    }
    const level = this._serialize();
    level.name = name;
    saveLevel(name, level);
    this.currentLevelName = name;
    this._setStatus(`✓ Saved "${name}".`, 'ok');
    this._refreshLevelList();
    return true;
  }

  _saveAndPlay() {
    if (!this._save()) return;
    const name = this.currentLevelName;
    this.hide();
    if (this.game && this.game.startCustomLevel) {
      this.game.startCustomLevel(name);
      // startCustomLevel applies the level's STARTING_SPEED setting from
      // the level's settings snapshot, so we don't need to override here.
    }
  }

  _exportJSON() {
    const level = this._serialize();
    const json = JSON.stringify(level, null, 2);
    navigator.clipboard
      .writeText(json)
      .then(() => this._setStatus('✓ Copied JSON to clipboard.', 'ok'))
      .catch(() => {
        // Fallback: open in a prompt.
        prompt('Copy this JSON:', json);
      });
  }
  _importJSON() {
    const txt = window.prompt(
      'Paste level JSON below to import.\nThis will overwrite any saved level with the same name.',
      ''
    );
    if (!txt) return;
    const trimmed = txt.trim();
    if (!trimmed) return;
    const result = importLevelJSON(trimmed);
    if (result.ok) {
      this._setStatus(`✓ Imported "${result.name}".`, 'ok');
      this._refreshLevelList();
      // Auto-load the imported level into the designer.
      const lvl = getLevel(result.name);
      if (lvl) this._deserialize(lvl);
    } else {
      this._setStatus(`✗ Import failed: ${result.error}`, 'err');
    }
  }
  /**
   * Prompt the user for a publicly-hosted https:// URL that serves this
   * level's JSON, then build & copy a shareable game URL like:
   *   https://yoursite.com/?level=<encoded-url>
   *
   * The user is responsible for hosting the JSON (e.g. GitHub Gist raw,
   * Pastebin raw, their own static site). This designer doesn't upload.
   */
  _promptShareUrl() {
    const name = (this.overlay.querySelector('#ld-name').value || '').trim();
    if (!name) {
      this._setStatus('Please save the level first (give it a name).', 'err');
      return;
    }
    const hostedUrl = window.prompt(
      `Generate a shareable URL for "${name}".\n\n` +
        `Step 1: Host this level's JSON somewhere public over HTTPS:\n` +
        `  • GitHub Gist (raw URL)\n` +
        `  • Your own static site\n` +
        `  • Pastebin raw, etc.\n\n` +
        `Step 2: Paste the public https:// URL of the JSON file below:\n` +
        `(Use "Export JSON" first to get the JSON content to host.)`,
      'https://'
    );
    if (!hostedUrl) return;
    const trimmed = hostedUrl.trim();
    if (!trimmed.startsWith('https://')) {
      this._setStatus('URL must start with https://', 'err');
      return;
    }
    // Build the share URL.
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const shareUrl = `${baseUrl}?level=${encodeURIComponent(trimmed)}`;
    // Copy to clipboard.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(shareUrl)
        .then(() => {
          this._setStatus(`✓ Share URL copied to clipboard!`, 'ok');
          // Also show in a dialog so the user can double-check.
          window.alert(
            `Share URL copied to clipboard:\n\n${shareUrl}\n\n` +
              `Anyone who opens this URL will auto-load "${name}".`
          );
        })
        .catch(() => {
          window.prompt('Copy this URL:', shareUrl);
        });
    } else {
      window.prompt('Copy this URL:', shareUrl);
    }
  }

  _loadSelected() {
    const sel = this.overlay.querySelector('#ld-level-select');
    const name = sel.value;
    if (!name) {
      this._setStatus('Select a level first.', 'err');
      return;
    }
    const lvl = getLevel(name);
    if (!lvl) {
      this._setStatus('Level not found.', 'err');
      return;
    }
    this._deserialize(lvl);
    this._setStatus(`Loaded "${name}".`, 'ok');
  }

  _deleteSelected() {
    const sel = this.overlay.querySelector('#ld-level-select');
    const name = sel.value;
    if (!name) return;
    if (!confirm(`Delete "${name}"?`)) return;
    deleteLevel(name);
    this._setStatus(`Deleted "${name}".`, 'ok');
    this._refreshLevelList();
  }

  _refreshLevelList() {
    const sel = this.overlay.querySelector('#ld-level-select');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '';
    for (const lvl of listLevels()) {
      const opt = document.createElement('option');
      opt.value = lvl.name;
      const dim = `${lvl.gridWidth || '?'}×${lvl.gridHeight || '?'}`;
      opt.textContent = `${lvl.name} (${dim}, ${(lvl.cities || []).length} cities)`;
      sel.appendChild(opt);
    }
    if (current) sel.value = current;
  }

  _setStatus(msg, kind) {
    const el = this.overlay.querySelector('#ld-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = kind === 'ok' ? '#88ff88' : '#ff8888';
    if (this._statusTimer) clearTimeout(this._statusTimer);
    this._statusTimer = setTimeout(() => {
      if (el) el.textContent = '';
    }, 3500);
  }
  // ── Tools panel (enable/disable drawing tools + restrict patterns) ─
  _buildToolsPanel() {
    const toggleListEl = this.overlay.querySelector('#ld-tool-toggle-list');
    if (!toggleListEl) return;
    if (this._toolsPanelBuilt) return;
    this._toolsPanelBuilt = true;
    const toolDefs = [
      { id: 'freehand', name: '✏ Freehand', desc: 'Click-and-drag drawing' },
      { id: 'line', name: '📏 Line', desc: 'Straight-line tool' },
      { id: 'pattern', name: '🧬 Pattern', desc: 'Stamp pre-built patterns' },
      { id: 'fill', name: '🪣 Fill', desc: 'Region fill with patterns' },
    ];
    toggleListEl.innerHTML = '';
    this._toolCheckboxes = {};
    for (const def of toolDefs) {
      const row = document.createElement('div');
      row.className = 'ld-tool-toggle-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = `ld-tool-${def.id}`;
      cb.checked = !!this.allowedTools[def.id];
      cb.addEventListener('change', () => {
        this.allowedTools[def.id] = cb.checked;
        this._setStatus(`Tool "${def.name}" ${cb.checked ? 'enabled' : 'disabled'}.`, 'ok');
      });
      const label = document.createElement('label');
      label.htmlFor = `ld-tool-${def.id}`;
      label.innerHTML = `<strong>${def.name}</strong> <span style="color:#8080a0;">— ${def.desc}</span>`;
      row.appendChild(cb);
      row.appendChild(label);
      toggleListEl.appendChild(row);
      this._toolCheckboxes[def.id] = cb;
    }
    // Pattern allow-list controls.
    const allowAllBtn = this.overlay.querySelector('#ld-pattern-allow-all');
    const allowNoneBtn = this.overlay.querySelector('#ld-pattern-allow-none');
    const filterInput = this.overlay.querySelector('#ld-pattern-filter');
    allowAllBtn.addEventListener('click', () => {
      const patterns = listPatterns();
      this.allowedPatterns = new Set(patterns.map((p) => p.id));
      this._refreshPatternAllowList();
      this._setStatus(`Allowed ${this.allowedPatterns.size} pattern(s).`, 'ok');
    });
    allowNoneBtn.addEventListener('click', () => {
      this.allowedPatterns.clear();
      this._refreshPatternAllowList();
      this._setStatus('Cleared pattern allow-list (= all allowed).', 'ok');
    });
    filterInput.addEventListener('input', () => {
      this._patternFilterQuery = filterInput.value.toLowerCase();
      this._refreshPatternAllowList();
    });
    this._refreshPatternAllowList();
  }
  _refreshPatternAllowList() {
    const listEl = this.overlay.querySelector('#ld-pattern-allow-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    const q = this._patternFilterQuery || '';
    let patterns = listPatterns();
    if (q) {
      patterns = patterns.filter(
        (p) =>
          p.id.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          (p.tags && p.tags.some((t) => t.toLowerCase().includes(q)))
      );
    }
    // Limit to a reasonable count to avoid massive DOM trees.
    const MAX = 300;
    const limited = patterns.slice(0, MAX);
    for (const p of limited) {
      const row = document.createElement('div');
      row.className = 'ld-pattern-allow-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = `ld-allow-${p.id}`;
      cb.checked = this.allowedPatterns.has(p.id);
      cb.addEventListener('change', () => {
        if (cb.checked) this.allowedPatterns.add(p.id);
        else this.allowedPatterns.delete(p.id);
      });
      const label = document.createElement('label');
      label.htmlFor = `ld-allow-${p.id}`;
      label.innerHTML = `<strong>${this._escapeHtml(p.name)}</strong> <span style="color:#8080a0;font-size:10px;">[${p.category}]</span>`;
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
  _syncToolsPanelFromState() {
    if (!this._toolCheckboxes) return;
    for (const [k, cb] of Object.entries(this._toolCheckboxes)) {
      cb.checked = !!this.allowedTools[k];
    }
    this._refreshPatternAllowList();
  }
  _escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  }
  // ── Theme panel (color overrides) ─────────────────────────────
  _buildThemePanel() {
    if (this._themePanelBuilt) return;
    this._themePanelBuilt = true;
    const container = this.overlay.querySelector('#ld-theme-list');
    if (!container) return;
    container.innerHTML = '';
    const themeDefs = this._getThemeDefs();
    this._themeInputs = {};
    for (const def of themeDefs) {
      const row = document.createElement('div');
      row.className = 'ld-theme-row';
      const label = document.createElement('label');
      label.textContent = def.label;
      label.htmlFor = `ld-theme-${def.key}`;
      const swatch = document.createElement('span');
      swatch.className = 'ld-theme-swatch';
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.id = `ld-theme-${def.key}`;
      const textInput = document.createElement('input');
      textInput.type = 'text';
      textInput.className = 'ld-theme-text';
      textInput.placeholder = def.default || '';
      const initial =
        this.colorTheme[def.key] != null ? this.colorTheme[def.key] : def.default || '';
      textInput.value = this.colorTheme[def.key] || '';
      this._setSwatchAndColor(colorInput, swatch, initial);
      const apply = (val) => {
        if (val == null || val === '') {
          delete this.colorTheme[def.key];
          textInput.value = '';
          this._setSwatchAndColor(colorInput, swatch, def.default || '#000010');
        } else {
          this.colorTheme[def.key] = val;
          this._setSwatchAndColor(colorInput, swatch, val);
        }
      };
      colorInput.addEventListener('input', () => {
        apply(colorInput.value);
        textInput.value = colorInput.value;
      });
      textInput.addEventListener('change', () => apply(textInput.value.trim()));
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'ld-theme-clear';
      clearBtn.title = 'Reset to default';
      clearBtn.textContent = '✕';
      clearBtn.addEventListener('click', () => apply(''));
      row.appendChild(label);
      row.appendChild(swatch);
      row.appendChild(colorInput);
      row.appendChild(textInput);
      row.appendChild(clearBtn);
      container.appendChild(row);
      this._themeInputs[def.key] = { colorInput, textInput, swatch, def };
    }
    const resetBtn = this.overlay.querySelector('#ld-theme-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (!confirm('Reset all color theme overrides?')) return;
        this.colorTheme = {};
        this._syncThemePanelFromState();
        this._setStatus('Theme reset to defaults.', 'ok');
      });
    }
    const previewBtn = this.overlay.querySelector('#ld-theme-preview');
    if (previewBtn) {
      previewBtn.addEventListener('click', () => {
        this._draw();
        this._setStatus('Theme preview applied to map canvas.', 'ok');
      });
    }
    const randomizeBtn = this.overlay.querySelector('#ld-theme-randomize');
    if (randomizeBtn) {
      randomizeBtn.addEventListener('click', () => {
        this._randomizeColorTheme();
        this._setStatus('🎲 Color theme randomized!', 'ok');
      });
    }
  }
  _randomizeColorTheme() {
    // Generate a coherent random palette.
    const hueBase = Math.random() * 360;
    const hsl = (h, s, l, a = 1) =>
      a < 1 ? `hsla(${h % 360}, ${s}%, ${l}%, ${a})` : `hsl(${h % 360}, ${s}%, ${l}%)`;
    const hslHex = (h, s, l) => {
      // Convert HSL to hex for color picker compatibility.
      h = (h % 360) / 360;
      s = s / 100;
      l = l / 100;
      const a = s * Math.min(l, 1 - l);
      const f = (n) => {
        const k = (n + h * 12) % 12;
        const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return Math.round(c * 255)
          .toString(16)
          .padStart(2, '0');
      };
      return `#${f(0)}${f(8)}${f(4)}`;
    };
    // Background is dark, with a subtle tint.
    this.colorTheme.BACKGROUND = hslHex(hueBase, 60, 5);
    this.colorTheme.GRID = hslHex(hueBase + 20, 40, 10);
    this.colorTheme.MIDLINE = hslHex(hueBase + 40, 50, 20);
    // Cities — bright, warm complement.
    this.colorTheme.CELL_CITY = hslHex(hueBase + 180, 80, 65);
    // Explosions — orange/red.
    this.colorTheme.CELL_EXPLOSION = hslHex((hueBase + 30) % 360, 90, 55);
    // HUD text — light, slightly tinted.
    this.colorTheme.HUD_TEXT = hslHex(hueBase + 60, 30, 90);
    // Ink bar — bright accent.
    this.colorTheme.INK_BAR = hslHex(hueBase + 90, 80, 55);
    this.colorTheme.INK_BAR_BG = hslHex(hueBase + 90, 40, 15);
    // Floater colors.
    this.colorTheme.RETURN_FIRE_TEXT = hslHex(hueBase + 120, 70, 60);
    this.colorTheme.RICOCHET_TEXT = hslHex(hueBase + 60, 90, 60);
    // Draw zone.
    this.colorTheme.DRAW_ZONE_BOUNDARY = hsl(hueBase + 150, 70, 50, 0.4);
    this.colorTheme.DRAW_ZONE_TINT = hsl(hueBase + 150, 60, 40, 0.05);
    // Sync UI.
    this._syncThemePanelFromState();
    // Redraw the preview canvas.
    this._draw();
  }
  _setSwatchAndColor(colorInput, swatch, value) {
    swatch.style.background = value || 'transparent';
    // Try to coerce arbitrary CSS color into hex for the color picker.
    try {
      const probe = document.createElement('div');
      probe.style.color = value;
      document.body.appendChild(probe);
      const computed = getComputedStyle(probe).color;
      document.body.removeChild(probe);
      const m = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) {
        const r = parseInt(m[1], 10);
        const g = parseInt(m[2], 10);
        const b = parseInt(m[3], 10);
        const hex = '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
        colorInput.value = hex;
      }
    } catch (_e) {
      // ignore — leave color input unchanged
    }
  }
  _syncThemePanelFromState() {
    if (!this._themeInputs) return;
    for (const [key, entry] of Object.entries(this._themeInputs)) {
      const val = this.colorTheme[key] || '';
      entry.textInput.value = val;
      this._setSwatchAndColor(entry.colorInput, entry.swatch, val || entry.def.default || '');
    }
  }
  _getThemeDefs() {
    return [
      { key: 'BACKGROUND', label: 'Background', default: '#000010' },
      { key: 'GRID', label: 'Grid lines', default: '#0a0a20' },
      { key: 'MIDLINE', label: 'Draw-zone midline', default: '#2a2a5a' },
      { key: 'CELL_CITY', label: 'City cells', default: '#ffff60' },
      { key: 'CELL_ENEMY', label: 'Enemy cells', default: '#ff3344' },
      { key: 'CELL_EXPLOSION', label: 'Explosion cells', default: '#ff8800' },
      { key: 'CELL_FIRE', label: 'Fire cells', default: '#ff6622' },
      { key: 'HUD_TEXT', label: 'HUD text', default: '#e0e0ff' },
      { key: 'INK_BAR', label: 'Ink bar', default: '#00ffff' },
      { key: 'INK_BAR_BG', label: 'Ink bar bg', default: '#1a1a3a' },
      { key: 'RETURN_FIRE_TEXT', label: 'Return-fire text', default: '#00ffff' },
      { key: 'RICOCHET_TEXT', label: 'Ricochet text', default: '#ffaa00' },
      {
        key: 'DRAW_ZONE_BOUNDARY',
        label: 'Draw-zone boundary',
        default: 'rgba(0, 255, 200, 0.35)',
      },
      { key: 'DRAW_ZONE_TINT', label: 'Draw-zone tint', default: 'rgba(0, 255, 136, 0.04)' },
    ];
  }

  // ── Show / Hide ───────────────────────────────────────────────
  show() {
    if (this.visible) return;
    this.visible = true;
    if (this.game) {
      this._stashedSpeed = CONFIG.SPEED_MULTIPLIER;
      CONFIG.SPEED_MULTIPLIER = 0;
      const lbl = document.getElementById('speed-label');
      if (lbl) lbl.textContent = 'PAUSED (designer)';
    }
    // Hide menu overlay.
    const menuOverlay = document.getElementById('overlay');
    if (menuOverlay) menuOverlay.classList.add('hidden');
    this.overlay.classList.remove('hidden');
    this.overlay.removeAttribute('aria-hidden');
    this._syncUIFromState();
    this._refreshLevelList();
    // Sync topology from current ruleset.
    this._updateTopologyFromRuleset();
    // Defer resize until layout settles.
    requestAnimationFrame(() => this._resizeCanvas());
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.overlay.classList.add('hidden');
    this.overlay.setAttribute('aria-hidden', 'true');
    if (this.game && this._stashedSpeed != null) {
      CONFIG.SPEED_MULTIPLIER = this._stashedSpeed;
      this._stashedSpeed = null;
      if (this.game._applySpeedFromSlider) this.game._applySpeedFromSlider();
    }
    // Re-show menu overlay if we were on the menu.
    if (this.game && this.game.gameState) {
      const STATE_MENU = 'menu';
      const STATE_GAME_OVER = 'game_over';
      if (
        this.game.gameState.state === STATE_MENU ||
        this.game.gameState.state === STATE_GAME_OVER
      ) {
        const menuOverlay = document.getElementById('overlay');
        if (menuOverlay) menuOverlay.classList.remove('hidden');
      }
    }
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  isVisible() {
    return this.visible;
  }
  // ── Settings snapshot management ──────────────────────────────
  // Build a settings object from current CONFIG values.
  _captureCurrentSettings() {
    const out = {};
    for (const def of SETTING_DEFS) {
      out[def.key] = CONFIG[def.key];
    }
    for (const def of BOOLEAN_SETTING_DEFS) {
      out[def.key] = CONFIG[def.key];
    }
    // Diagnostic: log key age-related captured values.
    Logger.info(
      `[LevelDesigner] _captureCurrentSettings: ` +
        `DEFENSE_AGE_FRIENDLY=${out.DEFENSE_AGE_FRIENDLY}, ` +
        `DEFENSE_AGE_ENEMY=${out.DEFENSE_AGE_ENEMY}, ` +
        `MISSILE_AGE_FRIENDLY=${out.MISSILE_AGE_FRIENDLY}, ` +
        `MISSILE_AGE_ENEMY=${out.MISSILE_AGE_ENEMY}`
    );
    return out;
  }
  // Defaults from the current CONFIG snapshot (same as captureCurrent
  // but kept as a separate method in case we want to diverge later).
  _defaultSettings() {
    return this._captureCurrentSettings();
  }
  // Build the settings panel UI dynamically from SETTING_DEFS.
  _buildSettingsPanel() {
    const container = this.overlay.querySelector('#ld-settings-list');
    if (!container) return;
    container.innerHTML = '';
    // Group settings into sections for clarity.
    const sections = [
      {
        title: '🎮 Gameplay',
        keys: [
          'HARDCORE_MODE',
          'STARTING_SPEED',
          'VICTORY_ENEMY_THRESHOLD',
          'DEFEAT_CITY_THRESHOLD',
        ],
      },
      {
        title: '🚀 Enemy Pacing',
        keys: ['MISSILE_CASCADE_TICKS', 'AGE_CONTAGION_AMOUNT'],
      },
      {
        title: '⚔ Bases',
        keys: ['BASE_ZONE_HEIGHT', 'BASE_GLIDER_BUFFER'],
      },
      {
        title: '🏆 Scoring',
        keys: [
          'SCORE_TARGET_DESTROYED',
          'SCORE_FORTRESS_DESTROYED',
          'SCORE_BUNKER_DESTROYED',
          'SCORE_CRUISER_DESTROYED',
          'SCORE_SPAWNER_DESTROYED',
          'SCORE_CITY_SURVIVAL_PER_WAVE',
          'SCORE_WAVE_CLEAR_BASE',
          'SCORE_INK_EFFICIENCY',
          'SCORE_VICTORY_CITY_BONUS',
          'SCORE_VICTORY_FLAT',
          'SCORE_VICTORY_INK',
          'SCORE_CITY_CELL_LOST',
          'SCORE_FRIENDLY_FIRE_PENALTY',
          'SCORE_BREACH_PENALTY',
          'COMBO_WINDOW_MS',
          'COMBO_MAX_MULT',
          'COMBO_INCREMENT',
        ],
      },
      {
        title: '✏️ Drawing & Ink',
        keys: [
          'INITIAL_INK',
          'MAX_INK',
          'INK_REGEN_RATE',
          'CLEAR_REFUND_FRACTION',
          'INK_DRY_TICKS',
          'DRAW_ZONE_FRACTION',
          'REAR_DEAD_ZONE_HEIGHT',
          'SHOW_DRAW_ZONE',
        ],
      },
      {
        title: '⏳ Region-Specific Aging',
        keys: [
          'DEFENSE_AGE_FRIENDLY',
          'DEFENSE_AGE_NEUTRAL',
          'DEFENSE_AGE_ENEMY',
          'MISSILE_AGE_FRIENDLY',
          'MISSILE_AGE_NEUTRAL',
          'MISSILE_AGE_ENEMY',
        ],
      },
      {
        title: '⚡ Abilities',
        keys: [
          'ABILITY_DOUBLE_SCORE',
          'ABILITY_NO_DRY',
          'ABILITY_WAVE_BONUS',
          'ABILITY_SAFE_ZONE',
          'ABILITY_SLOW_MISSILES',
          'ABILITY_EMP_BURST',
          'ABILITY_INK_SURGE',
          'ABILITY_FREEZE',
        ],
      },
      {
        title: '🎯 Event Detection',
        keys: [
          'EVENT_RETURN_FIRE',
          'EVENT_RICOCHET',
          'EVENT_BREACH',
          'EVENT_CITY_HIT',
          'EVENT_ANNIHILATION',
        ],
      },
      {
        title: '⚙️ Advanced',
        keys: [
          'DEFENDER_TICKS',
          'ATTACKER_TICKS',
          'SIM_HASHLIFE_ENABLED',
          'VFX_PARTICLES',
          'VFX_SHOCKWAVES',
          'VFX_FLOATERS',
          'VFX_SCREEN_SHAKE',
          'VFX_CELL_GLOW',
          'VFX_DRAW_ZONE_TINT',
        ],
      },
    ];
    // Build a lookup of slider/checkbox defs by key.
    const sliderDefs = {};
    for (const d of SETTING_DEFS) sliderDefs[d.key] = d;
    const boolDefs = {};
    for (const d of BOOLEAN_SETTING_DEFS) boolDefs[d.key] = d;
    // Synthetic defs for keys that aren't in SETTING_DEFS / BOOLEAN_SETTING_DEFS
    // but should be exposed in the level designer.
    const eventKeys = [
      'EVENT_RETURN_FIRE',
      'EVENT_RICOCHET',
      'EVENT_BREACH',
      'EVENT_CITY_HIT',
      'EVENT_ANNIHILATION',
    ];
    for (const k of eventKeys) {
      if (!boolDefs[k]) boolDefs[k] = { key: k, id: `setting-${k.toLowerCase()}` };
    }
    if (!sliderDefs.STARTING_SPEED) {
      sliderDefs.STARTING_SPEED = {
        key: 'STARTING_SPEED',
        id: 'setting-starting-speed',
        format: (v) => `${v.toFixed(2)}x`,
      };
    }
    if (!sliderDefs.VICTORY_ENEMY_THRESHOLD) {
      sliderDefs.VICTORY_ENEMY_THRESHOLD = {
        key: 'VICTORY_ENEMY_THRESHOLD',
        id: 'setting-victory-threshold',
        format: (v) => `${v | 0} cells`,
      };
    }
    if (!sliderDefs.DEFEAT_CITY_THRESHOLD) {
      sliderDefs.DEFEAT_CITY_THRESHOLD = {
        key: 'DEFEAT_CITY_THRESHOLD',
        id: 'setting-defeat-threshold',
        format: (v) => `${v | 0} cells`,
      };
    }
    // Synthetic defs for scoring keys.
    const scoreKeys = [
      'SCORE_TARGET_DESTROYED',
      'SCORE_FORTRESS_DESTROYED',
      'SCORE_BUNKER_DESTROYED',
      'SCORE_CRUISER_DESTROYED',
      'SCORE_SPAWNER_DESTROYED',
      'SCORE_CITY_SURVIVAL_PER_WAVE',
      'SCORE_WAVE_CLEAR_BASE',
      'SCORE_VICTORY_CITY_BONUS',
      'SCORE_VICTORY_FLAT',
      'SCORE_CITY_CELL_LOST',
      'SCORE_FRIENDLY_FIRE_PENALTY',
      'SCORE_BREACH_PENALTY',
    ];
    for (const k of scoreKeys) {
      if (!sliderDefs[k]) {
        sliderDefs[k] = {
          key: k,
          id: `setting-${k.toLowerCase().replace(/_/g, '-')}`,
          format: (v) => `${v | 0} pts`,
        };
      }
    }
    // Scoring keys that are floats (per-unit multipliers).
    const scoreFloatKeys = ['SCORE_INK_EFFICIENCY', 'SCORE_VICTORY_INK', 'COMBO_INCREMENT'];
    for (const k of scoreFloatKeys) {
      if (!sliderDefs[k]) {
        sliderDefs[k] = {
          key: k,
          id: `setting-${k.toLowerCase().replace(/_/g, '-')}`,
          format: (v) => v.toFixed(2),
        };
      }
    }
    if (!sliderDefs.COMBO_WINDOW_MS) {
      sliderDefs.COMBO_WINDOW_MS = {
        key: 'COMBO_WINDOW_MS',
        id: 'setting-combo-window-ms',
        format: (v) => `${v | 0} ms`,
      };
    }
    if (!sliderDefs.COMBO_MAX_MULT) {
      sliderDefs.COMBO_MAX_MULT = {
        key: 'COMBO_MAX_MULT',
        id: 'setting-combo-max-mult',
        format: (v) => `${v.toFixed(2)}x`,
      };
    }
    this._settingsInputs = {}; // key → {input, valueEl, type}
    for (const sec of sections) {
      const header = document.createElement('div');
      header.className = 'ld-settings-section-header';
      header.textContent = sec.title;
      container.appendChild(header);
      for (const key of sec.keys) {
        if (sliderDefs[key]) {
          this._buildSliderRow(container, sliderDefs[key]);
        } else if (boolDefs[key]) {
          this._buildBoolRow(container, boolDefs[key]);
        }
      }
    }
    this._syncSettingsPanelFromState();
  }
  _buildSliderRow(container, def) {
    const row = document.createElement('div');
    row.className = 'ld-settings-row';
    const label = document.createElement('label');
    label.textContent = this._humanizeKey(def.key);
    label.htmlFor = `ld-set-${def.key}`;
    row.appendChild(label);
    // Pre-declare valueEl so handlers below can close over it.
    const valueEl = document.createElement('span');
    valueEl.className = 'ld-settings-value';
    // Controls cell holds the slider + numeric input + optional infinity toggle.
    const controls = document.createElement('div');
    controls.className = 'ld-settings-controls';
    const input = document.createElement('input');
    input.type = 'range';
    input.id = `ld-set-${def.key}`;
    const ranges = this._guessSliderRange(def.key);
    input.min = String(ranges.min);
    input.max = String(ranges.max);
    input.step = String(ranges.step);
    const UNLIMITED = CONFIG.UNLIMITED_SENTINEL || 999999;
    const initialValue =
      this.levelSettings[def.key] != null ? this.levelSettings[def.key] : CONFIG[def.key];
    // If the initial value is the unlimited sentinel, show a reasonable
    // default on the slider (the slider value is irrelevant when the
    // unlimited checkbox is checked, but it should still be visible).
    const isInitiallyUnlimited = initialValue >= UNLIMITED;
    const sliderDefault = isInitiallyUnlimited
      ? this._getDefaultForKey(def.key, ranges)
      : initialValue;
    input.value = String(sliderDefault);
    controls.appendChild(input);
    // Numeric input for precise entry.
    const numInput = document.createElement('input');
    numInput.type = 'number';
    numInput.className = 'ld-settings-num';
    numInput.min = String(ranges.min);
    numInput.max = String(ranges.max);
    numInput.step = String(ranges.step);
    numInput.value = String(sliderDefault);
    controls.appendChild(numInput);
    // Optional infinity toggle for "max age" / "unlimited" style keys.
    const unlimitedKey = this._getUnlimitedKeyFor(def.key);
    let infCheckbox = null;
    if (unlimitedKey) {
      const infLabel = document.createElement('label');
      infLabel.className = 'ld-unlimited-label';
      infLabel.title = 'Set to unlimited (∞)';
      infCheckbox = document.createElement('input');
      infCheckbox.type = 'checkbox';
      // Check the unlimited box if either the explicit flag is set OR
      // the numeric value is at/above the sentinel.
      const explicitUnlimited = !!this.levelSettings[unlimitedKey];
      infCheckbox.checked = explicitUnlimited || isInitiallyUnlimited;
      // Sync the flag back into levelSettings so save reflects reality.
      if (isInitiallyUnlimited && !explicitUnlimited) {
        this.levelSettings[unlimitedKey] = true;
      }
      // If we detected unlimited via sentinel value, also reset the
      // actual setting to the slider default so the saved level doesn't
      // carry the sentinel through both fields.
      if (isInitiallyUnlimited) {
        this.levelSettings[def.key] = sliderDefault;
      }
      infLabel.appendChild(infCheckbox);
      const txt = document.createElement('span');
      txt.textContent = ' ∞';
      infLabel.appendChild(txt);
      controls.appendChild(infLabel);
      infCheckbox.addEventListener('change', () => {
        this.levelSettings[unlimitedKey] = infCheckbox.checked;
        input.disabled = infCheckbox.checked;
        numInput.disabled = infCheckbox.checked;
        input.style.opacity = infCheckbox.checked ? '0.35' : '';
        numInput.style.opacity = infCheckbox.checked ? '0.35' : '';
        if (infCheckbox.checked) {
          valueEl.textContent = '∞';
          // Note: we intentionally do NOT overwrite levelSettings[def.key]
          // here — the unlimited flag is authoritative when checked, and
          // preserving the slider's numeric value lets us restore it if
          // the user later unchecks ∞.
        } else {
          // When unchecking ∞, the previously-stored value may still be
          // the unlimited sentinel (999999) from when the level was
          // first loaded. Sync the slider's current displayed value into
          // levelSettings so the game actually uses a finite age.
          const step = parseFloat(input.step) || 1;
          const raw = parseFloat(input.value);
          const v = Number.isInteger(step) ? Math.round(raw) : raw;
          this.levelSettings[def.key] = v;
          numInput.value = String(v);
          valueEl.textContent = def.format(parseFloat(input.value));
        }
      });
      if (infCheckbox.checked) {
        input.disabled = true;
        numInput.disabled = true;
        input.style.opacity = '0.35';
        numInput.style.opacity = '0.35';
      }
    }
    row.appendChild(controls);
    valueEl.textContent = infCheckbox && infCheckbox.checked ? '∞' : def.format(sliderDefault);
    row.appendChild(valueEl);
    // Sync handlers: slider ↔ numeric input.
    input.addEventListener('input', () => {
      const step = parseFloat(input.step) || 1;
      const raw = parseFloat(input.value);
      const v = Number.isInteger(step) ? Math.round(raw) : raw;
      this.levelSettings[def.key] = v;
      numInput.value = String(v);
      valueEl.textContent = def.format(v);
      // Diagnostic: log age slider changes specifically.
      if (def.key.startsWith('DEFENSE_AGE_') || def.key.startsWith('MISSILE_AGE_')) {
        Logger.info(`[LevelDesigner] Slider ${def.key} → ${v}`);
      }
      // If DRAW_ZONE_FRACTION changed, recompute BASE_ZONE_HEIGHT slider max.
      if (def.key === 'DRAW_ZONE_FRACTION' || def.key === 'REAR_DEAD_ZONE_HEIGHT') {
        this._updateBaseZoneSliderMax();
      }
      // If DRAW_ZONE_FRACTION changed, redraw the map preview.
      if (
        def.key === 'DRAW_ZONE_FRACTION' ||
        def.key === 'REAR_DEAD_ZONE_HEIGHT' ||
        def.key === 'BASE_ZONE_HEIGHT'
      ) {
        this._draw();
      }
      // Refresh stats when victory/defeat thresholds change.
      if (def.key === 'VICTORY_ENEMY_THRESHOLD' || def.key === 'DEFEAT_CITY_THRESHOLD') {
        this._updateStats();
      }
    });
    numInput.addEventListener('change', () => {
      const step = parseFloat(numInput.step) || 1;
      let raw = parseFloat(numInput.value);
      if (!Number.isFinite(raw)) return;
      // Allow numeric entry outside slider range — clamp slider to its
      // min/max but keep the actual value as entered.
      const v = Number.isInteger(step) ? Math.round(raw) : raw;
      this.levelSettings[def.key] = v;
      const sMin = parseFloat(input.min);
      const sMax = parseFloat(input.max);
      const clamped = Math.max(sMin, Math.min(sMax, v));
      input.value = String(clamped);
      valueEl.textContent = def.format(v);
      if (def.key === 'DRAW_ZONE_FRACTION' || def.key === 'REAR_DEAD_ZONE_HEIGHT') {
        this._updateBaseZoneSliderMax();
      }
      if (
        def.key === 'DRAW_ZONE_FRACTION' ||
        def.key === 'REAR_DEAD_ZONE_HEIGHT' ||
        def.key === 'BASE_ZONE_HEIGHT'
      ) {
        this._draw();
      }
      if (def.key === 'VICTORY_ENEMY_THRESHOLD' || def.key === 'DEFEAT_CITY_THRESHOLD') {
        this._updateStats();
      }
    });
    container.appendChild(row);
    this._settingsInputs[def.key] = {
      input,
      numInput,
      valueEl,
      infCheckbox,
      unlimitedKey,
      type: 'slider',
      def,
    };
  }
  // Recompute the BASE_ZONE_HEIGHT slider max based on current draw
  // zone fraction and rear dead zone. Called when those settings change.
  _updateBaseZoneSliderMax() {
    const entry = this._settingsInputs && this._settingsInputs.BASE_ZONE_HEIGHT;
    if (!entry) return;
    const range = this._guessSliderRange('BASE_ZONE_HEIGHT');
    entry.input.max = String(range.max);
    entry.numInput.max = String(range.max);
    // Clamp current value if it exceeds the new max.
    const cur = this.levelSettings.BASE_ZONE_HEIGHT;
    if (cur > range.max) {
      this.levelSettings.BASE_ZONE_HEIGHT = range.max;
      entry.input.value = String(range.max);
      entry.numInput.value = String(range.max);
      entry.valueEl.textContent = entry.def.format(range.max);
    }
  }
  _buildBoolRow(container, def) {
    const row = document.createElement('div');
    row.className = 'ld-settings-row ld-settings-row-check';
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `ld-set-${def.key}`;
    input.checked = !!(this.levelSettings[def.key] != null
      ? this.levelSettings[def.key]
      : CONFIG[def.key]);
    input.addEventListener('change', () => {
      this.levelSettings[def.key] = !!input.checked;
    });
    label.appendChild(input);
    const txt = document.createElement('span');
    txt.textContent = ' ' + this._humanizeKey(def.key);
    label.appendChild(txt);
    row.appendChild(label);
    container.appendChild(row);
    this._settingsInputs[def.key] = { input, type: 'bool', def };
  }
  // Guess slider ranges based on key heuristics. Mirrors index.html.
  _guessSliderRange(key) {
    const ranges = {
      INITIAL_INK: { min: 50, max: 9999, step: 10 },
      MAX_INK: { min: 100, max: 2000, step: 10 },
      INK_REGEN_RATE: { min: 0, max: 20, step: 0.1 },
      INK_DRY_TICKS: { min: 0, max: 30, step: 1 },
      TICK_RATE: { min: 40, max: 300, step: 10 },
      STARTING_SPEED: { min: 0, max: 16, step: 1 },
      DEFENDER_TICKS: { min: 1, max: 8, step: 1 },
      ATTACKER_TICKS: { min: 1, max: 8, step: 1 },
      MISSILES_PER_WAVE_BASE: { min: 1, max: 30, step: 1 },
      MISSILES_PER_WAVE_INC: { min: 0, max: 10, step: 1 },
      MISSILE_SPAWN_INTERVAL: { min: 200, max: 5000, step: 50 },
      MISSILE_SPAWN_DECREMENT: { min: 0, max: 200, step: 5 },
      MISSILE_SPAWN_MIN: { min: 100, max: 2000, step: 50 },
      DEFENSE_AGE_FRIENDLY: { min: 100, max: 10000, step: 100 },
      DEFENSE_AGE_ENEMY: { min: 100, max: 10000, step: 100 },
      DEFENSE_AGE_NEUTRAL: { min: 100, max: 10000, step: 100 },
      MISSILE_AGE_FRIENDLY: { min: 100, max: 10000, step: 100 },
      MISSILE_AGE_ENEMY: { min: 100, max: 10000, step: 100 },
      MISSILE_AGE_NEUTRAL: { min: 100, max: 10000, step: 100 },
      MISSILE_CASCADE_TICKS: { min: 0, max: 200, step: 1 },
      AGE_CONTAGION_AMOUNT: { min: 0, max: 200, step: 1 },
      CLEAR_REFUND_FRACTION: { min: 0, max: 1, step: 0.05 },
      DRAW_ZONE_FRACTION: { min: 0.2, max: 0.8, step: 0.05 },
      REAR_DEAD_ZONE_HEIGHT: { min: 0, max: 10, step: 1 },
      BASE_ZONE_HEIGHT: { min: 0, max: 60, step: 1 },
      BASE_SPAWN_COUNT_BASE: { min: 0, max: 6, step: 1 },
      BASE_SPAWN_COUNT_INC: { min: 0, max: 2, step: 0.1 },
      BASE_SPAWN_MAX: { min: 1, max: 12, step: 1 },
      BASE_GLIDER_BUFFER: { min: 1, max: 12, step: 1 },
      VICTORY_ENEMY_THRESHOLD: { min: 0, max: 100, step: 1 },
      DEFEAT_CITY_THRESHOLD: { min: 0, max: 200, step: 1 },
      // Scoring: structural kills.
      SCORE_TARGET_DESTROYED: { min: 0, max: 10000, step: 50 },
      SCORE_FORTRESS_DESTROYED: { min: 0, max: 10000, step: 50 },
      SCORE_BUNKER_DESTROYED: { min: 0, max: 10000, step: 50 },
      SCORE_CRUISER_DESTROYED: { min: 0, max: 10000, step: 50 },
      SCORE_SPAWNER_DESTROYED: { min: 0, max: 10000, step: 50 },
      // Scoring: wave completion.
      SCORE_CITY_SURVIVAL_PER_WAVE: { min: 0, max: 2000, step: 25 },
      SCORE_WAVE_CLEAR_BASE: { min: 0, max: 5000, step: 50 },
      SCORE_INK_EFFICIENCY: { min: 0, max: 5, step: 0.05 },
      // Scoring: victory.
      SCORE_VICTORY_CITY_BONUS: { min: 0, max: 10000, step: 50 },
      SCORE_VICTORY_FLAT: { min: 0, max: 20000, step: 100 },
      SCORE_VICTORY_INK: { min: 0, max: 10, step: 0.1 },
      // Scoring: penalties (negative).
      SCORE_CITY_CELL_LOST: { min: -1000, max: 0, step: 5 },
      SCORE_FRIENDLY_FIRE_PENALTY: { min: -1000, max: 0, step: 5 },
      SCORE_BREACH_PENALTY: { min: -1000, max: 0, step: 5 },
      // Combo system.
      COMBO_WINDOW_MS: { min: 500, max: 15000, step: 100 },
      COMBO_MAX_MULT: { min: 1, max: 20, step: 0.25 },
      COMBO_INCREMENT: { min: 0, max: 2, step: 0.05 },
    };
    // For BASE_ZONE_HEIGHT, the maximum depends on grid height AND the
    // current draw zone fraction. The base zone has to fit between the
    // top dead zone and the draw zone.
    if (key === 'BASE_ZONE_HEIGHT' && this.gridHeight) {
      // Compute available rows for the base zone:
      //   gridHeight - topDeadZone - drawZoneRows - rearDeadZone
      const settings = this.levelSettings || {};
      const drawFrac =
        settings.DRAW_ZONE_FRACTION != null
          ? settings.DRAW_ZONE_FRACTION
          : CONFIG.DRAW_ZONE_FRACTION || 0.5;
      const topDeadMax =
        settings.RETURN_FIRE_ZONE_MAX_Y != null
          ? settings.RETURN_FIRE_ZONE_MAX_Y
          : CONFIG.RETURN_FIRE_ZONE_MAX_Y || 4;
      const rearH =
        settings.REAR_DEAD_ZONE_HEIGHT != null
          ? settings.REAR_DEAD_ZONE_HEIGHT
          : CONFIG.REAR_DEAD_ZONE_HEIGHT || 2;
      const drawZoneRows = Math.floor(this.gridHeight * drawFrac);
      const topDeadRows = topDeadMax + 1;
      const available = this.gridHeight - topDeadRows - drawZoneRows - rearH - 1;
      const maxByGrid = Math.max(2, available);
      ranges.BASE_ZONE_HEIGHT.max = maxByGrid;
    }
    return ranges[key] || { min: 0, max: 1000, step: 1 };
  }
  // Get a sensible default slider value for a setting key. Used to populate
  // the slider when the actual value is "unlimited" (sentinel) so the
  // slider shows something meaningful when the user unchecks ∞.
  _getDefaultForKey(key, ranges) {
    const defaults = {
      MAX_INK: 300,
      INK_REGEN_RATE: 0.5,
      DEFENSE_AGE_FRIENDLY: 200,
      DEFENSE_AGE_ENEMY: 200,
      DEFENSE_AGE_NEUTRAL: 200,
      MISSILE_AGE_FRIENDLY: 200,
      MISSILE_AGE_ENEMY: 200,
      MISSILE_AGE_NEUTRAL: 200,
      MISSILE_CASCADE_TICKS: 20,
    };
    if (defaults[key] != null) return defaults[key];
    // Fall back to midpoint of the slider range.
    return Math.round((ranges.min + ranges.max) / 2);
  }
  // Convert a CONFIG key like "MISSILES_PER_WAVE_BASE" → "Missiles Per Wave (Base)".
  _humanizeKey(key) {
    return key
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  // Map a numeric setting key to its corresponding "UNLIMITED_*" toggle
  // key, if one exists. Mirrors SettingsPanel.UNLIMITED_DEFS.
  _getUnlimitedKeyFor(key) {
    const map = {
      MAX_INK: 'UNLIMITED_MAX_INK',
      INK_REGEN_RATE: 'UNLIMITED_INK_REGEN',
      MISSILE_CASCADE_TICKS: 'UNLIMITED_MISSILE_CASCADE',
      DEFENSE_AGE_FRIENDLY: 'UNLIMITED_DEF_AGE_FRIENDLY',
      DEFENSE_AGE_ENEMY: 'UNLIMITED_DEF_AGE_ENEMY',
      DEFENSE_AGE_NEUTRAL: 'UNLIMITED_DEF_AGE_NEUTRAL',
      MISSILE_AGE_FRIENDLY: 'UNLIMITED_MISS_AGE_FRIENDLY',
      MISSILE_AGE_ENEMY: 'UNLIMITED_MISS_AGE_ENEMY',
      MISSILE_AGE_NEUTRAL: 'UNLIMITED_MISS_AGE_NEUTRAL',
    };
    return map[key] || null;
  }
  // Push this.levelSettings into the UI.
  _syncSettingsPanelFromState() {
    if (!this._settingsInputs) return;
    const UNLIMITED = CONFIG.UNLIMITED_SENTINEL || 999999;
    for (const [key, entry] of Object.entries(this._settingsInputs)) {
      const v = this.levelSettings[key] != null ? this.levelSettings[key] : CONFIG[key];
      if (entry.type === 'slider') {
        // If the value is at/above the unlimited sentinel, show a default
        // on the slider instead of the sentinel value.
        const isUnlimited = v >= UNLIMITED;
        const ranges = this._guessSliderRange(key);
        const displayValue = isUnlimited ? this._getDefaultForKey(key, ranges) : v;
        entry.input.value = String(displayValue);
        if (entry.numInput) entry.numInput.value = String(displayValue);
        if (entry.infCheckbox && entry.unlimitedKey) {
          const explicitInf = !!this.levelSettings[entry.unlimitedKey];
          const inf = explicitInf || isUnlimited;
          entry.infCheckbox.checked = inf;
          // Sync the flag if we detected unlimited via sentinel.
          if (isUnlimited && !explicitInf) {
            this.levelSettings[entry.unlimitedKey] = true;
            this.levelSettings[key] = displayValue;
          }
          entry.input.disabled = inf;
          if (entry.numInput) entry.numInput.disabled = inf;
          entry.input.style.opacity = inf ? '0.35' : '';
          if (entry.numInput) entry.numInput.style.opacity = inf ? '0.35' : '';
        }
        if (entry.valueEl && entry.def) {
          const inf = entry.infCheckbox && entry.infCheckbox.checked;
          entry.valueEl.textContent = inf ? '∞' : entry.def.format(displayValue);
        }
      } else if (entry.type === 'bool') {
        entry.input.checked = !!v;
      }
    }
  }
}
