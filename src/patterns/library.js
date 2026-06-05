/**
 * Pattern Library
 *
 * Centralized, metadata-rich catalog of cellular automaton patterns.
 * Each pattern has:
 *   - id            unique identifier (slug-style)
 *   - name          display name
 *   - category      'still_life' | 'oscillator' | 'spaceship' | 'gun' |
 *                   'methuselah' | 'puffer' | 'misc'
 *   - cells         [[x, y], ...] offsets, normalized so min(x,y) = 0
 *   - period        oscillator/spaceship period (1 = still life)
 *   - rulesets      array of compatible ruleset ids (or ['*'] for all)
 *   - description   short human-readable description
 *   - tags          searchable keyword array
 *   - direction     for spaceships: 'N'|'S'|'E'|'W'|'NE'|'NW'|'SE'|'SW'|null
 *   - source        optional citation / reference URL
 *
 * Patterns are immutable once registered. Use clonePatternCells() to
 * get a mutable copy for stamping.
 */

/**
 * @typedef {[number, number]} Cell
 *
 * @typedef {Object} Pattern
 * @property {string}     id
 * @property {string}     name
 * @property {string}     category
 * @property {Cell[]}     cells
 * @property {number}     period
 * @property {string[]}   rulesets
 * @property {string}     description
 * @property {string[]}   tags
 * @property {string|null} direction
 * @property {string}     [source]
 * @property {number}     width
 * @property {number}     height
 */
import { CATEGORY } from './categories.js';
export { CATEGORY } from './categories.js';

/** @type {Map<string, Pattern>} */
const REGISTRY = new Map();

/**
 * Normalize a list of cells so that the minimum x and y are both 0,
 * and compute width/height of the bounding box.
 * @param {Cell[]} cells
 * @returns {{cells: Cell[], width: number, height: number}}
 */
