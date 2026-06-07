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
import { isExoticRule, getExoticRule } from '../rules/exoticEngines.js';
import { CATEGORY } from './library.js';
import {
  cellsToSet,
  step,
  run,
  boundingBox,
  normalizeSet,
  setsEqual,
  findPeriod,
  characterize,
} from '../sim/lifeSim.js';
/**
 * Module-level diagnostic counters. The importer reads these after a run
 * to surface a detailed breakdown of how each rule string was resolved.
 *
 * Buckets:
 *   - matchedById        : rule resolved by direct id lookup (e.g. "conway")
 *   - matchedByNotation  : rule resolved by canonical B/S match
 *   - customAnonymous    : valid B/S parsed but no registered match
 *   - unparseable        : couldn't parse the rule string at all
 *   - missing            : no rule field supplied (default Conway)
 *   - stripped           : count of inputs that had a topology suffix
 */
export const RULE_RESOLUTION_STATS = {
  matchedById: 0,
  matchedByNotation: 0,
  customAnonymous: 0,
  unparseable: 0,
  missing: 0,
  stripped: 0,
  byRawInput: Object.create(null), // raw rule string → count
  byResolvedId: Object.create(null), // resolved id → count
  sampleUnparseable: [], // up to 20 examples
};
/**
 * Reset diagnostic counters between runs (useful in tests).
 */
export function resetRuleResolutionStats() {
  RULE_RESOLUTION_STATS.matchedById = 0;
  RULE_RESOLUTION_STATS.matchedByNotation = 0;
  RULE_RESOLUTION_STATS.customAnonymous = 0;
  RULE_RESOLUTION_STATS.unparseable = 0;
  RULE_RESOLUTION_STATS.missing = 0;
  RULE_RESOLUTION_STATS.stripped = 0;
  RULE_RESOLUTION_STATS.byRawInput = Object.create(null);
  RULE_RESOLUTION_STATS.byResolvedId = Object.create(null);
  RULE_RESOLUTION_STATS.sampleUnparseable = [];
}
function bumpResolved(id) {
  RULE_RESOLUTION_STATS.byResolvedId[id] = (RULE_RESOLUTION_STATS.byResolvedId[id] || 0) + 1;
}
function bumpRaw(raw) {
  const key = raw == null ? '<none>' : String(raw);
  RULE_RESOLUTION_STATS.byRawInput[key] = (RULE_RESOLUTION_STATS.byRawInput[key] || 0) + 1;
}

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
 * Strip topology/bounded-grid suffixes from a rule string, returning the
 * base rule plus the suffix as a separate field. RLE files (especially
 * from LifeWiki) frequently encode bounded universes as suffixes like:
 *
 *   B3/S23:T55      torus 55x55
 *   B3/S23:T55,52   torus 55x52
 *   B3/S23:K100     Klein bottle width 100
 *   B3/S23:P30,30   plane (finite rectangle)
 *   B3/S23:S30,30   sphere
 *
 * For metadata inference we only care about the underlying B/S rule,
 * so we strip anything from the first ':' onward.
 *
 * @param {string} rule
 * @returns {{ base: string, topology: string|null }}
 */
export function stripTopologySuffix(rule) {
  if (typeof rule !== 'string') return { base: rule, topology: null };
  const idx = rule.indexOf(':');
  if (idx < 0) return { base: rule.trim(), topology: null };
  return {
    base: rule.slice(0, idx).trim(),
    topology: rule.slice(idx + 1).trim(),
  };
}
/**
 * Resolve a ruleset definition from a B/S string or known id. Falls back to Conway.
 * @param {string|undefined} rule
 * @returns {{def: object, compiled: CompiledRuleset, rulesetId: string}}
 */
