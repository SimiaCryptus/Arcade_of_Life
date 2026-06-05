import { CONFIG, CELL_TYPE } from '../config.js';

/**
 * Defense management - mostly handled in grid/simulation,
 * but this module manages the ink resource.
 */
export class Defenses {
  constructor() {
    this.ink = CONFIG.INITIAL_INK;
    this.maxInk = CONFIG.MAX_INK;
  }

  canDraw() {
    return this.ink > 0;
  }

  consume(amount = 1) {
    this.ink = Math.max(0, this.ink - amount);
  }

  regen(amount) {
    this.ink = Math.min(this.maxInk, this.ink + amount);
  }

  refill(amount) {
    this.ink = Math.min(this.maxInk, this.ink + amount);
  }

  reset() {
    this.ink = CONFIG.INITIAL_INK;
  }

  // Clear all DEFENSE cells on the grid, refunding a configurable fraction
  // of ink per cleared cell. Also clears any pending (uncommitted) cells
  // with a full ink refund. Returns the count of cells cleared.
  clearAll(grid) {
    const cells = grid.cells;
    const pending = grid.pending;
    const refundFrac = Math.max(0, Math.min(1, CONFIG.CLEAR_REFUND_FRACTION));
    let defenseCleared = 0;
    let pendingCleared = 0;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === CELL_TYPE.DEFENSE) {
        cells[i] = CELL_TYPE.EMPTY;
        if (grid.cellAge) grid.cellAge[i] = 0;
        defenseCleared++;
      }
      if (pending[i]) {
        pending[i] = 0;
        if (grid.pendingDry) grid.pendingDry[i] = 0;
        pendingCleared++;
      }
    }
    // Full refund for pending (never committed), partial for defense.
    this.refill(pendingCleared + defenseCleared * refundFrac);
    return defenseCleared + pendingCleared;
  }
}
