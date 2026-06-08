import { DRAW_MODE } from './input.js';
import { Logger } from './logger.js';
import { PATTERN_PRESETS as LIBRARY_PRESETS } from './patterns/index.js';
import { normalizeCells } from './patterns/library.js';
import { listRulesets, getRuleset } from './rules/ruleset.js';
import { CONFIG } from './config.js';
import { getPattern } from './patterns/index.js';

/**
 * Pattern presets used by the in-game drawing tools.
 *
 * Sourced from the centralized pattern library (src/patterns/library.js)
 * for consistency with other game systems and unit tests. Kept exported
 * under the legacy name `PATTERN_PRESETS` for back-compat with any
 * external code that may reference it.
 */
export const PATTERN_PRESETS = LIBRARY_PRESETS;

/**
 * Wires up the drawing tools UI: mode buttons, line width/dash controls,
 * and the pattern editor mini-canvas.
 */
export class DrawToolsPanel {
  constructor(input) {
    Logger.info('[DrawTools] Constructor starting...');
    this.input = input;
    this.editorSize = 16; // 16x16 grid in pattern editor (larger for overlay)
    // Story engine reference, set externally. When set, only patterns
    // present in storyEngine.unlockedPatterns are stampable from presets.
    this.storyEngine = null;
    // Story-mode tool locks. When storyEngine is set & active, only modes
    // in storyEngine.unlockedTools are selectable. Free-play = no locks.
    // Track the currently-loaded preset name so the combobox stays in sync
    // unless the user has manually edited the pattern in the editor.
    this._activePresetName = '';
    this._editorDirty = false; // true once user clicks a cell manually
    this._editorPanelOpen = false;
    // Editor mode: 'view' (just stamping built-in), 'new' (creating a new
    // custom pattern), 'edit' (editing an existing custom pattern).
    this._editorMode = 'view';
    this._editorEditingName = null; // name of custom pattern being edited
    // Stashed speed multiplier while the editor is open (to restore on close).
    this._editorPauseSpeed = null;
    // Callback for external coordination (e.g., main.js syncing speed slider).
    this.onEditorOpen = null;
    this.onEditorClose = null;
    // Level-imposed restrictions (set by main.js when a custom level starts).
    // null = no restriction.
    this._levelToolRestriction = null; // object { freehand: bool, line: bool, ... }
    this._levelPatternRestriction = null; // Set<string> of allowed preset ids
    // Diagnostic: verify critical DOM elements exist before wiring.
    const diagIds = [
      'pattern-editor-toggle',
      'pattern-editor-panel',
      'pattern-editor-overlay',
      'exit-to-menu-button',
      'pattern-editor',
      'pattern-presets',
    ];
    for (const id of diagIds) {
      const el = document.getElementById(id);
      Logger.info(`[DrawTools]   DOM check: #${id} = ${el ? 'FOUND' : 'MISSING'}`);
    }

    this._initModeButtons();
    this._initLineControls();
    this._initPatternEditor();
    this._initEditorJsonIO();
    this._initPresets();
    this._initKeyboard();
    this._initEditorToggle();
    this._initEditorTransformHints();
    this._initEditorSaveControls();
    this._updateVisibility();
    Logger.info('[DrawTools] Constructor complete.');
  }

