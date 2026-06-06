/**
 * Ruleset module: encapsulates cellular automaton rules.
 *
 * A ruleset defines:
 *   - birth conditions (which neighbor counts spawn a new cell)
 *   - survival conditions (which neighbor counts keep a cell alive)
 *   - neighborhood (which cells are counted as neighbors)
 *   - metadata (name, description, B/S notation)
 *
 * The classic Game of Life is B3/S23. This module exposes that as the
 * default and provides a registry for additional rulesets.
 *
 * Future rulesets can be added by registering them via Ruleset.register()
 * and selected at runtime. The Simulation class will consult the active
 * ruleset for its birth/survival decisions.
 */
import { getNeighborhood, MOORE_NEIGHBORHOOD } from './neighborhoods.js';

/**
 * @typedef {Object} RulesetDef
 * @property {string}   id              - Unique identifier (e.g. 'conway')
 * @property {string}   name            - Display name
 * @property {string}   notation        - B/S notation (e.g. 'B3/S23')
 * @property {string}   description     - Human-readable description
 * @property {number[]} birth           - Neighbor counts that cause birth
 * @property {number[]} survival        - Neighbor counts that allow survival
 * @property {string}   [neighborhood]   - Neighborhood id (default: 'moore')
 */

/** @type {Map<string, RulesetDef>} */
const REGISTRY = new Map();

/**
 * Register a new ruleset. Idempotent; later registrations override earlier ones.
 * @param {RulesetDef} def
 */
export function registerRuleset(def) {
  if (!def || !def.id) throw new Error('Ruleset must have an id.');
  // Validate birth/survival arrays.
  if (!Array.isArray(def.birth) || !Array.isArray(def.survival)) {
    throw new Error(`Ruleset "${def.id}" must define birth and survival arrays.`);
  }
  // Exotic rules use stub arrays; skip neighbor-count validation for them.
  if (def._exoticType) {
    REGISTRY.set(def.id, { ...def });
    return;
  }
  // Determine the maximum allowed neighbor count based on the
  // declared neighborhood. Moore = 8, but exotic neighborhoods
  // (Euclidean radii, anisotropic transforms) can have far more
  // cells. We look up the neighborhood size lazily to avoid a
  // hard dependency on the neighborhoods module being loaded first.
  let maxNeighbors = 8;
  if (def.neighborhood && def.neighborhood !== 'moore') {
    // Best-effort: try to resolve the neighborhood now. If it's not
    // yet registered (load-order issue), fall back to a generous cap
    // and let CompiledRuleset re-validate later.
    try {
      // Lazy require to avoid circular import issues at module load.
      const nbhd = _tryGetNeighborhood(def.neighborhood);
      if (nbhd && typeof nbhd.size === 'number') {
        maxNeighbors = nbhd.size;
      } else {
        // Unknown neighborhood at registration time — be permissive.
        maxNeighbors = 64;
      }
    } catch (_e) {
      maxNeighbors = 64;
    }
  }
  for (const n of def.birth) {
    if (!Number.isInteger(n) || n < 0 || n > maxNeighbors) {
      throw new Error(`Ruleset "${def.id}" has invalid birth value: ${n}`);
    }
  }
  for (const n of def.survival) {
    if (!Number.isInteger(n) || n < 0 || n > maxNeighbors) {
      throw new Error(`Ruleset "${def.id}" has invalid survival value: ${n}`);
    }
  }
  REGISTRY.set(def.id, { ...def });
}
// Lazy lookup that avoids the circular dependency between ruleset.js
// and neighborhoods.js. Returns null if the neighborhood module hasn't
// loaded yet or the id isn't registered.
function _tryGetNeighborhood(id) {
  // The neighborhoods module attaches its registry getter on the
  // module namespace when imported. We access it via a dynamic
  // reference stored on globalThis to break the cycle.
  const getter = globalThis.__getNeighborhood__;
  if (typeof getter === 'function') {
    return getter(id);
  }
  return null;
}

/**
 * Look up a ruleset by id. Returns null if not found.
 * @param {string} id
 * @returns {RulesetDef|null}
 */
export function getRuleset(id) {
  return REGISTRY.get(id) || null;
}

/**
 * List all registered rulesets.
 * @returns {RulesetDef[]}
 */