export function normalizeCells(cells) {
  if (!Array.isArray(cells) || cells.length === 0) {
    return { cells: [], width: 0, height: 0 };
  }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of cells) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new Error(`Pattern cell must be integer pair, got [${x}, ${y}]`);
    }
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const normalized = cells.map(([x, y]) => [x - minX, y - minY]);
  return {
    cells: normalized,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * Register a pattern. Validates required metadata and normalizes cells.
 * @param {Partial<Pattern>} def
 * @returns {Pattern}
 */
export function registerPattern(def) {
  if (!def || !def.id) throw new Error('Pattern must have an id.');
  if (!def.name) throw new Error(`Pattern "${def.id}" must have a name.`);
  if (!def.category) throw new Error(`Pattern "${def.id}" must have a category.`);
  if (!Array.isArray(def.cells) || def.cells.length === 0) {
    throw new Error(`Pattern "${def.id}" must have a non-empty cells array.`);
  }
  const valid = Object.values(CATEGORY);
  if (!valid.includes(def.category)) {
    throw new Error(`Pattern "${def.id}" has invalid category: ${def.category}`);
  }
  // Strip any trailing `.rle` (case-insensitive) from id and name.
  const cleanId = String(def.id).replace(/\.rle$/i, '');
  const cleanName = String(def.name).replace(/\.rle$/i, '');
  // Dedupe: if a pattern with this id is already registered, return it.
  if (REGISTRY.has(cleanId)) {
    return REGISTRY.get(cleanId);
  }
  // Dedupe by name as well (case-insensitive, trimmed). The UI lists patterns
  // by name, so two different ids with the same display name still appear as
  // duplicates. If we find a name collision, return the existing pattern.
  const nameKey = cleanName.trim().toLowerCase();
  for (const existing of REGISTRY.values()) {
    if (existing.name.trim().toLowerCase() === nameKey) {
      return existing;
    }
  }
  const { cells, width, height } = normalizeCells(def.cells);
  const pattern = Object.freeze({
    id: cleanId,
    name: cleanName,
    category: def.category,
    cells: Object.freeze(cells.map((c) => Object.freeze(c.slice()))),
    period: def.period != null ? def.period : 1,
    rulesets: Object.freeze(def.rulesets || ['conway']),
    description: def.description || '',
    tags: Object.freeze(def.tags || []),
    direction: def.direction || null,
    source: def.source || null,
    width,
    height,
  });
  REGISTRY.set(pattern.id, pattern);
  return pattern;
}

/**
 * Look up a pattern by id.
 * @param {string} id
 * @returns {Pattern|null}
 */
export function getPattern(id) {
  return REGISTRY.get(id) || null;
}

/**
 * Get a mutable copy of a pattern's cells (deep clone), suitable for
 * transformations or stamping.
 * @param {string} id
 * @returns {Cell[]|null}
 */
export function clonePatternCells(id) {
  const p = REGISTRY.get(id);
  if (!p) return null;
  return p.cells.map((c) => [c[0], c[1]]);
}

/**
 * List patterns, optionally filtered.
 * @param {Object} [filter]
 * @param {string} [filter.category]   Filter to one category
 * @param {string} [filter.ruleset]    Filter to patterns compatible with this ruleset id
 * @param {string} [filter.tag]        Filter to patterns containing this tag
 * @returns {Pattern[]}
 */
export function listPatterns(filter = {}) {
  let out = Array.from(REGISTRY.values());
  if (filter.category) {
    out = out.filter((p) => p.category === filter.category);
  }
  if (filter.ruleset) {
    out = out.filter((p) => p.rulesets.includes('*') || p.rulesets.includes(filter.ruleset));
  }
  if (filter.tag) {
    out = out.filter((p) => p.tags.includes(filter.tag));
  }
  return out;
}

/**
 * Search patterns by name/id/tag substring (case-insensitive).
 * @param {string} query
 * @returns {Pattern[]}
 */
export function searchPatterns(query) {
  if (!query) return Array.from(REGISTRY.values());
  const q = query.toLowerCase();
  return Array.from(REGISTRY.values()).filter(
    (p) =>
      p.id.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      p.tags.some((t) => t.toLowerCase().includes(q))
  );
}

/**
 * Transform a pattern's cells.
 * @param {Cell[]} cells
 * @param {Object} opts
 * @param {number} [opts.rotate]  Number of 90° CW rotations (0..3)
 * @param {boolean} [opts.flipH]
 * @param {boolean} [opts.flipV]
 * @returns {Cell[]} Normalized result.
 */
export function transformCells(cells, { rotate = 0, flipH = false, flipV = false } = {}) {
  let out = cells.map(([x, y]) => [flipH ? -x : x, flipV ? -y : y]);
  const r = ((rotate % 4) + 4) % 4;
  for (let i = 0; i < r; i++) {
    // 90° CW: (x, y) -> (-y, x). Normalize after final rotation.
    out = out.map(([x, y]) => [-y, x]);
  }
  return normalizeCells(out).cells;
}

// ─────────────────────────────────────────────────────────────────────
// Imported pattern definitions
// ─────────────────────────────────────────────────────────────────────

/**
 * Load a generated pattern library from a parsed JSON document or a URL.
 * Works in both browser and other environments without Node-specific IO.
 *
 * @param {string|object} source  Either a URL/path to fetch, or an already
 *                                parsed object with a `patterns` array.
 * @returns {Promise<number>}     Number of patterns successfully registered.
 */
export async function loadGeneratedLibrary(source) {
  let doc;
  if (typeof source === 'string') {
    if (typeof fetch !== 'function') {
      throw new Error(
        'loadGeneratedLibrary: fetch is not available; ' +
          'pass a pre-parsed document instead of a URL.'
      );
    }
    const res = await fetch(source);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${source}: ${res.status} ${res.statusText}`);
    }
    doc = await res.json();
  } else if (source && typeof source === 'object') {
    doc = source;
  } else {
    throw new Error('loadGeneratedLibrary: source must be a URL string or parsed object.');
  }
  let n = 0;
  for (const p of doc.patterns || []) {
    try {
      registerPattern(p);
      n++;
    } catch (e) {
      console.warn(`Skipped ${p.id}: ${e.message}`);
    }
  }
  return n;
}

// Attempt to auto-load the generated library if it's available alongside
// this module. Uses dynamic import with an import attribute when supported,
// and falls back gracefully otherwise. Callers can also explicitly invoke
// loadGeneratedLibrary() with a URL or a pre-parsed object.
// Note: this is intentionally NOT awaited at module top-level. Awaiting
// here would block the entire module graph (and therefore the game UI)
// until the fetch resolves — and on a 404 it can hang the import chain
// depending on browser behaviour. Fire-and-forget keeps startup snappy
// and the generated patterns simply appear once they finish loading.
(async () => {
  try {
    const generatedUrl = new URL('./lifewiki.generated.json', import.meta.url).href;
    if (typeof fetch !== 'function') return;
    const res = await fetch(generatedUrl);
    if (!res.ok) {
      console.warn(
        `Generated pattern library not found at ${generatedUrl}; ` +
          'run lifewikiImporter.js to generate it.'
      );
      return;
    }
    const doc = await res.json();
    const n = await loadGeneratedLibrary(doc);
    console.log(`Registered ${n} imported patterns`);
  } catch (e) {
    console.warn(`Failed to load generated pattern library: ${e.message}`);
  }
})();

// ─────────────────────────────────────────────────────────────────────
// Built-in pattern definitions
// ─────────────────────────────────────────────────────────────────────

// ── Still lifes ──────────────────────────────────────────────────────

registerPattern({
  id: 'block',
  name: 'Block',
  category: CATEGORY.STILL_LIFE,
  cells: [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  period: 1,
  rulesets: ['conway', 'highlife', 'life_without_death', '2x2'],
  description: 'The simplest still life: a 2×2 square that never changes.',
  tags: ['simple', 'small', 'static'],
});

registerPattern({
  id: 'beehive',
  name: 'Beehive',
  category: CATEGORY.STILL_LIFE,
  cells: [
    [1, 0],
    [2, 0],
    [0, 1],
    [3, 1],
    [1, 2],
    [2, 2],
  ],
  period: 1,
  rulesets: ['conway', 'highlife'],
  description: 'A common 6-cell still life shaped like a hexagon.',
  tags: ['common', 'static'],
});

registerPattern({
  id: 'loaf',
  name: 'Loaf',
  category: CATEGORY.STILL_LIFE,
  cells: [
    [1, 0],
    [2, 0],
    [0, 1],
    [3, 1],
    [1, 2],
    [3, 2],
    [2, 3],
  ],
  period: 1,
  rulesets: ['conway', 'highlife'],
  description: 'A 7-cell still life resembling a loaf of bread.',
  tags: ['common', 'static'],
});

registerPattern({
  id: 'boat',
  name: 'Boat',
  category: CATEGORY.STILL_LIFE,
  cells: [
    [0, 0],
    [1, 0],
    [0, 1],
    [2, 1],
    [1, 2],
  ],
  period: 1,
  rulesets: ['conway', 'highlife'],
  description: 'A 5-cell still life.',
  tags: ['small', 'static'],
});

// ── Oscillators ──────────────────────────────────────────────────────

registerPattern({
  id: 'blinker',
  name: 'Blinker',
  category: CATEGORY.OSCILLATOR,
  cells: [
    [0, 0],
    [1, 0],
    [2, 0],
  ],
  period: 2,
  rulesets: ['conway', 'highlife'],
  description: 'The smallest period-2 oscillator: a 3-cell line that rotates.',
  tags: ['simple', 'small', 'p2'],
});

registerPattern({
  id: 'toad',
  name: 'Toad',
  category: CATEGORY.OSCILLATOR,
  cells: [
    [1, 0],
    [2, 0],
    [3, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  period: 2,
  rulesets: ['conway', 'highlife'],
  description: 'A 6-cell period-2 oscillator.',
  tags: ['common', 'p2'],
});

registerPattern({
  id: 'beacon',
  name: 'Beacon',
  category: CATEGORY.OSCILLATOR,
  cells: [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 2],
    [3, 2],
    [2, 3],
    [3, 3],
  ],
  period: 2,
  rulesets: ['conway', 'highlife'],
  description: 'Two adjacent blocks that blink.',
  tags: ['common', 'p2'],
});

registerPattern({
  id: 'pulsar',
  name: 'Pulsar',
  category: CATEGORY.OSCILLATOR,
  cells: [
    [2, 0],
    [3, 0],
    [4, 0],
    [8, 0],
    [9, 0],
    [10, 0],
    [0, 2],
    [5, 2],
    [7, 2],
    [12, 2],
    [0, 3],
    [5, 3],
    [7, 3],
    [12, 3],
    [0, 4],
    [5, 4],
    [7, 4],
    [12, 4],
    [2, 5],
    [3, 5],
    [4, 5],
    [8, 5],
    [9, 5],
    [10, 5],
    [2, 7],
    [3, 7],
    [4, 7],
    [8, 7],
    [9, 7],
    [10, 7],
    [0, 8],
    [5, 8],
    [7, 8],
    [12, 8],
    [0, 9],
    [5, 9],
    [7, 9],
    [12, 9],
    [0, 10],
    [5, 10],
    [7, 10],
    [12, 10],
    [2, 12],
    [3, 12],
    [4, 12],
    [8, 12],
    [9, 12],
    [10, 12],
  ],
  period: 3,
  rulesets: ['conway'],
  description: 'A 48-cell period-3 oscillator with cross-shaped symmetry.',
  tags: ['large', 'p3', 'symmetric'],
});

registerPattern({
  id: 'penta_decathlon',
  name: 'Penta-Decathlon',
  category: CATEGORY.OSCILLATOR,
  cells: [
    [1, 0],
    [1, 1],
    [0, 2],
    [2, 2],
    [1, 3],
    [1, 4],
    [1, 5],
    [1, 6],
    [0, 7],
    [2, 7],
    [1, 8],
    [1, 9],
  ],
  period: 15,
  rulesets: ['conway'],
  description: 'A period-15 oscillator derived from a row of 10 cells.',
  tags: ['p15', 'long'],
});

// ── Spaceships ───────────────────────────────────────────────────────

registerPattern({
  id: 'glider',
  name: 'Glider',
  category: CATEGORY.SPACESHIP,
  cells: [
    [1, 0],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ],
  period: 4,
  direction: 'SE',
  rulesets: ['conway', 'highlife'],
  description:
    'The classic 5-cell spaceship that travels diagonally SE. ' +
    'Rotate or flip to send it in any of the four diagonal directions.',
  tags: ['common', 'small', 'diagonal', 'transformable'],
});

registerPattern({
  id: 'lwss',
  name: 'Lightweight Spaceship (LWSS)',
  category: CATEGORY.SPACESHIP,
  cells: [
    [1, 0],
    [4, 0],
    [0, 1],
    [0, 2],
    [4, 2],
    [0, 3],
    [1, 3],
    [2, 3],
    [3, 3],
  ],
  period: 4,
  direction: 'W',
  rulesets: ['conway'],
  description:
    'Smallest orthogonal spaceship, travelling W. ' +
    'Rotate 180° to send it East, or rotate 90° for N/S travel.',
  tags: ['orthogonal', 'transformable'],
});

registerPattern({
  id: 'mwss',
  name: 'Middleweight Spaceship (MWSS)',
  category: CATEGORY.SPACESHIP,
  cells: [
    [3, 0],
    [1, 1],
    [5, 1],
    [0, 2],
    [0, 3],
    [5, 3],
    [0, 4],
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 4],
  ],
  period: 4,
  direction: 'W',
  rulesets: ['conway'],
  description:
    'Slightly larger orthogonal spaceship, travelling W. ' + 'Rotate to change direction.',
  tags: ['orthogonal', 'transformable'],
});

registerPattern({
  id: 'hwss',
  name: 'Heavyweight Spaceship (HWSS)',
  category: CATEGORY.SPACESHIP,
  cells: [
    [3, 0],
    [4, 0],
    [1, 1],
    [6, 1],
    [0, 2],
    [0, 3],
    [6, 3],
    [0, 4],
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 4],
    [5, 4],
  ],
  period: 4,
  direction: 'W',
  rulesets: ['conway'],
  description:
    'The largest of the three standard orthogonal spaceships, travelling W. ' +
    'Rotate to change direction.',
  tags: ['orthogonal', 'large', 'transformable'],
});

// ── Guns ─────────────────────────────────────────────────────────────

registerPattern({
  id: 'gosper_gun',
  name: 'Gosper Glider Gun',
  category: CATEGORY.GUN,
  cells: [
    [24, 0],
    [22, 1],
    [24, 1],
    [12, 2],
    [13, 2],
    [20, 2],
    [21, 2],
    [34, 2],
    [35, 2],
    [11, 3],
    [15, 3],
    [20, 3],
    [21, 3],
    [34, 3],
    [35, 3],
    [0, 4],
    [1, 4],
    [10, 4],
    [16, 4],
    [20, 4],
    [21, 4],
    [0, 5],
    [1, 5],
    [10, 5],
    [14, 5],
    [16, 5],
    [17, 5],
    [22, 5],
    [24, 5],
    [10, 6],
    [16, 6],
    [24, 6],
    [11, 7],
    [15, 7],
    [12, 8],
    [13, 8],
  ],
  period: 30,
  rulesets: ['conway'],
  description: 'The first discovered glider gun. Emits a glider every 30 generations.',
  tags: ['famous', 'large', 'emitter'],
  source: 'Bill Gosper, 1970',
});

// ── Methuselahs ──────────────────────────────────────────────────────

registerPattern({
  id: 'rpentomino',
  name: 'R-Pentomino',
  category: CATEGORY.METHUSELAH,
  cells: [
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [1, 2],
  ],
  period: 0,
  rulesets: ['conway'],
  description:
    'A 5-cell methuselah that stabilizes after 1103 generations, producing ' +
    'gliders along the way.',
  tags: ['famous', 'small', 'chaotic'],
});

registerPattern({
  id: 'acorn',
  name: 'Acorn',
  category: CATEGORY.METHUSELAH,
  cells: [
    [1, 0],
    [3, 1],
    [0, 2],
    [1, 2],
    [4, 2],
    [5, 2],
    [6, 2],
  ],
  period: 0,
  rulesets: ['conway'],
  description: 'A methuselah that stabilizes after 5206 generations. Famous for its size.',
  tags: ['famous', 'long-lived'],
});

registerPattern({
  id: 'diehard',
  name: 'Diehard',
  category: CATEGORY.METHUSELAH,
  cells: [
    [6, 0],
    [0, 1],
    [1, 1],
    [1, 2],
    [5, 2],
    [6, 2],
    [7, 2],
  ],
  period: 0,
  rulesets: ['conway'],
  description: 'A methuselah that disappears entirely after exactly 130 generations.',
  tags: ['famous', 'extinction'],
});

// ── Misc / game-specific ─────────────────────────────────────────────

registerPattern({
  id: 'twin_glider',
  name: 'Twin Glider Formation',
  category: CATEGORY.SPACESHIP,
  cells: [
    [1, 0],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
    [6, 0],
    [7, 1],
    [5, 2],
    [6, 2],
    [7, 2],
  ],
  period: 4,
  direction: 'SE',
  rulesets: ['conway'],
  description: 'Two SE gliders flying in formation. Game-specific composite.',
  tags: ['game', 'formation'],
});

registerPattern({
  id: 'fortress_target',
  name: 'Fortress Target',
  category: CATEGORY.MISC,
  cells: [
    [1, 0],
    [2, 0],
    [0, 1],
    [3, 1],
    [0, 2],
    [3, 2],
    [1, 3],
    [2, 3],
  ],
  period: 1,
  rulesets: ['*'],
  description:
    'Game-specific stationary base emplacement. Re-imprinted each tick ' +
    'so it acts as an indestructible-by-Life-rules target.',
  tags: ['game', 'static', 'base'],
});

registerPattern({
  id: 'bunker',
  name: 'Bunker',
  category: CATEGORY.MISC,
  cells: [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ],
  period: 1,
  rulesets: ['*'],
  description: 'Game-specific smaller block emplacement.',
  tags: ['game', 'static', 'base'],
});

// ── Additional Spaceships ────────────────────────────────────────────
registerPattern({
  id: 'copperhead',
  name: 'Copperhead',
  category: CATEGORY.SPACESHIP,
  // Decoded from RLE: b2o2b2o$3b2o$3b2o$obo2bobo$o6bo2$o6bo$b2o2b2o$2b4o2$3b2o$3b2o!
  // 28 cells, bounding box ~8×12, period 10, c/10 orthogonal
  cells: [
    // Row 0: b2o2b2o  → cols 1,2,5,6
    [1, 0],
    [2, 0],
    [5, 0],
    [6, 0],
    // Row 1: 3b2o     → cols 3,4
    [3, 1],
    [4, 1],
    // Row 2: 3b2o     → cols 3,4
    [3, 2],
    [4, 2],
    // Row 3: obo2bobo → cols 0,2,5,7
    [0, 3],
    [2, 3],
    [5, 3],
    [7, 3],
    // Row 4: o6bo     → cols 0,7
    [0, 4],
    [7, 4],
    // Row 5: (empty — the "2$" skips row 5)
    // Row 6: o6bo     → cols 0,7
    [0, 6],
    [7, 6],
    // Row 7: b2o2b2o  → cols 1,2,5,6
    [1, 7],
    [2, 7],
    [5, 7],
    [6, 7],
    // Row 8: 2b4o     → cols 2,3,4,5
    [2, 8],
    [3, 8],
    [4, 8],
    [5, 8],
    // Row 9: (empty — the "2$" skips row 9)
    // Row 10: 3b2o    → cols 3,4
    [3, 10],
    [4, 10],
    // Row 11: 3b2o    → cols 3,4
    [3, 11],
    [4, 11],
  ],
  period: 10,
  direction: 'N',
  rulesets: ['conway'],
  description:
    'A c/10 orthogonal spaceship discovered by zdr on March 5, 2016 using zfind. ' +
    'The first spaceship of this speed to be discovered; notable for its small size ' +
    'and high period. It hauls a block behind it and can burn through blinkers, ' +
    'creating a c/10 blinker fuse.',
  tags: ['c/10', 'orthogonal', 'period-10', 'famous', 'zdr', '2016'],
  source: 'https://conwaylife.com/wiki/Copperhead',
});

/**
 * Reset registry (test utility). Removes all built-ins; mainly for unit
 * tests that want to verify registration in isolation.
 */
export function _resetForTests() {
  REGISTRY.clear();
}
