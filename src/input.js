import { CONFIG, CELL_TYPE } from './config.js';
import { Logger } from './logger.js';
import { getTopology } from './topology.js';

export const DRAW_MODE = {
  FREEHAND: 'freehand',
  LINE: 'line',
  PATTERN: 'pattern',
  FILL: 'fill',
};

export const DASH_PATTERNS = {
  solid: null, // every cell
  dashed: [2, 2], // 2 on, 2 off
  dotted: [1, 2], // 1 on, 2 off
  sparse: [1, 4], // 1 on, 4 off
};
/**
 * Fill patterns for the region-fill tool. Each is a function (x, y) => boolean
 * that returns true if the cell at (x, y) should be filled.
 */
export const FILL_PATTERNS = {
  solid: (_x, _y) => true,
  checker: (x, y) => ((x + y) & 1) === 0,
  stripes_h: (_x, y) => (y & 1) === 0,
  stripes_v: (x, _y) => (x & 1) === 0,
  diagonal: (x, y) => (x + y) % 3 === 0,
  dots_sparse: (x, y) => x % 3 === 0 && y % 3 === 0,
  dots_dense: (x, y) => x % 2 === 0 && y % 2 === 0,
  grid: (x, y) => x % 4 === 0 || y % 4 === 0,
  cross: (x, y) => x % 4 === 0 && y % 4 === 0,
  random50: (_x, _y) => Math.random() < 0.5,
  random25: (_x, _y) => Math.random() < 0.25,
};

/**
 * Handles mouse and touch input for drawing defensive patterns.
 * Supports multiple drawing modes (freehand, straight line, pattern stamp),
 * adjustable line width, and dash patterns.
 */
export class InputManager {
  constructor(canvas, grid, defenses) {
    this.canvas = canvas;
    this.grid = grid;
    this.defenses = defenses;
    this.drawing = false;
    this.lastCell = null;
    this.startCell = null;
    this.currentCell = null; // most recent pointer cell (used for previews)
    this.moved = false;
    this.placedThisDrag = [];
    this.onCommit = null;

    // --- Mode state ---
    this.mode = DRAW_MODE.FREEHAND;
    this.lineWidth = 1;
    this.dashPattern = 'solid';
    this._dashCounter = 0; // running counter for dash sequencing
    // --- Fill mode state ---
    this.fillPattern = 'solid';

    // --- Pattern stamp state ---
    // Set of "x,y" strings representing the active pattern cells (in editor coords).
    this.pattern = new Set();
    this.patternRotation = 0; // 0..3, multiples of 90 degrees CW
    this.patternFlipH = false; // horizontal flip
    this.patternFlipV = false; // vertical flip
    // Touch pattern placement state: when true, pattern is shown as
    // preview during touch-drag and stamped on touch end (better UX
    // for touch than instant stamping on tap-start).
    this._touchPatternPending = false;
    // Stroke history for undo. Each entry is an array of {x, y} cells
    // that were placed as pending during a single stroke.
    this.strokeHistory = [];
    this.MAX_UNDO = 20;

    // Pointer position cache for rendering previews.
    this.hoverCell = null;
    // Suspended flag — when true, all input is ignored. Set by external
    // systems (e.g. pattern capture mode) to temporarily disable input.
    this.suspended = false;

    this._bind();
  }
  // External systems (e.g. pattern capture) can suspend input handling
  // entirely while remaining bound.
  setSuspended(suspended) {
    this.suspended = !!suspended;
    if (this.suspended && this.drawing) {
      this.cancelDrawing();
    }
  }
  /**
   * Detach all event listeners. Call before discarding this InputManager
   * to prevent stale listeners from firing on the canvas/window.
   */
  destroy() {
    if (this._listeners) {
      for (const { target, type, fn, opts } of this._listeners) {
        try {
          target.removeEventListener(type, fn, opts);
        } catch (_e) {
          /* ignore */
        }
      }
      this._listeners = [];
    }
    this.cancelDrawing();
    this.suspended = true;
  }

  setMode(mode) {
    if (!Object.values(DRAW_MODE).includes(mode)) return;
    // If we switch mid-stroke, cancel cleanly.
    if (this.drawing) this.cancelDrawing();
    this.mode = mode;
  }

