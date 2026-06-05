import { CONFIG, CELL_TYPE } from './config.js';
import { Logger } from './logger.js';
import { loadJSON, saveJSON } from './storage.js';

const STORAGE_KEY = 'missileDefenseCustomPatterns';

/**
 * PatternCapture: lets the user drag-select a rectangular region of the
 * game grid, name it, and persist it as a reusable pattern.
 *
 * While capture mode is active:
 *   - The game is paused (speed forced to 0)
 *   - Normal drawing input is suppressed (input.cancelDrawing() on entry)
 *   - Mouse/touch drag draws a selection rectangle over the canvas
 *   - On release, a name prompt appears; pattern is saved & registered
 *     into the DrawTools pattern presets, making it immediately stampable.
 */
export class PatternCapture {
  constructor({ game, canvas, drawTools }) {
    this.game = game;
    this.canvas = canvas;
    this.drawTools = drawTools;
    this.active = false;
    this.dragging = false;
    this.startCell = null;
    this.currentCell = null;
    this._stashedSpeed = null;
    this._overlay = null;
    this._rectEl = null;
    this._hintEl = null;
    this._nameDialog = null;
    // Custom patterns loaded from localStorage: { name: [[x,y], ...] }
    this.customPatterns = loadJSON(STORAGE_KEY, {});
    // Inject saved patterns into the DrawTools preset registry so they
    // appear in the dropdown immediately.
    this._registerAllSaved();
    // Pre-bound handlers so we can add/remove them cleanly.
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onTouchStart = this._onTouchStart.bind(this);
    this._onTouchMove = this._onTouchMove.bind(this);
    this._onTouchEnd = this._onTouchEnd.bind(this);
    this._onKey = this._onKey.bind(this);
  }

  // Inject all currently-saved custom patterns into DrawTools so they
  // show up in the dropdown alongside the built-ins.
  _registerAllSaved() {
    if (!this.drawTools) return;
    const bag =
      this.drawTools.constructor.PATTERN_PRESETS_REF || this.drawTools.PATTERN_PRESETS_REF;
    if (!bag) return;
    for (const [name, cells] of Object.entries(this.customPatterns)) {
      // Prefix custom patterns with a star so they're visually distinct.
      const key = this._customKey(name);
      bag[key] = cells.map((c) => [c[0], c[1]]);
      this._ensureDropdownOption(key, `★ ${name}`);
    }
  }

