import { CONFIG, CELL_TYPE } from './config.js';
import { getTopology } from './topology.js';

/**
 * Grid manages a 2D array of cells with type information.
 * Each cell is an integer from CELL_TYPE.
 *
 * Supports multiple topologies: 'square' (default), 'hex' (HexLife),
 * and 'tri' (TriLife). For triangular grids, the underlying buffer
 * holds 2 cells per (x, y) — upward and downward triangles.
 */
export class Grid {
  constructor(width, height, topologyId = 'square') {
    if (!Number.isInteger(width) || width <= 0) {
      throw new Error(`Grid: invalid width ${width}`);
    }
    if (!Number.isInteger(height) || height <= 0) {
      throw new Error(`Grid: invalid height ${height}`);
    }
    this.width = width;
    this.height = height;
    this.topologyId = topologyId;
    this.topology = getTopology(topologyId);
    const arrSize = this.topology.arraySize(width, height);
    this.arraySize = arrSize;
    // Horizontal pan offset (in cells). Affects rendering and input
    // mapping. The underlying cell buffer is unchanged; only the
    // visible window slides. Wrap-around still works because the
    // grid is logically toroidal on the x-axis.
    this.panOffset = 0;
    // Per-row x-shift for spaceship base wrap (in cells). When a
    // spaceship traveling east/west wraps around the toroidal edge,
    // this allows it to appear at a configurable vertical offset.
    // Configured per-level by the designer.
    this.wrapVerticalShift = 0;
    this.cells = new Uint8Array(arrSize);
    this.pending = new Uint8Array(arrSize); // separate layer for pending cells (1 = pending)
    // Remaining "dry" ticks for each pending cell. Counts down to 0 before commit.
    this.pendingDry = new Uint8Array(arrSize);
    // Explosion timers (for fading explosions)
    this.explosionTimers = new Uint8Array(arrSize);
    // Age of each cell in ticks (saturates at 255). Used to retire stale cells.
    this.cellAge = new Uint8Array(arrSize);
    // Color variant index for each cell (0..255). Lets renderer pick from a palette.
    this.cellColor = new Uint8Array(arrSize);
    // Direction tracking: for MISSILE cells, the dominant vertical direction of their
    // recent movement. 0 = unknown, 1 = downward, 2 = upward (reflected / "return fire").
    // Used to detect missile cells that have been turned back upward by defenses.
    this.cellDir = new Uint8Array(arrSize);
  }

  idx(x, y, orient = 0) {
    if (this.topologyId === 'tri') {
      return y * (2 * this.width) + 2 * x + orient;
    }
    return y * this.width + x;
  }

  // Wrap x horizontally; y is not wrapped.
  wrapX(x) {
    const w = this.width;
    return ((x % w) + w) % w;
  }
  /**
   * Wrap a coordinate pair across the toroidal east/west edge,
   * applying the configured wrapVerticalShift. Returns the wrapped
   * (x, y) coordinates. Used by neighbor lookups and rendering.
   * @param {number} x
   * @param {number} y
   * @returns {{x: number, y: number}}
   */
  wrapXY(x, y) {
    const w = this.width;
    const h = this.height;
    const shift = this.wrapVerticalShift | 0;
    let nx = x;
    let ny = y;
    if (shift !== 0) {
      // Count how many times we wrapped (positive = east overflow, negative = west).
      if (x >= w) {
        const wraps = Math.floor(x / w);
        nx = x - wraps * w;
        ny = y - wraps * shift;
      } else if (x < 0) {
        const wraps = Math.ceil(-x / w);
        nx = x + wraps * w;
        ny = y + wraps * shift;
      }
    } else {
      nx = ((x % w) + w) % w;
    }
    return { x: nx, y: ny };
  }
  // Apply pan offset to a grid x coordinate (for display purposes).
  // Returns the display column for cell at logical x.
  toDisplayX(x) {
    const w = this.width;
    return (((x - this.panOffset) % w) + w) % w;
  }
  // Inverse: convert display column to logical grid x.
  fromDisplayX(displayX) {
    const w = this.width;
    return (((displayX + this.panOffset) % w) + w) % w;
  }

