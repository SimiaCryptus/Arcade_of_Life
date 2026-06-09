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
  // True when ink is effectively unlimited (max set to the sentinel
  // value via the "∞" unlimited toggle). When unlimited, consume() is
  // a no-op and canDraw() always returns true.
  _isUnlimited() {
    const sentinel = CONFIG.UNLIMITED_SENTINEL || 999999;
    return this.maxInk >= sentinel || CONFIG.MAX_INK >= sentinel;
  }

  canDraw() {
    if (this._isUnlimited()) return true;
    return this.ink > 0;
  }

  consume(amount = 1) {
    if (this._isUnlimited()) {
      // Keep ink visually pegged at max so the HUD bar stays full.
      this.ink = this.maxInk;
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) return;
    this.ink = Math.max(0, this.ink - amount);
  }

  regen(amount) {
    if (this._isUnlimited()) {
      this.ink = this.maxInk;
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) return;
    this.ink = Math.min(this.maxInk, this.ink + amount);
  }

  refill(amount) {
    if (this._isUnlimited()) {
      this.ink = this.maxInk;
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) return;
    this.ink = Math.min(this.maxInk, this.ink + amount);
  }

  reset() {
    // Sync maxInk in case CONFIG was reconfigured (e.g. unlimited toggle).
    this.maxInk = CONFIG.MAX_INK;
    if (this._isUnlimited()) {
      this.ink = this.maxInk;
    } else {
      this.ink = CONFIG.INITIAL_INK;
    }
  }

  // Clear all DEFENSE cells on the grid, refunding a configurable fraction
  // of ink per cleared cell. Also clears any pending (uncommitted) cells
  // with a full ink refund. Returns the count of cells cleared.
  clearAll(grid) {
    if (!grid || !grid.cells) return 0;
    const cells = grid.cells;
    const pending = grid.pending;
    const refundFrac = Math.max(0, Math.min(1, CONFIG.CLEAR_REFUND_FRACTION));
    let defenseCleared = 0;
    let pendingCleared = 0;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === CELL_TYPE.DEFENSE) {
        cells[i] = CELL_TYPE.EMPTY;
        if (grid.cellAge) grid.cellAge[i] = 0;
        if (grid.cellColor) grid.cellColor[i] = 0;
        if (grid.cellDir) grid.cellDir[i] = 0;
        defenseCleared++;
      }
      // Note: BARRIER and FIRE are intentionally NOT cleared — they are
      // permanent placements (used by tower-defense levels & static obstacles).
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
