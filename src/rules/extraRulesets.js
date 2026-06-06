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
// ── HexLife rulesets (6-neighbor hexagonal) ─────────────────────────
/**
 * Classic HexLife: B2/S34.
 * Discovered by Carter Bays. Sustains gliders and oscillators on hex grid.
 */
export const HEXLIFE = {
  id: 'hexlife',
  name: 'HexLife (B2/S34)',
  notation: 'B2/S34 hex',
  description:
    "Carter Bays' canonical HexLife rule on the 6-neighbor hexagonal " +
    'grid. Birth on 2 neighbors, survival on 3 or 4. Supports gliders ' +
    'and complex emergent dynamics on the isotropic hex lattice.',
  birth: [2],
  survival: [3, 4],
  neighborhood: 'hex_6',
};
/**
 * HexLife variant: B24/S35.
 */
export const HEX_24_35 = {
  id: 'hex_24_35',
  name: 'Hex B24/S35',
  notation: 'B24/S35 hex',
  description:
    'Hexagonal variant with broader birth/survival. Produces more ' +
    'persistent, ferromagnet-like dynamics with slow domain growth.',
  birth: [2, 4],
  survival: [3, 5],
  neighborhood: 'hex_6',
};
/**
 * Hex Replicator: B135/S135.
 */
export const HEX_REPLICATOR = {
  id: 'hex_replicator',
  name: 'Hex Replicator',
  notation: 'B135/S135 hex',
  description:
    "Hex analogue of Fredkin's replicator. Patterns replicate themselves " +
    'across the hex lattice in fractal-like cascades.',
  birth: [1, 3, 5],
  survival: [1, 3, 5],
  neighborhood: 'hex_6',
};
/**
 * Hex Snowflakes: B23/S2.
 * Forms intricate dendritic patterns reminiscent of snowflakes.
 */
export const HEX_SNOWFLAKES = {
  id: 'hex_snowflakes',
  name: 'Hex Snowflakes',
  notation: 'B23/S2 hex',
  description:
    'Forms dendritic, snowflake-like growth patterns. Cells need ' +
    'exactly 2 neighbors to survive, creating delicate filaments.',
  birth: [2, 3],
  survival: [2],
  neighborhood: 'hex_6',
};
/**
 * Hex Maze: B25/S1234.
 */
export const HEX_MAZE = {
  id: 'hex_maze',
  name: 'Hex Maze',
  notation: 'B25/S1234 hex',
  description:
    'Hexagonal maze rule. Builds long, winding corridors with ' +
    'tri-junction intersections unique to hex topology.',
  birth: [2, 5],
  survival: [1, 2, 3, 4],
  neighborhood: 'hex_6',
};
// ── TriLife rulesets (12-neighbor triangular) ───────────────────────
/**
 * Classic TriLife: B45/S456.
 * One of the canonical rules on the 12-neighbor triangular grid.
 */
export const TRILIFE = {
  id: 'trilife',
  name: 'TriLife (B45/S456)',
  notation: 'B45/S456 tri',
  description:
    'Canonical TriLife on the 12-neighbor triangular grid. ' +
    'Birth on 4-5 neighbors; survive on 4-6. Sustains gliders and ' +
    'oscillators with fluid-like emergent flow patterns.',
  birth: [4, 5],
  survival: [4, 5, 6],
  neighborhood: 'tri_12',
};
/**
 * TriLife variant: B4/S345.
 */
export const TRI_4_345 = {
  id: 'tri_4_345',
  name: 'Tri B4/S345',
  notation: 'B4/S345 tri',
  description:
    'Sparser triangular variant. Patterns form lacy crystalline ' +
    'structures that propagate slowly.',
  birth: [4],
  survival: [3, 4, 5],
  neighborhood: 'tri_12',
};
/**
 * Tri Mazectric: B35/S2345.
 */
export const TRI_MAZE = {
  id: 'tri_maze',
  name: 'Tri Maze',
  notation: 'B35/S2345 tri',
  description:
    'Maze-building rule on the triangular grid. Forms intricate ' +
    'three-way junction networks impossible on square grids.',
  birth: [3, 5],
  survival: [2, 3, 4, 5],
  neighborhood: 'tri_12',
};
/**
 * Tri Coral: B5/S567.
 */
export const TRI_CORAL = {
  id: 'tri_coral',
  name: 'Tri Coral',
  notation: 'B5/S567 tri',
  description:
    'Slow-growing coral-like accretion on the triangular grid. ' +
    'Produces dense, branching fractal structures.',
  birth: [5],
  survival: [5, 6, 7],
  neighborhood: 'tri_12',
};
/**
 * Tri 3-Edge Life: B2/S12 on edge-only neighborhood.
 */
export const TRI_EDGE = {
  id: 'tri_edge',
  name: 'Tri Edge (B2/S12)',
  notation: 'B2/S12 tri-edge',
  description:
    'Triangular grid with only 3 edge neighbors. Sparse dynamics ' +
    'producing flowing, dendritic patterns.',
  birth: [2],
  survival: [1, 2],
  neighborhood: 'tri_3',
};
registerRuleset(HEXLIFE);
registerRuleset(HEX_24_35);
registerRuleset(HEX_REPLICATOR);
registerRuleset(HEX_SNOWFLAKES);
registerRuleset(HEX_MAZE);
registerRuleset(TRILIFE);
registerRuleset(TRI_4_345);
registerRuleset(TRI_MAZE);
registerRuleset(TRI_CORAL);
registerRuleset(TRI_EDGE);