  _customKey(name) {
    return `custom_${name.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  }

  _ensureDropdownOption(key, label) {
    const sel = document.getElementById('pattern-presets');
    if (!sel) return;
    for (const opt of sel.options) {
      if (opt.value === key) {
        opt.textContent = label; // update label if it changed
        return;
      }
    }
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = label;
    sel.appendChild(opt);
  }

  _removeDropdownOption(key) {
    const sel = document.getElementById('pattern-presets');
    if (!sel) return;
    for (let i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === key) {
        sel.remove(i);
        return;
      }
    }
  }

  // -------------------- Activation --------------------
  start() {
    if (this.active) return;
    this.active = true;
    Logger.info('[PatternCapture] Entering capture mode.');
    // Cancel any in-progress drawing AND suspend the draw tool so
    // capture-mode drags don't paint cells.
    if (this.game.input) {
      this.game.input.cancelDrawing();
      this.game.input.setSuspended(true);
    }
    // Pause the game.
    this._stashedSpeed = CONFIG.SPEED_MULTIPLIER;
    CONFIG.SPEED_MULTIPLIER = 0;
    const speedLabel = document.getElementById('speed-label');
    if (speedLabel) speedLabel.textContent = 'PAUSED (capture)';
    // Build overlay UI.
    this._buildOverlay();
    // Bind input.
    this.canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);
    this.canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
    window.addEventListener('touchmove', this._onTouchMove, { passive: false });
    window.addEventListener('touchend', this._onTouchEnd);
    window.addEventListener('keydown', this._onKey);
    // Update toggle button state.
    const btn = document.getElementById('pattern-capture-button');
    if (btn) {
      btn.classList.add('active');
      btn.textContent = '◧ Stop Capture';
    }
  }

  stop() {
    if (!this.active) return;
    Logger.info('[PatternCapture] Exiting capture mode.');
    this.active = false;
    this.dragging = false;
    this.startCell = null;
    this.currentCell = null;
    // Re-enable the draw tool.
    if (this.game.input) this.game.input.setSuspended(false);
    // Restore speed.
    if (this._stashedSpeed != null) {
      CONFIG.SPEED_MULTIPLIER = this._stashedSpeed;
      this._stashedSpeed = null;
    }
    // Resync slider label.
    if (this.game && this.game.speedSlider) {
      this.game._applySpeedFromSlider();
    }
    // Tear down overlay.
    this._destroyOverlay();
    // Unbind input.
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup', this._onMouseUp);
    this.canvas.removeEventListener('touchstart', this._onTouchStart);
    window.removeEventListener('touchmove', this._onTouchMove);
    window.removeEventListener('touchend', this._onTouchEnd);
    window.removeEventListener('keydown', this._onKey);
    // Reset button state.
    const btn = document.getElementById('pattern-capture-button');
    if (btn) {
      btn.classList.remove('active');
      btn.textContent = '◧ Capture Pattern';
    }
  }

  toggle() {
    if (this.active) this.stop();
    else this.start();
  }

  // -------------------- Overlay UI --------------------
  _buildOverlay() {
    if (this._overlay) return;
    // The overlay sits over the canvas at the same position.
    const container = document.getElementById('game-container');
    if (!container) return;
    const canvasRect = this.canvas.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const overlay = document.createElement('div');
    overlay.id = 'pattern-capture-overlay';
    overlay.style.cssText = `
          position: absolute;
          top: ${canvasRect.top - containerRect.top + CONFIG.HUD_HEIGHT}px;
          left: ${canvasRect.left - containerRect.left}px;
          width: ${this.canvas.width}px;
          height: ${this.canvas.height - CONFIG.HUD_HEIGHT}px;
          pointer-events: none;
          z-index: 8;
          background: rgba(255, 200, 60, 0.06);
          border: 2px dashed rgba(255, 200, 60, 0.6);
          box-sizing: border-box;
        `;
    container.appendChild(overlay);
    // Selection rectangle.
    const rect = document.createElement('div');
    rect.id = 'pattern-capture-rect';
    rect.style.cssText = `
          position: absolute;
          border: 2px solid #ffcc44;
          background: rgba(255, 204, 68, 0.18);
          box-shadow: 0 0 12px rgba(255, 204, 68, 0.6);
          display: none;
          pointer-events: none;
        `;
    overlay.appendChild(rect);
    // Hint banner at the top.
    const hint = document.createElement('div');
    hint.id = 'pattern-capture-hint';
    hint.style.cssText = `
          position: absolute;
          top: 8px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(5, 5, 20, 0.92);
          border: 1px solid #ffcc44;
          color: #ffcc44;
          font-family: 'Courier New', monospace;
          font-size: 13px;
          padding: 8px 16px;
          border-radius: 4px;
          font-weight: bold;
          letter-spacing: 1px;
          text-shadow: 0 0 6px rgba(255, 204, 68, 0.5);
          white-space: nowrap;
          pointer-events: none;
        `;
    hint.textContent = '◧ CAPTURE MODE — Drag to select a region. [Esc] cancel';
    overlay.appendChild(hint);
    this._overlay = overlay;
    this._rectEl = rect;
    this._hintEl = hint;
  }

  _destroyOverlay() {
    if (this._overlay && this._overlay.parentNode) {
      this._overlay.parentNode.removeChild(this._overlay);
    }
    this._overlay = null;
    this._rectEl = null;
    this._hintEl = null;
    // Also dismiss any open name dialog.
    if (this._nameDialog && this._nameDialog.parentNode) {
      this._nameDialog.parentNode.removeChild(this._nameDialog);
    }
    this._nameDialog = null;
  }

  _updateRect() {
    if (!this._rectEl || !this.startCell || !this.currentCell) return;
    const cs = CONFIG.CELL_SIZE;
    const x0 = Math.min(this.startCell.gx, this.currentCell.gx);
    const x1 = Math.max(this.startCell.gx, this.currentCell.gx);
    const y0 = Math.min(this.startCell.gy, this.currentCell.gy);
    const y1 = Math.max(this.startCell.gy, this.currentCell.gy);
    this._rectEl.style.display = 'block';
    this._rectEl.style.left = `${x0 * cs}px`;
    this._rectEl.style.top = `${y0 * cs}px`;
    this._rectEl.style.width = `${(x1 - x0 + 1) * cs}px`;
    this._rectEl.style.height = `${(y1 - y0 + 1) * cs}px`;
    // Update hint with selection size.
    if (this._hintEl) {
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      this._hintEl.textContent = `◧ Selection: ${w}×${h} — release to capture, [Esc] cancel`;
    }
  }

  // -------------------- Input handling --------------------
  _getCell(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const cs = CONFIG.CELL_SIZE > 0 ? CONFIG.CELL_SIZE : 1;
    const x = clientX - rect.left;
    const y = clientY - rect.top - CONFIG.HUD_HEIGHT;
    return {
      gx: Math.floor(x / cs),
      gy: Math.floor(y / cs),
    };
  }

  _clampCell(cell) {
    const g = this.game.grid;
    return {
      gx: Math.max(0, Math.min(g.width - 1, cell.gx)),
      gy: Math.max(0, Math.min(g.height - 1, cell.gy)),
    };
  }

  _onMouseDown(e) {
    if (!this.active) return;
    if (e.button !== 0) return; // left button only
    e.preventDefault();
    e.stopPropagation();
    this.dragging = true;
    const cell = this._clampCell(this._getCell(e.clientX, e.clientY));
    this.startCell = cell;
    this.currentCell = cell;
    this._updateRect();
  }

  _onMouseMove(e) {
    if (!this.active || !this.dragging) return;
    e.preventDefault();
    const cell = this._clampCell(this._getCell(e.clientX, e.clientY));
    this.currentCell = cell;
    this._updateRect();
  }

  _onMouseUp(e) {
    if (!this.active || !this.dragging) return;
    e.preventDefault();
    this.dragging = false;
    this._finishSelection();
  }

  _onTouchStart(e) {
    if (!this.active) return;
    if (!e.touches || e.touches.length === 0) return;
    e.preventDefault();
    this.dragging = true;
    const t = e.touches[0];
    const cell = this._clampCell(this._getCell(t.clientX, t.clientY));
    this.startCell = cell;
    this.currentCell = cell;
    this._updateRect();
  }

  _onTouchMove(e) {
    if (!this.active || !this.dragging) return;
    if (!e.touches || e.touches.length === 0) return;
    e.preventDefault();
    const t = e.touches[0];
    const cell = this._clampCell(this._getCell(t.clientX, t.clientY));
    this.currentCell = cell;
    this._updateRect();
  }

  _onTouchEnd(e) {
    if (!this.active || !this.dragging) return;
    e.preventDefault();
    this.dragging = false;
    this._finishSelection();
  }

  _onKey(e) {
    if (!this.active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      // If a name dialog is open, ESC closes only that.
      if (this._nameDialog) {
        this._closeNameDialog();
        return;
      }
      this.stop();
    }
  }

  // -------------------- Capture logic --------------------
  _finishSelection() {
    if (!this.startCell || !this.currentCell) return;
    const g = this.game.grid;
    const x0 = Math.min(this.startCell.gx, this.currentCell.gx);
    const x1 = Math.max(this.startCell.gx, this.currentCell.gx);
    const y0 = Math.min(this.startCell.gy, this.currentCell.gy);
    const y1 = Math.max(this.startCell.gy, this.currentCell.gy);
    // Collect all live cells within the rectangle that belong to the
    // player (DEFENSE) or that the player likely wants to capture.
    // We capture DEFENSE cells primarily; missile cells are intentionally
    // skipped (capturing enemy patterns would let players replay them as
    // friendly, which is interesting but not the primary use case here).
    // Pending cells are also included since they represent the player's
    // active drawing.
    const cells = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!g.inBounds(x, y)) continue;
        const wx = g.wrapX(x);
        const i = y * g.width + wx;
        const t = g.cells[i];
        const pending = g.pending[i];
        if (t === CELL_TYPE.DEFENSE || pending) {
          cells.push([x - x0, y - y0]);
        }
      }
    }
    if (cells.length === 0) {
      // Empty selection — show a brief notice, reset rect, allow retry.
      if (this._hintEl) {
        this._hintEl.style.color = '#ff8888';
        this._hintEl.style.borderColor = '#ff8888';
        this._hintEl.textContent = '⚠ Empty selection — try again or [Esc] to cancel';
        setTimeout(() => {
          if (this._hintEl) {
            this._hintEl.style.color = '#ffcc44';
            this._hintEl.style.borderColor = '#ffcc44';
            this._hintEl.textContent = '◧ CAPTURE MODE — Drag to select a region. [Esc] cancel';
          }
        }, 1800);
      }
      if (this._rectEl) this._rectEl.style.display = 'none';
      this.startCell = null;
      this.currentCell = null;
      return;
    }
    // Show the name dialog.
    this._showNameDialog(cells);
  }

  _showNameDialog(cells) {
    if (this._nameDialog) return;
    const overlay = this._overlay;
    if (!overlay) return;
    const dlg = document.createElement('div');
    dlg.id = 'pattern-capture-name-dialog';
    dlg.style.cssText = `
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(5, 5, 20, 0.97);
          border: 2px solid #ffcc44;
          border-radius: 8px;
          padding: 20px 26px;
          color: #e0e0ff;
          font-family: 'Courier New', monospace;
          font-size: 14px;
          box-shadow: 0 0 30px rgba(255, 204, 68, 0.4);
          min-width: 320px;
          text-align: center;
          pointer-events: auto;
        `;
    dlg.innerHTML = `
          <h3 style="color:#ffcc44;margin-bottom:12px;text-shadow:0 0 8px #ffcc44;
                     font-size:18px;letter-spacing:1px;">
            Save Pattern
          </h3>
          <p style="color:#c0c0d0;font-size:12px;margin-bottom:14px;">
            Captured ${cells.length} cell${cells.length === 1 ? '' : 's'}.
            Enter a name to save this pattern.
          </p>
          <input type="text" id="pattern-capture-name-input"
            maxlength="40"
            placeholder="my pattern"
            style="width:100%;padding:8px 10px;font-family:inherit;font-size:14px;
                   background:#0a0a20;color:#e0e0ff;border:1px solid #4040a0;
                   border-radius:3px;box-sizing:border-box;outline:none;
                   text-align:center;">
          <div style="margin-top:14px;display:flex;gap:10px;justify-content:center;">
            <button id="pattern-capture-save-btn"
              style="background:#ffcc44;color:#000010;border:none;padding:8px 18px;
                     font-family:inherit;font-size:13px;font-weight:bold;
                     cursor:pointer;border-radius:3px;">
              Save
            </button>
            <button id="pattern-capture-cancel-btn"
              style="background:transparent;color:#8080a0;border:1px solid #4040a0;
                     padding:8px 18px;font-family:inherit;font-size:13px;
                     cursor:pointer;border-radius:3px;">
              Cancel
            </button>
          </div>
          <p id="pattern-capture-error" style="color:#ff8888;font-size:11px;
                                              margin-top:8px;min-height:14px;"></p>
        `;
    overlay.appendChild(dlg);
    this._nameDialog = dlg;
    const input = dlg.querySelector('#pattern-capture-name-input');
    const saveBtn = dlg.querySelector('#pattern-capture-save-btn');
    const cancelBtn = dlg.querySelector('#pattern-capture-cancel-btn');
    const errEl = dlg.querySelector('#pattern-capture-error');
    // Focus + select.
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
    const trySave = () => {
      const raw = (input.value || '').trim();
      if (raw.length === 0) {
        errEl.textContent = 'Name cannot be empty.';
        return;
      }
      if (raw.length > 40) {
        errEl.textContent = 'Name too long (max 40 chars).';
        return;
      }
      // Check for duplicate (case-insensitive).
      const existingLower = Object.keys(this.customPatterns).map((k) => k.toLowerCase());
      if (existingLower.includes(raw.toLowerCase())) {
        // Prompt for overwrite.
        if (!window.confirm(`A pattern named "${raw}" already exists. Overwrite?`)) {
          errEl.textContent = 'Choose a different name.';
          return;
        }
        // Find canonical name and delete the old entry.
        const canonical = Object.keys(this.customPatterns).find(
          (k) => k.toLowerCase() === raw.toLowerCase()
        );
        if (canonical) this._deletePattern(canonical, { silent: true });
      }
      this._savePattern(raw, cells);
      this._closeNameDialog();
      this.stop();
    };
    saveBtn.addEventListener('click', trySave);
    cancelBtn.addEventListener('click', () => {
      this._closeNameDialog();
      // Don't stop the whole capture mode — let user try again.
      if (this._rectEl) this._rectEl.style.display = 'none';
      this.startCell = null;
      this.currentCell = null;
      if (this._hintEl) {
        this._hintEl.textContent = '◧ CAPTURE MODE — Drag to select a region. [Esc] cancel';
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        trySave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelBtn.click();
      }
      // Prevent game hotkeys from firing while typing.
      e.stopPropagation();
    });
  }

  _closeNameDialog() {
    if (this._nameDialog && this._nameDialog.parentNode) {
      this._nameDialog.parentNode.removeChild(this._nameDialog);
    }
    this._nameDialog = null;
  }

  // Save a pattern, persist to localStorage, register with DrawTools.
  _savePattern(name, cells) {
    this.customPatterns[name] = cells.map((c) => [c[0], c[1]]);
    saveJSON(STORAGE_KEY, this.customPatterns);
    const key = this._customKey(name);
    const bag =
      this.drawTools.constructor.PATTERN_PRESETS_REF || this.drawTools.PATTERN_PRESETS_REF;
    if (bag) bag[key] = cells.map((c) => [c[0], c[1]]);
    this._ensureDropdownOption(key, `★ ${name}`);
    Logger.info(`[PatternCapture] Saved pattern "${name}" (${cells.length} cells).`);
    // Show a brief confirmation via the renderer.
    if (this.game.renderer && this.game.grid) {
      this.game.renderer.addBigFloater(
        Math.floor(this.game.grid.width / 2),
        Math.floor(this.game.grid.height / 3),
        `★ SAVED: ${name}`,
        '#ffcc44',
        1.6
      );
    }
  }

  // Delete a saved pattern.
  _deletePattern(name, { silent = false } = {}) {
    if (!(name in this.customPatterns)) return false;
    delete this.customPatterns[name];
    saveJSON(STORAGE_KEY, this.customPatterns);
    const key = this._customKey(name);
    const bag =
      this.drawTools.constructor.PATTERN_PRESETS_REF || this.drawTools.PATTERN_PRESETS_REF;
    if (bag) delete bag[key];
    this._removeDropdownOption(key);
    if (!silent) {
      Logger.info(`[PatternCapture] Deleted pattern "${name}".`);
    }
    return true;
  }

  // Public API: list saved patterns (for cheats/console).
  listSaved() {
    return Object.keys(this.customPatterns).map((name) => ({
      name,
      cells: this.customPatterns[name].length,
    }));
  }

  // Public API: delete a saved pattern by name.
  deleteSaved(name) {
    return this._deletePattern(name);
  }

  // Public API: clear all saved patterns.
  clearAllSaved() {
    const names = Object.keys(this.customPatterns);
    for (const n of names) this._deletePattern(n, { silent: true });
    Logger.info(`[PatternCapture] Cleared ${names.length} saved pattern(s).`);
    return names.length;
  }
}
