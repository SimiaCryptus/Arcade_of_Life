import { DRAW_MODE } from './input.js';
import { Logger } from './logger.js';
import { PATTERN_PRESETS as LIBRARY_PRESETS } from './patterns/index.js';
import { normalizeCells } from './patterns/library.js';
import { listRulesets, getRuleset } from './rules/ruleset.js';
import { CONFIG } from './config.js';
import { getPattern } from './patterns/index.js';
import { PatternEditor } from './patternEditor.js';

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
    this._input = input;
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
    this._initPresets();
    this._initKeyboard();
    this._initPatternEditorDelegate();
    this._updateVisibility();
    Logger.info('[DrawTools] Constructor complete.');
  }
  // Property accessor for `input`. When the InputManager is replaced
  // (e.g., on world rebuild after a settings change), we need to
  // propagate the new reference into the PatternEditor delegate so
  // that pattern loading/editing writes to the active InputManager —
  // otherwise pattern stamps appear "broken" (the editor mutates a
  // stale, detached InputManager whose `pattern` is never read).
  get input() {
    return this._input;
  }
  set input(v) {
    this._input = v;
    if (this.patternEditor) this.patternEditor.input = v;
  }
  // Create the PatternEditor instance. We pass onOpen/onClose hooks so the
  // host (main.js) can pause/resume the game. The editor handles its own
  // DOM wiring, transforms, save UI, JSON I/O, and time-simulated preview.
  _initPatternEditorDelegate() {
    this.patternEditor = new PatternEditor({
      input: this.input,
      patternCapture: this.patternCapture || null,
      onOpen: () => {
        // Opening the editor implies pattern mode — switch automatically.
        if (this.input.mode !== DRAW_MODE.PATTERN) {
          if (this._isToolUnlocked(DRAW_MODE.PATTERN)) {
            this.setMode(DRAW_MODE.PATTERN);
          }
        }
        if (this.onEditorOpen) {
          try {
            this.onEditorOpen();
          } catch (e) {
            Logger.error('onEditorOpen failed', e);
          }
        }
      },
      onClose: () => {
        if (this.onEditorClose) {
          try {
            this.onEditorClose();
          } catch (e) {
            Logger.error('onEditorClose failed', e);
          }
        }
      },
      onChange: () => {
        // Mirror dirty state so combobox stays in sync.
        this._editorDirty = this.patternEditor && this.patternEditor._editorDirty;
        this._activePresetName = this.patternEditor && this.patternEditor._activePresetName;
      },
    });
    // Expose legacy properties that other modules (patternZoo, etc.) read.
    Object.defineProperty(this, 'editorCells', {
      get: () => (this.patternEditor ? this.patternEditor.editorCells : new Set()),
      set: (v) => {
        if (this.patternEditor) this.patternEditor.editorCells = v;
      },
      configurable: true,
    });
    Object.defineProperty(this, 'editorSize', {
      get: () => (this.patternEditor ? this.patternEditor.editorSize : 16),
      configurable: true,
    });
    Object.defineProperty(this, '_editorPanelOpen', {
      get: () => !!(this.patternEditor && this.patternEditor._editorPanelOpen),
      configurable: true,
    });
  }
  // Allow patternCapture to be set after construction. The PatternZoo and
  // main.js wire this up after the DrawToolsPanel is built. We use a
  // property setter so existing `drawTools.patternCapture = pc` assignments
  // automatically propagate into the PatternEditor.
  setPatternCapture(pc) {
    this._patternCaptureRef = pc;
    if (this.patternEditor) this.patternEditor.patternCapture = pc;
  }
  get patternCapture() {
    return this._patternCaptureRef;
  }
  set patternCapture(pc) {
    this._patternCaptureRef = pc;
    if (this.patternEditor) this.patternEditor.patternCapture = pc;
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

  // Transforms now delegate to the PatternEditor.
  _transformEditorRotate() {
    if (this.patternEditor) this.patternEditor.transformRotate();
  }
  _transformEditorFlipH() {
    if (this.patternEditor) this.patternEditor.transformFlipH();
  }
  _transformEditorFlipV() {
    if (this.patternEditor) this.patternEditor.transformFlipV();
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
      // Load through PatternEditor so the dynamic grid auto-fits and
      // the input.pattern gets populated correctly. Use 'library' mode
      // so built-in presets remain read-only (save-as-new only).
      if (this.patternEditor) {
        this.patternEditor.loadPattern(orientedCells, null, 'library', name);
        // loadPattern resets _activePresetName to the libraryId; mirror it here.
        this._activePresetName = name;
        this._editorDirty = false;
      } else {
        // Fallback: populate input.pattern directly so stamping works
        // even if the editor delegate isn't available.
        this.input.setPattern(orientedCells);
        this._activePresetName = name;
        this._editorDirty = false;
      }
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

  // Compatibility shims for legacy callers (patternZoo etc.).
  _drawEditor() {
    if (this.patternEditor) this.patternEditor.redraw();
  }
  _openEditorPanel() {
    if (this.patternEditor) this.patternEditor.open();
  }
  _closeEditorPanel() {
    if (this.patternEditor) this.patternEditor.close();
  }

  // Load cells into the editor. For built-in (library) patterns, callers
  // can pass mode='library' along with the libraryId to enable read-only
  // editing (save-as-new only).
  loadPatternIntoEditor(cells, customName = null, mode = 'view', libraryId = null) {
    if (!this.patternEditor) return;
    this.patternEditor.loadPattern(cells, customName, mode, libraryId);
  }
  // (legacy save/JSON UI removed — handled by PatternEditor)

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
