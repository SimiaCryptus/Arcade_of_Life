/**
 * Encode an (x, y) cell as a string key for Set storage.
 * For triangular topology, cells include an orientation component
 * encoded as a third coordinate.
 * @param {number} x
 * @param {number} y
 * @param {number} [orient]
 * @returns {string}
 */
export function cellKey(x, y, orient) {
  if (orient !== undefined) return `${x},${y},${orient}`;
  return `${x},${y}`;
}

/**
 * Decode a cell key back to [x, y] or [x, y, orient].
 * @param {string} key
 * @returns {[number, number] | [number, number, number]}
 */
export function parseCellKey(key) {
  const parts = key.split(',').map(Number);
  if (parts.length === 3) return [parts[0], parts[1], parts[2]];
  return [parts[0], parts[1]];
}

/**
 * Convert an array of [x, y] (or [x, y, orient]) cells to a Set of keys.
 * @param {Array<[number, number] | [number, number, number]>} cells
 * @returns {Set<string>}
 */
export function cellsToSet(cells) {
  const set = new Set();
  for (const c of cells) {
    if (c.length === 3) set.add(cellKey(c[0], c[1], c[2]));
    else set.add(cellKey(c[0], c[1]));
  }
  return set;
}

/**
 * Convert a Set of cell keys back to a sorted array of cells.
 * @param {Set<string>} set
 * @returns {Array}
 */
export function setToCells(set) {
  return Array.from(set)
    .map(parseCellKey)
    .sort((a, b) => {
      if (a[1] !== b[1]) return a[1] - b[1];
      if (a[0] !== b[0]) return a[0] - b[0];
      return (a[2] || 0) - (b[2] || 0);
    });
}
// ── Topology-aware neighbor offset helpers ──────────────────────────
//
// Square topology: uniform 8-cell Moore neighborhood (or a custom
// offset list from the ruleset).
//
// Hex topology (odd-r offset coords): neighbor offsets depend on
// the row parity of the cell. Even rows shift one way, odd rows
// the other. The sparse simulator looks up the per-row offsets
// when computing neighbor counts.
//
// Triangular topology: each (x, y) position holds two triangles
// distinguished by orientation (0 = △ upward, 1 = ▽ downward).
// Neighbor offsets are stored as 3-tuples [dx, dy, dOrient] and
// are orientation-dependent.

// Hex offsets — odd-r offset coordinates.
// Row parity determines the diagonal-neighbor x-component.
const HEX_OFFSETS_EVEN_6 = [
  [+1, 0],
  [-1, 0],
  [0, -1],
  [-1, -1],
  [0, +1],
  [-1, +1],
];
const HEX_OFFSETS_ODD_6 = [
  [+1, 0],
  [-1, 0],
  [+1, -1],
  [0, -1],
  [+1, +1],
  [0, +1],
];
const HEX_OFFSETS_EVEN_18 = [
  ...HEX_OFFSETS_EVEN_6,
  [+2, 0],
  [-2, 0],
  [+1, -1],
  [-2, -1],
  [+1, +1],
  [-2, +1],
  [-1, -2],
  [0, -2],
  [+1, -2],
  [-1, +2],
  [0, +2],
  [+1, +2],
];
const HEX_OFFSETS_ODD_18 = [
  ...HEX_OFFSETS_ODD_6,
  [+2, 0],
  [-2, 0],
  [+2, -1],
  [-1, -1],
  [+2, +1],
  [-1, +1],
  [-1, -2],
  [0, -2],
  [+1, -2],
  [-1, +2],
  [0, +2],
  [+1, +2],
];

function getHexOffsets(parity, size) {
  if (size >= 18) {
    return parity === 0 ? HEX_OFFSETS_EVEN_18 : HEX_OFFSETS_ODD_18;
  }
  return parity === 0 ? HEX_OFFSETS_EVEN_6 : HEX_OFFSETS_ODD_6;
}

// Triangular offsets — orientation-dependent.
// Returns [dx, dy, dOrient] triples.
function getTriOffsets12(orient) {
  if (orient === 0) {
    // Upward △
    return [
      [-1, 0, 1],
      [+1, 0, 1],
      [0, +1, 1],
      [-1, -1, 1],
      [0, -1, 0],
      [0, -1, 1],
      [+1, -1, 0],
      [-2, 0, 0],
      [-1, 0, 0],
      [+1, 0, 0],
      [+2, 0, 0],
      [-1, +1, 0],
    ];
  }
  // Downward ▽
  return [
    [-1, 0, 0],
    [+1, 0, 0],
    [0, -1, 0],
    [-1, +1, 0],
    [0, +1, 1],
    [0, +1, 0],
    [+1, +1, 1],
    [-2, 0, 1],
    [-1, 0, 1],
    [+1, 0, 1],
    [+2, 0, 1],
    [+1, -1, 0],
  ];
}
function getTriOffsets3(orient) {
  if (orient === 0) {
    return [
      [-1, 0, 1],
      [+1, 0, 1],
      [0, +1, 1],
    ];
  }
  return [
    [-1, 0, 0],
    [+1, 0, 0],
    [0, -1, 0],
  ];
}