  setLineWidth(w) {
    this.lineWidth = Math.max(1, Math.min(16, w | 0));
  }

  setDashPattern(name) {
    if (name in DASH_PATTERNS) this.dashPattern = name;
  }
  setFillPattern(name) {
    if (name in FILL_PATTERNS) this.fillPattern = name;
  }

  setPattern(cells) {
    // cells: iterable of [x, y] coords (any integers).
    this.pattern = new Set();
    for (const [x, y] of cells) {
      this.pattern.add(`${x | 0},${y | 0}`);
    }
  }

  clearPattern() {
    this.pattern = new Set();
  }

  rotatePattern() {
    this.patternRotation = (this.patternRotation + 1) % 4;
  }

  flipPatternH() {
    this.patternFlipH = !this.patternFlipH;
  }
  flipPatternV() {
    this.patternFlipV = !this.patternFlipV;
  }

  cyclePatternRotation(reverse = false) {
    if (reverse) {
      this.patternRotation = (this.patternRotation + 3) % 4;
    } else {
      this.patternRotation = (this.patternRotation + 1) % 4;
    }
  }

  // Return the active pattern as a list of [dx, dy] offsets normalized so
  // the top-left of the bounding box is (0,0), with current rotation applied.
  getPatternOffsets() {
    if (this.pattern.size === 0) return [];
    const cells = [];
    for (const key of this.pattern) {
      const [x, y] = key.split(',').map(Number);
      let rx = this.patternFlipH ? -x : x;
      let ry = this.patternFlipV ? -y : y;
      for (let i = 0; i < this.patternRotation; i++) {
        // 90deg CW rotation: (x, y) -> (-y, x); we'll normalize after.
        const nx = -ry;
        const ny = rx;
        rx = nx;
        ry = ny;
      }
      cells.push([rx, ry]);
    }
    // Normalize to bounding box origin.
    let minX = Infinity,
      minY = Infinity;
    for (const [x, y] of cells) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
    }
    return cells.map(([x, y]) => [x - minX, y - minY]);
  }

  _bind() {
    const safe = (fn, name) => (e) => {
      try {
        if (this.suspended) return;
        fn(e);
      } catch (err) {
        Logger.error(`Input handler "${name}" failed.`, err);
      }
    };

    // Track all bindings so destroy() can detach them cleanly.
    this._listeners = [];
    const add = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this._listeners.push({ target, type, fn, opts });
    };
    add(
      this.canvas,
      'mousedown',
      safe((e) => {
        // Right-click (button 2) in pattern mode rotates the pattern.
        // Also support middle-click as an alternate rotate trigger.
        if (this.mode === DRAW_MODE.PATTERN && (e.button === 2 || e.button === 1)) {
          e.preventDefault();
          this.cyclePatternRotation(e.shiftKey);
          // Update hover so the preview reflects the new rotation immediately.
          this.hoverCell = this._getPos(e);
          return;
        }
        // Only left-click (button 0) triggers normal start.
        if (e.button !== 0) return;
        this._onStart(this._getPos(e));
      }, 'mousedown')
    );
    // Suppress the browser context menu on the canvas so right-click
    // rotation works cleanly in pattern mode (and doesn't pop a menu
    // elsewhere either — the canvas has no useful context menu).
    add(
      this.canvas,
      'contextmenu',
      safe((e) => {
        e.preventDefault();
      }, 'contextmenu')
    );
    add(
      this.canvas,
      'mousemove',
      safe((e) => {
        const pos = this._getPos(e);
        this.hoverCell = pos;
        this._onMove(pos);
      }, 'mousemove')
    );
    add(
      window,
      'mouseup',
      safe(() => this._onEnd(), 'mouseup')
    );
    add(
      this.canvas,
      'mouseleave',
      safe(() => {
        this.hoverCell = null;
        if (this.drawing && this.mode === DRAW_MODE.FREEHAND) this.cancelDrawing();
      }, 'mouseleave')
    );
    add(
      this.canvas,
      'touchstart',
      safe((e) => {
        e.preventDefault();
        if (!e.touches || e.touches.length === 0) return;
        // Two-finger tap in pattern mode rotates the pattern.
        if (this.mode === DRAW_MODE.PATTERN && e.touches.length === 2) {
          this.cyclePatternRotation(false);
          // Refresh hover from first touch so preview updates.
          const pos = this._getPos(e.touches[0]);
          this.hoverCell = pos;
          this._touchPatternPending = true;
          return;
        }
        const pos = this._getPos(e.touches[0]);
        this.hoverCell = pos;
        // Mark touch-pattern as pending so _onStart shows preview
        // instead of stamping immediately. The stamp will fire on
        // touchend at the final position.
        if (this.mode === DRAW_MODE.PATTERN) {
          this._touchPatternPending = true;
        }
        this._onStart(pos);
      }, 'touchstart'),
      { passive: false }
    );
    add(
      this.canvas,
      'touchmove',
      safe((e) => {
        e.preventDefault();
        if (!e.touches || e.touches.length === 0) return;
        const pos = this._getPos(e.touches[0]);
        this.hoverCell = pos;
        if (pos.gx < 0 || pos.gx >= this.grid.width || pos.gy < 0 || pos.gy >= this.grid.height) {
          if (this.mode === DRAW_MODE.FREEHAND) this.cancelDrawing();
          return;
        }
        this._onMove(pos);
      }, 'touchmove'),
      { passive: false }
    );
    add(
      window,
      'touchend',
      safe((e) => {
        // In pattern mode, if this was a touch-driven preview (deferred
        // stamp), commit the pattern at the final hover position now.
        if (this.mode === DRAW_MODE.PATTERN && this._touchPatternPending && this.hoverCell) {
          this._touchPatternPending = false;
          // Re-issue start at the final position to stamp + record.
          this._onStart(this.hoverCell);
          this._onEnd();
        } else {
          this._onEnd();
        }
        // Clear hover so the preview doesn't linger after touch ends.
        this.hoverCell = null;
      }, 'touchend')
    );
    add(
      window,
      'touchcancel',
      safe(() => {
        this._touchPatternPending = false;
        this.hoverCell = null;
        this.cancelDrawing();
      }, 'touchcancel')
    );
    add(
      window,
      'keydown',
      safe((e) => {
        if (e.key === 'Escape' && this.drawing) {
          this.cancelDrawing();
        }
      }, 'keydown')
    );
  }

  _getPos(e) {
    const cs = CONFIG.CELL_SIZE > 0 ? CONFIG.CELL_SIZE : 1;
    const rect = this.canvas.getBoundingClientRect();
    // Scale for CSS-resized canvas.
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    // Convert from CSS pixel coords (relative to canvas element) to
    // internal canvas pixel coords, then subtract HUD height and the
    // renderer's centering offsets so we get coordinates relative to
    // the grid's top-left corner. Without subtracting offsetX/offsetY,
    // clicks misalign with rendered cells whenever the grid is
    // centered inside a larger canvas (e.g., on wide viewports).
    const offX = CONFIG._GRID_OFFSET_X || 0;
    const offY = CONFIG._GRID_OFFSET_Y || 0;
    const cssX = (e.clientX || 0) - rect.left;
    const cssY = (e.clientY || 0) - rect.top;
    const x = cssX * scaleX - offX;
    const y = cssY * scaleY - CONFIG.HUD_HEIGHT - offY;
    const topologyId = this.grid && this.grid.topologyId ? this.grid.topologyId : 'square';
    if (topologyId === 'square') {
      const displayX = Math.floor(x / cs);
      const gy = Math.floor(y / cs);
      // Convert display x back to logical grid x using pan offset.
      const panOffset = this.grid.panOffset || 0;
      const w = this.grid.width;
      const gx = (((displayX + panOffset) % w) + w) % w;
      return { gx, gy, topology: 'square' };
    }
    // Hex / Tri: use topology helper.
    const topology = getTopology(topologyId);
    const result = topology.pixelToCell(x, y, cs);
    if (topologyId === 'tri') {
      // For tri, we encode (x, y, orient) into gx/gy by packing orient
      // into the low bit of gx*2.
      return { gx: result.x, gy: result.y, orient: result.orient, topology: 'tri' };
    }
    return { gx: result.x, gy: result.y, topology: 'hex' };
  }

  _isDrawZone(gy) {
    return gy >= this.grid.drawZoneMinY() && gy <= this.grid.drawZoneMaxY();
  }

  _onStart(pos) {
    if (this.mode === DRAW_MODE.PATTERN) {
      // For touch input in pattern mode, defer stamping until touch end
      // and show a live preview during the drag. Detected indirectly:
      // if _touchPatternPending was set true by touchstart, skip stamping
      // here and just record the hover position.
      if (this._touchPatternPending) {
        this.startCell = pos;
        this.currentCell = pos;
        this.hoverCell = pos;
        return;
      }
      // Mouse / non-touch: stamp immediately on click.
      // Click = stamp pattern at cursor. No drag tracking needed.
      this.startCell = pos;
      this.currentCell = pos;
      this._stampPattern(pos.gx, pos.gy);
      return;
    }
    if (this.mode === DRAW_MODE.FILL) {
      // Fill mode: rectangle drag from startCell to currentCell.
      if (!this._isDrawZone(pos.gy)) return;
      this.drawing = true;
      this.startCell = pos;
      this.currentCell = pos;
      this.placedThisDrag = [];
      this.moved = false;
      return;
    }
    if (!this._isDrawZone(pos.gy)) return;

    this.drawing = true;
    this.lastCell = pos;
    this.startCell = pos;
    this.currentCell = pos;
    this.moved = false;
    this.placedThisDrag = [];
    this._dashCounter = 0;

    if (this.mode === DRAW_MODE.LINE) {
      // Don't place anything yet — preview only until release.
      return;
    }

    // Freehand
    const pending = this.grid.getPending(pos.gx, pos.gy);
    if (pending) return;
    if (this.grid.get(pos.gx, pos.gy) === CELL_TYPE.DEFENSE) return;
    this._placeBrush(pos.gx, pos.gy);
  }

  _onMove(pos) {
    if (!this.drawing) return;
    if (pos.gx < 0 || pos.gx >= this.grid.width || pos.gy < 0 || pos.gy >= this.grid.height) {
      if (this.mode === DRAW_MODE.FREEHAND) {
        this.cancelDrawing();
      }
      return;
    }
    if (this.lastCell && (pos.gx !== this.lastCell.gx || pos.gy !== this.lastCell.gy)) {
      this.moved = true;
    }
    this.currentCell = pos;
    if (this.mode === DRAW_MODE.LINE || this.mode === DRAW_MODE.FILL) {
      // No placement during drag — preview is rendered separately.
      return;
    }
    if (this.lastCell) {
      this._line(this.lastCell.gx, this.lastCell.gy, pos.gx, pos.gy);
    }
    this.lastCell = pos;
  }

  _onEnd() {
    if (this.mode === DRAW_MODE.PATTERN) {
      // Nothing to release; pattern is stamped on mousedown.
      // But we still need to start drying any pending cells from the stamp.
      this._recordStrokeForUndo();
      const committed = this.grid.startPendingDry();
      if (this.onCommit) this.onCommit(committed);
      return;
    }
    if (!this.drawing) return;

    if (this.mode === DRAW_MODE.LINE && this.startCell && this.currentCell) {
      // Commit the straight line now.
      this._line(this.startCell.gx, this.startCell.gy, this.currentCell.gx, this.currentCell.gy);
    } else if (this.mode === DRAW_MODE.FILL && this.startCell && this.currentCell) {
      // Commit the fill rectangle now.
      this._fillRect(
        this.startCell.gx,
        this.startCell.gy,
        this.currentCell.gx,
        this.currentCell.gy
      );
    } else if (this.mode === DRAW_MODE.FREEHAND && !this.moved && this.startCell) {
      // Single-click toggle behavior (freehand only).
      const { gx, gy } = this.startCell;
      if (this._isDrawZone(gy) && this.grid.inBounds(gx, gy)) {
        const existing = this.grid.get(gx, gy);
        const td = this.towerDefense || null;
        const tdActive = td && td.active;
        // Barrier/fire are permanent placements — cannot be toggled off.
        if (tdActive && (existing === CELL_TYPE.BARRIER || existing === CELL_TYPE.FIRE)) {
          // No-op: locked.
        } else if (existing === CELL_TYPE.DEFENSE) {
          this.grid.set(gx, gy, CELL_TYPE.EMPTY);
          const wx = this.grid.wrapX(gx);
          const i = gy * this.grid.width + wx;
          if (this.grid.cellAge) this.grid.cellAge[i] = 0;
          this.defenses.refill(1);
        } else if (this.grid.getPending(gx, gy)) {
          this.grid.setPending(gx, gy, 0);
          this.defenses.refill(1);
          const wx = this.grid.wrapX(gx);
          this.placedThisDrag = this.placedThisDrag.filter((p) => !(p.x === wx && p.y === gy));
        }
      }
    }

    this.drawing = false;
    this.lastCell = null;
    this.startCell = null;
    this.currentCell = null;
    this.moved = false;
    this.placedThisDrag = [];
    const committed = this.grid.startPendingDry();
    if (this.onCommit) this.onCommit(committed);
  }

  // Place a single cell as pending (with dash check).
  _placePending(gx, gy, applyDash = true) {
    if (!this._isDrawZone(gy)) return false;
    if (!this.grid.inBounds(gx, gy)) return false;
    if (this.grid.getPending(gx, gy)) return false;
    if (this.grid.get(gx, gy) !== CELL_TYPE.EMPTY) return false;
    // Tower Defense integration: check budget for the active ink type
    // (barrier/fire have their own budgets; defense uses normal ink).
    const td = this.towerDefense || null;
    const tdActive = td && td.active;
    if (tdActive) {
      // Pre-game: defense ink is also locked (player should place
      // barriers/fire first). Actually defense is allowed any time —
      // canDraw handles this.
      if (!td.canDraw(td.activeInkType)) return false;
      // Pre-game blocks all painting outside of the allowed types? No,
      // defense is always allowed. Just check budget.
      if (td.activeInkType === 'defense') {
        if (!this.defenses.canDraw()) return false;
      }
      // Barrier/fire: budget check is inside canDraw above.
    } else {
      if (!this.defenses.canDraw()) return false;
    }
    if (applyDash && !this._dashEmit()) return false;

    // For barrier/fire, place the cell DIRECTLY (no drying phase).
    // For defense (and non-TD), use the normal pending → dry → defense path.
    if (tdActive && td.activeInkType !== 'defense') {
      const finalType = td.resolveDrawCellType();
      this.grid.set(gx, gy, finalType);
      const wx = this.grid.wrapX(gx);
      const i = gy * this.grid.width + wx;
      if (this.grid.cellAge) this.grid.cellAge[i] = 1;
      td.spendInk(1);
    } else {
      this.grid.setPending(gx, gy, 1);
      this.defenses.consume(1);
    }
    this.placedThisDrag.push({ x: this.grid.wrapX(gx), y: gy });
    return true;
  }

  // Place a "brush" of given line width around (gx, gy).
  // The dash counter advances once per brush (not per painted cell).
  // Ink is charged per brush stamp position rather than per painted cell,
  // so a width-3 brush costs the same as width-1 for any given path.
  // This makes thick brushes practical without burning through ink.
  _placeBrush(gx, gy) {
    const w = this.lineWidth;
    if (!this._dashEmit()) {
      return;
    }
    if (w <= 1) {
      this._placePending(gx, gy, false);
      return;
    }
    // Square brush centered on cell. Ink is consumed only ONCE per
    // brush position, not per cell painted, to keep thick brushes
    // economical. We still place each cell as pending, but only
    // charge ink for the first one that actually gets placed.
    const half = Math.floor(w / 2);
    let firstPlaced = false;
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        if (!firstPlaced) {
          if (this._placePending(gx + dx, gy + dy, false)) {
            firstPlaced = true;
          }
        } else {
          this._placePendingNoCost(gx + dx, gy + dy);
        }
      }
    }
  }
  // Place a single cell as pending WITHOUT charging ink. Used by brush
  // expansion so thick brushes don't bankrupt the player. Still respects
  // bounds, draw zone, and occupancy.
  _placePendingNoCost(gx, gy) {
    if (!this._isDrawZone(gy)) return false;
    if (!this.grid.inBounds(gx, gy)) return false;
    if (this.grid.getPending(gx, gy)) return false;
    if (this.grid.get(gx, gy) !== CELL_TYPE.EMPTY) return false;
    // In TD mode with barrier/fire active, brush expansion also places
    // final cells directly (still free, brush bonus). Otherwise pending.
    const td = this.towerDefense || null;
    if (td && td.active && td.activeInkType !== 'defense') {
      const finalType = td.resolveDrawCellType();
      this.grid.set(gx, gy, finalType);
      const wx = this.grid.wrapX(gx);
      const i = gy * this.grid.width + wx;
      if (this.grid.cellAge) this.grid.cellAge[i] = 1;
    } else {
      this.grid.setPending(gx, gy, 1);
    }
    this.placedThisDrag.push({ x: this.grid.wrapX(gx), y: gy });
    return true;
  }

  // Returns true if the dash pattern says "emit a brush at this step".
  _dashEmit() {
    const dash = DASH_PATTERNS[this.dashPattern];
    if (!dash) {
      this._dashCounter++;
      return true;
    }
    // Scale dash period by line width so dashes/dots remain visible
    // even with wide brushes (consecutive brush stamps overlap heavily).
    // We scale BOTH on and off by lineWidth so the ratio stays the same.
    const scale = Math.max(1, this.lineWidth);
    const on = dash[0] * scale;
    const off = dash[1] * scale;
    const period = on + off;
    const phase = this._dashCounter % period;
    this._dashCounter++;
    return phase < on;
  }

  // Bresenham line — fills cells between two grid points using current brush.
  _line(x0, y0, x1, y1) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0,
      y = y0;
    while (true) {
      this._placeBrush(x, y);
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
  }

  // Stamp the active pattern centered on (gx, gy).
  _stampPattern(gx, gy) {
    const offsets = this.getPatternOffsets();
    if (offsets.length === 0) return;
    // Compute pattern size for centering.
    let maxX = 0,
      maxY = 0;
    for (const [x, y] of offsets) {
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const halfW = Math.floor((maxX + 1) / 2);
    const halfH = Math.floor((maxY + 1) / 2);
    const baseX = gx - halfW;
    const baseY = gy - halfH;
    let placed = 0;
    for (const [ox, oy] of offsets) {
      if (this._placePending(baseX + ox, baseY + oy, false)) placed++;
    }
    return placed;
  }
  // Fill a rectangle from (x0,y0) to (x1,y1) using the current fill pattern.
  _fillRect(x0, y0, x1, y1) {
    const fn = FILL_PATTERNS[this.fillPattern] || FILL_PATTERNS.solid;
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    let placed = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (fn(x - minX, y - minY)) {
          if (this._placePending(x, y, false)) placed++;
        }
      }
    }
    return placed;
  }

  // Compute the cells of a previewed action (used by renderer).
  // Returns an array of {x, y} grid-space cells.
  getPreviewCells() {
    const cells = [];
    if (this.mode === DRAW_MODE.PATTERN && this.hoverCell) {
      const offsets = this.getPatternOffsets();
      if (offsets.length === 0) return cells;
      let maxX = 0,
        maxY = 0;
      for (const [x, y] of offsets) {
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      const halfW = Math.floor((maxX + 1) / 2);
      const halfH = Math.floor((maxY + 1) / 2);
      const baseX = this.hoverCell.gx - halfW;
      const baseY = this.hoverCell.gy - halfH;
      for (const [ox, oy] of offsets) {
        cells.push({ x: baseX + ox, y: baseY + oy });
      }
    } else if (this.mode === DRAW_MODE.FILL && this.drawing && this.startCell && this.currentCell) {
      const fn = FILL_PATTERNS[this.fillPattern] || FILL_PATTERNS.solid;
      const minX = Math.min(this.startCell.gx, this.currentCell.gx);
      const maxX = Math.max(this.startCell.gx, this.currentCell.gx);
      const minY = Math.min(this.startCell.gy, this.currentCell.gy);
      const maxY = Math.max(this.startCell.gy, this.currentCell.gy);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          // For preview we use deterministic patterns only (skip random ones
          // visually so the preview doesn't strobe; the actual fill will use
          // them properly).
          if (this.fillPattern.startsWith('random')) {
            // Show a 50% indicator dither for preview.
            if (((x + y) & 1) === 0) cells.push({ x, y });
          } else if (fn(x - minX, y - minY)) {
            cells.push({ x, y });
          }
        }
      }
    } else if (this.mode === DRAW_MODE.LINE && this.drawing && this.startCell && this.currentCell) {
      // Walk the line to find affected cells; respect dash + brush.
      let dashCounter = 0;
      const dash = DASH_PATTERNS[this.dashPattern];
      const w = this.lineWidth;
      const half = Math.floor(w / 2);
      const dashScale = Math.max(1, w);
      const x0 = this.startCell.gx;
      const y0 = this.startCell.gy;
      const x1 = this.currentCell.gx;
      const y1 = this.currentCell.gy;
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      let x = x0,
        y = y0;
      const seen = new Set();
      while (true) {
        // Dash check.
        let emit = true;
        if (dash) {
          const on = dash[0] * dashScale;
          const off = dash[1] * dashScale;
          const period = on + off;
          emit = dashCounter % period < on;
        }
        dashCounter++;
        if (emit) {
          if (w <= 1) {
            const key = `${x},${y}`;
            if (!seen.has(key)) {
              seen.add(key);
              cells.push({ x, y });
            }
          } else {
            for (let by = -half; by <= half; by++) {
              for (let bx = -half; bx <= half; bx++) {
                const px = x + bx,
                  py = y + by;
                const key = `${px},${py}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  cells.push({ x: px, y: py });
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
    }
    return cells;
  }

  cancelDrawing() {
    if (!this.drawing && this.placedThisDrag.length === 0) {
      this.drawing = false;
      return;
    }
    for (const { x, y } of this.placedThisDrag) {
      if (this.grid.getPending(x, y)) {
        this.grid.setPending(x, y, 0);
        this.defenses.refill(1);
      }
    }
    this.drawing = false;
    this.lastCell = null;
    this.startCell = null;
    this.currentCell = null;
    this.moved = false;
    this.placedThisDrag = [];
  }

  // Record the current stroke into the undo history.
  _recordStrokeForUndo() {
    if (!this.placedThisDrag || this.placedThisDrag.length === 0) return;
    this.strokeHistory.push([...this.placedThisDrag]);
    if (this.strokeHistory.length > this.MAX_UNDO) {
      this.strokeHistory.shift();
    }
  }

  // Undo the last stroke. Removes pending cells (full refund) and/or
  // already-committed defense cells (partial refund based on CONFIG).
  undo() {
    const stroke = this.strokeHistory.pop();
    if (!stroke || stroke.length === 0) return 0;
    let removed = 0;
    let refund = 0;
    const refundFrac = Math.max(0, Math.min(1, CONFIG.CLEAR_REFUND_FRACTION));
    const td = this.towerDefense || null;
    const tdActive = td && td.active;
    for (const { x, y } of stroke) {
      if (!this.grid.inBounds(x, y)) continue;
      const wx = this.grid.wrapX(x);
      const i = y * this.grid.width + wx;
      const cellType = this.grid.cells[i];
      // Barrier/fire cells are not refundable in TD mode.
      if (tdActive && (cellType === CELL_TYPE.BARRIER || cellType === CELL_TYPE.FIRE)) {
        continue;
      }
      if (this.grid.pending[i]) {
        this.grid.pending[i] = 0;
        this.grid.pendingDry[i] = 0;
        refund += 1; // full refund for not-yet-dried ink
        removed++;
      } else if (this.grid.cells[i] === CELL_TYPE.DEFENSE) {
        this.grid.cells[i] = CELL_TYPE.EMPTY;
        this.grid.cellAge[i] = 0;
        refund += refundFrac;
        removed++;
      }
    }
    this.defenses.refill(refund);
    return removed;
  }

  clearUndoHistory() {
    this.strokeHistory = [];
  }
}
