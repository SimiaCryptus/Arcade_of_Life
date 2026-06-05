/**
 * Tests for inferPatternMetadata().
 *
 * Runs via: node test/patterns/inferMetadata.test.js
 */

import assert from 'node:assert/strict';
import {
  inferPatternMetadata,
  directionFromDisplacement,
} from '../../src/patterns/inferMetadata.js';
import { getPattern } from '../../src/patterns/library.js';

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

section('directionFromDisplacement:');
test('axial directions', () => {
  assert.equal(directionFromDisplacement(0, -1), 'N');
  assert.equal(directionFromDisplacement(0, 1), 'S');
  assert.equal(directionFromDisplacement(1, 0), 'E');
  assert.equal(directionFromDisplacement(-1, 0), 'W');
});
test('diagonal directions', () => {
  assert.equal(directionFromDisplacement(1, 1), 'SE');
  assert.equal(directionFromDisplacement(-1, -1), 'NW');
});
test('zero returns null', () => {
  assert.equal(directionFromDisplacement(0, 0), null);
});

section('inferPatternMetadata: built-in patterns:');

test('block → still_life period 1', () => {
  const p = getPattern('block');
  const r = inferPatternMetadata(p.cells.map((c) => [c[0], c[1]]));
  assert.equal(r.category, 'still_life');
  assert.equal(r.period, 1);
  assert.ok(r.maxBounds, 'should have maxBounds');
  assert.equal(r.maxBounds.width, 2);
  assert.equal(r.maxBounds.height, 2);
  assert.equal(r.maxPopulation, 4);
  assert.equal(r.unbounded, false);
  assert.equal(r.extinct, false);
});

test('blinker → oscillator period 2', () => {
  const p = getPattern('blinker');
  const r = inferPatternMetadata(p.cells.map((c) => [c[0], c[1]]));
  assert.equal(r.category, 'oscillator');
  assert.equal(r.period, 2);
  assert.ok(r.maxBounds, 'should have maxBounds');
  // Blinker oscillates between 3x1 and 1x3; bounds should be 3x3.
  assert.equal(r.maxBounds.width, 3);
  assert.equal(r.maxBounds.height, 3);
});

test('toad → oscillator period 2', () => {
  const p = getPattern('toad');
  const r = inferPatternMetadata(p.cells.map((c) => [c[0], c[1]]));
  assert.equal(r.category, 'oscillator');
  assert.equal(r.period, 2);
  assert.ok(r.maxBounds);
});

test('pulsar → oscillator period 3', () => {
  const p = getPattern('pulsar');
  const r = inferPatternMetadata(p.cells.map((c) => [c[0], c[1]]));
  assert.equal(r.category, 'oscillator');
  assert.equal(r.period, 3);
  assert.ok(r.maxBounds);
});

test('glider → spaceship SE period 4', () => {
  const p = getPattern('glider');
  const r = inferPatternMetadata(p.cells.map((c) => [c[0], c[1]]));
  assert.equal(r.category, 'spaceship');
  assert.equal(r.period, 4);
  assert.equal(r.direction, 'SE');
  // Glider per-period sweep fits in a small bounding box.
  assert.ok(r.maxBounds);
  assert.ok(r.maxBounds.width >= 3 && r.maxBounds.width <= 6);
  assert.ok(r.maxBounds.height >= 3 && r.maxBounds.height <= 6);
});

test('lwss → spaceship period 4 (some W direction)', () => {
  const p = getPattern('lwss');
  const r = inferPatternMetadata(p.cells.map((c) => [c[0], c[1]]));
  assert.equal(r.category, 'spaceship');
  assert.equal(r.period, 4);
  assert.equal(r.direction, 'W');
});

test('rpentomino → methuselah (with enough generations)', () => {
  const p = getPattern('rpentomino');
  const r = inferPatternMetadata(
    p.cells.map((c) => [c[0], c[1]]),
    {
      maxPeriod: 20,
      methuselahGens: 200,
    }
  );
  assert.equal(r.category, 'methuselah');
  assert.ok(r.maxBounds, 'methuselah should track maxBounds');
  assert.ok(r.maxPopulation > 5, 'methuselah should grow');
  // R-pentomino expands wildly; bounds should be much larger than 3x3.
  assert.ok(
    r.maxBounds.width > 10 || r.maxBounds.height > 10,
    `R-pentomino bounds should expand significantly; got ${r.maxBounds.width}x${r.maxBounds.height}`
  );
});

test('diehard → dies (categorized as misc)', () => {
  const p = getPattern('diehard');
  const r = inferPatternMetadata(
    p.cells.map((c) => [c[0], c[1]]),
    {
      maxPeriod: 20,
      methuselahGens: 200,
    }
  );
  // Dies fully; categorized as misc.
  assert.equal(r.category, 'misc');
  assert.ok(r.notes.some((n) => /died/.test(n)));
  assert.equal(r.extinct, true);
  assert.equal(r.finalPopulation, 0);
});

test('empty input handled', () => {
  const r = inferPatternMetadata([]);
  assert.equal(r.category, 'misc');
  assert.equal(r.period, 0);
  assert.equal(r.extinct, true);
});

test('explicit rule B3/S23 still gives correct results', () => {
  const p = getPattern('blinker');
  const r = inferPatternMetadata(
    p.cells.map((c) => [c[0], c[1]]),
    { rule: 'B3/S23' }
  );
  assert.equal(r.category, 'oscillator');
  assert.equal(r.period, 2);
});
test('gosper gun → unbounded (population grows without bound)', () => {
  const p = getPattern('gosper_gun');
  const r = inferPatternMetadata(
    p.cells.map((c) => [c[0], c[1]]),
    {
      maxPeriod: 20,
      methuselahGens: 500,
      populationCap: 200,
    }
  );
  // Gun emits gliders → population grows beyond the cap → unbounded.
  assert.equal(r.unbounded, true);
  assert.ok(r.maxBounds);
  assert.equal(r.maxBounds.width, -1);
  assert.equal(r.maxBounds.height, -1);
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
