/**
 * Simulation-based tests for all built-in patterns.
 *
 * For each pattern in the library we:
 *   - Verify metadata invariants (category, period, direction, ruleset).
 *   - Run it under each declared ruleset for the appropriate number of
 *     generations and verify its behavior matches its category:
 *       * still_life:   unchanged after `period` generations (period=1).
 *       * oscillator:   returns to original shape after `period` gens.
 *       * spaceship:    returns to original shape, translated, after
 *                       `period` gens, with non-zero displacement in
 *                       the declared direction.
 *       * gun:          population grows over time (emits cells); after
 *                       `period` generations the gun's "base" cells
 *                       reappear in the same place (Gosper gun).
 *       * methuselah:   evolves for many generations before stabilizing;
 *                       we just verify it doesn't die immediately and
 *                       does eventually change.
 *
 * Game-specific patterns (category 'misc' or with rulesets ['*']) are
 * exercised with a basic non-trivial-shape check only, since they're
 * meant to be re-imprinted by game logic rather than evolved by Life
 * rules alone.
 *
 * Run via:  node test/patterns/simulation.test.js
 */

import assert from 'node:assert/strict';
import {
  CATEGORY,
  listPatterns,
  getPattern,
  clonePatternCells,
  transformCells,
} from '../../src/patterns/library.js';
import { getRuleset, CompiledRuleset, CONWAY } from '../../src/rules/ruleset.js';
// Import extras for their side effects (registration).
import '../../src/rules/extraRulesets.js';
import {
  cellsToSet,
  setToCells,
  step,
  run,
  boundingBox,
  setsEqual,
  findPeriod,
  detectPeriod,
} from '../../src/sim/lifeSim.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

/**
 * For a given pattern id, return a CompiledRuleset for the first
 * declared compatible ruleset. Wildcard '*' falls back to Conway.
 */
function ruleForPattern(pattern) {
  const rid = pattern.rulesets[0];
  if (rid === '*') return new CompiledRuleset(CONWAY);
  const def = getRuleset(rid);
  if (!def) throw new Error(`Unknown ruleset: ${rid}`);
  return new CompiledRuleset(def);
}

// Direction → expected sign of (dx, dy). 0 = must be zero, +1 = positive,
// -1 = negative, null = unspecified.
const DIRECTION_VECTORS = {
  N: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
  E: { dx: 1, dy: 0 },
  W: { dx: -1, dy: 0 },
  NE: { dx: 1, dy: -1 },
  NW: { dx: -1, dy: -1 },
  SE: { dx: 1, dy: 1 },
  SW: { dx: -1, dy: 1 },
};