/**
 * Return the neighbor offset list applicable to a given cell under
 * the given rule. Handles topology-aware lookups for hex (row-parity
 * dependent) and tri (orientation dependent). For square topology
 * with no explicit neighborhood, returns the 8-cell Moore offsets.
 *
 * @param {CompiledRuleset|null} rule
 * @param {Array} cellCoords  [x, y] or [x, y, orient]
 * @returns {Array} list of [dx, dy] or [dx, dy, dOrient] offsets
 */
function getOffsetsForCell(rule, cellCoords) {
  const nbhd = rule && rule.neighborhood ? rule.neighborhood : null;
  const topology = (nbhd && nbhd.topology) || 'square';
  if (topology === 'hex') {
    const r = cellCoords[1];
    const parity = ((r % 2) + 2) % 2;
    const size = nbhd && nbhd.size ? nbhd.size : 6;
    return getHexOffsets(parity, size);
  }
  if (topology === 'tri') {
    const orient = cellCoords[2] || 0;
    const size = nbhd && nbhd.size ? nbhd.size : 12;
    return size <= 3 ? getTriOffsets3(orient) : getTriOffsets12(orient);
  }
  // Square topology — use the ruleset's offsets if present.
  if (nbhd && Array.isArray(nbhd.offsets)) {
    return nbhd.offsets;
  }
  // Default 8-cell Moore.
  return [
    [-1, -1],
    [0, -1],
    [+1, -1],
    [-1, 0],
    [+1, 0],
    [-1, +1],
    [0, +1],
    [+1, +1],
  ];
}

/**
 * Apply a neighbor offset to a cell, producing the neighbor's
 * coordinates. For square/hex grids the offset has 2 components and
 * the result is [x+dx, y+dy]. For tri grids the offset includes a
 * target orientation, so the result is [x+dx, y+dy, dOrient].
 */
function applyOffset(cell, offset) {
  const dx = offset[0];
  const dy = offset[1];
  if (offset.length === 3) {
    return [cell[0] + dx, cell[1] + dy, offset[2]];
  }
  return [cell[0] + dx, cell[1] + dy];
}

/**
 * Step a Life pattern one generation under the given ruleset.
 * @param {Set<string>} live - Set of cell keys
 * @param {CompiledRuleset} rule
 * @returns {Set<string>} - New set of live cells
 */
export function step(live, rule) {
  // Count neighbors for every cell that could become alive: every
  // dead cell adjacent to a live cell, plus the live cells themselves.
  const neighborCounts = new Map();
  const topology = (rule && rule.neighborhood && rule.neighborhood.topology) || 'square';
  const isTri = topology === 'tri';
  for (const key of live) {
    const cell = parseCellKey(key);
    // Ensure the live cell itself is tracked, even with 0 neighbors.
    if (!neighborCounts.has(key)) neighborCounts.set(key, 0);
    const offsets = getOffsetsForCell(rule, cell);
    for (let k = 0; k < offsets.length; k++) {
      const neighbor = applyOffset(cell, offsets[k]);
      const nk = isTri
        ? cellKey(neighbor[0], neighbor[1], neighbor[2])
        : cellKey(neighbor[0], neighbor[1]);
      neighborCounts.set(nk, (neighborCounts.get(nk) || 0) + 1);
    }
  }
  const next = new Set();
  for (const [key, count] of neighborCounts) {
    const alive = live.has(key);
    if (alive && rule.shouldSurvive(count)) {
      next.add(key);
    } else if (!alive && rule.shouldBirth(count)) {
      next.add(key);
    }
  }
  return next;
}

/**
 * Run a pattern for N generations.
 * @param {Set<string>} live
 * @param {CompiledRuleset} rule
 * @param {number} generations
 * @returns {Set<string>}
 */
export function run(live, rule, generations) {
  let state = live;
  for (let i = 0; i < generations; i++) {
    state = step(state, rule);
  }
  return state;
}

/**
 * Compute the bounding box of a live-cell set.
 * For tri topology, the box covers (x, y) extents; the orientation
 * dimension is ignored since each (x, y) holds up to 2 triangles.
 * @param {Set<string>} live
 * @returns {{minX: number, minY: number, maxX: number, maxY: number,
 *           width: number, height: number} | null}
 */
