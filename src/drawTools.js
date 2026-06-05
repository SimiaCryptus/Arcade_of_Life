import { DRAW_MODE } from './input.js';
import { Logger } from './logger.js';
import { PATTERN_PRESETS as LIBRARY_PRESETS } from './patterns/index.js';

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
    // Stashed speed multiplier while the editor is open (to restore on close).
    this._editorPauseSpeed = null;
    // Callback for external coordination (e.g., main.js syncing speed slider).
    this.onEditorOpen = null;
    this.onEditorClose = null;
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
    this._initPresets();
    this._initKeyboard();
    this._initEditorToggle();
    this._initEditorTransformHints();
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
  }

  _isToolUnlocked(mode) {
    if (!this.storyEngine || !this.storyEngine.isActive()) return true;
    const unlocked = this.storyEngine.unlockedTools;
    if (!unlocked) return true;
    return unlocked.has(mode);
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
    this._updateVisibility();
    // If editor panel is open but we're leaving pattern mode, close it.
    if (mode !== DRAW_MODE.PATTERN && this._editorPanelOpen) {
      this._closeEditorPanel();
    }
  }

  _updateVisibility() {
    const lineTools = document.getElementById('line-tools');
    const patternTools = document.getElementById('pattern-tools');
    if (!lineTools || !patternTools) return;
    const mode = this.input.mode;
    // Line width/dash apply to freehand and line modes.
    lineTools.style.display =
      mode === DRAW_MODE.FREEHAND || mode === DRAW_MODE.LINE ? 'flex' : 'none';
    patternTools.style.display = mode === DRAW_MODE.PATTERN ? 'flex' : 'none';
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
      this.editorCells.clear();
      // Center preset in editor.
      let maxX = 0,
        maxY = 0;
      for (const [x, y] of bag[name]) {
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      const offX = Math.floor((this.editorSize - maxX - 1) / 2);
      const offY = Math.floor((this.editorSize - maxY - 1) / 2);
      for (const [x, y] of bag[name]) {
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
    for (const opt of sel.options) {
      if (!opt.value) {
        opt.hidden = false;
        opt.disabled = false;
        continue;
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
      glider_sw: 'Glider (SW)',
      glider_ne: 'Glider (NE)',
      glider_nw: 'Glider (NW)',
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
        const order = [DRAW_MODE.FREEHAND, DRAW_MODE.LINE, DRAW_MODE.PATTERN];
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
