/**
 * Unit tests for the pattern library.
 *
 * These tests use plain Node assertions (no test framework) so they can
 * be run directly via `node test/patterns/library.test.js`. They verify
 * pattern registration, metadata invariants, normalization, transforms,
 * and a sample of known patterns.
 */

import assert from 'node:assert/strict';
import {
  CATEGORY,
  getPattern,
  clonePatternCells,
  listPatterns,
  searchPatterns,
  transformCells,
  normalizeCells,
} from '../../src/patterns/library.js';

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
    if (e.stack) console.error(e.stack.split('\n').slice(1, 3).join('\n'));
  }
}

console.log('Pattern Library tests:');

// ── normalizeCells ───────────────────────────────────────────────────
test('normalizeCells: handles empty input', () => {
  const r = normalizeCells([]);
  assert.deepEqual(r.cells, []);
  assert.equal(r.width, 0);
  assert.equal(r.height, 0);
});

test('normalizeCells: shifts negative offsets to origin', () => {
  const r = normalizeCells([
    [-1, -2],
    [0, 0],
    [1, 2],
  ]);
  assert.deepEqual(
    r.cells.sort(),
    [
      [0, 0],
      [1, 2],
      [2, 4],
    ].sort()
  );
  assert.equal(r.width, 3);
  assert.equal(r.height, 5);
});

test('normalizeCells: rejects non-integer cells', () => {
  assert.throws(() => normalizeCells([[0.5, 1]]));
});

// ── transformCells ───────────────────────────────────────────────────
test('transformCells: rotation 0 is identity (after normalize)', () => {
  const input = [
    [0, 0],
    [1, 0],
    [2, 1],
  ];
  const out = transformCells(input, { rotate: 0 });
  assert.deepEqual(out.sort(), input.slice().sort());
});

test('transformCells: rotation by 4 returns to original', () => {
  const input = [
    [1, 0],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ]; // glider
  const out = transformCells(input, { rotate: 4 });
  assert.deepEqual(out.sort(), input.slice().sort());
});

test('transformCells: flipH twice is identity', () => {
  const input = [
    [1, 0],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ];
  const once = transformCells(input, { flipH: true });
  const twice = transformCells(once, { flipH: true });
  assert.deepEqual(twice.sort(), input.slice().sort());
});

test('transformCells: flipV twice is identity', () => {
  const input = [
    [1, 0],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ];
  const once = transformCells(input, { flipV: true });
  const twice = transformCells(once, { flipV: true });
  assert.deepEqual(twice.sort(), input.slice().sort());
});

test('transformCells: 90° CW preserves cell count', () => {
  const input = [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
  ];
  const out = transformCells(input, { rotate: 1 });
  assert.equal(out.length, input.length);
});

// ── Registry sanity ──────────────────────────────────────────────────
test('Registry: all built-in patterns have required metadata', () => {
  const all = listPatterns();
  assert.ok(all.length > 0, 'expected built-in patterns');
  for (const p of all) {
    assert.ok(typeof p.id === 'string' && p.id.length > 0, `${p.id}: bad id`);
    assert.ok(typeof p.name === 'string' && p.name.length > 0, `${p.id}: missing name`);
    assert.ok(
      Object.values(CATEGORY).includes(p.category),
      `${p.id}: invalid category ${p.category}`
    );
    assert.ok(Array.isArray(p.cells) && p.cells.length > 0, `${p.id}: missing cells`);
    assert.ok(Array.isArray(p.rulesets) && p.rulesets.length > 0, `${p.id}: missing rulesets`);
    assert.ok(typeof p.width === 'number' && p.width > 0, `${p.id}: bad width`);
    assert.ok(typeof p.height === 'number' && p.height > 0, `${p.id}: bad height`);
  }
});

test('Registry: pattern ids are unique', () => {
  const all = listPatterns();
  const seen = new Set();
  for (const p of all) {
    assert.ok(!seen.has(p.id), `duplicate id: ${p.id}`);
    seen.add(p.id);
  }
});

test('Registry: all cells are normalized to origin', () => {
  for (const p of listPatterns()) {
    let minX = Infinity,
      minY = Infinity;
    for (const [x, y] of p.cells) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
    }
    assert.equal(minX, 0, `${p.id}: minX should be 0, got ${minX}`);
    assert.equal(minY, 0, `${p.id}: minY should be 0, got ${minY}`);
  }
});

