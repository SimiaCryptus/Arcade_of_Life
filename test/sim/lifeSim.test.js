/**
 * Tests for characterize() and related new utilities in lifeSim.js.
 *
 * Run via:  node test/sim/lifeSim.test.js
 */

import assert from 'node:assert/strict';
import { characterize, setHash, cellsToSet } from './lifeSim.js';
import { CompiledRuleset, CONWAY, getRuleset } from '../../src/rules/ruleset.js';
import '../../src/rules/extraRulesets.js';

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

const conway = new CompiledRuleset(CONWAY);

section('characterize: basics');

test('empty input: extinct immediately', () => {
  const r = characterize([], conway, 10);
  assert.equal(r.extinct, true);
  assert.equal(r.finalSize, 0);
  assert.equal(r.bounds, null);
});

test('block: stable, no change', () => {
  const block = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ];
  const r = characterize(block, conway, 20);
  assert.equal(r.extinct, false);
  assert.equal(r.maxSize, 4);
  assert.equal(r.finalSize, 4);
  assert.ok(r.bounds);
  assert.equal(r.bounds.width, 2);
  assert.equal(r.bounds.height, 2);
  // Block doesn't change, so stabilizedAt should be 1.
  assert.equal(r.stabilizedAt, 1);
});

test('blinker: cycle detected at period 2', () => {
  const blinker = [
    [0, 0],
    [1, 0],
    [2, 0],
  ];
  const r = characterize(blinker, conway, 20);
  assert.equal(r.extinct, false);
  assert.equal(r.cyclePeriod, 2);
  // Blinker bounds is 3x3 (horizontal + vertical orientations).
  assert.ok(r.bounds);
  assert.equal(r.bounds.width, 3);
  assert.equal(r.bounds.height, 3);
});

test('glider: bounds expand without cycle (no exact return)', () => {
  const glider = [
    [1, 0],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ];
  const r = characterize(glider, conway, 8);
  assert.equal(r.extinct, false);
  // Glider should have moved across multiple cells; bounds expanded.
  assert.ok(r.bounds);
  assert.ok(
    r.bounds.width > 3 || r.bounds.height > 3,
    `expected bounds to expand, got ${r.bounds.width}x${r.bounds.height}`
  );
});

test('diehard: extinct within 130 generations', () => {
  const diehard = [
    [6, 0],
    [0, 1],
    [1, 1],
    [1, 2],
    [5, 2],
    [6, 2],
    [7, 2],
  ];
  const r = characterize(diehard, conway, 200);
  assert.equal(r.extinct, true);
  assert.equal(r.finalSize, 0);
  assert.ok(r.generations <= 130);
});

test('gosper gun: triggers population cap (unbounded)', () => {
  // Pull gun pattern from library cells.
  const gun = [
    [24, 0],
    [22, 1],
    [24, 1],
    [12, 2],
    [13, 2],
    [20, 2],
    [21, 2],
    [34, 2],
    [35, 2],
    [11, 3],
    [15, 3],
    [20, 3],
    [21, 3],
    [34, 3],
    [35, 3],
    [0, 4],
    [1, 4],
    [10, 4],
    [16, 4],
    [20, 4],
    [21, 4],
    [0, 5],
    [1, 5],
    [10, 5],
    [14, 5],
    [16, 5],
    [17, 5],
    [22, 5],
    [24, 5],
    [10, 6],
    [16, 6],
    [24, 6],
    [11, 7],
    [15, 7],
    [12, 8],
    [13, 8],
  ];
  const r = characterize(gun, conway, 500, { populationCap: 200 });
  assert.equal(r.exceededPopulationCap, true);
  assert.equal(r.extinct, false);
});

test('bounds track maximal extent across all generations', () => {
  // R-pentomino: known to sprawl widely.
  const rpent = [
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [1, 2],
  ];
  const r = characterize(rpent, conway, 100);
  assert.ok(r.bounds);
  // Should expand well beyond the original 3x3.
  assert.ok(
    r.bounds.width > 10 || r.bounds.height > 10,
    `R-pent should expand widely, got ${r.bounds.width}x${r.bounds.height}`
  );
});

section('setHash:');

test('empty set hashes to "e"', () => {
  assert.equal(setHash(new Set()), 'e');
});

test('same cells produce same hash regardless of insertion order', () => {
  const a = new Set();
  a.add('1,2');
  a.add('3,4');
  a.add('0,0');
  const b = new Set();
  b.add('0,0');
  b.add('3,4');
  b.add('1,2');
  assert.equal(setHash(a), setHash(b));
});

test('different cells produce different hashes', () => {
  const a = cellsToSet([
    [0, 0],
    [1, 1],
  ]);
  const b = cellsToSet([
    [0, 0],
    [1, 2],
  ]);
  assert.notEqual(setHash(a), setHash(b));
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
