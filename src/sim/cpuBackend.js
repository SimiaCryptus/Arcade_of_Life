import { CELL_TYPE } from '../config.js';
import { getTopology } from '../topology.js';

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
 *
 * For hex and triangular topologies, dedicated generic paths handle
 * the topology-specific neighbor lookup.
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
    this._topologyId = 'square';
  }
  /**
   * Set the active neighborhood. Pass null to use the fast Moore path.
   * @param {Neighborhood|null} neighborhood
   */
  setNeighborhood(neighborhood) {
    this._neighborhood = neighborhood;
    this._topologyId = neighborhood && neighborhood.topology ? neighborhood.topology : 'square';
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
    // Topology-specific paths for hex / tri grids.
    if (this._topologyId === 'hex') {
      this._computeNeighborCountsHex(cells, w, h, lifeOut, missOut, defOut);
      return;
    }
    if (this._topologyId === 'tri') {
      this._computeNeighborCountsTri(cells, w, h, lifeOut, missOut, defOut);
      return;
    }
    // If a wrap vertical shift is configured, use the generic per-cell
    // path with Moore offsets (the fast column-sum optimization assumes
    // strict row alignment which the shift breaks).
    if ((this._wrapVerticalShift | 0) !== 0) {
      // Temporarily install Moore offsets if no neighborhood is set.
      const savedNbhd = this._neighborhood;
      if (!this._neighborhood || this._neighborhood.id === 'moore') {
        this._neighborhood = {
          id: 'moore',
          offsets: [
            [-1, -1],
            [0, -1],
            [1, -1],
            [-1, 0],
            [1, 0],
            [-1, 1],
            [0, 1],
            [1, 1],
          ],
        };
      }
      this._computeNeighborCountsGeneric(cells, w, h, lifeOut, missOut, defOut);
      this._neighborhood = savedNbhd;
      return;
    }
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
    // Vertical shift when wrapping horizontally (for Klein-bottle-like
    // topologies). Pulled from a static field set by simulation.js.
    const vShift = this._wrapVerticalShift | 0;
    for (let y = 0; y < h; y++) {
      const rowBase = y * w;
      for (let x = 0; x < w; x++) {
        let life = 0,
          miss = 0,
          def = 0;
        for (let k = 0; k < nOff; k++) {
          const dx = offsets[k][0];
          const dy = offsets[k][1];
          // Horizontal wrap.
          let nx = x + dx;
          let ny = y + dy;
          if (vShift !== 0) {
            if (nx < 0) {
              ny += vShift;
              nx = ((nx % w) + w) % w;
            } else if (nx >= w) {
              ny -= vShift;
              nx = nx % w;
            }
          } else {
            if (nx < 0) nx = ((nx % w) + w) % w;
            else if (nx >= w) nx = nx % w;
          }
          if (ny < 0 || ny >= h) continue;
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
  /**
   * Hex-topology neighbor counting. Uses axial (q, r) coordinates
   * stored as (x, y). Offsets from this._neighborhood.offsets are
   * (dq, dr) pairs that work uniformly on all cells regardless of
   * orientation.
   *
   * Horizontal wrap is on the q-axis; r-axis (rows) is hard boundary.
   */
  _computeNeighborCountsHex(cells, w, h, lifeOut, missOut, defOut) {
    lifeOut.fill(0);
    missOut.fill(0);
    defOut.fill(0);
    // Hex grid uses ODD-R OFFSET coordinates with row-parity-dependent
    // neighbor offsets. Use the topology helper to get the correct
    // offset list per row.
    const topology = getTopology('hex');
    const nbhdSize = this._neighborhood.size === 18 ? 18 : 6;
    const offsetsEven = topology.getOffsetsForCell(0, nbhdSize);
    const offsetsOdd = topology.getOffsetsForCell(1, nbhdSize);
    for (let r = 0; r < h; r++) {
      const offsets = (r & 1) === 1 ? offsetsOdd : offsetsEven;
      const nOff = offsets.length;
      for (let q = 0; q < w; q++) {
        let life = 0,
          miss = 0,
          def = 0;
        for (let k = 0; k < nOff; k++) {
          const dq = offsets[k][0];
          const dr = offsets[k][1];
          const nr = r + dr;
          if (nr < 0 || nr >= h) continue;
          let nq = q + dq;
          if (nq < 0) nq = ((nq % w) + w) % w;
          else if (nq >= w) nq = nq % w;
          const t = cells[nr * w + nq];
          if (t === CELL_TYPE.MISSILE) {
            life++;
            miss++;
          } else if (t === CELL_TYPE.DEFENSE) {
            life++;
            def++;
          }
        }
        const idx = r * w + q;
        lifeOut[idx] = life;
        missOut[idx] = miss;
        defOut[idx] = def;
      }
    }
  }
  /**
   * Triangular-topology neighbor counting.
   *
   * The cell array is laid out with 2 logical cells per (x, y) position:
   *   cells[y * (2*w) + 2*x + orient], where orient ∈ {0, 1}.
   *   orient=0 → upward △, orient=1 → downward ▽.
   *
   * Neighbor offsets are orientation-dependent and obtained from the
   * topology module. The width passed in is the LOGICAL width (number
   * of (x, y) cells); actual array stride is 2*w.
   *
   * The lifeOut/missOut/defOut arrays use the same 2-per-cell layout.
   */
  _computeNeighborCountsTri(cells, w, h, lifeOut, missOut, defOut) {
    lifeOut.fill(0);
    missOut.fill(0);
    defOut.fill(0);
    const topology = getTopology('tri');
    const stride = 2 * w;
    // Choose the offset list based on neighborhood size:
    //   3 = edge only, 12 = full.
    // We use the topology helper functions which return orientation-specific
    // 3-tuples [dx, dy, dOrient].
    const useEdgeOnly = this._neighborhood && this._neighborhood.size === 3;
    const getOffsets = useEdgeOnly ? topology.getEdgeOffsetsForCell : topology.getOffsetsForCell;
    // Precompute both orientations.
    const offsetsUp = getOffsets(0);
    const offsetsDown = getOffsets(1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let o = 0; o < 2; o++) {
          const i = y * stride + 2 * x + o;
          const offsets = o === 0 ? offsetsUp : offsetsDown;
          let life = 0,
            miss = 0,
            def = 0;
          for (let k = 0; k < offsets.length; k++) {
            const dx = offsets[k][0];
            const dy = offsets[k][1];
            const dOrient = offsets[k][2];
            const ny = y + dy;
            if (ny < 0 || ny >= h) continue;
            let nx = x + dx;
            if (nx < 0) nx = ((nx % w) + w) % w;
            else if (nx >= w) nx = nx % w;
            const ni = ny * stride + 2 * nx + dOrient;
            const t = cells[ni];
            if (t === CELL_TYPE.MISSILE) {
              life++;
              miss++;
            } else if (t === CELL_TYPE.DEFENSE) {
              life++;
              def++;
            }
          }
          lifeOut[i] = life;
          missOut[i] = miss;
          defOut[i] = def;
        }
      }
    }
  }
}
