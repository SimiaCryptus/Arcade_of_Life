import { CONFIG } from './config.js';
import { Logger } from './logger.js';
import { saveLevel, deleteLevel, getLevel, onLevelsChanged, importLevelJSON } from './levels.js';
import { listRulesets, getRuleset, getNeighborhood } from './rules/index.js';
import { getTopology } from './topology.js';

import { DESIGNER_MODE } from './levelDesigner/constants.js';
import { createDesignerOverlay } from './levelDesigner/dom.js';
import { DesignerRenderer } from './levelDesigner/renderer.js';
import { computeLine, computeFillRect } from './levelDesigner/tools.js';
import { buildToolsPanel } from './levelDesigner/toolsPanel.js';
import { buildThemePanel } from './levelDesigner/themePanel.js';
import {
  buildSettingsPanel,
  captureCurrentSettings,
  defaultSettings,
} from './levelDesigner/settingsPanel.js';
import { serializeLevel, deserializeLevel, refreshLevelList } from './levelDesigner/serializer.js';

/**
 * LevelDesigner: full-screen overlay for crafting custom scenarios.
 *
 * Modes:
 *   - 'city'    : place city blocks
 *   - 'defense' : paint pre-built defense cells
 *   - 'base'    : place enemy base markers
 *   - 'pattern' : stamp arbitrary zoo pattern
 *   - 'spawner' : place missile spawn point
 *   - 'line'    : draw straight lines
 *   - 'fill'    : region fill
 */
export class LevelDesigner {
  constructor({ game } = {}) {
    this.game = game;
    this.visible = false;
    this.mode = DESIGNER_MODE.DEFENSE;
    this.baseKind = 'fortress';
    this.brushSize = 1;
    this.lineWidth = 1;
    this.dashPattern = 'solid';
    this.fillPattern = 'solid';
    this._lineStart = null;
    this._linePreview = null;
    this._fillStart = null;
    this._fillPreview = null;
    this._hoverCell = null;
    this.gridWidth = 120;
    this.gridHeight = 80;
    this.cellSize = 6;
    this.topologyId = 'square';
    this.cities = [];
    this.defenseCells = new Set();
    this.enemyCells = new Set();
    this.barrierCells = new Set();
    this.fireCells = new Set();
    this.paintTarget = 'defense';
    this.wrapVerticalShift = 0;
    this.bases = [];
    this.spawners = [];
    this._stampPattern = null;
    this._basePattern = null;
    this._spawnerPattern = null;
    this._cityPattern = null;
    this.currentLevelName = null;
    this.ruleset = 'conway';
    this.description = '';
    this._stashedSpeed = null;
    this._isDragging = false;
    this.enemyRuleset = null;
    this.allowedTools = { freehand: true, line: true, pattern: true, fill: true };
    this.allowedPatterns = new Set();
    this.colorTheme = {};
    this.levelSettings = captureCurrentSettings();
    // Sub-controllers (built lazily on tab open).
    this._toolsController = null;
    this._themeController = null;
    this._settingsController = null;
    this._buildDom();
    this._wireEvents();
    this._unsubLevels = onLevelsChanged(() => {
      if (this.visible) this._refreshLevelList();
    });
  }

