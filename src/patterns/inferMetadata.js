/**
 * Metadata inference for imported patterns.
 *
 * Given a set of cells and an optional rule (B/S notation), determine:
 *   - category: still_life | oscillator | spaceship | methuselah | misc
 *   - period: for oscillators/spaceships, the smallest period found
 *   - direction: cardinal/diagonal direction for spaceships
 *
 * Uses the simulation utilities in test/sim/lifeSim.js (pure JS, no DOM
 * dependencies) so this module is safe to use in Node-based importers.
 */

import { CompiledRuleset, CONWAY, getRuleset, parseBSNotation } from '../rules/ruleset.js';
import { listRulesets, formatBSNotation } from '../rules/ruleset.js';
import '../rules/extraRulesets.js';
import { CATEGORY } from './library.js';
import {
  cellsToSet,
  step,
  run,
  boundingBox,
  normalizeSet,
  setsEqual,
  findPeriod,
} from '../../test/sim/lifeSim.js';

/**
 * Map a (dx, dy) displacement to a compass direction.
 * @param {number} dx
 * @param {number} dy
 * @returns {string|null}
 */
export function directionFromDisplacement(dx, dy) {
  if (dx === 0 && dy === 0) return null;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  if (sx === 0 && sy < 0) return 'N';
  if (sx === 0 && sy > 0) return 'S';
  if (sx > 0 && sy === 0) return 'E';
  if (sx < 0 && sy === 0) return 'W';
  if (sx > 0 && sy < 0) return 'NE';
  if (sx > 0 && sy > 0) return 'SE';
  if (sx < 0 && sy < 0) return 'NW';
  if (sx < 0 && sy > 0) return 'SW';
  return null;
}

/**
 * Find a registered ruleset whose birth/survival rules match the given
 * B/S notation. Compares canonical (sorted/deduped) forms so that
 * "B3/S23", "b3/s23", and "B3/S32" all match Conway.
 *
 * @param {string} notation
 * @returns {object|null}  The matching registered ruleset def, or null.
 */
export function findRulesetByNotation(notation) {
  const parsed = parseBSNotation(notation);
  if (!parsed) return null;
  const canonical = formatBSNotation(parsed.birth, parsed.survival);
  for (const def of listRulesets()) {
    const defCanonical = formatBSNotation(def.birth, def.survival);
    if (defCanonical === canonical) return def;
  }
  return null;
}
/**
 * Resolve a ruleset definition from a B/S string or known id. Falls back to Conway.
 * @param {string|undefined} rule
 * @returns {{def: object, compiled: CompiledRuleset, rulesetId: string}}
 */
export function resolveRule(rule) {
  if (!rule) return { def: CONWAY, compiled: new CompiledRuleset(CONWAY), rulesetId: 'conway' };
  const trimmed = String(rule).trim();
  // Try id lookup first (e.g. "conway", "highlife").
  const byId = getRuleset(trimmed.toLowerCase());
  if (byId) {
    return { def: byId, compiled: new CompiledRuleset(byId), rulesetId: byId.id };
  }
  // Try B/S notation: first check if it matches a registered ruleset
  // (so e.g. "B3/S23" → conway, "B36/S23" → highlife, "B368/S245" → move).
  const byNotation = findRulesetByNotation(trimmed);
  if (byNotation) {
    return {
      def: byNotation,
      compiled: new CompiledRuleset(byNotation),
      rulesetId: byNotation.id,
    };
  }
  // Otherwise build an anonymous custom ruleset from the notation.
  const parsed = parseBSNotation(trimmed);
  if (parsed) {
    const def = {
      id: `custom_${trimmed.replace(/[^A-Za-z0-9]/g, '_').toLowerCase()}`,
      name: trimmed,
      notation: formatBSNotation(parsed.birth, parsed.survival),
      description: '',
      birth: parsed.birth,
      survival: parsed.survival,
    };
    return { def, compiled: new CompiledRuleset(def), rulesetId: def.id };
  }
  console.warn(`Unknown ruleset "${trimmed}", falling back to Conway.`);
  return { def: CONWAY, compiled: new CompiledRuleset(CONWAY), rulesetId: 'conway' };
}

