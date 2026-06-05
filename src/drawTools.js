import {DRAW_MODE} from './input.js';
import {Logger} from './logger.js';

// Famous Game-of-Life patterns. Coordinates are [x, y] offsets.
export const PATTERN_PRESETS = {
  glider: [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]],
  blinker: [[0, 0], [1, 0], [2, 0]],
  block: [[0, 0], [1, 0], [0, 1], [1, 1]],
  lwss: [[1, 0], [4, 0], [0, 1], [0, 2], [4, 2], [0, 3], [1, 3], [2, 3], [3, 3]],
  rpentomino: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],
  acorn: [[1, 0], [3, 1], [0, 2], [1, 2], [4, 2], [5, 2], [6, 2]],
  toad: [[1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1]],
  beacon: [[0, 0], [1, 0], [0, 1], [1, 1], [2, 2], [3, 2], [2, 3], [3, 3]],
  // Spaceships
  mwss: [[1, 0], [4, 0], [0, 1], [0, 2], [4, 2], [4, 3], [0, 4], [1, 4], [2, 4], [3, 4]],
  hwss: [[1, 0], [2, 0], [5, 0], [0, 1], [0, 2], [5, 2], [5, 3], [0, 4], [1, 4], [2, 4], [3, 4], [4, 4]],
  glider_sw: [[1, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
  glider_ne: [[0, 0], [1, 0], [2, 0], [2, 1], [1, 2]],
  glider_nw: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 2]],
  // Oscillators
  pulsar: [
    [2, 0], [3, 0], [4, 0], [8, 0], [9, 0], [10, 0],
    [0, 2], [5, 2], [7, 2], [12, 2],
    [0, 3], [5, 3], [7, 3], [12, 3],
    [0, 4], [5, 4], [7, 4], [12, 4],
    [2, 5], [3, 5], [4, 5], [8, 5], [9, 5], [10, 5],
    [2, 7], [3, 7], [4, 7], [8, 7], [9, 7], [10, 7],
    [0, 8], [5, 8], [7, 8], [12, 8],
    [0, 9], [5, 9], [7, 9], [12, 9],
    [0, 10], [5, 10], [7, 10], [12, 10],
    [2, 12], [3, 12], [4, 12], [8, 12], [9, 12], [10, 12],
  ],
  penta_decathlon: [
    [1, 0], [1, 1], [0, 2], [2, 2], [1, 3], [1, 4], [1, 5], [1, 6], [0, 7], [2, 7], [1, 8], [1, 9],
  ],
  // Methuselahs
  diehard: [[6, 0], [0, 1], [1, 1], [1, 2], [5, 2], [6, 2], [7, 2]],
  // Glider Guns
  gosper_gun: [
    [24, 0],
    [22, 1], [24, 1],
    [12, 2], [13, 2], [20, 2], [21, 2], [34, 2], [35, 2],
    [11, 3], [15, 3], [20, 3], [21, 3], [34, 3], [35, 3],
    [0, 4], [1, 4], [10, 4], [16, 4], [20, 4], [21, 4],
    [0, 5], [1, 5], [10, 5], [14, 5], [16, 5], [17, 5], [22, 5], [24, 5],
    [10, 6], [16, 6], [24, 6],
    [11, 7], [15, 7],
    [12, 8], [13, 8],
  ],
  // Spaceships - copperhead (period-10)
  copperhead: [
    [1, 0], [2, 0], [3, 0], [4, 0],
    [0, 1], [4, 1],
    [4, 2],
    [0, 3], [3, 3],
    [1, 4], [2, 4],
  ],
};

/**
 * Wires up the drawing tools UI: mode buttons, line width/dash controls,
 * and the pattern editor mini-canvas.
 */
export class DrawToolsPanel {
  constructor(input) {
    this.input = input;
    this.editorSize = 12; // 12x12 grid in pattern editor
    // Story engine reference, set externally. When set, only patterns
    // present in storyEngine.unlockedPatterns are stampable from presets.
    this.storyEngine = null;
    // Story-mode tool locks. When storyEngine is set & active, only modes
    // in storyEngine.unlockedTools are selectable. Free-play = no locks.

    this._initModeButtons();
    this._initLineControls();
    this._initPatternEditor();
    this._initPresets();
    this._initKeyboard();
    this._updateVisibility();
  }

  _initModeButtons() {
    this.modeButtons = document.querySelectorAll('.mode-btn');
    this.modeButtons.forEach(btn => {
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
    this.modeButtons.forEach(btn => {
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
    this.modeButtons.forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    this._updateVisibility();
  }

  _updateVisibility() {
    const lineTools = document.getElementById('line-tools');
    const patternTools = document.getElementById('pattern-tools');
    if (!lineTools || !patternTools) return;
    const mode = this.input.mode;
    // Line width/dash apply to freehand and line modes.
    lineTools.style.display =
      (mode === DRAW_MODE.FREEHAND || mode === DRAW_MODE.LINE) ? 'flex' : 'none';
    patternTools.style.display = (mode === DRAW_MODE.PATTERN) ? 'flex' : 'none';
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
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const cs = this.editorCanvas.width / this.editorSize;
      const x = Math.floor(px / cs);
      const y = Math.floor(py / cs);
      if (x < 0 || x >= this.editorSize || y < 0 || y >= this.editorSize) return;
      const key = `${x},${y}`;
      if (this.editorCells.has(key)) this.editorCells.delete(key);
      else this.editorCells.add(key);
      this._syncPatternToInput();
      this._drawEditor();
    };
    this.editorCanvas.addEventListener('mousedown', handle);

    const clearBtn = document.getElementById('pattern-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.editorCells.clear();
        this._syncPatternToInput();
        this._drawEditor();
      });
    }
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
        return;
      }
      // In story mode, block patterns that aren't unlocked yet.
      if (this.storyEngine && this.storyEngine.isActive() &&
        !this.storyEngine.unlockedPatterns.has(name)) {
        Logger.info(`Pattern "${name}" is locked in story mode.`);
        presetSelect.value = '';
        return;
      }
      this.editorCells.clear();
      // Center preset in editor.
      let maxX = 0, maxY = 0;
      for (const [x, y] of bag[name]) {
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      const offX = Math.floor((this.editorSize - maxX - 1) / 2);
      const offY = Math.floor((this.editorSize - maxY - 1) / 2);
      for (const [x, y] of bag[name]) {
        this.editorCells.add(`${x + offX},${y + offY}`);
      }
      this._syncPatternToInput();
      this._drawEditor();
      presetSelect.value = '';
      // Auto-switch to pattern mode.
      this.setMode(DRAW_MODE.PATTERN);
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
          this.input.cyclePatternRotation(e.shiftKey);
          this._drawEditor();
        }
      } else if (e.key === 'x' || e.key === 'X') {
        if (this.input.mode === DRAW_MODE.PATTERN) {
          this.input.flipPatternH();
          this._drawEditor();
        }
            } else if (e.key === 'y' || e.key === 'Y') {
                if (this.input.mode === DRAW_MODE.PATTERN) {
                    this.input.flipPatternV();
                    this._drawEditor();
                }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        // Cycle through modes.
        const order = [DRAW_MODE.FREEHAND, DRAW_MODE.LINE, DRAW_MODE.PATTERN];
        const allowed = order.filter(m => this._isToolUnlocked(m));
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