  // ── DOM construction ──────────────────────────────────────────
  _buildDom() {
    this.overlay = createDesignerOverlay();
    this.canvas = this.overlay.querySelector('#ld-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.renderer = new DesignerRenderer(this);
    this._populateRulesets();
    this._settingsController = buildSettingsPanel(this);
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

  _updateTopologyFromRuleset() {
    let topologyId = 'square';
    try {
      const def = getRuleset(this.ruleset);
      if (def && def.neighborhood && !def._exoticType) {
        const nbhd = getNeighborhood(def.neighborhood);
        if (nbhd && nbhd.topology) topologyId = nbhd.topology;
      }
    } catch (e) {
      // default
    }
    if (topologyId !== this.topologyId) {
      this.topologyId = topologyId;
      this._resizeCanvas();
    } else {
      this._resizeCanvas();
      this._draw();
    }
  }

  _resizeCanvas() {
    const wrap = this.overlay.querySelector('#ld-canvas-wrap');
    if (!wrap) return;
    const maxW = Math.min(wrap.clientWidth || 800, 1200);
    const maxH = Math.min(wrap.clientHeight || 600, 800);
    const topology = getTopology(this.topologyId);
    if (this.topologyId === 'hex') {
      const SQRT3 = Math.sqrt(3);
      const csByW = Math.floor(maxW / ((SQRT3 / 2) * (this.gridWidth + 0.5)));
      const csByH = Math.floor(maxH / (0.75 * (this.gridHeight - 1) + 1));
      this.cellSize = Math.max(3, Math.min(csByW, csByH, 16));
      const dims = topology.canvasSize(this.gridWidth, this.gridHeight, this.cellSize);
      this.canvas.width = Math.ceil(dims.w);
      this.canvas.height = Math.ceil(dims.h);
    } else if (this.topologyId === 'tri') {
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
        if (target === 'map') {
          requestAnimationFrame(() => this._resizeCanvas());
        }
        if (target === 'tools' && !this._toolsController) {
          this._toolsController = buildToolsPanel(this);
        }
        if (target === 'theme' && !this._themeController) {
          this._themeController = buildThemePanel(this);
        }
      });
    });
    // Mode buttons.
    ov.querySelectorAll('.ld-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
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
        const usesPaintTarget =
          this.mode === DESIGNER_MODE.DEFENSE ||
          this.mode === DESIGNER_MODE.LINE ||
          this.mode === DESIGNER_MODE.FILL ||
          this.mode === DESIGNER_MODE.PATTERN;
        ov.querySelector('#ld-paint-target-group').style.display = usesPaintTarget
          ? 'flex'
          : 'none';
        // Brush size is only meaningful for freehand (defense) and line tools.
        const usesBrush = this.mode === DESIGNER_MODE.DEFENSE || this.mode === DESIGNER_MODE.LINE;
        const brushInputEl = ov.querySelector('#ld-brush-size');
        const brushGroup =
          (brushInputEl &&
            (brushInputEl.closest('.ld-control-group') ||
              brushInputEl.closest('.ld-tool-group') ||
              brushInputEl.parentElement)) ||
          null;
        if (brushGroup) {
          brushGroup.style.display = usesBrush ? 'flex' : 'none';
        }
        this._lineStart = null;
        this._linePreview = null;
        this._fillStart = null;
        this._fillPreview = null;
        this._draw();
      });
    });
    // Paint-target toggle.
    ov.querySelectorAll('.ld-target-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.paintTarget = btn.dataset.target;
        ov.querySelectorAll('.ld-target-btn').forEach((b) =>
          b.classList.toggle('active', b === btn)
        );
        this._draw();
      });
    });
    // Pattern picker buttons.
    ov.querySelector('#ld-pick-pattern-btn').addEventListener('click', () =>
      this._openZooForPattern('defense')
    );
    ov.querySelector('#ld-rotate-pattern-btn').addEventListener('click', () =>
      this._rotateStamp('defense')
    );
    ov.querySelector('#ld-flip-pattern-btn').addEventListener('click', () =>
      this._flipStamp('defense')
    );
    ov.querySelector('#ld-pick-base-btn').addEventListener('click', () =>
      this._openZooForPattern('base')
    );
    ov.querySelector('#ld-rotate-base-btn').addEventListener('click', () =>
      this._rotateStamp('base')
    );
    ov.querySelector('#ld-flip-base-btn').addEventListener('click', () => this._flipStamp('base'));
    ov.querySelector('#ld-pick-spawner-btn').addEventListener('click', () =>
      this._openZooForPattern('spawner')
    );
    ov.querySelector('#ld-rotate-spawner-btn').addEventListener('click', () =>
      this._rotateStamp('spawner')
    );
    ov.querySelector('#ld-flip-spawner-btn').addEventListener('click', () =>
      this._flipStamp('spawner')
    );
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
    ov.querySelector('#ld-fill-pattern').addEventListener('change', (e) => {
      this.fillPattern = e.target.value;
    });
    // Brush.
    const brushInput = ov.querySelector('#ld-brush-size');
    const brushLabel = ov.querySelector('#ld-brush-label');
    brushInput.addEventListener('input', () => {
      this.brushSize = parseInt(brushInput.value, 10) || 1;
      brushLabel.textContent = String(this.brushSize);
    });
    // Grid resize.
    const gridSizeBtn = ov.querySelector('#ld-grid-size-btn');
    const gridSizePopover = ov.querySelector('#ld-grid-size-popover');
    const gridSizeCancel = ov.querySelector('#ld-grid-size-cancel');
    const gridSizeLabel = ov.querySelector('#ld-grid-size-label');
    const gridWInput = ov.querySelector('#ld-grid-w');
    const gridHInput = ov.querySelector('#ld-grid-h');
    const updateGridSizeLabel = () => {
      if (gridSizeLabel) gridSizeLabel.textContent = `${this.gridWidth} × ${this.gridHeight}`;
    };
    updateGridSizeLabel();
    const closePopover = () => {
      if (gridSizePopover) gridSizePopover.classList.add('hidden');
    };
    const openPopover = () => {
      if (!gridSizePopover) return;
      if (gridWInput) gridWInput.value = this.gridWidth;
      if (gridHInput) gridHInput.value = this.gridHeight;
      gridSizePopover.classList.remove('hidden');
    };
    if (gridSizeBtn) {
      gridSizeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (gridSizePopover.classList.contains('hidden')) openPopover();
        else closePopover();
      });
    }
    if (gridSizeCancel) {
      gridSizeCancel.addEventListener('click', () => closePopover());
    }
    if (gridSizePopover) {
      gridSizePopover.addEventListener('click', (e) => e.stopPropagation());
      ov.querySelectorAll('.ld-grid-preset').forEach((btn) => {
        btn.addEventListener('click', () => {
          const w = parseInt(btn.dataset.w, 10);
          const h = parseInt(btn.dataset.h, 10);
          if (gridWInput) gridWInput.value = w;
          if (gridHInput) gridHInput.value = h;
        });
      });
    }
    // Click outside to close popover.
    document.addEventListener('click', (e) => {
      if (!gridSizePopover || gridSizePopover.classList.contains('hidden')) return;
      if (!this.visible) return;
      const wrap = gridSizePopover.closest('.ld-grid-size-wrap');
      if (wrap && !wrap.contains(e.target)) closePopover();
    });
    ov.querySelector('#ld-resize-btn').addEventListener('click', () => {
      const w = parseInt(ov.querySelector('#ld-grid-w').value, 10) || 120;
      const h = parseInt(ov.querySelector('#ld-grid-h').value, 10) || 80;
      if (!confirm(`Resize grid to ${w}×${h}? This may clip existing content.`)) return;
      this.gridWidth = Math.max(60, Math.min(400, w));
      this.gridHeight = Math.max(40, Math.min(300, h));
      this._clipContent();
      this._resizeCanvas();
      updateGridSizeLabel();
      closePopover();
      const bzInput = ov.querySelector('#ld-set-BASE_ZONE_HEIGHT');
      if (bzInput) {
        const newMax = Math.max(20, Math.floor(this.gridHeight * 0.6));
        bzInput.max = String(newMax);
      }
    });
    this._updateGridSizeLabel = updateGridSizeLabel;
    // Wrap shift.
    const wrapShiftInput = ov.querySelector('#ld-wrap-shift');
    if (wrapShiftInput) {
      wrapShiftInput.addEventListener('input', (e) => {
        this.wrapVerticalShift = parseInt(e.target.value, 10) || 0;
      });
    }
    // Spawner defaults.
    this._wireSpawnerDefaults(ov);
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
    // Pointer events.
    this.canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    this.canvas.addEventListener('pointerleave', () => {
      this._hoverCell = null;
      this._draw();
    });
    window.addEventListener('pointerup', () => {
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
    // Metadata.
    ov.querySelector('#ld-desc').addEventListener('input', (e) => {
      this.description = e.target.value;
    });
    ov.querySelector('#ld-ruleset').addEventListener('change', (e) => {
      this.ruleset = e.target.value;
      this._updateRulesetDesc();
      if (this.levelSettings) this.levelSettings.ACTIVE_RULESET = e.target.value;
      this._updateTopologyFromRuleset();
      this._resizeCanvas();
      this._draw();
    });
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
        this.levelSettings = captureCurrentSettings();
        if (this._settingsController) this._settingsController.syncFromState();
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
        this.levelSettings = defaultSettings();
        if (this._settingsController) this._settingsController.syncFromState();
        this._setStatus('Settings reset to defaults.', 'ok');
      });
    }
    // Keyboard shortcuts.
    window.addEventListener('keydown', (e) => this._onKeyDown(e));
  }

  _wireSpawnerDefaults(ov) {
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
  }

  _onKeyDown(e) {
    if (this.visible && e.key === 'Escape') {
      e.preventDefault();
      this.hide();
      return;
    }
    if (!this.visible) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey || e.altKey || e.metaKey) {
      if ((e.key || '').toLowerCase() === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this._save();
      }
      return;
    }
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
    if (k === 'e') {
      e.preventDefault();
      this._selectPaintTarget('erase');
      return;
    }
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
    }
  }

  _selectModeButton(mode) {
    const btn = this.overlay.querySelector(`.ld-mode-btn[data-mode="${mode}"]`);
    if (btn) btn.click();
  }

  _selectPaintTarget(target) {
    const btn = this.overlay.querySelector(`.ld-target-btn[data-target="${target}"]`);
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
    if (this._isDragging && this.mode === DESIGNER_MODE.LINE && this._lineStart && cell) {
      this._linePreview = computeLine(
        this._lineStart.x,
        this._lineStart.y,
        cell.x,
        cell.y,
        this.gridWidth,
        this.gridHeight,
        this.lineWidth,
        this.dashPattern
      );
      this._draw();
      return;
    }
    if (this._isDragging && this.mode === DESIGNER_MODE.FILL && this._fillStart && cell) {
      this._fillPreview = computeFillRect(
        this._fillStart.x,
        this._fillStart.y,
        cell.x,
        cell.y,
        this.gridWidth,
        this.gridHeight,
        this.fillPattern
      );
      this._draw();
      return;
    }
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
    const pattern = this._cityPattern;
    const w = pattern ? pattern.width : CONFIG.CITY_WIDTH || 5;
    const h = pattern ? pattern.height : CONFIG.CITY_HEIGHT || 3;
    const cx = Math.max(0, Math.min(this.gridWidth - w, x - Math.floor(w / 2)));
    const cy = Math.max(0, Math.min(this.gridHeight - h, y - Math.floor(h / 2)));
    for (const c of this.cities) {
      if (cx < c.x + c.width && cx + w > c.x && cy < c.y + c.height && cy + h > c.y) {
        return;
      }
    }
    const city = { x: cx, y: cy, width: w, height: h };
    if (pattern) {
      city.patternId = pattern.id;
      city.patternName = pattern.name;
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
    if (add && this.paintTarget === 'erase') {
      this._eraseStructuresAt(x, y);
    }
  }

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

  _eraseCellOnly(x, y) {
    const key = `${x},${y}`;
    this.defenseCells.delete(key);
    this.enemyCells.delete(key);
    this.barrierCells.delete(key);
    this.fireCells.delete(key);
  }

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

  _commitCellsToTarget(cells) {
    for (const [x, y] of cells) this._paintCell(x, y);
    if (this.paintTarget === 'erase') {
      for (const [x, y] of cells) this._eraseStructuresAt(x, y);
    }
  }

  // ── Zoo pattern stamping ──────────────────────────────────────
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
    this.overlay.classList.add('hidden');
    this.game.patternZoo.pickPattern({
      title,
      filter: null,
      categoryFilter: target === 'spawner' ? 'spaceship' : null,
      onPick: (pattern) => {
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

  _getStamp(target) {
    if (target === 'base') return this._basePattern;
    if (target === 'spawner') return this._spawnerPattern;
    return this._stampPattern;
  }

  _rotateStamp(target) {
    const stamp = this._getStamp(target);
    if (!stamp) {
      this._setStatus('Pick a pattern first.', 'err');
      return;
    }
    const h = stamp.height;
    stamp.cells = stamp.cells.map(([x, y]) => [h - 1 - y, x]);
    const newW = stamp.height;
    const newH = stamp.width;
    stamp.width = newW;
    stamp.height = newH;
    this._setStatus(`Rotated "${stamp.name}" → ${stamp.width}×${stamp.height}.`, 'ok');
    this._draw();
  }

  _flipStamp(target) {
    const stamp = this._getStamp(target);
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
    const ax = x - Math.floor(stamp.width / 2);
    const ay = y - Math.floor(stamp.height / 2);
    if (ax + stamp.width <= 0 || ay + stamp.height <= 0) return;
    if (ax >= this.gridWidth || ay >= this.gridHeight) return;
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
    const clipSet = (set) => {
      const out = new Set();
      for (const key of set) {
        const [x, y] = key.split(',').map(Number);
        if (x < this.gridWidth && y < this.gridHeight) out.add(key);
      }
      return out;
    };
    this.defenseCells = clipSet(this.defenseCells);
    this.enemyCells = clipSet(this.enemyCells);
    this.barrierCells = clipSet(this.barrierCells);
    this.fireCells = clipSet(this.fireCells);
    this.bases = this.bases.filter(
      (pb) => pb.x + pb.width <= this.gridWidth && pb.y + pb.height <= this.gridHeight
    );
    this.spawners = this.spawners.filter(
      (sp) => sp.x + sp.width <= this.gridWidth && sp.y + sp.height <= this.gridHeight
    );
  }

  // ── Rendering ─────────────────────────────────────────────────
  _draw() {
    if (this.renderer) this.renderer.draw();
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
    let cityCells = 0;
    for (const c of this.cities) {
      cityCells += Array.isArray(c.cells) ? c.cells.length : c.width * c.height;
    }
    const ccEl = ov.querySelector('#ld-stat-city-cells');
    if (ccEl) ccEl.textContent = String(cityCells);
    let enemyCells = 0;
    for (const b of this.bases) {
      enemyCells += Array.isArray(b.cells) ? b.cells.length : 0;
    }
    const ecEl = ov.querySelector('#ld-stat-enemy-cells');
    if (ecEl) ecEl.textContent = String(enemyCells);
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
    return serializeLevel(this);
  }

  _deserialize(level) {
    deserializeLevel(this, level, () => defaultSettings());
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
    if (this._updateGridSizeLabel) this._updateGridSizeLabel();
    const wrapInp = ov.querySelector('#ld-wrap-shift');
    if (wrapInp) wrapInp.value = this.wrapVerticalShift;
    if (this._settingsController) this._settingsController.syncFromState();
    if (this._toolsController) this._toolsController.syncFromState();
    if (this._themeController) this._themeController.syncFromState();
    // Refresh brush visibility based on current mode.
    const activeModeBtn = ov.querySelector('.ld-mode-btn.active');
    if (activeModeBtn) {
      const usesBrush = this.mode === DESIGNER_MODE.DEFENSE || this.mode === DESIGNER_MODE.LINE;
      const brushInputEl = ov.querySelector('#ld-brush-size');
      const brushGroup =
        (brushInputEl &&
          (brushInputEl.closest('.ld-control-group') ||
            brushInputEl.closest('.ld-tool-group') ||
            brushInputEl.parentElement)) ||
        null;
      if (brushGroup) {
        brushGroup.style.display = usesBrush ? 'flex' : 'none';
      }
    }
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
    }
  }

  _exportJSON() {
    const level = this._serialize();
    const json = JSON.stringify(level, null, 2);
    navigator.clipboard
      .writeText(json)
      .then(() => this._setStatus('✓ Copied JSON to clipboard.', 'ok'))
      .catch(() => prompt('Copy this JSON:', json));
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
      const lvl = getLevel(result.name);
      if (lvl) this._deserialize(lvl);
    } else {
      this._setStatus(`✗ Import failed: ${result.error}`, 'err');
    }
  }

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
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const shareUrl = `${baseUrl}?level=${encodeURIComponent(trimmed)}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(shareUrl)
        .then(() => {
          this._setStatus(`✓ Share URL copied to clipboard!`, 'ok');
          window.alert(
            `Share URL copied to clipboard:\n\n${shareUrl}\n\n` +
              `Anyone who opens this URL will auto-load "${name}".`
          );
        })
        .catch(() => window.prompt('Copy this URL:', shareUrl));
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
    refreshLevelList(this.overlay);
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
    // Ensure any active Tower Defense UI (ink selector, ready overlay)
    // is torn down when re-entering the designer.
    if (this.game && this.game.towerDefense && this.game.towerDefense.active) {
      this.game.towerDefense.deactivate();
    }
    const menuOverlay = document.getElementById('overlay');
    if (menuOverlay) menuOverlay.classList.add('hidden');
    this.overlay.classList.remove('hidden');
    this.overlay.removeAttribute('aria-hidden');
    this._syncUIFromState();
    this._refreshLevelList();
    this._updateTopologyFromRuleset();
    requestAnimationFrame(() => this._resizeCanvas());
  }

  hide() {
    if (!this.visible) return;
    try {
      const url = new URL(window.location.href);
      let changed = false;
      if (url.searchParams.has('mode')) {
        url.searchParams.delete('mode');
        changed = true;
      }
      if (changed) {
        const newHref = url.pathname + (url.search ? url.search : '') + url.hash;
        window.history.replaceState({}, '', newHref);
        Logger.info('Cleared level/autostart query params from URL.');
      }
    } catch (e) {
      Logger.warn('Failed to clean URL on exit:', e);
    }
    this.visible = false;
    this.overlay.classList.add('hidden');
    this.overlay.setAttribute('aria-hidden', 'true');
    if (this.game && this._stashedSpeed != null) {
      CONFIG.SPEED_MULTIPLIER = this._stashedSpeed;
      this._stashedSpeed = null;
      if (this.game._applySpeedFromSlider) this.game._applySpeedFromSlider();
    }
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
}

// Re-export for backwards compatibility.
export { DESIGNER_MODE };
// Silence unused import warning — Logger is retained for future diagnostic
// hooks that may be added back into this module.
void Logger;