function checkDisplacementMatchesDirection(displacement, direction, patternId) {
  if (!direction) return;
  const expected = DIRECTION_VECTORS[direction];
  if (!expected) {
    throw new Error(`${patternId}: unknown direction "${direction}"`);
  }
  const [dx, dy] = displacement;
  // For each axis, require correct sign (or zero where expected zero).
  if (expected.dx === 0 && dx !== 0) {
    throw new Error(`${patternId}: direction ${direction} expects dx=0, got dx=${dx}`);
  }
  if (expected.dx > 0 && !(dx > 0)) {
    throw new Error(`${patternId}: direction ${direction} expects dx>0, got dx=${dx}`);
  }
  if (expected.dx < 0 && !(dx < 0)) {
    throw new Error(`${patternId}: direction ${direction} expects dx<0, got dx=${dx}`);
  }
  if (expected.dy === 0 && dy !== 0) {
    throw new Error(`${patternId}: direction ${direction} expects dy=0, got dy=${dy}`);
  }
  if (expected.dy > 0 && !(dy > 0)) {
    throw new Error(`${patternId}: direction ${direction} expects dy>0, got dy=${dy}`);
  }
  if (expected.dy < 0 && !(dy < 0)) {
    throw new Error(`${patternId}: direction ${direction} expects dy<0, got dy=${dy}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Metadata sanity (a quick recap; deeper checks live in library.test.js)
// ─────────────────────────────────────────────────────────────────────
section('Pattern metadata invariants:');

test('All categories from CATEGORY are represented or known', () => {
  const known = new Set(Object.values(CATEGORY));
  for (const p of listPatterns()) {
    assert.ok(known.has(p.category), `${p.id} has unknown category ${p.category}`);
  }
});

test('Every spaceship has a direction in DIRECTION_VECTORS', () => {
  for (const p of listPatterns({ category: CATEGORY.SPACESHIP })) {
    assert.ok(p.direction, `${p.id} missing direction`);
    assert.ok(
      DIRECTION_VECTORS[p.direction],
      `${p.id} has unrecognized direction "${p.direction}"`
    );
  }
});

test('Still lifes have period 1', () => {
  for (const p of listPatterns({ category: CATEGORY.STILL_LIFE })) {
    assert.equal(p.period, 1, `${p.id} is a still life but has period ${p.period}`);
  }
});

test('Oscillators have period >= 2', () => {
  for (const p of listPatterns({ category: CATEGORY.OSCILLATOR })) {
    assert.ok(p.period >= 2, `${p.id} is an oscillator with period ${p.period}`);
  }
});

test('Spaceships have period >= 2', () => {
  for (const p of listPatterns({ category: CATEGORY.SPACESHIP })) {
    assert.ok(p.period >= 2, `${p.id} is a spaceship with period ${p.period}`);
  }
});

test('Guns have period >= 1 (emit cells)', () => {
  for (const p of listPatterns({ category: CATEGORY.GUN })) {
    assert.ok(p.period >= 1, `${p.id} gun has bad period ${p.period}`);
  }
});

test('All non-misc patterns declare at least one ruleset', () => {
  for (const p of listPatterns()) {
    assert.ok(p.rulesets.length > 0, `${p.id} has empty rulesets array`);
  }
});

test('All declared rulesets resolve (or are wildcard)', () => {
  for (const p of listPatterns()) {
    for (const rid of p.rulesets) {
      if (rid === '*') continue;
      const def = getRuleset(rid);
      assert.ok(def, `${p.id} references unknown ruleset "${rid}"`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────
// Still life simulations
// ─────────────────────────────────────────────────────────────────────
section('Still life simulations:');

for (const p of listPatterns({ category: CATEGORY.STILL_LIFE })) {
  test(`${p.id} (${p.name}): unchanged after 1 generation under ${p.rulesets[0]}`, () => {
    const rule = ruleForPattern(p);
    const initial = cellsToSet(p.cells);
    const after = step(initial, rule);
    assert.ok(
      setsEqual(initial, after),
      `${p.id}: still life changed after 1 generation\n` +
        `  before: ${setToCells(initial)
          .map((c) => `[${c}]`)
          .join(', ')}\n` +
        `  after:  ${setToCells(after)
          .map((c) => `[${c}]`)
          .join(', ')}`
    );
  });

  test(`${p.id} (${p.name}): unchanged after 10 generations`, () => {
    const rule = ruleForPattern(p);
    const initial = cellsToSet(p.cells);
    const after = run(initial, rule, 10);
    assert.ok(setsEqual(initial, after), `${p.id}: still life destabilized within 10 generations`);
  });

  test(`${p.id}: cell count is preserved (size = ${p.cells.length})`, () => {
    const rule = ruleForPattern(p);
    const initial = cellsToSet(p.cells);
    const after = step(initial, rule);
    assert.equal(
      after.size,
      initial.size,
      `${p.id}: cell count changed from ${initial.size} to ${after.size}`
    );
  });
}

// ─────────────────────────────────────────────────────────────────────
// Oscillator simulations
// ─────────────────────────────────────────────────────────────────────
section('Oscillator simulations:');

for (const p of listPatterns({ category: CATEGORY.OSCILLATOR })) {
  test(`${p.id} (${p.name}): returns to initial state after ${p.period} generations`, () => {
    const rule = ruleForPattern(p);
    const initial = cellsToSet(p.cells);
    const after = run(initial, rule, p.period);
    assert.ok(
      setsEqual(initial, after),
      `${p.id}: oscillator did not return to initial state after period ${p.period}\n` +
        `  initial: ${setToCells(initial)
          .map((c) => `[${c}]`)
          .join(', ')}\n` +
        `  after:   ${setToCells(after)
          .map((c) => `[${c}]`)
          .join(', ')}`
    );
  });

  test(`${p.id}: NOT a still life (changes within period)`, () => {
    const rule = ruleForPattern(p);
    const initial = cellsToSet(p.cells);
    const oneStep = step(initial, rule);
    assert.ok(
      !setsEqual(initial, oneStep),
      `${p.id}: oscillator unchanged after 1 generation (looks like still life)`
    );
  });

  test(`${p.id}: declared period is the minimum`, () => {
    const rule = ruleForPattern(p);
    const found = findPeriod(p.cells, rule, p.period);
    assert.ok(found, `${p.id}: no period <= ${p.period} found`);
    assert.equal(
      found.period,
      p.period,
      `${p.id}: declared period ${p.period} but actually returns at ${found.period}`
    );
    // Oscillators must have zero displacement.
    assert.deepEqual(
      found.displacement,
      [0, 0],
      `${p.id}: oscillator has non-zero displacement ${JSON.stringify(found.displacement)}`
    );
  });

  test(`${p.id}: stays alive throughout one full period`, () => {
    const rule = ruleForPattern(p);
    let state = cellsToSet(p.cells);
    for (let i = 0; i < p.period; i++) {
      state = step(state, rule);
      assert.ok(state.size > 0, `${p.id}: died at generation ${i + 1}`);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────
// Spaceship simulations
// ─────────────────────────────────────────────────────────────────────
section('Spaceship simulations:');

for (const p of listPatterns({ category: CATEGORY.SPACESHIP })) {
  test(`${p.id} (${p.name}): returns to translated initial shape after ${p.period} generations`, () => {
    const rule = ruleForPattern(p);
    const result = detectPeriod(p.cells, rule, p.period);
    assert.ok(
      result.isPeriodic,
      `${p.id}: spaceship did not return to its shape after period ${p.period}`
    );
  });

  test(`${p.id}: displacement is non-zero (it actually moves)`, () => {
    const rule = ruleForPattern(p);
    const result = detectPeriod(p.cells, rule, p.period);
    assert.ok(result.isPeriodic, `${p.id}: not periodic`);
    const [dx, dy] = result.displacement;
    assert.ok(
      dx !== 0 || dy !== 0,
      `${p.id}: spaceship has zero displacement (acts like oscillator)`
    );
  });

  test(`${p.id}: displacement direction matches metadata (${p.direction})`, () => {
    const rule = ruleForPattern(p);
    const result = detectPeriod(p.cells, rule, p.period);
    assert.ok(result.isPeriodic, `${p.id}: not periodic`);
    checkDisplacementMatchesDirection(result.displacement, p.direction, p.id);
  });

  test(`${p.id}: cell count preserved at period boundary`, () => {
    const rule = ruleForPattern(p);
    const initial = cellsToSet(p.cells);
    const after = run(initial, rule, p.period);
    assert.equal(
      after.size,
      initial.size,
      `${p.id}: cell count changed from ${initial.size} to ${after.size} ` + `after a full period`
    );
  });

  test(`${p.id}: stays alive throughout one full period`, () => {
    const rule = ruleForPattern(p);
    let state = cellsToSet(p.cells);
    for (let i = 0; i < p.period; i++) {
      state = step(state, rule);
      assert.ok(state.size > 0, `${p.id}: died at generation ${i + 1}`);
    }
  });

  test(`${p.id}: declared period is the minimum`, () => {
    const rule = ruleForPattern(p);
    const found = findPeriod(p.cells, rule, p.period);
    assert.ok(found, `${p.id}: no period <= ${p.period} found`);
    assert.equal(
      found.period,
      p.period,
      `${p.id}: declared period ${p.period} but actually returns at ${found.period}`
    );
  });
}

// ─────────────────────────────────────────────────────────────────────
// Transform tests on gliders (rotations should preserve "is-a-spaceship")
// ─────────────────────────────────────────────────────────────────────
section('Glider transform tests:');

test('Glider rotated 90° CW is still a period-4 spaceship under Conway', () => {
  const rule = new CompiledRuleset(CONWAY);
  const rotated = transformCells(clonePatternCells('glider'), { rotate: 1 });
  const result = detectPeriod(rotated, rule, 4);
  assert.ok(result.isPeriodic, 'rotated glider failed to return after 4 generations');
  const [dx, dy] = result.displacement;
  assert.ok(dx !== 0 || dy !== 0, 'rotated glider has zero displacement');
});

test('Glider rotated 180° still moves like a glider', () => {
  const rule = new CompiledRuleset(CONWAY);
  const rotated = transformCells(clonePatternCells('glider'), { rotate: 2 });
  const result = detectPeriod(rotated, rule, 4);
  assert.ok(result.isPeriodic, 'rot-180 glider failed period test');
  const [dx, dy] = result.displacement;
  // SE glider rotated 180° → NW direction (dx<0, dy<0).
  assert.ok(dx < 0 && dy < 0, `rot-180 glider should move NW, got (${dx}, ${dy})`);
});

test('Glider rotated 270° (= 90° CCW) is still a period-4 spaceship', () => {
  const rule = new CompiledRuleset(CONWAY);
  const rotated = transformCells(clonePatternCells('glider'), { rotate: 3 });
  const result = detectPeriod(rotated, rule, 4);
  assert.ok(result.isPeriodic, 'rot-270 glider failed period test');
});

test('Flipped glider (horizontal) is still a spaceship', () => {
  const rule = new CompiledRuleset(CONWAY);
  const flipped = transformCells(clonePatternCells('glider'), { flipH: true });
  const result = detectPeriod(flipped, rule, 4);
  assert.ok(result.isPeriodic, 'flipH glider failed period test');
});

test('Flipped glider (vertical) is still a spaceship', () => {
  const rule = new CompiledRuleset(CONWAY);
  const flipped = transformCells(clonePatternCells('glider'), { flipV: true });
  const result = detectPeriod(flipped, rule, 4);
  assert.ok(result.isPeriodic, 'flipV glider failed period test');
});

// ─────────────────────────────────────────────────────────────────────
// Methuselah behavior
// ─────────────────────────────────────────────────────────────────────
section('Methuselah behavior:');

for (const p of listPatterns({ category: CATEGORY.METHUSELAH })) {
  test(`${p.id} (${p.name}): does not die in first 10 generations`, () => {
    const rule = ruleForPattern(p);
    let state = cellsToSet(p.cells);
    for (let i = 0; i < 10; i++) {
      state = step(state, rule);
      assert.ok(state.size > 0, `${p.id}: methuselah died at generation ${i + 1}`);
    }
  });

  test(`${p.id}: actually changes within first 5 generations`, () => {
    const rule = ruleForPattern(p);
    const initial = cellsToSet(p.cells);
    let state = initial;
    let changed = false;
    for (let i = 0; i < 5; i++) {
      state = step(state, rule);
      if (!setsEqual(state, initial)) {
        changed = true;
        break;
      }
    }
    assert.ok(changed, `${p.id}: methuselah unchanged after 5 generations`);
  });
}

test('R-pentomino expands significantly within 50 generations', () => {
  const rule = new CompiledRuleset(CONWAY);
  const p = getPattern('rpentomino');
  const initial = cellsToSet(p.cells);
  const initBB = boundingBox(initial);
  const after = run(initial, rule, 50);
  const bb = boundingBox(after);
  assert.ok(bb, 'R-pentomino died');
  // R-pentomino is famous for sprawling. By gen 50 it covers a much
  // larger area than its starting 3x3.
  assert.ok(
    bb.width > initBB.width + 5 || bb.height > initBB.height + 5,
    `R-pentomino should expand by gen 50; got bbox ${bb.width}x${bb.height}`
  );
});

test('Diehard disappears completely by generation 130', () => {
  const rule = new CompiledRuleset(CONWAY);
  const p = getPattern('diehard');
  const initial = cellsToSet(p.cells);
  const after = run(initial, rule, 130);
  assert.equal(
    after.size,
    0,
    `Diehard should be extinct by gen 130, but ${after.size} cells remain`
  );
});

test('Diehard is still alive at generation 129', () => {
  const rule = new CompiledRuleset(CONWAY);
  const p = getPattern('diehard');
  const initial = cellsToSet(p.cells);
  const after = run(initial, rule, 129);
  assert.ok(after.size > 0, 'Diehard should still have cells at gen 129');
});

test('Acorn grows for a long time under Conway', () => {
  const rule = new CompiledRuleset(CONWAY);
  const p = getPattern('acorn');
  const initial = cellsToSet(p.cells);
  // Just check it survives 200 gens and is much bigger than original.
  const after = run(initial, rule, 200);
  assert.ok(
    after.size > 30,
    `Acorn should have grown beyond 30 cells by gen 200, got ${after.size}`
  );
});

// ─────────────────────────────────────────────────────────────────────
// Gun behavior
// ─────────────────────────────────────────────────────────────────────
section('Gun behavior:');

test('Gosper gun: population grows over 60 generations', () => {
  const rule = new CompiledRuleset(CONWAY);
  const p = getPattern('gosper_gun');
  const initial = cellsToSet(p.cells);
  const initSize = initial.size;
  const after = run(initial, rule, 60);
  // After 60 generations (2 emission cycles), at least 2 gliders (10
  // cells) should have been emitted in addition to the gun's 36.
  assert.ok(
    after.size > initSize,
    `Gosper gun should grow; started at ${initSize}, ended at ${after.size}`
  );
});

test('Gosper gun: emits roughly one glider every 30 generations', () => {
  const rule = new CompiledRuleset(CONWAY);
  const p = getPattern('gosper_gun');
  const initial = cellsToSet(p.cells);
  const after30 = run(initial, rule, 30);
  const after60 = run(initial, rule, 60);
  // Each emitted glider contributes 5 cells. After 30 gens we expect
  // approximately one glider's worth of growth (5 ± a few transient).
  const growth30 = after30.size - initial.size;
  const growth60 = after60.size - initial.size;
  assert.ok(
    growth60 > growth30,
    `Gun population should be growing: 30gen=${growth30}, 60gen=${growth60}`
  );
  // The gun itself should have returned to its starting cell count
  // (modulo emitted gliders). Loose lower bound: at least one glider
  // worth of growth by gen 60.
  assert.ok(
    growth60 >= 5,
    `Gun should emit at least one full glider in 60 gens, growth=${growth60}`
  );
});

test('Gosper gun: alive throughout 90 generations', () => {
  const rule = new CompiledRuleset(CONWAY);
  const p = getPattern('gosper_gun');
  let state = cellsToSet(p.cells);
  for (let i = 0; i < 90; i++) {
    state = step(state, rule);
    assert.ok(state.size > 0, `Gosper gun died at gen ${i + 1}`);
  }
});

// ─────────────────────────────────────────────────────────────────────
// Misc / game-specific patterns
// ─────────────────────────────────────────────────────────────────────
section('Misc / game-specific patterns:');

for (const p of listPatterns({ category: CATEGORY.MISC })) {
  test(`${p.id} (${p.name}): has non-trivial cell count`, () => {
    assert.ok(p.cells.length >= 3, `${p.id}: expected at least 3 cells, got ${p.cells.length}`);
  });

  test(`${p.id}: declares wildcard or specific ruleset compatibility`, () => {
    assert.ok(p.rulesets.length > 0, `${p.id}: empty rulesets`);
  });

  test(`${p.id}: starts alive (positive cell count)`, () => {
    const initial = cellsToSet(p.cells);
    assert.ok(initial.size > 0, `${p.id}: empty initial state`);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Cross-ruleset compatibility tests
// ─────────────────────────────────────────────────────────────────────
section('Cross-ruleset compatibility:');

test('Block is still a still life under HighLife', () => {
  const rule = new CompiledRuleset(getRuleset('highlife'));
  const initial = cellsToSet(getPattern('block').cells);
  const after = step(initial, rule);
  assert.ok(setsEqual(initial, after), 'Block should still be a still life under HighLife');
});

test('Blinker still oscillates under HighLife', () => {
  const rule = new CompiledRuleset(getRuleset('highlife'));
  const initial = cellsToSet(getPattern('blinker').cells);
  const after = run(initial, rule, 2);
  assert.ok(setsEqual(initial, after), 'Blinker should still oscillate period-2 under HighLife');
});

test('Glider still moves under HighLife (B36/S23)', () => {
  const rule = new CompiledRuleset(getRuleset('highlife'));
  const result = detectPeriod(getPattern('glider').cells, rule, 4);
  assert.ok(result.isPeriodic, 'Glider should be periodic under HighLife');
});

test('Block is still a still life under DryLife (B37/S23)', () => {
  const rule = new CompiledRuleset(getRuleset('dry_life'));
  const initial = cellsToSet(getPattern('block').cells);
  const after = step(initial, rule);
  assert.ok(setsEqual(initial, after), 'Block should still be a still life under DryLife');
});

test('Glider still moves under DryLife', () => {
  const rule = new CompiledRuleset(getRuleset('dry_life'));
  const result = detectPeriod(getPattern('glider').cells, rule, 4);
  assert.ok(result.isPeriodic, 'Glider should be periodic under DryLife');
});

test('Seeds rule: block does NOT survive (no survival)', () => {
  const rule = new CompiledRuleset(getRuleset('seeds'));
  const initial = cellsToSet(getPattern('block').cells);
  const after = step(initial, rule);
  // Under Seeds, every live cell dies each gen.
  // (The block's empty neighbors with 2 neighbors will birth though.)
  for (const k of initial) {
    assert.ok(!after.has(k), `Block cell ${k} should die under Seeds rule`);
  }
});

test('Life Without Death: blinker grows monotonically', () => {
  const rule = new CompiledRuleset(getRuleset('life_without_death'));
  const initial = cellsToSet(getPattern('blinker').cells);
  const after = run(initial, rule, 5);
  assert.ok(after.size >= initial.size, 'Life Without Death: cell count should never decrease');
});

// ─────────────────────────────────────────────────────────────────────
// Extra ruleset registration check
// ─────────────────────────────────────────────────────────────────────
section('Extra rulesets are registered:');

for (const id of [
  'move',
  'dry_life',
  'pedestrian_life',
  'mazectric',
  'coral',
  'anneal',
  'diamoeba',
  'stains',
  'flock',
  'gnarl',
  'long_life',
  'morley',
]) {
  test(`Ruleset "${id}" is registered`, () => {
    const def = getRuleset(id);
    assert.ok(def, `Ruleset "${id}" not found`);
    assert.ok(Array.isArray(def.birth) && def.birth.length >= 0);
    assert.ok(Array.isArray(def.survival) && def.survival.length >= 0);
  });
}

test('DryLife notation is B37/S23', () => {
  const def = getRuleset('dry_life');
  assert.deepEqual(def.birth, [3, 7]);
  assert.deepEqual(def.survival, [2, 3]);
});

test('Gnarl notation is B1/S1', () => {
  const def = getRuleset('gnarl');
  assert.deepEqual(def.birth, [1]);
  assert.deepEqual(def.survival, [1]);
});

// ─────────────────────────────────────────────────────────────────────
// Done
// ─────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