export function boundingBox(live) {
  if (live.size === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const key of live) {
    const cell = parseCellKey(key);
    const x = cell[0];
    const y = cell[1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * Translate a live-cell set so its bounding box origin is at (0, 0).
 * Preserves orientation for tri cells. Returns a new Set.
 * @param {Set<string>} live
 * @returns {Set<string>}
 */
export function normalizeSet(live) {
  const bb = boundingBox(live);
  if (!bb) return new Set();
  const out = new Set();
  for (const key of live) {
    const cell = parseCellKey(key);
    if (cell.length === 3) {
      out.add(cellKey(cell[0] - bb.minX, cell[1] - bb.minY, cell[2]));
    } else {
      out.add(cellKey(cell[0] - bb.minX, cell[1] - bb.minY));
    }
  }
  return out;
}

/**
 * Translate a live-cell set by (dx, dy). Orientation is preserved.
 * Note: for hex topology, naive (dx, dy) translation does NOT in
 * general preserve neighbor relationships across row-parity
 * boundaries, so translation-equivalence checks are approximate.
 * @param {Set<string>} live
 * @param {number} dx
 * @param {number} dy
 * @returns {Set<string>}
 */
export function translateSet(live, dx, dy) {
  const out = new Set();
  for (const key of live) {
    const cell = parseCellKey(key);
    if (cell.length === 3) {
      out.add(cellKey(cell[0] + dx, cell[1] + dy, cell[2]));
    } else {
      out.add(cellKey(cell[0] + dx, cell[1] + dy));
    }
  }
  return out;
}

/**
 * Check whether two cell sets are equal.
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {boolean}
 */
export function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

/**
 * Detect whether a pattern is periodic with given period under the rule.
 * Returns true if pattern at generation `period` matches generation 0
 * (modulo a uniform translation, useful for spaceships).
 *
 * @param {Array} cells - initial cells ([x,y] or [x,y,orient])
 * @param {CompiledRuleset} rule
 * @param {number} period
 * @returns {{isPeriodic: boolean, displacement: [number, number] | null}}
 */
export function detectPeriod(cells, rule, period) {
  const initial = cellsToSet(cells);
  let state = initial;
  for (let i = 0; i < period; i++) {
    state = step(state, rule);
  }
  // Check exact match (oscillator).
  if (setsEqual(state, initial)) {
    return { isPeriodic: true, displacement: [0, 0] };
  }
  // Check translated match (spaceship).
  const bbInit = boundingBox(initial);
  const bbState = boundingBox(state);
  if (!bbInit || !bbState) {
    return { isPeriodic: false, displacement: null };
  }
  const normInit = normalizeSet(initial);
  const normState = normalizeSet(state);
  if (setsEqual(normInit, normState)) {
    return {
      isPeriodic: true,
      displacement: [bbState.minX - bbInit.minX, bbState.minY - bbInit.minY],
    };
  }
  return { isPeriodic: false, displacement: null };
}

/**
 * Find the smallest period in [1..maxPeriod] under which `cells` returns
 * to itself (possibly translated). Returns null if none found.
 *
 * @param {Array} cells
 * @param {CompiledRuleset} rule
 * @param {number} maxPeriod
 * @returns {{period: number, displacement: [number, number]} | null}
 */
export function findPeriod(cells, rule, maxPeriod) {
  const initial = cellsToSet(cells);
  const normInit = normalizeSet(initial);
  const bbInit = boundingBox(initial);
  let state = initial;
  for (let p = 1; p <= maxPeriod; p++) {
    state = step(state, rule);
    if (state.size === 0) return null;
    if (setsEqual(state, initial)) {
      return { period: p, displacement: [0, 0] };
    }
    const normState = normalizeSet(state);
    if (setsEqual(normInit, normState)) {
      const bbState = boundingBox(state);
      return {
        period: p,
        displacement: [bbState.minX - bbInit.minX, bbState.minY - bbInit.minY],
      };
    }
  }
  return null;
}
/**
 * Run a pattern for up to `generations` steps, tracking detailed
 * statistics about its evolution. The simulation lives on a sparse
 * Set so it is effectively unbounded; we just record the largest
 * bounding box and population observed at any point.
 *
 * Termination conditions (early exit):
 *   - Population reaches zero (extinct).
 *   - State exactly repeats an earlier generation (cycle detected).
 *   - State stabilizes (no change generation-over-generation).
 *
 * @param {Array} cells   initial live cells
 * @param {CompiledRuleset} rule
 * @param {number} generations              max generations to simulate
 * @param {Object} [opts]
 * @param {number} [opts.cycleDetectLimit]  Max distinct states to track
 * @param {number} [opts.populationCap]     Abort if pop exceeds this
 * @returns {Object}
 */
export function characterize(cells, rule, generations, opts = {}) {
  const { cycleDetectLimit = 1024, populationCap = 100000 } = opts;
  const initial = cellsToSet(cells);
  const initialSize = initial.size;
  let state = initial;
  let maxSize = initialSize;
  let maxSizeAt = 0;
  let minSizeAfterInit = initialSize;
  let minSizeAfterInitAt = 0;
  let extinct = false;
  let stabilizedAt = null;
  let cycleStart = null;
  let cyclePeriod = null;
  let exceededPopulationCap = false;
  const seen = new Map(); // hash -> generation index
  const initHash = setHash(initial);
  seen.set(initHash, 0);
  let unionBB = boundingBox(initial);
  let prevHash = initHash;
  // Track per-generation population history (capped to avoid memory blowup).
  const popHistory = [initialSize];
  const POP_HISTORY_CAP = 5000;
  let g = 0;
  for (g = 1; g <= generations; g++) {
    const nextState = step(state, rule);
    if (nextState.size === 0) {
      extinct = true;
      state = nextState;
      if (popHistory.length < POP_HISTORY_CAP) popHistory.push(0);
      break;
    }
    if (nextState.size > maxSize) {
      maxSize = nextState.size;
      maxSizeAt = g;
    }
    if (nextState.size < minSizeAfterInit) {
      minSizeAfterInit = nextState.size;
      minSizeAfterInitAt = g;
    }
    if (popHistory.length < POP_HISTORY_CAP) popHistory.push(nextState.size);
    const bb = boundingBox(nextState);
    if (bb) {
      if (!unionBB) {
        unionBB = { ...bb };
      } else {
        if (bb.minX < unionBB.minX) unionBB.minX = bb.minX;
        if (bb.minY < unionBB.minY) unionBB.minY = bb.minY;
        if (bb.maxX > unionBB.maxX) unionBB.maxX = bb.maxX;
        if (bb.maxY > unionBB.maxY) unionBB.maxY = bb.maxY;
      }
    }
    const h = setHash(nextState);
    if (h === prevHash) {
      stabilizedAt = g;
      state = nextState;
      break;
    }
    if (seen.size < cycleDetectLimit) {
      const prior = seen.get(h);
      if (prior !== undefined) {
        cycleStart = prior;
        cyclePeriod = g - prior;
        state = nextState;
        break;
      }
      seen.set(h, g);
    }
    prevHash = h;
    state = nextState;
    if (state.size > populationCap) {
      exceededPopulationCap = true;
      break;
    }
  }
  if (unionBB) {
    unionBB.width = unionBB.maxX - unionBB.minX + 1;
    unionBB.height = unionBB.maxY - unionBB.minY + 1;
  }
  // Compute initialization-phase vs periodic-phase population stats.
  // Initialization = generations [0, cycleStart) when a cycle was found,
  // or [0, stabilizedAt) when stabilized, or the whole run otherwise.
  let initPhaseEnd = popHistory.length;
  if (cycleStart != null) initPhaseEnd = Math.min(cycleStart, popHistory.length);
  else if (stabilizedAt != null) initPhaseEnd = Math.min(stabilizedAt, popHistory.length);
  const initPhasePops = popHistory.slice(0, initPhaseEnd);
  const periodicPhasePops = popHistory.slice(initPhaseEnd);
  const statsFor = (arr) => {
    if (arr.length === 0) return { min: 0, max: 0, avg: 0, count: 0 };
    let mn = arr[0],
      mx = arr[0],
      sum = 0;
    for (const v of arr) {
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      sum += v;
    }
    return { min: mn, max: mx, avg: sum / arr.length, count: arr.length };
  };
  const initStats = statsFor(initPhasePops);
  const periodicStats = statsFor(periodicPhasePops);
  return {
    generations: g,
    finalSize: state.size,
    maxSize,
    maxSizeAt,
    minSizeAfterInit,
    minSizeAfterInitAt,
    initialSize,
    extinct,
    stabilizedAt,
    cycleStart,
    cyclePeriod,
    bounds: unionBB,
    exceededPopulationCap,
    finalState: state,
    popHistory,
    initPhaseStats: initStats,
    periodicPhaseStats: periodicStats,
  };
}
/**
 * Compute a stable, order-independent hash of a cell set.
 * @param {Set<string>} live
 * @returns {string}
 */
export function setHash(live) {
  if (live.size === 0) return 'e';
  const sorted = Array.from(live).sort();
  return `${sorted.length}:${sorted.join(';')}`;
}
