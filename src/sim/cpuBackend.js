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
 */
export class CpuSimBackend {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    // Per-column 3-row sums, allocated once and reused.
    this._colLife = new Uint8Array(width);
    this._colMissile = new Uint8Array(width);
    this._colDefense = new Uint8Array(width);
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
}
