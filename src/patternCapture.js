import { CONFIG, CELL_TYPE } from './config.js';
import { Logger } from './logger.js';
import { loadJSON, saveJSON } from './storage.js';
import { normalizeCells } from './patterns/library.js';
import { listPatterns } from './patterns/index.js';
import { inferPatternMetadata } from './patterns/inferMetadata.js';
import { getTopology } from './topology.js';

const STORAGE_KEY = 'missileDefenseCustomPatterns';
const STORAGE_KEY_META = 'missileDefenseCustomPatternsMeta';
/**
 * Shared module-level access to saved custom patterns. Other modules
 * (PatternZoo, DrawToolsPanel) read from these to surface custom
 * patterns without needing a PatternCapture instance.
 */
export function loadCustomPatterns() {
  return loadJSON(STORAGE_KEY, {});
}
export function loadCustomPatternMeta() {
  return loadJSON(STORAGE_KEY_META, {});
}
export function saveCustomPatterns(patterns) {
  saveJSON(STORAGE_KEY, patterns);
}
export function saveCustomPatternMeta(meta) {
  saveJSON(STORAGE_KEY_META, meta);
}
export function customKey(name) {
  return `custom_${name.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}
// Simple pub/sub for custom pattern changes so the zoo can refresh live.
const _listeners = new Set();
export function onCustomPatternsChanged(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
export function notifyCustomPatternsChanged() {
  for (const fn of _listeners) {
    try {
      fn();
    } catch (e) {
      Logger.warn('custom pattern listener failed', e);
    }
  }
}

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
    this.customPatterns = loadCustomPatterns();
    this.customPatternMeta = loadCustomPatternMeta();
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
    // Bind inference fn for use in _savePattern. Imported at top of file.
    this._inferFn = inferPatternMetadata;
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
      const key = customKey(name);
      bag[key] = cells.map((c) => [c[0], c[1]]);
      this._ensureDropdownOption(key, `★ ${name}`);
    }
  }

  _customKey(name) {
    return customKey(name);
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
    // Convert HUD offset from canvas-pixel space to CSS-pixel space.
    const scaleY = canvasRect.height / this.canvas.height;
    const hudCss = CONFIG.HUD_HEIGHT * scaleY;
    const playfieldCss = canvasRect.height - hudCss;
    overlay.style.cssText = `
          position: absolute;
          top: ${canvasRect.top - containerRect.top + hudCss}px;
          left: ${canvasRect.left - containerRect.left}px;
          width: ${canvasRect.width}px;
          height: ${playfieldCss}px;
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
    const x0 = Math.min(this.startCell.gx, this.currentCell.gx);
    const x1 = Math.max(this.startCell.gx, this.currentCell.gx);
    const y0 = Math.min(this.startCell.gy, this.currentCell.gy);
    const y1 = Math.max(this.startCell.gy, this.currentCell.gy);
    // Compute bounding rect in canvas-pixel space using the current
    // topology, then convert to CSS pixels for the overlay element.
    const cs = CONFIG.CELL_SIZE;
    const topologyId = (this.game.grid && this.game.grid.topologyId) || 'square';
    const canvasRect = this.canvas.getBoundingClientRect();
    const scaleX = canvasRect.width / this.canvas.width;
    const scaleY = canvasRect.height / this.canvas.height;
    let pxL, pxT, pxR, pxB;
    if (topologyId === 'square') {
      pxL = x0 * cs;
      pxT = y0 * cs;
      pxR = (x1 + 1) * cs;
      pxB = (y1 + 1) * cs;
    } else {
      const topology = getTopology(topologyId);
      // Build the union of cell bounding boxes for the selection.
      let minPx = Infinity,
        minPy = Infinity,
        maxPx = -Infinity,
        maxPy = -Infinity;
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          let verts;
          if (topologyId === 'tri') {
            for (let o = 0; o < 2; o++) {
              verts = topology.cellPolygon(xx, yy, cs, o);
              for (const [vx, vy] of verts) {
                if (vx < minPx) minPx = vx;
                if (vy < minPy) minPy = vy;
                if (vx > maxPx) maxPx = vx;
                if (vy > maxPy) maxPy = vy;
              }
            }
          } else {
            verts = topology.cellPolygon(xx, yy, cs);
            for (const [vx, vy] of verts) {
              if (vx < minPx) minPx = vx;
              if (vy < minPy) minPy = vy;
              if (vx > maxPx) maxPx = vx;
              if (vy > maxPy) maxPy = vy;
            }
          }
        }
      }
      pxL = minPx;
      pxT = minPy;
      pxR = maxPx;
      pxB = maxPy;
    }
    this._rectEl.style.display = 'block';
    this._rectEl.style.left = `${pxL * scaleX}px`;
    this._rectEl.style.top = `${pxT * scaleY}px`;
    this._rectEl.style.width = `${(pxR - pxL) * scaleX}px`;
    this._rectEl.style.height = `${(pxB - pxT) * scaleY}px`;
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
    // Scale CSS pixel coords to internal canvas pixel coords.
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY - CONFIG.HUD_HEIGHT;
    const topologyId = (this.game.grid && this.game.grid.topologyId) || 'square';
    if (topologyId === 'square') {
      return {
        gx: Math.floor(x / cs),
        gy: Math.floor(y / cs),
      };
    }
    const topology = getTopology(topologyId);
    const r = topology.pixelToCell(x, y, cs);
    return { gx: r.x, gy: r.y };
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
  _savePattern(name, cells, meta = null) {
    // Normalize cells so the saved pattern is anchored at (0,0). This
    // matches the format produced by the importer and the pattern
    // library, ensuring custom patterns can be deduplicated and
    // characterized identically to imported ones.
    const normalized = normalizeCells(cells);
    const normCells = normalized.cells;
    this.customPatterns[name] = normCells.map((c) => [c[0], c[1]]);

    // Detect duplicates of built-in patterns by canonical fingerprint.
    const duplicateOf = this._findDuplicateBuiltin(normCells);

    // Run characterization to infer category/period/direction etc.
    // This mirrors the lifewikiImporter pipeline so saved patterns get
    // the same metadata treatment as bundled ones.
    let inferred = null;
    try {
      inferred = this._inferMetadata(normCells);
    } catch (e) {
      Logger.warn('[PatternCapture] Metadata inference failed:', e);
    }

    if (meta) {
      // Merge user-provided meta with inferred values; user values win.
      const merged = inferred ? { ...inferred, ...meta } : { ...meta };
      if (duplicateOf) merged.duplicateOf = duplicateOf;
      this.customPatternMeta[name] = merged;
    } else if (!this.customPatternMeta[name]) {
      // Default metadata for newly captured patterns. Use inferred
      // values if available, falling back to generic defaults.
      const defaults = {
        category: 'misc',
        period: 1,
        direction: null,
        description: 'User-captured pattern.',
        tags: ['custom', 'user'],
        rulesets: ['*'],
        createdAt: Date.now(),
      };
      const merged = inferred ? { ...defaults, ...inferred } : defaults;
      if (duplicateOf) {
        merged.duplicateOf = duplicateOf;
        merged.description = `User-captured pattern. Duplicate of built-in "${duplicateOf}".`;
        if (!merged.tags.includes('duplicate')) merged.tags.push('duplicate');
      }
      this.customPatternMeta[name] = merged;
    } else if (inferred) {
      // Existing pattern being re-saved — refresh inferred fields only
      // if they weren't user-overridden.
      const existing = this.customPatternMeta[name];
      if (!existing.category || existing.category === 'misc') existing.category = inferred.category;
      if (existing.period == null || existing.period === 1) existing.period = inferred.period;
      if (!existing.direction) existing.direction = inferred.direction;
      if (duplicateOf && !existing.duplicateOf) existing.duplicateOf = duplicateOf;
    }
    if (duplicateOf) {
      Logger.info(`[PatternCapture] Saved "${name}" — duplicate of built-in "${duplicateOf}".`);
    }

    saveCustomPatterns(this.customPatterns);
    saveCustomPatternMeta(this.customPatternMeta);
    const key = customKey(name);
    const bag =
      this.drawTools.constructor.PATTERN_PRESETS_REF || this.drawTools.PATTERN_PRESETS_REF;
    if (bag) bag[key] = normCells.map((c) => [c[0], c[1]]);
    this._ensureDropdownOption(key, `★ ${name}`);
    Logger.info(
      `[PatternCapture] Saved pattern "${name}" (${normCells.length} cells)` +
        (inferred
          ? ` → ${inferred.category}${inferred.period > 1 ? ` p${inferred.period}` : ''}`
          : '')
    );
    notifyCustomPatternsChanged();
    // Show a brief confirmation via the renderer.
    if (this.game.renderer && this.game.grid) {
      const label = duplicateOf
        ? `★ SAVED: ${name}\n(duplicate of ${duplicateOf})`
        : `★ SAVED: ${name}`;
      this.game.renderer.addBigFloater(
        Math.floor(this.game.grid.width / 2),
        Math.floor(this.game.grid.height / 3),
        label,
        '#ffcc44',
        1.6
      );
    }
  }
  // Build a canonical fingerprint for a normalized cell list and
  // search the built-in pattern registry for a match. Returns the id
  // of the matching built-in pattern, or null.
  _findDuplicateBuiltin(normCells) {
    if (!Array.isArray(normCells) || normCells.length === 0) return null;
    const fingerprint = this._fingerprint(normCells);
    try {
      const all = listPatterns();
      for (const p of all) {
        // Skip other custom patterns (those have ids starting with "custom:").
        if (p.id && p.id.startsWith('custom:')) continue;
        const fp = this._fingerprint(p.cells);
        if (fp === fingerprint) return p.id;
      }
    } catch (e) {
      Logger.warn('[PatternCapture] Duplicate scan failed:', e);
    }
    return null;
  }
  // Canonical fingerprint: sort cells lexicographically and join.
  // Assumes input is already normalized (min = 0,0).
  _fingerprint(cells) {
    const sorted = cells.map(([x, y]) => `${x},${y}`).sort();
    return `${sorted.length}:${sorted.join(';')}`;
  }
  // Run pattern characterization to infer category, period, direction.
  // Uses dynamic import so the inference module is only loaded when needed
  // (and so we don't pull Node-only path/fs imports into the browser bundle).
  _inferMetadata(normCells) {
    // inferMetadata.js is browser-safe (only depends on rules/* and library.js)
    // so we import it at the top of this module and bind the function to
    // this._inferFn in the constructor.
    if (!this._inferFn) {
      return null;
    }
    let result;
    try {
      result = this._inferFn(normCells, {
        maxPeriod: 30,
        methuselahGens: 100,
        populationCap: 5000,
      });
    } catch (e) {
      Logger.warn('[PatternCapture] inferMetadata threw:', e);
      return null;
    }
    if (!result) return null;
    const tags = ['custom', 'user'];
    if (result.category) tags.push(result.category);
    if (result.period > 1) tags.push(`p${result.period}`);
    if (result.unbounded) tags.push('unbounded');
    if (result.extinct) tags.push('extinct');
    return {
      category: result.category || 'misc',
      period: result.period > 0 ? result.period : 1,
      direction: result.direction || null,
      description:
        result.notes && result.notes.length > 0
          ? `User-captured pattern. ${result.notes[0]}`
          : 'User-captured pattern.',
      tags,
      rulesets: ['*'],
      createdAt: Date.now(),
      maxBounds: result.maxBounds || null,
      maxPopulation: result.maxPopulation,
      finalPopulation: result.finalPopulation,
      stabilizedAt: result.stabilizedAt,
      extinct: !!result.extinct,
      unbounded: !!result.unbounded,
    };
  }

  // Delete a saved pattern.
  _deletePattern(name, { silent = false } = {}) {
    if (!(name in this.customPatterns)) return false;
    delete this.customPatterns[name];
    delete this.customPatternMeta[name];
    saveCustomPatterns(this.customPatterns);
    saveCustomPatternMeta(this.customPatternMeta);
    const key = customKey(name);
    const bag =
      this.drawTools.constructor.PATTERN_PRESETS_REF || this.drawTools.PATTERN_PRESETS_REF;
    if (bag) delete bag[key];
    this._removeDropdownOption(key);
    if (!silent) {
      Logger.info(`[PatternCapture] Deleted pattern "${name}".`);
    }
    notifyCustomPatternsChanged();
    return true;
  }

  // Public API: list saved patterns (for cheats/console).
  listSaved() {
    return Object.keys(this.customPatterns).map((name) => ({
      name,
      cells: this.customPatterns[name].length,
      meta: this.customPatternMeta[name] || null,
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
  // Public API: save a pattern from external code (e.g. editor JSON import).
  savePatternExternal(name, cells, meta) {
    if (!name || typeof name !== 'string') return false;
    if (!Array.isArray(cells) || cells.length === 0) return false;
    this._savePattern(name, cells, meta);
    return true;
  }
  // Public API: update metadata only.
  updatePatternMeta(name, meta) {
    if (!(name in this.customPatterns)) return false;
    this.customPatternMeta[name] = { ...this.customPatternMeta[name], ...meta };
    saveCustomPatternMeta(this.customPatternMeta);
    notifyCustomPatternsChanged();
    return true;
  }
  // Public API: get a saved pattern with metadata.
  getSaved(name) {
    if (!(name in this.customPatterns)) return null;
    return {
      name,
      cells: this.customPatterns[name].map((c) => [c[0], c[1]]),
      meta: this.customPatternMeta[name] || null,
    };
  }
  // Public API: rename a pattern.
  renamePattern(oldName, newName) {
    if (!(oldName in this.customPatterns)) return false;
    if (newName === oldName) return true;
    if (newName in this.customPatterns) return false;
    this.customPatterns[newName] = this.customPatterns[oldName];
    this.customPatternMeta[newName] = this.customPatternMeta[oldName] || {};
    delete this.customPatterns[oldName];
    delete this.customPatternMeta[oldName];
    saveCustomPatterns(this.customPatterns);
    saveCustomPatternMeta(this.customPatternMeta);
    // Update dropdown.
    this._removeDropdownOption(customKey(oldName));
    const bag =
      this.drawTools.constructor.PATTERN_PRESETS_REF || this.drawTools.PATTERN_PRESETS_REF;
    if (bag) {
      delete bag[customKey(oldName)];
      bag[customKey(newName)] = this.customPatterns[newName].map((c) => [c[0], c[1]]);
    }
    this._ensureDropdownOption(customKey(newName), `★ ${newName}`);
    notifyCustomPatternsChanged();
    return true;
  }
}
