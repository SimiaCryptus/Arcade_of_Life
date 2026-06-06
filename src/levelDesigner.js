import { CONFIG, CELL_TYPE } from './config.js';
import { Logger } from './logger.js';
import {
  listLevels,
  saveLevel,
  deleteLevel,
  getLevel,
  onLevelsChanged,
  importLevelJSON,
} from './levels.js';
import { listRulesets } from './rules/index.js';
import { getPattern, clonePatternCells } from './patterns/index.js';
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
  ERASE: 'erase',
  PATTERN: 'pattern',
  SPAWNER: 'spawner',
  LINE: 'line',
  FILL: 'fill',
};

const BASE_KINDS = ['fortress', 'bunker', 'cruiser_e', 'cruiser_w'];

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
    this.cities = []; // {x, y, width, height}
    this.defenseCells = new Set(); // "x,y" keys
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
    this.currentLevelName = null;
    // Wave config overrides.
    this.waveConfig = {
      missilesPerWaveBase: 8,
      missilesPerWaveInc: 3,
      spawnInterval: 800,
      gliderTypes: {
        se: true,
        sw: true,
        heavy: false,
        lwss: false,
        mwss: false,
        twin: false,
        gun: false,
      },
    };
    this.ruleset = 'conway';
    this.description = '';
    this._stashedSpeed = null;
    this._isDragging = false;
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
              <button class="ld-tab" data-tab="settings">⚙ Settings</button>
            </div>
            <div id="ld-tab-map" class="ld-tab-panel active">
            <div id="ld-toolbar">
              <div class="ld-tool-group">
                <label>Tool:</label>
                <button class="ld-mode-btn active" data-mode="defense" title="Paint defense cells">✏ Defense</button>
                 <button class="ld-mode-btn" data-mode="line" title="Straight line">📏 Line</button>
                 <button class="ld-mode-btn" data-mode="fill" title="Region fill">🪣 Fill</button>
                <button class="ld-mode-btn" data-mode="city" title="Place city">🏙 City</button>
                 <button class="ld-mode-btn" data-mode="pattern" title="Stamp pattern from Zoo as defense cells">🧬 Pattern</button>
                  <button class="ld-mode-btn" data-mode="base" title="Stamp pattern from Zoo as enemy base">⚔ Base</button>
                  <button class="ld-mode-btn" data-mode="spawner" title="Place missile spawn point (pattern from Zoo)">🚀 Spawner</button>
                <button class="ld-mode-btn" data-mode="erase" title="Erase">🧹 Erase</button>
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
                </div>
                <div class="ld-section">
                  <h3>🌊 Wave Config</h3>
                  <label>Missiles/wave (base): <input id="ld-miss-base" type="number" min="0" max="50" step="1" /></label>
                  <label>Missiles/wave (inc): <input id="ld-miss-inc" type="number" min="0" max="20" step="1" /></label>
                  <label>Spawn interval (ms): <input id="ld-spawn-int" type="number" min="100" max="5000" step="50" /></label>
                  <div class="ld-checkboxes">
                    <strong>Glider types:</strong>
                    <label><input type="checkbox" data-glider="se" /> R-Glider (SE)</label>
                    <label><input type="checkbox" data-glider="sw" /> L-Glider (SW)</label>
                    <label><input type="checkbox" data-glider="heavy" /> Targets</label>
                    <label><input type="checkbox" data-glider="lwss" /> LWSS</label>
                    <label><input type="checkbox" data-glider="mwss" /> MWSS</label>
                    <label><input type="checkbox" data-glider="twin" /> Twin</label>
                    <label><input type="checkbox" data-glider="gun" /> ⚠ Gun</label>
                  </div>
                </div>
                <div class="ld-section">
                  <h3>📊 Stats</h3>
                  <div class="ld-stats">
                    <div>Cities: <strong id="ld-stat-cities">0</strong></div>
                    <div>Defense cells: <strong id="ld-stat-defense">0</strong></div>
                    <div>Bases: <strong id="ld-stat-bases">0</strong></div>
                    <div>Spawners: <strong id="ld-stat-spawners">0</strong></div>
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
  }
  _updateRulesetDesc() {
    const sel = this.overlay.querySelector('#ld-ruleset');
    const descEl = this.overlay.querySelector('#ld-ruleset-desc');
    if (!sel || !descEl) return;
    const def = listRulesets().find((d) => d.id === sel.value);
    descEl.textContent = def ? def.description || '' : '';
  }

  _resizeCanvas() {
    // Fit the designer canvas to the wrap with reasonable cell size.
    const wrap = this.overlay.querySelector('#ld-canvas-wrap');
    if (!wrap) return;
    const maxW = Math.min(wrap.clientWidth || 800, 1200);
    const maxH = Math.min(wrap.clientHeight || 600, 800);
    const sizeByW = Math.floor(maxW / this.gridWidth);
    const sizeByH = Math.floor(maxH / this.gridHeight);
    this.cellSize = Math.max(2, Math.min(sizeByW, sizeByH, 12));
    this.canvas.width = this.gridWidth * this.cellSize;
    this.canvas.height = this.gridHeight * this.cellSize;
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
      });
    });
    // Mode buttons.
    ov.querySelectorAll('.ld-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.mode = btn.dataset.mode;
        ov.querySelectorAll('.ld-mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
        ov.querySelector('#ld-pattern-selector').style.display =
          this.mode === DESIGNER_MODE.PATTERN ? 'flex' : 'none';
        ov.querySelector('#ld-base-selector').style.display =
          this.mode === DESIGNER_MODE.BASE ? 'flex' : 'none';
        ov.querySelector('#ld-spawner-selector').style.display =
          this.mode === DESIGNER_MODE.SPAWNER ? 'flex' : 'none';
        ov.querySelector('#ld-line-tools').style.display =
          this.mode === DESIGNER_MODE.LINE ? 'flex' : 'none';
        ov.querySelector('#ld-fill-tools').style.display =
          this.mode === DESIGNER_MODE.FILL ? 'flex' : 'none';
        // Cancel any in-progress line/fill drag when switching modes.
        this._lineStart = null;
        this._linePreview = null;
        this._fillStart = null;
        this._fillPreview = null;
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
    });
    // Clear all.
    ov.querySelector('#ld-clear-btn').addEventListener('click', () => {
      if (!confirm('Clear all cities, defenses, and bases?')) return;
      this.cities = [];
      this.defenseCells.clear();
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
        for (const [x, y] of this._linePreview) {
          this.defenseCells.add(`${x},${y}`);
        }
        this._lineStart = null;
        this._linePreview = null;
      }
      if (this._fillStart && this._fillPreview) {
        for (const [x, y] of this._fillPreview) {
          this.defenseCells.add(`${x},${y}`);
        }
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
      this._draw();
    });
    // Wave config.
    ov.querySelector('#ld-miss-base').addEventListener('input', (e) => {
      this.waveConfig.missilesPerWaveBase = parseInt(e.target.value, 10) || 0;
    });
    ov.querySelector('#ld-miss-inc').addEventListener('input', (e) => {
      this.waveConfig.missilesPerWaveInc = parseInt(e.target.value, 10) || 0;
    });
    ov.querySelector('#ld-spawn-int').addEventListener('input', (e) => {
      this.waveConfig.spawnInterval = parseInt(e.target.value, 10) || 800;
    });
    ov.querySelectorAll('input[data-glider]').forEach((cb) => {
      cb.addEventListener('change', () => {
        this.waveConfig.gliderTypes[cb.dataset.glider] = cb.checked;
      });
    });
    // Footer buttons.
    ov.querySelector('#ld-save-btn').addEventListener('click', () => this._save());
    ov.querySelector('#ld-play-btn').addEventListener('click', () => this._saveAndPlay());
    ov.querySelector('#ld-export-btn').addEventListener('click', () => this._exportJSON());
    ov.querySelector('#ld-import-btn').addEventListener('click', () => this._importJSON());
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
        e: DESIGNER_MODE.ERASE,
      };
      const k = e.key.toLowerCase();
      if (modeKeys[k]) {
        e.preventDefault();
        this._selectModeButton(modeKeys[k]);
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
    const x = Math.floor(((e.clientX - rect.left) * sx) / this.cellSize);
    const y = Math.floor(((e.clientY - rect.top) * sy) / this.cellSize);
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
      this.mode === DESIGNER_MODE.CITY ||
      this.mode === DESIGNER_MODE.ERASE
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
      case DESIGNER_MODE.ERASE:
        this._eraseAt(x, y);
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
    const w = CONFIG.CITY_WIDTH || 5;
    const h = CONFIG.CITY_HEIGHT || 3;
    const cx = Math.max(0, Math.min(this.gridWidth - w, x - Math.floor(w / 2)));
    const cy = Math.max(0, Math.min(this.gridHeight - h, y - Math.floor(h / 2)));
    // Prevent overlap.
    for (const c of this.cities) {
      if (cx < c.x + c.width && cx + w > c.x && cy < c.y + c.height && cy + h > c.y) {
        return;
      }
    }
    this.cities.push({ x: cx, y: cy, width: w, height: h });
  }

  _paintBrush(x, y, add) {
    const r = Math.floor(this.brushSize / 2);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || px >= this.gridWidth || py < 0 || py >= this.gridHeight) continue;
        const key = `${px},${py}`;
        if (add) this.defenseCells.add(key);
        else this.defenseCells.delete(key);
      }
    }
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
    };
    const title = titles[target] || titles.defense;
    // For spawners: restrict to gliders/spaceships (things that move).
    let filter = null;
    if (target === 'spawner') {
      filter = (pattern) => {
        return (
          pattern.category === 'spaceship' ||
          (pattern.tags && pattern.tags.includes('spaceship')) ||
          (pattern.tags && pattern.tags.includes('glider'))
        );
      };
    }
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
    for (const [dx, dy] of stamp.cells) {
      const px = offX + dx;
      const py = offY + dy;
      if (px < 0 || px >= this.gridWidth || py < 0 || py >= this.gridHeight) continue;
      this.defenseCells.add(`${px},${py}`);
    }
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
      interval: 2000, // default emission interval (ms)
    });
  }

  _eraseAt(x, y) {
    const r = Math.floor(this.brushSize / 2);
    // Remove defense cells.
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        this.defenseCells.delete(`${x + dx},${y + dy}`);
      }
    }
    // Remove cities under cursor.
    this.cities = this.cities.filter(
      (c) => !(x >= c.x && x < c.x + c.width && y >= c.y && y < c.y + c.height)
    );
    // Remove bases whose bounding box contains the cursor.
    this.bases = this.bases.filter(
      (pb) => !(x >= pb.x && x < pb.x + pb.width && y >= pb.y && y < pb.y + pb.height)
    );
    // Remove spawners whose bounding box contains the cursor.
    this.spawners = this.spawners.filter(
      (sp) => !(x >= sp.x && x < sp.x + sp.width && y >= sp.y && y < sp.y + sp.height)
    );
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
    // Background.
    ctx.fillStyle = '#000010';
    ctx.fillRect(0, 0, w, h);
    // Grid lines (subtle, only if cells are big enough).
    if (cs >= 4) {
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
    // Defense cells.
    ctx.fillStyle = '#00ff88';
    for (const key of this.defenseCells) {
      const [x, y] = key.split(',').map(Number);
      ctx.fillRect(x * cs + 1, y * cs + 1, cs - 2, cs - 2);
    }
    // Cities.
    ctx.fillStyle = '#ffff60';
    ctx.shadowColor = '#ffff60';
    ctx.shadowBlur = 6;
    for (const c of this.cities) {
      ctx.fillRect(c.x * cs, c.y * cs, c.width * cs, c.height * cs);
    }
    ctx.shadowBlur = 0;
    // Bases — draw cells with a red/orange tint plus a bbox outline.
    for (const pb of this.bases) {
      // Outline.
      ctx.strokeStyle = 'rgba(255, 120, 60, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(pb.x * cs, pb.y * cs, pb.width * cs, pb.height * cs);
      ctx.setLineDash([]);
      // Cells.
      ctx.fillStyle = '#ff7733';
      ctx.shadowColor = '#ff7733';
      ctx.shadowBlur = 4;
      for (const [dx, dy] of pb.cells) {
        const px = pb.x + dx;
        const py = pb.y + dy;
        ctx.fillRect(px * cs + 1, py * cs + 1, Math.max(1, cs - 2), Math.max(1, cs - 2));
      }
      ctx.shadowBlur = 0;
      // Tiny label above bounding box.
      if (cs >= 4 && pb.name) {
        ctx.fillStyle = '#ffaa66';
        ctx.font = `bold ${Math.max(8, Math.min(12, cs * 1.2))}px monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(pb.name, pb.x * cs + 2, pb.y * cs - 1);
      }
    }
    // Spawners — magenta/purple tint with double-outline.
    for (const sp of this.spawners) {
      ctx.strokeStyle = 'rgba(255, 100, 220, 0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 2]);
      ctx.strokeRect(sp.x * cs, sp.y * cs, sp.width * cs, sp.height * cs);
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff66cc';
      ctx.shadowColor = '#ff66cc';
      ctx.shadowBlur = 5;
      for (const [dx, dy] of sp.cells) {
        const px = sp.x + dx;
        const py = sp.y + dy;
        ctx.fillRect(px * cs + 1, py * cs + 1, Math.max(1, cs - 2), Math.max(1, cs - 2));
      }
      ctx.shadowBlur = 0;
      if (cs >= 4 && sp.name) {
        ctx.fillStyle = '#ffaaee';
        ctx.font = `bold ${Math.max(8, Math.min(12, cs * 1.2))}px monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText('🚀 ' + sp.name, sp.x * cs + 2, sp.y * cs - 1);
      }
    }
    // ── Previews ──────────────────────────────────────────
    this._drawPreviews();
  }
  // Render hover/drag previews on top of committed content.
  _drawPreviews() {
    const ctx = this.ctx;
    const cs = this.cellSize;
    const hover = this._hoverCell;
    const pulse = 0.55 + 0.15 * Math.sin(performance.now() / 200);
    // Line preview (during drag).
    if (this.mode === DESIGNER_MODE.LINE && this._linePreview && this._linePreview.length > 0) {
      ctx.fillStyle = `rgba(0, 255, 200, ${pulse})`;
      for (const [x, y] of this._linePreview) {
        ctx.fillRect(x * cs + 1, y * cs + 1, Math.max(1, cs - 2), Math.max(1, cs - 2));
      }
      return;
    }
    // Fill preview (during drag).
    if (this.mode === DESIGNER_MODE.FILL && this._fillPreview && this._fillPreview.length > 0) {
      ctx.fillStyle = `rgba(255, 200, 80, ${pulse * 0.8})`;
      for (const [x, y] of this._fillPreview) {
        ctx.fillRect(x * cs + 1, y * cs + 1, Math.max(1, cs - 2), Math.max(1, cs - 2));
      }
      return;
    }
    if (!hover) return;
    // Pattern stamp preview (defense pattern).
    if (this.mode === DESIGNER_MODE.PATTERN && this._stampPattern) {
      const stamp = this._stampPattern;
      const offX = hover.x - Math.floor(stamp.width / 2);
      const offY = hover.y - Math.floor(stamp.height / 2);
      ctx.fillStyle = `rgba(0, 255, 200, ${pulse})`;
      ctx.strokeStyle = `rgba(255, 255, 255, ${pulse * 0.5})`;
      ctx.lineWidth = 1;
      for (const [dx, dy] of stamp.cells) {
        const px = offX + dx;
        const py = offY + dy;
        if (px < 0 || px >= this.gridWidth || py < 0 || py >= this.gridHeight) continue;
        ctx.fillRect(px * cs + 1, py * cs + 1, Math.max(1, cs - 2), Math.max(1, cs - 2));
        ctx.strokeRect(px * cs + 0.5, py * cs + 0.5, cs - 1, cs - 1);
      }
      // Bounding box.
      ctx.strokeStyle = `rgba(0, 255, 200, ${pulse * 0.7})`;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(offX * cs, offY * cs, stamp.width * cs, stamp.height * cs);
      ctx.setLineDash([]);
      return;
    }
    // Base stamp preview.
    if (this.mode === DESIGNER_MODE.BASE && this._basePattern) {
      const stamp = this._basePattern;
      const offX = hover.x - Math.floor(stamp.width / 2);
      const offY = hover.y - Math.floor(stamp.height / 2);
      ctx.fillStyle = `rgba(255, 119, 51, ${pulse})`;
      for (const [dx, dy] of stamp.cells) {
        const px = offX + dx;
        const py = offY + dy;
        if (px < 0 || px >= this.gridWidth || py < 0 || py >= this.gridHeight) continue;
        ctx.fillRect(px * cs + 1, py * cs + 1, Math.max(1, cs - 2), Math.max(1, cs - 2));
      }
      ctx.strokeStyle = `rgba(255, 120, 60, ${pulse * 0.8})`;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(offX * cs, offY * cs, stamp.width * cs, stamp.height * cs);
      ctx.setLineDash([]);
      return;
    }
    // Spawner stamp preview.
    if (this.mode === DESIGNER_MODE.SPAWNER && this._spawnerPattern) {
      const stamp = this._spawnerPattern;
      const offX = hover.x - Math.floor(stamp.width / 2);
      const offY = hover.y - Math.floor(stamp.height / 2);
      ctx.fillStyle = `rgba(255, 102, 204, ${pulse})`;
      for (const [dx, dy] of stamp.cells) {
        const px = offX + dx;
        const py = offY + dy;
        if (px < 0 || px >= this.gridWidth || py < 0 || py >= this.gridHeight) continue;
        ctx.fillRect(px * cs + 1, py * cs + 1, Math.max(1, cs - 2), Math.max(1, cs - 2));
      }
      ctx.strokeStyle = `rgba(255, 100, 220, ${pulse * 0.8})`;
      ctx.setLineDash([4, 2]);
      ctx.lineWidth = 2;
      ctx.strokeRect(offX * cs, offY * cs, stamp.width * cs, stamp.height * cs);
      ctx.setLineDash([]);
      return;
    }
    // City placement preview (5×3 block).
    if (this.mode === DESIGNER_MODE.CITY) {
      const cw = CONFIG.CITY_WIDTH || 5;
      const ch = CONFIG.CITY_HEIGHT || 3;
      const cx = Math.max(0, Math.min(this.gridWidth - cw, hover.x - Math.floor(cw / 2)));
      const cy = Math.max(0, Math.min(this.gridHeight - ch, hover.y - Math.floor(ch / 2)));
      ctx.fillStyle = `rgba(255, 255, 96, ${pulse * 0.6})`;
      ctx.fillRect(cx * cs, cy * cs, cw * cs, ch * cs);
      ctx.strokeStyle = `rgba(255, 255, 96, ${pulse})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx * cs, cy * cs, cw * cs, ch * cs);
      return;
    }
    // Erase brush preview.
    if (this.mode === DESIGNER_MODE.ERASE) {
      const r = Math.floor(this.brushSize / 2);
      ctx.strokeStyle = `rgba(255, 80, 80, ${pulse})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect((hover.x - r) * cs, (hover.y - r) * cs, (r * 2 + 1) * cs, (r * 2 + 1) * cs);
      return;
    }
    // Defense brush preview (freehand mode).
    if (this.mode === DESIGNER_MODE.DEFENSE) {
      const r = Math.floor(this.brushSize / 2);
      ctx.strokeStyle = `rgba(0, 255, 136, ${pulse * 0.6})`;
      ctx.lineWidth = 1;
      ctx.strokeRect((hover.x - r) * cs, (hover.y - r) * cs, (r * 2 + 1) * cs, (r * 2 + 1) * cs);
      return;
    }
  }

  _updateStats() {
    const ov = this.overlay;
    ov.querySelector('#ld-stat-cities').textContent = String(this.cities.length);
    ov.querySelector('#ld-stat-defense').textContent = String(this.defenseCells.size);
    ov.querySelector('#ld-stat-bases').textContent = String(this.bases.length);
    const spEl = ov.querySelector('#ld-stat-spawners');
    if (spEl) spEl.textContent = String(this.spawners.length);
  }

  // ── Save / Load / Export ──────────────────────────────────────
  _serialize() {
    return {
      name: this.currentLevelName || 'untitled',
      createdAt: Date.now(),
      gridWidth: this.gridWidth,
      gridHeight: this.gridHeight,
      cities: this.cities.map((c) => ({ ...c })),
      defenses: Array.from(this.defenseCells).map((k) => k.split(',').map(Number)),
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
      })),
      waveConfig: JSON.parse(JSON.stringify(this.waveConfig)),
      ruleset: this.ruleset,
      description: this.description,
      settings: JSON.parse(JSON.stringify(this.levelSettings || {})),
    };
  }

  _deserialize(level) {
    this.gridWidth = level.gridWidth || 120;
    this.gridHeight = level.gridHeight || 80;
    this.cities = (level.cities || []).map((c) => ({ ...c }));
    this.defenseCells = new Set((level.defenses || []).map(([x, y]) => `${x},${y}`));
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
    }));
    this.waveConfig = level.waveConfig || this.waveConfig;
    this.ruleset = level.ruleset || 'conway';
    this.description = level.description || '';
    this.currentLevelName = level.name;
    // Load settings; if the level pre-dates settings support, fall back to defaults.
    this.levelSettings =
      level.settings && typeof level.settings === 'object'
        ? { ...this._defaultSettings(), ...level.settings }
        : this._defaultSettings();
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
    ov.querySelector('#ld-grid-w').value = this.gridWidth;
    ov.querySelector('#ld-grid-h').value = this.gridHeight;
    ov.querySelector('#ld-miss-base').value = this.waveConfig.missilesPerWaveBase;
    ov.querySelector('#ld-miss-inc').value = this.waveConfig.missilesPerWaveInc;
    ov.querySelector('#ld-spawn-int').value = this.waveConfig.spawnInterval;
    ov.querySelectorAll('input[data-glider]').forEach((cb) => {
      cb.checked = !!this.waveConfig.gliderTypes[cb.dataset.glider];
    });
    this._syncSettingsPanelFromState();
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
      // Start paused so the player can inspect the level before action begins.
      if (this.game.speedSlider) {
        const SPEED_PRESETS = this.game.constructor.SPEED_PRESETS;
        // Find the "Paused" preset (value === 0).
        const pausedIdx = 0; // First preset is always "Paused"
        this.game.speedSlider.value = String(pausedIdx);
        this.game._applySpeedFromSlider();
      } else {
        // Fallback: set CONFIG directly.
        if (typeof window !== 'undefined' && window.CONFIG) {
          window.CONFIG.SPEED_MULTIPLIER = 0;
        }
      }
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
          'INITIAL_INK',
          'MAX_INK',
          'INK_REGEN_RATE',
          'CITY_COUNT',
          'CLEAR_REFUND_FRACTION',
          'HARDCORE_MODE',
        ],
      },
      {
        title: '🚀 Enemies',
        keys: [
          'MISSILES_PER_WAVE_BASE',
          'MISSILES_PER_WAVE_INC',
          'MISSILE_SPAWN_INTERVAL',
          'MISSILE_SPAWN_DECREMENT',
          'MISSILE_SPAWN_MIN',
          'MISSILE_MAX_AGE_TICKS',
          'MISSILE_CASCADE_TICKS',
          'GLIDER_SE',
          'GLIDER_SW',
          'GLIDER_HEAVY',
          'GLIDER_LWSS',
          'GLIDER_MWSS',
          'GLIDER_TWIN',
          'GLIDER_GUN',
        ],
      },
      {
        title: '⚔ Bases',
        keys: [
          'BASE_SPAWN_ENABLED',
          'BASE_ZONE_HEIGHT',
          'BASE_SPAWN_COUNT_BASE',
          'BASE_SPAWN_COUNT_INC',
          'BASE_SPAWN_MAX',
          'BASE_GLIDER_BUFFER',
        ],
      },
      {
        title: '✏️ Drawing',
        keys: [
          'INK_DRY_TICKS',
          'DRAW_ZONE_FRACTION',
          'REAR_DEAD_ZONE_HEIGHT',
          'CELL_MAX_AGE_TICKS',
          'SHOW_DRAW_ZONE',
        ],
      },
      {
        title: '⏳ Region-Specific Aging',
        keys: [
          'DEFENSE_AGE_FRIENDLY',
          'DEFENSE_AGE_ENEMY',
          'MISSILE_AGE_FRIENDLY',
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
        title: '⚙️ Advanced',
        keys: [
          'TICK_RATE',
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
    // We use the same min/max/step values as the main settings panel by
    // reading them from the corresponding DOM elements when available;
    // otherwise fall back to sensible defaults.
    const row = document.createElement('div');
    row.className = 'ld-settings-row';
    const label = document.createElement('label');
    label.textContent = this._humanizeKey(def.key);
    label.htmlFor = `ld-set-${def.key}`;
    row.appendChild(label);
    const input = document.createElement('input');
    input.type = 'range';
    input.id = `ld-set-${def.key}`;
    const ranges = this._guessSliderRange(def.key);
    input.min = String(ranges.min);
    input.max = String(ranges.max);
    input.step = String(ranges.step);
    input.value = String(
      this.levelSettings[def.key] != null ? this.levelSettings[def.key] : CONFIG[def.key]
    );
    const valueEl = document.createElement('span');
    valueEl.className = 'ld-settings-value';
    valueEl.textContent = def.format(parseFloat(input.value));
    input.addEventListener('input', () => {
      const step = parseFloat(input.step) || 1;
      const raw = parseFloat(input.value);
      const v = Number.isInteger(step) ? Math.round(raw) : raw;
      this.levelSettings[def.key] = v;
      valueEl.textContent = def.format(v);
    });
    row.appendChild(input);
    row.appendChild(valueEl);
    container.appendChild(row);
    this._settingsInputs[def.key] = { input, valueEl, type: 'slider', def };
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
      MAX_INK: { min: 100, max: 9999, step: 10 },
      INK_REGEN_RATE: { min: 0, max: 10, step: 0.1 },
      INK_DRY_TICKS: { min: 0, max: 30, step: 1 },
      TICK_RATE: { min: 40, max: 300, step: 10 },
      DEFENDER_TICKS: { min: 1, max: 8, step: 1 },
      ATTACKER_TICKS: { min: 1, max: 8, step: 1 },
      MISSILES_PER_WAVE_BASE: { min: 1, max: 30, step: 1 },
      MISSILES_PER_WAVE_INC: { min: 0, max: 10, step: 1 },
      MISSILE_SPAWN_INTERVAL: { min: 200, max: 5000, step: 50 },
      MISSILE_SPAWN_DECREMENT: { min: 0, max: 200, step: 5 },
      MISSILE_SPAWN_MIN: { min: 100, max: 2000, step: 50 },
      CELL_MAX_AGE_TICKS: { min: 20, max: 999999, step: 10 },
      MISSILE_MAX_AGE_TICKS: { min: 20, max: 999999, step: 10 },
      DEFENSE_AGE_FRIENDLY: { min: 20, max: 999999, step: 10 },
      DEFENSE_AGE_ENEMY: { min: 20, max: 999999, step: 10 },
      MISSILE_AGE_FRIENDLY: { min: 20, max: 999999, step: 10 },
      MISSILE_AGE_ENEMY: { min: 20, max: 999999, step: 10 },
      MISSILE_CASCADE_TICKS: { min: 0, max: 100, step: 1 },
      CITY_COUNT: { min: 1, max: 10, step: 1 },
      CLEAR_REFUND_FRACTION: { min: 0, max: 1, step: 0.05 },
      DRAW_ZONE_FRACTION: { min: 0.2, max: 0.8, step: 0.05 },
      REAR_DEAD_ZONE_HEIGHT: { min: 0, max: 10, step: 1 },
      BASE_ZONE_HEIGHT: { min: 0, max: 20, step: 1 },
      BASE_SPAWN_COUNT_BASE: { min: 0, max: 6, step: 1 },
      BASE_SPAWN_COUNT_INC: { min: 0, max: 2, step: 0.1 },
      BASE_SPAWN_MAX: { min: 1, max: 12, step: 1 },
      BASE_GLIDER_BUFFER: { min: 1, max: 12, step: 1 },
    };
    return ranges[key] || { min: 0, max: 1000, step: 1 };
  }
  // Convert a CONFIG key like "MISSILES_PER_WAVE_BASE" → "Missiles Per Wave (Base)".
  _humanizeKey(key) {
    return key
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  // Push this.levelSettings into the UI.
  _syncSettingsPanelFromState() {
    if (!this._settingsInputs) return;
    for (const [key, entry] of Object.entries(this._settingsInputs)) {
      const v = this.levelSettings[key] != null ? this.levelSettings[key] : CONFIG[key];
      if (entry.type === 'slider') {
        entry.input.value = String(v);
        if (entry.valueEl && entry.def) entry.valueEl.textContent = entry.def.format(v);
      } else if (entry.type === 'bool') {
        entry.input.checked = !!v;
      }
    }
  }
}