/**
 * Determine the category, period and direction of a pattern by simulation.
 *
 * Strategy:
 *   1. Run one step. If unchanged ⇒ still life (period 1).
 *   2. Otherwise search periods 2..maxPeriod for either exact return
 *      (oscillator) or normalized return (spaceship).
 *   3. If nothing found within maxPeriod:
 *        - If the pattern dies entirely ⇒ misc (could be flash methuselah).
 *        - If the population grows substantially within maxPeriod
 *          but doesn't repeat ⇒ methuselah (likely chaotic).
 *        - Otherwise ⇒ misc.
 *
 * @param {[number, number][]} cells
 * @param {object} [opts]
 * @param {string} [opts.rule]          - B/S string or known ruleset id
 * @param {number} [opts.maxPeriod]     - upper bound for period search
 * @param {number} [opts.methuselahGens] - generations to observe for methuselah heuristic
 * @returns {{
 *   category: string,
 *   period: number,
 *   direction: string|null,
 *   displacement: [number, number]|null,
 *   rulesetId: string,
 *   notes: string[]
 * }}
 */
export function inferPatternMetadata(cells, opts = {}) {
  const { maxPeriod = 60, methuselahGens = 200 } = opts;
  const notes = [];
  const { compiled, rulesetId } = resolveRule(opts.rule);

  if (!cells || cells.length === 0) {
    return {
      category: CATEGORY.MISC,
      period: 0,
      direction: null,
      displacement: null,
      rulesetId,
      notes: ['empty pattern'],
    };
  }

  const initial = cellsToSet(cells);
  const oneStep = step(initial, compiled);
  // Still life?
  if (setsEqual(initial, oneStep)) {
    return {
      category: CATEGORY.STILL_LIFE,
      period: 1,
      direction: null,
      displacement: null,
      rulesetId,
      notes,
    };
  }

  // Search for short period (oscillator or spaceship).
  const found = findPeriod(cells, compiled, maxPeriod);
  if (found) {
    const [dx, dy] = found.displacement;
    if (dx === 0 && dy === 0) {
      return {
        category: CATEGORY.OSCILLATOR,
        period: found.period,
        direction: null,
        displacement: [0, 0],
        rulesetId,
        notes,
      };
    }
    return {
      category: CATEGORY.SPACESHIP,
      period: found.period,
      direction: directionFromDisplacement(dx, dy),
      displacement: [dx, dy],
      rulesetId,
      notes,
    };
  }

  // No short period — try methuselah heuristic.
  let state = initial;
  const initialSize = initial.size;
  let maxSize = initialSize;
  let alive = true;
  for (let g = 0; g < methuselahGens; g++) {
    state = step(state, compiled);
    if (state.size === 0) {
      alive = false;
      notes.push(`died at generation ${g + 1}`);
      break;
    }
    if (state.size > maxSize) maxSize = state.size;
  }
  if (!alive) {
    return {
      category: CATEGORY.MISC,
      period: 0,
      direction: null,
      displacement: null,
      rulesetId,
      notes,
    };
  }
  // If population grew substantially, label as methuselah.
  if (maxSize >= initialSize * 3 || maxSize - initialSize >= 20) {
    notes.push(`max population ${maxSize} from initial ${initialSize}`);
    return {
      category: CATEGORY.METHUSELAH,
      period: 0,
      direction: null,
      displacement: null,
      rulesetId,
      notes,
    };
  }
  notes.push(`no period found within ${maxPeriod}; stable size ~${maxSize}`);
  return {
    category: CATEGORY.MISC,
    period: 0,
    direction: null,
    displacement: null,
    rulesetId,
    notes,
  };
}
