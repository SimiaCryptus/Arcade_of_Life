/**
 * Exotic rulesets that use non-standard neighborhoods.
 *
 * These rules pair B/S notation with custom Euclidean or anisotropic
 * neighborhoods. Because the neighbor count can far exceed 8, the
 * birth/survival arrays may reference much higher values.
 */

import { registerRuleset } from './ruleset.js';
import { getNeighborhood } from './neighborhoods.js';
// Defensive wrapper: skip registration with a clear warning if the
// referenced neighborhood isn't available yet. This prevents a
// load-order regression from taking down the entire rule system.
function safeRegister(def) {
  if (def.neighborhood && def.neighborhood !== 'moore') {
    const nbhd = getNeighborhood(def.neighborhood);
    if (!nbhd) {
      console.warn(
        `[exoticRulesets] Skipping "${def.id}": neighborhood "${def.neighborhood}" not found.`
      );
      return;
    }
  }
  try {
    registerRuleset(def);
  } catch (e) {
    console.warn(`[exoticRulesets] Failed to register "${def.id}": ${e.message}`);
  }
}

// ── Fractional Euclidean radius rules ──────────────────────────────

/**
 * Conway-on-circle: classic B3/S23 but on the 12-cell r=2.0 neighborhood.
 * Produces softer, more circular wavefronts than vanilla Life.
 */
safeRegister({
  id: 'conway_eucl_2',
  name: 'Conway (r=2.0, 12-cell)',
  notation: 'B3/S23 (r=2)',
  description:
    "Conway's B3/S23 rule on the 12-cell Euclidean r=2.0 " +
    'neighborhood. Patterns evolve with smoother, more circular ' +
    'fronts than standard Life.',
  birth: [3],
  survival: [2, 3],
  neighborhood: 'eucl_2',
});

/**
 * Isotropic Life: large radius, threshold-based birth/survival.
 * Tuned for the 28-cell r=3.0 neighborhood. Behaves like a discrete
 * approximation of a reaction-diffusion system.
 */
safeRegister({
  id: 'isotropic_life',
  name: 'Isotropic Life (r=3)',
  notation: 'B9-12/S8-13 (r=3)',
  description:
    '28-cell r=3.0 Euclidean neighborhood with threshold-based rules. ' +
    'Approximates PDE-like wave propagation; spiral and target ' +
    'patterns emerge naturally.',
  birth: [9, 10, 11, 12],
  survival: [8, 9, 10, 11, 12, 13],
  neighborhood: 'eucl_3',
});

/**
 * Bugs: a classic large-neighborhood rule discovered by Mirek Wójtowicz.
 * Originally defined on a 5x5 range-2 Moore neighborhood (24 cells);
 * we approximate it on r=2.236 (20 cells).
 */
safeRegister({
  id: 'bugs_eucl',
  name: 'Bugs (r=√5)',
  notation: 'B7-8/S4-9 (r=√5)',
  description:
    'Large-neighborhood "Bugs" rule on the 20-cell r=√5 ≈ 2.236 ' +
    'Euclidean neighborhood. Produces bug-like wandering creatures.',
  birth: [7, 8],
  survival: [4, 5, 6, 7, 8, 9],
  neighborhood: 'eucl_2_236',
});

/**
 * Globe: a r=2.6 large-radius rule. Emergent patterns look like
 * cellular blobs that contract and pulse.
 */
safeRegister({
  id: 'globe',
  name: 'Globe (r=2.6)',
  notation: 'B6-9/S5-10 (r=2.6)',
  description:
    '20-cell r=2.6 Euclidean neighborhood. Cellular blob structures ' + 'with pulsing membranes.',
  birth: [6, 7, 8, 9],
  survival: [5, 6, 7, 8, 9, 10],
  neighborhood: 'eucl_2_6',
});

// ── Anisotropic rules ──────────────────────────────────────────────

/**
 * Wind: Conway-like rule on a horizontally-stretched neighborhood.
 * Patterns slide horizontally as if blown by wind.
 */
safeRegister({
  id: 'wind',
  name: 'Wind (horizontal stretch)',
  notation: 'B3/S23 (aniso)',
  description:
    'B3/S23 on a horizontally-stretched elliptical neighborhood. ' +
    'Emergent patterns drift and elongate horizontally.',
  birth: [3],
  survival: [2, 3],
  neighborhood: 'aniso_horiz_stretch',
});

/**
 * Gravity: vertically-stretched neighborhood. Patterns flow down.
 */
safeRegister({
  id: 'gravity',
  name: 'Gravity (vertical stretch)',
  notation: 'B3/S23 (aniso)',
  description:
    'B3/S23 on a vertically-stretched neighborhood. Patterns ' +
    'naturally elongate vertically and drift downward.',
  birth: [3],
  survival: [2, 3],
  neighborhood: 'aniso_vert_stretch',
});

/**
 * Current: diagonal shear flow.
 */
safeRegister({
  id: 'current',
  name: 'Current (sheared)',
  notation: 'B3/S23 (shear)',
  description:
    'B3/S23 on a sheared neighborhood (k=0.5). Emergent structures ' +
    'drift diagonally like a current.',
  birth: [3],
  survival: [2, 3],
  neighborhood: 'aniso_shear',
});

/**
 * Diagonal Drift: rotated elliptical neighborhood at 45°.
 */
safeRegister({
  id: 'diagonal_drift',
  name: 'Diagonal Drift (rot 45°)',
  notation: 'B3-4/S3-5 (aniso)',
  description:
    'Threshold rule on an ellipse rotated 45° and elongated along ' +
    'that diagonal. Spiral/diagonal flow fields.',
  birth: [3, 4],
  survival: [3, 4, 5],
  neighborhood: 'aniso_rot45_stretch',
});