test('Registry: spaceships declare a direction', () => {
  const ships = listPatterns({ category: CATEGORY.SPACESHIP });
  assert.ok(ships.length > 0);
  for (const s of ships) {
    assert.ok(s.direction !== null, `spaceship ${s.id} missing direction`);
  }
});

test('Registry: oscillators declare period > 1', () => {
  const oscs = listPatterns({ category: CATEGORY.OSCILLATOR });
  assert.ok(oscs.length > 0);
  for (const o of oscs) {
    assert.ok(o.period >= 2, `oscillator ${o.id} has period ${o.period}, expected >= 2`);
  }
});

test('Registry: still lifes have period 1', () => {
  const sl = listPatterns({ category: CATEGORY.STILL_LIFE });
  assert.ok(sl.length > 0);
  for (const s of sl) {
    assert.equal(s.period, 1, `${s.id}: still life must have period 1`);
  }
});

test('Registry: known patterns are findable by id', () => {
  const expected = [
    'glider',
    'blinker',
    'block',
    'rpentomino',
    'acorn',
    'lwss',
    'gosper_gun',
    'pulsar',
  ];
  for (const id of expected) {
    const p = getPattern(id);
    assert.ok(p !== null, `missing built-in pattern: ${id}`);
  }
});

// ── Specific patterns: structural assertions ─────────────────────────
test('Glider: exactly 5 cells', () => {
  assert.equal(getPattern('glider').cells.length, 5);
});

test('Block: 4 cells in 2x2 bounding box', () => {
  const p = getPattern('block');
  assert.equal(p.cells.length, 4);
  assert.equal(p.width, 2);
  assert.equal(p.height, 2);
});

test('Blinker: 3 cells, period 2', () => {
  const p = getPattern('blinker');
  assert.equal(p.cells.length, 3);
  assert.equal(p.period, 2);
});

test('Gosper gun: 36 cells, period 30', () => {
  const p = getPattern('gosper_gun');
  assert.equal(p.cells.length, 36);
  assert.equal(p.period, 30);
});

// ── clonePatternCells ────────────────────────────────────────────────
test('clonePatternCells: returns mutable copy', () => {
  const c1 = clonePatternCells('glider');
  const c2 = clonePatternCells('glider');
  assert.notStrictEqual(c1, c2);
  // Mutate one; verify the other (and the registry) is unaffected.
  c1[0][0] = 99;
  const original = getPattern('glider');
  assert.notEqual(c2[0][0], 99);
  assert.notEqual(original.cells[0][0], 99);
});

test('clonePatternCells: returns null for unknown id', () => {
  assert.equal(clonePatternCells('does_not_exist'), null);
});

// ── Filtering & search ───────────────────────────────────────────────
test('listPatterns: filter by category works', () => {
  const guns = listPatterns({ category: CATEGORY.GUN });
  assert.ok(guns.length >= 1);
  for (const g of guns) assert.equal(g.category, CATEGORY.GUN);
});

test('listPatterns: filter by ruleset includes wildcard patterns', () => {
  const conway = listPatterns({ ruleset: 'conway' });
  const fortress = conway.find((p) => p.id === 'fortress_target');
  assert.ok(fortress, 'fortress_target has rulesets ["*"] and should match');
});

test('listPatterns: tag filter works', () => {
  const famous = listPatterns({ tag: 'famous' });
  assert.ok(famous.length >= 3);
  for (const f of famous) assert.ok(f.tags.includes('famous'));
});

test('searchPatterns: case-insensitive substring', () => {
  const r = searchPatterns('GLIDER');
  assert.ok(r.some((p) => p.id === 'glider'));
  assert.ok(r.some((p) => p.id === 'gosper_gun'));
});

test('searchPatterns: empty query returns all', () => {
  const all = listPatterns();
  const r = searchPatterns('');
  assert.equal(r.length, all.length);
});

// ── Immutability ─────────────────────────────────────────────────────
test('Pattern objects are frozen', () => {
  const p = getPattern('glider');
  assert.throws(() => {
    p.name = 'oops';
  });
  assert.throws(() => {
    p.cells.push([99, 99]);
  });
});

// ── Done ─────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