export function listRulesets() {
  return Array.from(REGISTRY.values());
}

/**
 * Parse a B/S notation string (e.g. "B3/S23") into birth/survival arrays.
 * Accepts both uppercase and lowercase. Returns null on parse failure.
 *
 * Also accepts the older "S/B" notation (e.g. "23/3"), where the survival
 * digits come first and the birth digits come second, separated by a slash.
 * @param {string} notation
 * @returns {{birth: number[], survival: number[]}|null}
 */
export function parseBSNotation(notation) {
  if (typeof notation !== 'string') return null;
  const trimmed = notation.trim();
  if (trimmed.length === 0) return null;
  // Standard B/S notation, e.g. "B3/S23".
  let m = trimmed.match(/^B([0-8]*)\/S([0-8]*)$/i);
  let birthStr;
  let survivalStr;
  if (m) {
    birthStr = m[1];
    survivalStr = m[2];
  } else {
    // Older S/B notation, e.g. "23/3" (survival/birth).
    m = trimmed.match(/^([0-8]*)\/([0-8]*)$/);
    if (!m) return null;
    survivalStr = m[1];
    birthStr = m[2];
  }
  // Reject if BOTH parts are empty — that's not a valid rule.
  if (birthStr.length === 0 && survivalStr.length === 0) return null;
  const birth = birthStr
    .split('')
    .map((c) => parseInt(c, 10))
    .filter((n) => !isNaN(n));
  const survival = survivalStr
    .split('')
    .map((c) => parseInt(c, 10))
    .filter((n) => !isNaN(n));
  // Dedup + sort for canonical form.
  const uniq = (a) => Array.from(new Set(a)).sort((x, y) => x - y);
  return { birth: uniq(birth), survival: uniq(survival) };
}

/**
 * Format birth/survival arrays back into B/S notation.
 * @param {number[]} birth
 * @param {number[]} survival
 * @returns {string}
 */
export function formatBSNotation(birth, survival) {
  const sorted = (a) => Array.from(new Set(a)).sort((x, y) => x - y);
  return `B${sorted(birth).join('')}/S${sorted(survival).join('')}`;
}

/**
 * Build a Ruleset from B/S notation. Convenience for quick definition.
 * @param {Object} opts
 * @param {string} opts.id
 * @param {string} opts.name
 * @param {string} opts.notation
 * @param {string} [opts.description]
 * @returns {RulesetDef}
 */
export function rulesetFromNotation({ id, name, notation, description }) {
  const parsed = parseBSNotation(notation);
  if (!parsed) {
    throw new Error(`Invalid B/S notation: "${notation}"`);
  }
  return {
    id,
    name,
    notation: formatBSNotation(parsed.birth, parsed.survival),
    description: description || '',
    birth: parsed.birth,
    survival: parsed.survival,
  };
}

/**
 * Pre-computed lookup tables for fast birth/survival checks. Used by
 * the simulation's hot loop to avoid array indexOf calls per cell.
 *
 * Tables are sized to fit the neighborhood (size+1 entries to cover
 * neighbor counts 0..size inclusive).
 */
export class CompiledRuleset {
  constructor(def) {
    this.def = def;
    // Resolve neighborhood (defaults to Moore for backwards compat).
    const nbhdId = def.neighborhood || 'moore';
    this.neighborhood = getNeighborhood(nbhdId) || MOORE_NEIGHBORHOOD;
    // Carry topology forward for the simulation engine.
    this.topology = this.neighborhood.topology || 'square';
    const tableSize = this.neighborhood.size + 1;
    this.birthTable = new Uint8Array(tableSize);
    this.survivalTable = new Uint8Array(tableSize);
    for (const n of def.birth) this.birthTable[n] = 1;
    for (const n of def.survival) this.survivalTable[n] = 1;
  }
  shouldBirth(neighborCount) {
    return this.birthTable[neighborCount] === 1;
  }
  shouldSurvive(neighborCount) {
    return this.survivalTable[neighborCount] === 1;
  }
}

// ── Built-in rulesets ──────────────────────────────────────────────────

/**
 * Conway's Game of Life: B3/S23.
 * The default ruleset used throughout the game.
 */
