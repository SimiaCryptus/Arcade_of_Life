import { CELL_TYPE } from '../config.js';

/**
 * CPU simulation backend.
 *
 * Computes neighbor counts for life-cells, missile-cells, and defense-cells
 * in a single 3-pass scan using running row sums. This is O(W*H) per tick
 * with very tight inner loops and predictable memory access patterns.
 *
 * Key optimization: we use the "column sums" trick. For each column,
 * maintain rolling sums of (row-1, row, row+1). Then each cell's neighbor
 * count is the sum of three column sums minus its own value. This reduces
 * the work from 8 lookups per cell to ~3 amortized.
 *
 * For non-Moore neighborhoods (Euclidean radii, anisotropic transforms),
 * the fast column-sum path is bypassed in favor of a general per-cell
 * scan over the neighborhood's offset list.
 */
export class CpuSimBackend {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    // Per-column 3-row sums, allocated once and reused.
    this._colLife = new Uint8Array(width);
    this._colMissile = new Uint8Array(width);
    this._colDefense = new Uint8Array(width);
    // Active neighborhood for generic path. null = use fast Moore path.
    this._neighborhood = null;
  }
  /**
   * Set the active neighborhood. Pass null to use the fast Moore path.
   * @param {Neighborhood|null} neighborhood
   */
  setNeighborhood(neighborhood) {
    this._neighborhood = neighborhood;
  }

  /**
   * Compute neighbor counts for all three types simultaneously.
   * Output arrays are filled in-place.
   *
   * @param {Uint8Array} cells   - flat grid of CELL_TYPE values
   * @param {number}     w
   * @param {number}     h
   * @param {Uint8Array} lifeOut - neighbor counts for DEFENSE+MISSILE
   * @param {Uint8Array} missOut - neighbor counts for MISSILE
   * @param {Uint8Array} defOut  - neighbor counts for DEFENSE
   */
  computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut) {
    // Generic path for non-Moore neighborhoods.
    if (this._neighborhood && this._neighborhood.id !== 'moore') {
      this._computeNeighborCountsGeneric(cells, w, h, lifeOut, missOut, defOut);
      return;
    }
    lifeOut.fill(0);
    missOut.fill(0);
    defOut.fill(0);
    // For y=0, "row above" is nonexistent (no vertical wrap).
    // For each row y, build column sums for the 3 vertical neighbors
    // (y-1, y, y+1), then add (colLeft + colCenter + colRight) and
    // subtract the current cell's contribution.
    const colL = this._colLife;
    const colM = this._colMissile;
    const colD = this._colDefense;
    for (let y = 0; y < h; y++) {
      // Build per-column sums for this row.
      // Each column contributes the value at (x, y-1), (x, y), (x, y+1).
      for (let x = 0; x < w; x++) {
        let sumL = 0,
          sumM = 0,
          sumD = 0;
        if (y > 0) {
          const t = cells[(y - 1) * w + x];
          if (t === CELL_TYPE.MISSILE) {
            sumL++;
            sumM++;
          } else if (t === CELL_TYPE.DEFENSE) {
            sumL++;
            sumD++;
          }
        }
        {
          const t = cells[y * w + x];
          if (t === CELL_TYPE.MISSILE) {
            sumL++;
            sumM++;
          } else if (t === CELL_TYPE.DEFENSE) {
            sumL++;
            sumD++;
          }
        }
        if (y < h - 1) {
          const t = cells[(y + 1) * w + x];
          if (t === CELL_TYPE.MISSILE) {
            sumL++;
            sumM++;
          } else if (t === CELL_TYPE.DEFENSE) {
            sumL++;
            sumD++;
          }
        }
        colL[x] = sumL;
        colM[x] = sumM;
        colD[x] = sumD;
      }
      // Now scan the row, summing col[x-1] + col[x] + col[x+1] with x wrap.
      const rowBase = y * w;
      for (let x = 0; x < w; x++) {
        const xl = x === 0 ? w - 1 : x - 1;
        const xr = x === w - 1 ? 0 : x + 1;
        let l = colL[xl] + colL[x] + colL[xr];
        let m = colM[xl] + colM[x] + colM[xr];
        let d = colD[xl] + colD[x] + colD[xr];
        // Subtract the cell itself.
        const t = cells[rowBase + x];
        if (t === CELL_TYPE.MISSILE) {
          l--;
          m--;
        } else if (t === CELL_TYPE.DEFENSE) {
          l--;
          d--;
        }
        lifeOut[rowBase + x] = l;
        missOut[rowBase + x] = m;
        defOut[rowBase + x] = d;
      }
    }
  }
  /**
   * Generic neighbor-counting path for arbitrary neighborhoods.
   * Iterates the precomputed offset list for each cell. Used when
   * the active ruleset uses a non-Moore neighborhood (fractional
   * Euclidean radii, anisotropic transforms, etc.).
   *
   * Counts may exceed 8 for larger neighborhoods, so output arrays
   * must be wide enough (Uint8Array supports 0..255, which is plenty
   * for any reasonable radius).
   */
  _computeNeighborCountsGeneric(cells, w, h, lifeOut, missOut, defOut) {
    lifeOut.fill(0);
    missOut.fill(0);
    defOut.fill(0);
    const offsets = this._neighborhood.offsets;
    const nOff = offsets.length;
    for (let y = 0; y < h; y++) {
      const rowBase = y * w;
      for (let x = 0; x < w; x++) {
        let life = 0,
          miss = 0,
          def = 0;
        for (let k = 0; k < nOff; k++) {
          const dx = offsets[k][0];
          const dy = offsets[k][1];
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          // Horizontal wrap.
          let nx = x + dx;
          if (nx < 0) nx = ((nx % w) + w) % w;
          else if (nx >= w) nx = nx % w;
          const t = cells[ny * w + nx];
          if (t === CELL_TYPE.MISSILE) {
            life++;
            miss++;
          } else if (t === CELL_TYPE.DEFENSE) {
            life++;
            def++;
          }
        }
        lifeOut[rowBase + x] = life;
        missOut[rowBase + x] = miss;
        defOut[rowBase + x] = def;
      }
    }
  }
}
