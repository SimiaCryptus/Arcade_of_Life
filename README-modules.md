# Modular Architecture Notes

This document describes the modularization of game rules and patterns,
extracted in preparation for supporting multiple rulesets and a tested
pattern library.

## New modules

### `src/rules/ruleset.js`

Encapsulates cellular automaton rule definitions.

- **`RulesetDef`** — definition shape (id, name, B/S notation, birth/survival arrays, description).
- **`CompiledRuleset`** — pre-compiled lookup tables (`Uint8Array(9)`) for fast birth/survival decisions in the simulation hot path.
- **Built-in rulesets**: `CONWAY` (B3/S23), `HIGHLIFE` (B36/S23), `DAY_NIGHT`, `SEEDS`, `LIFE_WITHOUT_DEATH`, `MAZE`, `REPLICATOR`, `TWO_BY_TWO`.
- **Registry API**: `registerRuleset()`, `getRuleset()`, `listRulesets()`.
- **Notation helpers**: `parseBSNotation()`, `formatBSNotation()`, `rulesetFromNotation()`.
- **Active ruleset**: `getActiveRuleset()`, `setActiveRuleset(id)`.

The simulation does **not** yet consume `getActiveRuleset()` — the current `Simulation.tick()` still has B3/S23 hard-coded for the hot path. The next refactor step will route simulation decisions through `CompiledRuleset.shouldBirth/shouldSurvive`. This module exists now so:

1. Future work has a single place to plug in.
2. Settings UI can list available rulesets.
3. Unit tests cover the rule logic independently of the simulation.

### `src/patterns/library.js`

Centralized pattern catalog with rich metadata.

Each `Pattern` has:

- `id`, `name`, `category` (still_life / oscillator / spaceship / gun / methuselah / puffer / misc)
- `cells` — normalized so `min(x, y) = 0`
- `period`, `direction` (for spaceships)
- `rulesets` — array of compatible ruleset ids, or `['*']` for any
- `description`, `tags`, optional `source`
- `width`, `height` — derived from bounding box

Pattern objects are **frozen** after registration — they're immutable. Use `clonePatternCells(id)` for mutable copies (e.g., for stamping with transforms).

API:

- `registerPattern(def)` — validate + normalize + freeze + insert
- `getPattern(id)`, `clonePatternCells(id)`
- `listPatterns({ category, ruleset, tag })`, `searchPatterns(query)`
- `transformCells(cells, { rotate, flipH, flipV })`
- `normalizeCells(cells)`
- `CATEGORY` enum

### `src/patterns/index.js`

Public re-export module plus back-compat:

```js
import { PATTERN_PRESETS } from './patterns/index.js';
// PATTERN_PRESETS is { [id]: cells[][] }, matching the legacy drawTools.js shape
```

`drawTools.js` now imports from here, removing the duplicated pattern definitions that previously lived inline.

## Tests

Two test modules using plain `node:assert` (no test framework needed):

- `test/patterns/library.test.js`
- `test/rules/ruleset.test.js`
- `test/run-all.js` — convenience runner

Run them:

```bash
node test/run-all.js
# or individually
npm run test:patterns
npm run test:rules
```

Tests verify:

- **Patterns**: registration invariants, metadata completeness, normalization, transforms (rotate/flip identities), category/period correctness, immutability, search/filter.
- **Rulesets**: B/S notation parse/format round-trips, registry behavior, compiled lookup tables, active-ruleset switching.

## Migration notes for existing code

The duplicate pattern definitions in `src/entities/missiles.js` (e.g. `SE_GLIDER`, `LWSS_SE`, `GOSPER_GUN`, `TARGET_PATTERN`, etc.) and `src/main.js` cheats (`GUN` array in `cheats.gosperGun`) **were intentionally not touched** in this pass to keep the refactor isolated and risk-free. They can be migrated incrementally to consume the library:

```js
import { clonePatternCells } from './patterns/index.js';

// Replace inline SE_GLIDER with:
const SE_GLIDER = clonePatternCells('glider');

// Replace inline GOSPER_GUN with:
const GOSPER_GUN = clonePatternCells('gosper_gun');
```

Same for `simulation.js` if any pattern stamping is added there.

## Next steps

1. Route `Simulation.tick()` through `CompiledRuleset` instead of hard-coded B3/S23.
2. Migrate missile pattern constants to use `clonePatternCells()`.
3. Add a "Ruleset" selector in Settings (using `listRulesets()`).
4. Allow patterns to specify multiple compatible rulesets so the pattern picker can filter by active ruleset.
5. Add more test coverage as the new APIs are wired into the rest of the game.
