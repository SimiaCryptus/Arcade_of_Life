/**
 * Additional B/S rulesets beyond the built-ins in ruleset.js.
 *
 * These are registered on import. They provide variety for pattern
 * testing and gameplay experimentation. Many of these are well-known
 * outer-totalistic rules from the cellular automaton literature.
 */

import { registerRuleset } from './ruleset.js';

/**
 * Move: B368/S245. A rule supporting spaceships and a glider gun.
 */
export const MOVE = {
  id: 'move',
  name: 'Move',
  notation: 'B368/S245',
  description:
    'Stable rule with naturally-occurring spaceships and a glider gun. ' +
    'Patterns settle into orderly structures.',
  birth: [3, 6, 8],
  survival: [2, 4, 5],
};

/**
 * DryLife: B37/S23. A close cousin of Conway with an extra birth rule.
 */
export const DRY_LIFE = {
  id: 'dry_life',
  name: 'DryLife',
  notation: 'B37/S23',
  description:
    'Like Conway but with an extra birth at 7 neighbors. Most Conway ' +
    'patterns behave similarly, but new still lifes and oscillators emerge.',
  birth: [3, 7],
  survival: [2, 3],
};

/**
 * Pedestrian Life: B38/S23. Another Conway variant.
 */
export const PEDESTRIAN_LIFE = {
  id: 'pedestrian_life',
  name: 'Pedestrian Life',
  notation: 'B38/S23',
  description:
    'Conway variant with extra birth at 8 neighbors. Many natural ' + 'spaceships and oscillators.',
  birth: [3, 8],
  survival: [2, 3],
};

/**
 * Mazectric: B3/S1234. Forms maze corridors that are thinner than Maze.
 */
export const MAZECTRIC = {
  id: 'mazectric',
  name: 'Mazectric',
  notation: 'B3/S1234',
  description: 'Like Maze but corridors are thinner and more electric-looking.',
  birth: [3],
  survival: [1, 2, 3, 4],
};

/**
 * Coral: B3/S45678. Slow-growing coral-like structures.
 */
export const CORAL = {
  id: 'coral',
  name: 'Coral',
  notation: 'B3/S45678',
  description:
    'Slow-growing patterns that form coral-like fractal structures. ' +
    'Cells need many neighbors to survive.',
  birth: [3],
  survival: [4, 5, 6, 7, 8],
};

/**
 * Anneal: B4678/S35678. Approximates the majority rule (cells smooth out).
 */
export const ANNEAL = {
  id: 'anneal',
  name: 'Anneal',
  notation: 'B4678/S35678',
  description:
    'Approximation of majority rule. Regions of high or low density ' +
    'stabilize into uniform blobs over time.',
  birth: [4, 6, 7, 8],
  survival: [3, 5, 6, 7, 8],
};

/**
 * Diamoeba: B35678/S5678. Diamond-shaped blobs that grow and merge.
 */
export const DIAMOEBA = {
  id: 'diamoeba',
  name: 'Diamoeba',
  notation: 'B35678/S5678',
  description: 'Forms diamond-shaped amoeba-like blobs that grow and merge.',
  birth: [3, 5, 6, 7, 8],
  survival: [5, 6, 7, 8],
};

/**
 * Stains: B3678/S235678. Stable stain-like patches.
 */
export const STAINS = {
  id: 'stains',
  name: 'Stains',
  notation: 'B3678/S235678',
  description: 'Most patterns stabilize into static "stain"-like patches.',
  birth: [3, 6, 7, 8],
  survival: [2, 3, 5, 6, 7, 8],
};

/**
 * Flock: B3/S12. Small, sparse, mobile patches.
 */
export const FLOCK = {
  id: 'flock',
  name: 'Flock',
  notation: 'B3/S12',
  description: 'Patterns form small sparse mobile patches. Few survivors per tick.',
  birth: [3],
  survival: [1, 2],
};

/**
 * Gnarl: B1/S1. Explosive single-cell birth/survival rule.
 */
export const GNARL = {
  id: 'gnarl',
  name: 'Gnarl',
  notation: 'B1/S1',
  description:
    'Single-neighbor birth and survival. Any seed explodes into a ' +
    'gnarled, ever-growing pattern.',
  birth: [1],
  survival: [1],
};

/**
 * Long Life: B345/S5. Persistent slow-evolving patterns.
 */
export const LONG_LIFE = {
  id: 'long_life',
  name: 'Long Life',
  notation: 'B345/S5',
  description: 'Most patterns are very long-lived; oscillators are common.',
  birth: [3, 4, 5],
  survival: [5],
};

/**
 * Morley (Move-variant alias): B368/S245 (same notation as Move; both
 * names are widely used). We register both ids so either lookup works.
 */
export const MORLEY = {
  id: 'morley',
  name: 'Morley',
  notation: 'B368/S245',
  description: 'Alias for Move. Stephen Morley discovered glider guns in this rule.',
  birth: [3, 6, 8],
  survival: [2, 4, 5],
};

// Register all on import.
registerRuleset(MOVE);
registerRuleset(DRY_LIFE);
registerRuleset(PEDESTRIAN_LIFE);
registerRuleset(MAZECTRIC);
registerRuleset(CORAL);
registerRuleset(ANNEAL);
registerRuleset(DIAMOEBA);
registerRuleset(STAINS);
registerRuleset(FLOCK);
registerRuleset(GNARL);
registerRuleset(LONG_LIFE);
registerRuleset(MORLEY);