export function resolveRule(rule) {
  bumpRaw(rule);
  if (!rule) {
    RULE_RESOLUTION_STATS.missing++;
    bumpResolved('conway');
    return { def: CONWAY, compiled: new CompiledRuleset(CONWAY), rulesetId: 'conway' };
  }
  const raw = String(rule).trim();
  // Strip bounded-grid/topology suffixes like ":T55", ":K100", ":P30,30".
  const { base, topology } = stripTopologySuffix(raw);
  const trimmed = base;
  if (topology) {
    RULE_RESOLUTION_STATS.stripped++;
    // We don't simulate bounded topologies; we infer metadata on the
    // infinite plane using just the base B/S rule. Note this in a log
    // for visibility but proceed normally.
    // (Topology info could be preserved elsewhere if needed.)
  }
  // Exotic rules (TCA, time-integrated, fractional lightcone) can't be
  // simulated by the standard B/S engine in lifeSim.js — their dynamics
  // depend on lookahead, history buffers, or continuous influence
  // kernels. Surface them with a sentinel marker so callers can skip
  // characterization rather than producing misleading results from a
  // Conway fallback.
  const trimmedLower = trimmed.toLowerCase();
  if (isExoticRule(trimmedLower)) {
    const entry = getExoticRule(trimmedLower);
    bumpResolved(trimmedLower);
    return {
      def: entry.def,
      compiled: null,
      rulesetId: trimmedLower,
      exotic: true,
      exoticType: entry.type,
    };
  }
  // Some exotic rules may also be mirrored into the standard registry
  // with an `_exoticType` marker. Detect that variant too.
  const maybeStd = getRuleset(trimmedLower);
  if (maybeStd && maybeStd._exoticType) {
    bumpResolved(maybeStd.id);
    return {
      def: maybeStd,
      compiled: null,
      rulesetId: maybeStd.id,
      exotic: true,
      exoticType: maybeStd._exoticType,
    };
  }
  // Try id lookup first (e.g. "conway", "highlife").
  const byId = getRuleset(trimmed.toLowerCase());
  if (byId) {
    RULE_RESOLUTION_STATS.matchedById++;
    bumpResolved(byId.id);
    return { def: byId, compiled: new CompiledRuleset(byId), rulesetId: byId.id };
  }
  // Try B/S notation: first check if it matches a registered ruleset
  // (so e.g. "B3/S23" → conway, "B36/S23" → highlife, "B368/S245" → move).
  const byNotation = findRulesetByNotation(trimmed);
  if (byNotation) {
    RULE_RESOLUTION_STATS.matchedByNotation++;
    bumpResolved(byNotation.id);
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
    RULE_RESOLUTION_STATS.customAnonymous++;
    bumpResolved(def.id);
    return { def, compiled: new CompiledRuleset(def), rulesetId: def.id };
  }
  RULE_RESOLUTION_STATS.unparseable++;
  if (RULE_RESOLUTION_STATS.sampleUnparseable.length < 20) {
    RULE_RESOLUTION_STATS.sampleUnparseable.push(raw);
  }
  bumpResolved('conway');
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
 * Additionally records detailed characterization data:
 *   - maxBounds:  largest bounding box seen during simulation, or
 *                 { width: -1, height: -1 } if the pattern appears
 *                 to grow without bound (population cap exceeded).
 *   - maxPopulation: peak live cell count.
 *   - finalPopulation: live cell count at end of observation.
 *   - stabilizedAt: generation at which the pattern stopped changing,
 *                   or null if it never stabilized within methuselahGens.
 *   - extinct: true if the pattern died out.
 *
 * @param {[number, number][]} cells
 * @param {object} [opts]
 * @param {string} [opts.rule]          - B/S string or known ruleset id
 * @param {number} [opts.maxPeriod]     - upper bound for period search
 * @param {number} [opts.methuselahGens] - generations to observe for methuselah heuristic
 * @param {number} [opts.populationCap]  - abort and mark unbounded if pop exceeds this
 * @returns {{
 *   category: string,
 *   period: number,
 *   direction: string|null,
 *   displacement: [number, number]|null,
 *   rulesetId: string,
 *   maxBounds: {width: number, height: number}|null,
 *   maxPopulation: number,
 *   finalPopulation: number,
 *   stabilizedAt: number|null,
 *   extinct: boolean,
 *   unbounded: boolean,
 *   notes: string[]
 * }}
 */
export function inferPatternMetadata(cells, opts = {}) {
  const { maxPeriod = 60, methuselahGens = 200, populationCap = 100000 } = opts;
  const notes = [];
  const resolved = resolveRule(opts.rule);
  const { compiled, rulesetId } = resolved;

  if (!cells || cells.length === 0) {
    return {
      category: CATEGORY.MISC,
      period: 0,
      direction: null,
      displacement: null,
      rulesetId,
      maxBounds: null,
      maxPopulation: 0,
      finalPopulation: 0,
      stabilizedAt: 0,
      extinct: true,
      unbounded: false,
      notes: ['empty pattern'],
    };
  }
  // Exotic rule: we cannot faithfully simulate this pattern with the
  // standard B/S engine. Return a minimal "uncharacterized" record so
  // the caller (e.g. PatternCapture) doesn't mislabel the pattern as
  // chaotic/unbounded based on a wrong Conway simulation.
  if (resolved.exotic) {
    const initial = cellsToSet(cells);
    const initBB = boundingBox(initial);
    notes.push(`exotic ruleset "${rulesetId}" (${resolved.exoticType}) — characterization skipped`);
    return {
      category: CATEGORY.MISC,
      period: 0,
      direction: null,
      displacement: null,
      rulesetId,
      maxBounds: initBB ? { width: initBB.width, height: initBB.height } : null,
      maxPopulation: initial.size,
      finalPopulation: initial.size,
      stabilizedAt: null,
      extinct: false,
      unbounded: false,
      exotic: true,
      notes,
    };
  }
  // Topology-aware sparse simulator: hex (odd-r offset coords) and
  // tri (orientation-dependent) topologies are now handled directly
  // by lifeSim.js via per-cell offset lookup. The simulator reads
  // the topology from rule.neighborhood.topology and dispatches.
  let ruleTopology = 'square';
  if (compiled && compiled.topology) {
    ruleTopology = compiled.topology;
  } else if (resolved.def && resolved.def.topology) {
    ruleTopology = resolved.def.topology;
  }
  if (ruleTopology && ruleTopology !== 'square') {
    notes.push(`topology="${ruleTopology}" (topology-aware simulation)`);
  }

  const initial = cellsToSet(cells);
  const initBB = boundingBox(initial);
  const oneStep = step(initial, compiled);
  // Still life?
  if (setsEqual(initial, oneStep)) {
    return {
      category: CATEGORY.STILL_LIFE,
      period: 1,
      direction: null,
      displacement: null,
      rulesetId,
      maxBounds: initBB ? { width: initBB.width, height: initBB.height } : null,
      maxPopulation: initial.size,
      finalPopulation: initial.size,
      stabilizedAt: 0,
      extinct: false,
      unbounded: false,
      notes,
    };
  }

  // Search for short period (oscillator or spaceship).
  const found = findPeriod(cells, compiled, maxPeriod);
  if (found) {
    const [dx, dy] = found.displacement;
    // Run a full characterization across one period to capture the
    // maximal bounds the pattern sweeps through.
    const char = characterize(cells, compiled, found.period, {
      populationCap,
    });
    const maxBounds = char.bounds
      ? { width: char.bounds.width, height: char.bounds.height }
      : initBB
        ? { width: initBB.width, height: initBB.height }
        : null;
    if (dx === 0 && dy === 0) {
      return {
        category: CATEGORY.OSCILLATOR,
        period: found.period,
        direction: null,
        displacement: [0, 0],
        rulesetId,
        maxBounds,
        maxPopulation: char.maxSize,
        finalPopulation: char.finalSize,
        stabilizedAt: null,
        extinct: false,
        unbounded: false,
        notes,
      };
    }
    // Spaceships travel forever, so their "max bounds" in absolute
    // terms is infinite. Report the per-period sweep instead, which
    // is what matters for rendering / collision footprint.
    return {
      category: CATEGORY.SPACESHIP,
      period: found.period,
      direction: directionFromDisplacement(dx, dy),
      displacement: [dx, dy],
      rulesetId,
      maxBounds,
      maxPopulation: char.maxSize,
      finalPopulation: char.finalSize,
      stabilizedAt: null,
      extinct: false,
      unbounded: false,
      notes,
    };
  }

  // No short period — run a full characterization to gather bounds,
  // population history, and stabilization info.
  const char = characterize(cells, compiled, methuselahGens, {
    populationCap,
  });
  const initialSize = char.initialSize;
  const maxSize = char.maxSize;
  const finalSize = char.finalSize;
  // Detect unbounded growth in two ways:
  //   1. Population cap exceeded (e.g. replicators / large guns).
  //   2. The pattern ran the full observation window without stabilizing
  //      or entering a detected cycle, AND its bounding box has expanded
  //      substantially beyond the initial extent. This catches emitters
  //      like the Gosper gun whose population grows slowly (one glider
  //      per period) but whose spatial footprint expands without bound.
  let unbounded = char.exceededPopulationCap;
  if (
    !unbounded &&
    !char.extinct &&
    char.stabilizedAt == null &&
    char.cyclePeriod == null &&
    char.generations >= methuselahGens &&
    char.bounds &&
    initBB
  ) {
    const grewWide = char.bounds.width >= initBB.width * 3 + 10;
    const grewTall = char.bounds.height >= initBB.height * 3 + 10;
    // Require both spatial AND population growth to flag as unbounded.
    // Methuselahs (like R-pentomino) expand spatially during their
    // chaotic phase but their population stays bounded and eventually
    // settles. Emitters like the Gosper gun grow in both dimensions.
    // The key distinguishing feature of a true emitter (gun) vs. a
    // methuselah is *sustained* growth: an emitter's population keeps
    // climbing right up to the end of observation, so its maximum is
    // reached late and its final population is at (or very near) that
    // maximum. A methuselah's population peaks somewhere in the
    // middle of its chaotic phase and then declines as the dust
    // settles into still lifes and oscillators.
    //
    // Heuristic: require both (a) the peak population to occur in the
    // last quarter of the observation window, and (b) the final
    // population to be ≥ 90% of the peak. This catches guns/puffers
    // while excluding methuselahs like R-pentomino that have already
    // started declining by the end of the window.
    const peakLate = char.maxSizeAt >= char.generations * 0.75;
    const stillNearPeak = char.finalSize >= maxSize * 0.9;
    const popGrew = char.finalSize >= initialSize * 3 + 10 && peakLate && stillNearPeak;
    if ((grewWide || grewTall) && popGrew) {
      unbounded = true;
    }
  }
  // If unbounded growth was detected, mark width/height as -1.
  const maxBounds = unbounded
    ? { width: -1, height: -1 }
    : char.bounds
      ? { width: char.bounds.width, height: char.bounds.height }
      : initBB
        ? { width: initBB.width, height: initBB.height }
        : null;
  if (char.extinct) {
    notes.push(`died at generation ${char.generations}`);
    return {
      category: CATEGORY.MISC,
      period: 0,
      direction: null,
      displacement: null,
      rulesetId,
      maxBounds,
      maxPopulation: maxSize,
      finalPopulation: 0,
      stabilizedAt: char.generations,
      extinct: true,
      unbounded: false,
      notes,
    };
  }
  // Cycle detected after exhaustive period search failed — this is a
  // long-period oscillator or a translating shape we missed. Still useful
  // to record as a methuselah-ish pattern but note the cycle.
  if (char.cyclePeriod != null) {
    notes.push(`cycle detected: period ${char.cyclePeriod} starting at gen ${char.cycleStart}`);
  }
  if (char.stabilizedAt != null) {
    notes.push(`stabilized at generation ${char.stabilizedAt}`);
  }
  if (unbounded) {
    notes.push(`exceeded population cap (${populationCap}); marked unbounded`);
  }
  // If population grew substantially, label as methuselah.
  if (unbounded || maxSize >= initialSize * 3 || maxSize - initialSize >= 20) {
    notes.push(`max population ${maxSize} from initial ${initialSize}`);
    return {
      category: CATEGORY.METHUSELAH,
      period: 0,
      direction: null,
      displacement: null,
      rulesetId,
      maxBounds,
      maxPopulation: maxSize,
      finalPopulation: finalSize,
      stabilizedAt: char.stabilizedAt,
      extinct: false,
      unbounded,
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
    maxBounds,
    maxPopulation: maxSize,
    finalPopulation: finalSize,
    stabilizedAt: char.stabilizedAt,
    extinct: false,
    unbounded,
    notes,
  };
}
