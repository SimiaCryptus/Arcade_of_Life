/**
 * Encode an (x, y) cell as a string key for Set storage.
 * @param {number} x
 * @param {number} y
 * @returns {string}
 */
export function cellKey(x, y) {
  return `${x},${y}`;
}

/**
 * Decode a cell key back to [x, y].
 * @param {string} key
 * @returns {[number, number]}
 */
export function parseCellKey(key) {
  const [x, y] = key.split(',').map(Number);
  return [x, y];
}

/**
 * Convert an array of [x, y] cells to a Set of "x,y" strings.
 * @param {Array<[number, number]>} cells
 * @returns {Set<string>}
 */
export function cellsToSet(cells) {
  const set = new Set();
  for (const [x, y] of cells) set.add(cellKey(x, y));
  return set;
}

/**
 * Convert a Set of cell keys back to a sorted array of [x, y] pairs.
 * @param {Set<string>} set
 * @returns {Array<[number, number]>}
 */
export function setToCells(set) {
  return Array.from(set)
    .map(parseCellKey)
    .sort(([ax, ay], [bx, by]) => (ay !== by ? ay - by : ax - bx));
}

/**
 * Step a Life pattern one generation under the given ruleset.
 * @param {Set<string>} live - Set of "x,y" live cell keys
 * @param {CompiledRuleset} rule
 * @returns {Set<string>} - New set of live cells
 */
export function step(live, rule) {
  // Count neighbors for every cell that could become alive: every dead
  // cell adjacent to a live cell, plus the live cells themselves.
  const neighborCounts = new Map();
  for (const key of live) {
    const [x, y] = parseCellKey(key);
    // Ensure the live cell itself is tracked, even with 0 neighbors.
    if (!neighborCounts.has(key)) neighborCounts.set(key, 0);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nk = cellKey(x + dx, y + dy);
        neighborCounts.set(nk, (neighborCounts.get(nk) || 0) + 1);
      }
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
    const [x, y] = parseCellKey(key);
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
 * Returns a new Set. Useful for comparing shapes regardless of position.
 * @param {Set<string>} live
 * @returns {Set<string>}
 */
export function normalizeSet(live) {
  const bb = boundingBox(live);
  if (!bb) return new Set();
  const out = new Set();
  for (const key of live) {
    const [x, y] = parseCellKey(key);
    out.add(cellKey(x - bb.minX, y - bb.minY));
  }
  return out;
}

/**
 * Translate a live-cell set by (dx, dy).
 * @param {Set<string>} live
 * @param {number} dx
 * @param {number} dy
 * @returns {Set<string>}
 */
export function translateSet(live, dx, dy) {
  const out = new Set();
  for (const key of live) {
    const [x, y] = parseCellKey(key);
    out.add(cellKey(x + dx, y + dy));
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
 * @param {Array<[number, number]>} cells - initial cells
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
  // Check translated match (spaceship). Compute displacement by
  // comparing bounding box origins of normalized shapes.
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
 * @param {Array<[number, number]>} cells
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