  // Row index where the draw zone starts (inclusive). Cells with y >= this
  // value are drawable; cells above are off-limits.
  drawZoneMinY() {
    const frac = Math.max(0.2, Math.min(0.8, CONFIG.DRAW_ZONE_FRACTION || 0.5));
    const base = Math.floor(this.height * (1 - frac));
    // Don't let the draw zone extend into the rear dead zone.
    const rear = Math.max(0, CONFIG.REAR_DEAD_ZONE_HEIGHT | 0);
    const maxAllowed = this.height - rear - 1;
    return Math.min(base, Math.max(0, maxAllowed));
  }
  // Row index where the draw zone ends (inclusive). Cells with y > this
  // value are in the rear dead zone and off-limits.
  drawZoneMaxY() {
    const rear = Math.max(0, CONFIG.REAR_DEAD_ZONE_HEIGHT | 0);
    return this.height - rear - 1;
  }
  // First row (inclusive) of the rear dead zone. Returns this.height if
  // the rear zone has zero height.
  rearDeadZoneMinY() {
    const rear = Math.max(0, CONFIG.REAR_DEAD_ZONE_HEIGHT | 0);
    return this.height - rear;
  }
  // Inclusive [minY, maxY] of the base spawning zone, which sits between
  // the top dead zone and the regular missile spawn line. Returns null
  // if there's no room for a base zone (very small grids).
  baseZoneBounds() {
    const top = Math.max(0, CONFIG.RETURN_FIRE_ZONE_MAX_Y | 0) + 1;
    const height = Math.max(0, CONFIG.BASE_ZONE_HEIGHT | 0);
    if (height <= 0) return null;
    const minY = top;
    const maxY = top + height - 1;
    // Ensure we don't overlap the draw zone.
    if (maxY >= this.drawZoneMinY()) return null;
    // Sanity: ensure the band is at least 1 row tall and inside the grid.
    if (minY < 0 || minY >= this.height || maxY < minY || maxY >= this.height) {
      return null;
    }
    return { minY, maxY };
  }
  // Row where regular gliders (missiles) spawn. Just below the base zone
  // (or just below the top dead zone if base zone is disabled).
  missileSpawnY() {
    const bz = this.baseZoneBounds();
    if (bz) {
      const buffer = Math.max(1, CONFIG.BASE_GLIDER_BUFFER | 0);
      return bz.maxY + buffer;
    }
    return Math.max(1, (CONFIG.RETURN_FIRE_ZONE_MAX_Y | 0) + 1);
  }

  inBounds(x, y) {
    return y >= 0 && y < this.height;
  }

  get(x, y) {
    if (y < 0 || y >= this.height) return CELL_TYPE.EMPTY;
    return this.cells[this.idx(this.wrapX(x), y)];
  }

  set(x, y, type) {
    if (y < 0 || y >= this.height) return;
    this.cells[this.idx(this.wrapX(x), y)] = type;
  }

  getPending(x, y) {
    if (y < 0 || y >= this.height) return 0;
    return this.pending[this.idx(this.wrapX(x), y)];
  }

  setPending(x, y, val) {
    if (y < 0 || y >= this.height) return;
    this.pending[this.idx(this.wrapX(x), y)] = val;
  }

  clearPending() {
    this.pending.fill(0);
    this.pendingDry.fill(0);
  }

  // Commit all pending cells to active defense cells.
  commitPending() {
    let count = 0;
    for (let i = 0; i < this.pending.length; i++) {
      if (this.pending[i]) {
        // Only commit if currently empty (don't overwrite cities/missiles)
        if (this.cells[i] === CELL_TYPE.EMPTY) {
          this.cells[i] = CELL_TYPE.DEFENSE;
          count++;
        }
        this.pending[i] = 0;
        this.pendingDry[i] = 0;
      }
    }
    return count;
  }

  // Start the drying countdown on all pending cells. Called on stroke release
  // (mouseup/touchend). If INK_DRY_TICKS is 0, commits immediately. Otherwise
  // pending cells will commit as their timers expire in tickPendingDry().
  // Returns the number of cells immediately committed (only nonzero when
  // INK_DRY_TICKS == 0).
  startPendingDry() {
    const dry = Math.max(0, CONFIG.INK_DRY_TICKS | 0);
    if (dry === 0) {
      return this.commitPending();
    }
    let count = 0;
    for (let i = 0; i < this.pending.length; i++) {
      if (this.pending[i]) {
        this.pendingDry[i] = dry;
        count++;
      }
    }
    return count;
  }

  // Decrement dry timers on all pending cells. Cells whose timer reaches 0 are
  // committed to DEFENSE. Returns the count of cells committed.
  tickPendingDry() {
    let committed = 0;
    for (let i = 0; i < this.pending.length; i++) {
      if (!this.pending[i]) continue;
      // Cells with pendingDry == 0 have not yet started drying (still being
      // drawn in an active stroke). Skip them entirely — they must not
      // dry or commit until the stroke ends (mouseUp/touchEnd).
      if (this.pendingDry[i] === 0) continue;
      this.pendingDry[i]--;
      if (this.pendingDry[i] === 0) {
        if (this.cells[i] === CELL_TYPE.EMPTY) {
          this.cells[i] = CELL_TYPE.DEFENSE;
          committed++;
        }
        this.pending[i] = 0;
      }
    }
    return committed;
  }

  // Count live neighbors of any type that participates in Life (defense + missile)
  countLifeNeighbors(x, y) {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const t = this.get(x + dx, y + dy);
        if (t === CELL_TYPE.DEFENSE || t === CELL_TYPE.MISSILE) count++;
      }
    }
    return count;
  }

  countTypeNeighbors(x, y, type) {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (this.get(x + dx, y + dy) === type) count++;
      }
    }
    return count;
  }
}
