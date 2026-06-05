# LifeWiki Importer

Imports `.rle` and `.cells` files from the LifeWiki dataset into the
project's pattern library. Missing metadata (category, period,
direction) is inferred by running the pattern under the appropriate
Life ruleset and observing its behavior.

## Quick start

```bash
node src/patterns/lifewikiImporter.js \
  --input /home/andrew/Downloads/all \
  --output src/patterns/lifewiki.generated.json \
  --verbose
```

A summary is printed at the end, e.g.:

```
Done in 73.2s — imported 1842, skipped 64 (40 large, 12 empty, 12 parse).
By category:
  still_life: 712
  oscillator: 633
  spaceship: 211
  methuselah: 88
  misc: 198
Wrote 1842 patterns to src/patterns/lifewiki.generated.json
```

## How inference works

For each parsed pattern we run the following checks under the
declared rule (defaults to Conway's Game of Life if no rule is
provided):

1. **Still life** — pattern is unchanged after one generation.
2. **Oscillator / Spaceship** — `findPeriod()` looks for the smallest
   period in `[1..maxPeriod]` under which the pattern returns to its
   initial shape. Zero displacement ⇒ oscillator; non-zero ⇒
   spaceship (direction inferred from `(dx, dy)`).
3. **Methuselah** — if no short period is found but the population
   grows by ≥3× (or by ≥20 cells) within `methuselahGens` ticks, the
   pattern is labelled a methuselah.
4. **Misc** — anything else (patterns that die, very long-period
   structures we didn't catch, etc.).

## Tunable limits

- `--max-period`        Period search ceiling (default 60).
- `--methuselah-gens`   Methuselah observation window (default 200).
- `--max-cells`         Skip large patterns above this live-cell count
                        (default 5000) — prevents pathological CPU use.
- `--max-dim`           Skip patterns whose bounding box exceeds this
                        width or height (default 400).

## Loading the generated library at runtime

```js
import { loadGeneratedLibrary } from './src/patterns/lifewikiImporter.js';
const n = await loadGeneratedLibrary(
  './src/patterns/lifewiki.generated.json'
);
console.log(`Registered ${n} imported patterns`);
```

Patterns are registered into the same registry used by built-in
presets and become available to `listPatterns()`, `getPattern()`,
`searchPatterns()`, etc.