export const CONWAY = {
  id: 'conway',
  name: "Conway's Game of Life",
  notation: 'B3/S23',
  description:
    'Classic Game of Life. A dead cell with exactly 3 neighbors is born; ' +
    'a live cell with 2 or 3 neighbors survives.',
  birth: [3],
  survival: [2, 3],
};

/**
 * HighLife: B36/S23. Similar to Conway but with an extra birth condition
 * that produces replicators.
 */
export const HIGHLIFE = {
  id: 'highlife',
  name: 'HighLife',
  notation: 'B36/S23',
  description:
    'Variant with extra birth condition at 6 neighbors. Contains the ' +
    'replicator: a small pattern that copies itself.',
  birth: [3, 6],
  survival: [2, 3],
};

/**
 * Day & Night: B3678/S34678. Symmetric rule where on/off cells behave
 * identically — looks the same if you invert all cells.
 */
export const DAY_NIGHT = {
  id: 'day_night',
  name: 'Day & Night',
  notation: 'B3678/S34678',
  description:
    'Symmetric rule: alive and dead cells follow identical patterns. ' +
    'Looks the same with inverted colors.',
  birth: [3, 6, 7, 8],
  survival: [3, 4, 6, 7, 8],
};

/**
 * Seeds: B2/S. No survival — every live cell dies each generation.
 * Produces explosive chaotic patterns.
 */
export const SEEDS = {
  id: 'seeds',
  name: 'Seeds',
  notation: 'B2/S',
  description:
    'No survival; cells die every tick. Births at 2 neighbors produce ' +
    'rapidly expanding patterns.',
  birth: [2],
  survival: [],
};

/**
 * Life Without Death: B3/S012345678. Once alive, always alive.
 * Patterns grow without ever dying.
 */
export const LIFE_WITHOUT_DEATH = {
  id: 'life_without_death',
  name: 'Life Without Death',
  notation: 'B3/S012345678',
  description: 'Cells never die. Patterns expand forever and form intricate static structures.',
  birth: [3],
  survival: [0, 1, 2, 3, 4, 5, 6, 7, 8],
};

/**
 * Maze: B3/S12345. Forms long maze-like corridors.
 */
export const MAZE = {
  id: 'maze',
  name: 'Maze',
  notation: 'B3/S12345',
  description: 'Forms maze-like static structures with long corridors.',
  birth: [3],
  survival: [1, 2, 3, 4, 5],
};

/**
 * Replicator: B1357/S1357. Every pattern replicates itself.
 */
export const REPLICATOR = {
  id: 'replicator',
  name: 'Replicator',
  notation: 'B1357/S1357',
  description: 'Every pattern eventually replicates itself.',
  birth: [1, 3, 5, 7],
  survival: [1, 3, 5, 7],
};

/**
 * 2x2: B36/S125. Produces stable 2x2 block structures.
 */
export const TWO_BY_TWO = {
  id: '2x2',
  name: '2x2',
  notation: 'B36/S125',
  description: 'Tends to form 2x2 block-based stable structures.',
  birth: [3, 6],
  survival: [1, 2, 5],
};

// Register all built-ins.
registerRuleset(CONWAY);
registerRuleset(HIGHLIFE);
registerRuleset(DAY_NIGHT);
registerRuleset(SEEDS);
registerRuleset(LIFE_WITHOUT_DEATH);
registerRuleset(MAZE);
registerRuleset(REPLICATOR);
registerRuleset(TWO_BY_TWO);

/**
 * The currently-active ruleset. Defaults to Conway. The Simulation
 * reads from this on each tick. Use setActiveRuleset() to switch.
 */
let _active = new CompiledRuleset(CONWAY);

/**
 * Get the currently-active compiled ruleset.
 * @returns {CompiledRuleset}
 */
export function getActiveRuleset() {
  return _active;
}

/**
 * Set the active ruleset by id. Returns false if the id is unknown.
 * @param {string} id
 * @returns {boolean}
 */
export function setActiveRuleset(id) {
  const def = getRuleset(id);
  if (!def) return false;
  _active = new CompiledRuleset(def);
  return true;
}

/**
 * Set the active ruleset directly from a definition (does not register).
 * @param {RulesetDef} def
 */
export function setActiveRulesetDef(def) {
  _active = new CompiledRuleset(def);
}