  _initModeButtons() {
    this.modeButtons = document.querySelectorAll('.mode-btn');
    this.modeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (!this._isToolUnlocked(mode)) {
          Logger.info(`Tool "${mode}" is locked in story mode.`);
          return;
        }
        this.setMode(mode);
      });
    });
    // Wire up the new dropdown selector for draw modes.
    this._initModeDropdown();
  }
  _initModeDropdown() {
    const trigger = document.getElementById('mode-dropdown-trigger');
    const panel = document.getElementById('mode-dropdown-panel');
    const wrap = trigger && trigger.closest('.mode-dropdown-wrap');
    const labelEl = document.getElementById('mode-dropdown-label');
    const iconEl = document.getElementById('mode-dropdown-icon');
    if (!trigger || !panel || !wrap) {
      Logger.warn('[DrawTools] Mode dropdown elements not found.');
      return;
    }
    const MODE_META = {
      freehand: { label: 'Freehand', icon: '✎' },
      line: { label: 'Line', icon: '／' },
      pattern: { label: 'Pattern', icon: '▦' },
      fill: { label: 'Fill', icon: '▣' },
    };
    const setOpen = (open) => {
      panel.classList.toggle('hidden', !open);
      wrap.classList.toggle('open', open);
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(panel.classList.contains('hidden'));
    });
    const options = panel.querySelectorAll('.mode-option');
    options.forEach((opt) => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = opt.dataset.mode;
        if (!this._isToolUnlocked(mode)) {
          Logger.info(`Tool "${mode}" is locked.`);
          return;
        }
        this.setMode(mode);
        setOpen(false);
      });
    });
    // Sync visual state when mode changes externally.
    this._syncModeDropdown = () => {
      const cur = this.input ? this.input.mode : 'freehand';
      const meta = MODE_META[cur] || MODE_META.freehand;
      if (labelEl) labelEl.textContent = meta.label;
      if (iconEl) iconEl.textContent = meta.icon;
      options.forEach((opt) => {
        const isCur = opt.dataset.mode === cur;
        opt.classList.toggle('active', isCur);
        const isLocked = !this._isToolUnlocked(opt.dataset.mode);
        opt.disabled = isLocked;
        opt.style.opacity = isLocked ? '0.35' : '';
        opt.style.cursor = isLocked ? 'not-allowed' : '';
      });
    };
    this._syncModeDropdown();
    // Close on outside click.
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) setOpen(false);
    });
    // Close on Esc.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.classList.contains('hidden')) {
        setOpen(false);
      }
    });
  }

  _isToolUnlocked(mode) {
    // Level-imposed restriction takes precedence over story mode unlocks.
    if (
      this._levelToolRestriction &&
      Object.prototype.hasOwnProperty.call(this._levelToolRestriction, mode)
    ) {
      if (!this._levelToolRestriction[mode]) return false;
    }
    if (!this.storyEngine || !this.storyEngine.isActive()) return true;
    const unlocked = this.storyEngine.unlockedTools;
    if (!unlocked) return true;
    return unlocked.has(mode);
  }
  // Public API: set per-level tool restrictions. Pass null to clear.
  setLevelToolRestriction(restrictions) {
    this._levelToolRestriction = restrictions;
    this.refreshToolLockState();
    if (this.refreshPatternLockState) this.refreshPatternLockState();
  }
  // Public API: set per-level allowed pattern set. Pass null to clear.
  setLevelPatternRestriction(allowedSet) {
    this._levelPatternRestriction = allowedSet;
    if (this.refreshPatternLockState) this.refreshPatternLockState();
  }

  // Called by StoryEngine when tool unlocks change or story starts/stops.
  refreshToolLockState() {
    if (!this.modeButtons) return;
    this.modeButtons.forEach((btn) => {
      const mode = btn.dataset.mode;
      const unlocked = this._isToolUnlocked(mode);
      btn.disabled = !unlocked;
      if (!unlocked) {
        btn.style.opacity = '0.35';
        btn.style.cursor = 'not-allowed';
        btn.title = '🔒 Locked — unlock via story progression';
      } else {
        btn.style.opacity = '';
        btn.style.cursor = '';
        // Restore original tooltip.
        const tips = {
          freehand: 'Freehand draw (F)',
          line: 'Straight line (L)',
          pattern: 'Pattern stamp (P)',
        };
        btn.title = tips[mode] || '';
      }
    });
    if (this._syncModeDropdown) this._syncModeDropdown();
    // If current mode is now locked, fall back to freehand.
    if (this.input && !this._isToolUnlocked(this.input.mode)) {
      this.setMode(DRAW_MODE.FREEHAND);
    }
  }

  setMode(mode) {
    if (!this._isToolUnlocked(mode)) return;
    this.input.setMode(mode);
    this.modeButtons.forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    if (this._syncModeDropdown) this._syncModeDropdown();
    this._updateVisibility();
    // If editor panel is open but we're leaving pattern mode, close it.
    if (mode !== DRAW_MODE.PATTERN && this._editorPanelOpen) {
      this._closeEditorPanel();
    }
  }

  _updateVisibility() {
    const lineTools = document.getElementById('line-tools');
    const patternTools = document.getElementById('pattern-tools');
    const fillTools = document.getElementById('fill-tools');
    const patternEditorToggleGroup = document.getElementById('pattern-editor-toggle-group');
    if (!lineTools || !patternTools) return;
    const mode = this.input.mode;
    // Line width/dash apply to freehand and line modes.
    lineTools.style.display =
      mode === DRAW_MODE.FREEHAND || mode === DRAW_MODE.LINE ? 'flex' : 'none';
    patternTools.style.display = mode === DRAW_MODE.PATTERN ? 'flex' : 'none';
    if (fillTools) fillTools.style.display = mode === DRAW_MODE.FILL ? 'flex' : 'none';
    // Edit Pattern button only visible in pattern mode.
    if (patternEditorToggleGroup) {
      patternEditorToggleGroup.style.display = mode === DRAW_MODE.PATTERN ? 'flex' : 'none';
    }
    // Dash selector only applies to line mode.
    if (this._updateDashVisibility) this._updateDashVisibility();
  }

  _initLineControls() {
    const widthInput = document.getElementById('line-width');
    const widthLabel = document.getElementById('line-width-label');
    const dashSelect = document.getElementById('line-dash');
    if (widthInput && widthLabel) {
      const update = () => {
        const w = parseInt(widthInput.value, 10) || 1;
        this.input.setLineWidth(w);
        widthLabel.textContent = String(w);
      };
      widthInput.addEventListener('input', update);
      update();
    }
    if (dashSelect) {
      dashSelect.addEventListener('change', () => {
        this.input.setDashPattern(dashSelect.value);
      });
    }
    // Wire the custom dash dropup widget.
    this._initDashDropup();

    // Track dash select visibility based on mode (only shown for line mode).
    this._updateDashVisibility = () => {
      const dashGroup = document.getElementById('dash-picker-group');
      if (!dashGroup) return;
      const isLine = this.input && this.input.mode === 'line';
      dashGroup.style.display = isLine ? '' : 'none';
    };
    // Fill pattern selector — visual swatch grid.
    const fillPicker = document.getElementById('fill-pattern-picker');
    const fillTrigger = document.getElementById('fill-pattern-trigger');
    const fillTriggerPreview = document.getElementById('fill-pattern-trigger-preview');
    const fillTriggerLabel = document.getElementById('fill-pattern-trigger-label');
    const fillGrid = document.getElementById('fill-pattern-grid');
    if (fillGrid && fillPicker && fillTrigger) {
      // Toggle dropdown open/closed.
      const setOpen = (open) => {
        fillPicker.classList.toggle('open', open);
        fillTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      };
      fillTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        setOpen(!fillPicker.classList.contains('open'));
      });
      // Close on outside click.
      document.addEventListener('click', (e) => {
        if (!fillPicker.contains(e.target)) setOpen(false);
      });
      // Close on Esc.
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && fillPicker.classList.contains('open')) {
          setOpen(false);
        }
      });
      const swatches = fillGrid.querySelectorAll('.fill-swatch');
      swatches.forEach((btn) => {
        btn.addEventListener('click', () => {
          const pat = btn.dataset.pattern;
          if (!pat) return;
          this.input.setFillPattern(pat);
          swatches.forEach((b) => b.classList.toggle('active', b === btn));
          // Update the trigger to reflect the new selection.
          if (fillTriggerPreview) {
            // Replace the preview's class to match the chosen pattern.
            const preview = btn.querySelector('.fill-swatch-preview');
            if (preview) {
              // Find the fp-* class on the picked swatch and copy it.
              const fpClass = Array.from(preview.classList).find((c) => c.startsWith('fp-'));
              // Strip any existing fp-* class from the trigger preview.
              fillTriggerPreview.classList.forEach((c) => {
                if (c.startsWith('fp-')) fillTriggerPreview.classList.remove(c);
              });
              if (fpClass) fillTriggerPreview.classList.add(fpClass);
            }
          }
          if (fillTriggerLabel) {
            const labelEl = btn.querySelector('.fill-swatch-label');
            fillTriggerLabel.textContent = labelEl ? labelEl.textContent : pat;
          }
          setOpen(false);
        });
      });
    }
  }

  // Initial state will be applied by _updateVisibility on first call.
  _initDashDropup() {
    const trigger = document.getElementById('dash-dropup-trigger');
    const panel = document.getElementById('dash-dropup-panel');
    const labelEl = document.getElementById('dash-dropup-label');
    const wrap = trigger && trigger.closest('.dash-dropup-wrap');
    const nativeSelect = document.getElementById('line-dash');
    if (!trigger || !panel || !wrap) return;
    const LABELS = { solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted', sparse: 'Sparse' };
    const setOpen = (open) => {
      panel.classList.toggle('hidden', !open);
      wrap.classList.toggle('open', open);
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    const selectDash = (value) => {
      // Update native select so existing input wiring fires.
      if (nativeSelect) {
        nativeSelect.value = value;
        nativeSelect.dispatchEvent(new Event('change'));
      }
      // Update label.
      if (labelEl) labelEl.textContent = LABELS[value] || value;
      // Update active state on options.
      panel.querySelectorAll('.dash-option').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.dash === value);
      });
      setOpen(false);
    };
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(panel.classList.contains('hidden'));
    });
    panel.querySelectorAll('.dash-option').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectDash(btn.dataset.dash);
      });
    });
    // Close on outside click.
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) setOpen(false);
    });
    // Close on Esc.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.classList.contains('hidden')) {
        setOpen(false);
      }
    });
  }
  _initPatternEditor() {
    this.editorCanvas = document.getElementById('pattern-editor');
    if (!this.editorCanvas) return;
    this.editorCtx = this.editorCanvas.getContext('2d');
    if (!this.editorCtx) {
      Logger.warn('Pattern editor: no 2D context.');
      return;
    }
    this.editorCells = new Set(); // "x,y" strings
    this._drawEditor();

    const handle = (e) => {
      const rect = this.editorCanvas.getBoundingClientRect();
      // Scale CSS pixel coords to internal canvas coords. The canvas
      // has fixed width/height attrs (e.g. 240) but CSS may scale it
      // up to ~360px or down on small screens. Without this, clicks
      // hit the wrong cells.
      const scaleX = this.editorCanvas.width / rect.width;
      const scaleY = this.editorCanvas.height / rect.height;
      const px = (e.clientX - rect.left) * scaleX;
      const py = (e.clientY - rect.top) * scaleY;
      const cs = this.editorCanvas.width / this.editorSize;
      const x = Math.floor(px / cs);
      const y = Math.floor(py / cs);
      if (x < 0 || x >= this.editorSize || y < 0 || y >= this.editorSize) return;
      const key = `${x},${y}`;
      if (this.editorCells.has(key)) this.editorCells.delete(key);
      else this.editorCells.add(key);
      // Mark the editor as dirty so the combobox shows "-- Custom --"
      this._editorDirty = true;
      this._activePresetName = '';
      this._syncPresetCombobox();
      this._syncPatternToInput();
      this._drawEditor();
    };
    this.editorCanvas.addEventListener('mousedown', handle);

    const clearBtn = document.getElementById('pattern-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.editorCells.clear();
        this._editorDirty = true;
        this._activePresetName = '';
        this._syncPresetCombobox();
        this._syncPatternToInput();
        this._drawEditor();
      });
    }
  }
  // Wire up clickable transform hints in the editor overlay.
  _initEditorTransformHints() {
    const hintsContainer = document.querySelector('.pattern-editor-hints');
    if (!hintsContainer) return;
    // The first 3 hint rows are Rotate, Flip horizontal, Flip vertical.
    // (The 4th is Esc which we leave non-interactive.)
    const rows = hintsContainer.querySelectorAll('div');
    if (rows.length < 3) return;
    const wireRow = (row, handler, title) => {
      row.classList.add('pattern-editor-hint-clickable');
      row.title = title;
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handler();
      });
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handler();
        }
      });
    };
    wireRow(rows[0], () => this._transformEditorRotate(), 'Click to rotate pattern 90° CW');
    wireRow(rows[1], () => this._transformEditorFlipH(), 'Click to flip pattern horizontally');
    wireRow(rows[2], () => this._transformEditorFlipV(), 'Click to flip pattern vertically');
  }
  // Transform the editorCells in-place by rotating 90° CW, re-centering
  // within the editor grid. Updates the input pattern and redraws.
  _transformEditorRotate() {
    if (this.editorCells.size === 0) return;
    const cells = [...this.editorCells].map((k) => k.split(',').map(Number));
    // 90° CW: (x, y) -> (y, -x). Normalize after.
    const rotated = cells.map(([x, y]) => [y, -x]);
    this._replaceEditorCells(rotated);
  }
  _transformEditorFlipH() {
    if (this.editorCells.size === 0) return;
    const cells = [...this.editorCells].map((k) => k.split(',').map(Number));
    // Flip horizontal: negate x. Normalize after.
    const flipped = cells.map(([x, y]) => [-x, y]);
    this._replaceEditorCells(flipped);
  }
  _transformEditorFlipV() {
    if (this.editorCells.size === 0) return;
    const cells = [...this.editorCells].map((k) => k.split(',').map(Number));
    // Flip vertical: negate y. Normalize after.
    const flipped = cells.map(([x, y]) => [x, -y]);
    this._replaceEditorCells(flipped);
  }
  // Replace editor cells with the given transformed coordinates,
  // normalizing to a [0..n] range and re-centering within the editor.
  _replaceEditorCells(coords) {
    if (coords.length === 0) return;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [x, y] of coords) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    // Center within editor grid.
    const offX = Math.floor((this.editorSize - w) / 2) - minX;
    const offY = Math.floor((this.editorSize - h) / 2) - minY;
    this.editorCells.clear();
    for (const [x, y] of coords) {
      const nx = x + offX;
      const ny = y + offY;
      // Clamp into the editor bounds; cells that fall outside are dropped.
      if (nx < 0 || nx >= this.editorSize || ny < 0 || ny >= this.editorSize) continue;
      this.editorCells.add(`${nx},${ny}`);
    }
    // Reset placement-side transform state since the pattern itself
    // now encodes the transform.
    if (this.input) {
      this.input.patternRotation = 0;
      this.input.patternFlipH = false;
      this.input.patternFlipV = false;
    }
    // Mark editor as dirty so the preset combobox shows "-- Custom --"
    // (the pattern no longer matches any preset's canonical form).
    this._editorDirty = true;
    this._activePresetName = '';
    this._syncPresetCombobox();
    this._syncPatternToInput();
    this._drawEditor();
  }

  _initPresets() {
    const presetSelect = document.getElementById('pattern-presets');
    if (!presetSelect) return;
    // Inject all available presets into the dropdown.
    this._populatePresetDropdown(presetSelect);
    presetSelect.addEventListener('change', () => {
      const name = presetSelect.value;
      // Story mode may inject extra presets via the shared reference.
      const bag = DrawToolsPanel.PATTERN_PRESETS_REF;
      if (!name || !bag[name]) {
        presetSelect.value = '';
        // Blur even on no-op so user can use hotkeys.
        presetSelect.blur();
        return;
      }
      // Block level-restricted patterns.
      if (
        this._levelPatternRestriction &&
        this._levelPatternRestriction.size > 0 &&
        !name.startsWith('custom_') &&
        !this._levelPatternRestriction.has(name)
      ) {
        Logger.info(`Pattern "${name}" is not allowed in this level.`);
        presetSelect.value = '';
        presetSelect.blur();
        return;
      }
      // In story mode, block patterns that aren't unlocked yet.
      if (
        this.storyEngine &&
        this.storyEngine.isActive() &&
        !this.storyEngine.unlockedPatterns.has(name)
      ) {
        Logger.info(`Pattern "${name}" is locked in story mode.`);
        presetSelect.value = '';
        presetSelect.blur();
        return;
      }
      // Auto-rotate spaceships to face north (toward enemy side).
      const presetCells = bag[name];
      const orientedCells = this._autoOrientNorthward(name, presetCells);
      this.editorCells.clear();
      // Center preset in editor.
      let maxX = 0,
        maxY = 0;
      for (const [x, y] of orientedCells) {
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      const offX = Math.floor((this.editorSize - maxX - 1) / 2);
      const offY = Math.floor((this.editorSize - maxY - 1) / 2);
      for (const [x, y] of orientedCells) {
        this.editorCells.add(`${x + offX},${y + offY}`);
      }
      // Record which preset is active and mark editor as clean.
      this._activePresetName = name;
      this._editorDirty = false;
      this._syncPatternToInput();
      this._drawEditor();
      // Auto-switch to pattern mode FIRST so pattern-tools is visible.
      this.setMode(DRAW_MODE.PATTERN);
      // Keep the combobox showing the selected preset name via sync.
      this._syncPresetCombobox();
      // Blur the combobox so keyboard hotkeys (R, X, Y, etc.) work
      // immediately without the user having to click elsewhere first.
      // Defer to next tick to ensure blur happens after change event
      // bubbling completes.
      setTimeout(() => presetSelect.blur(), 0);
    });
    // Re-filter dropdown when it gains focus, in case story state changed.
    presetSelect.addEventListener('focus', () => {
      this._filterPresetDropdown(presetSelect);
    });
  }

  // Hide locked patterns when story mode is active. In non-story play,
  // all patterns are available.
  _filterPresetDropdown(sel) {
    const storyActive = this.storyEngine && this.storyEngine.isActive();
    const unlocked = storyActive ? this.storyEngine.unlockedPatterns : null;
    const levelAllowed = this._levelPatternRestriction;
    for (const opt of sel.options) {
      if (!opt.value) {
        opt.hidden = false;
        opt.disabled = false;
        continue;
      }
      // Level restriction first.
      if (levelAllowed && levelAllowed.size > 0) {
        // Custom patterns (prefix custom_) are always allowed.
        const isCustom = opt.value.startsWith('custom_');
        if (!isCustom && !levelAllowed.has(opt.value)) {
          opt.hidden = true;
          opt.disabled = true;
          continue;
        }
      }
      if (storyActive && unlocked && !unlocked.has(opt.value)) {
        opt.hidden = true;
        opt.disabled = true;
      } else {
        opt.hidden = false;
        opt.disabled = false;
      }
    }
  }

  // Called by StoryEngine when patterns are unlocked or story starts/stops.
  refreshPatternLockState() {
    const sel = document.getElementById('pattern-presets');
    if (sel) this._filterPresetDropdown(sel);
  }

  _populatePresetDropdown(sel) {
    const PRETTY = {
      glider: 'Glider (SE)',
      blinker: 'Blinker',
      block: 'Block',
      lwss: 'LWSS',
      mwss: 'MWSS',
      hwss: 'HWSS',
      copperhead: 'Copperhead',
      rpentomino: 'R-Pentomino',
      acorn: 'Acorn',
      toad: 'Toad',
      beacon: 'Beacon',
      pulsar: 'Pulsar',
      penta_decathlon: 'Penta-Decathlon',
      diehard: 'Diehard',
      gosper_gun: '★ Gosper Glider Gun',
    };
    // Keep existing options and add any missing presets.
    const existing = new Set();
    for (const opt of sel.options) existing.add(opt.value);
    for (const key of Object.keys(PATTERN_PRESETS)) {
      if (existing.has(key)) continue;
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = PRETTY[key] || key;
      sel.appendChild(opt);
    }
  }

  _syncPatternToInput() {
    const cells = [];
    for (const key of this.editorCells) {
      const [x, y] = key.split(',').map(Number);
      cells.push([x, y]);
    }
    this.input.setPattern(cells);
  }
  // Auto-rotate a pattern so that, if it's a spaceship or glider, it
  // faces north (toward enemy territory). Uses the pattern library's
  // direction metadata when available, falling back to known preset ids.
  _autoOrientNorthward(presetId, cells) {
    // Map of known patterns and their native direction.
    const DIRECTION_MAP = {
      glider: 'SE',
      lwss: 'W',
      mwss: 'W',
      hwss: 'W',
    };
    // Try the pattern library first.
    let nativeDir = null;
    try {
      const p = getPattern(presetId);
      if (p && p.direction) nativeDir = p.direction;
    } catch (_e) {
      // Fallback below.
    }
    if (!nativeDir) nativeDir = DIRECTION_MAP[presetId] || null;
    if (!nativeDir) return cells;
    // Compute number of 90° CW rotations needed to make `nativeDir` point N.
    // Rotation table: each 90° CW rotation maps directions as:
    //   N → E → S → W → N    (cardinal)
    //   NE → SE → SW → NW → NE  (diagonal)
    const cwOrder = ['N', 'E', 'S', 'W'];
    const cwOrderDiag = ['NE', 'SE', 'SW', 'NW'];
    let rotations = 0;
    if (cwOrder.includes(nativeDir)) {
      const idx = cwOrder.indexOf(nativeDir);
      // We want N (idx 0). Rotate (4 - idx) % 4 times CW to get N.
      rotations = (4 - idx) % 4;
    } else if (cwOrderDiag.includes(nativeDir)) {
      // For diagonals, "north-ish" target is NW or NE (pointing toward
      // the enemy). Choose whichever requires fewer rotations.
      // Diagonal patterns can't be perfectly oriented to N (they always
      // travel diagonally), so we pick the most northward variant.
      const idx = cwOrderDiag.indexOf(nativeDir);
      // We want NW (idx 3) or NE (idx 0). For SE (idx 1) → rotate 3 CW → NE.
      // For SW (idx 2) → rotate 2 CW → NW. For NE (idx 0) → 0 rotations.
      // For NW (idx 3) → 0 rotations.
      if (idx === 0 || idx === 3) rotations = 0;
      else if (idx === 1)
        rotations = 3; // SE → NE
      else if (idx === 2) rotations = 2; // SW → NW
    }
    if (rotations === 0) return cells;
    // Apply rotations: (x, y) → (-y, x) per 90° CW, then normalize.
    let result = cells.map(([x, y]) => [x, y]);
    for (let i = 0; i < rotations; i++) {
      result = result.map(([x, y]) => [-y, x]);
    }
    // Normalize so min(x,y) = 0.
    let minX = Infinity,
      minY = Infinity;
    for (const [x, y] of result) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
    }
    return result.map(([x, y]) => [x - minX, y - minY]);
  }
  // Keep the preset combobox in sync with the active preset name.
  // If the editor has been manually dirtied, show the placeholder.
  _syncPresetCombobox() {
    const sel = document.getElementById('pattern-presets');
    if (!sel) return;
    if (this._activePresetName && !this._editorDirty) {
      // Check if option exists; if not (e.g., locked in story mode),
      // fall back to placeholder.
      const optionExists = Array.from(sel.options).some((o) => o.value === this._activePresetName);
      sel.value = optionExists ? this._activePresetName : '';
    } else {
      sel.value = '';
    }
  }

  _drawEditor() {
    if (!this.editorCtx) return;
    const ctx = this.editorCtx;
    const w = this.editorCanvas.width;
    const h = this.editorCanvas.height;
    const cs = w / this.editorSize;
    ctx.fillStyle = '#000010';
    ctx.fillRect(0, 0, w, h);
    // Grid lines.
    ctx.strokeStyle = '#1a1a3a';
    ctx.lineWidth = 1;
    for (let i = 0; i <= this.editorSize; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cs + 0.5, 0);
      ctx.lineTo(i * cs + 0.5, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cs + 0.5);
      ctx.lineTo(w, i * cs + 0.5);
      ctx.stroke();
    }
    // Cells.
    ctx.fillStyle = '#00ff88';
    for (const key of this.editorCells) {
      const [x, y] = key.split(',').map(Number);
      ctx.fillRect(x * cs + 1, y * cs + 1, cs - 2, cs - 2);
    }
  }
  // ---- Collapsible editor panel ----
  _initEditorToggle() {
    const btn = document.getElementById('pattern-editor-toggle');
    const overlay = document.getElementById('pattern-editor-overlay');
    const closeBtn = document.getElementById('pattern-editor-close');
    Logger.info(`[DrawTools] _initEditorToggle: btn=${!!btn}, overlay=${!!overlay}`);
    if (!btn || !overlay) {
      Logger.error('[DrawTools] pattern editor toggle button or panel missing!', {
        btnFound: !!btn,
        overlayFound: !!overlay,
        btnId: 'pattern-editor-toggle',
        overlayId: 'pattern-editor-overlay',
      });
      return;
    }
    // Ensure initial state is consistent: panel closed by default.
    this._editorPanelOpen = false;
    overlay.classList.add('hidden');
    btn.classList.remove('active');
    btn.textContent = '✏ Edit Pattern';
    Logger.info('[DrawTools] Binding click handler to pattern-editor-toggle.');
    const handler = (e) => {
      Logger.info('[DrawTools] Edit button clicked!', e);
      try {
        if (this._editorPanelOpen) {
          this._closeEditorPanel();
        } else {
          this._openEditorPanel();
        }
      } catch (err) {
        Logger.error('[DrawTools] Edit button handler threw:', err);
      }
    };
    btn.addEventListener('click', handler);
    // Also bind to pointerdown as a fallback in case click is being swallowed.
    btn.addEventListener('pointerdown', (e) => {
      Logger.debug('[DrawTools] Edit button pointerdown', e);
    });
    // Close button inside the overlay.
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this._closeEditorPanel());
    }
    // Click on backdrop (outside content) closes.
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this._closeEditorPanel();
    });
    // ESC closes the editor.
    window.addEventListener('keydown', (e) => {
      if (this._editorPanelOpen && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this._closeEditorPanel();
      }
    });
  }
  _openEditorPanel() {
    // Opening the editor implies pattern mode — switch automatically.
    if (this.input.mode !== DRAW_MODE.PATTERN) {
      if (this._isToolUnlocked(DRAW_MODE.PATTERN)) {
        this.setMode(DRAW_MODE.PATTERN);
      } else {
        Logger.info('[DrawTools] Cannot open editor: pattern mode is locked.');
        return;
      }
    }
    const overlay = document.getElementById('pattern-editor-overlay');
    const btn = document.getElementById('pattern-editor-toggle');
    if (!overlay) return;
    this._editorPanelOpen = true;
    overlay.classList.remove('hidden');
    if (btn) {
      btn.classList.add('active');
      btn.textContent = '✏ Close Editor';
    }
    // Refresh save/meta UI based on current editor mode.
    this._updateEditorSaveUI();
    // Redraw the editor so it reflects current pattern at the new size.
    // Defer one frame so the canvas has its layout-driven size applied.
    requestAnimationFrame(() => this._drawEditor());
    // Notify host (main.js) to pause the game.
    if (this.onEditorOpen) {
      try {
        this.onEditorOpen();
      } catch (e) {
        Logger.error('onEditorOpen handler failed', e);
      }
    }
    Logger.info('[DrawTools] Editor overlay opened.');
  }
  _closeEditorPanel() {
    const overlay = document.getElementById('pattern-editor-overlay');
    const btn = document.getElementById('pattern-editor-toggle');
    if (!overlay) return;
    if (!this._editorPanelOpen) return;
    this._editorPanelOpen = false;
    overlay.classList.add('hidden');
    if (btn) {
      btn.classList.remove('active');
      btn.textContent = '✏ Edit Pattern';
    }
    // Reset editor mode to view.
    this._editorMode = 'view';
    this._editorEditingName = null;
    // Notify host (main.js) to resume the game.
    if (this.onEditorClose) {
      try {
        this.onEditorClose();
      } catch (e) {
        Logger.error('onEditorClose handler failed', e);
      }
    }
    Logger.info('[DrawTools] Editor overlay closed.');
  }
  // Load a list of [x,y] cells into the editor (normalizing & centering).
  // mode: 'view' | 'edit' | 'new'
  //   - 'view': just for stamping; saving creates a NEW pattern (prompt name)
  //   - 'edit': editing an existing custom pattern (saving overwrites it)
  //   - 'new':  starting from scratch / blank
  loadPatternIntoEditor(cells, customName = null, mode = 'view') {
    this.editorCells = new Set();
    this._editorMode = mode;
    this._editorEditingName = customName;
    if (cells && cells.length > 0) {
      const norm = normalizeCells(cells);
      const pw = norm.width;
      const ph = norm.height;
      const offX = Math.max(0, Math.floor((this.editorSize - pw) / 2));
      const offY = Math.max(0, Math.floor((this.editorSize - ph) / 2));
      for (const [x, y] of norm.cells) {
        const px = x + offX;
        const py = y + offY;
        if (px >= 0 && px < this.editorSize && py >= 0 && py < this.editorSize) {
          this.editorCells.add(`${px},${py}`);
        }
      }
    }
    this._activePresetName = customName || '';
    this._editorDirty = false;
    this._syncPresetCombobox();
    this._syncPatternToInput();
    this._drawEditor();
    // Also sync the metadata fields if a custom pattern is being edited.
    this._syncMetaFieldsFromCustom(customName);
    this._updateEditorSaveUI();
  }
  _syncMetaFieldsFromCustom(name) {
    const nameEl = document.getElementById('editor-meta-name');
    const descEl = document.getElementById('editor-meta-desc');
    const tagsEl = document.getElementById('editor-meta-tags');
    const catEl = document.getElementById('editor-meta-category');
    const periodEl = document.getElementById('editor-meta-period');
    const dirEl = document.getElementById('editor-meta-direction');
    const rulesetEl = document.getElementById('editor-meta-ruleset');
    if (!nameEl) return;
    if (name && this.patternCapture) {
      const saved = this.patternCapture.getSaved(name);
      const m = (saved && saved.meta) || {};
      nameEl.value = name;
      if (descEl) descEl.value = m.description || '';
      if (tagsEl) tagsEl.value = Array.isArray(m.tags) ? m.tags.join(', ') : '';
      if (catEl) catEl.value = m.category || 'misc';
      if (periodEl) periodEl.value = m.period != null ? m.period : 1;
      if (dirEl) dirEl.value = m.direction || '';
      if (rulesetEl) {
        const capturedRule =
          m.capturedRuleset || (Array.isArray(m.rulesets) ? m.rulesets[0] : null);
        rulesetEl.value = capturedRule || CONFIG.ACTIVE_RULESET || 'conway';
      }
    } else {
      nameEl.value = '';
      if (descEl) descEl.value = '';
      if (tagsEl) tagsEl.value = '';
      if (catEl) catEl.value = 'misc';
      if (periodEl) periodEl.value = 1;
      if (dirEl) dirEl.value = '';
      if (rulesetEl) rulesetEl.value = CONFIG.ACTIVE_RULESET || 'conway';
    }
  }
  _updateEditorSaveUI() {
    const saveBtn = document.getElementById('editor-save-btn');
    const statusEl = document.getElementById('editor-save-status');
    if (!saveBtn) return;
    if (this._editorMode === 'edit' && this._editorEditingName) {
      saveBtn.textContent = `💾 Update "${this._editorEditingName}"`;
      if (statusEl) {
        statusEl.textContent = `Editing existing custom pattern "${this._editorEditingName}".`;
        statusEl.style.color = '#ffcc44';
      }
    } else if (this._editorMode === 'new') {
      saveBtn.textContent = '💾 Save as New Pattern';
      if (statusEl) {
        statusEl.textContent = 'Creating a new custom pattern.';
        statusEl.style.color = '#88ff88';
      }
    } else {
      saveBtn.textContent = '💾 Save as New Pattern';
      if (statusEl) {
        statusEl.textContent = '';
      }
    }
  }
  _initEditorSaveControls() {
    // Build the save/meta UI dynamically and inject into the editor overlay
    // panel so we don't have to edit index.html (this file is self-contained).
    const panel = document.getElementById('pattern-editor-panel');
    if (!panel) {
      Logger.warn('[DrawTools] pattern-editor-panel not found; cannot inject save UI.');
      return;
    }
    // Avoid double-injection.
    if (document.getElementById('editor-save-section')) return;
    const section = document.createElement('div');
    section.id = 'editor-save-section';
    section.className = 'editor-save-section';
    section.innerHTML = `
       <div class="editor-save-header">💾 Save / Metadata</div>
       <div class="editor-meta-grid">
         <label class="editor-meta-row">
           <span>Name:</span>
           <input id="editor-meta-name" type="text" placeholder="my pattern" maxlength="40" />
         </label>
         <label class="editor-meta-row">
           <span>Category:</span>
           <select id="editor-meta-category">
             <option value="misc">Misc</option>
             <option value="still_life">Still Life</option>
             <option value="oscillator">Oscillator</option>
             <option value="spaceship">Spaceship</option>
             <option value="gun">Gun</option>
             <option value="methuselah">Methuselah</option>
             <option value="puffer">Puffer</option>
           </select>
         </label>
         <label class="editor-meta-row">
           <span>Period:</span>
           <input id="editor-meta-period" type="number" min="0" max="9999" step="1" value="1" />
         </label>
         <label class="editor-meta-row">
           <span>Direction:</span>
           <select id="editor-meta-direction">
             <option value="">(none)</option>
             <option value="N">North</option>
             <option value="S">South</option>
             <option value="E">East</option>
             <option value="W">West</option>
             <option value="NE">NE</option>
             <option value="NW">NW</option>
             <option value="SE">SE</option>
             <option value="SW">SW</option>
           </select>
         </label>
         <label class="editor-meta-row editor-meta-row-wide">
           <span>Ruleset:</span>
           <select id="editor-meta-ruleset" title="Ruleset this pattern is designed for"></select>
         </label>
         <label class="editor-meta-row editor-meta-row-wide">
           <span>Tags:</span>
           <input id="editor-meta-tags" type="text" placeholder="custom, my-tag, ..." />
         </label>
         <label class="editor-meta-row editor-meta-row-wide">
           <span>Description:</span>
           <input id="editor-meta-desc" type="text" placeholder="A pattern I made..." maxlength="200" />
         </label>
       </div>
       <div class="editor-save-buttons">
         <button id="editor-save-btn" class="editor-action-btn editor-action-primary">💾 Save as New Pattern</button>
         <button id="editor-saveas-btn" class="editor-action-btn">Save As...</button>
         <span id="editor-save-status" class="editor-save-status"></span>
       </div>
     `;
    panel.appendChild(section);
    // Populate ruleset select.
    this._populateEditorRulesetSelect();
    // Wire buttons.
    const saveBtn = section.querySelector('#editor-save-btn');
    const saveAsBtn = section.querySelector('#editor-saveas-btn');
    saveBtn.addEventListener('click', () => this._saveEditorPattern(false));
    saveAsBtn.addEventListener('click', () => this._saveEditorPattern(true));
  }
  _populateEditorRulesetSelect() {
    const sel = document.getElementById('editor-meta-ruleset');
    if (!sel) return;
    sel.innerHTML = '';
    const optAny = document.createElement('option');
    optAny.value = '*';
    optAny.textContent = 'Any (universal)';
    sel.appendChild(optAny);
    for (const def of listRulesets()) {
      const opt = document.createElement('option');
      opt.value = def.id;
      opt.textContent = `${def.name}${def.notation ? ` (${def.notation})` : ''}`;
      opt.title = def.description || '';
      sel.appendChild(opt);
    }
    // Default to current active ruleset.
    sel.value = CONFIG.ACTIVE_RULESET || 'conway';
  }
  _collectEditorCells() {
    // Convert editorCells (Set of "x,y") to [[x,y],...].
    const cells = [];
    for (const key of this.editorCells) {
      const [x, y] = key.split(',').map(Number);
      cells.push([x, y]);
    }
    return cells;
  }
  _collectEditorMeta() {
    const descEl = document.getElementById('editor-meta-desc');
    const tagsEl = document.getElementById('editor-meta-tags');
    const catEl = document.getElementById('editor-meta-category');
    const periodEl = document.getElementById('editor-meta-period');
    const dirEl = document.getElementById('editor-meta-direction');
    const rulesetEl = document.getElementById('editor-meta-ruleset');
    const tagsRaw = (tagsEl && tagsEl.value) || '';
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (!tags.includes('custom')) tags.unshift('custom');
    const rulesetId = (rulesetEl && rulesetEl.value) || '*';
    const rulesets = rulesetId === '*' ? ['*'] : [rulesetId];
    if (rulesetId !== '*' && !tags.includes(`rule:${rulesetId}`)) {
      tags.push(`rule:${rulesetId}`);
    }
    return {
      category: (catEl && catEl.value) || 'misc',
      period: periodEl ? Math.max(0, parseInt(periodEl.value, 10) || 1) : 1,
      direction: (dirEl && dirEl.value) || null,
      description: (descEl && descEl.value) || '',
      tags,
      rulesets,
      capturedRuleset: rulesetId === '*' ? null : rulesetId,
      createdAt: Date.now(),
    };
  }
  _saveEditorPattern(forceSaveAs = false) {
    if (!this.patternCapture) {
      Logger.warn('[DrawTools] No patternCapture reference; cannot save.');
      return;
    }
    const cells = this._collectEditorCells();
    if (cells.length === 0) {
      this._setSaveStatus('Cannot save empty pattern.', 'err');
      return;
    }
    // Normalize to (0,0) origin before saving.
    const norm = normalizeCells(cells);
    const cellsForSave = norm.cells;
    const nameEl = document.getElementById('editor-meta-name');
    let name = ((nameEl && nameEl.value) || '').trim();
    const meta = this._collectEditorMeta();
    // Determine if this is an update vs. new save.
    const isUpdate = !forceSaveAs && this._editorMode === 'edit' && this._editorEditingName;
    if (isUpdate) {
      const oldName = this._editorEditingName;
      // If the name changed, rename first.
      if (name && name !== oldName) {
        const renamed = this.patternCapture.renamePattern(oldName, name);
        if (!renamed) {
          this._setSaveStatus(`Could not rename — "${name}" may already exist.`, 'err');
          return;
        }
        this._editorEditingName = name;
      } else {
        name = oldName;
      }
      // Overwrite with new cells + meta.
      this.patternCapture.savePatternExternal(name, cellsForSave, meta);
      this._setSaveStatus(`✓ Updated "${name}".`, 'ok');
      return;
    }
    // New save: name required.
    if (!name) {
      this._setSaveStatus('Please enter a name first.', 'err');
      if (nameEl) nameEl.focus();
      return;
    }
    const existing = this.patternCapture.listSaved().map((p) => p.name);
    if (existing.includes(name)) {
      if (!window.confirm(`A pattern named "${name}" already exists. Overwrite?`)) {
        this._setSaveStatus('Choose a different name.', 'err');
        return;
      }
      this.patternCapture.deleteSaved(name);
    }
    this.patternCapture.savePatternExternal(name, cellsForSave, meta);
    this._editorMode = 'edit';
    this._editorEditingName = name;
    this._setSaveStatus(`✓ Saved "${name}" as new custom pattern.`, 'ok');
    this._updateEditorSaveUI();
  }
  _setSaveStatus(msg, kind) {
    const el = document.getElementById('editor-save-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = kind === 'ok' ? '#88ff88' : '#ff8888';
    if (this._saveStatusTimer) clearTimeout(this._saveStatusTimer);
    this._saveStatusTimer = setTimeout(() => {
      if (el && this._editorMode === 'edit') {
        // Restore the "editing X" message.
        this._updateEditorSaveUI();
      } else if (el) {
        el.textContent = '';
      }
    }, 3500);
  }
  _initEditorJsonIO() {
    // Inject JSON I/O UI into the editor panel. Includes a textarea +
    // copy/import/export buttons for the pattern (cells + metadata).
    const panel = document.getElementById('pattern-editor-panel');
    if (!panel) return;
    if (document.getElementById('editor-json-section')) return;
    const section = document.createElement('div');
    section.id = 'editor-json-section';
    section.className = 'editor-json-section';
    section.innerHTML = `
       <div class="editor-json-header">
         📋 JSON Import / Export
         <button id="editor-json-toggle" class="editor-json-toggle">▸ Show</button>
       </div>
       <div id="editor-json-body" class="editor-json-body" style="display:none;">
         <div class="editor-json-buttons">
           <button id="editor-json-export" class="editor-action-btn">📤 Export Current</button>
           <button id="editor-json-copy" class="editor-action-btn editor-action-primary">📋 Copy to Clipboard</button>
           <button id="editor-json-import" class="editor-action-btn editor-action-primary">📥 Import from Box</button>
           <span id="editor-json-status" class="editor-save-status"></span>
         </div>
         <textarea id="editor-json-textarea" class="editor-json-textarea"
           rows="10"
           placeholder='Click "Export Current" to dump cells + metadata as JSON, or paste a JSON pattern here and click "Import from Box".'
         ></textarea>
         <p class="editor-json-hint">
           JSON schema: <code>{ "name": "...", "cells": [[x,y],...], "meta": { "category", "period", "direction", "description", "tags", "rulesets" } }</code>
         </p>
       </div>
     `;
    panel.appendChild(section);
    // Wire toggle.
    const toggleBtn = section.querySelector('#editor-json-toggle');
    const body = section.querySelector('#editor-json-body');
    toggleBtn.addEventListener('click', () => {
      const shown = body.style.display !== 'none';
      body.style.display = shown ? 'none' : 'block';
      toggleBtn.textContent = shown ? '▸ Show' : '▾ Hide';
    });
    // Wire buttons.
    section
      .querySelector('#editor-json-export')
      .addEventListener('click', () => this._exportEditorJSON());
    section
      .querySelector('#editor-json-copy')
      .addEventListener('click', () => this._copyEditorJSON());
    section
      .querySelector('#editor-json-import')
      .addEventListener('click', () => this._importEditorJSON());
  }
  _buildEditorJSON() {
    const cells = this._collectEditorCells();
    const norm = normalizeCells(cells);
    const meta = this._collectEditorMeta();
    const nameEl = document.getElementById('editor-meta-name');
    const name = ((nameEl && nameEl.value) || '').trim() || 'untitled';
    return {
      name,
      cells: norm.cells,
      width: norm.width,
      height: norm.height,
      meta,
    };
  }
  _exportEditorJSON() {
    const ta = document.getElementById('editor-json-textarea');
    if (!ta) return;
    const data = this._buildEditorJSON();
    ta.value = JSON.stringify(data, null, 2);
    this._setJsonStatus('Pattern + metadata exported below.', 'ok');
  }
  async _copyEditorJSON() {
    const ta = document.getElementById('editor-json-textarea');
    if (!ta) return;
    const data = this._buildEditorJSON();
    const json = JSON.stringify(data, null, 2);
    ta.value = json;
    try {
      await navigator.clipboard.writeText(json);
      this._setJsonStatus('✓ Copied to clipboard!', 'ok');
    } catch (e) {
      ta.select();
      document.execCommand('copy');
      this._setJsonStatus('✓ Copied (fallback method).', 'ok');
    }
  }
  _importEditorJSON() {
    const ta = document.getElementById('editor-json-textarea');
    if (!ta) return;
    const txt = (ta.value || '').trim();
    if (!txt) {
      this._setJsonStatus('Paste JSON into the box first.', 'err');
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(txt);
    } catch (e) {
      this._setJsonStatus(`✗ Invalid JSON: ${e.message}`, 'err');
      return;
    }
    if (!parsed || typeof parsed !== 'object') {
      this._setJsonStatus('✗ JSON must be an object.', 'err');
      return;
    }
    const cells = parsed.cells;
    if (!Array.isArray(cells)) {
      this._setJsonStatus('✗ JSON missing "cells" array.', 'err');
      return;
    }
    // Validate cells structure.
    for (const c of cells) {
      if (
        !Array.isArray(c) ||
        c.length !== 2 ||
        !Number.isInteger(c[0]) ||
        !Number.isInteger(c[1])
      ) {
        this._setJsonStatus('✗ Bad cell format. Expected [[x,y],...].', 'err');
        return;
      }
    }
    // Load into editor.
    const name = parsed.name && typeof parsed.name === 'string' ? parsed.name : null;
    // If a pattern with this name already exists in custom patterns,
    // open in edit mode; otherwise it's a new pattern.
    let mode = 'new';
    if (name && this.patternCapture) {
      const existing = this.patternCapture.listSaved().map((p) => p.name);
      if (existing.includes(name)) mode = 'edit';
    }
    this.loadPatternIntoEditor(cells, mode === 'edit' ? name : null, mode);
    // Also populate metadata fields from import.
    const meta = parsed.meta || {};
    const nameEl = document.getElementById('editor-meta-name');
    const descEl = document.getElementById('editor-meta-desc');
    const tagsEl = document.getElementById('editor-meta-tags');
    const catEl = document.getElementById('editor-meta-category');
    const periodEl = document.getElementById('editor-meta-period');
    const dirEl = document.getElementById('editor-meta-direction');
    if (nameEl && name) nameEl.value = name;
    if (descEl && meta.description) descEl.value = meta.description;
    if (tagsEl && Array.isArray(meta.tags)) tagsEl.value = meta.tags.join(', ');
    if (catEl && meta.category) catEl.value = meta.category;
    if (periodEl && meta.period != null) periodEl.value = meta.period;
    if (dirEl) dirEl.value = meta.direction || '';
    this._setJsonStatus(`✓ Imported ${cells.length} cell(s). Click Save to persist.`, 'ok');
    this._updateEditorSaveUI();
  }
  _setJsonStatus(msg, kind) {
    const el = document.getElementById('editor-json-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = kind === 'ok' ? '#88ff88' : '#ff8888';
    if (this._jsonStatusTimer) clearTimeout(this._jsonStatusTimer);
    this._jsonStatusTimer = setTimeout(() => {
      if (el) el.textContent = '';
    }, 4000);
  }

  _initKeyboard() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'f' || e.key === 'F') {
        this.setMode(DRAW_MODE.FREEHAND);
      } else if (e.key === 'l' || e.key === 'L') {
        if (!this._isToolUnlocked(DRAW_MODE.LINE)) return;
        this.setMode(DRAW_MODE.LINE);
      } else if (e.key === 'p' || e.key === 'P') {
        if (!this._isToolUnlocked(DRAW_MODE.PATTERN)) return;
        this.setMode(DRAW_MODE.PATTERN);
      } else if (e.key === 'b' || e.key === 'B') {
        if (!this._isToolUnlocked(DRAW_MODE.FILL)) return;
        this.setMode(DRAW_MODE.FILL);
      } else if (e.key === 'r' || e.key === 'R') {
        if (this.input.mode === DRAW_MODE.PATTERN) {
          if (this._editorPanelOpen) {
            // Transform the actual editor cells when editor is open.
            this._transformEditorRotate();
          } else {
            this.input.cyclePatternRotation(e.shiftKey);
            this._drawEditor();
            this._editorDirty = true;
            this._activePresetName = '';
            this._syncPresetCombobox();
          }
        }
      } else if (e.key === 'x' || e.key === 'X') {
        if (this.input.mode === DRAW_MODE.PATTERN) {
          if (this._editorPanelOpen) {
            this._transformEditorFlipH();
          } else {
            this.input.flipPatternH();
            this._drawEditor();
            this._editorDirty = true;
            this._activePresetName = '';
            this._syncPresetCombobox();
          }
        }
      } else if (e.key === 'y' || e.key === 'Y') {
        if (this.input.mode === DRAW_MODE.PATTERN) {
          if (this._editorPanelOpen) {
            this._transformEditorFlipV();
          } else {
            this.input.flipPatternV();
            this._drawEditor();
            this._editorDirty = true;
            this._activePresetName = '';
            this._syncPresetCombobox();
          }
        }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        // Cycle through modes.
        const order = [DRAW_MODE.FREEHAND, DRAW_MODE.LINE, DRAW_MODE.PATTERN, DRAW_MODE.FILL];
        const allowed = order.filter((m) => this._isToolUnlocked(m));
        if (allowed.length === 0) return;
        const idx = allowed.indexOf(this.input.mode);
        const next = allowed[(idx + (e.shiftKey ? -1 : 1) + allowed.length) % allowed.length];
        this.setMode(next);
      } else if (e.key === '+' || e.key === '=') {
        // Increase line width (works in freehand/line modes).
        const widthInput = document.getElementById('line-width');
        if (widthInput && this.input.mode !== DRAW_MODE.PATTERN) {
          const cur = parseInt(widthInput.value, 10) || 1;
          const max = parseInt(widthInput.max, 10) || 8;
          widthInput.value = String(Math.min(max, cur + 1));
          widthInput.dispatchEvent(new Event('input'));
        }
      } else if (e.key === '-' || e.key === '_') {
        const widthInput = document.getElementById('line-width');
        if (widthInput && this.input.mode !== DRAW_MODE.PATTERN) {
          const cur = parseInt(widthInput.value, 10) || 1;
          const min = parseInt(widthInput.min, 10) || 1;
          widthInput.value = String(Math.max(min, cur - 1));
          widthInput.dispatchEvent(new Event('input'));
        }
      } else if (e.shiftKey && /^[1-8]$/.test(e.key)) {
        // Shift+1..8 loads pattern preset by index from dropdown.
        const presetSelect = document.getElementById('pattern-presets');
        if (presetSelect) {
          const digit = parseInt(e.key, 10);
          // Skip the placeholder and any hidden (locked) options.
          const visible = [];
          for (const opt of presetSelect.options) {
            if (!opt.value || opt.hidden || opt.disabled) continue;
            visible.push(opt);
          }
          if (visible[digit - 1]) {
            presetSelect.value = visible[digit - 1].value;
            presetSelect.dispatchEvent(new Event('change'));
          }
        }
      }
    });
  }
}
// Shared reference so the StoryEngine can inject unlocked patterns into the
// same lookup table that the dropdown reads from.
DrawToolsPanel.PATTERN_PRESETS_REF = PATTERN_PRESETS;
